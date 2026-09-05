import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { resetDatabase, makeUser } from './helpers.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  registerDiscoveryAdapter, availableDiscoveryAdapters, clearDiscoveryAdapters,
  type DiscoveryAdapter, type DiscoveryStatus,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { miningKpis, miningJobs } from '../src/api/waveCQueries.js';
import { coverageFor } from '../src/domain/search.js';

/**
 * Operator truthfulness on the mining path.
 * Authority: Issue #2 P0-1, P0-2, P0-3; LIVE-QA-CURRENT-TASK.md.
 *
 * Every case here comes from a real operator session. Michael typed ZIP 32095 into
 * Find Prospects, read "Researching 32095 now", watched a job go green, and was told
 * "0 found". Each of those sentences was true of the code and none of them was true
 * of what he asked for: no search provider is registered, so no new business could
 * have been found in any ZIP.
 *
 * A page is wrong if it reports technical success while the business operation the
 * operator asked for never happened.
 */

let app: FastifyInstance;
const PASSWORD = 'mining-truth-password';

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  // Adapters are registered into a module-level array, so a test that registers one
  // must not leak it into the next -- least of all into the tests asserting what
  // happens when there is no provider at all.
  clearDiscoveryAdapters();
});

let sequence = 0;
async function seedAccount(name: string, source: string, options: {
  postalCode?: string; researchedAt?: string | null; phone?: string;
} = {}): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: name, website: `https://mining${sequence}.invalid`,
      phone: options.phone ?? `904-555-${String(1000 + sequence).slice(-4)}`,
      city: 'St. Augustine', state: 'FL', postalCode: options.postalCode ?? '32095',
    }, { discoverySource: source }));
  if (options.researchedAt) {
    await query(
      `update accounts set last_researched_at = now() - $2::interval,
              research_fresh_until = now() + interval '10 days' where account_id = $1`,
      [accountId, options.researchedAt]);
  }
  return accountId;
}

/** An adapter that returns whatever it is given, without a network. */
function fakeAdapter(input: {
  name?: string; businesses?: { name: string; phone: string }[]; throws?: string;
  status?: DiscoveryStatus; providerRows?: number; reason?: string;
} = {}): DiscoveryAdapter {
  return {
    name: input.name ?? 'fake-provider',
    requiresCredential: false,
    governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      if (input.throws) throw new Error(input.throws);
      const businesses = (input.businesses ?? []).map((business) => ({
        name: business.name, website: null, phone: business.phone,
        city: 'St. Augustine', state: 'FL', postalCode: '32095',
      }));
      return {
        status: input.status ?? (businesses.length > 0 ? 'OK' as const : 'ZERO_RESULTS' as const),
        businesses,
        providerRows: input.providerRows ?? businesses.length,
        rejectedRows: 0, duplicateRows: 0,
        reason: input.reason,
      };
    },
  };
}

async function runMarketJob(geographyValue = '32095'): Promise<Record<string, unknown>> {
  const ops = await makeUser(`Mining Ops ${++sequence}`, 'RESEARCH_OPS');
  const job = await enqueueMarketResearch({
    verticalProfileId: null, geographyType: 'zip_zcta', geographyValue,
    marketId: null, requestedBy: ops.userId,
  });
  await drainQueue();
  const { rows } = await query<Record<string, unknown>>(
    'select status, outcome, outcome_reason, progress, last_error from jobs where job_id = $1',
    [job.jobId]);
  return rows[0]!;
}

// --- P0-1: a market search that could not search --------------------------------

test('a market search with no provider does not report success', async () => {
  // The live defect: SUCCEEDED and "0 found" on a ZIP nobody could have searched.
  const job = await runMarketJob('32095');

  assert.equal(job['status'], 'SUCCEEDED', 'the handler ran, which is a queue fact');
  assert.equal(job['outcome'], 'DISCOVERY_BLOCKED',
    'a search that could not search reported a successful outcome');
  assert.match(String(job['outcome_reason']), /No search provider is configured/);
  const progress = job['progress'] as Record<string, unknown>;
  assert.equal(progress['discoveryAvailable'], false);
  assert.equal(progress['discoveredNew'], 0);
});

