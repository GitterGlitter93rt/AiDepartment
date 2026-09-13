import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { isPlatformDomain, normalizeHostname } from '../src/domain/normalize.js';
import { ingestListings } from '../src/miner/listingsIngest.js';

/**
 * Two companies must not become one because they share a platform or a word.
 * Authority: Issue #3 — canonical ingestion and dedupe hardening.
 *
 * The miner has already produced one mass collapse: the adapter fell back to the
 * provider's search-task id, every row in a response shared it, and twenty companies
 * resolved onto whichever arrived first. The run reported the rest as "already in
 * inventory", which is a sentence an operator has no reason to doubt.
 *
 * These are two more doors into the same room, and the listings work opened both a
 * little wider -- a Maps listing carries whatever the business put in its website
 * field, which is very often a Facebook page.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

async function upsert(input: {
  name: string; website?: string | null; phone?: string | null;
  city?: string | null; state?: string | null; postalCode?: string | null;
}): Promise<{ accountId: string; created: boolean; matchRule: string }> {
  sequence += 1;
  return withTransaction((client) => upsertAccount(client, {
    canonicalName: input.name,
    website: input.website ?? null,
    phone: input.phone ?? null,
    city: input.city ?? 'St. Augustine',
    state: input.state ?? 'FL',
    postalCode: input.postalCode ?? '32095',
    verticalProfileId: 'roofing',
  }, { discoverySource: 'test' }));
}

// ------------------------------------------------------------ platform pages ----

test('a Facebook page is not a company identity', () => {
  // The path is stripped by normalization, so two businesses become one hostname.
  assert.equal(normalizeHostname('https://facebook.com/salazarroofing'), 'facebook.com');
  assert.equal(normalizeHostname('https://facebook.com/coastalair'), 'facebook.com');
  assert.equal(isPlatformDomain('facebook.com'), true);
  assert.equal(isPlatformDomain('www.facebook.com'), true);
});

test('two companies whose listing gives a Facebook page stay two companies', async () => {
  const first = await upsert({
    name: 'Salazar Roofing', website: 'https://facebook.com/salazarroofing',
    phone: '904-555-9001' });
  const second = await upsert({
    name: 'Coastal Air', website: 'https://facebook.com/coastalair',
    phone: '904-555-9002' });

  assert.equal(first.created, true);
  assert.equal(second.created, true,
    'the second company merged into the first because they share a social platform');
  assert.notEqual(first.accountId, second.accountId);
});

test('a platform page is never stored as the company’s own website', async () => {
  const { accountId } = await upsert({
    name: 'Yelp Only Roofing', website: 'https://www.yelp.com/biz/yelp-only-roofing',
    phone: '904-555-9003' });

  const { rows } = await query<{ canonical_domain: string | null }>(
    'select canonical_domain from accounts where account_id = $1', [accountId]);
  assert.equal(rows[0]!.canonical_domain, null,
    'a directory profile was recorded as the company website, so research will fetch '
    + 'the directory and call the result the company’s own pages');
});

test('a distinctive subdomain of a site builder is still identity', async () => {
  // "wixsite.com" names no company; "salazarroofing.wixsite.com" names one.
  assert.equal(isPlatformDomain('salazarroofing.wixsite.com'), false);
  assert.equal(isPlatformDomain('wixsite.com'), true);

  const first = await upsert({
    name: 'Salazar Roofing', website: 'https://salazarroofing.wixsite.com/home' });
  const again = await upsert({
    name: 'Salazar Roofing LLC', website: 'https://salazarroofing.wixsite.com/contact' });
  assert.equal(again.created, false, 'one company on one site builder became two');
  assert.equal(again.accountId, first.accountId);
});

test('a real website still merges the same company found twice', async () => {
  const first = await upsert({ name: 'Ancient City Roofing',
    website: 'https://ancientcityroofing.invalid' });
  const again = await upsert({ name: 'Ancient City Roofing Inc',
    website: 'https://www.ancientcityroofing.invalid/contact' });
  assert.equal(again.created, false);
  assert.equal(again.accountId, first.accountId);
});

// -------------------------------------------------------- one shared word -------

test('a shared answering service does not merge two companies with one word in common', async () => {
  // The exact case the name guard exists for: a strip mall or an answering service
  // puts one number on several businesses. A single shared word is not evidence they
  // are the same business.
  const roofer = await upsert({ name: 'Salazar Roofing and Repair', phone: '904-555-9100' });
  const heading = await upsert({ name: 'Roofing', phone: '904-555-9100' });

  assert.equal(heading.created, true,
    '"Roofing" absorbed a real roofing company because they share a phone line');
  assert.notEqual(heading.accountId, roofer.accountId);
});

test('a one-word company name has to match exactly', async () => {
  const first = await upsert({ name: 'Comfort', phone: '904-555-9101' });
  const longer = await upsert({ name: 'Comfort Zone Heating and Air', phone: '904-555-9101' });
  assert.equal(longer.created, true, 'one word was enough to merge two companies');

  const same = await upsert({ name: 'Comfort', phone: '904-555-9101' });
  assert.equal(same.created, false, 'the same one-word company became two');
  assert.equal(same.accountId, first.accountId);
});

test('two real names that genuinely overlap still merge on a shared phone', async () => {
  const first = await upsert({ name: 'Coastal Air Conditioning', phone: '904-555-9102' });
  const again = await upsert({ name: 'Coastal Air Conditioning Inc', phone: '904-555-9102' });
  assert.equal(again.created, false,
    'the same company written two ways became two records');
  assert.equal(again.accountId, first.accountId);
});

test('different companies on one line stay apart however similar the trade', async () => {
  const plumbing = await upsert({ name: 'Ace Plumbing', phone: '904-555-9103' });
  const roofing = await upsert({ name: 'Ace Roofing', phone: '904-555-9103' });
  assert.equal(roofing.created, true);
  assert.notEqual(roofing.accountId, plumbing.accountId);
});

// -------------------------------------------------- through the listings path ---

test('a market of Facebook-only listings does not collapse into one company', async () => {
  // What a Maps response for a small trade often looks like: several businesses
  // whose website field is a social page.
  const counts = await ingestListings({
    listings: [1, 2, 3, 4].map((index) => ({
      providerListingId: `fb-${index}`,
      name: `Facebook Roofer ${index}`,
      domain: 'facebook.com',
      phone: `+1 904-555-92${String(index).padStart(2, '0')}`,
      address: `${index} Main St, St. Augustine, FL 32095`,
      city: 'St. Augustine', state: 'FL', postalCode: '32095',
      category: 'Roofing contractor', rating: null, reviewCount: null,
      observedAt: new Date('2026-09-06T08:00:00Z'),
    })),
    provider: 'fixture-listings', verticalProfileId: 'roofing',
  });

  assert.equal(counts.created, 4,
    `four businesses sharing a social platform became ${counts.created} Accounts`);
  assert.equal(counts.matchedExisting, 0);
});

test('the listing id still merges the same business found twice', async () => {
  const listing = (overrides: Record<string, unknown> = {}) => ({
    providerListingId: 'stable-1', name: 'Stable Roofing', domain: 'facebook.com',
    phone: '+1 904-555-9300', address: '9 Main St', city: 'St. Augustine',
    state: 'FL', postalCode: '32095', category: 'Roofing contractor',
    rating: null, reviewCount: null, observedAt: new Date(), ...overrides,
  });

  const first = await ingestListings({
    listings: [listing()], provider: 'fixture-listings', verticalProfileId: 'roofing' });
  const second = await ingestListings({
    listings: [listing({ name: 'Stable Roofing LLC' })],
    provider: 'fixture-listings', verticalProfileId: 'roofing' });

  assert.equal(first.created, 1);
  assert.equal(second.created, 0, 'the provider’s own listing id stopped identifying a business');
  assert.equal(second.matchedExisting, 1);
});
