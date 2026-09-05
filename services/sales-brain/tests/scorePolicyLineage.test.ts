import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { scoreAccount } from '../src/scoring/score.js';
import { explainScore, renderScoreLineage } from '../src/scoring/explain.js';
import {
  SCORE_VERSION, scoringRulesFingerprint, scoreFromSignals, tierFor, MAX_POINTS,
  SCORE_RULES, type ScoreSignals, type ScoreRuleId,
} from '../src/scoring/model.js';
import { recomputeStaleScores } from '../src/workers/researchReconcile.js';
import { operationalSnapshot } from '../src/api/operations.js';
import { resetDatabase } from './helpers.js';

/**
 * A score you can trust tomorrow, and explain today.
 * Authority: Issue #3 BQ, BR, BS, BW.
 *
 * The four recognizers that landed changed what the same evidence is worth: an HVAC
 * advertiser that scored eight now scores fourteen. Every score written before that
 * was produced under rules that no longer exist, and looked exactly like a current
 * one. A rep comparing two prospects would have been comparing two policies.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function account(): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Lineage Co ${sequence}`,
    website: `https://lineage${sequence}.invalid`,
    phone: `904-555-${String(3100 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'market_miner:dataforseo' }));
  return accountId;
}

async function evidence(accountId: string, claimKey: string, options: {
  text?: string; provider?: string; reference?: string;
} = {}): Promise<void> {
  await query(
    `insert into evidence_records
       (account_id, category, claim_key, claim_text, normalized_value, confidence,
        can_state_as_fact, source_type, source_provider, source_reference,
        expires_at, freshness)
     values ($1, 'paid_acquisition', $2, $3, 'yes', 'confirmed', true, 'provider_serp',
             $4, $5, now() + interval '48 hours', 'fresh')`,
    [accountId, claimKey, options.text ?? `${claimKey} observed`,
     options.provider ?? 'dataforseo', options.reference ?? 'https://serp.example/check'],
  );
}

// --------------------------------------------------------------- BQ: versioning --

test('a score records the ruleset that produced it', async () => {
  const accountId = await account();
  await evidence(accountId, 'active_google_search_ad');
  await scoreAccount(accountId);

  const { rows } = await query<{ score_version: string; manual_score: number }>(
    `select c.score_version, a.manual_score from canonical_scores c
       join accounts a on a.account_id = c.account_id where c.account_id = $1`, [accountId]);
  assert.equal(rows[0]!.score_version, SCORE_VERSION);

  const projection = await query<{ score_version: string }>(
    'select score_version from accounts where account_id = $1', [accountId]);
  assert.equal(projection.rows[0]!.score_version, SCORE_VERSION,
    'the projection the search reads does not say which policy produced it');
});

test('changing the rules without bumping the version fails here', () => {
  // The fingerprint covers rule ids and point values -- the things that make two
  // scores incomparable. Editing SCORE_RULES without bumping SCORE_VERSION means
  // yesterday's eight and today's eight look the same and are not.
  assert.equal(
    scoringRulesFingerprint(),
    'appointment_estimate_consultation_intake_heavy:1|emergency_after_hours:1|'
    + 'google_paid_search_confirmed:4|high_value_economics_signal:2|'
    + 'meta_active_ads_confirmed:3|multiple_locations_or_service_territories:1|'
    + 'multiple_paid_channels_confirmed:1|operationally_important_lead_volume_signal:2|'
    + 'prominent_forms_booking_quote_consultation_cta:1|strong_phone_dependence:1|'
    + 'visible_growth_hiring:1',
    'the scoring rules changed: bump SCORE_VERSION and update this fingerprint, so '
    + 'scores produced under the old rules are recomputed rather than silently '
    + 'compared against new ones');
  assert.equal(SCORE_VERSION, 'module-4c-v2');
});

test('a score from an older policy is visible as older, not as current', async () => {
  const accountId = await account();
  await evidence(accountId, 'active_google_search_ad');
  await scoreAccount(accountId);
  await query(
    `update canonical_scores set score_version = 'module-4c-v1' where account_id = $1`,
    [accountId]);

  const lineage = await explainScore(accountId);
  assert.equal(lineage!.policyCurrent, false);
  assert.match(renderScoreLineage(lineage!), /SUPERSEDED/);
});

// ------------------------------------------------------------- BR: recompute -----

test('scores from an older ruleset are recomputed on the sweep', async () => {
  const accountId = await account();
  await evidence(accountId, 'active_google_search_ad');
  await scoreAccount(accountId);
  await query(
    `update accounts set score_version = 'module-4c-v1' where account_id = $1`, [accountId]);

  const first = await recomputeStaleScores();
  assert.equal(first.stale, 1);
  assert.equal(first.recomputed, 1);

  const { rows } = await query<{ score_version: string }>(
    'select score_version from accounts where account_id = $1', [accountId]);
  assert.equal(rows[0]!.score_version, SCORE_VERSION);
});

test('the recompute is idempotent: a second pass has nothing to do', async () => {
  const accountId = await account();
  await evidence(accountId, 'active_google_search_ad');
  await scoreAccount(accountId);
  await query(`update accounts set score_version = 'old' where account_id = $1`, [accountId]);

  await recomputeStaleScores();
  const second = await recomputeStaleScores();
  assert.equal(second.stale, 0);
  assert.equal(second.recomputed, 0);
});

test('a recompute killed halfway resumes rather than restarting', async () => {
  const ids: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const accountId = await account();
    await evidence(accountId, 'active_google_search_ad');
    await scoreAccount(accountId);
    ids.push(accountId);
  }
  await query(`update accounts set score_version = 'old'`);

  // A worker that dies after two.
  const partial = await recomputeStaleScores({ limit: 2 });
  assert.equal(partial.recomputed, 2);
  assert.equal(partial.stale, 6);

  // Restarted: it finds the four that are left, not all six again.
  const resumed = await recomputeStaleScores({ limit: 10 });
  assert.equal(resumed.stale, 4, 'the sweep re-did work it had already done');
  assert.equal(resumed.recomputed, 4);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from accounts where score_version <> $1`, [SCORE_VERSION]);
  assert.equal(rows[0]!.n, 0);
});

test('a merge tombstone is not recomputed', async () => {
  const survivor = await account();
  const tombstone = await account();
  await scoreAccount(survivor);
  await scoreAccount(tombstone);
  await query(`update accounts set score_version = 'old'`);
  await query('update accounts set merged_into_account_id = $2 where account_id = $1',
    [tombstone, survivor]);

  const result = await recomputeStaleScores();
  assert.equal(result.stale, 1, 'a redirect was queued for rescoring');
});

test('an unscored Account is the research sweep\'s problem, not this one\'s', async () => {
  await account();
  const result = await recomputeStaleScores();
  assert.equal(result.stale, 0);
});

test('the operations panel says how many scores are from an older ruleset', async () => {
  const accountId = await account();
  await scoreAccount(accountId);
  await query(`update accounts set score_version = 'old' where account_id = $1`, [accountId]);

  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'score_policy')!;
  assert.match(check.value, /1 to recompute/);
  assert.match(check.detail ?? '', /comparing two of them compares two different rulesets/);
});

// ------------------------------------------------------------- BW: lineage -------

test('the answer to "why is this guy Tier A" is reasons with evidence', async () => {
  const accountId = await account();
  await evidence(accountId, 'active_google_search_ad', {
    text: 'AC repair ad, top of page', provider: 'dataforseo',
    reference: 'https://serp.example/check/32095' });
  await evidence(accountId, 'active_meta_ad', { text: 'Meta ad library entry' });
  await evidence(accountId, 'emergency_24_7_service', { text: '24/7 emergency service' });
  await scoreAccount(accountId);

  const lineage = await explainScore(accountId);
  assert.ok(lineage);
  assert.equal(lineage!.policyVersion, SCORE_VERSION);
  assert.equal(lineage!.policyCurrent, true);

  const google = lineage!.components.find((c) => c.ruleId === 'google_paid_search_confirmed')!;
  assert.equal(google.pointsAwarded, 4);
  assert.equal(google.evidence.length, 1);
  assert.equal(google.evidence[0]!.sourceProvider, 'dataforseo');
  assert.equal(google.evidence[0]!.sourceReference, 'https://serp.example/check/32095');
  assert.equal(google.evidence[0]!.current, true);
  assert.match(google.evidence[0]!.claimText ?? '', /top of page/);

  const rendered = renderScoreLineage(lineage!);
  assert.match(rendered, /\+4/);
  assert.match(rendered, /dataforseo/);
  assert.match(rendered, /Not earned:/,
    'a rep needs to know what is missing as well as what counted');
});

test('the lineage says why a rule did not fire, with no evidence to show', async () => {
  const accountId = await account();
  await scoreAccount(accountId);

  const lineage = await explainScore(accountId);
  const google = lineage!.components.find((c) => c.ruleId === 'google_paid_search_confirmed')!;
  assert.equal(google.qualified, false);
  assert.equal(google.evidence.length, 0);
  assert.match(google.reason, /recorded yet/);
});

test('an Account with no score explains nothing rather than inventing one', async () => {
  assert.equal(await explainScore(await account()), null);
});

// --------------------------------------------------------- BS: score properties --

test('adding positive evidence never lowers a score', async () => {
  const claims = ['active_google_search_ad', 'active_meta_ad', 'emergency_24_7_service',
    'online_quote_booking', 'multiple_locations', 'visible_growth_hiring'];
  const accountId = await account();

  let previous = (await scoreAccount(accountId)).totalPoints;
  for (const claim of claims) {
    await evidence(accountId, claim);
    const next = (await scoreAccount(accountId)).totalPoints;
    assert.ok(next >= previous, `adding ${claim} took the score from ${previous} to ${next}`);
    previous = next;
  }
});

test('removing positive evidence never raises a score', async () => {
  const accountId = await account();
  await evidence(accountId, 'active_google_search_ad');
  await evidence(accountId, 'active_meta_ad');
  const before = (await scoreAccount(accountId)).totalPoints;

  await query(
    `delete from evidence_records where account_id = $1 and claim_key = 'active_meta_ad'`,
    [accountId]);
  const after = (await scoreAccount(accountId)).totalPoints;
  assert.ok(after <= before, `removing evidence took the score from ${before} to ${after}`);
});

test('the score is always inside its documented bounds', () => {
  const everything: ScoreSignals = {};
  for (const rule of SCORE_RULES) if (!rule.derived) everything[rule.id] = true;

  for (const signals of [{}, everything, { google_paid_search_confirmed: true } as ScoreSignals]) {
    const result = scoreFromSignals(signals);
    assert.ok(result.totalPoints >= 0 && result.totalPoints <= MAX_POINTS,
      `${result.totalPoints} is outside 0..${MAX_POINTS}`);
    assert.equal(result.tier, tierFor(result.totalPoints),
      'the tier and the points disagree');
  }
});

test('the tier boundaries hold either side of every threshold', () => {
  for (const [threshold, below, at] of [[9, 'B', 'A'], [6, 'C', 'B'], [3, 'D', 'C']] as const) {
    assert.equal(tierFor(threshold - 1), below, `${threshold - 1} points`);
    assert.equal(tierFor(threshold), at, `${threshold} points`);
    assert.equal(tierFor(threshold + 1), at, `${threshold + 1} points`);
  }
});

test('a rule can never award more than it is worth, whatever is asserted', () => {
  const everything: ScoreSignals = {};
  for (const rule of SCORE_RULES) {
    everything[rule.id] = { qualified: true, evidenceIds: ['a', 'b', 'c', 'd'] };
  }
  const result = scoreFromSignals(everything);
  for (const component of result.components) {
    const rule = SCORE_RULES.find((entry) => entry.id === component.ruleId)!;
    assert.equal(component.pointsAwarded, rule.points, component.ruleId);
  }
  assert.equal(result.totalPoints, MAX_POINTS);
});
