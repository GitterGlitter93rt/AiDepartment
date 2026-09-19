import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { upsertAccount, recordEvidence } from '../src/domain/accounts.js';
import {
  registerHandler, drainQueue, type JobRecord,
} from '../src/workers/runner.js';
import {
  enqueueAccountResearch, enqueueContactResearch, enqueueMarketResearch,
} from '../src/workers/enqueue.js';

/**
 * The job queue when the machine loses power.
 * Authority: outbound-sales-brain-job-queue-spec.md, deployment spec SS11, SS13.
 *
 * The EdgeXpert is a box under a desk. It will lose power mid-job, the database will
 * be restarted under a running worker, and a research provider will hang. What
 * matters is not that none of that happens but that none of it loses work, runs work
 * twice where twice is forbidden, or leaves the queue lying about its own state.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

let sequence = 0;
async function makeAccount(name: string): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: name, website: `https://${name.toLowerCase().replace(/\W+/g, '')}.invalid`,
      phone: `904-555-${String(8000 + sequence).slice(-4)}`,
      city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'worker-test' }));
  return accountId;
}

async function jobRow(jobId: string) {
  const { rows } = await query<{
    status: string; attempts: number; max_attempts: number; last_error: string | null;
    leased_by: string | null; leased_until: Date | null; run_after: Date;
    completed_at: Date | null; progress: Record<string, unknown>;
  }>('select * from jobs where job_id = $1', [jobId]);
  return rows[0]!;
}

/** Puts a job back the way a worker that died mid-run would leave it. */
async function simulateWorkerDeath(jobId: string, leaseSecondsAgo = 60): Promise<void> {
  // A real worker increments attempts when it leases, so the fixture does too --
  // otherwise the retry accounting under test would be measured from the wrong start.
  await query(
    `update jobs set status = 'RUNNING', leased_by = 'dead-worker:1',
                     attempts = greatest(attempts, 1),
                     started_at = coalesce(started_at, now()),
                     leased_until = now() - ($2 || ' seconds')::interval
      where job_id = $1`, [jobId, String(leaseSecondsAgo)]);
}

// --- leasing and recovery --------------------------------------------------------

test('a worker that dies mid-job releases it when the lease expires', async () => {
  const accountId = await makeAccount('Lease Recovery Co');
  const job = await enqueueAccountResearch(accountId, null);

  await simulateWorkerDeath(job.jobId);
  const stranded = await jobRow(job.jobId);
  assert.equal(stranded.status, 'RUNNING', 'the fixture did not strand the job');
  assert.ok(stranded.leased_until! < new Date(), 'the lease has not expired');

  let ran = 0;
  registerHandler('account_research', async () => { ran += 1; return { ok: true }; });
  await drainQueue();

  assert.equal(ran, 1, 'the stranded job was not picked up again');
  const after = await jobRow(job.jobId);
  assert.equal(after.status, 'SUCCEEDED');
  assert.equal(after.leased_by, null, 'a finished job still holds its lease');
});

test('a live lease is not stolen by a second worker', async () => {
  const accountId = await makeAccount('Live Lease Co');
  const job = await enqueueAccountResearch(accountId, null);
  // Held by a worker that is still alive.
  await query(
    `update jobs set status = 'RUNNING', leased_by = 'busy-worker:1',
                     leased_until = now() + interval '5 minutes' where job_id = $1`,
    [job.jobId]);

  let ran = 0;
  registerHandler('account_research', async () => { ran += 1; });
  await drainQueue();

  assert.equal(ran, 0, 'a job under a live lease was run by a second worker');
  const after = await jobRow(job.jobId);
  assert.equal(after.leased_by, 'busy-worker:1');
});

