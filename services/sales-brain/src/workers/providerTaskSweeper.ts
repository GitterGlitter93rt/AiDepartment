import { numeric } from '../config.js';
import { query } from '../db/pool.js';
import { availableDiscoveryAdapters } from './marketMiner.js';
import {
  closeProviderTask, isBeyondRetention, pendingProviderTasks, tasksNeedingDirectCheck,
  PROVIDER_TASK_RETENTION_DAYS, type ProviderTaskRow,
} from '../miner/providerTasks.js';
import { persistPaidPlan, planHash, type PaidPlan } from '../miner/planPreview.js';
import { enqueueConfirmedMarketResearch } from './enqueue.js';

/**
 * Collects paid provider work that outlived the run which bought it.
 *
 * DataForSEO Standard is asynchronous: `task_post` is charged immediately and the
 * answer arrives minutes later. The miner polls for about 27 seconds and then, quite
 * correctly, gives up and records the task as outstanding. Nothing ever went back for
 * it. Collection lived inside a future `market_mine` job, those were queued only by
 * the saved-market scheduler, and that scheduler reads `saved_markets where enabled`
 * -- so an ad-hoc "Research this market" search, which creates no saved market, could
 * be paid for, completed by the provider, and stay PENDING in this system for ever.
 *
 * Production proved it rather than suggested it: seven paid tasks, all seven completed
 * at DataForSEO, and `poll_attempts = 0, last_polled_at = null` on every ledger row --
 * not one collection attempt had ever been made in the system's history. One task
 * finished in 22 seconds and was collected inside the fast path; the other six did not,
 * and their results were simply never fetched. Four of them took about fifteen minutes.
 *
 * This sweeper is the missing half. It depends on nothing but the ledger:
 *
 *   - no saved market is required, because the money was spent regardless of whether
 *     anybody saved the market afterwards;
 *   - it makes at most one provider call per pass, and none at all when nothing is
 *     outstanding;
 *   - it cannot buy anything. It only ever queues collect-only work, and the one path
 *     it queues is structurally unable to reach `task_post` -- see `collectionPlanFor`.
 */

/**
 * How often to look.
 *
 * Three minutes against observed turnarounds of 22 seconds to 16 minutes: fast enough
 * that a result is rarely more than a few minutes stale, slow enough that a day of an
 * empty queue costs 480 cheap list calls rather than 28,800 of them. The old
 * three-second cadence was a fast path inside one job, never a background rate.
 */
export const SWEEP_INTERVAL_MS = numeric('PROVIDER_TASK_SWEEP_INTERVAL_MS', 3 * 60_000,
  { min: 30_000 });

/**
 * How old a pending task must be before it is worth asking about directly.
 *
 * Longer than the fast path, which has already asked. Ten minutes sits inside the
 * observed 14-16 minute band, so a slow task gets a direct question at roughly the
 * point it is likely to be finishing.
 */
export const DIRECT_CHECK_MIN_AGE_MS = numeric('PROVIDER_TASK_DIRECT_MIN_AGE_MS', 10 * 60_000,
  { min: 60_000 });

/** How long to wait before asking about the same task again. Backoff, not polling. */
export const DIRECT_RECHECK_AFTER_MS = numeric('PROVIDER_TASK_DIRECT_RECHECK_MS', 30 * 60_000,
  { min: 60_000 });

/** How many direct checks one pass may queue, so a backlog cannot become a stampede. */
export const DIRECT_CHECK_BATCH = numeric('PROVIDER_TASK_DIRECT_BATCH', 5, { min: 1 });

export interface SweepResult {
  /** Local tasks still owed to us at the start of the pass. */
  pending: number;
  /** True when the provider's ready list could not be read; direct checks still run. */
  readyUnavailable: boolean;
  /** Ready ids the provider listed that we have no ledger row for. Ignored. */
  readyNotOurs: number;
  /** Collect-only runs queued because the provider says the result is ready. */
  queuedFromReady: number;
  /** Collect-only runs queued because the task is old and unchecked. */
  queuedFromFallback: number;
  /** Tasks whose collection was already waiting to run, so nothing was queued again. */
  alreadyQueued: number;
  /** Tasks closed because their results are no longer retrievable. */
  abandoned: number;
  /** Tasks whose stored request cannot rebuild a collection plan. */
  unreconstructable: number;
}

const EMPTY: SweepResult = {
  pending: 0, readyUnavailable: false, readyNotOurs: 0, queuedFromReady: 0,
  queuedFromFallback: 0, alreadyQueued: 0, abandoned: 0, unreconstructable: 0,
};

