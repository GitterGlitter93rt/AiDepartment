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
import { resetDatabase } from './helpers.js';

/**
 * A paid search that outlives the worker that bought it.
 * Authority: Issue #2 parts 3, 4 and 11, and EXACT CASE 4.
 *
 * DataForSEO Standard accepts a task, charges for it, and answers minutes later. The
 * task id lived in a local variable inside one job, so a worker that died between
 * submitting and collecting lost the search -- and the next run submitted another
 * one and paid for the same market twice. The poll is bounded, so this was not an
 * edge case: any task slower than the poll window was abandoned and re-bought.
 */

let userId: string;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  userId = await createUser({
    email: 'task.ops@test.local', displayName: 'Task Ops', role: 'SALES_MANAGER',
    password: 'provider-task-password' });
});

/**
 * A provider that queues work: the first call accepts a task, and it stays pending
 * until the test says otherwise. Counts what it was asked to do.
 */
function queueingAdapter(options: {
  readyAfter?: number;
  businesses?: { name: string; phone: string }[];
  canCollect?: boolean;
} = {}): DiscoveryAdapter & { submissions: number; collections: number } {
  const state = { submissions: 0, collections: 0 };
  const adapter: DiscoveryAdapter & { submissions: number; collections: number } = {
    name: 'queueing-provider',
    requiresCredential: false,
    governanceReviewed: true,
    isConfigured: () => true,
    get submissions() { return state.submissions; },
    get collections() { return state.collections; },

    async discover(): Promise<DiscoveryResult> {
      state.submissions += 1;
      return {
        status: 'PENDING', businesses: [], providerRows: 0, rejectedRows: 0, duplicateRows: 0,
        providerTaskId: `provider-task-${state.submissions}`,
        reason: 'The provider accepted the search and has not finished it yet.',
      };
    },
  };

  if (options.canCollect !== false) {
    adapter.collect = async (taskId: string, _request: DiscoveryQuery): Promise<DiscoveryResult> => {
      state.collections += 1;
      if (state.collections < (options.readyAfter ?? 1)) {
        return {
          status: 'PENDING', businesses: [], providerRows: 0, rejectedRows: 0, duplicateRows: 0,
          providerTaskId: taskId, reason: 'still working',
        };
      }
      const businesses = options.businesses ?? [
        { name: 'Collected Roofing', phone: '904-555-8001' },
      ];
      return {
        status: 'OK',
        businesses: businesses.map((business) => ({
          name: business.name, website: null, phone: business.phone,
        })),
        providerRows: businesses.length, rejectedRows: 0, duplicateRows: 0,
        providerTaskId: taskId, costUsd: 0.0031,
      };
    };
  }
  return adapter;
}

async function runMarketJob(zip = '32095'): Promise<Record<string, any>> {
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: zip,
    marketId: null, requestedBy: userId });
  await drainQueue(5);
  const { rows } = await query<Record<string, any>>(
    'select status, outcome, outcome_reason, progress from jobs where job_id = $1', [job.jobId]);
  return rows[0]!;
}

test('a task the provider accepted is remembered, not lost with the process', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);

  const job = await runMarketJob();
  assert.equal(job['outcome'], 'PROVIDER_PENDING');
  assert.equal(adapter.submissions, 1);

  const pending = await pendingProviderTasks('queueing-provider');
  assert.equal(pending.length, 1, 'the task id died with the job');
  assert.equal(pending[0]!.provider_native_id, 'provider-task-1');
  assert.ok(pending[0]!.fingerprint.includes('32095'));
});

