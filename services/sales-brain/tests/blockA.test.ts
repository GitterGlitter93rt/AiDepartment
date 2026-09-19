import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, markEntityVerified } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount, recordEvidence } from '../src/domain/accounts.js';
import { scoreAccount } from '../src/scoring/score.js';
import { explainScore } from '../src/scoring/explain.js';
import { advertiserEvidenceFor } from '../src/domain/advertiserEvidence.js';
import { signalFor } from '../src/domain/signalRegistry.js';
import { renderScoreLineage } from '../src/scoring/explain.js';
import { SCORE_VERSION } from '../src/scoring/model.js';
import { readinessFor } from '../src/domain/repReady.js';
import { recomputeStaleScores } from '../src/workers/researchReconcile.js';
import { latestScore } from '../src/scoring/score.js';
import { operationalSnapshot } from '../src/api/operations.js';
import { searchProspects } from '../src/domain/search.js';
import { mergeAccounts } from '../src/domain/merge.js';
import { coverageNote } from '../src/web/components.js';
import { makeUser } from './helpers.js';
import { BLOCK_A_VERTICALS, walkCase } from '../src/blockA/walk.js';

/**
 * Block A: the two defects the end-to-end walk found, and the chain it walks.
 *
 * Both defects were latent rather than live, and both were the same shape: two
 * readers of one evidence row disagreeing about what it means. That shape does not
 * show up in a unit test of either reader.
 */

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

let fixtureSeq = 0;

