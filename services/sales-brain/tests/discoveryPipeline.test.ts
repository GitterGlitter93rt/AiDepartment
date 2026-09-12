import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters,
  type DiscoveryResult, type DiscoveryQuery,
} from '../src/workers/marketMiner.js';
import { resolveObservations, type ProviderObservation } from '../src/discovery/observation.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { claimAccount } from '../src/domain/ownership.js';
import { addCandidate } from '../src/domain/pilot.js';
import { ingestListings } from '../src/miner/listingsIngest.js';
import { reprocessJob } from '../src/bin/discovery-reprocess.js';
import { searchProspects } from '../src/domain/search.js';
import { getAccountDetail } from '../src/domain/accountDetail.js';
import { resetDatabase, makeUser } from './helpers.js';
import { observationsFor, junkObservations } from './support/observations.js';

/**
 * The discovery pipeline end to end: rows in, identities out, Accounts only where
 * the rules allow one.
 *
 * Every one of these is a defect the first production canary actually produced, or a
 * defect the review found in the first attempt at fixing it. No provider is called
 * and no network is touched: the adapters here are fixtures, and the point of the
 * architecture under test is that a fixture adapter cannot do anything a real one
 * could not.
 */

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase(); await syncVerticalProfiles(); clearDiscoveryAdapters();
});

async function mine(overrides: { geographyValue?: string; queryBudget?: number } = {}) {
  const operator = await makeUser(`Pipeline Ops ${Math.random()}`, 'ADMIN');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta',
    geographyValue: overrides.geographyValue ?? '32095',
    marketId: null, requestedBy: operator.userId, miningMode: 'advertiser_first',
    ...(overrides.queryBudget ? { queryBudget: overrides.queryBudget } : {}),
  });
  await drainQueue();
  const { rows } = await query<Record<string, any>>(
    'select * from jobs where job_id = $1', [job.jobId]);
  return rows[0]!;
}

function adapterReturning(observations: ProviderObservation[], name = 'pipeline-fixture') {
  registerDiscoveryAdapter({
    name, requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return { status: 'OK', observations, costUsd: 0 };
    },
  });
}

/** A page of results in which nothing is a business. */
function allJunk(): ProviderObservation[] {
  const row = (over: Partial<ProviderObservation>): ProviderObservation => ({
    providerNativeId: null, observedName: null, observedDomain: null, observedPhone: null,
    observedBusinessAddress: null,
    observedCity: null, observedRegion: null, observedPostalCode: null,
    searchLocationName: 'St. Augustine,Florida,United States',
    resultType: 'ORGANIC', position: null, adHeadline: null, landingUrl: null,
    advertisedService: null, checkUrl: null, observedAt: new Date(), query: 'roofer 32095',
    ...over,
  });
  return [
    row({ observedName: 'Top 10 Best Roofers in Saint Augustine, FL', observedDomain: 'yelp.com',
      landingUrl: 'https://yelp.com/search?find_desc=roofing', position: 1 }),
    row({ observedName: 'An 82-year-old veteran says his roof was never finished',
      observedDomain: 'news4jax.com', landingUrl: 'https://news4jax.com/news/2026/01/roof',
      position: 2 }),
    row({ observedName: 'Find a GAF certified contractor near you', observedDomain: 'gaf.com',
      landingUrl: 'https://gaf.com/en-us/roofing-contractors', position: 3 }),
    row({ observedName: 'Anyone used a roofer in 32095?', observedDomain: 'reddit.com',
      landingUrl: 'https://reddit.com/r/jacksonville/comments/abc', position: 4 }),
  ];
}

// ------------------------------------------------- 1. nothing is ever dropped --

