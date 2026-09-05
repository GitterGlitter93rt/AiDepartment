import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { upsertAccount, upsertEndpoint } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import { analyticsFunnel, analyticsBreakdown, emptyFilters } from '../src/api/waveDQueries.js';
import {
  compareHookVariants, promotionReadiness, MINIMUM_ATTEMPTS_FOR_COMPARISON,
  MINIMUM_DENOMINATOR_FOR_RATE, MINIMUM_ATTENDED_FOR_QUALITY,
} from '../src/analytics/hookExperiments.js';

/**
 * Analytics against answers that are known by construction.
 * Authority: outbound-sales-brain-sales-ai-metric-definitions.v1.yaml,
 * CLAUDE-SALES-AI-TRANSCRIPT-AUTHORITY.md (hook optimisation).
 *
 * Every fixture here is built so that the correct number can be worked out on paper.
 * A test that re-derives the answer with the same SQL the product uses proves only
 * that the query is consistent with itself.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

let sequence = 0;

interface Built {
  accountId: string;
  endpointId: string;
}

async function buildAccount(name: string, vertical: string | null = 'hvac'): Promise<Built> {
  sequence += 1;
  const phone = `904-555-${String(9000 + sequence).slice(-4)}`;
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: name, website: `https://${name.toLowerCase().replace(/\W+/g, '')}.invalid`,
      phone, city: 'Jacksonville', state: 'FL', postalCode: '32256',
      verticalProfileId: vertical,
    }, { discoverySource: 'analytics-test' }));
  const { rows } = await query<{ endpoint_id: string }>(
    `select endpoint_id from contact_endpoints where account_id = $1 and endpoint_type = 'PHONE'
      limit 1`, [accountId]);
  return { accountId, endpointId: rows[0]!.endpoint_id };
}

/**
 * A rep dials, which is what writes the attempt row the funnel counts.
 *
 * A phone attempt requires the eligibility decision that permitted it -- the schema
 * refuses an attempt without one -- so the fixture records the decision the same way
 * the preflight does.
 */
async function startCall(accountId: string, endpointId: string, userId: string): Promise<void> {
  const { rows } = await query<{ decision_id: string }>(
    `insert into channel_eligibility_decisions (endpoint_id, account_id, channel, decision,
                                                reason_codes, policy_version)
     values ($1, $2, 'HUMAN_MANUAL_CALL', 'ALLOW', array['TEST_FIXTURE'], 'v1')
     returning decision_id`, [endpointId, accountId]);
  await query(
    `insert into contact_attempts (account_id, endpoint_id, actor_user_id, channel,
                                   eligibility_decision_id)
     values ($1, $2, $3, 'HUMAN_MANUAL_CALL', $4)`,
    [accountId, endpointId, userId, rows[0]!.decision_id]);
}

// --- the funnel ------------------------------------------------------------------

