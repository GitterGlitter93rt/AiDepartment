import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount, recordEvidence } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import { scoreAccount, latestScore } from '../src/scoring/score.js';
import { recognizeSignals, signalRulesFor } from '../src/scoring/recognize.js';
import { searchProspects, coverageFor } from '../src/domain/search.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Discovery through to a tier a rep can filter on.
 * Authority: Issue #3 Phases J and J2.
 *
 * Scoring was fully specified -- a points policy, a vertical signal mapping, a
 * fixture corpus -- and entirely unimplemented. Nothing in the runtime wrote
 * manual_score or manual_tier except the seed script, the demo fixture, the
 * synthetic generator and a release drill. So every company the miner has ever
 * discovered had no tier, and "Tier B and better" silently excluded all of them.
 */

let manager: Awaited<ReturnType<typeof makeUser>>;
let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  manager = await makeUser('Scoring Manager', 'SALES_MANAGER');
});

async function account(name: string, options: { vertical?: string } = {}): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name,
    website: `https://score${sequence}.invalid`,
    phone: `904-555-${String(6000 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: options.vertical ?? 'hvac',
  }, { discoverySource: 'market_miner:dataforseo' }));
  return accountId;
}

/** Evidence exactly as research would leave it. */
async function evidence(accountId: string, claimKey: string, options: {
  confirmed?: boolean; expiresInHours?: number; contradicted?: boolean;
} = {}): Promise<string> {
  const { rows } = await query<{ evidence_id: string }>(
    `insert into evidence_records
       (account_id, category, claim_key, claim_text, confidence, can_state_as_fact,
        source_type, expires_at, freshness)
     values ($1, 'paid_acquisition', $2, $3, $4, $5, 'public_web',
             now() + ($6 || ' hours')::interval, 'fresh')
     returning evidence_id`,
    [
      accountId, claimKey, `${claimKey} observed`,
      options.confirmed === false ? 'likely' : 'confirmed',
      options.confirmed !== false,
      String(options.expiresInHours ?? 48),
    ],
  );
  const evidenceId = rows[0]!.evidence_id;
  if (options.contradicted) {
    const other = await query<{ evidence_id: string }>(
      `insert into evidence_records
         (account_id, category, claim_key, claim_text, confidence, can_state_as_fact,
          source_type, freshness)
       values ($1, 'paid_acquisition', $2, 'contradicting observation', 'confirmed', true,
               'public_web', 'fresh')
       returning evidence_id`, [accountId, claimKey]);
    await query('update evidence_records set contradicted_by_evidence_id = $2 where evidence_id = $1',
      [evidenceId, other.rows[0]!.evidence_id]);
    await query('update evidence_records set contradicted_by_evidence_id = $2 where evidence_id = $1',
      [other.rows[0]!.evidence_id, evidenceId]);
  }
  return evidenceId;
}

// ------------------------------------------------- the mapping nothing read --

test('a vertical profile supplies the evidence-to-score mapping', async () => {
  const rules = await signalRulesFor('hvac');
  assert.ok(rules.length >= 4, `only ${rules.length} scoring signals from the hvac profile`);
  const keys = rules.map((rule) => rule.claimKey);
  assert.ok(keys.includes('active_google_search_ad'));
  assert.ok(keys.includes('active_meta_ad'));

  const google = rules.find((rule) => rule.claimKey === 'active_google_search_ad')!;
  assert.equal(google.ruleId, 'google_paid_search_confirmed');
});

test('a vertical with no profile scores nothing rather than failing', async () => {
  const accountId = await account('No Profile Co', { vertical: undefined });
  await query('update accounts set primary_vertical_profile_id = null where account_id = $1',
    [accountId]);
  const result = await scoreAccount(accountId);
  assert.equal(result.totalPoints, 0);
  assert.equal(result.tier, 'D');
  assert.equal(result.unsupported, true);
});

// ---------------------------------------------------------- evidence to tier --

test('confirmed current ad evidence scores, and says which evidence did it', async () => {
  const accountId = await account('Advertiser HVAC');
  const evidenceId = await evidence(accountId, 'active_google_search_ad');

  const result = await scoreAccount(accountId);
  assert.equal(result.totalPoints, 4);
  assert.equal(result.tier, 'C');

  const google = result.components.find((c) => c.ruleId === 'google_paid_search_confirmed')!;
  assert.equal(google.qualified, true);
  assert.deepEqual(google.evidenceIds, [evidenceId],
    'a rep asking why cannot be shown a number with no working');
});

test('two channels earn the bonus; two surfaces of one channel do not', async () => {
  const both = await account('Two Channel HVAC');
  await evidence(both, 'active_google_search_ad');
  await evidence(both, 'active_meta_ad');
  const multi = await scoreAccount(both);
  assert.equal(multi.totalPoints, 4 + 3 + 1);
  // Eight points is Tier B. Both paid channels confirmed is a strong start and not,
  // on its own, an A: the bands want evidence of the business behind the spend too.
  assert.equal(multi.tier, 'B');

  const googleOnly = await account('One Channel HVAC');
  await evidence(googleOnly, 'active_google_search_ad');
  await evidence(googleOnly, 'active_local_service_ad');
  const single = await scoreAccount(googleOnly);
  assert.equal(single.components.find(
    (c) => c.ruleId === 'multiple_paid_channels_confirmed')!.qualified, false,
    'Google search and Google Local Services is still one channel');
});

test('evidence that aged out stops scoring and says so, without claiming the opposite',
  async () => {
    const accountId = await account('Stale Advertiser HVAC');
    await evidence(accountId, 'active_google_search_ad', { expiresInHours: -1 });

    const result = await scoreAccount(accountId);
    assert.equal(result.totalPoints, 0);
    const google = result.components.find((c) => c.ruleId === 'google_paid_search_confirmed')!;
    assert.equal(google.qualified, false);
    assert.match(google.reason, /aged out/);
    assert.ok(!/does not advertise|no ads/i.test(google.reason),
      'an expired observation became a claim that the company does not advertise');
  });

test('contradicted evidence stops scoring and is not silently deleted', async () => {
  const accountId = await account('Contradicted HVAC');
  await evidence(accountId, 'active_google_search_ad', { contradicted: true });

  const result = await scoreAccount(accountId);
  assert.equal(result.totalPoints, 0);
  assert.match(
    result.components.find((c) => c.ruleId === 'google_paid_search_confirmed')!.reason,
    /contradicted/);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from evidence_records where account_id = $1`, [accountId]);
  assert.ok(rows[0]!.n >= 2, 'historical evidence is preserved when contradicted');
});