test('ALL_JUNK_RESPONSE: a search that promotes nothing still leaves its evidence',
  async () => {
  // The defect: observations and candidates were written inside
  // `if (result.businesses.length > 0)`, so the run that most needed explaining --
  // the one that found eleven directories -- recorded nothing at all.
  adapterReturning(allJunk());
  const job = await mine();
  const progress = job['progress'] as Record<string, unknown>;

  const accounts = await query<{ n: number }>('select count(*)::int as n from accounts');
  assert.equal(accounts.rows[0]!.n, 0, 'a page of directories and articles became companies');

  const research = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'account_research'`);
  assert.equal(research.rows[0]!.n, 0, 'research was queued for something that is not a company');

  const observations = await query<{ n: number }>(
    'select count(*)::int as n from search_observations');
  assert.ok(observations.rows[0]!.n > 0,
    'the rows the provider returned left no trace, so nobody can check the decision');

  const candidates = await query<{ n: number; refused: number }>(
    `select count(*)::int as n,
            count(*) filter (where entity_status <> 'VERIFIED')::int as refused
       from discovery_candidates`);
  assert.ok(candidates.rows[0]!.n > 0, 'no candidate was recorded for a refused row');
  assert.equal(candidates.rows[0]!.refused, candidates.rows[0]!.n);

  // And the search is still on record as having been made and paid for.
  assert.ok(Number(progress['providerRows']) > 0,
    'the run does not report that a search was executed');
  assert.ok((progress['perSearch'] as unknown[]).length > 0);
});

test('a refused row keeps its provenance, unattached to any Account', async () => {
  adapterReturning(allJunk());
  await mine();
  const { rows } = await query<{ observed_domain: string; account_id: string | null }>(
    `select observed_domain, account_id from search_observations order by position`);
  assert.ok(rows.length >= 4);
  for (const row of rows) {
    assert.equal(row.account_id, null,
      `${row.observed_domain} was attached to an Account it never became`);
  }
});

// ------------------------------------------- 2. resolution is not optional ----

test('a second adapter cannot bypass entity resolution', async () => {
  // The contract carries observations and has no field a finished company could
  // arrive on, so this adapter -- written by somebody who has never read the
  // resolver -- cannot promote a directory however it tries.
  registerDiscoveryAdapter({
    name: 'naive-second-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return {
        status: 'OK',
        observations: [{
          providerNativeId: 'x1', observedName: 'Top 10 Roofers in St. Augustine',
          observedDomain: 'yelp.com', observedPhone: '904-555-0001',
          observedBusinessAddress: null,
    observedCity: null, observedRegion: null, observedPostalCode: null,
    searchLocationName: null,
          resultType: 'ORGANIC', position: 1, adHeadline: null,
          landingUrl: 'https://yelp.com/search?find_desc=roofing',
          advertisedService: null, checkUrl: null, observedAt: new Date(),
          query: 'roofer 32095',
        }],
        costUsd: 0,
      };
    },
  });
  await mine();

  const { rows } = await query<{ n: number }>('select count(*)::int as n from accounts');
  assert.equal(rows[0]!.n, 0, 'a second adapter promoted a directory into inventory');

  const candidates = await query<{ entity_status: string; source_class: string }>(
    'select entity_status, source_class from discovery_candidates');
  assert.equal(candidates.rows.length, 1);
  assert.equal(candidates.rows[0]!.entity_status, 'REJECTED');
  assert.equal(candidates.rows[0]!.source_class, 'DIRECTORY');
});

test('every adapter reaches inventory through one resolution', () => {
  // Structural, not behavioural: the type has no `businesses` field to fill in.
  const result: DiscoveryResult = { status: 'OK', observations: [] };
  assert.equal('businesses' in result, false,
    'the contract still has a channel that skips the promotion rules');
  assert.equal(resolveObservations([]).businesses.length, 0);
});

// ------------------------------- 3. what a query is for decides what it may do --

test('A. an entity-discovery query may create Accounts', async () => {
  adapterReturning(observationsFor([
    { name: 'Primary Discovery Roofing', website: 'https://primarydiscovery.invalid',
      phone: '904-555-0201' },
  ]));
  await mine({ queryBudget: 1 });
  const { rows } = await query<{ canonical_name: string }>(
    'select canonical_name from accounts');
  assert.deepEqual(rows.map((row) => row.canonical_name), ['Primary Discovery Roofing']);
});

test('B. a commercial-intelligence query may not introduce a company', async () => {
  // The first planned search is always primary entity discovery, so a budget large
  // enough to reach the commercial terms is asked for and only the later searches
  // return this company.
  let call = 0;
  registerDiscoveryAdapter({
    name: 'purpose-fixture', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request: DiscoveryQuery): Promise<DiscoveryResult> {
      call += 1;
      if (request.search?.purpose !== 'COMMERCIAL_INTELLIGENCE') {
        return { status: 'OK', observations: [], costUsd: 0 };
      }
      return {
        status: 'OK',
        observations: observationsFor([
          { name: 'National Roof Financing Group', website: 'https://rooffinance.invalid',
            phone: '800-555-0301' },
        ]),
        costUsd: 0,
      };
    },
  });
  const job = await mine({ queryBudget: 12 });
  assert.ok(call > 1, 'the plan did not reach a commercial-intelligence query');

  const { rows } = await query<{ n: number }>('select count(*)::int as n from accounts');
  assert.equal(rows[0]!.n, 0,
    'a question about financing decided who is in the roofing market');

  const progress = job['progress'] as Record<string, unknown>;
  assert.ok(Number(progress['notInMarket']) > 0,
    'the run does not report that it found a company it was not allowed to add');

  // Kept, not lost: the identity and the reason are on record.
  const { rows: candidates } = await query<{ entity_status: string; reasons: string[] }>(
    `select entity_status, reasons from discovery_candidates
      where identity = 'rooffinance.invalid'`);
  assert.equal(candidates[0]?.entity_status, 'NEEDS_REVIEW');
  assert.match(candidates[0]!.reasons.join(' '), /about what this market sells/);
});

test('C. a commercial-intelligence query may confirm a company we already hold',
  async () => {
  await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Held Roofing Co', website: 'https://heldroofing.invalid',
    phone: '904-555-0401', verticalProfileId: 'roofing',
  }, { discoverySource: 'import' }));

  registerDiscoveryAdapter({
    name: 'purpose-confirm', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request: DiscoveryQuery): Promise<DiscoveryResult> {
      if (request.search?.purpose !== 'COMMERCIAL_INTELLIGENCE') {
        return { status: 'OK', observations: [], costUsd: 0 };
      }
      return {
        status: 'OK',
        observations: observationsFor([
          { name: 'Held Roofing Co', website: 'https://heldroofing.invalid',
            phone: '904-555-0401' },
        ]),
        costUsd: 0,
      };
    },
  });
  const job = await mine({ queryBudget: 12 });
  const progress = job['progress'] as Record<string, unknown>;
  assert.equal(Number(progress['discoveredNew']), 0);
  assert.ok(Number(progress['matchedExisting']) > 0,
    'a company we already hold was not confirmed by the search that found it');

  const { rows } = await query<{ n: number }>('select count(*)::int as n from accounts');
  assert.equal(rows[0]!.n, 1);
});

// --------------------------------------- 4. a search target is not an address --

test('MAPS_LOCAL with no phone and no address is not an identified business', () => {
  const run = resolveObservations([{
    providerNativeId: null, observedName: 'Vague Listing Roofing', observedDomain: null,
    observedPhone: null, observedBusinessAddress: null,
    // The field that used to satisfy the classifier, on every row of every response.
    observedCity: null, observedRegion: null, observedPostalCode: null,
    searchLocationName: 'St. Augustine,Florida,United States',
    resultType: 'MAPS_LOCAL', position: 1, adHeadline: null, landingUrl: null,
    advertisedService: null, checkUrl: null, observedAt: new Date(), query: 'roofer',
  }]);
  assert.equal(run.businesses.length, 0,
    'the geography we typed into the provider verified the entity');
});

test('MAPS_LOCAL with an observed address is an identified business', () => {
  const run = resolveObservations([{
    providerNativeId: null, observedName: 'Addressed Roofing LLC',
    observedDomain: 'addressedroofing.invalid', observedPhone: null,
    observedBusinessAddress: '120 King St, St. Augustine, FL',
    observedCity: null, observedRegion: null, observedPostalCode: null,
    searchLocationName: 'St. Augustine,Florida,United States',
    resultType: 'MAPS_LOCAL', position: 1, adHeadline: null, landingUrl: null,
    advertisedService: null, checkUrl: null, observedAt: new Date(), query: 'roofer',
  }]);
  assert.equal(run.businesses.length, 1);
  assert.equal(run.candidates[0]!.observedBusinessAddress, '120 King St, St. Augustine, FL');
});

test('an observed address is never masked by the provider search target', async () => {
  const { normalizeResponse } = await import('../src/miner/dataForSeoAdapter.js');
  const [observation] = normalizeResponse({
    status_code: 20000,
    tasks: [{
      id: 't', status_code: 20000,
      result: [{
        keyword: 'roofer', location_name: 'St. Augustine,Florida,United States',
        items: [{ type: 'local_pack', rank_absolute: 1, title: 'Masked Roofing',
          address: '9 Center St, St. Augustine, FL', phone: '904-555-0501' }],
      }],
    }],
  }, { query: 'roofer' });
  assert.equal(observation!.observedBusinessAddress, '9 Center St, St. Augustine, FL',
    'the business address was overwritten by the geography we searched');
  assert.equal(observation!.searchLocationName, 'St. Augustine,Florida,United States');
});

test('the physical locations table never receives the provider search target',
  async () => {
  adapterReturning([{
    providerNativeId: null, observedName: 'No Address Roofing',
    observedDomain: 'noaddressroofing.invalid', observedPhone: '904-555-0601',
    observedBusinessAddress: null,
    observedCity: null, observedRegion: null, observedPostalCode: null,
    searchLocationName: 'St. Augustine,Florida,United States',
    resultType: 'MAPS_LOCAL', position: 1, adHeadline: null, landingUrl: null,
    advertisedService: null, checkUrl: null, observedAt: new Date(), query: 'roofer 32095',
  }]);
  await mine();

  const { rows } = await query<{ n: number; values: string | null }>(
    `select count(*)::int as n,
            string_agg(coalesce(city, '') || '/' || coalesce(postal_code, ''), ',') as values
       from locations`);
  assert.equal(rows[0]!.n, 0,
    `a location was manufactured from the search target (${rows[0]!.values})`);

  // The observation keeps the search target as provenance, and never as an address.
  const { rows: observed } = await query<{ observed_location: string | null }>(
    'select observed_location from search_observations');
  assert.equal(observed[0]!.observed_location, null,
    'the geography we searched was stored as something the provider observed');
});

// ------------------------------------------------------ 7. the entity gate ----

async function minedAccount(name: string, status: string): Promise<string> {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name, website: `https://${name.toLowerCase().replace(/[^a-z]/g, '')}.invalid`,
    phone: '904-555-0701', verticalProfileId: 'roofing',
  }, { discoverySource: 'market_miner:dataforseo' }));
  await query('update accounts set entity_status = $2 where account_id = $1',
    [accountId, status]);
  return accountId;
}

