import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { miningKpis } from '../src/api/waveCQueries.js';
import { Rng } from '../src/synthetic/random.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Numbers that have to add up, for any input rather than a chosen one.
 * Authority: Issue #3 Phase Q.
 *
 * The individual truthfulness defects each have their own regression test. These are
 * the invariants underneath them: whatever a provider returns and whatever is
 * already in inventory, the funnel has to reconcile, no counter may go negative, and
 * no source may be counted as a different source. A property that holds for fifty
 * random shapes is a stronger statement than a fixture that holds for one.
 */

let manager: Awaited<ReturnType<typeof makeUser>>;
let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  manager = await makeUser('Invariant Manager', 'SALES_MANAGER');
});

async function seedAccount(name: string, source: string, phone: string): Promise<string> {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name,
    website: `https://inv${++sequence}.invalid`,
    phone,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
  }, { discoverySource: source }));
  return accountId;
}

async function runMining(): Promise<Record<string, any>> {
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: manager.userId });
  await drainQueue(30);
  const { rows } = await query<Record<string, any>>(
    'select outcome, outcome_reason, progress from jobs where job_id = $1', [job.jobId]);
  return rows[0]!;
}

// ------------------------------------------------------- the funnel reconciles --

test('the ingestion funnel reconciles for fifty random provider answers', async () => {
  const failures: string[] = [];

  for (let scenario = 0; scenario < 50; scenario += 1) {
    await resetDatabase();
    await syncVerticalProfiles();
    clearDiscoveryAdapters();
    manager = await makeUser(`Invariant Manager ${scenario}`, 'SALES_MANAGER');

    const rng = new Rng('metrics-invariant', scenario);
    const alreadyHeld = rng.int(0, 4);
    const brandNew = rng.int(0, 5);
    const unusable = rng.int(0, 3);
    const duplicatesCollapsed = rng.int(0, 3);

    // Companies we already hold, which the provider will return again.
    const heldPhones: string[] = [];
    for (let index = 0; index < alreadyHeld; index += 1) {
      const phone = `904-555-${String(1000 + scenario * 20 + index).slice(-4)}`;
      await seedAccount(`Held ${scenario}-${index}`, 'apollo_purchased_import', phone);
      heldPhones.push(phone);
    }

    const businesses = [
      ...heldPhones.map((phone, index) => ({
        name: `Held ${scenario}-${index}`, website: null, phone,
      })),
      ...Array.from({ length: brandNew }, (_, index) => ({
        name: `New ${scenario}-${index}`, website: null,
        phone: `904-555-${String(5000 + scenario * 20 + index).slice(-4)}`,
      })),
      // Rows that identify nothing: a headline with no way to reach anybody.
      ...Array.from({ length: unusable }, (_, index) => ({
        name: `Unusable ${scenario}-${index}`, website: null, phone: null,
      })),
    ];

    registerDiscoveryAdapter({
      name: 'invariant-provider', requiresCredential: false, governanceReviewed: true,
      isConfigured: () => true,
      async discover(): Promise<DiscoveryResult> {
        return {
          status: businesses.length > 0 ? 'OK' : 'ZERO_RESULTS',
          businesses,
          // What the provider sent before the adapter collapsed duplicates.
          providerRows: businesses.length + duplicatesCollapsed,
          rejectedRows: 0,
          duplicateRows: duplicatesCollapsed,
        };
      },
    });

    const before = await query<{ n: number }>('select count(*)::int as n from accounts');
    const job = await runMining();
    const after = await query<{ n: number }>('select count(*)::int as n from accounts');
    const progress = job['progress'] as Record<string, number>;

    const rows = progress['providerRows'] ?? 0;
    const duplicates = progress['providerDuplicates'] ?? 0;
    const rejected = progress['rejectedRows'] ?? 0;
    const matched = progress['matchedExisting'] ?? 0;
    const created = progress['discoveredNew'] ?? 0;
    const label = `scenario ${scenario} (held ${alreadyHeld}, new ${brandNew}, `
      + `unusable ${unusable}, dup ${duplicatesCollapsed})`;

    // Nothing may be negative, ever.
    for (const [key, value] of Object.entries(
      { rows, duplicates, rejected, matched, created })) {
      if (value < 0) failures.push(`${label}: ${key} is ${value}`);
    }

    // Every row the provider sent is accounted for exactly once.
    if (rows !== duplicates + rejected + matched + created) {
      failures.push(`${label}: ${rows} rows != ${duplicates} dup + ${rejected} rejected `
        + `+ ${matched} matched + ${created} created`);
    }

    // What was created is what appeared.
    if (after.rows[0]!.n - before.rows[0]!.n !== created) {
      failures.push(`${label}: reported ${created} new, database grew by `
        + `${after.rows[0]!.n - before.rows[0]!.n}`);
    }

    // A market with rows in it is never a zero-result search.
    if (rows > 0 && job['outcome'] === 'ZERO_RESULTS') {
      failures.push(`${label}: ${rows} rows reported as ZERO_RESULTS`);
    }
  }

  assert.deepEqual(failures, []);
});