test('evidence below the confidence a rule requires does not score', async () => {
  const accountId = await account('Maybe Advertiser HVAC');
  await evidence(accountId, 'active_google_search_ad', { confirmed: false });

  const result = await scoreAccount(accountId);
  assert.equal(result.totalPoints, 0);
  assert.match(
    result.components.find((c) => c.ruleId === 'google_paid_search_confirmed')!.reason,
    /not to the confidence/);
});

test('an Account with nothing known scores zero and is never punished for it', async () => {
  const accountId = await account('Sparse HVAC');
  const result = await scoreAccount(accountId);

  assert.equal(result.totalPoints, 0);
  assert.equal(result.tier, 'D');
  assert.ok(result.components.every((component) => component.pointsAwarded === 0));
  assert.ok(result.components.every((component) => component.pointsAwarded >= 0),
    'unknown became a penalty rather than an absence');
});

test('the same evidence scores the same on every run', async () => {
  const accountId = await account('Deterministic HVAC');
  await evidence(accountId, 'active_google_search_ad');
  await evidence(accountId, 'emergency_24_7_service');

  const first = await scoreAccount(accountId);
  const second = await scoreAccount(accountId);
  assert.equal(first.totalPoints, second.totalPoints);
  assert.equal(first.tier, second.tier);
  assert.deepEqual(
    first.components.map((c) => [c.ruleId, c.pointsAwarded]),
    second.components.map((c) => [c.ruleId, c.pointsAwarded]));
});