test('claiming fails closed for everything that is not an established company',
  async () => {
  const rep = await makeUser('Gate Rep', 'SALES_REP');
  const actor = { userId: rep.userId, role: 'SALES_REP' as const, activeClaimTarget: null };

  for (const status of ['rejected', 'quarantined', 'needs_review', 'legacy_unverified']) {
    const accountId = await minedAccount(`Gate ${status} Roofing`, status);
    const outcome = await claimAccount(accountId, actor, null);
    assert.equal(outcome.ok, false, `a ${status} record could be claimed`);
    assert.equal(outcome.reason, 'ENTITY_UNVERIFIED');
    assert.ok((outcome.message ?? '').length > 0, 'the refusal does not say why');
  }

  const verified = await minedAccount('Gate Verified Roofing', 'verified');
  assert.equal((await claimAccount(verified, actor, null)).ok, true,
    'a verified company could not be claimed');
});

test('an imported record that predates verification keeps working', async () => {
  // The migration marks nothing verified, so the status alone cannot tell an
  // imported company from a SERP row. How it was found can.
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Imported Legacy Roofing', website: 'https://importedlegacy.invalid',
    phone: '904-555-0801', verticalProfileId: 'roofing',
  }, { discoverySource: 'import' }));
  const rep = await makeUser('Import Rep', 'SALES_REP');
  const outcome = await claimAccount(
    accountId, { userId: rep.userId, role: 'SALES_REP', activeClaimTarget: null }, null);
  assert.equal(outcome.ok, true,
    'an imported company was blocked by a rule written for search results');
});

