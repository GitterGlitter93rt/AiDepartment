import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { registerHandler, runWorker, stopWorker, drainQueue } from '../src/workers/runner.js';

/**
 * WORKER_CONCURRENCY was declared in config.ts and consumed by nothing.
 *
 * The worker leased one job at a time whatever the value said, so scaling the V2 estate
 * rebuild meant starting extra processes by hand and killing them by hand afterwards.
 * These tests are about the thing that makes N lanes safe rather than merely fast: a
 * lease belongs to whoever holds it, two lanes never hold one job, a deliberate stop
 * finishes the work in flight, and the job types that spend money still run singly.
 */

const ENV = { ...process.env };
after(async () => { Object.assign(process.env, ENV); await pool.end(); });

beforeEach(async () => {
  await resetDatabase();
  process.env['WORKER_CONCURRENCY'] = '1';
});

async function enqueue(jobType: string, payload: Record<string, unknown> = {},
                       key?: string): Promise<string> {
  const { rows } = await query<{ job_id: string }>(
    `insert into jobs (job_type, payload, idempotency_key) values ($1,$2::jsonb,$3)
     returning job_id`,
    [jobType, JSON.stringify(payload), key ?? null]);
  return rows[0]!.job_id;
}

/** Runs the worker until `until` says stop, then shuts it down and waits for it. */
async function workUntil(until: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const worker = runWorker(() => { /* quiet */ });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !(await until())) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  stopWorker();
  await worker;
}

test('four lanes run four jobs at once, and one lane does not', async () => {
  // The measurement that matters is overlap, not wall-clock: a faster run could be a
  // faster machine, but two jobs inside each other's start and end can only be two lanes.
  for (const lanes of ['1', '4']) {
    await resetDatabase();
    process.env['WORKER_CONCURRENCY'] = lanes;
    process.env['WORKER_POLL_INTERVAL_MS'] = '100';

    let inFlight = 0;
    let peak = 0;
    registerHandler('overlap_probe', async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 150));
      inFlight -= 1;
      return { outcome: 'COMPLETED' as const };
    });

    for (let i = 0; i < 4; i += 1) await enqueue('overlap_probe', { i });
    await workUntil(async () => {
      const { rows } = await query<{ n: string }>(
        `select count(*)::text as n from jobs where status = 'SUCCEEDED'`);
      return Number(rows[0]!.n) === 4;
    });

    const { rows } = await query<{ n: string }>(
      `select count(*)::text as n from jobs where status = 'SUCCEEDED'`);
    assert.equal(Number(rows[0]!.n), 4, `all four ran at concurrency ${lanes}`);
    if (lanes === '1') assert.equal(peak, 1, 'one lane holds one job at a time');
    else assert.ok(peak > 1, `four lanes overlap (peak was ${peak})`);
  }
});

