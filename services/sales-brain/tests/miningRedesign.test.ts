import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { resetDatabase } from './helpers.js';
import {
  assembleDiscoveryRows, deriveSalesBrainState, loadMiningView, marketDiscoveryRows,
  miningSummary, websiteResearchRows, websiteResearchSummary,
} from '../src/api/miningView.js';

/**
 * SB-V2-2 — the Mining page tells two truths apart.
 *
 * Production is the fixture for all of this. It holds 92 `market_mine` job rows for
 * 49 paid searches; 40 of those rows say "Provider still working" about searches
 * DataForSEO finished days earlier and whose businesses are already in inventory,
 * because a job row is a snapshot of what one worker believed when it stopped and the
 * page was a list of job rows. It also holds 320 `account_research` jobs that all
 * report COMPLETED, over 94 research runs that fetched no page at all.
 *
 * The rule these tests hold: what the provider is doing comes from the paid-task
 * ledger, what Sales Brain is doing comes from our own work, and neither is allowed
 * to answer for the other.
 */

let app: FastifyInstance;
const PASSWORD = 'mining-redesign-password';

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

// ------------------------------------------------------------------- fixtures

const SUBMIT_TIME = '2026-09-16T22:00:00Z';
const COLLECT_TIME = '2026-09-16T22:18:00Z';

function perSearch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    index: 1, term: 'HVAC contractor', keyword: 'HVAC contractor 33701',
    fingerprint: 'search::hvac:zip_zcta:33701:advertiser_first:hvac contractor',
    status: 'PENDING', providerTaskId: 'task-33701', providerRows: 0, usableRows: 0,
    duplicateRows: 0, rejectedRows: 0, costUsd: null, created: 0, matchedExisting: 0,
    reason: null, ...overrides,
  };
}

async function insertMineJob(input: {
  outcome: string; status?: string; searches: Record<string, unknown>[];
  createdAt: string; completedAt?: string; requestedBy?: string | null;
  reason?: string | null; refreshQueued?: number;
}): Promise<string> {
  const { rows } = await query<{ job_id: string }>(
    `insert into jobs (job_type, payload, status, outcome, outcome_reason, progress,
                       requested_by, created_at, started_at, completed_at)
     values ('market_mine',
             '{"vertical_profile_id":"hvac","geography_type":"zip_zcta","geography_value":"33701","mining_mode":"advertiser_first"}'::jsonb,
             $1, $2, $3, $4::jsonb, $5, $6::timestamptz, $6::timestamptz, $7::timestamptz)
     returning job_id`,
    [input.status ?? 'SUCCEEDED', input.outcome, input.reason ?? null,
     JSON.stringify({ perSearch: input.searches, refreshQueued: input.refreshQueued ?? 0 }),
     input.requestedBy ?? null, input.createdAt, input.completedAt ?? input.createdAt]);
  return rows[0]!.job_id;
}

async function insertProviderTask(input: {
  nativeId: string; status: string; jobId: string | null; collectedAt?: string | null;
  costUsd?: number | null;
}): Promise<string> {
  const { rows } = await query<{ provider_task_id: string }>(
    `insert into provider_tasks
       (provider, provider_native_id, job_id, fingerprint, operation, status,
        submitted_at, collected_at, cost_usd, request)
     values ('dataforseo', $1, $2,
             'search::hvac:zip_zcta:33701:advertiser_first:hvac contractor',
             'serp.discover', $3, $4::timestamptz, $5::timestamptz, $6,
             '{"search":{"term":"HVAC contractor","keyword":"HVAC contractor 33701"},
               "verticalProfileId":"hvac","geographyType":"zip_zcta",
               "geographyValue":"33701","miningMode":"advertiser_first"}'::jsonb)
     returning provider_task_id`,
    [input.nativeId, input.jobId, input.status, SUBMIT_TIME,
     input.collectedAt ?? null, input.costUsd ?? null]);
  return rows[0]!.provider_task_id;
}

/** The production shape: one paid search, a run that gave up, a run that collected. */
async function seedCollectedSearch(): Promise<{ submitJobId: string; collectJobId: string }> {
  const submitJobId = await insertMineJob({
    outcome: 'PROVIDER_PENDING', createdAt: SUBMIT_TIME,
    reason: 'The provider accepted the search and its results are not ready yet.',
    searches: [perSearch()],
  });
  await insertProviderTask({
    nativeId: 'task-33701', status: 'COLLECTED', jobId: submitJobId,
    collectedAt: COLLECT_TIME, costUsd: 0.006,
  });
  const collectJobId = await insertMineJob({
    outcome: 'COMPLETED', createdAt: COLLECT_TIME, refreshQueued: 2,
    searches: [perSearch({
      status: 'OK', providerRows: 114, usableRows: 9, created: 9, matchedExisting: 0,
      rejectedRows: 12, duplicateRows: 3, costUsd: 0.006,
    })],
  });
  return { submitJobId, collectJobId };
}