/**
 * A one-search plan that authorises collecting exactly this task and nothing else.
 *
 * Deliberately expressed as a confirmed plan rather than as a new job type. The
 * `market_mine` handler already knows how to collect an approved task: it checks that
 * the task belongs to this provider and this fingerprint, refuses if it has already
 * been collected, ingests through the current entity resolution, and closes the ledger
 * row only once the businesses are in inventory. Re-implementing that would mean a
 * second ingestion path to keep correct.
 *
 * It is also what makes the sweeper structurally incapable of spending. In the handler
 * a purchase can only happen on the branch where no task is outstanding; a plan whose
 * disposition is `COLLECT_EXISTING` can never reach it, and the handler fails closed if
 * the named task is missing, already collected or belongs to a different search. The
 * sweeper does not decide not to buy -- it has no path that buys.
 *
 * `chargeable: false` and a zero estimate are statements of fact, not optimism: the
 * task is paid for, and `task_get` costs nothing.
 */
export function collectionPlanFor(
  task: ProviderTaskRow, providerMode: string,
): PaidPlan | null {
  const request = (task.request ?? {}) as Record<string, unknown>;
  const search = request['search'] as Record<string, unknown> | undefined;
  const keyword = typeof search?.['keyword'] === 'string' ? search['keyword'] : null;
  const fingerprint = typeof search?.['fingerprint'] === 'string' ? search['fingerprint'] : null;

  // Rebuilt from what was stored, never re-planned. A plan recomputed from today's
  // taxonomy could name different words than the ones this task was bought for, and
  // the handler would then refuse it as a fingerprint mismatch -- or worse, not.
  if (!keyword || !fingerprint || fingerprint !== task.fingerprint) return null;

  const str = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.length > 0 ? value : fallback;

  return {
    verticalProfileId: (request['verticalProfileId'] as string | null) ?? null,
    geographyType: (request['geographyType'] as string | null) ?? null,
    geographyValue: (request['geographyValue'] as string | null) ?? null,
    geographyNormalized: (request['geographyValue'] as string | null) ?? null,
    marketId: null,
    miningMode: str(request['miningMode'], 'balanced'),
    causes: [],
    provider: task.provider,
    providerMode,
    searches: [{
      index: typeof search?.['index'] === 'number' ? search['index'] as number : 0,
      term: str(search?.['term'], keyword),
      keyword,
      locationName: str(search?.['locationName'], ''),
      purpose: str(search?.['purpose'], 'ENTITY_DISCOVERY'),
      coverageRole: str(search?.['coverageRole'], 'PRIMARY'),
      fingerprint,
      chargeable: false,
      executionDisposition: 'COLLECT_EXISTING',
      approvedProviderTaskId: task.provider_task_id,
    }],
    chargeableTaskCount: 0,
    assumedCostPerTaskUsd: 0,
    estimatedCostUsd: 0,
    refusal: null,
    refusalCode: null,
    remainingBudgetUsd: 0,
    partialDiscoveryCoverage: false,
    spentTodayUsd: 0,
    dailyBudgetUsd: 0,
  };
}

type QueueOutcome = 'QUEUED' | 'ALREADY_QUEUED' | 'UNRECONSTRUCTABLE';

/** Queues one collect-only run for a task. Idempotent: same plan, same job. */
async function queueCollection(
  task: ProviderTaskRow, providerMode: string,
): Promise<QueueOutcome> {
  const plan = collectionPlanFor(task, providerMode);
  if (!plan) return 'UNRECONSTRUCTABLE';

  /**
   * Asked and answered: a collection for this task is already waiting to run.
   *
   * Job creation is idempotent on the plan hash, so without this nothing would break
   * -- but a preview row would still be written on every pass, and a task the ready
   * list keeps offering while its collection cannot complete would add one every
   * sweep interval for as long as it stayed pending. Checking the key the job would
   * have had costs one indexed read and keeps the table proportional to the work.
   */
  const key = `market_mine:plan:${planHash(plan)}`;
  const { rows: active } = await query<{ job_id: string }>(
    `select job_id from jobs
      where idempotency_key = $1 and status in ('QUEUED','RUNNING') limit 1`, [key]);
  if (active.length > 0) return 'ALREADY_QUEUED';

  // The plan is persisted and immediately confirmed. Two passes over the same task
  // build a byte-identical plan, so they hash identically, so the second joins the
  // first one's job instead of creating a duplicate -- the same dedupe a double-click
  // on the Research button gets, for the same reason.
  const stored = await persistPaidPlan(plan, null as unknown as string, {
    verticalProfileId: plan.verticalProfileId,
    geographyType: plan.geographyType,
    geographyValue: plan.geographyValue,
    marketId: null,
    miningMode: plan.miningMode,
    queryBudget: 1,
    causes: null,
  });

  const result = await enqueueConfirmedMarketResearch({
    verticalProfileId: plan.verticalProfileId,
    geographyType: plan.geographyType,
    geographyValue: plan.geographyValue,
    marketId: null,
    requestedBy: null as unknown as string,
    miningMode: plan.miningMode,
    queryBudget: 1,
    causes: null,
    confirmedPlan: { planId: stored.planId, planHash: stored.planHash },
  });
  // `created: false` means this plan hashed to a run already in flight and joined it,
  // which is a successful outcome and not a second collection.
  if (!result.ok) return 'UNRECONSTRUCTABLE';
  return result.created ? 'QUEUED' : 'ALREADY_QUEUED';
}