test('a genuine zero is told apart from a search that never happened', async () => {
  registerDiscoveryAdapter(fakeAdapter({ businesses: [] }));
  const searched = await runMarketJob('32095');
  assert.equal(searched['outcome'], 'ZERO_RESULTS',
    'a provider that was asked and answered nothing is not a blocked search');
  assert.match(String(searched['outcome_reason']), /searched this market and returned nothing/);

  clearDiscoveryAdapters();
  const blocked = await runMarketJob('32095');
  assert.equal(blocked['outcome'], 'DISCOVERY_BLOCKED');
  assert.notEqual(blocked['outcome'], searched['outcome'],
    'a blocked search and a genuine zero report the same thing');
});

test('a provider that fails is never reported as a market with nothing in it',
  async () => {
    registerDiscoveryAdapter(fakeAdapter({ throws: 'provider returned 503' }));
    const job = await runMarketJob('32095');

    assert.equal(job['outcome'], 'PROVIDER_UNAVAILABLE',
      'a provider outage was reported as a successful empty search');
    assert.match(String(job['outcome_reason']), /503/);
    // And the job did not fail outright: the refresh half of the work still ran.
    assert.equal(job['status'], 'SUCCEEDED');
  });

test('one provider failing among several is partial, not complete', async () => {
  registerDiscoveryAdapter(fakeAdapter({
    name: 'good-provider',
    businesses: [{ name: 'Discovered Roofing', phone: '904-555-7001' }],
  }));
  registerDiscoveryAdapter(fakeAdapter({ name: 'bad-provider', throws: 'timeout' }));

  const job = await runMarketJob('32095');
  assert.equal(job['outcome'], 'PARTIAL');
  assert.match(String(job['outcome_reason']), /1 provider\(s\) answered and 1 could not/);
  assert.match(String(job['outcome_reason']), /part of the market, not all of it/);
  const progress = job['progress'] as Record<string, unknown>;
  assert.equal(progress['discoveredNew'], 1);
});

test('a provider that finds something reports what it found', async () => {
  registerDiscoveryAdapter(fakeAdapter({
    businesses: [
      { name: 'Discovered Air', phone: '904-555-7101' },
      { name: 'Discovered Plumbing', phone: '904-555-7102' },
    ],
  }));
  const job = await runMarketJob('32095');
  assert.equal(job['outcome'], 'COMPLETED');
  const progress = job['progress'] as Record<string, unknown>;
  assert.equal(progress['discoveredNew'], 2);
  assert.match(String(job['outcome_reason']), /2 new business\(es\) added/);

  // The whole funnel, not only the survivors. "Two rows" and "two businesses" are
  // the same number here only because nothing was dropped, and the row says so.
  assert.equal(progress['providerRows'], 2);
  assert.equal(progress['matchedExisting'], 0);
  assert.equal(progress['rejectedRows'], 0);
  assert.equal(progress['researchQueued'], 2,
    'a discovered business with no research is a name and a phone number');
});

test('a provider that only returns companies we already have has not found zero', async () => {
  // Twelve companies matched is twelve companies found. Reporting that as a
  // zero-result search tells the operator the market is empty when it is full of
  // businesses we already know about.
  await seedAccount('Already Known Roofing', 'apollo_purchased_import',
    { phone: '904-555-7201' });
  registerDiscoveryAdapter(fakeAdapter({
    businesses: [{ name: 'Already Known Roofing', phone: '904-555-7201' }],
  }));

  const job = await runMarketJob('32095');
  assert.equal(job['outcome'], 'COMPLETED',
    'the provider searched and found a business; it was simply one we hold');
  const progress = job['progress'] as Record<string, unknown>;
  assert.equal(progress['providerRows'], 1);
  assert.equal(progress['matchedExisting'], 1);
  assert.equal(progress['discoveredNew'], 0);
  assert.match(String(job['outcome_reason']), /1 already in inventory/);
});

