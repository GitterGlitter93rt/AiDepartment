import { query } from '../db/pool.js';

/**
 * Asynchronous provider work that outlives the job that started it.
 *
 * A Standard-mode search is submitted, charged for, and answered minutes later. The
 * task id used to live in a local variable inside one job: a worker that died -- or
 * simply a task slower than the bounded poll -- lost the search, and the next run
 * submitted another one and paid for the same market twice.
 *
 * These rows are the memory that stops that. A run looks for an outstanding task for
 * the same request before it submits a new one.
 */

export type ProviderTaskStatus = 'PENDING' | 'COLLECTED' | 'FAILED' | 'ABANDONED';

export interface ProviderTaskRow {
  provider_task_id: string;
  provider: string;
  provider_native_id: string;
  fingerprint: string;
  status: ProviderTaskStatus;
  poll_attempts: number;
  submitted_at: Date;
  request: Record<string, unknown>;
}

/**
 * How many times a task is asked for before we stop asking.
 *
 * Bounded on purpose: a task the provider will never finish must not become a job
 * that polls for ever. It is abandoned with a reason, and the operator can see that
 * a search was paid for and never delivered.
 */
export const MAX_TASK_COLLECTIONS = Number(process.env['PROVIDER_TASK_MAX_POLLS'] ?? '20');

/** Records a task the provider accepted, so a later run can collect it. */
export async function recordProviderTask(input: {
  provider: string;
  providerNativeId: string;
  fingerprint: string;
  jobId?: string | null;
  operation?: string;
  request?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `insert into provider_tasks
       (provider, provider_native_id, job_id, fingerprint, operation, request)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (provider, provider_native_id) do update
        set fingerprint = excluded.fingerprint,
            job_id = coalesce(provider_tasks.job_id, excluded.job_id)`,
    [
      input.provider, input.providerNativeId, input.jobId ?? null, input.fingerprint,
      input.operation ?? 'serp.discover', JSON.stringify(input.request ?? {}),
    ],
  );
}

/**
 * The outstanding task for this request, if one exists.
 *
 * Matched on the normalized request fingerprint, so a second click on the same
 * market finds the first click's task instead of buying another.
 */
export async function openProviderTask(
  provider: string, fingerprint: string,
): Promise<ProviderTaskRow | null> {
  const { rows } = await query<ProviderTaskRow>(
    `select provider_task_id, provider, provider_native_id, fingerprint, status,
            poll_attempts, submitted_at, request
       from provider_tasks
      where provider = $1 and fingerprint = $2 and status = 'PENDING'
      order by submitted_at asc
      limit 1`,
    [provider, fingerprint],
  );
  return rows[0] ?? null;
}

/** Every task still owed to us, oldest first. Used by operator reporting. */
export async function pendingProviderTasks(provider?: string): Promise<ProviderTaskRow[]> {
  const { rows } = await query<ProviderTaskRow>(
    `select provider_task_id, provider, provider_native_id, fingerprint, status,
            poll_attempts, submitted_at, request
       from provider_tasks
      where status = 'PENDING' and ($1::text is null or provider = $1)
      order by submitted_at asc`,
    [provider ?? null],
  );
  return rows;
}

/** Notes one more attempt at collecting a task that is not ready. */
export async function recordCollectionAttempt(providerTaskId: string): Promise<number> {
  const { rows } = await query<{ poll_attempts: number }>(
    `update provider_tasks
        set poll_attempts = poll_attempts + 1, last_polled_at = now()
      where provider_task_id = $1
      returning poll_attempts`,
    [providerTaskId],
  );
  return rows[0]?.poll_attempts ?? 0;
}

export async function closeProviderTask(input: {
  providerTaskId: string;
  status: Exclude<ProviderTaskStatus, 'PENDING'>;
  costUsd?: number | null;
  errorCode?: string | null;
}): Promise<void> {
  await query(
    `update provider_tasks
        set status = $2, collected_at = now(), cost_usd = coalesce($3, cost_usd),
            error_code = $4, last_polled_at = now()
      where provider_task_id = $1`,
    [input.providerTaskId, input.status, input.costUsd ?? null, input.errorCode ?? null],
  );
}