async function loginCookie(email: string, name: string): Promise<string> {
  await createUser({ email, displayName: name, role: 'RESEARCH_OPS', password: PASSWORD });
  const login = await app.inject({
    method: 'POST', url: '/login', payload: { email, password: PASSWORD } });
  return login.cookies.find((c) => c.name === 'yad_sales_session')!.value;
}

// ------------------------------------------------------------- the derivation

test('a collected task that nothing ingested is our problem, not the provider\'s', () => {
  assert.equal(deriveSalesBrainState({
    providerState: 'COLLECTED', collecting: false, searchStatus: 'PENDING',
  }), 'COLLECTED_NOT_INGESTED');

  // The same ledger state while a collection is actually running is not a backlog.
  assert.equal(deriveSalesBrainState({
    providerState: 'COLLECTED', collecting: true, searchStatus: 'PENDING',
  }), 'COLLECTING');

  // And a task the provider has not answered is the provider's turn, whatever the
  // job that bought it was left believing.
  assert.equal(deriveSalesBrainState({
    providerState: 'PENDING', collecting: false, searchStatus: 'PENDING',
  }), 'AWAITING_PROVIDER');
});

test('our own budget refusing to buy is not a search whose results arrived', async () => {
  // Production: two runs whose only perSearch entry is BUDGET_EXHAUSTED, no provider
  // task, nothing bought. Reading "not PENDING" as "the provider answered" reported
  // both as searches whose results had been ingested.
  await insertMineJob({
    outcome: 'DISCOVERY_BLOCKED', createdAt: SUBMIT_TIME,
    reason: 'The daily provider budget of $0.30 is spent. No search was made.',
    searches: [perSearch({
      status: 'BUDGET_EXHAUSTED', providerTaskId: null,
      reason: 'The daily provider budget of $0.30 is spent.',
    })],
  });

  const rows = await marketDiscoveryRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.salesBrainState, 'NOT_SEARCHED');
  // A dash, not a zero: the run recorded a perSearch entry of zeroes because it was
  // refused, and "0 rows returned" is a measurement of a market nobody measured.
  assert.equal(rows[0]!.rowsReturned, null);
  assert.equal(rows[0]!.newBusinesses, null);

  const summary = await miningSummary();
  assert.equal(summary.resultsIngested, 0,
    'a search nobody bought was counted as a search whose results are in inventory');

  const cookie = await loginCookie('mining.v2e@test.local', 'Mining V2e');
  const page = await app.inject({
    method: 'GET', url: '/mining', headers: { cookie: `yad_sales_session=${cookie}` } });
  assert.match(page.body, /Could not search/);
  assert.match(page.body, /Not searched/);
});

test('an abandoned paid search never reads as work in progress', () => {
  assert.equal(deriveSalesBrainState({
    providerState: 'ABANDONED', collecting: false, searchStatus: null,
  }), 'ABANDONED');
});

// -------------------------------------------------------- one search, one row

test('two job rows about one paid search collapse into the search', async () => {
  await seedCollectedSearch();
  const rows = await marketDiscoveryRows();

  assert.equal(rows.length, 1, 'the same paid search was listed twice');
  const row = rows[0]!;
  assert.equal(row.providerTaskId, 'task-33701');
  // Provider truth from the ledger, ours from the run that ingested.
  assert.equal(row.providerState, 'COLLECTED');
  assert.equal(row.salesBrainState, 'INGESTED');
  // The numbers come from the run that collected, not from the run that gave up.
  assert.equal(row.rowsReturned, 114);
  assert.equal(row.resolvedBusinesses, 9);
  assert.equal(row.newBusinesses, 9);
  assert.equal(row.rejectedEntities, 12);
  assert.equal(row.existingRefreshed, 2);
  assert.equal(row.spendUsd, 0.006);
  assert.equal(row.needsAttention, false);
  // The market is the searched market, and the words are the words that were bought.
  assert.equal(row.verticalProfileId, 'hvac');
  assert.equal(row.geography, '33701');
  assert.equal(row.keyword, 'HVAC contractor 33701');
});