test('the funnel counts exactly what the fixture contains', async () => {
  const rep = await makeUser('Funnel Rep');

  // Twelve accounts, built so every stage has a number that can be checked by hand.
  const accounts: Built[] = [];
  for (let i = 0; i < 12; i += 1) accounts.push(await buildAccount(`Funnel Co ${i}`));
  for (const account of accounts) await claimAccount(account.accountId, rep);

  // Eight are dialled. Of those, five reach somebody who counts as connected
  // (decision maker, gatekeeper, send information, callback, meeting) and three do
  // not (no answer, voicemail, no answer).
  const dialled = accounts.slice(0, 8);
  for (const account of dialled) await startCall(account.accountId, account.endpointId, rep.userId);

  const outcomes = [
    'DECISION_MAKER_REACHED', 'DECISION_MAKER_REACHED', 'GATEKEEPER',
    'SEND_INFORMATION', 'CALLBACK_REQUESTED',
    'NO_ANSWER', 'VOICEMAIL', 'NO_ANSWER',
  ] as const;
  for (const [index, account] of dialled.entries()) {
    const disposition = outcomes[index]!;
    const result = await recordDisposition({
      accountId: account.accountId, endpointId: account.endpointId, disposition,
      ...(disposition === 'CALLBACK_REQUESTED'
        ? { callbackDueAt: new Date(Date.now() + 86_400_000) } : {}),
      notes: `outcome ${index}`,
    }, rep);
    assert.equal(result.ok, true, `disposition ${index} failed: ${result.reason}`);
  }

  // Two opportunities, one confirmed booking that was attended, one confirmed
  // booking that was not, and one suppression.
  for (const account of accounts.slice(0, 2)) {
    await query(
      `insert into opportunities (account_id, owner_user_id, title, stage, problem_summary,
                                  source_channel)
       values ($1, $2, 'Funnel', 'DISCOVERY',
               'They lose calls every afternoon while the crew is out.', 'human_rep')`,
      [account.accountId, rep.userId]);
  }
  await query(
    `insert into meeting_bookings (account_id, owner_user_id, calendar_upn, meeting_type,
                                   idempotency_key, requested_start, requested_end, status,
                                   provider, provider_event_id, confirmed_at, attended_state,
                                   created_by)
     values ($1, $2, 'michael@youraidepartment.ai', 'strategy_call', 'funnel-1',
             now(), now() + interval '15 minutes', 'CONFIRMED', 'calcom', 'evt-1', now(),
             'ATTENDED', $2),
            ($3, $2, 'michael@youraidepartment.ai', 'strategy_call', 'funnel-2',
             now(), now() + interval '15 minutes', 'CONFIRMED', 'calcom', 'evt-2', now(),
             'UNKNOWN', $2)`,
    [accounts[0]!.accountId, rep.userId, accounts[1]!.accountId]);
  await query(
    `insert into suppressions (scope, account_id, suppression_type, source, reason)
     values ('ACCOUNT', $1, 'DNC', 'prospect_request', 'Asked to be removed.')`,
    [accounts[11]!.accountId]);

  const funnel = await analyticsFunnel(emptyFilters());

  assert.equal(funnel.researched, 12, 'researched');
  assert.equal(funnel.contactable, 11,
    'contactable should exclude the suppressed Account’s endpoint');
  assert.equal(funnel.attempted, 8, 'attempted');
  assert.equal(funnel.connected, 5,
    'connected — this was permanently zero before dispositions closed their attempts');
  assert.equal(funnel.qualified, 2, 'qualified');
  assert.equal(funnel.booked, 2, 'booked');
  assert.equal(funnel.attended, 1, 'attended');
  assert.equal(funnel.suppressed, 1, 'suppressed');

  // Booked and attended are different numbers, and the fixture proves they are read
  // from different columns rather than one being derived from the other.
  assert.notEqual(funnel.booked, funnel.attended);
});

test('one Account contacted five times counts once at every stage', async () => {
  const rep = await makeUser('Repeat Contact Rep');
  const account = await buildAccount('Repeatedly Called Co');
  await claimAccount(account.accountId, rep);

  for (let i = 0; i < 5; i += 1) {
    await startCall(account.accountId, account.endpointId, rep.userId);
    await recordDisposition({
      accountId: account.accountId, endpointId: account.endpointId,
      disposition: i === 4 ? 'DECISION_MAKER_REACHED' : 'NO_ANSWER', notes: `attempt ${i}`,
    }, rep);
  }

  const funnel = await analyticsFunnel(emptyFilters());
  assert.equal(funnel.researched, 1);
  assert.equal(funnel.attempted, 1, 'five attempts on one Account counted as five');
  assert.equal(funnel.connected, 1);

  // The attempts themselves are all still there: the funnel counts Accounts, the
  // ledger counts calls, and neither pretends to be the other.
  const attempts = await query<{ n: number; closed: number }>(
    `select count(*)::int as n, count(completed_at)::int as closed from contact_attempts`);
  assert.equal(attempts.rows[0]!.n, 5, 'attempts were lost');
  assert.equal(attempts.rows[0]!.closed, 5, 'an attempt was left open');
});

