import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { advertiserEvidenceFor, unknownAdvertiserCount } from '../src/domain/advertiserEvidence.js';
import { searchProspects, coverageFor } from '../src/domain/search.js';
import { scoreAccount } from '../src/scoring/score.js';
import { scoreResearchedButUnscored } from '../src/workers/researchReconcile.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Whether a company is spending money, and how sure we are.
 * Authority: Issue #3 Phase K.
 *
 * The product prioritises businesses already buying customers, so this signal
 * decides which prospects a rep sees first. That makes "we looked and there was no
 * ad" and "we have never looked" a commercial difference, not a philosophical one --
 * and the projection collapsed both into a null that `coalesce(google_paid, false)`
 * rendered as "not an advertiser".
 */

let manager: Awaited<ReturnType<typeof makeUser>>;
let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  manager = await makeUser('Advertiser Manager', 'SALES_MANAGER');
});

async function account(name: string): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name,
    website: `https://ads${sequence}.invalid`,
    phone: `904-555-${String(7000 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'market_miner:dataforseo' }));
  return accountId;
}

async function adEvidence(accountId: string, claimKey: string, options: {
  value: 'yes' | 'no'; expiresInHours?: number; provider?: string;
}): Promise<void> {
  await query(
    `insert into evidence_records
       (account_id, category, claim_key, claim_text, normalized_value, confidence,
        can_state_as_fact, source_type, source_provider, expires_at, freshness)
     values ($1, 'paid_acquisition', $2, $3, $4, 'confirmed', true, 'provider_serp', $5,
             now() + ($6 || ' hours')::interval, 'fresh')`,
    [
      accountId, claimKey, `${claimKey} = ${options.value}`, options.value,
      options.provider ?? 'dataforseo', String(options.expiresInHours ?? 48),
    ],
  );
}

test('a confirmed ad reads as confirmed, with when and who saw it', async () => {
  const accountId = await account('Confirmed Advertiser');
  await adEvidence(accountId, 'active_google_search_ad', { value: 'yes' });

  const evidence = await advertiserEvidenceFor(accountId);
  const google = evidence.channels.find((c) => c.channel === 'google_search')!;
  assert.equal(google.state, 'CONFIRMED');
  assert.equal(google.provider, 'dataforseo');
  assert.ok(google.observedAt instanceof Date);
  assert.equal(evidence.confirmedChannels, 1);
  assert.equal(evidence.neverChecked, false);
});

test('never looked is UNKNOWN, not "does not advertise"', async () => {
  const accountId = await account('Never Checked Co');
  const evidence = await advertiserEvidenceFor(accountId);

  assert.equal(evidence.neverChecked, true);
  for (const channel of evidence.channels) {
    assert.equal(channel.state, 'UNKNOWN');
    assert.match(channel.summary, /never checked/);
    assert.ok(!/does not advertise|not an advertiser|no ads/i.test(channel.summary),
      `"${channel.summary}" turned an absence of looking into a fact about the company`);
  }
});

test('looked and saw nothing is NOT_OBSERVED, and says what it is about', async () => {
  const accountId = await account('Checked No Ad Co');
  await adEvidence(accountId, 'active_google_search_ad', { value: 'no' });

  const evidence = await advertiserEvidenceFor(accountId);
  const google = evidence.channels.find((c) => c.channel === 'google_search')!;
  assert.equal(google.state, 'NOT_OBSERVED');
  // The sentence is about the searches we ran, not about the company. It may use
  // the phrase "does not advertise" only to deny it, never to assert it.
  assert.match(google.summary, /about those searches/);
  assert.match(google.summary, /not proof/);
  assert.ok(!/^[^.]*\bdoes not advertise/i.test(google.summary),
    'the summary leads with a claim about the company rather than about the observation');

  // And it is a different state from never having looked.
  const other = await account('Unchecked Co');
  const unchecked = await advertiserEvidenceFor(other);
  assert.notEqual(
    unchecked.channels.find((c) => c.channel === 'google_search')!.state, google.state);
});

test('an ad that aged out is STALE, not absent and not current', async () => {
  const accountId = await account('Stale Advertiser');
  await adEvidence(accountId, 'active_google_search_ad', { value: 'yes', expiresInHours: -1 });

  const evidence = await advertiserEvidenceFor(accountId);
  const google = evidence.channels.find((c) => c.channel === 'google_search')!;
  assert.equal(google.state, 'STALE');
  assert.match(google.summary, /aged out/);
  assert.equal(evidence.confirmedChannels, 0, 'stale evidence must not read as current');
  assert.notEqual(google.state, 'UNKNOWN', 'an expired sighting is not the same as never looking');
});

test('every observation is kept, not overwritten into one boolean', async () => {
  const accountId = await account('Repeatedly Observed Co');
  await adEvidence(accountId, 'active_google_search_ad', { value: 'yes' });
  await adEvidence(accountId, 'active_google_search_ad', { value: 'yes' });
  await adEvidence(accountId, 'active_google_search_ad', { value: 'yes', expiresInHours: -1 });

  const evidence = await advertiserEvidenceFor(accountId);
  const google = evidence.channels.find((c) => c.channel === 'google_search')!;
  assert.equal(google.state, 'CONFIRMED');
  assert.equal(google.observationCount, 3,
    'the history of what we saw and when was flattened away');
});

test('each channel is judged on its own evidence', async () => {
  const accountId = await account('Google Only Co');
  await adEvidence(accountId, 'active_google_search_ad', { value: 'yes' });
  await adEvidence(accountId, 'active_meta_ad', { value: 'no' });

  const evidence = await advertiserEvidenceFor(accountId);
  assert.equal(evidence.channels.find((c) => c.channel === 'google_search')!.state, 'CONFIRMED');
  assert.equal(evidence.channels.find((c) => c.channel === 'meta')!.state, 'NOT_OBSERVED');
  assert.equal(evidence.channels.find((c) => c.channel === 'google_lsa')!.state, 'UNKNOWN',
    'a channel nobody checked is not answered by another channel');
  assert.equal(evidence.confirmedChannels, 1);
});

test('advertiser-first prioritises, it does not delete', async () => {
  const advertiser = await account('Paying Co');
  await adEvidence(advertiser, 'active_google_search_ad', { value: 'yes' });
  await account('Not Paying Co');
  await account('Unchecked Co Two');

  // With no advertising filter, everybody is still inventory.
  const all = await searchProspects(
    { geography: { type: 'zip_zcta', value: '32095' }, pageSize: 50 }, manager);
  assert.equal(all.results.length, 3,
    'a company without confirmed ad evidence is still a business in the market');

  // Sorting by advertiser strength ranks, it does not exclude.
  const ranked = await searchProspects(
    { geography: { type: 'zip_zcta', value: '32095' }, sort: 'advertiser_strength', pageSize: 50 },
    manager);
  assert.equal(ranked.results.length, 3);
});

test('an advertising filter says how many companies nobody has checked', async () => {
  const advertiser = await account('Filtered Advertiser');
  await adEvidence(advertiser, 'active_google_search_ad', { value: 'yes' });
  await account('Never Checked One');
  await account('Never Checked Two');

  assert.equal(await unknownAdvertiserCount({
    geography: { type: 'zip_zcta', value: '32095' } }), 2);

  const filtered = await searchProspects({
    geography: { type: 'zip_zcta', value: '32095' },
    advertising: ['google_paid'], pageSize: 50,
  }, manager);
  assert.equal(filtered.results.length, 1, 'the advertising filter stopped filtering');

  const coverage = await coverageFor({
    geography: { type: 'zip_zcta', value: '32095' }, advertising: ['google_paid'] });
  assert.equal(coverage.unknownAdvertiserExcluded, 2,
    'the rep cannot tell an empty market from an unchecked one');
});

test('a company that was checked and had no ad is not counted as unchecked', async () => {
  const checked = await account('Checked Co');
  await adEvidence(checked, 'active_google_search_ad', { value: 'no' });
  await account('Truly Unchecked Co');

  assert.equal(await unknownAdvertiserCount({
    geography: { type: 'zip_zcta', value: '32095' } }), 1,
    'looking and finding nothing was counted as never having looked');
});

test('no advertising filter means nothing is reported as hidden', async () => {
  await account('Anybody');
  const coverage = await coverageFor({ geography: { type: 'zip_zcta', value: '32095' } });
  assert.equal(coverage.unknownAdvertiserExcluded, 0);
});

// -------------------------------------------------- the score that never ran --

test('an Account researched before scoring existed is scored by the sweep', async () => {
  // Scoring runs at the end of a research run. Every Account researched before that
  // existed has evidence and no tier, and a tier filter hides an Account with no
  // tier -- so without a back-fill they stay invisible for ever.
  const accountId = await account('Researched Long Ago');
  await adEvidence(accountId, 'active_google_search_ad', { value: 'yes' });
  await query(
    `insert into research_runs (account_id, trigger, status, completed_at)
     values ($1, 'newly_discovered', 'completed', now())`, [accountId]);

  const before = await query<{ manual_tier: string | null }>(
    'select manual_tier from accounts where account_id = $1', [accountId]);
  assert.equal(before.rows[0]!.manual_tier, null);

  const scored = await scoreResearchedButUnscored();
  assert.equal(scored, 1);

  const after = await query<{ manual_tier: string; manual_score: number }>(
    'select manual_tier, manual_score from accounts where account_id = $1', [accountId]);
  assert.equal(after.rows[0]!.manual_score, 4);
  assert.equal(after.rows[0]!.manual_tier, 'C');
});

test('the back-fill does not re-score an Account that already has one', async () => {
  const accountId = await account('Already Scored');
  await query(
    `insert into research_runs (account_id, trigger, status, completed_at)
     values ($1, 'newly_discovered', 'completed', now())`, [accountId]);
  await scoreAccount(accountId);

  assert.equal(await scoreResearchedButUnscored(), 0);

  const { rows } = await query<{ n: number }>(
    'select count(*)::int as n from canonical_scores where account_id = $1', [accountId]);
  assert.equal(rows[0]!.n, 1, 'the sweep scored an Account that was already scored');
});

test('the back-fill leaves unresearched Accounts alone', async () => {
  await account('Never Researched');
  assert.equal(await scoreResearchedButUnscored(), 0,
    'scoring an Account with no research would be scoring nothing');
});