test('the pilot fails closed for an unverified record', async () => {
  const accountId = await minedAccount('Pilot Unverified Roofing', 'legacy_unverified');
  const admin = await makeUser('Pilot Admin', 'ADMIN');
  const result = await addCandidate({ accountId, actorUserId: admin.userId });
  assert.equal(result.ok, false, 'an autonomous call could be set up against a webpage');
  assert.match(result.message ?? '', /company/i);
});

test('cold inventory does not list what cannot be claimed', async () => {
  await minedAccount('Junk Canary Roofing', 'legacy_unverified');
  const real = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Real Canary Roofing', website: 'https://realcanary.invalid',
    phone: '904-555-0901', city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'roofing',
  }, { discoverySource: 'market_miner:dataforseo' }));
  await query(`update accounts set entity_status = 'verified' where account_id = $1`,
    [real.accountId]);

  const rep = await makeUser('Inventory Rep', 'SALES_REP');
  const response = await searchProspects(
    { verticalProfileId: 'roofing', ownership: 'UNCLAIMED' },
    { userId: rep.userId, role: 'SALES_REP' });
  const names = response.results.map((row) => row.company_name);
  assert.ok(names.includes('Real Canary Roofing'));
  assert.equal(names.includes('Junk Canary Roofing'), false,
    'a record nobody has established to be a company was offered to a rep');
});

