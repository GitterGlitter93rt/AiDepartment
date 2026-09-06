import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  clearDiscoveryAdapters, registerDiscoveryAdapter,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import {
  registerListingsAdapter, availableListingsAdapters, clearListingsAdapters,
  dedupeListings, isUsableListing, refusedListings,
  type BusinessListing, type ListingsAdapter,
} from '../src/miner/listings.js';
import { ingestListings, latestListingFacts } from '../src/miner/listingsIngest.js';
import { researchPictureFor } from '../src/domain/researchFacts.js';

/**
 * Three sources, one company, any arrival order.
 * Authority: Issue #3 D / M-17.
 *
 * A SERP says who ranked and who paid on a day. Its identity is weak -- a domain or
 * a phone and nothing that stably names the business -- and that weakness already
 * cost us once, when the adapter fell back to the provider's search-task id and
 * collapsed every company in a response into one Account.
 *
 * A business listing is the opposite shape: a name, an address, a category and an id
 * that means the same business tomorrow. It says almost nothing about advertising
 * and nearly everything about who exists.
 *
 * So the split is real, and the thing that must hold is convergence. Whichever
 * source arrives first creates the record; the rest fill it in. Arrival order is an
 * accident of scheduling, and a rep's ownership, call history and DNC state are not.
 *
 * No live calls anywhere here: every adapter is a fixture.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { clearListingsAdapters(); clearDiscoveryAdapters(); await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearListingsAdapters();
  clearDiscoveryAdapters();
});

/** The normalized shape a Maps-style source produces. */
function listing(overrides: Partial<BusinessListing> = {}): BusinessListing {
  sequence += 1;
  return {
    providerListingId: `listing-${sequence}`,
    name: `Coastal Air ${sequence}`,
    domain: `coastal${sequence}.invalid`,
    phone: `+1 904-555-${String(6000 + sequence).slice(-4)}`,
    address: '1200 US-1 S, St. Augustine, FL 32095',
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    category: 'HVAC contractor',
    rating: 4.7, reviewCount: 212,
    observedAt: new Date('2026-09-06T08:00:00Z'),
    ...overrides,
  };
}

function fixtureListingsAdapter(listings: BusinessListing[]): ListingsAdapter {
  return {
    name: 'fixture-listings', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discoverListings() {
      return {
        status: 'OK', listings, providerRows: listings.length,
        rejectedRows: 0, duplicateRows: 0, costUsd: 0.002,
      };
    },
  };
}

// ------------------------------------------------------------ the framework -----

test('registering a listings provider is not enabling one', () => {
  registerListingsAdapter({
    name: 'unreviewed', requiresCredential: true, governanceReviewed: false,
    isConfigured: () => true,
    async discoverListings() { return refusedListings('NOT_CONFIGURED', 'no'); },
  });
  assert.equal(availableListingsAdapters().length, 0,
    'a provider without a signed source review was offered to the orchestrator');

  registerListingsAdapter({
    name: 'uncredentialled', requiresCredential: true, governanceReviewed: true,
    isConfigured: () => false,
    async discoverListings() { return refusedListings('NOT_CONFIGURED', 'no'); },
  });
  assert.equal(availableListingsAdapters().length, 0);

  registerListingsAdapter(fixtureListingsAdapter([]));
  assert.equal(availableListingsAdapters().length, 1);
});

test('registering the same listings provider twice does not double it', () => {
  registerListingsAdapter(fixtureListingsAdapter([]));
  registerListingsAdapter(fixtureListingsAdapter([]));
  assert.equal(availableListingsAdapters().length, 1,
    'one provider registered twice is two providers, so every search costs double');
});

test('a listing with no stable id is a search result wearing a listing’s clothes', () => {
  assert.equal(isUsableListing(listing({ providerListingId: '  ' })), false,
    'a row we cannot recognise again was accepted as an entity record');
  assert.equal(isUsableListing(listing({ name: '' })), false);
  assert.equal(isUsableListing(
    listing({ domain: null, phone: null, address: null })), false);
  assert.equal(isUsableListing(listing({ domain: null, phone: null })), true,
    'an address alone is enough to place a business');
});