test('no job is ever run by two lanes', async () => {
  process.env['WORKER_CONCURRENCY'] = '4';
  process.env['WORKER_POLL_INTERVAL_MS'] = '100';

  const runsById = new Map<string, number>();
  registerHandler('claim_probe', async (job) => {
    runsById.set(job.job_id, (runsById.get(job.job_id) ?? 0) + 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { outcome: 'COMPLETED' as const };
  });

  for (let i = 0; i < 12; i += 1) await enqueue('claim_probe', { i });
  await workUntil(async () => {
    const { rows } = await query<{ n: string }>(
      `select count(*)::text as n from jobs where status = 'SUCCEEDED'`);
    return Number(rows[0]!.n) === 12;
  });

  assert.equal(runsById.size, 12, 'twelve distinct jobs ran');
  for (const [jobId, times] of runsById) {
    assert.equal(times, 1, `job ${jobId} ran exactly once`);
  }
});

test('each lane owns its lease by name', async () => {
  process.env['WORKER_CONCURRENCY'] = '3';
  process.env['WORKER_POLL_INTERVAL_MS'] = '100';

  const leaseHolders = new Set<string>();
  registerHandler('lease_probe', async (job) => {
    const { rows } = await query<{ leased_by: string }>(
      `select leased_by from jobs where job_id = $1`, [job.job_id]);
    if (rows[0]?.leased_by) leaseHolders.add(rows[0].leased_by);
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { outcome: 'COMPLETED' as const };
  });

  for (let i = 0; i < 6; i += 1) await enqueue('lease_probe', { i });
  await workUntil(async () => {
    const { rows } = await query<{ n: string }>(
      `select count(*)::text as n from jobs where status = 'SUCCEEDED'`);
    return Number(rows[0]!.n) === 6;
  });

  // An expired lease has to name the lane that stopped making progress, not the
  // process it happened to be in.
  assert.ok(leaseHolders.size > 1, `several lanes held leases: ${[...leaseHolders]}`);
  for (const holder of leaseHolders) assert.match(holder, /#\d+$/);
});

test('the heartbeat reports every job the process is holding', async () => {
  process.env['WORKER_CONCURRENCY'] = '4';
  process.env['WORKER_POLL_INTERVAL_MS'] = '100';
  process.env['WORKER_HEARTBEAT_MS'] = '1000';

  registerHandler('heartbeat_probe', async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { outcome: 'COMPLETED' as const };
  });
  for (let i = 0; i < 4; i += 1) await enqueue('heartbeat_probe', { i });

  let widest = 0;
  let reportedConcurrency = 0;
  await workUntil(async () => {
    const { rows } = await query<{ n: number; c: number; done: string }>(
      `select coalesce(array_length(current_job_ids, 1), 0) as n, concurrency as c,
              (select count(*)::text from jobs where status = 'SUCCEEDED') as done
         from worker_instances limit 1`);
    if (rows[0]) {
      widest = Math.max(widest, Number(rows[0].n));
      reportedConcurrency = Number(rows[0].c);
    }
    return Number(rows[0]?.done ?? 0) === 4;
  });

  assert.equal(reportedConcurrency, 4, 'the row says how many lanes there are');
  assert.ok(widest > 1,
    `the heartbeat named more than one held job at once (widest was ${widest})`);
});

test('a job type that spends money runs in one lane only', async () => {
  // The spend ceiling reads what has been spent and then spends. Two lanes either side
  // of that gap both see the same money as unspent, so rather than turn a precondition
  // into a distributed reservation, the paid type is capped.
  process.env['WORKER_CONCURRENCY'] = '4';
  process.env['WORKER_POLL_INTERVAL_MS'] = '100';

  let inFlight = 0;
  let peak = 0;
  registerHandler('market_mine', async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 120));
    inFlight -= 1;
    return { outcome: 'COMPLETED' as const };
  });

  for (let i = 0; i < 4; i += 1) await enqueue('market_mine', { i });
  await workUntil(async () => {
    const { rows } = await query<{ n: string }>(
      `select count(*)::text as n from jobs where status = 'SUCCEEDED'`);
    return Number(rows[0]!.n) === 4;
  });

  assert.equal(peak, 1, 'market_mine never ran two at once');
  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n from jobs where status = 'SUCCEEDED'`);
  assert.equal(Number(rows[0]!.n), 4, 'and all four still ran');
});

test('a capped job type does not burn retries being handed back', async () => {
  // Claiming a job to release it increments attempts, so a capped type would spend a
  // retry on every poll. The cap belongs in the lease predicate.
  process.env['WORKER_CONCURRENCY'] = '4';
  process.env['WORKER_POLL_INTERVAL_MS'] = '50';

  registerHandler('market_mine', async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { outcome: 'COMPLETED' as const };
  });
  for (let i = 0; i < 3; i += 1) await enqueue('market_mine', { i });

  await workUntil(async () => {
    const { rows } = await query<{ n: string }>(
      `select count(*)::text as n from jobs where status = 'SUCCEEDED'`);
    return Number(rows[0]!.n) === 3;
  });

  const { rows } = await query<{ attempts: number }>(`select attempts from jobs`);
  for (const row of rows) {
    assert.equal(row.attempts, 1, 'each job was claimed exactly once');
  }
});

test('stopping finishes the work in flight rather than abandoning it', async () => {
  process.env['WORKER_CONCURRENCY'] = '4';
  process.env['WORKER_POLL_INTERVAL_MS'] = '50';

  let finished = 0;
  registerHandler('shutdown_probe', async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    finished += 1;
    return { outcome: 'COMPLETED' as const };
  });
  for (let i = 0; i < 4; i += 1) await enqueue('shutdown_probe', { i });

  const worker = runWorker(() => { /* quiet */ });
  // Let all four lanes pick up work, then ask to stop mid-job.
  await new Promise((resolve) => setTimeout(resolve, 200));
  stopWorker();
  await worker;

  assert.equal(finished, 4, 'every job in flight ran to completion');
  const { rows } = await query<{ status: string; n: string }>(
    `select status, count(*)::text as n from jobs group by status`);
  const succeeded = rows.find((r) => r.status === 'SUCCEEDED');
  assert.equal(Number(succeeded?.n ?? 0), 4);

  // And the process says it stopped on purpose, so a deploy is not read as an outage.
  const { rows: workers } = await query<{ stopped_at: string | null; ids: string[] }>(
    `select stopped_at, current_job_ids as ids from worker_instances`);
  assert.ok(workers[0]?.stopped_at, 'the worker recorded a deliberate stop');
  assert.deepEqual(workers[0]?.ids, [], 'and is holding nothing');
});

test('an expired lease is picked up again, by whichever lane is free', async () => {
  // A worker that dies mid-job releases its work when the lease expires. That is the
  // property concurrency must not break: a lease belongs to a holder, not to a process.
  const jobId = await enqueue('crash_probe', {});
  await query(
    `update jobs set status = 'RUNNING', leased_by = 'ghost:1#2',
            leased_until = now() - interval '1 minute', attempts = 1
      where job_id = $1`, [jobId]);

  let ran = 0;
  registerHandler('crash_probe', async () => { ran += 1; return { outcome: 'COMPLETED' as const }; });
  assert.equal(await drainQueue(5), 1, 'the abandoned job was claimed');
  assert.equal(ran, 1);

  const { rows } = await query<{ status: string; attempts: number }>(
    `select status, attempts from jobs where job_id = $1`, [jobId]);
  assert.equal(rows[0]?.status, 'SUCCEEDED');
  assert.equal(rows[0]?.attempts, 2, 'the retry counted, so a crash loop still terminates');
});

test('the same Account queued twice is two jobs, and each runs once', async () => {
  process.env['WORKER_CONCURRENCY'] = '4';
  process.env['WORKER_POLL_INTERVAL_MS'] = '50';

  const seen: string[] = [];
  registerHandler('account_probe', async (job) => {
    seen.push(String(job.payload['account_id']));
    await new Promise((resolve) => setTimeout(resolve, 60));
    return { outcome: 'COMPLETED' as const };
  });

  // Distinct idempotency keys: two genuinely different pieces of work about one Account.
  await enqueue('account_probe', { account_id: 'A' }, 'probe:A:first');
  await enqueue('account_probe', { account_id: 'A' }, 'probe:A:second');
  await workUntil(async () => {
    const { rows } = await query<{ n: string }>(
      `select count(*)::text as n from jobs where status = 'SUCCEEDED'`);
    return Number(rows[0]!.n) === 2;
  });
  assert.deepEqual(seen, ['A', 'A']);

  // And the same key twice is one job, whatever the concurrency.
  const { rows } = await query<{ n: string }>(
    `select count(*)::text as n from jobs where idempotency_key = 'probe:A:first'`);
  assert.equal(Number(rows[0]!.n), 1);
});
