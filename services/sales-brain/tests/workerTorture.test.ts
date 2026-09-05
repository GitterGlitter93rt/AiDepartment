import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import {
  drainQueue, registerHandler, recordHeartbeat, recordWorkerStopped,
  recordWorkerDraining, stopWorker, isDraining,
} from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch, enqueueAccountResearch } from '../src/workers/enqueue.js';
import { operationalSnapshot } from '../src/api/operations.js';
import { scoreAccount } from '../src/scoring/score.js';
import { reconcileMissingResearch } from '../src/workers/researchReconcile.js';
import { pendingProviderTasks } from '../src/miner/providerTasks.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Trying to break the worker on purpose.
 * Authority: Issue #3 Phase N.
 *
 * The recovery cases already covered in workerRecovery.test.ts are lease expiry,
 * live leases, retries and two workers draining at once. What was missing is the
 * state between running and stopped, and the crash points along the discovery
 * pipeline that only exist now that the pipeline has stages.
 */

let manager: Awaited<ReturnType<typeof makeUser>>;
let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  manager = await makeUser('Torture Manager', 'SALES_MANAGER');
});

// ------------------------------------------------------------------ draining --

test('a worker asked to stop is neither running nor stopped, and says so', async () => {
  await recordHeartbeat({ processed: 5 });
  const running = await operationalSnapshot();
  assert.equal(running.checks.find((c) => c.id === 'worker')!.state, 'OK');

  await recordWorkerDraining();

  const { rows } = await query<{ draining_since: Date | null }>(
    'select draining_since from worker_instances');
  assert.ok(rows[0]!.draining_since, 'nothing recorded that the worker is winding down');
});

test('a draining worker with work waiting behind it is a blockage, not health', async () => {
  await recordHeartbeat({ processed: 1 });
  await recordWorkerDraining();
  await query(
    `insert into jobs (job_type, status, payload) values ('market_mine', 'QUEUED', '{}'::jsonb)`);

  const snapshot = await operationalSnapshot();
  const worker = snapshot.checks.find((c) => c.id === 'worker')!;
  assert.equal(worker.state, 'BLOCKED',
    'a worker taking no new work read as perfectly healthy');
  assert.match(worker.value, /draining/);
  assert.match(worker.detail ?? '', /Nothing new is being picked up/);
});

test('a draining worker with an empty queue is not an emergency', async () => {
  await recordHeartbeat({ processed: 1 });
  await recordWorkerDraining();

  const snapshot = await operationalSnapshot();
  const worker = snapshot.checks.find((c) => c.id === 'worker')!;
  assert.equal(worker.state, 'ATTENTION');
  assert.notEqual(worker.state, 'BLOCKED');
});

test('draining is sticky: a heartbeat does not undo it', async () => {
  await recordHeartbeat({ processed: 1 });
  await recordWorkerDraining();
  await recordHeartbeat({ processed: 2 });

  const { rows } = await query<{ draining_since: Date | null }>(
    'select draining_since from worker_instances');
  assert.ok(rows[0]!.draining_since,
    'the next heartbeat reported the worker as running normally again');
});

test('a clean stop clears draining rather than leaving it half-stopped', async () => {
  await recordHeartbeat({ processed: 1 });
  await recordWorkerDraining();
  await recordWorkerStopped();

  const { rows } = await query<{ draining_since: Date | null; stopped_at: Date | null }>(
    'select draining_since, stopped_at from worker_instances');
  assert.equal(rows[0]!.draining_since, null);
  assert.ok(rows[0]!.stopped_at);

  const snapshot = await operationalSnapshot();
  assert.notEqual(snapshot.checks.find((c) => c.id === 'worker')!.state, 'BLOCKED');
});

test('the worker names the job it is holding while it drains', async () => {
  const { rows: jobRows } = await query<{ job_id: string }>(
    `insert into jobs (job_type, status, payload)
     values ('market_mine', 'RUNNING', '{}'::jsonb) returning job_id`);
  await recordHeartbeat({ processed: 0, currentJobId: jobRows[0]!.job_id });

  const { rows } = await query<{ current_job_id: string }>(
    'select current_job_id from worker_instances');
  assert.equal(rows[0]!.current_job_id, jobRows[0]!.job_id,
    'a drain that will not finish leaves the operator guessing which job holds it');
});

// -------------------------------------------- crash points along the pipeline --

test('a crash after the Account lands but before research is queued is recovered',
  async () => {
    // The window between the ingestion transaction committing and the research
    // enqueue returning. Everything about the Account is durable; the intention to
    // research it is not.
    sequence += 1;
    const { accountId } = await withTransaction((client) => upsertAccount(client, {
      canonicalName: 'Crashed Before Research',
      website: `https://torture${sequence}.invalid`,
      phone: `904-555-${String(9500 + sequence).slice(-4)}`,
      city: 'St. Augustine', state: 'FL', postalCode: '32095',
    }, { discoverySource: 'market_miner:dataforseo' }));
    await query(
      `update accounts set created_at = now() - interval '30 minutes' where account_id = $1`,
      [accountId]);

    const { rows: before } = await query<{ n: number }>(
      'select count(*)::int as n from jobs where account_id = $1', [accountId]);
    assert.equal(before[0]!.n, 0, 'the crash left no research queued');

    const recovered = await reconcileMissingResearch();
    assert.equal(recovered.queued, 1);
  });