test('ingestListings marks what a listings provider resolved', async () => {
  await ingestListings({
    provider: 'google_places', verticalProfileId: 'roofing', marketId: null, jobId: null,
    listings: [{
      providerListingId: 'places-1', name: 'Listings Verified Roofing',
      domain: 'listingsverified.invalid', phone: '904-555-1001',
      address: '1 Bay St', city: 'St. Augustine', state: 'FL', postalCode: '32084',
      category: 'Roofing contractor', rating: 4.7, reviewCount: 31, observedAt: new Date(),
    }],
  });
  const { rows } = await query<{ entity_status: string; basis: string | null }>(
    `select entity_status, entity_status_basis as basis from accounts
      where canonical_name = 'Listings Verified Roofing'`);
  assert.equal(rows[0]!.entity_status, 'verified',
    'a resolved business listing was left unverified and therefore unclaimable');
  assert.match(rows[0]!.basis ?? '', /listing/);
});

test('the account page says what is known about the entity, not just the research',
  async () => {
  const accountId = await minedAccount('Detail Unverified Roofing', 'needs_review');
  const admin = await makeUser('Detail Admin', 'ADMIN');
  const detail = (await getAccountDetail(
    accountId, { userId: admin.userId, role: 'ADMIN' }))!;
  assert.equal(detail.entity.status, 'needs_review');
  assert.equal(detail.entity.workable, false);
  assert.ok(detail.entity.reason.length > 0);
  assert.equal(detail.entity.foundByMachine, true);
  assert.equal(detail.readiness.state, 'NOT_WORKABLE',
    'readiness called an unverified record workable');
});

// ------------------------------------------------------- 8. reprocess tool ----

