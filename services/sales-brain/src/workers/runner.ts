import { hostname } from 'node:os';
import { config } from '../config.js';
import { pool, query, withTransaction } from '../db/pool.js';

/**
 * Durable job runner over the Postgres job table.
 * Authority: outbound-sales-brain-job-queue-spec.md, deployment spec §11, §13.
 *
 * Leases rather than deletes, so a worker that dies mid-job releases its work when
 * the lease expires instead of losing it. Runs in its own process: heavy crawling
 * must never share a runtime with the realtime voice path.
 */

export interface JobRecord {
  job_id: string;
  job_type: string;
  payload: Record<string, any>;
  attempts: number;
  max_attempts: number;
  account_id: string | null;
  market_id: string | null;
  requested_by: string | null;
}

/**
 * What a job actually achieved, separate from whether the handler returned.
 *
 * A queue status answers "did this run". An operator looking at a mining page is
 * asking "did the thing I wanted happen", and those are different questions: a
 * market search with no discovery provider registered runs perfectly and discovers
 * nothing, and reporting that as SUCCEEDED is how a person concludes their market
 * has no businesses in it.
 */
export type JobOutcome =
  | 'COMPLETED'
  | 'DISCOVERY_BLOCKED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PARTIAL'
  | 'NOTHING_TO_DO'
  | 'ZERO_RESULTS'
  | 'FAILED';

/**
 * A handler may return an outcome and a reason alongside its progress. Anything that
 * does not is recorded as COMPLETED, which is the right default for work that has
 * only one way to succeed.
 */
export interface JobResult extends Record<string, unknown> {
  outcome?: JobOutcome;
  outcomeReason?: string;
}

export type JobHandler = (job: JobRecord) => Promise<JobResult | void>;

const handlers = new Map<string, JobHandler>();

export function registerHandler(jobType: string, handler: JobHandler): void {
  handlers.set(jobType, handler);
}

const workerId = `${hostname()}:${process.pid}`;

/** Claims one job atomically. `skip locked` lets several workers share the queue. */
async function leaseJob(): Promise<JobRecord | null> {
  const { rows } = await query<JobRecord>(
    `update jobs set status = 'RUNNING',
                     leased_by = $1,
                     leased_until = now() + ($2 || ' seconds')::interval,
                     attempts = attempts + 1,
                     started_at = coalesce(started_at, now())
      where job_id = (
        select job_id from jobs
         -- Due-ness is part of the selection, not a check afterwards: claiming a
         -- backed-off job and then releasing it would burn a retry on every poll.
         where run_after <= now()
           and (status = 'QUEUED' or (status = 'RUNNING' and leased_until < now()))
         order by priority asc, run_after asc, created_at asc
         for update skip locked
         limit 1
      )
      returning job_id, job_type, payload, attempts, max_attempts, account_id, market_id, requested_by`,
    [workerId, String(config.worker.leaseSeconds)],
  );
  return rows[0] ?? null;
}

async function completeJob(jobId: string, progress: JobResult | void): Promise<void> {
  const outcome = progress?.outcome ?? 'COMPLETED';
  const reason = progress?.outcomeReason ?? null;
  await query(
    `update jobs set status = 'SUCCEEDED', completed_at = now(), leased_by = null,
                     leased_until = null, last_error = null, progress = $2,
                     outcome = $3, outcome_reason = $4
      where job_id = $1`,
    [jobId, JSON.stringify(progress ?? {}), outcome, reason],
  );
}

async function failJob(job: JobRecord, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.max_attempts;
  await query(
    `update jobs set status = $2, last_error = $3, leased_by = null, leased_until = null,
                     completed_at = case when $2 = 'FAILED' then now() else null end,
                     outcome = case when $2 = 'FAILED' then 'FAILED' else null end,
                     outcome_reason = case when $2 = 'FAILED' then $5 else null end,
                     -- Back off geometrically so a broken source is not hammered.
                     run_after = now() + (least(power(3, $4::int), 900) || ' seconds')::interval
      where job_id = $1`,
    [job.job_id, exhausted ? 'FAILED' : 'QUEUED', message.slice(0, 2000), job.attempts,
     message.slice(0, 400)],
  );
}

let running = false;
let stopping = false;

/**
 * Worker liveness.
 *
 * A queue with nobody serving it is not healthy, and the absence of stranded jobs
 * cannot tell the two apart: a job nobody has picked up has no expired lease
 * because it has no lease at all. So the worker says it is here, repeatedly, and
 * the operator surfaces read that rather than inferring health from silence.
 */
export const HEARTBEAT_INTERVAL_MS = Number(process.env['WORKER_HEARTBEAT_MS'] ?? '15000');

/**
 * How long after its last heartbeat a worker is presumed gone.
 *
 * Three intervals: one missed beat is a slow job or a busy box, three is a process
 * that is not coming back.
 */
