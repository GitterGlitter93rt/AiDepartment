import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { resetDatabase } from './helpers.js';
import {
  recordHookAttempt, markHookEvent, recordMeetingQuality, compareHookVariants,
  promotionReadiness, timeBucket, MINIMUM_ATTEMPTS_FOR_COMPARISON,
  MINIMUM_ATTENDED_FOR_QUALITY,
} from '../src/analytics/hookExperiments.js';

/**
 * The hook experiment engine.
 * Authority: outbound-sales-brain-sales-ai-metric-definitions.v1.yaml.
 *
 * Most of these tests are about what the engine refuses to conclude.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

async function account(name: string): Promise<string> {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name, website: `https://${name.replace(/\W+/g, '')}.example.com`,
    city: 'Jacksonville', state: 'FL', postalCode: '32256',
  }, { discoverySource: 'test' }));
  return accountId;
}

/** Records n attempts of one variant, advancing them as far as the options say. */
async function attempts(input: {
  variant: string; frame: string; count: number;
  reachStakeholder?: number; problem?: number; offered?: number;
  accepted?: number; booked?: number; attended?: number; quality?: number[];
  vertical?: string;
}): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const accountId = await account(`${input.variant} ${index}`);
    const id = await recordHookAttempt({
      accountId, openerVersion: input.variant, openerFrame: input.frame,
      hookFamily: 'missed_calls_overflow', agentProfileId: 'yad-sales-core-v1',
      verticalProfileId: input.vertical ?? 'hvac', tier: 'B',
    });
    ids.push(id);
    await markHookEvent({ hookAttemptId: id, event: 'human_answered' });
    if (index < (input.reachStakeholder ?? 0)) {
      await markHookEvent({ hookAttemptId: id, event: 'right_stakeholder' });
    }
    if (index < (input.problem ?? 0)) {
      await markHookEvent({ hookAttemptId: id, event: 'problem_supported' });
    }
    if (index < (input.offered ?? 0)) {
      await markHookEvent({ hookAttemptId: id, event: 'strategy_offer' });
    }
    if (index < (input.accepted ?? 0)) {
      await markHookEvent({ hookAttemptId: id, event: 'strategy_accepted' });
    }
    if (index < (input.booked ?? 0)) {
      await markHookEvent({ hookAttemptId: id, event: 'strategy_booked' });
    }
    if (index < (input.attended ?? 0)) {
      await markHookEvent({ hookAttemptId: id, event: 'meeting_attended' });
      const score = input.quality?.[index % (input.quality.length || 1)];
      if (score) {
        await recordMeetingQuality({
          hookAttemptId: id, score, stakeholderFit: 'DECISION_MAKER',
          problemConfirmed: 'CONFIRMED' });
      }
    }
  }
  return ids;
}

// --- attribution -----------------------------------------------------------------

test('an attempt carries every dimension needed to compare it fairly', async () => {
  const accountId = await account('Attribution Co');
  const id = await recordHookAttempt({
    accountId, openerVersion: 'v3', openerFrame: 'MARKET_CATEGORY',
    hookFamily: 'after_hours_response', hypothesisCategory: 'after_hours',
    evidenceIds: [], stakeholderRoute: 'named_via_main_line',
    contactRouteClass: 'generic_main_line', verticalProfileId: 'hvac',
    agentProfileId: 'yad-sales-core-v1', modelVersion: 'claude-x', promptVersion: 'p1',
    tier: 'A', advertiserEvidenceClass: 'STRONG', researchCompletenessBand: 'HIGH',
    attemptedAt: new Date('2026-09-08T14:30:00Z'),
  });

  const { rows } = await query<any>(
    `select * from hook_attempts where hook_attempt_id = $1`, [id]);
  const row = rows[0]!;
  for (const field of ['opener_version', 'opener_frame', 'hook_family', 'hypothesis_category',
                       'stakeholder_route', 'contact_route_class', 'vertical_profile_id',
                       'time_bucket', 'agent_profile_id', 'model_version', 'prompt_version',
                       'tier', 'advertiser_evidence_class', 'research_completeness_band']) {
    assert.ok(row[field], `${field} was not recorded`);
  }
  assert.equal(row.time_bucket, 'MORNING_09_12', '14:30 UTC is 10:30 in Jacksonville');
});

