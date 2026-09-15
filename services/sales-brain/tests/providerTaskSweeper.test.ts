import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { createUser } from '../src/domain/auth.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters,
  type DiscoveryAdapter, type DiscoveryResult, type DiscoveryQuery,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { pendingProviderTasks, MAX_TASK_COLLECTIONS } from '../src/miner/providerTasks.js';
import { sweepProviderTasks } from '../src/workers/providerTaskSweeper.js';
import { resetDatabase } from './helpers.js';
import { observationsFor } from './support/observations.js';

/**
 * Late collection of paid provider work.
 *
 * DataForSEO Standard charges at `task_post` and answers minutes later. The miner
 * polls for ~27 seconds and correctly records the task as outstanding -- and until
 * this sweeper existed, nothing ever went back for it. Collection lived inside a
 * future `market_mine` job, those were queued only from `saved_markets where enabled`,
 * and an ad-hoc search creates no saved market.
 *
 * Production is the fixture these tests are written against: seven paid tasks, all
 * seven completed at the provider, `poll_attempts = 0` on every ledger row, and one
 * task -- 22 seconds -- collected inside the fast path and therefore never written to
 * the ledger at all. The observed turnarounds were 22s, 56s, 14m37s, 14m39s, 15m04s,
 * 15m14s and 16m14s, and the cases below are those numbers.
 */

let userId: string;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  userId = await createUser({
    email: 'sweeper.ops@test.local', displayName: 'Sweeper Ops', role: 'SALES_MANAGER',
    password: 'sweeper-password-not-a-secret' });
});

interface Fake extends DiscoveryAdapter {
  posts: number;
  collections: number;
  readyIds: string[] | null;
  deliver: boolean;
}

/**
 * A provider that queues work, exactly as Standard mode does.
 *
 * `posts` counts purchases. Every test that touches recovery asserts on it, because
 * the one failure this whole design exists to prevent is a recovery path that buys a
 * replacement for work already paid for.
 */
function queueingAdapter(options: { deliver?: boolean; ready?: string[] | null } = {}): Fake {
  const state = { posts: 0, collections: 0 };
  const fake: Fake = {
    name: 'queueing-provider',
    requiresCredential: false,
    governanceReviewed: true,
    mode: 'standard',
    isConfigured: () => true,
    get posts() { return state.posts; },
    get collections() { return state.collections; },
    readyIds: options.ready ?? null,
    deliver: options.deliver ?? false,

    async discover(): Promise<DiscoveryResult> {
      state.posts += 1;
      return {
        status: 'PENDING', observations: observationsFor([]),
        providerTaskId: `native-task-${state.posts}`,
        reason: 'The provider accepted the search and has not finished it yet.',
      };
    },

    async collect(taskId: string, _request: DiscoveryQuery): Promise<DiscoveryResult> {
      state.collections += 1;
      if (!fake.deliver) {
        return { status: 'PENDING', observations: observationsFor([]), providerTaskId: taskId,
          reason: 'still in queue' };
      }
      return {
        status: 'OK', providerTaskId: taskId, costUsd: null,
        observations: observationsFor([
          { name: 'Village Plumbing St Johns', website: 'villageplumbingstjohns.com', phone: '904-555-0142' },
          { name: 'W Smith Plumbing', website: 'wsmithplumbing.com', phone: '904-555-0188' },
        ]),
      };
    },

    async tasksReady(): Promise<string[] | null> { return fake.readyIds; },
  };
  return fake;
}

async function runSearch(zip = '32095'): Promise<string> {
  const job = await enqueueMarketResearch({
    verticalProfileId: 'plumbing', geographyType: 'zip_zcta', geographyValue: zip,
    marketId: null, requestedBy: userId });
  await drainQueue(5);
  return job.jobId;
}