test('the same listing twice is one company, and the richer row wins', () => {
  const thin = listing({ providerListingId: 'same', domain: null, rating: null,
    reviewCount: null, category: null });
  const rich = listing({ providerListingId: 'same', domain: 'rich.invalid' });
  const collapsed = dedupeListings([thin, rich]);

  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0]!.domain, 'rich.invalid');
  assert.equal(collapsed[0]!.rating, 4.7);
});

test('two listings that merely look alike stay two companies', () => {
  // Two ids are two businesses. Merging on a similar name and a nearby street is
  // entity resolution's job, with more to go on than a category.
  const first = listing({ providerListingId: 'a', name: 'Coastal Air', domain: null,
    phone: '904-555-0101' });
  const second = listing({ providerListingId: 'b', name: 'Coastal Air Inc', domain: null,
    phone: '904-555-0102' });
  assert.equal(dedupeListings([first, second]).length, 2);
});

// ------------------------------------------------------------- convergence ------

async function fromListings(overrides: Partial<BusinessListing> = {}): Promise<void> {
  await ingestListings({
    listings: [listing({ providerListingId: 'shared-1', name: 'Convergence Air',
      domain: 'convergence.invalid', phone: '+1 904-555-7001', ...overrides })],
    provider: 'fixture-listings', verticalProfileId: 'hvac',
    searchedGeographyType: 'zip_zcta', searchedGeographyValue: '32095',
  });
}

async function fromSerp(): Promise<void> {
  registerDiscoveryAdapter({
    name: 'fixture-serp', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return {
        status: 'OK' as const,
        businesses: [{
          name: 'convergence.invalid', website: 'https://convergence.invalid',
          phone: null, city: null, state: null, postalCode: null,
          resultType: 'PAID_SEARCH_TEXT', adHeadline: 'Same-Day AC Repair',
          query: 'ac repair', position: 1,
        }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0,
      };
    },
  });
  const ops = await makeUser(`Converge Ops ${Date.now()}${Math.random()}`, 'RESEARCH_OPS');
  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId });
  await drainQueue();
  clearDiscoveryAdapters();
}

async function fromImport(): Promise<string> {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Convergence Air', website: 'https://convergence.invalid',
    phone: '904-555-7001', city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'import' }));
  return accountId;
}

async function accountCount(): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from accounts where merged_into_account_id is null`);
  return rows[0]!.n;
}

test('listings then SERP is one company', async () => {
  await fromListings();
  await fromSerp();
  assert.equal(await accountCount(), 1, 'the same company exists twice');
});

test('SERP then listings is one company', async () => {
  await fromSerp();
  await fromListings();
  assert.equal(await accountCount(), 1, 'the same company exists twice');
});

test('import, then listings, then SERP is one company', async () => {
  await fromImport();
  await fromListings();
  await fromSerp();
  assert.equal(await accountCount(), 1, 'the same company exists twice');

  // And every source is on the record, because "where did this come from" deserves
  // all the answers rather than the first one.
  const { rows } = await query<{ source_system: string }>(
    `select distinct source_system from activities
      where source_system is not null order by source_system`);
  const sources = rows.map((row) => row.source_system);
  assert.ok(sources.includes('import'), sources.join(', '));
  assert.ok(sources.some((source) => source.startsWith('listings:')), sources.join(', '));
  assert.ok(sources.some((source) => source.startsWith('market_miner:')), sources.join(', '));
});

test('a rep’s ownership survives a company arriving again from another source', async () => {
  const accountId = await fromImport();
  const rep = await makeUser(`Converge Rep ${Date.now()}`, 'SALES_REP');
  await claimAccount(accountId,
    { userId: rep.userId, role: 'SALES_REP', activeClaimTarget: null });

  await fromListings();
  await fromSerp();

  const { rows } = await query<{ current_owner_user_id: string; ownership_state: string }>(
    'select current_owner_user_id, ownership_state from accounts where account_id = $1',
    [accountId]);
  assert.equal(rows[0]!.current_owner_user_id, rep.userId,
    'a second source arriving took the company away from the rep working it');
  assert.equal(rows[0]!.ownership_state, 'CLAIMED');
});

test('suppression survives a company arriving again from another source', async () => {
  const accountId = await fromImport();
  await query(
    `update accounts set is_suppressed = true, suppression_summary = 'Asked not to be called'
      where account_id = $1`, [accountId]);

  await fromListings();
  await fromSerp();

  const { rows } = await query<{ is_suppressed: boolean; suppression_summary: string }>(
    'select is_suppressed, suppression_summary from accounts where account_id = $1',
    [accountId]);
  assert.equal(rows[0]!.is_suppressed, true,
    'a suppressed company became contactable again because a provider found it');
  assert.match(rows[0]!.suppression_summary, /Asked not to be called/);
});

test('call history survives a company arriving again from another source', async () => {
  const accountId = await fromImport();
  await query(
    `insert into activities (account_id, activity_type, channel, disposition, occurred_at)
     values ($1, 'CALL_ATTEMPT', 'phone', 'NO_ANSWER', now())`, [accountId]);

  await fromListings();
  await fromSerp();

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from activities
      where account_id = $1 and activity_type = 'CALL_ATTEMPT'`, [accountId]);
  assert.equal(rows[0]!.n, 1, 'the call history was lost or duplicated');
});

