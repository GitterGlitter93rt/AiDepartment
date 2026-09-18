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
import { enqueueMarketResearch, PROVIDER_COLLECTION_PRIORITY } from '../src/workers/enqueue.js';
import { sweepProviderTasks } from '../src/workers/providerTaskSweeper.js';
import { resetDatabase } from './helpers.js';
import { observationsFor } from './support/observations.js';

/**
 * Collecting an answer we have already bought does not queue behind crawling the
 * companies the last answer produced.
 *
 * Measured in production before this existed: five collect-only jobs created by one
 * sweeper pass at 19:37:51 started at 19:40, 19:47, 19:50, 19:52 and 19:54. The last
 * waited 16m23s. Each collection ingests ~114 rows and queues a research job per new
 * company at priority 50, and those outranked the collections still waiting -- so the
 * more the system collected, the longer the rest of the collection took.
 */

let userId: string;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  userId = await createUser({
    email: 'queue.ops@test.local', displayName: 'Queue Ops', role: 'SALES_MANAGER',
    password: 'queue-password-not-a-secret' });
});

interface Fake extends DiscoveryAdapter { posts: number; readyIds: string[] | null; deliver: boolean; }

function queueingAdapter(): Fake {
  const state = { posts: 0 };
  const fake: Fake = {
    name: 'queueing-provider', requiresCredential: false, governanceReviewed: true,
    mode: 'standard', isConfigured: () => true,
    get posts() { return state.posts; },
    readyIds: null, deliver: false,
    async discover(): Promise<DiscoveryResult> {
      state.posts += 1;
      return { status: 'PENDING', observations: observationsFor([]),
        providerTaskId: `native-${state.posts}` };
    },
    async collect(taskId: string, _r: DiscoveryQuery): Promise<DiscoveryResult> {
      if (!fake.deliver) {
        return { status: 'PENDING', observations: observationsFor([]), providerTaskId: taskId };
      }
      return { status: 'OK', providerTaskId: taskId,
        observations: observationsFor([{ name: 'Collected Co', website: 'collected.example-co', phone: '904-555-0111' }]) };
    },
    async tasksReady(): Promise<string[] | null> { return fake.readyIds; },
  };
  return fake;
}

async function priorityOf(where: string): Promise<number[]> {
  const { rows } = await query<{ priority: number }>(
    `select priority from jobs where job_type = 'market_mine' and ${where} order by created_at`);
  return rows.map((row) => row.priority);
}

test('an ordinary paid market search keeps its ordinary priority', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await enqueueMarketResearch({
    verticalProfileId: 'plumbing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: userId });

  assert.deepEqual(await priorityOf('true'), [80],
    'a new paid search was given collection priority');
});

test('collecting a task already paid for outranks the research it will create', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await enqueueMarketResearch({
    verticalProfileId: 'plumbing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: userId });
  await drainQueue(5);

  adapter.readyIds = ['native-1'];
  await sweepProviderTasks();

  const collect = await priorityOf(`payload->>'confirmed_plan_id' is not null`);
  assert.deepEqual(collect, [PROVIDER_COLLECTION_PRIORITY]);
  // The whole point: ahead of the account research a collection generates.
  assert.ok(PROVIDER_COLLECTION_PRIORITY < 50,
    'collection does not outrank account_research, so it can still be starved');
  assert.ok(PROVIDER_COLLECTION_PRIORITY < 40,
    'collection does not outrank contact_research');
});

test('a collection queued before this existed is promoted, and only a collection is',
  async () => {
    const adapter = queueingAdapter();
    registerDiscoveryAdapter(adapter);
    await enqueueMarketResearch({
      verticalProfileId: 'plumbing', geographyType: 'zip_zcta', geographyValue: '32095',
      marketId: null, requestedBy: userId });
    await drainQueue(5);

    adapter.readyIds = ['native-1'];
    await sweepProviderTasks();

    // Simulate the pre-fix state: the collection sitting at ordinary market priority.
    await query(`update jobs set priority = 80 where payload->>'confirmed_plan_id' is not null`);
    // And an ordinary paid search queued beside it, which must not move.
    await query(
      `insert into jobs (job_type, idempotency_key, payload, requested_by, priority)
       values ('market_mine', 'ordinary-paid-run', '{}'::jsonb, $1, 80)`, [userId]);

    await sweepProviderTasks();

    assert.deepEqual(await priorityOf(`payload->>'confirmed_plan_id' is not null`),
      [PROVIDER_COLLECTION_PRIORITY], 'the queued collection was not promoted');
    assert.deepEqual(await priorityOf(`idempotency_key = 'ordinary-paid-run'`), [80],
      'an ordinary paid market run was reprioritised, which must never happen');
  });

test('promotion never makes a job less urgent', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await enqueueMarketResearch({
    verticalProfileId: 'plumbing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: userId });
  await drainQueue(5);

  adapter.readyIds = ['native-1'];
  await sweepProviderTasks();
  // Somebody has already made it more urgent than our constant.
  await query(`update jobs set priority = 5 where payload->>'confirmed_plan_id' is not null`);
  await sweepProviderTasks();

  assert.deepEqual(await priorityOf(`payload->>'confirmed_plan_id' is not null`), [5],
    'least() moved a job backwards');
});

test('raising collection priority still cannot buy anything', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await enqueueMarketResearch({
    verticalProfileId: 'plumbing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: userId });
  await drainQueue(5);
  assert.equal(adapter.posts, 1);

  adapter.readyIds = ['native-1'];
  adapter.deliver = true;
  await sweepProviderTasks();
  await drainQueue(10);

  // One purchase, ever. The priority change touches ordering, never spend.
  assert.equal(adapter.posts, 1, 'the collection path bought something');
  const { rows } = await query<{ status: string }>(
    `select status from provider_tasks where provider_native_id = 'native-1'`);
  assert.equal(rows[0]!.status, 'COLLECTED');
});

test('repeated sweeps do not stack duplicate collections', async () => {
  const adapter = queueingAdapter();
  registerDiscoveryAdapter(adapter);
  await enqueueMarketResearch({
    verticalProfileId: 'plumbing', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: userId });
  await drainQueue(5);

  adapter.readyIds = ['native-1'];
  await sweepProviderTasks();
  await sweepProviderTasks();
  await sweepProviderTasks();

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs
      where job_type = 'market_mine' and status in ('QUEUED','RUNNING')`);
  assert.equal(rows[0]!.n, 1, 'sweeps stacked duplicate collection jobs');
  assert.equal(adapter.posts, 1);
});
