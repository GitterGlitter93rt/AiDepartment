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

export type JobHandler = (job: JobRecord) => Promise<Record<string, unknown> | void>;

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

async function completeJob(jobId: string, progress: Record<string, unknown> | void): Promise<void> {
  await query(
    `update jobs set status = 'SUCCEEDED', completed_at = now(), leased_by = null,
                     leased_until = null, last_error = null, progress = $2
      where job_id = $1`,
    [jobId, JSON.stringify(progress ?? {})],
  );
}

async function failJob(job: JobRecord, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.max_attempts;
  await query(
    `update jobs set status = $2, last_error = $3, leased_by = null, leased_until = null,
                     completed_at = case when $2 = 'FAILED' then now() else null end,
                     -- Back off geometrically so a broken source is not hammered.
                     run_after = now() + (least(power(3, $4::int), 900) || ' seconds')::interval
      where job_id = $1`,
    [job.job_id, exhausted ? 'FAILED' : 'QUEUED', message.slice(0, 2000), job.attempts],
  );
}

let running = false;
let stopping = false;

export async function runWorker(log: (message: string, meta?: unknown) => void = console.log): Promise<void> {
  running = true;
  log(`[worker] ${workerId} started; handlers: ${[...handlers.keys()].join(', ') || 'none'}`);

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
