import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount, recordEvidence } from '../src/domain/accounts.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { resetDatabase, markEntityVerified } from './helpers.js';
import { deriveGapHypotheses } from '../src/domain/gapHypotheses.js';

/**
 * The opening is in the gap.
 *
 * "They run Google Ads" is not a sales conversation and neither is "they have no
 * booking page". The two together are. The risk in reading absences, though, is that
 * an absence can be about us: "no booking page" on a site the crawler could not fetch
 * says nothing about the company, and a rep sent into a call with it is armed with our
 * own failure.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function account(): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Gap Co ${sequence}`,
    website: `https://gap${sequence}.invalid`,
    phone: `904-555-${String(3000 + sequence).slice(-4)}`,
    city: 'Austin', state: 'TX', postalCode: '78701', verticalProfileId: 'plumbing',
  }, { discoverySource: 'market_miner:test' }));
  await markEntityVerified(accountId);
  return accountId;
}

/** A research run that actually read the site, which absences depend on. */
async function researchRan(accountId: string, pagesFetched = 4): Promise<void> {
  await query(
    `insert into research_runs (account_id, trigger, status, adapter_results, completed_at)
     values ($1, 'newly_discovered', 'completed',
             jsonb_build_object('pages_fetched', $2::int), now())`,
    [accountId, pagesFetched]);
}

async function evidence(accountId: string, claimKey: string): Promise<void> {
  await withTransaction((client) => recordEvidence(client, {
    accountId, category: 'technology', claimKey,
    claimText: `${claimKey} observed`, normalizedValue: 'yes',
    confidence: 'confirmed', canStateAsFact: true, sourceType: 'first_party',
    sourceReference: 'https://gap.invalid/', precedenceRank: 3,
  }));
}

test('paying for clicks with nowhere to book is an opening', async () => {
  const accountId = await account();
  await researchRan(accountId);
  await evidence(accountId, 'tech_google_ads_tag');

  const derived = await deriveGapHypotheses(accountId);
  const found = derived.find((entry) => entry.hypothesisId === 'paid_clicks_without_booking')!;
  assert.ok(found, 'the clearest opening in the product was not produced');
  assert.match(found.text, /paying for Google clicks/i);
  assert.ok(found.questions.length >= 2, 'a hypothesis with nothing to ask is not useful');
  assert.ok(found.supportingEvidenceIds.length > 0,
    'the reasoning cannot be checked without the evidence behind it');
});

test('a booking page removes the opening', async () => {
  const accountId = await account();
  await researchRan(accountId);
  await evidence(accountId, 'tech_google_ads_tag');
  await evidence(accountId, 'route_booking');

  const derived = await deriveGapHypotheses(accountId);
  assert.ok(!derived.some((entry) => entry.hypothesisId === 'paid_clicks_without_booking'),
    'a company that does let people book was told it does not');
});

test('an absence on a site we could not read is not an absence', async () => {
  const accountId = await account();
  // Research ran, and fetched nothing: blocked, moved or down.
  await researchRan(accountId, 0);
  await evidence(accountId, 'tech_google_ads_tag');

  const derived = await deriveGapHypotheses(accountId);
  assert.deepEqual(derived, [],
    'our own crawler failure was sold to a rep as a gap in the prospect’s operation');
});

test('nothing is derived before anything has been researched', async () => {
  const accountId = await account();
  await evidence(accountId, 'tech_google_ads_tag');
  assert.deepEqual(await deriveGapHypotheses(accountId), []);
});

test('emergency cover with no way in after hours is an opening', async () => {
  const accountId = await account();
  await researchRan(accountId);
  await evidence(accountId, 'emergency_24_7_service');

  const derived = await deriveGapHypotheses(accountId);
  const found = derived.find((entry) =>
    entry.hypothesisId === 'emergency_claim_without_after_hours_intake')!;
  assert.ok(found);
  assert.equal(found.storedCategory, 'after_hours');
  assert.match(found.questions.join(' '), /two in the morning/i);
});

test('a chat widget answers the after-hours question', async () => {
  const accountId = await account();
  await researchRan(accountId);
  await evidence(accountId, 'emergency_24_7_service');
  await evidence(accountId, 'tech_tidio');

  const derived = await deriveGapHypotheses(accountId);
  assert.ok(!derived.some((entry) =>
    entry.hypothesisId === 'emergency_claim_without_after_hours_intake'),
  'a company with an after-hours chat route was told it has none');
});

test('call tracking with no system behind it is an opening', async () => {
  const accountId = await account();
  await researchRan(accountId);
  await evidence(accountId, 'tech_callrail');
  const derived = await deriveGapHypotheses(accountId);
  assert.ok(derived.some((entry) =>
    entry.hypothesisId === 'call_tracking_without_followup_system'));
});

test('field-service software closes the follow-up gap', async () => {
  const accountId = await account();
  await researchRan(accountId);
  await evidence(accountId, 'tech_callrail');
  await evidence(accountId, 'tech_servicetitan');
  const derived = await deriveGapHypotheses(accountId);
  assert.ok(!derived.some((entry) =>
    entry.hypothesisId === 'call_tracking_without_followup_system'),
  'a company running ServiceTitan was told nothing picks up after the call');
});

test('expired evidence no longer supports a hypothesis', async () => {
  const accountId = await account();
  await researchRan(accountId);
  await withTransaction((client) => recordEvidence(client, {
    accountId, category: 'technology', claimKey: 'tech_google_ads_tag',
    claimText: 'Runs Google Ads tag', normalizedValue: 'yes', confidence: 'confirmed',
    canStateAsFact: true, sourceType: 'first_party',
    sourceReference: 'https://gap.invalid/',
    expiresAt: new Date(Date.now() - 86_400_000), precedenceRank: 3,
  }));
  const derived = await deriveGapHypotheses(accountId);
  assert.deepEqual(derived, [],
    'a stack read a year ago was still being sold as current');
});

test('every gap hypothesis is phrased as questions, not conclusions', async () => {
  const accountId = await account();
  await researchRan(accountId);
  for (const key of ['tech_google_ads_tag', 'emergency_24_7_service', 'tech_callrail',
    'multiple_locations', 'financing_promoted', 'route_careers', 'visible_growth_hiring']) {
    await evidence(accountId, key);
  }
  const derived = await deriveGapHypotheses(accountId);
  assert.ok(derived.length >= 4, 'the rules produced almost nothing on a rich record');
  for (const entry of derived) {
    assert.ok(entry.questions.every((question) => question.trim().endsWith('?')),
      `${entry.hypothesisId} states rather than asks`);
    assert.ok(entry.matchedSignals.length > 0,
      `${entry.hypothesisId} cannot explain why it fired`);
  }
});