test('the time bucket is the prospect local hour, not ours', () => {
  assert.equal(timeBucket(new Date('2026-09-08T13:00:00Z')), 'MORNING_09_12');
  assert.equal(timeBucket(new Date('2026-09-08T20:00:00Z')), 'AFTERNOON_14_17');
  assert.equal(timeBucket(new Date('2026-09-09T02:00:00Z')), 'AFTER_19');
  // 20:00 UTC is 16:00 in Jacksonville and 13:00 in Los Angeles: the same instant,
  // a different bucket, which is why the prospect's zone is the one that counts.
  assert.equal(timeBucket(new Date('2026-09-08T20:00:00Z'), 'America/Los_Angeles'),
    'MIDDAY_12_14');
});

test('a base event is marked once, whatever arrives twice', async () => {
  const accountId = await account('Idempotent Co');
  const id = await recordHookAttempt({
    accountId, openerVersion: 'v1', openerFrame: 'ROLE_PROCESS',
    agentProfileId: 'yad-sales-core-v1' });

  const first = new Date('2026-09-08T14:00:00Z');
  await markHookEvent({ hookAttemptId: id, event: 'strategy_booked', at: first });
  await markHookEvent({
    hookAttemptId: id, event: 'strategy_booked', at: new Date('2026-09-08T15:00:00Z') });

  const { rows } = await query<{ strategy_booked_at: Date }>(
    `select strategy_booked_at from hook_attempts where hook_attempt_id = $1`, [id]);
  assert.equal(rows[0]!.strategy_booked_at.toISOString(), first.toISOString(),
    'a duplicate webhook must not move a timestamp or double-count a metric');
});

test('a meeting cannot be scored before it was attended', async () => {
  const accountId = await account('Unattended Co');
  const id = await recordHookAttempt({
    accountId, openerVersion: 'v1', openerFrame: 'ROLE_PROCESS',
    agentProfileId: 'yad-sales-core-v1' });

  const refused = await recordMeetingQuality({
    hookAttemptId: id, score: 5, stakeholderFit: 'DECISION_MAKER',
    problemConfirmed: 'CONFIRMED' });
  assert.equal(refused.ok, false);
  assert.match(refused.message!, /attended/);

  await assert.rejects(
    () => query(
      `update hook_attempts set michael_quality_score = 5 where hook_attempt_id = $1`, [id]),
    /hook_quality_needs_attendance/,
    'the rule holds against code that has not been written yet');
});

test('a score outside one to five is refused', async () => {
  const accountId = await account('Bad Score Co');
  const id = await recordHookAttempt({
    accountId, openerVersion: 'v1', openerFrame: 'ROLE_PROCESS',
    agentProfileId: 'yad-sales-core-v1' });
  await markHookEvent({ hookAttemptId: id, event: 'meeting_attended' });
  for (const score of [0, 6, 2.5, -1]) {
    const result = await recordMeetingQuality({
      hookAttemptId: id, score, stakeholderFit: 'DECISION_MAKER',
      problemConfirmed: 'CONFIRMED' });
    assert.equal(result.ok, false, `${score} was accepted`);
  }
});

// --- refusing to conclude ----------------------------------------------------------

test('six calls is not a result', async () => {
  await attempts({ variant: 'v1', frame: 'MARKET_CATEGORY', count: 3, booked: 3 });
  await attempts({ variant: 'v2', frame: 'ROLE_PROCESS', count: 3, booked: 0 });

  const report = await compareHookVariants();
  assert.equal(report.insufficientEvidence, true);
  assert.equal(report.leader, null, 'a three-for-three variant is not a winner');
  assert.match(report.message, /Six calls is not a result/);
  for (const variant of report.variants) {
    assert.equal(variant.insufficientEvidence, true);
    assert.match(variant.reason!, new RegExp(`${MINIMUM_ATTEMPTS_FOR_COMPARISON} are needed`));
  }
});