test('a row with nothing to reach the business by never becomes an Account', async () => {
  registerDiscoveryAdapter({
    name: 'sloppy-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return {
        status: 'OK' as const,
        businesses: [
          { name: 'Real Roofing', phone: '904-555-7301' },
          // A name and nothing else: a rep who opens this finds a company with no
          // way to reach it and no way to tell whether it exists.
          { name: 'Just A Headline', website: null, phone: null },
          { name: '', website: 'https://blank.example.com' },
        ],
        providerRows: 3, rejectedRows: 0, duplicateRows: 0,
      };
    },
  });

  const job = await runMarketJob('32095');
  const progress = job['progress'] as Record<string, unknown>;
  assert.equal(progress['discoveredNew'], 1);
  assert.equal(progress['rejectedRows'], 2, 'the unusable rows are counted, not silently dropped');
  assert.match(String(job['outcome_reason']), /2 unusable/);

  const accounts = await query<{ canonical_name: string }>('select canonical_name from accounts');
  assert.deepEqual(accounts.rows.map((row) => row.canonical_name), ['Real Roofing']);
});

test('a provider whose task is still queued is pending, not empty', async () => {
  registerDiscoveryAdapter({
    name: 'slow-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return {
        status: 'PENDING' as const, businesses: [],
        providerRows: 0, rejectedRows: 0, duplicateRows: 0,
        providerTaskId: 'task-abc',
        reason: 'The provider accepted the search and has not finished it yet.',
      };
    },
  });

  const job = await runMarketJob('32095');
  assert.equal(job['outcome'], 'PROVIDER_PENDING',
    'a paid search still running is neither a success nor an empty market');
  assert.match(String(job['outcome_reason']), /not ready yet/);
  const progress = job['progress'] as Record<string, unknown>;
  assert.deepEqual(progress['providerTaskIds'], ['task-abc']);
});

test('a provider refusal is reported as its own kind of refusal', async () => {
  for (const status of ['CREDENTIALS_INVALID', 'RATE_LIMITED', 'TIMEOUT', 'OUTAGE',
    'BUDGET_EXHAUSTED', 'NOT_CONFIGURED', 'GOVERNANCE_BLOCKED', 'MALFORMED'] as const) {
    clearDiscoveryAdapters();
    registerDiscoveryAdapter(fakeAdapter({
      businesses: [], status, reason: `refused: ${status}` }));

    const job = await runMarketJob('32095');
    assert.equal(job['outcome'], 'PROVIDER_UNAVAILABLE',
      `${status} was reported as ${job['outcome']}`);
    assert.notEqual(job['outcome'], 'ZERO_RESULTS');
    assert.match(String(job['outcome_reason']), /not known whether/);
    const progress = job['progress'] as Record<string, unknown>;
    assert.deepEqual(progress['providerStatuses'], [status]);
  }
});

test('a refresh-only job says it did not look for new businesses', async () => {
  await seedAccount('Existing Co', 'test');
  await query(`update accounts set research_fresh_until = now() - interval '10 days'`);
  const ops = await makeUser('Refresh Ops', 'RESEARCH_OPS');
  const { rows } = await query<{ job_id: string }>(
    `insert into jobs (job_type, payload, status, requested_by)
     values ('zip_research', '{"geography_type":"zip_zcta","geography_value":"32095"}'::jsonb,
             'QUEUED', $1) returning job_id`, [ops.userId]);
  await drainQueue();

  const { rows: after } = await query<Record<string, unknown>>(
    'select outcome, outcome_reason, progress from jobs where job_id = $1', [rows[0]!.job_id]);
  const progress = after[0]!['progress'] as Record<string, unknown>;
  assert.equal(progress['scope'], 'REFRESH_EXISTING');
  assert.equal(progress['discoveredNew'], 0);
  assert.match(String(after[0]!['outcome_reason']), /does not\s+look for new businesses|only refreshes/);
});

