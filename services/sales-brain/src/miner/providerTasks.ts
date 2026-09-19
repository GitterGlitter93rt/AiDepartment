import { query } from '../db/pool.js';
import { numeric } from '../config.js';

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
 * @deprecated as a terminal decision-maker. Retained because the release manifest
 * still reports it, but nothing abandons a task on this number any more -- see
 * `isBeyondRetention`. A poll count was the wrong unit: it was tuned against a
 * three-second loop, and re-used unchanged it would abandon a healthy task after an
 * hour of a three-minute sweep. DataForSEO 40602 means "in queue", which is the
 * provider working, not the provider failing, and seven of seven observed production
 * tasks were still 40602 well past twenty attempts. Four of them took ~15 minutes and
 * every one of them completed.
 */
export const MAX_TASK_COLLECTIONS = numeric('PROVIDER_TASK_MAX_POLLS', 20, { min: 1 });

/**
 * How long a submitted task's result stays retrievable by id.
 *
 * DataForSEO documents that the results of a Standard task remain available through
 * `task_get` for 30 days after the task is set, independently of `tasks_ready` (which
 * lists only *uncollected* tasks completed in the last 3 days). Abandonment is keyed
 * to this number and nothing else: while the result is still retrievable, a paid task
 * is recoverable, and giving up on it throws away money we have already spent.
 *
 * Configurable because it is a provider policy we do not control, not a constant of
 * nature. If DataForSEO changes its retention, this changes with it.
 *
 * Source: DataForSEO SERP API — Task GET / Tasks Ready documentation.
 */
export const PROVIDER_TASK_RETENTION_DAYS = numeric('PROVIDER_TASK_RETENTION_DAYS', 30, { min: 1 });

/** True once a task's result can no longer be fetched, so recovery is impossible. */
export function isBeyondRetention(submittedAt: Date, now: Date = new Date()): boolean {
  const ageDays = (now.getTime() - submittedAt.getTime()) / 86_400_000;
  return ageDays > PROVIDER_TASK_RETENTION_DAYS;
}

/**
 * Records a task the provider accepted, so a later run can collect it.
 *
 * Called the moment `task_post` is acknowledged -- before the fast poll, not after it
 * gives up. Two production facts forced that order. A task that completed in 22
 * seconds was collected inside the fast path and therefore never got a row at all, so
 * the paid ledger silently omitted a search we had bought; and every row that did
 * exist carried a `submitted_at` ~30 seconds late, because the row was created when
 * we stopped waiting rather than when the provider accepted the work. A ledger that
 * only remembers the slow purchases is not a ledger.
 *
 * `submittedAt` is therefore passed explicitly by the caller at acceptance time, and
 * the cost is written here because `task_post` is the only moment money changes
 * hands.
 */
export async function recordProviderTask(input: {
  provider: string;
  providerNativeId: string;
  fingerprint: string;
  jobId?: string | null;
  operation?: string;
  request?: Record<string, unknown>;
  costUsd?: number | null;
  submittedAt?: Date | null;
}): Promise<string> {
  // `do update` rather than `do nothing`: re-recording the same accepted task must be
  // harmless, because the sweeper, a retry and a restart can all arrive here for one
  // task. The conflict target is the provider's own id, so a duplicate is the same
  // purchase and never a second one. Cost is written once and never overwritten with
  // null -- a later caller that does not know the price must not erase it.
  const { rows } = await query<{ provider_task_id: string }>(
    `insert into provider_tasks
       (provider, provider_native_id, job_id, fingerprint, operation, request,
        cost_usd, submitted_at)
     values ($1,$2,$3,$4,$5,$6,$7, coalesce($8::timestamptz, now()))
     on conflict (provider, provider_native_id) do update
        set fingerprint = excluded.fingerprint,
            job_id = coalesce(provider_tasks.job_id, excluded.job_id),
            cost_usd = coalesce(provider_tasks.cost_usd, excluded.cost_usd)
     returning provider_task_id`,
    [
      input.provider, input.providerNativeId, input.jobId ?? null, input.fingerprint,
      input.operation ?? 'serp.discover', JSON.stringify(input.request ?? {}),
      input.costUsd ?? null, input.submittedAt ?? null,
    ],
  );
  return rows[0]!.provider_task_id;
}