export const HEARTBEAT_STALE_AFTER_MS = HEARTBEAT_INTERVAL_MS * 3;

export async function recordHeartbeat(input: {
  processed?: number; lastJobAt?: Date | null;
} = {}): Promise<void> {
  await query(
    `insert into worker_instances (worker_id, hostname, pid, handlers, last_heartbeat_at,
                                   jobs_processed, last_job_at)
     values ($1, $2, $3, $4, now(), $5, $6)
     on conflict (worker_id) do update set
       last_heartbeat_at = now(),
       handlers = excluded.handlers,
       jobs_processed = greatest(worker_instances.jobs_processed, excluded.jobs_processed),
       last_job_at = coalesce(excluded.last_job_at, worker_instances.last_job_at),
       stopped_at = null`,
    [workerId, hostname(), process.pid, [...handlers.keys()],
     input.processed ?? 0, input.lastJobAt ?? null],
  );
}

/** Marks this worker as stopped on purpose, so a clean shutdown is not an outage. */
export async function recordWorkerStopped(): Promise<void> {
  await query(
    'update worker_instances set stopped_at = now() where worker_id = $1', [workerId]);
}

export const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;

/** Bounded-growth maintenance. Safe to call at any time; each step is independent. */
export async function runHousekeeping(): Promise<{
  sessions: number; uploads: number; loginAttempts: number;
}> {
  const { purgeExpiredSessions, purgeOldLoginAttempts } = await import('../domain/auth.js');
  const { expireStaleSessions } = await import('../import/session.js');
  return {
    sessions: await purgeExpiredSessions(),
    uploads: await expireStaleSessions(),
    loginAttempts: await purgeOldLoginAttempts(),
  };
}

export async function runWorker(log: (message: string, meta?: unknown) => void = console.log): Promise<void> {
  running = true;
  stopping = false;
  log(`[worker] ${workerId} started; handlers: ${[...handlers.keys()].join(', ') || 'none'}`);

  let processed = 0;
  let lastJobAt: Date | null = null;
  await recordHeartbeat({ processed, lastJobAt });
  // The heartbeat is on its own timer rather than tied to the poll loop, so a worker
  // stuck inside one long job still reports that it is alive.
  const heartbeat = setInterval(() => {
    void recordHeartbeat({ processed, lastJobAt }).catch((error: unknown) => {
      log('[worker] heartbeat failed', error);
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  // Housekeeping that nothing else owns: expired sessions, abandoned uploads and old
  // sign-in attempts. Each is a table that only ever grew, on a schedule that did not
  // exist. Hourly is often enough for all three and cheap enough to ignore.
  const housekeeping = setInterval(() => {
    void runHousekeeping().catch((error: unknown) => log('[worker] housekeeping failed', error));
  }, HOUSEKEEPING_INTERVAL_MS);
  housekeeping.unref?.();

  try {
  while (!stopping) {
    let job: JobRecord | null = null;
    try {
      job = await leaseJob();
    } catch (error) {
      log('[worker] failed to lease a job', error);
      await sleep(config.worker.pollIntervalMs * 3);
      continue;
    }

    if (!job) {
      await sleep(config.worker.pollIntervalMs);
      continue;
    }

    const handler = handlers.get(job.job_type);
    if (!handler) {
      log(`[worker] no handler for job type ${job.job_type}; marking failed`);
      await query(
        `update jobs set status = 'FAILED', last_error = $2, completed_at = now() where job_id = $1`,
        [job.job_id, `No handler registered for job type "${job.job_type}"`],
      );
      continue;
    }

    const startedAt = Date.now();
    try {
      const progress = await handler(job);
      await completeJob(job.job_id, progress);
      log(`[worker] ${job.job_type} ${job.job_id} succeeded in ${Date.now() - startedAt}ms`);
    } catch (error) {
      await failJob(job, error);
      log(`[worker] ${job.job_type} ${job.job_id} failed (attempt ${job.attempts}/${job.max_attempts})`, error);
    }
    processed += 1;
    lastJobAt = new Date();
  }
  } finally {
    clearInterval(heartbeat);
    clearInterval(housekeeping);
    await recordWorkerStopped().catch(() => { /* the process is going anyway */ });
  }

  running = false;
  log('[worker] stopped');
}

export function stopWorker(): void {
  stopping = true;
}

export function isRunning(): boolean {
  return running;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs the queue until it is empty. Used by tests and one-shot CLI runs. */
export async function drainQueue(limit = 50): Promise<number> {
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await leaseJob();
    if (!job) break;
    const handler = handlers.get(job.job_type);
    if (!handler) {
      await query(
        `update jobs set status = 'FAILED', last_error = 'no handler', completed_at = now() where job_id = $1`,
        [job.job_id],
      );
      continue;
    }
    try {
      await completeJob(job.job_id, await handler(job));
    } catch (error) {
      await failJob(job, error);
    }
    processed += 1;
  }
  return processed;
}

export { pool, withTransaction };