test('reprocess reports what a run would do today and changes nothing', async () => {
  adapterReturning([
    ...observationsFor([{ name: 'Reprocess Real Roofing',
      website: 'https://reprocessreal.invalid', phone: '904-555-1101' }]),
    ...junkObservations(2),
  ]);
  const job = await mine();

  // A record the old rules would have created: a directory, with an Account.
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Top 10 Roofers', website: 'https://yelp.com',
    verticalProfileId: 'roofing',
  }, { discoverySource: 'market_miner:dataforseo' }));
  await query(
    `insert into search_observations (provider, source_type, observed_name, observed_domain,
                                      result_type, account_id, job_id, query, position)
     values ('dataforseo', 'discovery', 'Top 10 Roofers', 'yelp.com', 'organic', $1, $2,
             'roofer 32095', 9)`,
    [accountId, job['job_id']]);

  const before = await query<{ n: number }>('select count(*)::int as n from accounts');
  const report = await reprocessJob(String(job['job_id']));
  const after = await query<{ n: number }>('select count(*)::int as n from accounts');

  assert.equal(after.rows[0]!.n, before.rows[0]!.n, 'the dry run changed the database');
  assert.ok(report.observations > 0);
  assert.ok(report.accountsThatWouldNotPromote.some((row) => row.name === 'Top 10 Roofers'),
    'a directory Account was not reported as one the rules would refuse today');
  assert.equal(
    report.accountsThatWouldNotPromote.some((row) => row.name === 'Reprocess Real Roofing'),
    false, 'a real company was reported as junk');
});

test('reprocess queues no research and calls no provider', async () => {
  adapterReturning(allJunk());
  const job = await mine();
  const researchBefore = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'account_research'`);

  // Any provider call would throw, because the only adapter registered refuses to be
  // called at all.
  clearDiscoveryAdapters();
  registerDiscoveryAdapter({
    name: 'must-not-be-called', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      throw new Error('reprocess called a provider');
    },
  });

  await reprocessJob(String(job['job_id']));
  const researchAfter = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'account_research'`);
  assert.equal(researchAfter.rows[0]!.n, researchBefore.rows[0]!.n,
    'the dry run queued research');
});

test('a discovery query does not enrich a record nothing has verified', async () => {
  // P0-6 generalised. The commercial-intelligence rule was the reported case, but a
  // plain discovery query that re-finds one of the canary's 65 webpages would have
  // attached advertiser evidence to it just the same -- and a junk record that looks
  // researched is worse than one that looks empty, because the next person to read it
  // has no reason to doubt it.
  const junk = await minedAccount('Rediscovered Junk Roofing', 'legacy_unverified');
  adapterReturning(observationsFor([
    { name: 'Rediscovered Junk Roofing',
      website: 'https://rediscoveredjunkroofing.invalid',
      phone: '904-555-0701', resultType: 'PAID_SEARCH_TEXT' },
  ]));
  const job = await mine();
  const progress = job['progress'] as Record<string, unknown>;

  assert.equal(Number(progress['discoveredNew']), 0);
  assert.equal(Number(progress['matchedExisting']), 0,
    'an unverified record was counted as a company this search confirmed');
  assert.ok(Number(progress['notInMarket']) > 0);

  const evidence = await query<{ n: number }>(
    `select count(*)::int as n from evidence_records where account_id = $1`, [junk]);
  assert.equal(evidence.rows[0]!.n, 0,
    'advertiser evidence was attached to a record nothing has established to be a company');

  // The sighting itself is still on record, which is what a reprocess run reads.
  const observed = await query<{ n: number }>(
    'select count(*)::int as n from search_observations');
  assert.ok(observed.rows[0]!.n > 0);
});

test('a verified company is still enriched by the search that finds it again', async () => {
  const verified = await minedAccount('Verified Again Roofing', 'verified');
  adapterReturning(observationsFor([
    { name: 'Verified Again Roofing', website: 'https://verifiedagainroofing.invalid',
      phone: '904-555-0701', resultType: 'PAID_SEARCH_TEXT' },
  ]));
  const job = await mine();
  const progress = job['progress'] as Record<string, unknown>;
  assert.equal(Number(progress['matchedExisting']), 1,
    'a verified company was refused the evidence of its own re-discovery');

  const evidence = await query<{ n: number }>(
    `select count(*)::int as n from evidence_records where account_id = $1`, [verified]);
  assert.ok(evidence.rows[0]!.n > 0, 'the advertiser evidence was not written');
});