test('a paid search nobody collected is shown as ours to answer for', async () => {
  const submitJobId = await insertMineJob({
    outcome: 'PROVIDER_PENDING', createdAt: SUBMIT_TIME, searches: [perSearch()],
  });
  await insertProviderTask({
    nativeId: 'task-33701', status: 'COLLECTED', jobId: submitJobId,
    collectedAt: COLLECT_TIME, costUsd: 0.006,
  });

  const rows = await marketDiscoveryRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.providerState, 'COLLECTED');
  assert.equal(rows[0]!.salesBrainState, 'COLLECTED_NOT_INGESTED');
  assert.equal(rows[0]!.needsAttention, true,
    'a search we have paid for and not collected has to be visible as such');

  const summary = await miningSummary();
  assert.equal(summary.waitingOnSalesBrain, 1);
  assert.equal(summary.providerProcessing, 0,
    'the provider has answered; counting it as provider work hides our own backlog');
  assert.equal(summary.resultsIngested, 0);
  assert.ok(summary.needsAttention >= 1);
});

test('a run refused before it bought anything is still a row', async () => {
  await insertMineJob({
    outcome: 'PROVIDER_UNAVAILABLE', createdAt: SUBMIT_TIME, searches: [],
    reason: 'No provider answered, so this market was not searched.',
  });
  const rows = await marketDiscoveryRows();
  assert.equal(rows.length, 1, 'a market nobody could search disappeared from the page');
  assert.equal(rows[0]!.salesBrainState, 'NOT_SEARCHED');
  assert.equal(rows[0]!.providerState, 'NONE');
  // Nothing is claimed about the market: not zero businesses, not zero rows.
  assert.equal(rows[0]!.rowsReturned, null);
  assert.equal(rows[0]!.newBusinesses, null);
});