// --- the page a person reads ------------------------------------------------------

test('the mining page says the search could not search', async () => {
  await createUser({
    email: 'mining.ops@test.local', displayName: 'Mining Ops', role: 'RESEARCH_OPS',
    password: PASSWORD });
  await runMarketJob('32095');

  const login = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: 'mining.ops@test.local', password: PASSWORD } });
  const cookie = login.cookies.find((c) => c.name === 'yad_sales_session')!;
  const page = await app.inject({
    method: 'GET', url: '/mining',
    headers: { cookie: `yad_sales_session=${cookie.value}` } });

  assert.equal(page.statusCode, 200);
  assert.match(page.body, /New-business discovery is not available/);
  assert.match(page.body, /Could not search/);
  assert.match(page.body, /No search provider is configured/);
  // And the word that started this must not be on the row.
  assert.equal(/>\s*Succeeded\s*</.test(page.body), false,
    'the mining page still calls a blocked search "Succeeded"');
});

test('the mining page separates new businesses from refreshed ones', async () => {
  await createUser({
    email: 'mining.ops2@test.local', displayName: 'Mining Ops 2', role: 'RESEARCH_OPS',
    password: PASSWORD });
  await seedAccount('Refreshable Co', 'test');
  await query(`update accounts set research_fresh_until = now() - interval '10 days'`);
  registerDiscoveryAdapter(fakeAdapter({
    businesses: [{ name: 'Newly Found Co', phone: '904-555-7201' }] }));
  await runMarketJob('32095');

  const login = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: 'mining.ops2@test.local', password: PASSWORD } });
  const cookie = login.cookies.find((c) => c.name === 'yad_sales_session')!;
  const page = await app.inject({
    method: 'GET', url: '/mining',
    headers: { cookie: `yad_sales_session=${cookie.value}` } });

  assert.match(page.body, /New businesses/);
  assert.match(page.body, /Existing refreshed/);
  assert.match(page.body, /Found new businesses/);
});

// --- P0-2: where today's accounts came from ---------------------------------------

test('demo seed is never counted as mining output', async () => {
  // The live defect: "Accounts added today: 59" on the Mining page, where all 59
  // were synthetic seed rows.
  for (let i = 0; i < 5; i += 1) await seedAccount(`Seeded ${i}`, 'SYNTHETIC_FIXTURE');
  for (let i = 0; i < 3; i += 1) await seedAccount(`Imported ${i}`, 'import');
  for (let i = 0; i < 2; i += 1) await seedAccount(`Miner ${i}`, 'dataforseo');
  await seedAccount('By Hand', 'manual_entry');

  const kpis = await miningKpis();
  assert.equal(kpis.discoveredByMinerToday, 2,
    'the miner figure counted accounts the miner did not find');
  assert.equal(kpis.syntheticSeededToday, 5);
  assert.equal(kpis.importedToday, 3);
  assert.equal(kpis.manuallyAddedToday, 1);
  assert.equal(kpis.createdTodayTotal, 11);
  // And the four sources account for everything.
  assert.equal(
    kpis.discoveredByMinerToday + kpis.syntheticSeededToday + kpis.importedToday
      + kpis.manuallyAddedToday,
    kpis.createdTodayTotal,
    'the provenance breakdown does not add up to what was created');
});