/** The ledger row for a provider's own task id, whatever state it is in. */
export async function providerTaskByNativeId(
  provider: string, providerNativeId: string,
): Promise<ProviderTaskRow | null> {
  const { rows } = await query<ProviderTaskRow>(
    `select provider_task_id, provider, provider_native_id, fingerprint, status,
            poll_attempts, submitted_at, request
       from provider_tasks
      where provider = $1 and provider_native_id = $2`,
    [provider, providerNativeId]);
  return rows[0] ?? null;
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

/**
 * Old pending tasks worth asking about directly, oldest first.
 *
 * The `tasks_ready` list is the cheap path, but it is not sufficient on its own: it
 * holds only tasks completed in the last three days, and a task drops off it as soon
 * as anybody retrieves the result -- including an operator investigating by hand.
 * Production already contains exactly that case. So a task that is old enough to have
 * plausibly finished, and has not been asked about recently, gets one direct
 * `task_get` by its known id. That call is free, and the id is one we already own.
 *
 * Bounded by `limit` so a backlog cannot turn one sweep into hundreds of requests.
 */
export async function tasksNeedingDirectCheck(input: {
  provider: string;
  minAgeMs: number;
  recheckAfterMs: number;
  limit: number;
  now?: Date;
}): Promise<ProviderTaskRow[]> {
  const now = input.now ?? new Date();
  const { rows } = await query<ProviderTaskRow>(
    `select provider_task_id, provider, provider_native_id, fingerprint, status,
            poll_attempts, submitted_at, request
       from provider_tasks
      where provider = $1
        and status = 'PENDING'
        and submitted_at <= $2::timestamptz
        and (last_polled_at is null or last_polled_at <= $3::timestamptz)
      order by submitted_at asc
      limit $4`,
    [input.provider,
     new Date(now.getTime() - input.minAgeMs).toISOString(),
     new Date(now.getTime() - input.recheckAfterMs).toISOString(),
     input.limit]);
  return rows;
}

/** Notes one more attempt at collecting a task that is not ready. */
/**
 * Whether any search of this market is still owed by the provider.
 *
 * A run buys N independent searches and each has its own task, so "is this market
 * waiting on the provider" is a question about a family of fingerprints rather than
 * one. Matched on the prefix the family shares.
 */
export async function hasOpenProviderTaskForMarket(
  provider: string, fingerprintPrefix: string,
): Promise<boolean> {
  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from provider_tasks
      where provider = $1 and status = 'PENDING' and fingerprint like $2 || '%'`,
    [provider, fingerprintPrefix]);
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * What the provider actually did with one discovery run's searches.
 *
 * `jobs.outcome = 'PROVIDER_PENDING'` is a record of how a run *ended*, not a
 * statement about now. It is written once, when the bounded poll gives up, and
 * nothing ever rewrites it -- so a job that ended pending in June still says
 * PROVIDER_PENDING after its tasks have been collected, have failed, or were
 * abandoned. The read model treated that historical sentence as a live one and told
 * a rep "the provider has accepted a search and it will be collected rather than run
 * again" about a task nobody was waiting for.
 *
 * Counted rather than answered yes/no, because the four outcomes are four different
 * things to tell an operator and one of them costs money to get wrong. COLLECTED in
 * particular is not a failure: `closeProviderTask` is called with it only after the
 * results are in inventory (marketMiner "the task is only finished with once its
 * results are in inventory"), so a collected task means the search completed, was
 * paid for, and its businesses are already here. Reporting that as "no provider
 * answered" would invite buying the same market a second time to learn what we
 * already know.
 *
 * Bound two ways because either alone has a hole: `job_id` is the exact link but is
 * nullable (`on delete set null`, and a task may be recorded without one), and the
 * fingerprint prefix catches the whole family of searches a run bought -- but it
 * also matches a *different* run of the same market, which is why the two questions
 * are scoped differently below.
 *
 * "Is anything still owed" reads the whole family, because an outstanding task is a
 * spend risk whoever bought it, and proving it matters more than attributing it:
 * reporting "nothing is owed" while a paid task is open is what invites buying the
 * same market twice. "What happened to this run" reads only this run's own tasks and
 * orphaned ones, because a previous run's COLLECTED or ABANDONED is somebody else's
 * finished history -- letting it in would make a failed run look fulfilled, a clean
 * run look partial, and would date this market from a search this run never bought.
 *
 * The prefix is escaped: a geography carrying `%` or `_` would otherwise widen the
 * match into other markets and resurrect the false-pending bug from the other side.
 */
export interface DiscoveryTaskSummary {
  /**
   * Searches the provider still owes us, anywhere in this market's fingerprint
   * family -- including tasks explicitly attached to a *different* run.
   *
   * Deliberately the broad question. An outstanding task means money is already
   * committed to these words, whoever bought it, so buying again risks paying twice
   * for one answer. Over-reporting PENDING costs a delayed refresh; under-reporting
   * it costs a duplicate purchase.
   */
  pending: number;
  /** Searches of THIS run that completed and whose results reached inventory. */
  collected: number;
  /** Searches of THIS run given up on -- FAILED or ABANDONED. */
  unfulfilled: number;
  /**
   * When THIS run's newest collected search landed.
   *
   * Read only from COLLECTED rows: `closeProviderTask` stamps `collected_at` on
   * every close, so on a FAILED or ABANDONED row it is the moment we gave up, not
   * the moment anything arrived. Used as the market's discovery freshness, because
   * a search delivered after its job ended is news as of its collection.
   */
  latestCollectedAt: Date | null;
}

export async function discoveryTaskSummary(input: {
  jobId: string | null;
  fingerprintPrefix: string | null;
}): Promise<DiscoveryTaskSummary> {
  const empty: DiscoveryTaskSummary = {
    pending: 0, collected: 0, unfulfilled: 0, latestCollectedAt: null };
  if (!input.jobId && !input.fingerprintPrefix) return empty;
  const prefix = input.fingerprintPrefix === null ? null
    : input.fingerprintPrefix.replace(/([\\%_])/g, '\\$1');

  // Two scopes, because the two questions are not the same question.
  //
  // `family` is every task for this market's words, whoever bought them. `mine` is
  // this run's own work: its tasks, plus orphans -- rows whose `job_id` is null
  // because it was never recorded or was cleared by `on delete set null`, which
  // cannot be attributed to any other run and would otherwise be lost.
  //
  // A task explicitly linked to a *different* job is somebody else's finished
  // history. Counting it here would let a previous run's COLLECTED make this run
  // look fulfilled, or its ABANDONED make a cleanly delivered run look PARTIAL, and
  // would date this market's freshness from a search this run never bought. Only
  // PENDING reads the wide scope, and only because an outstanding task is a spend
  // risk rather than a historical fact.
  const { rows } = await query<{
    pending: number; collected: number; unfulfilled: number;
    latest_collected_at: Date | null;
  }>(
    `with matched as (
       select status, collected_at,
              ($1::uuid is not null and job_id = $1::uuid) as mine_exact,
              (job_id is null) as orphan
         from provider_tasks
        where ($1::uuid is not null and job_id = $1::uuid)
           or ($2::text is not null and fingerprint like ($2 || '%') escape '\\')
     )
     select count(*) filter (where status = 'PENDING')::int as pending,
            count(*) filter (where status = 'COLLECTED'
                               and (mine_exact or orphan))::int as collected,
            count(*) filter (where status in ('FAILED','ABANDONED')
                               and (mine_exact or orphan))::int as unfulfilled,
            max(collected_at) filter (where status = 'COLLECTED'
                               and (mine_exact or orphan)) as latest_collected_at
       from matched`,
    [input.jobId, prefix]);
  const row = rows[0];
  if (!row) return empty;
  return {
    pending: row.pending, collected: row.collected, unfulfilled: row.unfulfilled,
    latestCollectedAt: row.latest_collected_at,
  };
}

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