test('a ledger row no run mentions is still money that was spent', () => {
  const rows = assembleDiscoveryRows({
    searches: [],
    tasks: [{
      provider_task_id: 'internal-1', provider: 'dataforseo',
      provider_native_id: 'task-orphan', status: 'PENDING',
      submitted_at: new Date(SUBMIT_TIME), collected_at: null, cost_usd: 0.006,
      job_id: null, vertical_profile_id: 'hvac', geography_type: 'zip_zcta',
      geography_value: '33701', keyword: 'HVAC contractor 33701',
      term: 'HVAC contractor', mining_mode: 'advertiser_first',
    }],
    needsReviewByJob: new Map(),
    inFlightTaskIds: new Set(),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.needsAttention, true);
  assert.equal(rows[0]!.spendUsd, 0.006);
});

// --------------------------------------------------- the sentence on the page

test('the page never says the provider is working on a search it has answered', async () => {
  await seedCollectedSearch();
  const cookie = await loginCookie('mining.v2@test.local', 'Mining V2');

  for (const url of ['/mining', '/mining?tab=discovery', '/mining?tab=activity']) {
    const page = await app.inject({
      method: 'GET', url, headers: { cookie: `yad_sales_session=${cookie}` } });
    assert.equal(page.statusCode, 200, `${url} did not render`);
    assert.equal(/Provider still working/.test(page.body), false,
      `${url} still says the provider is working on a search the ledger says it answered`);
  }

  // The history is not rewritten; the sentence a person reads is the current one.
  const activity = await app.inject({
    method: 'GET', url: '/mining?tab=activity',
    headers: { cookie: `yad_sales_session=${cookie}` } });
  assert.match(activity.body, /Provider finished — collected since/);
});

test('mining opens on market discovery, with provider and our own state apart', async () => {
  await seedCollectedSearch();
  const cookie = await loginCookie('mining.v2b@test.local', 'Mining V2b');
  const page = await app.inject({
    method: 'GET', url: '/mining', headers: { cookie: `yad_sales_session=${cookie}` } });

  assert.equal(page.statusCode, 200);
  // The default tab is the one that answers what was searched and what came of it.
  assert.match(page.body, /Market searches/);
  assert.match(page.body, /aria-pressed="true"[^>]*>Market Discovery|Market Discovery<\/a>/);
  // Two columns, two truths.
  assert.match(page.body, /<th>Provider<\/th>/);
  assert.match(page.body, /<th>Sales Brain<\/th>/);
  // The words that were bought and the provider's own id, so support can be asked.
  assert.match(page.body, /HVAC contractor 33701/);
  assert.match(page.body, /task-33701/);
  // And the funnel an operator checks dedupe with.
  assert.match(page.body, /114 provider row\(s\)/);
});

test('the summary counts are the states of the same searches the table shows', async () => {
  await seedCollectedSearch();
  const pendingJobId = await insertMineJob({
    outcome: 'PROVIDER_PENDING', createdAt: SUBMIT_TIME,
    searches: [perSearch({ providerTaskId: 'task-still-open' })],
  });
  await insertProviderTask({
    nativeId: 'task-still-open', status: 'PENDING', jobId: pendingJobId, costUsd: 0.006 });

  const { summary, rows } = await loadMiningView();
  const counted = (state: string): number =>
    rows.filter((row) => row.salesBrainState === state).length;

  assert.equal(summary.resultsIngested, counted('INGESTED'));
  assert.equal(summary.providerProcessing, counted('AWAITING_PROVIDER'));
  assert.equal(summary.waitingOnSalesBrain, counted('COLLECTED_NOT_INGESTED'));
  assert.equal(summary.resultsIngested, 1);
  assert.equal(summary.providerProcessing, 1);
  // Every search on the page is in exactly one of the states the counts name, so the
  // numbers above the table add up to the table.
  assert.equal(summary.searchesCounted, rows.length);
  assert.equal(
    summary.resultsIngested + summary.providerProcessing + summary.waitingOnSalesBrain
      + summary.collecting
      + rows.filter((row) => row.salesBrainState === 'ABANDONED'
          || row.salesBrainState === 'PROVIDER_FAILED'
          || row.salesBrainState === 'NOT_SEARCHED').length,
    rows.length, 'the summary and the table disagree about how many searches there are');
});

// ------------------------------------------------------------ website research

async function seedResearchRun(input: {
  name: string; status: string; fetched: number; blocked: number;
}): Promise<string> {
  const { rows } = await query<{ account_id: string }>(
    `insert into accounts (canonical_name, normalized_name) values ($1, lower($1))
     returning account_id`, [input.name]);
  const accountId = rows[0]!.account_id;
  await query(
    `insert into research_runs (account_id, trigger, status, started_at, completed_at,
                                adapter_results)
     values ($1, 'newly_discovered', $2, now() - interval '1 hour', now(), $3::jsonb)`,
    [accountId, input.status,
     JSON.stringify({ pages_fetched: input.fetched, pages_blocked: input.blocked })]);
  return accountId;
}

test('a research run that read nothing is not a completed one', async () => {
  await seedResearchRun({ name: 'Readable Air', status: 'completed', fetched: 4, blocked: 0 });
  await seedResearchRun({ name: 'Refused Air', status: 'partial', fetched: 0, blocked: 3 });
  await seedResearchRun({ name: 'Absent Air', status: 'partial', fetched: 0, blocked: 0 });

  const summary = await websiteResearchSummary();
  assert.equal(summary.completed, 1);
  assert.equal(summary.blocked, 1, 'a site that refused us is not a site we read');
  assert.equal(summary.sourceUnavailable, 1,
    'a run that fetched nothing and was refused nothing is neither complete nor blocked');
  // The three buckets account for every run, which is what makes them checkable.
  assert.equal(summary.completed + summary.blocked + summary.sourceUnavailable, summary.total);
});

test('website research aggregates first and enumerates on request', async () => {
  for (let i = 0; i < 12; i += 1) {
    await seedResearchRun({ name: `Blocked Air ${i}`, status: 'partial', fetched: 0, blocked: 2 });
  }
  const cookie = await loginCookie('mining.v2c@test.local', 'Mining V2c');

  const aggregate = await app.inject({
    method: 'GET', url: '/mining?tab=website',
    headers: { cookie: `yad_sales_session=${cookie}` } });
  assert.equal(aggregate.statusCode, 200);
  assert.match(aggregate.body, /Source unavailable/);
  assert.equal(/Blocked Air 0/.test(aggregate.body), false,
    'the aggregate view enumerated every run, which is the wall of rows it replaces');

  const drill = await app.inject({
    method: 'GET', url: '/mining?tab=website&bucket=blocked',
    headers: { cookie: `yad_sales_session=${cookie}` } });
  assert.equal(drill.statusCode, 200);
  assert.match(drill.body, /Blocked Air 0/);

  const listed = await websiteResearchRows('blocked');
  assert.equal(listed.length, 12);
  assert.equal(listed.every((row) => row.pagesBlocked === 2), true);
});

test('a website research bucket that is not a bucket is refused, not guessed', async () => {
  const cookie = await loginCookie('mining.v2d@test.local', 'Mining V2d');
  const page = await app.inject({
    method: 'GET', url: '/mining?tab=website&bucket=../../etc/passwd',
    headers: { cookie: `yad_sales_session=${cookie}` } });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Choose a state above/);
});