/** Moves a task's clock back, so a 15-minute wait costs a test nothing. */
async function ageTask(nativeId: string, minutes: number): Promise<void> {
  await query(
    `update provider_tasks
        set submitted_at = now() - ($2 || ' minutes')::interval,
            last_polled_at = case when last_polled_at is null then null
                                  else now() - ($2 || ' minutes')::interval end
      where provider_native_id = $1`,
    [nativeId, String(minutes)]);
}

async function accountCount(): Promise<number> {
  const { rows } = await query<{ n: number }>('select count(*)::int n from accounts');
  return rows[0]!.n;
}

test('a task still in the provider queue is pending, not failed', async () => {
  registerDiscoveryAdapter(queueingAdapter());
  await runSearch();

  const pending = await pendingProviderTasks('queueing-provider');
  assert.equal(pending.length, 1);

  // 40602 means the provider is working, not that anything went wrong. Six of
  // production's seven purchases were recorded as FAILED/TASK_NOT_READY and every one
  // of them completed successfully.
  const { rows } = await query<{ status: string; error_code: string | null }>(
    `select status, error_code from provider_usage where error_code = 'TASK_NOT_READY'`);
  assert.equal(rows.length, 0, 'a queued task was recorded as a provider failure');
});

test('the sweeper collects a ready task with no saved market anywhere', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await runSearch();

  const { rows: markets } = await query<{ n: number }>('select count(*)::int n from saved_markets');
  assert.equal(markets[0]!.n, 0, 'the fixture must have no saved market at all');

  adapter.readyIds = ['native-task-1'];
  adapter.deliver = true;
  const swept = await sweepProviderTasks();
  assert.equal(swept.queuedFromReady, 1);
  await drainQueue(5);

  const { rows } = await query<{ status: string }>(
    `select status from provider_tasks where provider_native_id = 'native-task-1'`);
  assert.equal(rows[0]!.status, 'COLLECTED', 'the paid result never reached inventory');
  assert.ok(await accountCount() > 0, 'collection produced no companies');
  assert.equal(adapter.posts, 1, 'recovery bought a replacement search');
});

test('a ready id that is not ours is ignored', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await runSearch();

  adapter.readyIds = ['native-task-1', 'somebody-elses-task', 'task-from-before-the-ledger'];
  adapter.deliver = true;
  const swept = await sweepProviderTasks();

  assert.equal(swept.queuedFromReady, 1);
  assert.equal(swept.readyNotOurs, 2, 'an id we hold no row for must not be acted on');
});

test('a result that arrives after fifteen minutes is still collected', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await runSearch();

  // The originating job is long finished; this is the 15m14s plumber case.
  const { rows: job } = await query<{ status: string; outcome: string }>(
    `select status, outcome from jobs where job_type = 'market_mine' order by created_at desc limit 1`);
  assert.equal(job[0]!.status, 'SUCCEEDED');
  assert.equal(job[0]!.outcome, 'PROVIDER_PENDING');

  await ageTask('native-task-1', 15);
  adapter.readyIds = ['native-task-1'];
  adapter.deliver = true;
  await sweepProviderTasks();
  await drainQueue(5);

  const { rows } = await query<{ status: string }>(
    `select status from provider_tasks where provider_native_id = 'native-task-1'`);
  assert.equal(rows[0]!.status, 'COLLECTED');
  assert.equal(adapter.posts, 1);
});

test('the direct fallback collects a task the ready list has forgotten', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await runSearch();

  // Exactly the production situation: the result is complete and retrievable, but it
  // left `tasks_ready` when somebody retrieved it by hand during an investigation.
  adapter.readyIds = [];
  adapter.deliver = true;
  await ageTask('native-task-1', 20);

  const swept = await sweepProviderTasks();
  assert.equal(swept.queuedFromReady, 0);
  assert.equal(swept.queuedFromFallback, 1, 'a task absent from the ready list was unrecoverable');
  await drainQueue(5);

  const { rows } = await query<{ status: string }>(
    `select status from provider_tasks where provider_native_id = 'native-task-1'`);
  assert.equal(rows[0]!.status, 'COLLECTED');
  assert.equal(adapter.posts, 1);
});