// ------------------------------------------------------ what listings supply ----

test('a listing supplies the address a SERP row never had', async () => {
  await fromListings();
  const { rows } = await query<{ city: string; postal_code: string }>(
    `select l.city, l.postal_code from locations l
       join accounts a on a.account_id = l.account_id
      where a.canonical_name = 'Convergence Air'`);
  assert.equal(rows[0]!.city, 'St. Augustine');
  assert.equal(rows[0]!.postal_code, '32095');
});

test('the rating a listings source gives is read back with its date and provider', async () => {
  await fromListings();
  const { rows } = await query<{ account_id: string }>(
    `select account_id from accounts where canonical_name = 'Convergence Air'`);
  const facts = await latestListingFacts(rows[0]!.account_id);

  assert.equal(facts!.rating, 4.7);
  assert.equal(facts!.reviewCount, 212);
  assert.equal(facts!.category, 'HVAC contractor');
  assert.equal(facts!.provider, 'fixture-listings');
});

test('a listing with no rating is a gap in their record, not a company with no reviews', async () => {
  await fromListings({ rating: null, reviewCount: null });
  const { rows } = await query<{ account_id: string }>(
    `select account_id from accounts where canonical_name = 'Convergence Air'`);

  const picture = await researchPictureFor(rows[0]!.account_id);
  const rating = picture.facts.find((fact) => fact.key === 'rating_and_reviews')!;
  assert.equal(rating.state, 'NOT_OBSERVED');
  assert.match(rating.detail, /gap in their record, not a company with no reviews/);
  assert.doesNotMatch(rating.detail, /\b0\b/);
});

test('with no listings source at all, the rating has never been looked at', async () => {
  const accountId = await fromImport();
  const picture = await researchPictureFor(accountId);
  const rating = picture.facts.find((fact) => fact.key === 'rating_and_reviews')!;
  assert.equal(rating.state, 'NOT_CHECKED');
  assert.match(rating.detail, /never been looked at/);
});

// ------------------------------------------------------------- the exclusions ---

test('listings obey the same exclusions a SERP does', async () => {
  const counts = await ingestListings({
    listings: [
      listing({ providerListingId: 'supply', name: 'Gulf Coast HVAC Supply',
        domain: 'gulfsupply.invalid' }),
      listing({ providerListingId: 'real', name: 'Ancient City Heating & Air',
        domain: 'ancientcity.invalid' }),
    ],
    provider: 'fixture-listings', verticalProfileId: 'hvac',
  });

  assert.equal(counts.created, 1, 'a supply house became a prospect');
  assert.equal(counts.excludedByVertical, 1);
  assert.match(counts.exclusionReasons[0]!, /HVAC Supply/);
});

test('discovering from listings queues research, like any other source', async () => {
  const counts = await ingestListings({
    listings: [listing({ providerListingId: 'fresh', name: 'Fresh Air Co',
      domain: 'freshair.invalid' })],
    provider: 'fixture-listings', verticalProfileId: 'hvac',
  });
  assert.equal(counts.created, 1);
  assert.equal(counts.researchQueued, 1,
    'a company found in listings sat in inventory with no research queued');
});
