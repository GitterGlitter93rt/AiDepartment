import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { mayResearchDomain, mayResearchDomainWithHistory } from '../src/discovery/attribution.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Facts read from one organisation's website may not become facts about another.
 *
 * The live case: `Precision Roofing of North Florida Inc` was discovered through
 * `freeroofquote.com`, a lead-generation directory, and research crawled the
 * directory as the contractor's own site -- attaching a Portland phone number,
 * affiliate financing language, another roofer's storm-service text and the
 * directory's quote form to the contractor. A separate case made a News4Jax
 * executive the decision maker of a roofing company.
 */

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase(); await syncVerticalProfiles(); clearDiscoveryAdapters();
});

test('26/27. a directory discovery already refused is never researched', async () => {
  // freeroofquote.com is deliberately on no list in the code. Discovery caught it
  // structurally -- one domain carrying three contractors' names -- and that verdict
  // is what research reads, so the system learns each directory once.
  const bare = mayResearchDomain({ domain: 'freeroofquote.com', entityStatus: 'verified' });
  assert.equal(bare.allowed, true,
    'a bare domain with no history looks like anyone else’s site, which is why the '
    + 'learned verdict matters');

  await query(
    `insert into discovery_candidates
       (identity, source_class, entity_status, reasons, observation_count)
     values ('freeroofquote.com', 'DIRECTORY', 'REJECTED',
             array['carries 3 different business names in one result set'], 3)`);

  const informed = await mayResearchDomainWithHistory({
    domain: 'freeroofquote.com', entityStatus: 'verified' });
  assert.equal(informed.allowed, false,
    'research would crawl a lead-generation directory as a contractor’s own site');
  assert.match(informed.reason, /refused as a business/i);
  assert.match(informed.reason, /3 different business names/);
});

test('28. a news publisher is never a company’s own site', () => {
  for (const domain of ['news4jax.com', 'firstcoastnews.com']) {
    const decision = mayResearchDomain({ domain, entityStatus: 'verified' });
    assert.equal(decision.allowed, false, `${domain} would be researched as a prospect`);
  }
});

test('29/30. a marketplace’s forms and financing are not the contractor’s', () => {
  for (const domain of ['homeadvisor.com', 'thumbtack.com']) {
    assert.equal(mayResearchDomain({ domain, entityStatus: 'verified' }).allowed, false);
  }
});

test('31. social, video and forum content is never a company record', () => {
  for (const domain of ['facebook.com', 'youtube.com', 'reddit.com']) {
    assert.equal(mayResearchDomain({ domain, entityStatus: 'verified' }).allowed, false);
  }
});

test('a company’s own site is still researched', () => {
  // The guard must not simply refuse everything.
  const decision = mayResearchDomain({
    domain: 'burchfieldroofing.com', entityStatus: 'verified' });
  assert.equal(decision.allowed, true, decision.reason);
});

test('32. an unresolved entity is not researched as though it were a prospect', () => {
  for (const status of ['needs_review', 'quarantined', 'rejected']) {
    const decision = mayResearchDomain({ domain: 'burchfieldroofing.com', entityStatus: status });
    assert.equal(decision.allowed, false, `a ${status} entity was researched as a prospect`);
    assert.match(decision.reason, /identity/i);
  }
});

test('a legacy Account keeps working', () => {
  // Imported and manually created Accounts predate the promotion gate and were never
  // the problem. Marking them unresearchable would break the pilot to fix mining.
  const decision = mayResearchDomain({
    domain: 'burchfieldroofing.com', entityStatus: 'legacy_unverified' });
  assert.equal(decision.allowed, true, decision.reason);
});

// ------------------------------------------------------------------- location --

test('33/34. the searched ZIP is discovery provenance, never an address', async () => {
  // What the miner now writes when the provider returned no address: no location at
  // all, and the market it was found in recorded separately.
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Block P0 Roofing', website: 'https://blockp0.invalid',
    city: null, state: null, postalCode: null, verticalProfileId: 'roofing',
  }, { discoverySource: 'market_miner:dataforseo' }));
  await query(
    `update accounts set discovered_for_geography_type = 'zip_zcta',
            discovered_for_geography = '32095' where account_id = $1`, [accountId]);

  const { rows: locations } = await query<{ n: number }>(
    'select count(*)::int as n from locations where account_id = $1', [accountId]);
  assert.equal(locations[0]!.n, 0,
    'a physical location was manufactured from the search geography');

  const { rows } = await query<{ g: string; t: string }>(
    `select discovered_for_geography as g, discovered_for_geography_type as t
       from accounts where account_id = $1`, [accountId]);
  assert.equal(rows[0]!.g, '32095', 'the discovery context was lost');
  assert.equal(rows[0]!.t, 'zip_zcta');
});

test('35. an observed address may become a real location', async () => {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Block P0 Located Roofing', website: 'https://blockp0located.invalid',
    city: 'St. Augustine', state: 'FL', postalCode: '32084', verticalProfileId: 'roofing',
  }, { discoverySource: 'listings:google' }));
  const { rows } = await query<{ postal_code: string | null }>(
    'select postal_code from locations where account_id = $1', [accountId]);
  assert.equal(rows[0]?.postal_code, '32084',
    'an address the provider actually gave should be stored');
});

test('33/34. the miner itself never turns the searched ZIP into an address', async () => {
  // Through the real market_mine handler, because the fallback that manufactured a
  // location lived there. A storage-level test passed with the fallback restored --
  // the mutation proof caught that -- so this drives the path that actually did it.
  registerDiscoveryAdapter({
    name: 'p0-location-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return {
        status: 'OK',
        businesses: [{
          name: 'Nowhere Stated Roofing', website: 'https://nowherestated.invalid',
          phone: '904-555-0155',
          // Exactly the live shape: a SERP row with no address at all.
          city: null, state: null, postalCode: null,
        }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, costUsd: 0,
      };
    },
  });

  const operator = await makeUser('P0 Location Operator', 'ADMIN');
  await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: operator.userId, miningMode: 'advertiser_first',
  });
  await drainQueue();

  const { rows } = await query<{ account_id: string; g: string | null }>(
    `select account_id, discovered_for_geography as g from accounts
      where canonical_name = 'Nowhere Stated Roofing'`);
  assert.equal(rows.length, 1, 'the fixture company was not ingested');

  const { rows: located } = await query<{ n: number; zips: string | null }>(
    `select count(*)::int as n, string_agg(postal_code, ',') as zips
       from locations where account_id = $1`, [rows[0]!.account_id]);
  assert.equal(located[0]!.n, 0,
    `the miner invented a location (${located[0]!.zips}) from the ZIP it was searching`);

  // And the market it was found in is still recorded, so it does not vanish.
  assert.equal(rows[0]!.g, '32095', 'the discovery context was lost with the fallback');
});