test('an empty scope reports zero out of zero rather than a rate', async () => {
  const funnel = await analyticsFunnel(emptyFilters());
  for (const stage of ['researched', 'contactable', 'attempted', 'connected', 'qualified',
                       'booked', 'attended', 'suppressed']) {
    assert.equal(funnel[stage], 0, `${stage} on an empty database`);
  }
  // Nothing here divides, so nothing can produce NaN or Infinity.
  for (const value of Object.values(funnel)) {
    assert.equal(Number.isFinite(Number(value)), true, `a stage returned ${value}`);
  }
});

test('a date range excludes what falls outside it', async () => {
  const rep = await makeUser('Date Range Rep');
  const older = await buildAccount('Older Co');
  const newer = await buildAccount('Newer Co');
  await query(`update accounts set created_at = now() - interval '60 days' where account_id = $1`,
    [older.accountId]);
  void rep;

  const all = await analyticsFunnel(emptyFilters());
  assert.equal(all.researched, 2);

  const recent = await analyticsFunnel({
    ...emptyFilters(),
    fromDate: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
  });
  assert.equal(recent.researched, 1, 'the date filter did not exclude the older Account');
});

test('an owner filter counts one rep’s work, not the team’s', async () => {
  const first = await makeUser('Owner Filter One');
  const second = await makeUser('Owner Filter Two');
  const a = await buildAccount('Owner A Co');
  const b = await buildAccount('Owner B Co');
  const c = await buildAccount('Owner C Co');
  await claimAccount(a.accountId, first);
  await claimAccount(b.accountId, first);
  await claimAccount(c.accountId, second);

  const firstFunnel = await analyticsFunnel({ ...emptyFilters(), ownerUserId: first.userId });
  const secondFunnel = await analyticsFunnel({ ...emptyFilters(), ownerUserId: second.userId });
  assert.equal(firstFunnel.researched, 2);
  assert.equal(secondFunnel.researched, 1);
  assert.equal(firstFunnel.researched + secondFunnel.researched, 3);
});

test('a vertical filter counts one vertical', async () => {
  await buildAccount('HVAC One', 'hvac');
  await buildAccount('HVAC Two', 'hvac');
  await buildAccount('Roofing One', 'roofing');

  const hvac = await analyticsFunnel({ ...emptyFilters(), verticalProfileId: 'hvac' });
  const roofing = await analyticsFunnel({ ...emptyFilters(), verticalProfileId: 'roofing' });
  assert.equal(hvac.researched, 2);
  assert.equal(roofing.researched, 1);
});

test('the breakdowns sum to the whole, and name what they could not classify',
  async () => {
    await buildAccount('Breakdown HVAC One', 'hvac');
    await buildAccount('Breakdown HVAC Two', 'hvac');
    await buildAccount('Breakdown Roofing', 'roofing');
    await buildAccount('Breakdown Unclassified', null);

    const byVertical = await analyticsBreakdown('vertical');
    const total = byVertical.reduce((sum: number, row: any) => sum + row.accounts, 0);
    assert.equal(total, 4, 'the vertical breakdown does not account for every Account');
    const unclassified = byVertical.find((row: any) => row.label === 'Unclassified');
    assert.ok(unclassified, 'an Account with no vertical vanished from the breakdown');
    assert.equal(unclassified.accounts, 1);

    const byOwner = await analyticsBreakdown('owner');
    const ownerTotal = byOwner.reduce((sum: number, row: any) => sum + row.accounts, 0);
    assert.equal(ownerTotal, 4);
    assert.ok(byOwner.some((row: any) => row.label === 'Unclaimed'),
      'unclaimed Accounts are not shown in the owner breakdown');
  });

// --- hook experiments ------------------------------------------------------------