test('the mining page labels every source, and only one of them as mining', async () => {
  await createUser({
    email: 'mining.ops3@test.local', displayName: 'Mining Ops 3', role: 'RESEARCH_OPS',
    password: PASSWORD });
  for (let i = 0; i < 4; i += 1) await seedAccount(`Demo ${i}`, 'DEMO_FIXTURE');

  const login = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: 'mining.ops3@test.local', password: PASSWORD } });
  const cookie = login.cookies.find((c) => c.name === 'yad_sales_session')!;
  const page = await app.inject({
    method: 'GET', url: '/mining',
    headers: { cookie: `yad_sales_session=${cookie.value}` } });

  assert.match(page.body, /Where today’s accounts came from/);
  assert.match(page.body, /Synthetic or demo fixture/);
  assert.match(page.body, /These are test data and are not prospects/);
  // The headline miner number is zero, because the miner found nothing.
  assert.match(page.body, /Discovered by the miner/);
  assert.equal(/Accounts added today/.test(page.body), false,
    'the page still shows the ambiguous counter that started this');
});

// --- P0-3: refreshed by a worker, not by a timestamp -------------------------------

test('a seeded research timestamp does not count as a worker refresh', async () => {
  // The live defect: "Accounts refreshed: 58" where the 58 were seed rows carrying a
  // recent last_researched_at and no research run had ever completed.
  for (let i = 0; i < 6; i += 1) {
    await seedAccount(`Fresh Timestamp ${i}`, 'SYNTHETIC_FIXTURE', { researchedAt: '1 hour' });
  }

  const kpis = await miningKpis();
  assert.equal(kpis.refreshedByWorkerToday, 0,
    'six seeded timestamps were reported as six worker refreshes');
  assert.equal(kpis.freshTimestampToday, 6,
    'the timestamp figure is still reported, beside the worker one');
});

test('a completed research run does count as a worker refresh', async () => {
  const accountId = await seedAccount('Really Refreshed Co', 'test');
  await query(
    `insert into research_runs (account_id, trigger, status, started_at, completed_at)
     values ($1, 'scheduled_refresh', 'completed', now() - interval '5 minutes', now())`,
    [accountId]);

  const kpis = await miningKpis();
  assert.equal(kpis.refreshedByWorkerToday, 1);
});

test('a research run that failed is not a refresh', async () => {
  const accountId = await seedAccount('Failed Research Co', 'test');
  await query(
    `insert into research_runs (account_id, trigger, status, started_at, completed_at)
     values ($1, 'scheduled_refresh', 'failed', now() - interval '5 minutes', now())`,
    [accountId]);

  const kpis = await miningKpis();
  assert.equal(kpis.refreshedByWorkerToday, 0,
    'a failed research run was counted as a refresh');
});

// --- the Find Prospects sentence Michael actually read -----------------------------

test('Find Prospects does not promise results that cannot arrive', async () => {
  await seedAccount('In The ZIP Co', 'test');
  const ops = await makeUser('Coverage Ops', 'RESEARCH_OPS');
  await query(
    `insert into jobs (job_type, payload, status, requested_by)
     values ('market_mine', '{"geography_type":"zip_zcta","geography_value":"32095"}'::jsonb,
             'RUNNING', $1)`, [ops.userId]);

  const coverage = await coverageFor({
    geography: { type: 'zip_zcta', value: '32095' } });
  assert.equal(coverage.state, 'REFRESHING');
  assert.equal(coverage.discoveryAvailable, false);
  assert.equal(coverage.activeJobScope, 'REFRESH_EXISTING',
    'a job that cannot discover was described as discovering');
});

test('with a provider configured, a running market job is a real search', async () => {
  registerDiscoveryAdapter(fakeAdapter());
  await seedAccount('Provider Present Co', 'test');
  const ops = await makeUser('Coverage Ops 2', 'RESEARCH_OPS');
  await query(
    `insert into jobs (job_type, payload, status, requested_by)
     values ('market_mine', '{"geography_type":"zip_zcta","geography_value":"32095"}'::jsonb,
             'RUNNING', $1)`, [ops.userId]);

  const coverage = await coverageFor({
    geography: { type: 'zip_zcta', value: '32095' } });
  assert.equal(coverage.discoveryAvailable, true);
  assert.equal(coverage.activeJobScope, 'DISCOVER_NEW');
});