/**
 * One pass. Safe to call at any interval and safe to call twice.
 *
 * Reads the ledger first and returns without touching the network when nothing is
 * outstanding, because the common steady state is an empty queue and a provider should
 * not be asked a question nobody is waiting on the answer to.
 */
export async function sweepProviderTasks(options: { now?: Date } = {}): Promise<SweepResult> {
  const now = options.now ?? new Date();
  const result: SweepResult = { ...EMPTY };
  // Every provider that can be asked for work it already accepted, not DataForSEO by
  // name. The defect is a property of asynchronous providers in general, and naming one
  // here would mean the next queueing adapter silently inherits the original bug.
  for (const adapter of availableDiscoveryAdapters()) {
    if (!adapter.collect) continue;
    const swept = await sweepAdapter(adapter, now);
    result.pending += swept.pending;
    result.readyUnavailable = result.readyUnavailable || swept.readyUnavailable;
    result.readyNotOurs += swept.readyNotOurs;
    result.queuedFromReady += swept.queuedFromReady;
    result.queuedFromFallback += swept.queuedFromFallback;
    result.alreadyQueued += swept.alreadyQueued;
    result.abandoned += swept.abandoned;
    result.unreconstructable += swept.unreconstructable;
  }
  return result;
}

async function sweepAdapter(
  adapter: { name: string; mode?: string; tasksReady?(): Promise<string[] | null> },
  now: Date,
): Promise<SweepResult> {
  const pending = await pendingProviderTasks(adapter.name);
  if (pending.length === 0) return { ...EMPTY };

  const result: SweepResult = { ...EMPTY, pending: pending.length };
  const providerMode = adapter.mode ?? 'standard';

  // Anything past retention can no longer be recovered by anyone, so it stops being
  // outstanding. This is the only condition that abandons a paid task: not a poll
  // count, and never because the provider said 40602.
  const live: ProviderTaskRow[] = [];
  for (const task of pending) {
    if (isBeyondRetention(task.submitted_at, now)) {
      await closeProviderTask({
        providerTaskId: task.provider_task_id, status: 'ABANDONED',
        errorCode: 'RESULT_RETENTION_EXPIRED' });
      result.abandoned += 1;
    } else live.push(task);
  }
  if (live.length === 0) return result;

  const byNativeId = new Map(live.map((task) => [task.provider_native_id, task]));
  const queued = new Set<string>();

  // One call, for every outstanding task at once.
  const ready = adapter.tasksReady ? await adapter.tasksReady() : null;
  if (ready === null) result.readyUnavailable = true;

  for (const id of ready ?? []) {
    const task = byNativeId.get(id);
    // An id we have no row for is not ours to collect. It belongs to another
    // integration or predates this ledger, and acting on it would ingest results for a
    // search nobody here asked for.
    if (!task) { result.readyNotOurs += 1; continue; }
    if (queued.has(task.provider_task_id)) continue;
    const outcome = await queueCollection(task, providerMode);
    if (outcome !== 'UNRECONSTRUCTABLE') queued.add(task.provider_task_id);
    if (outcome === 'QUEUED') result.queuedFromReady += 1;
    else if (outcome === 'ALREADY_QUEUED') result.alreadyQueued += 1;
    else result.unreconstructable += 1;
  }

  /**
   * The ready list is necessary but not sufficient.
   *
   * It holds only tasks completed in the last three days, and a task drops off it the
   * moment anyone retrieves the result -- including an operator investigating by hand,
   * which has already happened to a task still pending in production. Without this
   * fallback that search would be unrecoverable despite being paid for, complete, and
   * retrievable by id for thirty days.
   *
   * So an old, unchecked, still-pending task gets one direct question on its own
   * schedule. If it is genuinely still queued the collection leaves it PENDING and
   * stamps `last_polled_at`, which is what spaces the next one out.
   */
  const stale = await tasksNeedingDirectCheck({
    provider: adapter.name,
    minAgeMs: DIRECT_CHECK_MIN_AGE_MS,
    recheckAfterMs: DIRECT_RECHECK_AFTER_MS,
    limit: DIRECT_CHECK_BATCH,
    now,
  });
  for (const task of stale) {
    if (queued.has(task.provider_task_id)) continue;
    if (isBeyondRetention(task.submitted_at, now)) continue;
    const outcome = await queueCollection(task, providerMode);
    if (outcome !== 'UNRECONSTRUCTABLE') queued.add(task.provider_task_id);
    if (outcome === 'QUEUED') result.queuedFromFallback += 1;
    else if (outcome === 'ALREADY_QUEUED') result.alreadyQueued += 1;
    else result.unreconstructable += 1;
  }

  void PROVIDER_TASK_RETENTION_DAYS;
  return result;
}