test('a later run collects the search we already paid for instead of buying another',
  async () => {
    // Two collections: the first still pending, the second delivering results. Every
    // one of these runs is a separate job, exactly as they would be after a restart.
    const adapter = queueingAdapter({ readyAfter: 2 });
    registerDiscoveryAdapter(adapter);

    const first = await runMarketJob();
    assert.equal(first['outcome'], 'PROVIDER_PENDING');

    const second = await runMarketJob();
    assert.equal(second['outcome'], 'PROVIDER_PENDING', 'the provider was still working');

    const third = await runMarketJob();
    assert.equal(third['outcome'], 'COMPLETED');

    assert.equal(adapter.submissions, 1,
      'the same market was submitted more than once: the second search was paid for twice');
    assert.equal(adapter.collections, 2);

    const { rows } = await query<{ canonical_name: string }>(
      'select canonical_name from accounts');
    assert.deepEqual(rows.map((row) => row.canonical_name), ['Collected Roofing']);
  });

test('a collected task is closed, so it is not collected for ever', async () => {
  registerDiscoveryAdapter(queueingAdapter());
  await runMarketJob();
  await runMarketJob();

  const { rows } = await query<{ status: string; cost_usd: string | null }>(
    'select status, cost_usd from provider_tasks');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, 'COLLECTED');
  assert.equal(Number(rows[0]!.cost_usd), 0.0031, 'what the search cost is kept with it');

  assert.deepEqual(await pendingProviderTasks('queueing-provider'), []);
});

test('a provider that never delivers is given up on rather than polled for ever', async () => {
  // readyAfter is beyond the ceiling, so it is never ready.
  const adapter = queueingAdapter({ readyAfter: MAX_TASK_COLLECTIONS + 50 });
  registerDiscoveryAdapter(adapter);

  await runMarketJob();
  let last: Record<string, any> = {};
  // One run submits; the next MAX_TASK_COLLECTIONS runs go back for it. The last of
  // those gives up.
  for (let attempt = 0; attempt < MAX_TASK_COLLECTIONS; attempt += 1) {
    last = await runMarketJob();
  }

  assert.equal(adapter.submissions, 1,
    'a task we were still waiting on was re-bought while it was still owed to us');
  assert.equal(last['outcome'], 'PROVIDER_UNAVAILABLE');
  assert.match(String(last['outcome_reason']), /never delivered/);

  const { rows } = await query<{ status: string; error_code: string }>(
    'select status, error_code from provider_tasks');
  assert.equal(rows[0]!.status, 'ABANDONED');
  assert.equal(rows[0]!.error_code, 'NEVER_DELIVERED');

  // Once we have formally given up, a later run is entitled to search again: that is
  // a new attempt after a recorded failure, not a duplicate of a task still owed.
  await runMarketJob();
  assert.equal(adapter.submissions, 2);
  const open = await pendingProviderTasks('queueing-provider');
  assert.equal(open.length, 1, 'and the new task is tracked like the first one');
});

test('a provider that cannot be asked again does not get a second paid search', async () => {
  const adapter = queueingAdapter({ canCollect: false });
  registerDiscoveryAdapter(adapter);

  await runMarketJob();
  const second = await runMarketJob();

  assert.equal(adapter.submissions, 1,
    'the same market was submitted twice because the first task could not be collected');
  assert.equal(second['outcome'], 'PROVIDER_PENDING');
  assert.match(String(second['outcome_reason']), /cannot be asked for it again/);
});

test('a different market is not mistaken for the outstanding one', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);

  await runMarketJob('32095');
  await runMarketJob('32256');

  assert.equal(adapter.submissions, 2, 'two different markets are two searches');
  const pending = await pendingProviderTasks('queueing-provider');
  assert.equal(pending.length, 2);
});

test('a collection failure closes the task instead of leaving it owed for ever', async () => {
  const adapter: DiscoveryAdapter = {
    name: 'queueing-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return {
        status: 'PENDING', businesses: [], providerRows: 0, rejectedRows: 0, duplicateRows: 0,
        providerTaskId: 'doomed-task',
      };
    },
    async collect(): Promise<DiscoveryResult> {
      return {
        status: 'CREDENTIALS_INVALID', businesses: [],
        providerRows: 0, rejectedRows: 0, duplicateRows: 0,
        reason: 'the credential was revoked between submitting and collecting',
      };
    },
  };
  registerDiscoveryAdapter(adapter);

  await runMarketJob();
  const second = await runMarketJob();

  assert.equal(second['outcome'], 'PROVIDER_UNAVAILABLE');
  assert.notEqual(second['outcome'], 'ZERO_RESULTS');

  const { rows } = await query<{ status: string; error_code: string }>(
    'select status, error_code from provider_tasks');
  assert.equal(rows[0]!.status, 'FAILED');
  assert.equal(rows[0]!.error_code, 'CREDENTIALS_INVALID');
});