test('the Find Prospects page says when it cannot search a market', async () => {
  await createUser({
    email: 'coverage.rep@test.local', displayName: 'Coverage Rep', role: 'SALES_REP',
    password: PASSWORD });
  const login = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: 'coverage.rep@test.local', password: PASSWORD } });
  const cookie = login.cookies.find((c) => c.name === 'yad_sales_session')!;

  const page = await app.inject({
    method: 'GET', url: '/find?where=32095',
    headers: { cookie: `yad_sales_session=${cookie.value}` } });

  assert.equal(page.statusCode, 200);
  assert.match(page.body, /New-business search is unavailable/);
  assert.match(page.body, /does not mean/);
  // The sentence that misled: it must not appear while nothing can be found.
  assert.equal(/new ones will appear as they land/.test(page.body), false,
    'the page still promises new results while discovery is blocked');
});

test('a refresh job in flight does not say new businesses will appear', async () => {
  await createUser({
    email: 'coverage.rep2@test.local', displayName: 'Coverage Rep 2', role: 'SALES_REP',
    password: PASSWORD });
  await seedAccount('Refreshing Co', 'test');
  const ops = await makeUser('Coverage Ops 3', 'RESEARCH_OPS');
  await query(
    `insert into jobs (job_type, payload, status, requested_by)
     values ('zip_research', '{"geography_type":"zip_zcta","geography_value":"32095"}'::jsonb,
             'RUNNING', $1)`, [ops.userId]);

  const login = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: 'coverage.rep2@test.local', password: PASSWORD } });
  const cookie = login.cookies.find((c) => c.name === 'yad_sales_session')!;
  const page = await app.inject({
    method: 'GET', url: '/find?where=32095',
    headers: { cookie: `yad_sales_session=${cookie.value}` } });

  assert.match(page.body, /does not look for new businesses/);
});

// --- the job list a person reads ---------------------------------------------------

test('the job list carries the outcome, not just the queue status', async () => {
  await runMarketJob('32095');
  const jobs = await miningJobs();
  const mineJob = jobs.find((job: any) => job.job_type === 'market_mine')!;
  assert.equal(mineJob.status, 'SUCCEEDED');
  assert.equal(mineJob.outcome, 'DISCOVERY_BLOCKED');
  assert.ok(String(mineJob.outcome_reason).length > 20);
  assert.equal(mineJob.discovered_new, 0);
  assert.equal(mineJob.discovery_available, false);
});


// --------------------------------------------------- what the page says it did --

test('the mining page shows the arithmetic, not just the answer', async () => {
  await seedAccount('Already Held Air', 'apollo_purchased_import', { phone: '904-555-7401' });
  registerDiscoveryAdapter({
    name: 'funnel-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return {
        status: 'OK' as const,
        businesses: [
          { name: 'Already Held Air', phone: '904-555-7401' },
          { name: 'Brand New Air', phone: '904-555-7402' },
          { name: 'Unreachable Headline' },
        ],
        // The provider sent more rows than these three: two were the same company
        // twice, and the adapter collapsed them before handing them up.
        providerRows: 5, rejectedRows: 0, duplicateRows: 2,
      };
    },
  });

  await runMarketJob('32095');

  await createUser({
    email: 'funnel.ops@test.local', displayName: 'Funnel Ops', role: 'RESEARCH_OPS',
    password: PASSWORD });
  const login = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: 'funnel.ops@test.local', password: PASSWORD } });
  const session = login.cookies.find((c) => c.name === 'yad_sales_session')!;
  const page = await app.inject({
    method: 'GET', url: '/mining',
    headers: { cookie: `yad_sales_session=${session.value}` } });
  assert.equal(page.statusCode, 200);

  // Every step between the provider's answer and inventory is on the page, so the
  // operator can check that five rows becoming one new Account was dedupe rather
  // than a broken filter.
  assert.match(page.body, /5 provider row\(s\)/);
  assert.match(page.body, /2 duplicate/);
  assert.match(page.body, /1 unusable/);
  assert.match(page.body, /1 already held/);
  assert.match(page.body, /1 new/);
});