test('an empty provider answer is the only thing that reports zero', async () => {
  registerDiscoveryAdapter({
    name: 'empty-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return { status: 'ZERO_RESULTS', businesses: [], providerRows: 0,
        rejectedRows: 0, duplicateRows: 0 };
    },
  });
  const job = await runMining();
  assert.equal(job['outcome'], 'ZERO_RESULTS');

  const progress = job['progress'] as Record<string, number>;
  assert.equal(progress['providerRows'], 0);
  assert.equal(progress['matchedExisting'], 0);
  assert.equal(progress['discoveredNew'], 0);
});

// --------------------------------------------------------- provenance is kept --

test('four sources stay four sources, and they sum to the total', async () => {
  await seedAccount('Miner Found', 'market_miner:dataforseo', '904-555-2001');
  await seedAccount('Miner Found Two', 'serp', '904-555-2002');
  await seedAccount('From A List', 'import', '904-555-2003');
  await seedAccount('From Apollo', 'apollo_purchased_import', '904-555-2004');
  await seedAccount('Demo Row', 'DEMO_FIXTURE', '904-555-2005');
  await seedAccount('Synthetic Row', 'SYNTHETIC_FIXTURE', '904-555-2006');
  await seedAccount('Typed In By Hand', 'manual_entry', '904-555-2007');

  const kpis = await miningKpis();

  // The miner writes `market_miner:<provider>`, and the KPI matched a list of bare
  // provider names -- so every business a provider actually discovered fell through
  // to "created another way", which is the opposite of the defect this KPI was
  // built to fix.
  assert.equal(kpis.discoveredByMinerToday, 2, 'only a search provider is mining output');
  assert.equal(kpis.importedToday, 1);
  assert.equal(kpis.syntheticSeededToday, 2);
  assert.equal(kpis.createdTodayTotal, 7);

  // Apollo and manual entry both land in "another way": neither is mining, and the
  // page says which is which by naming the number rather than by lumping them in.
  assert.equal(kpis.manuallyAddedToday, 2);
  assert.equal(
    kpis.discoveredByMinerToday + kpis.importedToday + kpis.syntheticSeededToday
      + kpis.manuallyAddedToday,
    kpis.createdTodayTotal,
    'the provenance numbers do not add up to the total');
});

test('a demo seed can never inflate what the miner found', async () => {
  for (let index = 0; index < 25; index += 1) {
    await seedAccount(`Demo ${index}`, 'DEMO_FIXTURE', `904-555-${String(3000 + index).slice(-4)}`);
  }
  const kpis = await miningKpis();
  assert.equal(kpis.discoveredByMinerToday, 0,
    'twenty-five demo rows were reported as businesses the miner found');
  assert.equal(kpis.syntheticSeededToday, 25);
});

test('a research timestamp is not a completed research run', async () => {
  const accountId = await seedAccount('Timestamped', 'market_miner:dataforseo', '904-555-4001');
  // A seed writes the timestamp; no research ever ran.
  await query('update accounts set last_researched_at = now() where account_id = $1', [accountId]);

  const kpis = await miningKpis();
  assert.equal(kpis.refreshedByWorkerToday, 0,
    'a timestamp was counted as a research run that happened');
  assert.equal(kpis.freshTimestampToday, 1,
    'and the timestamp figure is still reported, so the two can be compared');
});

test('a failed research run is not a completed one', async () => {
  const accountId = await seedAccount('Failed Research', 'market_miner:dataforseo', '904-555-4002');
  await query(
    `insert into research_runs (account_id, trigger, status, completed_at)
     values ($1, 'newly_discovered', 'failed', now())`, [accountId]);

  const kpis = await miningKpis();
  assert.equal(kpis.refreshedByWorkerToday, 0);
});