async function account(name: string, vertical = 'hvac'): Promise<string> {
  // A distinct number per fixture. Sharing one made identity resolution match every
  // fixture into a single Account -- correct behaviour, and it silently reduced a
  // four-Account backlog test to one.
  fixtureSeq += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name,
    website: `https://${name.replace(/\W+/g, '')}-${fixtureSeq}.invalid`,
    phone: `904-555-${String(7700 + fixtureSeq).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: vertical, contactTitle: 'Owner', contactName: 'Dana Fielder',
  }, { discoverySource: 'market_miner:dataforseo' }));
  // Stands for a candidate the resolver promoted: the only way the miner makes one.
  await markEntityVerified(accountId);
  return accountId;
}

// =============================================================================
// NOT A DEFECT: capability-gated signals are governed by the registry, not by a
// write-time refusal
// =============================================================================

test('a capability-gated signal is writable, and stays UNKNOWN until something writes it', async () => {
  // Worth pinning because the opposite was briefly implemented and it was wrong.
  // `active_meta_ad` has no producer, so the honest state today is UNKNOWN -- but the
  // scoring model has a `meta_active_ads_confirmed` rule, the profiles map to it via
  // `module4c_meta_ads_plus3`, and `advertiserEvidenceFor` reads a meta row to
  // produce NOT_OBSERVED. Refusing the write would forbid the path the architecture
  // is deliberately holding open for the Meta Ad Library integration.
  const accountId = await account('Gated Signal Co');

  const untouched = await advertiserEvidenceFor(accountId);
  assert.equal(untouched.channels.find((c) => c.channel === 'meta')!.state, 'UNKNOWN');
  assert.match(untouched.channels.find((c) => c.channel === 'meta')!.summary,
    /never checked/);

  // The write is permitted, and the reader then reports what the row says.
  await withTransaction((client) => recordEvidence(client, {
    accountId, category: 'test', claimKey: 'active_meta_ad',
    claimText: 'A Meta ad was observed.', normalizedValue: 'yes',
    confidence: 'confirmed', canStateAsFact: true, sourceType: 'first_party',
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  }));
  const written = await advertiserEvidenceFor(accountId);
  assert.equal(written.channels.find((c) => c.channel === 'meta')!.state, 'CONFIRMED');

  // What governs it instead: the registry says it has no producer, so nothing in the
  // product writes it today.
  const signal = signalFor('active_meta_ad')!;
  assert.equal(signal.producers.length, 0);
  assert.equal(signal.requiredCapability, 'META_AD_LIBRARY');
  assert.ok(!signal.states.includes('NO'),
    'a signal with no source must never be allowed to render as a negative');
});

// =============================================================================
// DEFECT A2: the scorer ignored a negative observation
// =============================================================================

test('"we looked and saw no ad" scores nothing, and reads as NOT_OBSERVED', async () => {
  const accountId = await account('Checked No Ad Co');

  // This is how NOT_OBSERVED is represented, and `advertiserEvidenceFor` has always
  // read it. The scorer did not read the column at all, so this same row qualified
  // `google_paid_search_confirmed` and awarded +4: a company we checked and found
  // *not* advertising outscored one nobody had looked at.
  await withTransaction((client) => recordEvidence(client, {
    accountId, category: 'test', claimKey: 'active_google_search_ad',
    claimText: 'The searches we ran did not surface a paid result.',
    normalizedValue: 'no', confidence: 'confirmed', canStateAsFact: true,
    sourceType: 'first_party',
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  }));
  await query(`update accounts set last_researched_at = now(),
                 research_fresh_until = now() + interval '30 days'
                where account_id = $1`, [accountId]);
  await scoreAccount(accountId);

  const advertiser = await advertiserEvidenceFor(accountId);
  assert.equal(advertiser.channels.find((c) => c.channel === 'google_search')!.state,
    'NOT_OBSERVED');

  const lineage = (await explainScore(accountId))!;
  const adRule = lineage.components.find((c) => c.ruleId === 'google_paid_search_confirmed')!;
  assert.equal(adRule.pointsAwarded, 0,
    'a confidently recorded "no" is confident about the absence, not the presence');
  assert.equal(lineage.totalPoints, 0);
  assert.equal(lineage.tier, 'D');

  // The two readers of that row now agree.
  assert.equal(
    advertiser.channels.find((c) => c.channel === 'google_search')!.state === 'NOT_OBSERVED',
    adRule.pointsAwarded === 0);
});

test('a positive observation still scores, and a non-boolean value is untouched', async () => {
  // The fix must not unqualify working rules. Several claim keys carry a category or
  // a path in normalized_value, so only explicit negatives disqualify.
  const yes = await account('Real Advertiser Co');
  await withTransaction((client) => recordEvidence(client, {
    accountId: yes, category: 'test', claimKey: 'active_google_search_ad',
    claimText: 'A paid result was observed.', normalizedValue: 'yes',
    confidence: 'confirmed', canStateAsFact: true, sourceType: 'first_party',
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  }));
  await query(`update accounts set last_researched_at = now(),
                 research_fresh_until = now() + interval '30 days'
                where account_id = $1`, [yes]);
  await scoreAccount(yes);
  const lineage = (await explainScore(yes))!;
  assert.equal(
    lineage.components.find((c) => c.ruleId === 'google_paid_search_confirmed')!.pointsAwarded,
    4);
});

// =============================================================================
// The chain itself, across the five verticals the assignment names
// =============================================================================

test('all five verticals reach a rep, and plumbing is one of them', async () => {
  // The existing downstream walk uses law-firms as its fifth vertical, so plumbing
  // -- one of the two profiles the architecture treats as proven -- had never been
  // walked end to end.
  assert.ok(BLOCK_A_VERTICALS.includes('plumbing'));

  for (const vertical of BLOCK_A_VERTICALS) {
    const walk = await walkCase(vertical, 'A_STRONG_ADVERTISER');

    assert.ok(walk.hypotheses.length > 0, `${vertical}: no hypothesis`);
    assert.ok(walk.pack, `${vertical}: no call pack`);
    assert.ok(walk.pack!.firstQuestion, `${vertical}: nothing to ask`);
    assert.ok(walk.pack!.primaryHookOrder.length > 0, `${vertical}: no hook order`);
    assert.ok(walk.lineage, `${vertical}: no canonical score`);

    // The explanation must reconstruct the stored score exactly.
    const sum = walk.lineage!.components
      .filter((c) => c.pointsAwarded > 0)
      .reduce((total, c) => total + c.pointsAwarded, 0);
    assert.equal(sum, walk.lineage!.totalPoints,
      `${vertical}: the explanation does not add up to the stored score`);

    // And no rep-facing copy may assert a signal we have no source for.
    const copy = [
      walk.pack!.firstQuestion ?? '',
      ...walk.pack!.confirmedFacts.map((f) => f.claim),
    ].join(' ').toLowerCase();
    assert.ok(!/does not advertise|no ads|not an advertiser/.test(copy),
      `${vertical}: rep copy turned an absence into a claim`);
    assert.ok(!/meta|facebook/.test(copy),
      `${vertical}: rep copy mentions a channel we have no source for`);
  }
});

test('the four cases an operator must tell apart stay apart', async () => {
  const vertical = 'hvac';
  const never = await walkCase(vertical, 'B_NEVER_RESEARCHED');
  const stale = await walkCase(vertical, 'C_STALE_RESEARCH');
  const notObserved = await walkCase(vertical, 'E_CHECKED_NOT_OBSERVED');
  const confirmed = await walkCase(vertical, 'A_STRONG_ADVERTISER');

  const state = (walk: typeof never): string =>
    walk.advertiser.channels.find((c) => c.channel === 'google_search')!.state;

  assert.equal(state(never), 'UNKNOWN');
  assert.equal(state(stale), 'STALE');
  assert.equal(state(notObserved), 'NOT_OBSERVED');
  assert.equal(state(confirmed), 'CONFIRMED');

  // Four distinct states, and only the confirmed one scores for advertising.
  assert.equal(new Set([state(never), state(stale), state(notObserved),
    state(confirmed)]).size, 4);
  assert.equal(never.lineage!.totalPoints, 0);
  assert.equal(stale.lineage!.totalPoints, 0, 'expired evidence must not score');
  assert.equal(notObserved.lineage!.totalPoints, 0);
  assert.ok(confirmed.lineage!.totalPoints >= 4);

  // Never researched is a work item; it is not a bad prospect.
  assert.equal(never.readiness!.state, 'RESEARCH_NEEDED');
  assert.notEqual(never.readiness!.state, 'NOT_WORKABLE');
});

test('a suppressed Account keeps its evidence and stays unworkable', async () => {
  const walk = await walkCase('hvac', 'F_SUPPRESSED');
  assert.equal(walk.readiness!.state, 'NOT_WORKABLE');
  assert.ok(walk.readiness!.missing.some((r) => r.key === 'not_suppressed'));
  // Scoring still ran: suppression blocks the rep, it does not erase what we know.
  assert.ok(walk.lineage, 'suppression should not prevent a score being explainable');
  assert.ok(walk.lineage!.totalPoints > 0);
});

test('a wrong number is not resurrected by rediscovery', async () => {
  const walk = await walkCase('hvac', 'G_WRONG_NUMBER');
  const { rows: before } = await query<{ display_value: string; quality_state: string }>(
    `select display_value, quality_state from contact_endpoints
      where account_id = $1 and endpoint_type = 'PHONE'`, [walk.accountId]);
  assert.equal(before.length, 1);
  assert.equal(before[0]!.quality_state, 'WRONG_NUMBER');
  const dead = before[0]!.display_value;

  // Discovery finds the company again, publishing the same number. This is the case
  // that matters: the provider has no idea the prospect told us it was wrong, so the
  // protection has to live in the upsert rather than in the provider's data.
  await withTransaction((client) => upsertAccount(client, {
    canonicalName: walk.companyName,
    website: `https://blocka-${walk.accountId.slice(0, 8)}.invalid`,
    phone: dead,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'market_miner:dataforseo' }));

  const { rows: after } = await query<{ display_value: string; quality_state: string }>(
    `select display_value, quality_state from contact_endpoints
      where account_id = $1 and endpoint_type = 'PHONE'`, [walk.accountId]);
  const rediscovered = after.find((row) => row.display_value === dead);
  assert.ok(rediscovered, 'the rediscovered number should still be on the Account');
  assert.equal(rediscovered!.quality_state, 'WRONG_NUMBER',
    'a number the prospect told us is wrong must stay dead through rediscovery');
});

