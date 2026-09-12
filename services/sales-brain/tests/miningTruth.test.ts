import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
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
import { observationsFor, junkObservations } from './support/observations.js';

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
  await syncVerticalProfiles();
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
      const specs = input.businesses ?? [];
      const observations = [
        ...observationsFor(specs),
        // Rows the provider returned that identify nothing. A fixture used to declare
        // a `providerRows` larger than its businesses and the orchestrator believed
        // it; now the junk has to actually be in the response, which is the only way
        // the funnel arithmetic can be tested rather than asserted.
        ...junkObservations(Math.max(0, (input.providerRows ?? specs.length) - specs.length)),
      ];
      return {
        status: input.status ?? 'OK' as const,
        observations,
        reason: input.reason,
      };
    },
  };
}

async function runMarketJob(geographyValue = '32095'): Promise<Record<string, unknown>> {
  const ops = await makeUser(`Mining Ops ${++sequence}`, 'RESEARCH_OPS');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue,
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
        observations: [
          ...observationsFor([{ name: 'Real Roofing', phone: '904-555-7301' }]),
          // A name and nothing else: a rep who opens this finds a company with no
          // way to reach it and no way to tell whether it exists.
          ...junkObservations(2),
        ],
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
        status: 'PENDING' as const, observations: [],
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
        observations: [
          ...observationsFor([
            { name: 'Already Held Air', phone: '904-555-7401' },
            { name: 'Brand New Air', phone: '904-555-7402' },
          ]),
          // The same company twice. The duplicate is a row the provider really sent,
          // not a number an adapter asserted about rows nobody can see.
          ...observationsFor([{ name: 'Already Held Air', phone: '904-555-7401' }]),
          ...observationsFor([{ name: 'Brand New Air', phone: '904-555-7402' }]),
          // A headline with nothing to reach it by.
          ...junkObservations(1),
        ],
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

  // Findable, without inventing an address for them.
  //
  // This used to be a `locations` row holding the searched ZIP, which is the defect
  // the P0 work removed: 65 of 65 canary Accounts claimed a physical location nobody
  // had observed, including a Jacksonville company and one whose own page said
  // 32080. The provider gave no address, so there is no location -- and the company
  // is still in the market it was found in, because that is recorded as what it is.
  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from locations l
       join accounts a on a.account_id = l.account_id
      where a.canonical_name = 'Findable Roofing'`);
  assert.equal(rows[0]!.n, 0, 'a physical location was manufactured from the search ZIP');

  const { rows: provenance } = await query<{ g: string | null; t: string | null }>(
    `select discovered_for_geography as g, discovered_for_geography_type as t
       from accounts where canonical_name = 'Findable Roofing'`);
  assert.equal(provenance[0]!.g, '32095',
    'the company is invisible to the ZIP search that found it');
  assert.equal(provenance[0]!.t, 'zip_zcta');

  // And the rep's search of that ZIP finds them.
  const ops = await makeUser(`Findable Viewer ${Math.random()}`, 'SALES_MANAGER');
  const { searchProspects } = await import('../src/domain/search.js');
  const found = await searchProspects(
    { geography: { type: 'zip_zcta', value: '32095' }, pageSize: 50 },
    { userId: ops.userId, role: 'SALES_MANAGER' });
  assert.ok(found.results.some((row) => row.company_name === 'Findable Roofing'),
    'the company the search discovered is not in the results of that search');
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
        observations: observationsFor([
          { name: 'Paid Ad Roofing', website: null, phone: '904-555-7701',
            resultType: 'PAID_SEARCH_TEXT', advertisedService: 'roof repair',
            landingUrl: 'https://paidad.example/roofing' },
          { name: 'Local Pack Roofing', website: null, phone: '904-555-7702',
            resultType: 'MAPS_LOCAL' },
          { name: 'Organic Roofing', website: null, phone: '904-555-7703',
            resultType: 'ORGANIC' },
        ]),
      };
    },
  });

  const job = await runMarketJob('32095');
  assert.equal(job['outcome'], 'COMPLETED', String(job['last_error'] ?? job['outcome_reason']));

  // Every row is recorded, so the advertiser contributes two: the ad, and the listing
  // that says whose ad it is. Grouped by company, because the question is whether a
  // provider's own word survived into the column's vocabulary -- not how many rows a
  // fixture happens to send.
  const { rows } = await query<{ observed_name: string; result_type: string | null }>(
    `select observed_name, result_type from search_observations
      order by observed_name, result_type`);
  const byCompany = new Map<string, string[]>();
  for (const row of rows) {
    byCompany.set(row.observed_name,
      [...(byCompany.get(row.observed_name) ?? []), row.result_type ?? 'null'].sort());
  }
  assert.deepEqual(byCompany.get('Paid Ad Roofing'), ['local_result', 'paid_search'],
    'the provider’s own word for a paid placement did not reach the column');
  assert.deepEqual(byCompany.get('Local Pack Roofing'), ['local_result']);
  assert.deepEqual(byCompany.get('Organic Roofing'), ['organic']);
});

test('a result type nobody recognises is stored as unclassified, not guessed', async () => {
  registerDiscoveryAdapter({
    name: 'odd-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return {
        status: 'OK' as const,
        observations: observationsFor([{
          name: 'Odd Type Roofing', website: null, phone: '904-555-7801',
          resultType: 'SOMETHING_NEW_THE_PROVIDER_INVENTED',
        }]),
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

test('a company found by business listings counts as mining, not as typed in by hand', async () => {
  // The mining KPIs kept their own copy of "which sources are the miner", and when
  // business listings became a second discovery source the copy did not know. A
  // company a provider found fell through to "created another way", which on that
  // page reads as somebody having entered it manually: the miner looked idle and a
  // person looked busy, and both were false.
  const { ingestListings } = await import('../src/miner/listingsIngest.js');
  await ingestListings({
    listings: [{
      providerListingId: 'kpi-1', name: 'KPI Listings Co', domain: 'kpilistings.invalid',
      phone: '+1 904-555-9500', address: '5 Main St', city: 'St. Augustine',
      state: 'FL', postalCode: '32095', category: 'HVAC contractor',
      rating: null, reviewCount: null, observedAt: new Date(),
    }],
    provider: 'fixture-listings', verticalProfileId: 'hvac',
  });

  const kpis = await miningKpis();
  assert.equal(kpis.discoveredByMinerToday, 1,
    'a company a provider found was not counted as mining output');
  assert.equal(kpis.manuallyAddedToday, 0,
    'a company a provider found was reported as manually added by a person');
});

test('every automated source the product writes is counted as mining', async () => {
  const {
    AUTOMATED_DISCOVERY_PREFIXES, automatedDiscoveryPredicate,
  } = await import('../src/domain/discoverySources.js');

  // The predicate the KPIs use is built from the shared list, so the two cannot
  // drift. Asserted rather than assumed, because they drifted once already.
  const predicate = automatedDiscoveryPredicate('x');
  for (const prefix of AUTOMATED_DISCOVERY_PREFIXES) {
    assert.ok(predicate.includes(`'${prefix}%'`),
      `${prefix} is a discovery source the mining KPIs do not count`);
  }
});

// ------------------------------- found in an ad, and known to be advertising ----

/**
 * The gap the whole strategy sat on.
 *
 * `advertiser_first` mining selects companies *because* they are advertising. The
 * miner recorded that it saw a paid result -- query, position, headline, the
 * provider's own timestamp -- and then wrote no evidence. Both things a rep and the
 * scorer read come from `evidence_records`: the advertiser panel, which said "nobody
 * has looked" about a company we found in an ad, and the Module 4C rule worth +4,
 * which every vertical profile declares as `evidence_claim_key:
 * active_google_search_ad`. Nothing populated either.
 *
 * Found by opening the account page and following what it reads.
 */
function advertiserAdapter(businesses: {
  name: string; phone: string; resultType: string; query?: string; position?: number;
  adHeadline?: string; observedAt?: Date;
}[]): DiscoveryAdapter {
  return {
    name: 'ad-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return {
        status: 'OK' as const,
        observations: observationsFor(businesses.map((business) => ({
          name: business.name, website: null, phone: business.phone,
          resultType: business.resultType, query: business.query ?? null,
          position: business.position ?? null, adHeadline: business.adHeadline ?? null,
          observedAt: business.observedAt ?? null,
        }))),
      };
    },
  };
}

async function adEvidence(name: string) {
  const { rows } = await query<{
    claim_key: string; claim_text: string; confidence: string;
    can_state_as_fact: boolean; source_type: string; source_provider: string | null;
    source_reference: string | null; expires_at: Date; notes: string | null;
  }>(
    `select e.claim_key, e.claim_text, e.confidence, e.can_state_as_fact, e.source_type,
            e.source_provider, e.source_reference, e.expires_at, e.notes
       from evidence_records e join accounts a using (account_id)
      where a.canonical_name = $1 and e.category = 'paid_acquisition'
      order by e.claim_key`, [name]);
  return rows;
}

test('a company found in a paid result is known to be advertising', async () => {
  registerDiscoveryAdapter(advertiserAdapter([
    { name: 'Coastal Air Paid', phone: '904-555-6001', resultType: 'PAID_SEARCH_TEXT',
      query: 'ac repair 32095', position: 1, adHeadline: 'Same-Day AC Repair',
      observedAt: new Date('2026-09-05T04:12:00Z') },
  ]));
  const job = await runMarketJob();
  assert.equal(job.status, 'SUCCEEDED');
  assert.equal((job.progress as any).adEvidenceWritten, 1,
    'the observation was recorded and no advertiser evidence came of it');

  const [evidence] = await adEvidence('Coastal Air Paid');
  assert.ok(evidence, 'a company discovered from an ad has no advertising evidence');
  assert.equal(evidence!.claim_key, 'active_google_search_ad',
    'the claim key every vertical profile declares for the +4 rule');
  assert.equal(evidence!.confidence, 'confirmed',
    'the profiles require confirmed confidence, or the rule cannot fire');
  assert.equal(evidence!.can_state_as_fact, true);
  assert.equal(evidence!.source_type, 'provider_serp');
  assert.equal(evidence!.source_provider, 'ad-provider');

  // What a rep may say: what was seen, for which search, on which day.
  assert.match(evidence!.claim_text, /paid Google search result was observed/);
  assert.match(evidence!.claim_text, /"ac repair 32095"/);
  assert.match(evidence!.claim_text, /2026-09-05/);
  assert.doesNotMatch(evidence!.claim_text, /spend|budget|\$/i,
    'evidence a rep reads aloud must say nothing about what the advertising costs');

  // 48 hours from the provider's own observation, per the §14 matrix -- not from
  // when we happened to collect it.
  const expected = new Date('2026-09-05T04:12:00Z').getTime() + 48 * 3_600_000;
  assert.equal(new Date(evidence!.expires_at).getTime(), expected);
});

test('the score the profiles specify can now actually be earned', async () => {
  registerDiscoveryAdapter(advertiserAdapter([
    { name: 'Scoreable Air', phone: '904-555-6002', resultType: 'PAID_SEARCH_TEXT',
      query: 'ac repair 32095', position: 2 },
  ]));
  await runMarketJob();

  const { rows } = await query<{ account_id: string }>(
    "select account_id from accounts where canonical_name = 'Scoreable Air'");
  const { recognizeSignals } = await import('../src/scoring/recognize.js');
  const signals = await recognizeSignals(rows[0]!.account_id);
  const google = signals['google_paid_search_confirmed'];
  const qualified = typeof google === 'object' ? google.qualified : Boolean(google);
  assert.equal(qualified, true,
    'the largest scoring input in the advertiser-first strategy still cannot fire');
});

test('a Local Services ad is its own claim, and a shopping ad is neither', async () => {
  registerDiscoveryAdapter(advertiserAdapter([
    { name: 'Lsa Air', phone: '904-555-6003', resultType: 'LOCAL_SERVICES_AD',
      query: 'ac repair 32095', position: 1 },
    // Paid, and not evidence that a contractor runs search ads. The stored
    // projection collapses this into `paid_search`, which is why the promotion
    // reads the provider's own type instead.
    { name: 'Shopping Air', phone: '904-555-6004',
      resultType: 'SHOPPING_OR_IRRELEVANT_PAID', query: 'ac repair 32095', position: 3 },
    // Paid, but neither the text-ad claim nor an LSA. It stays an observation.
    { name: 'Sponsored Local Air', phone: '904-555-6005', resultType: 'PAID_LOCAL',
      query: 'ac repair 32095', position: 2 },
  ]));
  await runMarketJob();

  assert.equal((await adEvidence('Lsa Air'))[0]?.claim_key, 'active_local_service_ad');
  assert.deepEqual(await adEvidence('Shopping Air'), [],
    'a shopping ad was promoted to a claim that a company runs search ads');
  assert.deepEqual(await adEvidence('Sponsored Local Air'), [],
    'a sponsored local result was promoted to a claim it does not prove');
});

test('an organic result never becomes evidence of advertising', async () => {
  registerDiscoveryAdapter(advertiserAdapter([
    { name: 'Organic Air', phone: '904-555-6006', resultType: 'ORGANIC',
      query: 'ac repair 32095', position: 4 },
  ]));
  await runMarketJob();
  assert.deepEqual(await adEvidence('Organic Air'), [],
    'ranking organically was recorded as advertising');
});

test('six sightings are six dated observations of one advertiser', async () => {
  // Deliberately not deduped into one claim: each is a separate day and a separate
  // query, and the freshness of the newest is what decides whether a rep may say
  // "currently".
  registerDiscoveryAdapter(advertiserAdapter([
    { name: 'Repeat Air', phone: '904-555-6007', resultType: 'PAID_SEARCH_TEXT',
      query: 'ac repair 32095', position: 1 },
    { name: 'Repeat Air', phone: '904-555-6007', resultType: 'PAID_SEARCH_TEXT',
      query: 'emergency ac 32095', position: 2 },
  ]));
  await runMarketJob();

  // Both sightings are on record against the one company. This used to be asserted
  // on the evidence rows, which worked only because the fixture handed up two
  // finished businesses for what is one advertiser seen twice -- an adapter can no
  // longer do that, and the place the two sightings actually live is the
  // observations, which is what the name of this test says.
  const { rows: seen } = await query<{ query: string | null }>(
    `select distinct o.query from search_observations o
       join accounts a on a.account_id = o.account_id
      where a.canonical_name = 'Repeat Air' and o.result_type = 'paid_search'
      order by o.query`);
  assert.deepEqual(seen.map((row) => row.query),
    ['ac repair 32095', 'emergency ac 32095'],
    'two searches on one advertiser collapsed into one sighting');

  // And the advertising claim itself exists, dated, rather than being lost.
  const evidence = await adEvidence('Repeat Air');
  assert.ok(evidence.length >= 1, 'the advertiser evidence was not written at all');
});