/** Writes n attempts for one opener with a known number of each downstream event. */
async function writeHookAttempts(input: {
  opener: string; attempts: number; humanAnswered: number; rightStakeholder: number;
  booked: number; attended: number; qualityScores?: number[];
}): Promise<void> {
  const account = await buildAccount(`Hook ${input.opener} ${sequence}`);
  for (let i = 0; i < input.attempts; i += 1) {
    const answered = i < input.humanAnswered;
    const stakeholder = i < input.rightStakeholder;
    const booked = i < input.booked;
    const attended = i < input.attended;
    const score = attended ? input.qualityScores?.[i] ?? null : null;
    await query(
      `insert into hook_attempts (account_id, opener_version, opener_frame, hook_family,
                                  agent_profile_id, prompt_version, attempted_at, connected_at,
                                  human_answered_at, right_stakeholder_at, strategy_booked_at,
                                  meeting_attended_at, michael_quality_score, quality_scored_at)
       values ($1, $2, 'observation', 'missed_call', 'yad-sales-core-v1', 'v1', now(),
               case when $3 then now() end, case when $3 then now() end,
               case when $4 then now() end, case when $5 then now() end,
               case when $6 then now() end, $7::int,
               case when $7::int is not null then now() end)`,
      [account.accountId, input.opener, answered, stakeholder, booked, attended, score]);
  }
}

test('below the attempt floor there is no leader and no ranking', async () => {
  await writeHookAttempts({ opener: 'opener.a', attempts: 6, humanAnswered: 4,
    rightStakeholder: 3, booked: 2, attended: 1 });
  await writeHookAttempts({ opener: 'opener.b', attempts: 6, humanAnswered: 2,
    rightStakeholder: 1, booked: 0, attended: 0 });

  const report = await compareHookVariants({});
  assert.equal(report.totalAttempts, 12);
  assert.equal(report.insufficientEvidence, true);
  assert.equal(report.leader, null, 'a leader was named from six attempts each');
  assert.match(report.message, /Six calls is not a result|nothing to compare/i);
  for (const variant of report.variants) {
    assert.equal(variant.insufficientEvidence, true);
    assert.match(variant.reason ?? '', new RegExp(String(MINIMUM_ATTEMPTS_FOR_COMPARISON)));
  }

  const promotion = await promotionReadiness({});
  assert.equal(promotion.ready, false);
  assert.ok(promotion.reasons.length > 0);
});

test('every rate carries its numerator and denominator', async () => {
  await writeHookAttempts({ opener: 'opener.rates', attempts: 40, humanAnswered: 20,
    rightStakeholder: 10, booked: 4, attended: 2 });

  const report = await compareHookVariants({});
  const variant = report.variants.find((v) => v.openerVersion === 'opener.rates')!;
  assert.equal(variant.attempts, 40);

  const answer = variant.rates['human_answer']!;
  assert.equal(answer.numerator, 20);
  assert.equal(answer.denominator, 40);
  assert.equal(answer.rate, 0.5);
  assert.equal(answer.lowSample, false);

  const stakeholder = variant.rates['right_stakeholder_per_human_answer']!;
  assert.equal(stakeholder.numerator, 10);
  assert.equal(stakeholder.denominator, 20, 'the denominator is human answers, not attempts');
  assert.equal(stakeholder.rate, 0.5);

  // A rate off a denominator below the floor says so rather than pretending.
  const attendance = variant.rates['attendance']!;
  assert.equal(attendance.numerator, 2);
  assert.equal(attendance.denominator, 4);
  assert.equal(attendance.lowSample, true,
    `a denominator of 4 is under the floor of ${MINIMUM_DENOMINATOR_FOR_RATE}`);
});

test('a rate off nothing is not a number', async () => {
  await writeHookAttempts({ opener: 'opener.zero', attempts: 35, humanAnswered: 0,
    rightStakeholder: 0, booked: 0, attended: 0 });

  const report = await compareHookVariants({});
  const variant = report.variants[0]!;
  const stakeholder = variant.rates['right_stakeholder_per_human_answer']!;
  assert.equal(stakeholder.denominator, 0);
  assert.equal(stakeholder.rate, null, 'a rate was computed off a zero denominator');
  assert.equal(Number.isNaN(stakeholder.rate as never), false);
});