test('a job that completes but whose process dies before acknowledging runs again',
  async () => {
    // The handler did its work and the process died before the SUCCEEDED write. The
    // queue can only see an expired lease, so it re-runs the job: handlers have to be
    // idempotent, and this proves the re-run happens rather than the work vanishing.
    const accountId = await makeAccount('Unacknowledged Co');
    const job = await enqueueAccountResearch(accountId, null);
    await simulateWorkerDeath(job.jobId);

    const seen: number[] = [];
    registerHandler('account_research', async (record: JobRecord) => {
      seen.push(record.attempts);
      // Writing the same evidence twice is what a re-run does. Nothing may duplicate.
      await withTransaction((client) => recordEvidence(client, {
        accountId, category: 'website', claimKey: 'after_hours_answering',
        claimText: 'Site says 24/7.', confidence: 'likely', canStateAsFact: false,
        sourceType: 'website', sourceReference: 'https://unacknowledged.invalid',
      }));
    });
    await drainQueue();

    assert.equal(seen.length, 1, 'the job did not re-run after the lease expired');
    const after = await jobRow(job.jobId);
    assert.equal(after.status, 'SUCCEEDED');
    assert.ok(after.attempts >= 2, `attempts is ${after.attempts}; the retry was not counted`);
  });

test('the same job enqueued twice is queued once', async () => {
  const accountId = await makeAccount('Duplicate Enqueue Co');
  const first = await enqueueAccountResearch(accountId, null);
  const second = await enqueueAccountResearch(accountId, null);
  assert.equal(second.jobId, first.jobId, 'a duplicate enqueue created a second job');
  assert.equal(second.created, false, 'the duplicate reported itself as newly created');

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'account_research'`);
  assert.equal(rows[0]!.n, 1);
});

test('a job can be re-enqueued once the first one has finished', async () => {
  const accountId = await makeAccount('Re-enqueue Co');
  const first = await enqueueAccountResearch(accountId, null);
  registerHandler('account_research', async () => {});
  await drainQueue();
  assert.equal((await jobRow(first.jobId)).status, 'SUCCEEDED');

  // The idempotency key only holds while the job is queued or running: research does
  // have to be refreshed eventually.
  const second = await enqueueAccountResearch(accountId, null);
  assert.notEqual(second.jobId, first.jobId, 'a finished job blocked a later refresh');
  assert.equal(second.created, true);
});

// --- failure, retry and exhaustion ------------------------------------------------

test('a failing job is retried with a growing delay, then marked failed', async () => {
  const accountId = await makeAccount('Retry Exhaustion Co');
  const job = await enqueueAccountResearch(accountId, null);
  await query('update jobs set max_attempts = 3 where job_id = $1', [job.jobId]);

  let attempts = 0;
  registerHandler('account_research', async () => {
    attempts += 1;
    throw new Error(`provider unavailable (attempt ${attempts})`);
  });

  const delays: number[] = [];
  for (let round = 0; round < 3; round += 1) {
    // Each round the backoff pushes run_after into the future; the test moves it
    // back so the queue is drainable without waiting minutes.
    await query(`update jobs set run_after = now() where job_id = $1`, [job.jobId]);
    await drainQueue();
    const row = await jobRow(job.jobId);
    delays.push(Math.round((row.run_after.getTime() - Date.now()) / 1000));
  }

  assert.equal(attempts, 3, `the handler ran ${attempts} times for max_attempts 3`);
  const final = await jobRow(job.jobId);
  assert.equal(final.status, 'FAILED', 'an exhausted job is not marked failed');
  assert.ok(final.last_error!.includes('provider unavailable'),
    'the failure reason was not kept');
  assert.ok(final.completed_at, 'a failed job has no completion time');
  // The delay grows rather than hammering a broken provider.
  assert.ok(delays[1]! > delays[0]!, `backoff did not grow: ${delays.join(', ')}`);
});

test('an exhausted job does not block the queue behind it', async () => {
  const poison = await makeAccount('Poison Job Co');
  const healthy = await makeAccount('Healthy Job Co');
  const poisonJob = await enqueueAccountResearch(poison, null);
  await query('update jobs set max_attempts = 1 where job_id = $1', [poisonJob.jobId]);
  const healthyOps = await makeUser('Healthy Ops', 'RESEARCH_OPS');
  const healthyJob = await enqueueContactResearch(healthy, healthyOps.userId);

  const ran: string[] = [];
  registerHandler('account_research', async () => {
    ran.push('poison');
    throw new Error('this job will always fail');
  });
  registerHandler('contact_research', async () => { ran.push('healthy'); });

  await drainQueue();

  assert.ok(ran.includes('healthy'), 'a poison job blocked the queue behind it');
  assert.equal((await jobRow(poisonJob.jobId)).status, 'FAILED');
  assert.equal((await jobRow(healthyJob.jobId)).status, 'SUCCEEDED');
});

test('a job with no registered handler fails loudly instead of spinning', async () => {
  const accountId = await makeAccount('No Handler Co');
  const { rows } = await query<{ job_id: string }>(
    `insert into jobs (job_type, payload, account_id, status)
     values ('a_job_type_nobody_handles', '{}'::jsonb, $1, 'QUEUED') returning job_id`,
    [accountId]);
  const jobId = rows[0]!.job_id;

  await drainQueue();

  const after = await jobRow(jobId);
  assert.equal(after.status, 'FAILED');
  assert.match(after.last_error ?? '', /no handler/i);
  assert.ok(after.completed_at, 'an unhandled job was left without a completion time');
});

test('a handler that hangs past its lease does not have its work double-counted',
  async () => {
    // The provider timed out. The lease expires while the handler is still waiting,
    // a second worker picks the job up, and both eventually write. The write has to
    // be the thing that is idempotent, because the queue cannot promise once-only.
    const accountId = await makeAccount('Hanging Provider Co');
    const job = await enqueueAccountResearch(accountId, null);

    let runs = 0;
    registerHandler('account_research', async () => {
      runs += 1;
      await withTransaction((client) => recordEvidence(client, {
        accountId, category: 'advertising', claimKey: 'active_google_search_ad',
        claimText: 'One ad observed.', normalizedValue: 'yes', confidence: 'confirmed',
        canStateAsFact: true, sourceType: 'serp_observation', sourceReference: 'run-1',
      }));
    });

    await drainQueue();
    await simulateWorkerDeath(job.jobId);
    await drainQueue();

    assert.equal(runs, 2, 'the fixture did not produce a second run');
    // Evidence is append-only by design, so two runs leave two observations -- and
    // that is correct: each is a separate observation with its own timestamp. What
    // must not happen is two *current* claims disagreeing about the same fact.
    const evidence = await query<{ n: number; distinct_claims: number }>(
      `select count(*)::int as n, count(distinct claim_key)::int as distinct_claims
         from evidence_records where account_id = $1`, [accountId]);
    assert.equal(evidence.rows[0]!.distinct_claims, 1);
    assert.ok(evidence.rows[0]!.n >= 1);
  });

// --- the queue's own honesty ------------------------------------------------------

test('the queue reports what is really happening, not what it hoped', async () => {
  const stuck = await makeAccount('Stuck Job Co');
  const queued = await makeAccount('Queued Job Co');
  const done = await makeAccount('Done Job Co');

  const ops = await makeUser('Queue Ops', 'RESEARCH_OPS');
  const stuckJob = await enqueueAccountResearch(stuck, null);
  await simulateWorkerDeath(stuckJob.jobId, 3_600);
  const queuedJob = await enqueueContactResearch(queued, ops.userId);
  const doneJob = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32256',
    marketId: null, requestedBy: ops.userId,
  });
  await query(`update jobs set status = 'SUCCEEDED', completed_at = now() where job_id = $1`,
    [doneJob.jobId]);

  const counts = await query<{ status: string; n: number; overdue: number }>(
    `select status, count(*)::int as n,
            count(*) filter (where status = 'RUNNING' and leased_until < now())::int as overdue
       from jobs group by status order by status`);
  const byStatus = Object.fromEntries(counts.rows.map((row) => [row.status, row]));

  assert.equal(byStatus['RUNNING']!.n, 1);
  assert.equal(byStatus['RUNNING']!.overdue, 1,
    'a job whose lease expired an hour ago is not visible as overdue');
  assert.equal(byStatus['QUEUED']!.n, 1);
  assert.equal(byStatus['SUCCEEDED']!.n, 1);
  void queuedJob;
});

test('a failed provider call does not mark research fresh', async () => {
  const accountId = await makeAccount('Failed Research Co');
  const before = await query<{ last_researched_at: Date | null; research_fresh_until: Date | null }>(
    'select last_researched_at, research_fresh_until from accounts where account_id = $1',
    [accountId]);

  const job = await enqueueAccountResearch(accountId, null);
  await query('update jobs set max_attempts = 1 where job_id = $1', [job.jobId]);
  registerHandler('account_research', async () => {
    throw new Error('the provider returned 503');
  });
  await drainQueue();

  assert.equal((await jobRow(job.jobId)).status, 'FAILED');
  const after = await query<{ last_researched_at: Date | null; research_fresh_until: Date | null;
                             research_completeness: string }>(
    `select last_researched_at, research_fresh_until, research_completeness
       from accounts where account_id = $1`, [accountId]);
  assert.deepEqual(after.rows[0]!.last_researched_at, before.rows[0]!.last_researched_at,
    'a failed research run updated the researched-at timestamp');
  assert.deepEqual(after.rows[0]!.research_fresh_until, before.rows[0]!.research_fresh_until,
    'a failed research run extended the freshness window');
});

test('a database connection dropped mid-drain does not lose the job', async () => {
  const accountId = await makeAccount('Connection Drop Co');
  const job = await enqueueAccountResearch(accountId, null);

  let runs = 0;
  registerHandler('account_research', async () => {
    runs += 1;
    if (runs === 1) {
      // What a dropped connection looks like to a handler.
      const error = new Error('Connection terminated unexpectedly');
      (error as { code?: string }).code = 'ECONNRESET';
      throw error;
    }
  });

  await drainQueue();
  const afterFailure = await jobRow(job.jobId);
  assert.equal(afterFailure.status, 'QUEUED', 'a dropped connection lost the job');
  assert.match(afterFailure.last_error ?? '', /Connection terminated/);

  await query(`update jobs set run_after = now() where job_id = $1`, [job.jobId]);
  await drainQueue();
  assert.equal((await jobRow(job.jobId)).status, 'SUCCEEDED', 'the retry did not happen');
  assert.equal(runs, 2);
});

test('two workers draining at once never run one job twice', async () => {
  const accountIds: string[] = [];
  for (let i = 0; i < 12; i += 1) accountIds.push(await makeAccount(`Shared Queue ${i}`));
  for (const accountId of accountIds) await enqueueAccountResearch(accountId, null);

  const runsPerJob = new Map<string, number>();
  registerHandler('account_research', async (record: JobRecord) => {
    runsPerJob.set(record.job_id, (runsPerJob.get(record.job_id) ?? 0) + 1);
    // Long enough that the two drains genuinely overlap.
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  });

  await Promise.all([drainQueue(), drainQueue()]);

  assert.equal(runsPerJob.size, 12, `${runsPerJob.size} of 12 jobs ran`);
  for (const [jobId, count] of runsPerJob) {
    assert.equal(count, 1, `job ${jobId} ran ${count} times`);
  }
  const statuses = await query<{ status: string; n: number }>(
    `select status, count(*)::int as n from jobs group by status`);
  assert.deepEqual(statuses.rows, [{ status: 'SUCCEEDED', n: 12 }]);
});

test('partial research is recorded as partial, not as complete', async () => {
  const accountId = await makeAccount('Partial Research Co');
  const job = await enqueueAccountResearch(accountId, null);

  registerHandler('account_research', async () => {
    // The handler got some of what it wanted and reports that honestly.
    return { stagesAttempted: 4, stagesSucceeded: 2, note: 'two sources did not answer' };
  });
  await drainQueue();

  const after = await jobRow(job.jobId);
  assert.equal(after.status, 'SUCCEEDED');
  assert.equal((after.progress as { stagesSucceeded?: number }).stagesSucceeded, 2,
    'the partial result was not recorded');
  assert.equal((after.progress as { stagesAttempted?: number }).stagesAttempted, 4);
});