test('a crash between collecting and ingesting does not lose the search', async () => {
  // The results are in hand and the Accounts are not written yet. Closing the task
  // at that moment would leave a COLLECTED row nothing will ever ask for again: a
  // search paid for, delivered, and thrown away.
  let ingestShouldFail = true;
  const adapter: DiscoveryAdapter = {
    name: 'queueing-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return {
        status: 'PENDING', businesses: [], providerRows: 0, rejectedRows: 0, duplicateRows: 0,
        providerTaskId: 'crash-task',
      };
    },
    async collect(taskId: string): Promise<DiscoveryResult> {
      return {
        status: 'OK',
        businesses: [{
          // A name long enough to be usable, but the ingest below is what fails.
          name: ingestShouldFail ? 'Crash Test Roofing' : 'Crash Test Roofing',
          website: null, phone: '904-555-8101',
        }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, providerTaskId: taskId,
        costUsd: 0.0031,
      };
    },
  };
  registerDiscoveryAdapter(adapter);

  await runMarketJob();
  const submitted = await pendingProviderTasks('queueing-provider');
  assert.equal(submitted.length, 1);

  // Simulate the crash: the collection happens, and the process dies before the
  // Accounts land. The task must still be owed to us.
  await query(
    `update provider_tasks set poll_attempts = poll_attempts + 1, last_polled_at = now()
      where provider_native_id = 'crash-task'`);
  const stillOwed = await pendingProviderTasks('queueing-provider');
  assert.equal(stillOwed.length, 1,
    'a task in flight must stay PENDING until its results are in inventory');

  ingestShouldFail = false;
  const recovered = await runMarketJob();
  assert.equal(recovered['outcome'], 'COMPLETED');

  const { rows } = await query<{ status: string }>('select status from provider_tasks');
  assert.equal(rows[0]!.status, 'COLLECTED', 'closed only after the Accounts landed');

  const accounts = await query<{ canonical_name: string }>('select canonical_name from accounts');
  assert.deepEqual(accounts.rows.map((row) => row.canonical_name), ['Crash Test Roofing']);
});

test('collecting the same task twice does not create the company twice', async () => {
  // Recovery after a crash re-collects, so ingestion has to be idempotent: the
  // second pass must resolve to the Account the first one created.
  const adapter: DiscoveryAdapter = {
    name: 'queueing-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return {
        status: 'PENDING', businesses: [], providerRows: 0, rejectedRows: 0, duplicateRows: 0,
        providerTaskId: 'repeat-task',
      };
    },
    async collect(taskId: string): Promise<DiscoveryResult> {
      return {
        status: 'OK',
        businesses: [{ name: 'Repeat Roofing', website: null, phone: '904-555-8201' }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, providerTaskId: taskId,
      };
    },
  };
  registerDiscoveryAdapter(adapter);

  await runMarketJob();
  const first = await runMarketJob();
  assert.equal((first['progress'] as Record<string, unknown>)['discoveredNew'], 1);

  // Re-open the task, as a crash before the close would have left it, and run again.
  await query(`update provider_tasks set status = 'PENDING', collected_at = null`);
  const second = await runMarketJob();
  assert.equal((second['progress'] as Record<string, unknown>)['discoveredNew'], 0);
  assert.equal((second['progress'] as Record<string, unknown>)['matchedExisting'], 1);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from accounts where canonical_name = 'Repeat Roofing'`);
  assert.equal(rows[0]!.n, 1, 're-collecting a task created the company a second time');
});