test('a hook that books meetings nobody wanted does not win', async () => {
  // The bookings hook books twice as often; the quality hook books half as often and
  // the meetings are worth something. Ranking on bookings would pick the wrong one.
  await writeHookAttempts({ opener: 'opener.bookings', attempts: 40, humanAnswered: 30,
    rightStakeholder: 20, booked: 16, attended: 10,
    qualityScores: [1, 1, 2, 1, 2, 1, 1, 2, 1, 1] });
  await writeHookAttempts({ opener: 'opener.quality', attempts: 40, humanAnswered: 25,
    rightStakeholder: 15, booked: 8, attended: 7,
    qualityScores: [5, 4, 5, 5, 4, 5, 4] });

  const report = await compareHookVariants({});
  assert.equal(report.insufficientEvidence, false, 'forty attempts each should be comparable');
  assert.ok(report.leader, 'no leader was named from two comparable variants');
  assert.equal(report.leader!.openerVersion, 'opener.quality',
    'the hook that books more but worse was named the winner');
  assert.match(report.leader!.basis, /quality/i,
    'the leader was chosen on something other than downstream quality');
});

test('a leader is not promotable until both variants have scored meetings', async () => {
  await writeHookAttempts({ opener: 'opener.scored', attempts: 40, humanAnswered: 30,
    rightStakeholder: 20, booked: 12, attended: 8,
    qualityScores: [5, 4, 5, 4, 5, 4, 5, 4] });
  await writeHookAttempts({ opener: 'opener.unscored', attempts: 40, humanAnswered: 28,
    rightStakeholder: 18, booked: 10, attended: 2 });

  const promotion = await promotionReadiness({});
  assert.equal(promotion.ready, false, 'a variant was promotable with one scored cohort');
  assert.ok(promotion.reasons.some((reason) =>
    reason.includes(String(MINIMUM_ATTENDED_FOR_QUALITY))),
  `the reasons do not mention the quality floor: ${promotion.reasons.join(' | ')}`);
});

test('a leader ahead by less than half a point is inside the noise', async () => {
  await writeHookAttempts({ opener: 'opener.close.a', attempts: 40, humanAnswered: 30,
    rightStakeholder: 20, booked: 12, attended: 8,
    qualityScores: [4, 4, 4, 4, 4, 4, 4, 5] });
  await writeHookAttempts({ opener: 'opener.close.b', attempts: 40, humanAnswered: 30,
    rightStakeholder: 20, booked: 12, attended: 8,
    qualityScores: [4, 4, 4, 4, 4, 4, 4, 4] });

  const promotion = await promotionReadiness({});
  assert.equal(promotion.ready, false, 'a variant was promoted on a fraction of a point');
  assert.ok(promotion.reasons.some((reason) => /noise/i.test(reason)),
    `the margin was not called noise: ${promotion.reasons.join(' | ')}`);
});

test('a cohort filter narrows the comparison rather than the whole table', async () => {
  await writeHookAttempts({ opener: 'opener.cohort', attempts: 35, humanAnswered: 20,
    rightStakeholder: 10, booked: 5, attended: 3 });
  await query(`update hook_attempts set tier = 'A' where opener_version = 'opener.cohort'`);
  await writeHookAttempts({ opener: 'opener.other', attempts: 35, humanAnswered: 20,
    rightStakeholder: 10, booked: 5, attended: 3 });
  await query(`update hook_attempts set tier = 'C' where opener_version = 'opener.other'`);

  const all = await compareHookVariants({});
  assert.equal(all.totalAttempts, 70);
  const tierA = await compareHookVariants({ tier: 'A' });
  assert.equal(tierA.totalAttempts, 35);
  assert.equal(tierA.variants.length, 1);
  assert.equal(tierA.variants[0]!.openerVersion, 'opener.cohort');
});

test('a superseded attempt is excluded from the comparison', async () => {
  await writeHookAttempts({ opener: 'opener.superseded', attempts: 35, humanAnswered: 20,
    rightStakeholder: 10, booked: 5, attended: 3 });
  const before = await compareHookVariants({});
  assert.equal(before.totalAttempts, 35);

  // Five attempts are superseded by a corrected record.
  await query(
    `update hook_attempts set superseded_by = hook_attempt_id
      where hook_attempt_id in (select hook_attempt_id from hook_attempts limit 5)`);

  const after = await compareHookVariants({});
  assert.equal(after.totalAttempts, 30, 'superseded attempts were still counted');
});
