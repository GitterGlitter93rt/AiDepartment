import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { upsertAccount, recordEvidence } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import { searchProspects, coverageFor } from '../src/domain/search.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { drainQueue } from '../src/workers/runner.js';
import {
  planMarketRefresh, expireStaleEvidence, availableDiscoveryAdapters, registerDiscoveryAdapter,
} from '../src/workers/marketMiner.js';
import '../src/workers/contactResearch.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Inventory connection.
 * Authority: rep-inventory-browse-claim-spec.md §10, rep-portal-api-contract.v1.md §3-§5.
 */

before(async () => { await resetDatabase(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

async function seedMarketAccounts(count: number, zip = '32256'): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const { accountId } = await withTransaction((client) =>
      upsertAccount(
        client,
        {
          canonicalName: `Riverbend Air ${i}`,
          website: `https://riverbend${i}.example.com`,
          phone: `904-555-${String(1000 + i).slice(0, 4)}`,
          city: 'Jacksonville', state: 'FL', postalCode: zip,
          verticalProfileId: null,
        },
        { discoverySource: 'test' },
      ),
    );
    await query(
      `update accounts set manual_tier = $2, manual_score = $3,
              last_researched_at = now(), research_fresh_until = now() + interval '3 days'
        where account_id = $1`,
      [accountId, i % 2 === 0 ? 'A' : 'B', 13 - i],
    );
    ids.push(accountId);
  }
  return ids;
}

test('a ZIP search returns cached inventory immediately without waiting on mining', async () => {
  const rep = await makeUser('Rep A');
  await seedMarketAccounts(5);

  const started = Date.now();
  const response = await searchProspects(
    { geography: { type: 'zip_zcta', value: '32256' }, ownership: 'UNCLAIMED' }, rep,
  );
  const elapsed = Date.now() - started;

  assert.equal(response.total, 5);
  assert.ok(elapsed < 500, `the database query must not block on mining (took ${elapsed}ms)`);
  assert.equal(response.coverage.state, 'FRESH');
  assert.equal(response.coverage.researchedCount, 5);
});

test('coverage reports honestly rather than implying complete market coverage', async () => {
  const rep = await makeUser('Rep A');

  // Nothing mined yet.
  let coverage = await coverageFor({ geography: { type: 'zip_zcta', value: '32999' } });
  assert.equal(coverage.state, 'NOT_YET_MINED');
  assert.equal(coverage.researchedCount, 0);

  // Some fresh inventory.
  await seedMarketAccounts(3, '32256');
  coverage = await coverageFor({ geography: { type: 'zip_zcta', value: '32256' } });
  assert.equal(coverage.state, 'FRESH');

  // Aged past its window.
  await query(`update accounts set research_fresh_until = now() - interval '1 day'`);
  coverage = await coverageFor({ geography: { type: 'zip_zcta', value: '32256' } });
  assert.equal(coverage.state, 'STALE');

  // A running job is reported as refreshing, not as complete.
  await enqueueMarketResearch({
    verticalProfileId: null, geographyType: 'zip_zcta', geographyValue: '32256',
    marketId: null, requestedBy: rep.userId,
  });
  coverage = await coverageFor({ geography: { type: 'zip_zcta', value: '32256' } });
  assert.equal(coverage.state, 'REFRESHING');
  assert.ok(coverage.activeJobId);
});

test('Research More is idempotent so repeated clicks cannot multiply provider spend', async () => {
  const rep = await makeUser('Rep A', 'SALES_MANAGER');
  const request = {
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32256',
    marketId: null, requestedBy: rep.userId,
  };
  const first = await enqueueMarketResearch(request);
  const second = await enqueueMarketResearch(request);
  const third = await enqueueMarketResearch(request);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(third.created, false);
  assert.equal(second.jobId, first.jobId);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'market_mine'`,
  );
  assert.equal(rows[0]!.n, 1, 'exactly one job exists');
});

test('a refresh run queues stale accounts, tier A first, and skips suppressed ones', async () => {
  const rep = await makeUser('Rep A');
  const ids = await seedMarketAccounts(4);

  // Age everything, then suppress one.
  await query(`update accounts set research_fresh_until = now() - interval '1 day'`);
  await claimAccount(ids[0]!, rep);
  await recordDisposition({ accountId: ids[0]!, disposition: 'DO_NOT_CONTACT', notes: 'remove us' }, rep);

  const plan = await planMarketRefresh({ geographyType: 'zip_zcta', geographyValue: '32256' });
  assert.equal(plan.accountsInScope, 3, 'the suppressed account is out of scope');
  assert.equal(plan.queued, 3);

  const jobs = await query<{ account_id: string }>(
    `select account_id from jobs where job_type = 'account_research'`,
  );
  assert.equal(jobs.rows.some((row) => row.account_id === ids[0]), false,
    'a suppressed company is never re-researched');
});

test('fresh inventory is not needlessly re-researched', async () => {
  await seedMarketAccounts(3);
  const plan = await planMarketRefresh({ geographyType: 'zip_zcta', geographyValue: '32256' });
  assert.equal(plan.staleAccounts, 0);
  assert.equal(plan.queued, 0);
  assert.match(plan.reason, /still fresh/);
});

test('expired evidence is marked stale so it stops reading as current', async () => {
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, { canonicalName: 'Sable Air', website: 'https://sable.example.com' },
      { discoverySource: 'test' }),
  );
  await withTransaction((client) => recordEvidence(client, {
    accountId, category: 'advertising', claimKey: 'active_google_search_ad',
    claimText: 'observed', normalizedValue: 'yes', confidence: 'confirmed',
    canStateAsFact: true, sourceType: 'test',
    expiresAt: new Date(Date.now() - 3600_000),
  }));

  const before = await query(
    `select google_paid from prospect_inventory where account_id = $1`, [accountId],
  );
  assert.notEqual(before.rows[0]!.google_paid, true, 'an expired claim is already excluded from the view');

  const expired = await expireStaleEvidence();
  assert.equal(expired, 1);
  const after = await query(
    `select freshness from evidence_records where account_id = $1`, [accountId],
  );
  assert.equal(after.rows[0]!.freshness, 'stale');
});

test('a market_mine job with no discovery adapter still refreshes and says why', async () => {
  const rep = await makeUser('Ops', 'RESEARCH_OPS');
  await seedMarketAccounts(2);
  await query(`update accounts set research_fresh_until = now() - interval '1 day'`);

  assert.equal(availableDiscoveryAdapters().length, 0, 'none is configured by default');

  const job = await enqueueMarketResearch({
    verticalProfileId: null, geographyType: 'zip_zcta', geographyValue: '32256',
    marketId: null, requestedBy: rep.userId,
  });
  await drainQueue(1);

  const { rows } = await query<{ status: string; progress: any }>(
    'select status, progress from jobs where job_id = $1', [job.jobId],
  );
  assert.equal(rows[0]!.status, 'SUCCEEDED');
  assert.equal(rows[0]!.progress.discovered, 0);
  assert.equal(rows[0]!.progress.refreshQueued, 2, 'existing inventory was refreshed instead');
  assert.match(String(rows[0]!.progress.notes), /source-governance review/);
});

test('a refresh done because no provider exists is not a searched market', async () => {
  const rep = await makeUser('Ops Two', 'RESEARCH_OPS');
  await seedMarketAccounts(2);
  await query(`update accounts set research_fresh_until = now() - interval '1 day'`);

  const job = await enqueueMarketResearch({
    verticalProfileId: null, geographyType: 'zip_zcta', geographyValue: '32256',
    marketId: null, requestedBy: rep.userId,
  });
  await drainQueue(1);

  const { rows } = await query<{ outcome: string; outcome_reason: string }>(
    'select outcome, outcome_reason from jobs where job_id = $1', [job.jobId]);
  assert.equal(rows[0]!.outcome, 'DISCOVERY_BLOCKED');
  assert.match(rows[0]!.outcome_reason, /No search provider is configured/);
});

test('a discovery adapter must be both configured and governance-reviewed to run', async () => {
  const base = {
    name: 'test-provider', requiresCredential: true,
    isConfigured: () => true,
    discover: async () => ({
      status: 'ZERO_RESULTS' as const, businesses: [],
      providerRows: 0, rejectedRows: 0, duplicateRows: 0,
    }),
  };
  registerDiscoveryAdapter({ ...base, name: 'unreviewed', governanceReviewed: false });
  assert.equal(
    availableDiscoveryAdapters().some((a) => a.name === 'unreviewed'), false,
    'a configured but unreviewed source must not run',
  );

  registerDiscoveryAdapter({
    ...base, name: 'reviewed-no-credential', governanceReviewed: true, isConfigured: () => false,
  });
  assert.equal(
    availableDiscoveryAdapters().some((a) => a.name === 'reviewed-no-credential'), false,
    'a reviewed source with no credential cannot run',
  );
});

test('discovered businesses dedupe into existing Accounts and keep ownership', async () => {
  const rep = await makeUser('Rep A');
  const [existing] = await seedMarketAccounts(1);
  await claimAccount(existing!, rep);

  registerDiscoveryAdapter({
    name: 'fixture-discovery',
    requiresCredential: false,
    governanceReviewed: true,
    isConfigured: () => true,
    discover: async () => ({
      status: 'OK' as const,
      businesses: [
        // The same company the rep already owns, spelled differently.
        { name: 'Riverbend Air 0 LLC', website: 'https://riverbend0.example.com',
          city: 'Jacksonville', state: 'FL', postalCode: '32256', resultType: 'paid_search' },
        { name: 'Brand New Air', website: 'https://brandnew.example.com',
          city: 'Jacksonville', state: 'FL', postalCode: '32256', resultType: 'paid_search' },
      ],
      providerRows: 2, rejectedRows: 0, duplicateRows: 0,
    }),
  });

  const job = await enqueueMarketResearch({
    verticalProfileId: null, geographyType: 'zip_zcta', geographyValue: '32256',
    marketId: null, requestedBy: rep.userId,
  });
  await drainQueue(1);

  const { rows } = await query<{ progress: any }>(
    'select progress from jobs where job_id = $1', [job.jobId],
  );
  assert.equal(rows[0]!.progress.discovered, 1, 'only the genuinely new company was created');

  const owner = await query<{ current_owner_user_id: string; ownership_state: string }>(
    'select current_owner_user_id, ownership_state from accounts where account_id = $1', [existing],
  );
  assert.equal(owner.rows[0]!.current_owner_user_id, rep.userId,
    'rediscovery must not reset ownership');

  // The sighting is recorded as an observation, distinct from durable evidence.
  const observations = await query<{ n: number }>(
    `select count(*)::int as n from search_observations where account_id = $1`, [existing],
  );
  assert.equal(observations.rows[0]!.n, 1);
});