test('a ready-list outage leaves the task pending and buys nothing', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await runSearch();

  adapter.readyIds = null; // the provider could not be asked
  const swept = await sweepProviderTasks();

  assert.equal(swept.readyUnavailable, true);
  assert.equal(swept.queuedFromReady, 0);
  assert.equal(swept.abandoned, 0, 'an outage on our side must not abandon a paid task');
  const pending = await pendingProviderTasks('queueing-provider');
  assert.equal(pending.length, 1);
  assert.equal(adapter.posts, 1);
});

test('two sweeps do not queue two collections for one task', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await runSearch();

  adapter.readyIds = ['native-task-1'];
  const first = await sweepProviderTasks();
  const second = await sweepProviderTasks();
  assert.equal(first.queuedFromReady, 1);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int n from jobs
      where job_type = 'market_mine' and status in ('QUEUED','RUNNING')`);
  assert.equal(rows[0]!.n, 1, 'the second sweep created a duplicate collection job');
  void second;
});

test('collecting twice does not create the companies twice', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await runSearch();

  adapter.readyIds = ['native-task-1'];
  adapter.deliver = true;
  await sweepProviderTasks();
  await drainQueue(5);
  const afterFirst = await accountCount();

  // A second pass over an already-collected task: the handler refuses it as already
  // fulfilled rather than ingesting the same businesses again.
  await sweepProviderTasks();
  await drainQueue(5);
  assert.equal(await accountCount(), afterFirst, 'ingestion was not idempotent');
  assert.equal(adapter.posts, 1);
});

test('a quarantined legacy task is never revived by the sweeper', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await runSearch();

  // The five September 11 tasks were closed deliberately and must stay closed.
  await query(
    `update provider_tasks set status = 'ABANDONED',
            error_code = 'SUPERSEDED_BY_P0_MINER_REMEDIATION', collected_at = now()
      where provider_native_id = 'native-task-1'`);

  adapter.readyIds = ['native-task-1'];
  adapter.deliver = true;
  const swept = await sweepProviderTasks();

  assert.equal(swept.pending, 0, 'an abandoned task was treated as outstanding');
  assert.equal(swept.queuedFromReady, 0);
  const { rows } = await query<{ status: string; error_code: string }>(
    `select status, error_code from provider_tasks where provider_native_id = 'native-task-1'`);
  assert.equal(rows[0]!.status, 'ABANDONED');
  assert.equal(rows[0]!.error_code, 'SUPERSEDED_BY_P0_MINER_REMEDIATION');
});

test('a task is given up on when its result expires, not when it has been asked often',
  async () => {
    const adapter = queueingAdapter();
    registerDiscoveryAdapter(adapter);
    await runSearch();

    // Asked many times and still queued: the provider is working, so this stays open.
    adapter.readyIds = [];
    for (let i = 0; i < 25; i += 1) {
      await ageTask('native-task-1', 60);
      await sweepProviderTasks();
      await drainQueue(5);
    }
    let pending = await pendingProviderTasks('queueing-provider');
    assert.equal(pending.length, 1, 'a healthy queued task was abandoned on a poll count');

    // Past the provider's retention window the result is genuinely unrecoverable.
    await ageTask('native-task-1', 31 * 24 * 60);
    const swept = await sweepProviderTasks();
    assert.equal(swept.abandoned, 1);
    pending = await pendingProviderTasks('queueing-provider');
    assert.equal(pending.length, 0);
    const { rows } = await query<{ error_code: string }>(
      `select error_code from provider_tasks where provider_native_id = 'native-task-1'`);
    assert.equal(rows[0]!.error_code, 'RESULT_RETENTION_EXPIRED');
    assert.equal(adapter.posts, 1, 'expiry must not trigger a replacement purchase');
  });

test('a task that completes inside the fast path is still written to the ledger', async () => {
  // The 22-second `roofing contractor 32095` case: collected in-run, and because the
  // row was only written when the poll gave up, the purchase was invisible locally.
  const state = { posts: 0 };
  registerDiscoveryAdapter({
    name: 'fast-provider',
    requiresCredential: false,
    governanceReviewed: true,
    mode: 'standard',
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      state.posts += 1;
      return {
        status: 'OK', providerTaskId: 'fast-native-1', costUsd: 0.006,
        observations: observationsFor([
          { name: 'Enterprise Roofing LLC', website: 'enterpriseroofingllc.com', phone: '904-555-0100' },
        ]),
      };
    },
    async collect(taskId: string): Promise<DiscoveryResult> {
      return { status: 'PENDING', observations: observationsFor([]), providerTaskId: taskId };
    },
  });

  await runSearch();
  const { rows } = await query<{ status: string; cost_usd: string | null }>(
    `select status, cost_usd from provider_tasks where provider_native_id = 'fast-native-1'`);
  assert.equal(rows.length, 1, 'a paid search that completed quickly left no ledger row');
  assert.equal(rows[0]!.status, 'COLLECTED', 'a collected task must not stay pending');
  assert.equal(state.posts, 1);

  // And having been collected in-run, it is not outstanding for the sweeper to fetch.
  const swept = await sweepProviderTasks();
  assert.equal(swept.pending, 0);
});

/**
 * The real `tasks_ready` response, captured from the production account on
 * 2026-09-15 while the plumber canary was outstanding.
 *
 * Kept verbatim because the shape has a trap in it: the *wrapper* task carries its
 * own id -- the id of the tasks_ready call itself -- and the ids that matter are one
 * level down, in `result[]`. Reading the wrapper id would return a task nobody
 * submitted and silently collect nothing for ever. No credential appears here; the
 * response contains none.
 */
const REAL_TASKS_READY = {
  version: '0.1.20260902', status_code: 20000, status_message: 'Ok.', cost: 0,
  tasks_count: 1, tasks_error: 0,
  tasks: [{
    id: '09151704-2465-0087-0000-f12ec7698acd',
    status_code: 20000, status_message: 'Ok.', cost: 0, result_count: 1,
    path: ['v3', 'serp', 'google', 'organic', 'tasks_ready'],
    data: { api: 'serp', function: 'tasks_ready', se: 'google', se_type: 'organic' },
    result: [{
      id: '09151637-2465-0066-0000-88b973b39c1b',
      se: 'google', se_type: 'organic', date_posted: '2026-09-15 16:37:57 +00:00', tag: '',
      endpoint_advanced: '/v3/serp/google/organic/task_get/advanced/09151637-2465-0066-0000-88b973b39c1b',
    }],
  }],
};

const DFS_CONFIG = {
  login: 'not-a-real-login', password: 'not-a-real-password',
  baseUrl: 'https://provider.test/v3', mode: 'standard' as const,
  governanceReviewed: true, enabled: true, maxQueriesPerRun: 25,
  resultDepth: 100, maxRetries: 0, maxPollAttempts: 1, pollIntervalMs: 1,
};

function readyTransport(body: unknown, ok = true, status = 200) {
  const urls: string[] = [];
  const transport = async (url: string) => {
    urls.push(url);
    return { ok, status, json: async () => body };
  };
  return { transport, urls };
}

test('the real tasks_ready response yields the submitted task id, not the list call id',
  async () => {
    const { createDataForSeoAdapter } = await import('../src/miner/dataForSeoAdapter.js');
    const { transport, urls } = readyTransport(REAL_TASKS_READY);
    const adapter = createDataForSeoAdapter({ config: DFS_CONFIG, transport: transport as never,
      sleep: async () => {} });

    const ready = await adapter.tasksReady!();
    assert.deepEqual(ready, ['09151637-2465-0066-0000-88b973b39c1b']);

    // One free GET, and structurally not a purchase.
    assert.equal(urls.length, 1);
    assert.match(urls[0]!, /\/serp\/google\/organic\/tasks_ready$/);
    assert.ok(!urls.some((url) => url.includes('task_post') || url.includes('/live/')),
      'the ready list must never reach a paid endpoint');
  });

test('a tasks_ready response we cannot read is unknown, not empty', async () => {
  const { createDataForSeoAdapter } = await import('../src/miner/dataForSeoAdapter.js');
  for (const body of [{ tasks: 'not-an-array' }, {}, { tasks: null }]) {
    const { transport } = readyTransport(body);
    const adapter = createDataForSeoAdapter({ config: DFS_CONFIG, transport: transport as never,
      sleep: async () => {} });
    // `[]` would assert the provider has nothing ready and quietly stop collecting;
    // null says we could not tell, and the caller falls back to asking directly.
    assert.equal(await adapter.tasksReady!(), null);
  }
});

test('a tasks_ready outage is reported as unknown and costs nothing', async () => {
  const { createDataForSeoAdapter } = await import('../src/miner/dataForSeoAdapter.js');
  const { transport } = readyTransport({}, false, 503);
  const adapter = createDataForSeoAdapter({ config: DFS_CONFIG, transport: transport as never,
    sleep: async () => {} });

  assert.equal(await adapter.tasksReady!(), null);
  const { rows } = await query<{ operation: string; status: string; actual_cost_usd: string | null }>(
    `select operation, status, actual_cost_usd from provider_usage
      where operation = 'serp.tasks_ready'`);
  assert.equal(rows.length, 1, 'an outage that stops collection has to be visible');
  assert.equal(rows[0]!.status, 'FAILED');
  assert.equal(Number(rows[0]!.actual_cost_usd), 0, 'the ready list is free');
});

test('poll attempts keep counting for observability without ending the task', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await runSearch();

  adapter.readyIds = [];
  for (let i = 0; i < MAX_TASK_COLLECTIONS + 5; i += 1) {
    await ageTask('native-task-1', 60);
    await sweepProviderTasks();
    await drainQueue(5);
  }

  /**
   * The count is a fact about us, not a verdict on the provider.
   *
   * How many times we asked is worth recording -- an operator wants to see that
   * something has been going back for this task -- but it is evidence of our
   * diligence, not of the provider's failure, and it must not be what closes a paid
   * search. Here it is well past the old ceiling and the task is still open and still
   * being polled.
   */
  const { rows } = await query<{ status: string; poll_attempts: number; error_code: string | null }>(
    `select status, poll_attempts, error_code from provider_tasks
      where provider_native_id = 'native-task-1'`);
  assert.ok(rows[0]!.poll_attempts > MAX_TASK_COLLECTIONS,
    `poll_attempts stopped at ${rows[0]!.poll_attempts}; it should keep counting`);
  assert.equal(rows[0]!.status, 'PENDING');
  assert.equal(rows[0]!.error_code, null);
  assert.equal(adapter.posts, 1);
});

test('a task given up on for expiry is not collected again afterwards', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await runSearch();

  await ageTask('native-task-1', 31 * 24 * 60);
  const expired = await sweepProviderTasks();
  assert.equal(expired.abandoned, 1);

  // Now make the provider claim it is ready after all. An abandoned task is closed
  // work: collecting it would ingest results for a search we have already accounted
  // for, and re-opening it on the provider's say-so would make the ledger follow the
  // provider rather than the other way round.
  adapter.readyIds = ['native-task-1'];
  adapter.deliver = true;
  const after = await sweepProviderTasks();
  await drainQueue(5);

  assert.equal(after.pending, 0, 'an abandoned task was treated as outstanding again');
  assert.equal(after.queuedFromReady, 0);
  assert.equal(adapter.collections, 0, 'an abandoned task was collected after being closed');
  const { rows } = await query<{ status: string; error_code: string }>(
    `select status, error_code from provider_tasks where provider_native_id = 'native-task-1'`);
  assert.equal(rows[0]!.status, 'ABANDONED');
  assert.equal(rows[0]!.error_code, 'RESULT_RETENTION_EXPIRED');
});