test('one variant with enough attempts still has nothing to compare against', async () => {
  await attempts({
    variant: 'v1', frame: 'MARKET_CATEGORY', count: MINIMUM_ATTEMPTS_FOR_COMPARISON,
    reachStakeholder: 20, problem: 10, offered: 8, accepted: 6, booked: 5 });

  const report = await compareHookVariants();
  assert.equal(report.leader, null);
  assert.match(report.message, /nothing to compare it against/);
});

test('every rate carries its numerator and denominator', async () => {
  await attempts({
    variant: 'v1', frame: 'MARKET_CATEGORY', count: MINIMUM_ATTEMPTS_FOR_COMPARISON,
    reachStakeholder: 20, problem: 10, offered: 8, accepted: 6, booked: 5 });

  const report = await compareHookVariants();
  const variant = report.variants[0]!;
  for (const [name, value] of Object.entries(variant.rates)) {
    assert.equal(typeof value.numerator, 'number', `${name} has no numerator`);
    assert.equal(typeof value.denominator, 'number', `${name} has no denominator`);
    if (value.denominator === 0) {
      assert.equal(value.rate, null, `${name} produced a rate off an empty denominator`);
    }
  }
  assert.equal(variant.rates['meaningful_problem']!.numerator, 10);
  assert.equal(variant.rates['meaningful_problem']!.denominator, 20);
});

test('a small denominator is flagged even when the variant is comparable', async () => {
  await attempts({
    variant: 'v1', frame: 'MARKET_CATEGORY', count: MINIMUM_ATTEMPTS_FOR_COMPARISON,
    reachStakeholder: 20, problem: 3, offered: 3, accepted: 2, booked: 2 });
  const report = await compareHookVariants();
  const variant = report.variants[0]!;
  assert.equal(variant.rates['strategy_offer_per_problem']!.lowSample, true,
    'three problems is not a base to quote an offer rate from');
});

test('a quality mean is withheld until enough meetings were scored', async () => {
  await attempts({
    variant: 'v1', frame: 'MARKET_CATEGORY', count: MINIMUM_ATTEMPTS_FOR_COMPARISON,
    reachStakeholder: 20, problem: 10, offered: 9, accepted: 7, booked: 6,
    attended: MINIMUM_ATTENDED_FOR_QUALITY - 1, quality: [5] });

  const report = await compareHookVariants();
  assert.equal(report.variants[0]!.quality.meanScore, null,
    'four scores do not make a mean worth reporting');
});

// --- ranking on what matters --------------------------------------------------------

test('the variant that books more is not the leader if the meetings were worse', async () => {
  // v1 books more, but the meetings score badly.
  await attempts({
    variant: 'v1_books_more', frame: 'MARKET_CATEGORY',
    count: MINIMUM_ATTEMPTS_FOR_COMPARISON,
    reachStakeholder: 25, problem: 20, offered: 18, accepted: 16, booked: 15,
    attended: 12, quality: [1, 2, 2] });
  // v2 books fewer, and they are good.
  await attempts({
    variant: 'v2_books_better', frame: 'ROLE_PROCESS',
    count: MINIMUM_ATTEMPTS_FOR_COMPARISON,
    reachStakeholder: 20, problem: 12, offered: 10, accepted: 8, booked: 7,
    attended: 6, quality: [5, 4, 5] });

  const report = await compareHookVariants();
  assert.ok(report.leader);
  assert.equal(report.leader!.openerVersion, 'v2_books_better',
    'a hook that books meetings nobody wanted is not a better hook');
  assert.match(report.leader!.basis, /mean meeting quality/);

  const worse = report.variants.find((v) => v.openerVersion === 'v1_books_more')!;
  assert.ok(worse.rates['booking_completion']!.rate! > 0,
    'the booking rate is still shown, beside the quality');
  assert.ok(worse.quality.badBookingRate.numerator > 0,
    'and the bad bookings are counted rather than hidden');
});