test('observing a company in a search is not contacting it', async () => {
  const accountId = await seedAccount('Observed Co', 'apollo_purchased_import', '904-555-4003');
  const before = await query<{ activity_count: string }>(
    'select activity_count from prospect_inventory where account_id = $1', [accountId]);

  await query(
    `insert into activities (account_id, activity_type, channel, source_system)
     values ($1, 'SOURCE_OBSERVED', 'system', 'market_miner:dataforseo')`, [accountId]);

  const after = await query<{ activity_count: string }>(
    'select activity_count from prospect_inventory where account_id = $1', [accountId]);
  assert.equal(Number(after.rows[0]!.activity_count), Number(before.rows[0]!.activity_count),
    'a sighting in a search was counted as an attempt to reach the company');
});

// ------------------------------------------------------------ bounded numbers --

test('no mining KPI is ever negative, whatever the database holds', async () => {
  const rng = new Rng('kpi-bounds');
  for (let index = 0; index < 12; index += 1) {
    const source = rng.pick(['market_miner:dataforseo', 'import', 'DEMO_FIXTURE',
      'apollo_purchased_import', 'manual_entry', 'SYNTHETIC_FIXTURE']);
    await seedAccount(`Bounds ${index}`, source, `904-555-${String(6000 + index).slice(-4)}`);
  }

  const kpis = await miningKpis();
  for (const [key, value] of Object.entries(kpis)) {
    if (typeof value !== 'number') continue;
    assert.ok(value >= 0, `${key} is ${value}`);
    assert.ok(Number.isFinite(value), `${key} is ${value}`);
  }
  assert.ok(kpis.discoveredByMinerToday <= kpis.createdTodayTotal,
    'more accounts were discovered by the miner than were created at all');
  assert.ok(kpis.refreshedByWorkerToday <= kpis.createdTodayTotal + 1000);
});

test('an empty database reports zeroes rather than nulls', async () => {
  const kpis = await miningKpis();
  for (const [key, value] of Object.entries(kpis)) {
    if (typeof value === 'boolean') continue;
    assert.equal(typeof value, 'number', `${key} is ${typeof value}`);
    assert.equal(value, 0, `${key} is ${value}`);
  }
});

test('a refresh-only job never reports external discovery', async () => {
  const ops = await makeUser('Refresh Only Ops', 'RESEARCH_OPS');
  await seedAccount('Existing For Refresh', 'market_miner:dataforseo', '904-555-4501');
  await query(`update accounts set research_fresh_until = now() - interval '10 days'`);

  const { rows } = await query<{ job_id: string }>(
    `insert into jobs (job_type, status, payload, requested_by)
     values ('zip_research', 'QUEUED',
             jsonb_build_object('geography_type','zip_zcta','geography_value','32095'), $1)
     returning job_id`, [ops.userId]);
  await drainQueue(10);

  const { rows: job } = await query<Record<string, any>>(
    'select outcome, progress from jobs where job_id = $1', [rows[0]!.job_id]);
  const progress = job[0]!['progress'] as Record<string, unknown>;
  assert.equal(progress['scope'], 'REFRESH_EXISTING');
  assert.equal(progress['discoveredNew'], 0,
    'a job that only re-researches what we hold reported finding new businesses');
});


test('the miner KPI counts the source string the miner actually writes', async () => {
  // `market_miner:dataforseo` is what ingestDiscoveries records. A KPI matching the
  // bare provider name counted none of it.
  await seedAccount('Prefixed One', 'market_miner:dataforseo', '904-555-7001');
  await seedAccount('Prefixed Two', 'market_miner:some_future_provider', '904-555-7002');

  const kpis = await miningKpis();
  assert.equal(kpis.discoveredByMinerToday, 2,
    'a provider added later would not have been counted until somebody edited a list');
  assert.equal(kpis.manuallyAddedToday, 0,
    'mining output was reported as having been created some other way');
});

test('what the miner actually discovers is counted as mining, end to end', async () => {
  // Not a seeded source string: the real ingestion path writing its own provenance.
  registerDiscoveryAdapter({
    name: 'dataforseo', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return {
        status: 'OK',
        businesses: [{ name: 'End To End Roofing', website: null, phone: '904-555-7101' }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0,
      };
    },
  });

  await runMining();

  const kpis = await miningKpis();
  assert.equal(kpis.discoveredByMinerToday, 1,
    'the business the miner just discovered was not counted as discovered by the miner');
  assert.equal(kpis.createdTodayTotal, 1);
});