test('a crash before the score is written leaves the Account scoreable, not scored wrong',
  async () => {
    sequence += 1;
    const { accountId } = await withTransaction((client) => upsertAccount(client, {
      canonicalName: 'Crashed Before Score',
      website: `https://torture${sequence}.invalid`,
      phone: `904-555-${String(9600 + sequence).slice(-4)}`,
      city: 'St. Augustine', state: 'FL', postalCode: '32095',
      verticalProfileId: 'hvac',
    }, { discoverySource: 'market_miner:dataforseo' }));

    await query(
      `insert into research_runs (account_id, trigger, status, completed_at)
       values ($1, 'newly_discovered', 'completed', now())`, [accountId]);
    await query(
      `insert into evidence_records (account_id, category, claim_key, claim_text,
                                     normalized_value, confidence, can_state_as_fact,
                                     source_type, expires_at, freshness)
       values ($1, 'paid_acquisition', 'active_google_search_ad', 'ad seen', 'yes',
               'confirmed', true, 'provider_serp', now() + interval '48 hours', 'fresh')`,
      [accountId]);

    // The research is durable and the score is not: exactly the crash state.
    const unscored = await query<{ manual_tier: string | null }>(
      'select manual_tier from accounts where account_id = $1', [accountId]);
    assert.equal(unscored.rows[0]!.manual_tier, null);

    const result = await scoreAccount(accountId);
    assert.equal(result.totalPoints, 4,
      'the evidence the crashed run wrote is still there to score');
  });

test('a job whose process died mid-handler is retried, not lost', async () => {
  let attempts = 0;
  registerHandler('torture_flaky', async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('process died');
    return { outcome: 'COMPLETED' as const };
  });

  const { rows } = await query<{ job_id: string }>(
    `insert into jobs (job_type, status, payload, max_attempts)
     values ('torture_flaky', 'QUEUED', '{}'::jsonb, 3) returning job_id`);
  await drainQueue(5);
  // The retry is scheduled with backoff, so bring it forward as time would.
  await query(`update jobs set run_after = now() - interval '1 hour'`);
  await drainQueue(5);

  const final = await query<{ status: string; attempts: number }>(
    'select status, attempts from jobs where job_id = $1', [rows[0]!.job_id]);
  assert.equal(final.rows[0]!.status, 'SUCCEEDED');
  assert.equal(final.rows[0]!.attempts, 2, 'the attempt count was lost across the crash');
});

// -------------------------------------------- two workers and one paid search --

test('two market searches for the same market cannot both be in flight', async () => {
  // The guard that stops two workers buying the same search is the partial unique
  // index over QUEUED and RUNNING: at most one job per fingerprint exists in either
  // state, and skip-locked stops two workers leasing that one.
  registerDiscoveryAdapter({
    name: 'torture-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return { status: 'ZERO_RESULTS', businesses: [], providerRows: 0,
        rejectedRows: 0, duplicateRows: 0 };
    },
  });

  const requests = await Promise.all([
    enqueueMarketResearch({ verticalProfileId: 'hvac', geographyType: 'zip_zcta',
      geographyValue: '32095', marketId: null, requestedBy: manager.userId }),
    enqueueMarketResearch({ verticalProfileId: 'hvac', geographyType: 'zip_zcta',
      geographyValue: ' 32095 ', marketId: null, requestedBy: manager.userId }),
    enqueueMarketResearch({ verticalProfileId: 'hvac', geographyType: 'zip_zcta',
      geographyValue: '32095-1234', marketId: null, requestedBy: manager.userId }),
  ]);

  const created = requests.filter((request) => request.created).length;
  assert.equal(created, 1, `${created} paid searches were queued for one market`);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.n, 1);
});

test('two workers draining the same queue never run one job twice', async () => {
  let runs = 0;
  registerHandler('torture_counted', async () => {
    runs += 1;
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    return { outcome: 'COMPLETED' as const };
  });

  for (let index = 0; index < 6; index += 1) {
    await query(
      `insert into jobs (job_type, status, payload) values ('torture_counted', 'QUEUED', '{}'::jsonb)`);
  }

  await Promise.all([drainQueue(10), drainQueue(10)]);
  assert.equal(runs, 6, `six jobs ran ${runs} times`);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs
      where job_type = 'torture_counted' and status = 'SUCCEEDED'`);
  assert.equal(rows[0]!.n, 6);
});

test('an outstanding provider task survives everything the worker does', async () => {
  registerDiscoveryAdapter({
    name: 'torture-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return {
        status: 'PENDING', businesses: [], providerRows: 0, rejectedRows: 0,
        duplicateRows: 0, providerTaskId: 'survives-restart',
      };
    },
  });

  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: manager.userId });
  await drainQueue(5);

  // Everything in memory is gone; the row is not.
  const owed = await pendingProviderTasks('torture-provider');
  assert.equal(owed.length, 1);
  assert.equal(owed[0]!.provider_native_id, 'survives-restart');
});

// -------------------------------------------------- losing the database itself --

test('a dropped connection does not lose a queued job', async () => {
  registerHandler('torture_after_drop', async () => ({ outcome: 'COMPLETED' as const }));
  const { rows } = await query<{ job_id: string }>(
    `insert into jobs (job_type, status, payload)
     values ('torture_after_drop', 'QUEUED', '{}'::jsonb) returning job_id`);

  // Kill every other connection to this database, as a restart would.
  await query(
    `select pg_terminate_backend(pid) from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()`);

  // The pool reconnects and the work is still there.
  await drainQueue(5);
  const after = await query<{ status: string }>(
    'select status from jobs where job_id = $1', [rows[0]!.job_id]);
  assert.equal(after.rows[0]!.status, 'SUCCEEDED',
    'a connection drop lost a job that was safely in the queue');
});

test('a heartbeat survives the connection under it going away', async () => {
  await recordHeartbeat({ processed: 3 });
  await query(
    `select pg_terminate_backend(pid) from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid()`);

  await recordHeartbeat({ processed: 4 });
  const { rows } = await query<{ jobs_processed: string }>(
    'select jobs_processed from worker_instances');
  assert.equal(Number(rows[0]!.jobs_processed), 4);
});