// ------------------------------------------------------------- what is stored --

test('the score is stored with its working, and the projection agrees with it', async () => {
  const accountId = await account('Stored HVAC');
  await evidence(accountId, 'active_google_search_ad');
  const result = await scoreAccount(accountId);

  const stored = await latestScore(accountId);
  assert.ok(stored);
  assert.equal(stored!.totalPoints, result.totalPoints);
  assert.equal(stored!.tier, result.tier);
  assert.equal(stored!.components.length, result.components.length);
  assert.ok(stored!.components.every((component) => typeof component.reason === 'string'));

  const { rows } = await query<{ manual_score: number; manual_tier: string }>(
    'select manual_score, manual_tier from accounts where account_id = $1', [accountId]);
  assert.equal(rows[0]!.manual_score, result.totalPoints,
    'the ledger and the projection the search reads disagree');
  assert.equal(rows[0]!.manual_tier, result.tier);
});

test('re-scoring keeps the history rather than overwriting it', async () => {
  const accountId = await account('History HVAC');
  await scoreAccount(accountId);
  await evidence(accountId, 'active_google_search_ad');
  await scoreAccount(accountId);

  const { rows } = await query<{ total_points: number }>(
    'select total_points from canonical_scores where account_id = $1 order by calculated_at',
    [accountId]);
  assert.equal(rows.length, 2, 'a score was overwritten instead of appended');
  assert.equal(rows[0]!.total_points, 0);
  assert.equal(rows[1]!.total_points, 4);
});

// ----------------------------------------------------- compliance and ranking --

test('a suppressed Account may be scored and stays suppressed', async () => {
  const accountId = await account('Suppressed HVAC');
  const rep = { userId: manager.userId, role: 'SALES_MANAGER' as const, activeClaimTarget: null };
  await claimAccount(accountId, rep, null);
  await recordDisposition({
    accountId, disposition: 'DO_NOT_CONTACT', notes: 'Asked never to be called again',
    channel: 'phone' }, rep);

  await evidence(accountId, 'active_google_search_ad');
  const result = await scoreAccount(accountId);
  assert.equal(result.totalPoints, 4, 'compliance state must not change the fit score');

  const { rows } = await query<{ is_suppressed: boolean }>(
    'select is_suppressed from accounts where account_id = $1', [accountId]);
  assert.equal(rows[0]!.is_suppressed, true, 'scoring lifted a do-not-contact');

  // And it still never appears as cold inventory.
  const found = await searchProspects({ pageSize: 50 }, manager);
  assert.ok(!found.results.some((row: any) => row.account_id === accountId));
});

test('a tier filter that hides unscored companies says how many and why', async () => {
  // The defect: manual_tier is null for everything the miner discovers, and
  // `manual_tier = any(...)` drops nulls. A rep filtering Tier B+ saw an empty
  // market with no way to learn the companies were there and simply unresearched.
  const scored = await account('Scored HVAC');
  await evidence(scored, 'active_google_search_ad');
  await evidence(scored, 'active_meta_ad');
  await scoreAccount(scored);
  await account('Unscored HVAC One');
  await account('Unscored HVAC Two');

  const filtered = await searchProspects(
    { minimumTier: 'B', geography: { type: 'zip_zcta', value: '32095' }, pageSize: 50 },
    manager);
  assert.equal(filtered.results.length, 1, 'the tier filter stopped filtering');

  const coverage = await coverageFor({
    minimumTier: 'B', geography: { type: 'zip_zcta', value: '32095' } });
  assert.equal(coverage.unscoredExcluded, 2,
    'the rep is not told the other companies exist');
});

test('no tier filter means unscored companies are still visible', async () => {
  await account('Unscored But Visible HVAC');
  const all = await searchProspects(
    { geography: { type: 'zip_zcta', value: '32095' }, pageSize: 50 }, manager);
  assert.equal(all.results.length, 1);

  const coverage = await coverageFor({ geography: { type: 'zip_zcta', value: '32095' } });
  assert.equal(coverage.unscoredExcluded, 0, 'nothing is hidden when nothing is filtered');
});