test('a discovered business is queued for research, not left as a name and a number',
  async () => {
    registerDiscoveryAdapter(fakeAdapter({
      businesses: [{ name: 'Needs Research Roofing', phone: '904-555-7501' }],
    }));
    await runMarketJob('32095');

    const { rows } = await query<{ job_type: string; status: string; account_id: string }>(
      `select job_type, status, account_id from jobs where job_type = 'account_research'`);
    assert.equal(rows.length, 1, 'a discovered Account with no research is not a prospect');

    const account = await query<{ canonical_name: string }>(
      'select canonical_name from accounts where account_id = $1', [rows[0]!.account_id]);
    assert.equal(account.rows[0]!.canonical_name, 'Needs Research Roofing');
  });

test('a discovered business is findable by the search that discovered it', async () => {
  registerDiscoveryAdapter(fakeAdapter({
    businesses: [{ name: 'Findable Roofing', phone: '904-555-7601' }],
  }));
  await runMarketJob('32095');

  // Without a location the business is invisible to the ZIP search that found it:
  // the operator searches 32095 again and the company they just discovered is not
  // in the results.
  const { rows } = await query<{ postal_code: string; location_type: string }>(
    `select l.postal_code, l.location_type from locations l
       join accounts a on a.account_id = l.account_id
      where a.canonical_name = 'Findable Roofing'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.postal_code, '32095');
  assert.equal(rows[0]!.location_type, 'service_area',
    'the ZIP is how we found them, not a street address we were given');
});


test('a discovered advertiser is actually stored as an observation', async () => {
  // The adapter normalizes provider item types into its own words; the column has a
  // check constraint with a different set; nothing matched. Every value the
  // DataForSEO adapter produces was rejected by the database, so the first row of
  // the first real discovery would have thrown, failed the job, retried and failed
  // again. It never showed while no provider was configured, because a fixture
  // adapter that sets no result type writes a null the column accepts.
  registerDiscoveryAdapter({
    name: 'typed-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return {
        status: 'OK' as const,
        businesses: [
          { name: 'Paid Ad Roofing', website: null, phone: '904-555-7701',
            resultType: 'PAID_SEARCH_TEXT', advertisedService: 'roof repair',
            landingUrl: 'https://paidad.example.com/roofing' },
          { name: 'Local Pack Roofing', website: null, phone: '904-555-7702',
            resultType: 'MAPS_LOCAL' },
          { name: 'Organic Roofing', website: null, phone: '904-555-7703',
            resultType: 'ORGANIC' },
        ],
        providerRows: 3, rejectedRows: 0, duplicateRows: 0,
      };
    },
  });

  const job = await runMarketJob('32095');
  assert.equal(job['outcome'], 'COMPLETED', String(job['last_error'] ?? job['outcome_reason']));

  const { rows } = await query<{ observed_name: string; result_type: string }>(
    `select observed_name, result_type from search_observations order by observed_name`);
  assert.equal(rows.length, 3, 'the observations never reached the table');
  assert.deepEqual(rows.map((row) => row.result_type),
    ['local_result', 'organic', 'paid_search']);
});

test('a result type nobody recognises is stored as unclassified, not guessed', async () => {
  registerDiscoveryAdapter({
    name: 'odd-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return {
        status: 'OK' as const,
        businesses: [{
          name: 'Odd Type Roofing', website: null, phone: '904-555-7801',
          resultType: 'SOMETHING_NEW_THE_PROVIDER_INVENTED',
        }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0,
      };
    },
  });

  await runMarketJob('32095');
  const { rows } = await query<{ result_type: string | null }>(
    'select result_type from search_observations');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.result_type, null,
    'an unclassified observation is honest; a mislabelled paid placement is manufactured ad evidence');
});