test('two similar businesses are not merged for convenience', async () => {
  const walk = await walkCase('roofing', 'H_WEAK_MERGE');
  assert.ok(walk.siblingAccountId, 'the sibling was absorbed');
  assert.notEqual(walk.siblingAccountId, walk.accountId);

  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n from accounts
      where account_id in ($1, $2) and merged_into_account_id is null`,
    [walk.accountId, walk.siblingAccountId]);
  assert.equal(rows[0]!.n, '2', 'a weak name similarity destroyed a distinct business');
});

// =============================================================================
// SCORE VERSION: a v2 score must not masquerade as the current v3 opinion
// =============================================================================
//
// The v2 -> v3 bump is the first time this lifecycle has actually been exercised,
// and it exposed a narrow but real gap: the account page rendered "(SUPERSEDED)" and
// the operations page counted the stale ones, but the readiness record a rep opens
// said the company was "Scored against what we know" -- so a superseded tier read as
// the current judgement on the one surface that gates whether a rep works the record.

let legacySeq = 0;

async function v2ScoredAccount(): Promise<string> {
  // A distinct name as well as a distinct number: `upsertAccount` resolves identity
  // on the normalized name too, so reusing one name matched every fixture into a
  // single Account and quietly turned a four-Account backlog into one.
  legacySeq += 1;
  const accountId = await account(`Legacy V2 Co ${legacySeq}`);

  // Fresh research, and an advertiser observation whose v3 reading differs from its
  // v2 reading: under v2 a confidently recorded "no" qualified the paid-search rule
  // and awarded +4; under v3 it awards nothing.
  await withTransaction((client) => recordEvidence(client, {
    accountId, category: 'test', claimKey: 'active_google_search_ad',
    claimText: 'The searches we ran did not surface a paid result.',
    normalizedValue: 'no', confidence: 'confirmed', canStateAsFact: true,
    sourceType: 'first_party',
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  }));
  await query(`update accounts set last_researched_at = now(),
                 research_fresh_until = now() + interval '30 days'
                where account_id = $1`, [accountId]);

  // The state a v2 build left behind: a persisted ledger row and a projection, both
  // saying module-4c-v2, with the score v2 would have produced.
  await query(
    `insert into canonical_scores (account_id, score_version, total_points, tier, components)
     values ($1, 'module-4c-v2', 4, 'C', $2::jsonb)`,
    [accountId, JSON.stringify([{ rule_id: 'google_paid_search_confirmed',
      points_possible: 4, points_awarded: 4, evidence_ids: [], reason: 'v2 accepted it' }])]);
  await query(
    `update accounts set manual_score = 4, manual_tier = 'C',
            score_version = 'module-4c-v2' where account_id = $1`, [accountId]);
  return accountId;
}

test('a v2 score is visible as superseded before anything recomputes it', async () => {
  const accountId = await v2ScoredAccount();

  // 1. The mismatch is what makes it stale.
  const { rows: before } = await query<{ score_version: string; manual_tier: string }>(
    `select score_version, manual_tier from accounts where account_id = $1`, [accountId]);
  assert.equal(before[0]!.score_version, 'module-4c-v2');
  assert.notEqual(before[0]!.score_version, SCORE_VERSION);

  // The account page already told the truth.
  const lineage = (await explainScore(accountId))!;
  assert.equal(lineage.policyVersion, 'module-4c-v2');
  assert.equal(lineage.policyCurrent, false);
  assert.match(renderScoreLineage(lineage), /SUPERSEDED/);

  // And now so does the record a rep opens. This is the gap that was fixed: a
  // superseded score is not "scored against what we know".
  const readiness = (await readinessFor(accountId))!;
  const scored = readiness.requirements.find((r) => r.key === 'scored')!;
  assert.equal(scored.met, false,
    'a superseded score satisfied the scored requirement, so the older tier read as current');
  assert.match(scored.detail, /module-4c-v2/);
  assert.match(scored.detail, /awaiting recompute/);
  assert.equal(scored.blocking, false,
    'recompute is work the sweep does, not a wall');
  assert.notEqual(readiness.state, 'REP_READY');

  // The operations surface counts it, which it always did.
  const snapshot = await operationalSnapshot();
  assert.match(JSON.stringify(snapshot), /to recompute/,
    'the operations snapshot does not report how many scores await recompute');
});

test('the sweep reconciles v2 to v3, keeps the old row, and is idempotent', async () => {
  const accountId = await v2ScoredAccount();

  // 2. The sweep finds it by version mismatch.
  const first = await recomputeStaleScores();
  assert.ok(first.stale >= 1, 'the sweep did not see the stale score');
  assert.ok(first.recomputed >= 1, 'the sweep did not recompute it');

  // 3. No research was re-run: the evidence was already fresh, and the sweep only
  //    re-scores. `last_researched_at` is untouched by scoring.
  const { rows: research } = await query<{ n: string }>(
    `select count(*)::text as n from research_runs where account_id = $1`, [accountId]);
  assert.equal(research[0]!.n, '0',
    're-scoring must not trigger a research run when the evidence is already fresh');

  // 4 & 5. A new v3 row exists and the v2 row is still there.
  const { rows: history } = await query<{ score_version: string; total_points: number }>(
    `select score_version, total_points from canonical_scores
      where account_id = $1 order by calculated_at asc`, [accountId]);
  assert.equal(history.length, 2, 'the ledger is append-only, so both rows should exist');
  assert.equal(history[0]!.score_version, 'module-4c-v2');
  assert.equal(history[0]!.total_points, 4, 'the historical score was rewritten');
  assert.equal(history[1]!.score_version, SCORE_VERSION);
  assert.equal(history[1]!.total_points, 0,
    'v3 must not award the paid-search rule for a negative observation');

  // 6. The projection now carries the v3 answer.
  const { rows: after } = await query<{
    manual_score: number; manual_tier: string; score_version: string }>(
    `select manual_score, manual_tier, score_version from accounts
      where account_id = $1`, [accountId]);
  assert.equal(after[0]!.score_version, SCORE_VERSION);
  assert.equal(after[0]!.manual_score, 0);
  assert.equal(after[0]!.manual_tier, 'D');

  // And the rep-facing record is honest again.
  const readiness = (await readinessFor(accountId))!;
  assert.equal(readiness.requirements.find((r) => r.key === 'scored')!.met, true);

  // 7. A second sweep finds nothing to do and writes no further row.
  const second = await recomputeStaleScores();
  assert.equal(second.recomputed, 0, 'the sweep recomputed an already-current score');
  const { rows: unchanged } = await query<{ n: string }>(
    `select count(*)::text as n from canonical_scores where account_id = $1`, [accountId]);
  assert.equal(unchanged[0]!.n, '2', 'an idempotent sweep added a third score row');
});

test('the sweep is bounded and resumable, so an interrupted batch continues', async () => {
  // 8. Oldest-first and bounded: an interrupted pass leaves the rest still stale,
  //    and the next pass picks them up rather than reshuffling.
  const ids: string[] = [];
  for (let i = 0; i < 4; i += 1) ids.push(await v2ScoredAccount());

  const partial = await recomputeStaleScores({ limit: 2 });
  assert.equal(partial.recomputed, 2, 'the limit was not honoured');
  assert.ok(partial.stale >= 4, 'the stale count should report the whole backlog');

  const { rows: mid } = await query<{ n: string }>(
    `select count(*)::text as n from accounts
      where account_id = any($1::uuid[]) and score_version <> $2`, [ids, SCORE_VERSION]);
  assert.equal(mid[0]!.n, '2', 'two should remain for the next pass');

  const rest = await recomputeStaleScores();
  assert.equal(rest.recomputed, 2);
  const { rows: done } = await query<{ n: string }>(
    `select count(*)::text as n from accounts
      where account_id = any($1::uuid[]) and score_version <> $2`, [ids, SCORE_VERSION]);
  assert.equal(done[0]!.n, '0', 'the backlog did not drain');
});

test('latestScore reads the newest calculation, and the projection is the authority', async () => {
  // The semantics, stated rather than assumed: `latestScore()` is the newest
  // *calculation regardless of version*, which is correct for a history reader and
  // is why it also returns the version. `accounts.score_version` is the authority on
  // what the current answer is, and the two are written in one transaction.
  //
  // The replay case matters: a restore or an import can land an obsolete row with a
  // newer timestamp. The reader must then still be able to say the row is not
  // current rather than presenting it as the answer.
  const accountId = await v2ScoredAccount();
  await recomputeStaleScores();

  const current = (await latestScore(accountId))!;
  assert.equal(current.version, SCORE_VERSION);
  assert.equal(current.totalPoints, 0);

  // Now replay an obsolete row with a newer timestamp, as a restore would.
  await query(
    `insert into canonical_scores (account_id, score_version, total_points, tier,
                                    components, calculated_at)
     values ($1, 'module-4c-v2', 4, 'C', '[]'::jsonb, now() + interval '1 hour')`,
    [accountId]);

  const replayed = (await latestScore(accountId))!;
  assert.equal(replayed.version, 'module-4c-v2',
    'latestScore is a history reader: newest calculation, whatever version it was');
  assert.notEqual(replayed.version, SCORE_VERSION);
  assert.equal(replayed.totalPoints, 4, 'the replayed row is the v2 opinion');

  // The projection is unmoved, so the current answer is unchanged...
  const { rows } = await query<{ manual_score: number; score_version: string }>(
    `select manual_score, score_version from accounts where account_id = $1`, [accountId]);
  assert.equal(rows[0]!.score_version, SCORE_VERSION);
  assert.equal(rows[0]!.manual_score, 0);

  // ...and the explain surface, which is what a person reads, follows the projection
  // rather than the newest timestamp, so an obsolete replayed row cannot present
  // itself as the current judgement.
  const lineage = (await explainScore(accountId))!;
  assert.equal(lineage.policyCurrent, true,
    'explainScore followed a replayed obsolete row instead of the current policy');
  assert.equal(lineage.totalPoints, 0);
});

// =============================================================================
// A5: a superseded score must not behave as the current one in prospect search
// =============================================================================
//
// The surface Michael and Brent use to choose whom to call reads `manual_tier` and
// `manual_score` -- the *projection* of the newest score. After a SCORE_VERSION bump
// that projection holds the previous policy's answer until the sweep reaches the
// Account, so a superseded Tier A satisfied `minimumTier=B`, counted toward the
// total, and outranked a current Tier B. Fixed in the query semantics, not by
// filtering the page in JavaScript, so the total and the pagination still agree.

async function scoredAccount(input: {
  name: string; points: number; tier: string; version: string; zip?: string;
}): Promise<string> {
  const accountId = await account(input.name);
  await query(
    `insert into canonical_scores (account_id, score_version, total_points, tier, components)
     values ($1, $2, $3, $4, '[]'::jsonb)`,
    [accountId, input.version, input.points, input.tier]);
  await query(
    `update accounts set manual_score = $2, manual_tier = $3, score_version = $4,
            last_researched_at = now(), research_fresh_until = now() + interval '30 days'
      where account_id = $1`,
    [accountId, input.points, input.tier, input.version]);
  return accountId;
}

const VIEWER = { userId: '', role: 'SALES_MANAGER' as const };

async function viewer(): Promise<{ userId: string; role: 'SALES_MANAGER' }> {
  const user = await makeUser(`A5 Manager ${Math.random().toString(36).slice(2, 8)}`,
    'SALES_MANAGER');
  return { userId: user.userId, role: 'SALES_MANAGER' };
}

test('A5: a superseded Tier A does not satisfy a current minimumTier=B', async () => {
  const stale = await scoredAccount({
    name: 'Stale Tier A Co', points: 14, tier: 'A', version: 'module-4c-v2' });
  const current = await scoredAccount({
    name: 'Current Tier B Co', points: 7, tier: 'B', version: SCORE_VERSION });

  const who = await viewer();
  const result = await searchProspects({ minimumTier: 'B', pageSize: 50 }, who);
  const ids = result.results.map((row: any) => row.account_id);

  assert.ok(ids.includes(current), 'the current Tier B was excluded');
  assert.ok(!ids.includes(stale),
    'a superseded Tier A satisfied a filter promising a current Tier A/B result');

  // The total must agree with the rows, or pagination lies.
  assert.equal(result.total, ids.length);
  assert.equal(result.total, 1);

  // And the operator can tell why it is missing: not unscored, awaiting recompute.
  assert.equal(result.coverage.staleScoreExcluded, 1);
  assert.equal(result.coverage.unscoredExcluded, 0,
    'a stale-policy score was reported as never scored, which implies the wrong work');
});

test('A5: never-scored, current and stale-policy are three distinguishable answers', async () => {
  await scoredAccount({ name: 'Stale One', points: 14, tier: 'A', version: 'module-4c-v2' });
  await scoredAccount({ name: 'Stale Two', points: 12, tier: 'A', version: 'module-4c-v2' });
  await scoredAccount({ name: 'Current One', points: 7, tier: 'B', version: SCORE_VERSION });
  await account('Never Scored One');
  await account('Never Scored Two');
  await account('Never Scored Three');

  const who = await viewer();
  const result = await searchProspects({ minimumTier: 'B', pageSize: 50 }, who);
  assert.equal(result.total, 1);
  assert.equal(result.coverage.staleScoreExcluded, 2);
  assert.equal(result.coverage.unscoredExcluded, 3);
});

test('A5: a superseded high score does not outrank a current lower one', async () => {
  const stale = await scoredAccount({
    name: 'Stale Fourteen Co', points: 14, tier: 'A', version: 'module-4c-v2' });
  const current = await scoredAccount({
    name: 'Current Seven Co', points: 7, tier: 'B', version: SCORE_VERSION });
  const who = await viewer();

  for (const sort of ['recommended_priority', 'manual_score'] as const) {
    const result = await searchProspects({ sort, pageSize: 50 }, who);
    const ids = result.results.map((row: any) => row.account_id);
    assert.ok(ids.includes(stale) && ids.includes(current),
      `${sort}: an unfiltered list must still show both`);
    assert.ok(ids.indexOf(current) < ids.indexOf(stale),
      `${sort}: the superseded 14-point score outranked the current 7-point score`);
  }
});

test('A5: the view path behaves identically to the fast path', async () => {
  // An advertising filter forces the view path, because the column it reads is
  // derived from a lateral. A fix that only worked on the base-table fast path would
  // pass every test above and still be wrong on the page a rep actually loads with
  // an advertising filter applied.
  const stale = await scoredAccount({
    name: 'Stale Advertiser Co', points: 14, tier: 'A', version: 'module-4c-v2' });
  const current = await scoredAccount({
    name: 'Current Advertiser Co', points: 7, tier: 'B', version: SCORE_VERSION });

  for (const accountId of [stale, current]) {
    await withTransaction((client) => recordEvidence(client, {
      accountId, category: 'test', claimKey: 'active_google_search_ad',
      claimText: 'A paid result was observed.', normalizedValue: 'yes',
      confidence: 'confirmed', canStateAsFact: true, sourceType: 'first_party',
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    }));
  }

  const who = await viewer();
  const filtered = await searchProspects(
    { minimumTier: 'B', advertising: ['google_paid'], pageSize: 50 }, who);
  const ids = filtered.results.map((row: any) => row.account_id);
  assert.ok(ids.includes(current), 'view path excluded the current Tier B');
  assert.ok(!ids.includes(stale), 'view path admitted a superseded Tier A');
  assert.equal(filtered.total, ids.length, 'view path total disagrees with its rows');

  // And the sort on the view path orders by the current score too.
  const sorted = await searchProspects(
    { advertising: ['google_paid'], sort: 'manual_score', pageSize: 50 }, who);
  const sortedIds = sorted.results.map((row: any) => row.account_id);
  assert.ok(sortedIds.indexOf(current) < sortedIds.indexOf(stale),
    'view path let the superseded score outrank the current one');
});

test('A5: geography plus tier keeps the fast path and the same semantics', async () => {
  const stale = await scoredAccount({
    name: 'Stale Geo Co', points: 14, tier: 'A', version: 'module-4c-v2' });
  const current = await scoredAccount({
    name: 'Current Geo Co', points: 7, tier: 'B', version: SCORE_VERSION });
  const who = await viewer();

  const result = await searchProspects({
    minimumTier: 'B', geography: { type: 'zip_zcta', value: '32095' }, pageSize: 50,
  }, who);
  const ids = result.results.map((row: any) => row.account_id);
  assert.ok(ids.includes(current));
  assert.ok(!ids.includes(stale));
  assert.equal(result.total, ids.length);
});

test('A5: after reconciliation the Account is judged on its new score', async () => {
  // The full loop: excluded while superseded, then included or not on the merits of
  // the recomputed score rather than on the historical one.
  const accountId = await account('Reconciled Co');
  await withTransaction((client) => recordEvidence(client, {
    accountId, category: 'test', claimKey: 'active_google_search_ad',
    claimText: 'A paid result was observed.', normalizedValue: 'yes',
    confidence: 'confirmed', canStateAsFact: true, sourceType: 'first_party',
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  }));
  await query(
    `insert into canonical_scores (account_id, score_version, total_points, tier, components)
     values ($1, 'module-4c-v2', 14, 'A', '[]'::jsonb)`, [accountId]);
  await query(
    `update accounts set manual_score = 14, manual_tier = 'A',
            score_version = 'module-4c-v2', last_researched_at = now(),
            research_fresh_until = now() + interval '30 days'
      where account_id = $1`, [accountId]);

  const who = await viewer();
  const before = await searchProspects({ minimumTier: 'B', pageSize: 50 }, who);
  assert.ok(!before.results.some((row: any) => row.account_id === accountId));
  assert.equal(before.coverage.staleScoreExcluded, 1);

  await recomputeStaleScores();

  // The real evidence is one confirmed paid-search observation: 4 points, tier C.
  const { rows } = await query<{ manual_score: number; manual_tier: string; score_version: string }>(
    `select manual_score, manual_tier, score_version from accounts where account_id = $1`,
    [accountId]);
  assert.equal(rows[0]!.score_version, SCORE_VERSION);
  assert.equal(rows[0]!.manual_score, 4);
  assert.equal(rows[0]!.manual_tier, 'C');

  // Tier C does not meet minimumTier=B -- on the merits of the current score, not
  // because it is stale. And it does meet C.
  const stillB = await searchProspects({ minimumTier: 'B', pageSize: 50 }, who);
  assert.ok(!stillB.results.some((row: any) => row.account_id === accountId));
  assert.equal(stillB.coverage.staleScoreExcluded, 0,
    'nothing is awaiting recompute any more');

  const atC = await searchProspects({ minimumTier: 'C', pageSize: 50 }, who);
  assert.ok(atC.results.some((row: any) => row.account_id === accountId),
    'the recomputed Tier C should be eligible for a Tier C filter');

  // Second reconciliation writes nothing further.
  const again = await recomputeStaleScores();
  assert.equal(again.recomputed, 0);
  const { rows: history } = await query<{ n: string }>(
    `select count(*)::text as n from canonical_scores where account_id = $1`, [accountId]);
  assert.equal(history[0]!.n, '2', 'history should hold exactly the v2 and v3 rows');
});

// =============================================================================
// A5 follow-on: a merge composed a score and then claimed a policy for it
// =============================================================================

/**
 * Found by making the tier filters version-aware, not by reading the merge code.
 *
 * `mergeAccounts` keeps the better score and the better tier of the two records,
 * choosing each independently, and never touched `score_version`. So a survivor
 * scored under the current ruleset that inherited a better tier from a record scored
 * under the old one kept saying "current" over a number the current rules never
 * produced. Before A5 that was invisible -- nothing read the version -- and it is
 * exactly the case A5's filters trust: a superseded Tier A laundered into a current
 * one, which then satisfies a filter promising comparable tiers.
 *
 * A null here is the honest answer. The composite is not the output of any one
 * policy, and `recomputeStaleScores()` sweeps null -- which it should, because the
 * survivor now reads the merged record's evidence as well.
 */
test('A5: a merge that inherits a tier does not claim the policy it was not scored by',
  async () => {
  const survivor = await scoredAccount({
    name: 'Merge Survivor Current B', points: 7, tier: 'B', version: SCORE_VERSION });
  const absorbed = await scoredAccount({
    name: 'Merge Absorbed Stale A', points: 14, tier: 'A', version: 'module-4c-v2' });

  const who = await viewer();
  const merged = await mergeAccounts({
    survivingAccountId: survivor, mergedAccountId: absorbed,
    reason: 'Same company, two listings.' }, who);
  assert.equal(merged.ok, true);

  const { rows } = await query<{
    manual_tier: string; manual_score: number; score_version: string | null }>(
    `select manual_tier, manual_score, score_version from accounts where account_id = $1`,
    [survivor]);
  // The merge did take the better numbers -- that part was always right.
  assert.equal(rows[0]!.manual_tier, 'A');
  assert.equal(rows[0]!.manual_score, 14);
  // And it no longer claims the current policy produced them.
  assert.equal(rows[0]!.score_version, null,
    'the survivor kept a current version over a tier the current rules never produced');

  // Which means the filters treat it as awaiting recompute rather than as a current
  // Tier A: the whole point. It is reported, not silently dropped.
  const atA = await searchProspects({ minimumTier: 'A', pageSize: 50 }, who);
  assert.ok(!atA.results.some((row: any) => row.account_id === survivor),
    'a merge-composed tier satisfied a filter promising a current Tier A');
  assert.equal(atA.coverage.staleScoreExcluded, 1);
  assert.equal(atA.coverage.unscoredExcluded, 0,
    'a merged score was reported as never scored, which implies the wrong work');

  // And the sweep that exists for this resolves it from the survivor's real evidence.
  const swept = await recomputeStaleScores();
  assert.equal(swept.recomputed, 1);
  const { rows: after } = await query<{ score_version: string | null }>(
    `select score_version from accounts where account_id = $1`, [survivor]);
  assert.equal(after[0]!.score_version, SCORE_VERSION);
});

test('A5: a merge that changes nothing about the score leaves its lineage alone',
  async () => {
  // The other half of the rule. Nulling on every merge would send perfectly good
  // current scores back through the scorer for no reason, and would make a merge look
  // like a scoring event in the operator counts.
  const survivor = await scoredAccount({
    name: 'Merge Survivor Keeps A', points: 14, tier: 'A', version: SCORE_VERSION });
  const absorbed = await account('Merge Absorbed Unscored');

  const who = await viewer();
  const merged = await mergeAccounts({
    survivingAccountId: survivor, mergedAccountId: absorbed,
    reason: 'Same company, one was never researched.' }, who);
  assert.equal(merged.ok, true);

  const { rows } = await query<{
    manual_tier: string; manual_score: number; score_version: string | null }>(
    `select manual_tier, manual_score, score_version from accounts where account_id = $1`,
    [survivor]);
  assert.equal(rows[0]!.manual_tier, 'A');
  assert.equal(rows[0]!.manual_score, 14);
  assert.equal(rows[0]!.score_version, SCORE_VERSION,
    'an untouched score lost its lineage and will be pointlessly recomputed');

  const atA = await searchProspects({ minimumTier: 'A', pageSize: 50 }, who);
  assert.ok(atA.results.some((row: any) => row.account_id === survivor));
  assert.equal(atA.coverage.staleScoreExcluded, 0);
});

// =============================================================================
// A5 follow-on: the count an operator could not see
// =============================================================================

/**
 * `staleScoreExcluded` was computed, returned and asserted in this file, and then
 * rendered nowhere. A number that only a test can read is not operator truth: the
 * page went on saying "N companies are not shown because they have no tier yet",
 * which for a superseded score is wrong in the one direction that costs money --
 * it tells a rep to go research a company that has already been researched.
 */
test('A5: the page says a superseded score is superseded, not unresearched', async () => {
  await scoredAccount({
    name: 'Rendered Stale A Co', points: 14, tier: 'A', version: 'module-4c-v2' });
  await account('Rendered Never Scored Co');

  const who = await viewer();
  const result = await searchProspects({ minimumTier: 'B', pageSize: 50 }, who);
  assert.equal(result.coverage.staleScoreExcluded, 1);
  assert.equal(result.coverage.unscoredExcluded, 1);

  const rendered = String(coverageNote(result.coverage, true, '32095'));

  // Both sentences, because both companies are missing for different reasons.
  assert.match(rendered, /scored under an\s+older ruleset/,
    'the superseded score is not mentioned at all');
  assert.match(rendered, /no tier yet/, 'the never-researched company is not mentioned');

  // The distinction has to survive the wording: the stale sentence must not claim the
  // company is unresearched, and must say what happens next.
  const staleSentence = rendered.slice(rendered.indexOf('older ruleset'));
  assert.match(staleSentence, /not because .*not been researched/s,
    'the stale note does not rule out the reading that nobody has looked');
  assert.match(staleSentence, /re-scores/, 'the note does not say the system will fix it');

  // And the counts are not conflated into one number.
  assert.ok(!/2 companies/.test(rendered),
    'a stale score and an unscored account were added into a single count');
});

void VIEWER;