test('a leader without quality scores is marked provisional', async () => {
  await attempts({
    variant: 'v1', frame: 'MARKET_CATEGORY', count: MINIMUM_ATTEMPTS_FOR_COMPARISON,
    reachStakeholder: 20, problem: 12, offered: 10, accepted: 8, booked: 7 });
  await attempts({
    variant: 'v2', frame: 'ROLE_PROCESS', count: MINIMUM_ATTEMPTS_FOR_COMPARISON,
    reachStakeholder: 15, problem: 8, offered: 6, accepted: 4, booked: 3 });

  const report = await compareHookVariants();
  assert.ok(report.leader);
  assert.match(report.leader!.basis, /provisional/);
  assert.match(report.message, /no variant should be promoted yet/);
});

// --- promotion ------------------------------------------------------------------------

test('nothing is promoted on a thin sample, and the reasons say why', async () => {
  await attempts({ variant: 'v1', frame: 'MARKET_CATEGORY', count: 5, booked: 5 });
  const readiness = await promotionReadiness();
  assert.equal(readiness.ready, false);
  assert.ok(readiness.reasons.some((reason) => /enough attempts/.test(reason)));
  assert.ok(readiness.reasons.some((reason) => /scored meetings/.test(reason)));
});

test('a leader inside the noise is not promotable', async () => {
  await attempts({
    variant: 'v1', frame: 'MARKET_CATEGORY', count: MINIMUM_ATTEMPTS_FOR_COMPARISON,
    reachStakeholder: 20, problem: 12, offered: 10, accepted: 9, booked: 8,
    attended: 6, quality: [4, 4, 4] });
  await attempts({
    variant: 'v2', frame: 'ROLE_PROCESS', count: MINIMUM_ATTEMPTS_FOR_COMPARISON,
    reachStakeholder: 20, problem: 12, offered: 10, accepted: 9, booked: 8,
    attended: 6, quality: [4, 4, 3] });

  const readiness = await promotionReadiness();
  assert.equal(readiness.ready, false);
  assert.ok(readiness.reasons.some((reason) => /inside the noise/.test(reason)),
    'a third of a point on a five-point scale is not a decision');
});

test('a cohort filter compares like with like', async () => {
  await attempts({
    variant: 'v1', frame: 'MARKET_CATEGORY', count: MINIMUM_ATTEMPTS_FOR_COMPARISON,
    booked: 10, vertical: 'hvac' });
  await attempts({
    variant: 'v1', frame: 'MARKET_CATEGORY', count: MINIMUM_ATTEMPTS_FOR_COMPARISON,
    booked: 1, vertical: 'roofing' });

  const hvac = await compareHookVariants({ verticalProfileId: 'hvac' });
  const roofing = await compareHookVariants({ verticalProfileId: 'roofing' });
  assert.equal(hvac.totalAttempts, MINIMUM_ATTEMPTS_FOR_COMPARISON);
  assert.equal(roofing.totalAttempts, MINIMUM_ATTEMPTS_FOR_COMPARISON);
  assert.notEqual(
    hvac.variants[0]!.rates['booking_completion']!.numerator,
    roofing.variants[0]!.rates['booking_completion']!.numerator,
    'the same opener performs differently by vertical, which is the point of the cohort');
});

test('a superseded attempt is excluded, so a reschedule is not two bookings', async () => {
  const ids = await attempts({
    variant: 'v1', frame: 'MARKET_CATEGORY', count: MINIMUM_ATTEMPTS_FOR_COMPARISON,
    booked: 5 });
  await query(
    `update hook_attempts set superseded_by = $2 where hook_attempt_id = $1`,
    [ids[0], ids[1]]);
  const report = await compareHookVariants();
  assert.equal(report.totalAttempts, MINIMUM_ATTEMPTS_FOR_COMPARISON - 1);
});
