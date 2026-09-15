import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount, recordEvidence } from '../src/domain/accounts.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { resetDatabase, markEntityVerified, makeUser } from './helpers.js';
import { getAccountDetail } from '../src/domain/accountDetail.js';
import { advertiserEvidenceFor } from '../src/domain/advertiserEvidence.js';

/**
 * An ad seen once is an ad seen once.
 *
 * The commercially valuable thing about a Google ad is not the boolean. It is the
 * keyword it answered, the words it used and the day it ran -- and every one of those
 * is a thing a rep opens a call with. The failure to guard against is the boolean
 * outliving all of them: "they advertise" is a claim about the present, and the
 * evidence behind it is always a claim about a moment.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function account(): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: `Ad Co ${sequence}`,
    website: `https://ad${sequence}.invalid`,
    phone: `904-555-${String(4000 + sequence).slice(-4)}`,
    city: 'St Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'plumbing',
  }, { discoverySource: 'market_miner:dataforseo' }));
  await markEntityVerified(accountId);
  return accountId;
}

async function observation(accountId: string, overrides: Record<string, unknown> = {}):
Promise<void> {
  const values = {
    provider: 'dataforseo', source_type: 'serp', query: 'plumber 32095',
    result_type: 'paid_search', position: 1,
    ad_headline: 'Emergency Plumber - Call Now',
    landing_url: 'https://ad.invalid/emergency',
    observed_name: 'Ad Co', ...overrides,
  };
  await query(
    `insert into search_observations
       (account_id, provider, source_type, query, result_type, position, ad_headline,
        landing_url, observed_name, observed_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
    [accountId, values.provider, values.source_type, values.query, values.result_type,
      values.position, values.ad_headline, values.landing_url, values.observed_name]);
}

test('a paid placement keeps the keyword, the headline, the landing page and the date',
  async () => {
    const accountId = await account();
    await observation(accountId);

    const viewer = await makeUser(`Ad Viewer ${sequence}`, 'SALES_MANAGER');
    const detail = (await getAccountDetail(accountId,
      { userId: viewer.userId, role: 'SALES_MANAGER' }))!;
    const found = detail.discoveries[0]!;
    assert.equal(found.query, 'plumber 32095', 'the keyword a rep opens with was lost');
    assert.equal(found.ad_headline, 'Emergency Plumber - Call Now');
    assert.equal(found.landing_url, 'https://ad.invalid/emergency');
    assert.equal(found.result_type, 'paid_search');
    assert.equal(found.position, 1);
    assert.ok(found.observed_at instanceof Date, 'an ad observation without a date is a boolean');
  });

test('an organic result is not a paid placement', async () => {
  const accountId = await account();
  await observation(accountId, {
    result_type: 'organic', ad_headline: null, landing_url: null, position: 4 });

  const viewer = await makeUser(`Ad Viewer O${sequence}`, 'SALES_MANAGER');
  const detail = (await getAccountDetail(accountId,
    { userId: viewer.userId, role: 'SALES_MANAGER' }))!;
  assert.equal(detail.discoveries[0]!.result_type, 'organic');
  assert.notEqual(detail.discoveries[0]!.result_type, 'paid_search',
    'an organic ranking was recorded as advertising spend');
});

test('a local result is not paid unless the provider says it is', async () => {
  const accountId = await account();
  await observation(accountId, { result_type: 'local_result', ad_headline: null });
  const viewer = await makeUser(`Ad Viewer L${sequence}`, 'SALES_MANAGER');
  const detail = (await getAccountDetail(accountId,
    { userId: viewer.userId, role: 'SALES_MANAGER' }))!;
  assert.equal(detail.discoveries[0]!.result_type, 'local_result');
});

test('the advertising boolean is backed by dated evidence and ages out', async () => {
  const accountId = await account();
  await withTransaction((client) => recordEvidence(client, {
    accountId, category: 'advertising', claimKey: 'active_google_search_ad',
    claimText: 'Observed a paid search placement for "plumber 32095".',
    normalizedValue: 'yes', confidence: 'confirmed', canStateAsFact: true,
    sourceType: 'serp', sourceProvider: 'dataforseo',
    sourceReference: 'https://example.invalid/serp',
    expiresAt: new Date(Date.now() + 3_600_000), precedenceRank: 4,
  }));

  const fresh = await advertiserEvidenceFor(accountId);
  const google = fresh.channels.find((channel) => channel.channel === 'google_search')!;
  assert.equal(google.state, 'CONFIRMED');
  assert.ok(google.observedAt, 'a confirmed advertiser with no observation date');

  // Age it past its own expiry.
  await query(
    `update evidence_records set expires_at = now() - interval '1 hour'
      where account_id = $1 and claim_key = 'active_google_search_ad'`, [accountId]);

  const aged = await advertiserEvidenceFor(accountId);
  const agedGoogle = aged.channels.find((channel) => channel.channel === 'google_search')!;
  assert.equal(agedGoogle.state, 'STALE',
    'an ad seen months ago was still being reported as current advertising');
  assert.notEqual(agedGoogle.state, 'CONFIRMED');
});

test('never having looked is not the same as not advertising', async () => {
  const accountId = await account();
  const evidence = await advertiserEvidenceFor(accountId);
  assert.equal(evidence.neverChecked, true);
  for (const channel of evidence.channels) {
    assert.equal(channel.state, 'UNKNOWN');
    assert.notEqual(channel.state, 'NOT_OBSERVED',
      'a company nobody checked was reported as checked and not advertising');
  }
});

test('looked and not found is a real answer, distinct from unknown', async () => {
  const accountId = await account();
  await withTransaction((client) => recordEvidence(client, {
    accountId, category: 'advertising', claimKey: 'active_google_search_ad',
    claimText: 'Searched and found no paid placement.', normalizedValue: 'no',
    confidence: 'confirmed', canStateAsFact: true, sourceType: 'serp',
    sourceProvider: 'dataforseo', sourceReference: 'https://example.invalid/serp',
    expiresAt: new Date(Date.now() + 3_600_000), precedenceRank: 4,
  }));
  const evidence = await advertiserEvidenceFor(accountId);
  const google = evidence.channels.find((channel) => channel.channel === 'google_search')!;
  assert.equal(google.state, 'NOT_OBSERVED');
  assert.equal(evidence.neverChecked, false);
});
