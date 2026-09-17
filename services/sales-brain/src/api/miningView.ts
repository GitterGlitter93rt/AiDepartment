import { query } from '../db/pool.js';
import { providerAnswered, type DiscoveryStatus } from '../miner/discoveryStatus.js';

/**
 * What the Mining page reads. Two truths, kept apart.
 *
 * The page used to be a list of `jobs` rows, and a job row is a snapshot of what one
 * worker believed when it finished. A market search is bought from an asynchronous
 * provider: the run that buys it ends minutes before the answer exists, records
 * `PROVIDER_PENDING`, and never speaks again. A second run collects the result and
 * writes its own row. Production holds 92 such rows for 49 paid searches, and 40 of
 * them still say "Provider still working" about searches the provider finished days
 * ago and that are already in inventory.
 *
 * So nothing here derives a provider's state from a job. `provider_tasks` is the
 * durable ledger of what was bought and what came back, and it is the only thing
 * asked what the provider is doing. What *we* then did with the answer is a separate
 * question with a separate column, because "the provider has not answered" and "we
 * have not collected the answer" are different problems with different owners.
 *
 * The unit of the Market Discovery table is therefore one paid search, not one job.
 * Several job rows about the same search collapse into the row that describes it.
 */

// --------------------------------------------------------------- provider truth

/** Straight from the ledger. Never inferred from a job. */
export type ProviderState = 'PENDING' | 'COLLECTED' | 'FAILED' | 'ABANDONED' | 'NONE';

/**
 * What Sales Brain has done with the search, which is not what the provider did.
 *
 * `AWAITING_PROVIDER` and `COLLECTED_NOT_INGESTED` are the two that used to be one
 * sentence. The first is the provider's turn; the second is ours, and it means a
 * search we have already paid for is sitting uncollected.
 */
export type SalesBrainState =
  | 'AWAITING_PROVIDER'
  | 'COLLECTING'
  | 'COLLECTED_NOT_INGESTED'
  | 'INGESTED'
  | 'ABANDONED'
  | 'PROVIDER_FAILED'
  | 'NOT_SEARCHED';

export const SALES_BRAIN_STATE_LABEL: Record<SalesBrainState, string> = {
  AWAITING_PROVIDER: 'Waiting for the provider',
  COLLECTING: 'Collecting results',
  COLLECTED_NOT_INGESTED: 'Results not collected yet',
  INGESTED: 'Results ingested',
  ABANDONED: 'Given up — results no longer retrievable',
  PROVIDER_FAILED: 'Provider failed',
  NOT_SEARCHED: 'Not searched — nothing was bought',
};

export const PROVIDER_STATE_LABEL: Record<ProviderState, string> = {
  PENDING: 'Processing',
  COLLECTED: 'Answered',
  FAILED: 'Failed',
  ABANDONED: 'Answer expired',
  NONE: 'Not submitted',
};

export interface MarketDiscoveryRow {
  /** The paid search. A provider's own task id where one exists, else job + index. */
  key: string;
  verticalProfileId: string | null;
  geographyType: string | null;
  geography: string | null;
  /** The words actually bought, not the market's name. */
  keyword: string | null;
  term: string | null;
  miningMode: string | null;
  requestedBy: string | null;
  marketName: string | null;
  provider: string | null;
  /** The provider's own identifier, so a support question can be asked about it. */
  providerTaskId: string | null;
  providerState: ProviderState;
  salesBrainState: SalesBrainState;
  submittedAt: Date | null;
  providerCollectedAt: Date | null;
  ingestedAt: Date | null;
  /** Provider rows → resolved businesses → new / matched. Null when never searched. */
  rowsReturned: number | null;
  resolvedBusinesses: number | null;
  newBusinesses: number | null;
  matchedExisting: number | null;
  rejectedEntities: number | null;
  duplicateRows: number | null;
  needsReview: number | null;
  /**
   * True when the review count belongs to a run that ingested several searches, so it
   * cannot honestly be attributed to this one alone.
   */
  needsReviewIsRunWide: boolean;
  existingRefreshed: number | null;
  spendUsd: number | null;
  /** The provider's status for this search: OK, ZERO_RESULTS, MALFORMED, PENDING… */
  searchStatus: string | null;
  /** Why nothing was bought or nothing came back, in the run's own words. */
  reason: string | null;
  submittedByJobId: string | null;
  ingestJobId: string | null;
  /** The submitting run's own outcome, which is how a refusal explains itself. */
  jobOutcome: string | null;
  needsAttention: boolean;
}

export interface MiningSummary {
  /** Paid searches the provider has not answered. */
  providerProcessing: number;
  /** Provider answered; the results are not in inventory yet. Our turn. */
  waitingOnSalesBrain: number;
  /** A collect-only run is queued or running for this search right now. */
  collecting: number;
  /** Paid searches whose results reached inventory. */
  resultsIngested: number;
  /** How many searches the counts above were taken over. A rate needs its population. */
  searchesCounted: number;
  websiteResearchQueued: number;
  websiteResearchRunning: number;
  /** Everything above that someone has to look at, counted once. */
  needsAttention: number;
}

// ------------------------------------------------------------ raw row shapes

interface PerSearchRow {
  job_id: string;
  job_status: string;
  job_outcome: string | null;
  job_outcome_reason: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  requested_by_name: string | null;
  market_name: string | null;
  vertical_profile_id: string | null;
  geography_type: string | null;
  geography_value: string | null;
  mining_mode: string | null;
  refresh_queued: number | null;
  searches_in_run: number;
  search_index: number | null;
  provider_native_id: string | null;
  search_status: string | null;
  keyword: string | null;
  term: string | null;
  provider_rows: number | null;
  usable_rows: number | null;
  created_count: number | null;
  matched_existing: number | null;
  rejected_rows: number | null;
  duplicate_rows: number | null;
  cost_usd: string | number | null;
  reason: string | null;
}

interface TaskRow {
  provider_task_id: string;
  provider: string;
  provider_native_id: string;
  status: ProviderState;
  submitted_at: Date;
  collected_at: Date | null;
  cost_usd: string | number | null;
  job_id: string | null;
  vertical_profile_id: string | null;
  geography_type: string | null;
  geography_value: string | null;
  keyword: string | null;
  term: string | null;
  mining_mode: string | null;
}

interface CandidateRow { job_id: string; needs_review: number }
interface InFlightRow { provider_task_id: string; job_status: string }

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/**
 * The entry that carries the outcome of a search, rather than the one that gave up.
 *
 * Wider than `providerAnswered` on purpose, and the two are not interchangeable.
 * This decides which job row to read the numbers from: PENDING is the miner saying
 * "I stopped waiting", and every other status means that run heard something --
 * including MALFORMED, an answer we could not read, and BUDGET_EXHAUSTED, our own
 * refusal to buy. Whether what it heard reached inventory is `providerAnswered`'s
 * question, asked separately below.
 */
function searchWasResolved(status: string | null): boolean {
  return status != null && status !== 'PENDING';
}

// ------------------------------------------------------------------- assembly

/**
 * Collapses job rows into paid searches.
 *
 * Exported for tests: the collapse is where the old page went wrong, and it is worth
 * asserting against fixtures rather than only against a live database.
 */
export function assembleDiscoveryRows(input: {
  searches: PerSearchRow[];
  tasks: TaskRow[];
  needsReviewByJob: Map<string, number>;
  inFlightTaskIds: Set<string>;
}): MarketDiscoveryRow[] {
  const { searches, tasks, needsReviewByJob, inFlightTaskIds } = input;
  const taskByNativeId = new Map(tasks.map((task) => [task.provider_native_id, task]));

  /** Every job row that speaks about one search, oldest first. */
  const grouped = new Map<string, PerSearchRow[]>();
  for (const row of searches) {
    const key = row.provider_native_id ?? `${row.job_id}#${row.search_index ?? 0}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row); else grouped.set(key, [row]);
  }

  const rows: MarketDiscoveryRow[] = [];

  for (const [key, entries] of grouped) {
    entries.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    const first = entries[0]!;
    const task = first.provider_native_id ? taskByNativeId.get(first.provider_native_id) ?? null : null;

    // The entry that carries the answer. The run that bought the search recorded
    // zeroes and gave up; the run that collected it recorded what came back.
    const answered = [...entries].reverse().find((e) => searchWasResolved(e.search_status)) ?? null;
    const providerState: ProviderState = task ? task.status : 'NONE';

    const salesBrainState = deriveSalesBrainState({
      providerState,
      collecting: task ? inFlightTaskIds.has(task.provider_task_id) : false,
      searchStatus: (answered ?? entries[entries.length - 1]!).search_status,
    });

    const source = answered ?? first;
    const reviewJobId = answered?.job_id ?? null;
    /**
     * Counted only where a search was actually made.
     *
     * A run refused by our own ceiling records a perSearch entry of zeroes, and
     * rendering those as zeroes says the provider returned nothing. Nobody asked it.
     */
    const measured = salesBrainState !== 'NOT_SEARCHED' && answered != null;
    const needsReview = measured && reviewJobId
      ? needsReviewByJob.get(reviewJobId) ?? 0 : null;
    /**
     * The explanation that belongs to the last thing that happened.
     *
     * Taken from the run that answered when one did. Falling back to the submitting
     * run's words put "the provider accepted the search and its results are not ready
     * yet" underneath a row whose results were ingested an hour later -- the same
     * stale sentence this page exists to remove, in smaller type.
     */
    const reason = answered
      ? answered.reason ?? answered.job_outcome_reason
      : first.reason ?? first.job_outcome_reason;

    rows.push({
      key,
      verticalProfileId: task?.vertical_profile_id ?? first.vertical_profile_id,
      geographyType: task?.geography_type ?? first.geography_type,
      geography: task?.geography_value ?? first.geography_value,
      keyword: task?.keyword ?? source.keyword,
      term: task?.term ?? source.term,
      miningMode: task?.mining_mode ?? first.mining_mode,
      // The person who asked for the market, not whoever's run collected it: a
      // sweeper-queued collection has no requester and is not anonymous work.
      requestedBy: first.requested_by_name,
      marketName: first.market_name,
      provider: task?.provider ?? null,
      providerTaskId: task?.provider_native_id ?? null,
      providerState,
      salesBrainState,
      submittedAt: task?.submitted_at ?? first.started_at ?? first.created_at,
      providerCollectedAt: task?.collected_at ?? null,
      ingestedAt: measured ? answered!.completed_at : null,
      rowsReturned: measured ? num(answered!.provider_rows) : null,
      resolvedBusinesses: measured ? num(answered!.usable_rows) : null,
      newBusinesses: measured ? num(answered!.created_count) : null,
      matchedExisting: measured ? num(answered!.matched_existing) : null,
      rejectedEntities: measured ? num(answered!.rejected_rows) : null,
      duplicateRows: measured ? num(answered!.duplicate_rows) : null,
      needsReview,
      needsReviewIsRunWide: (answered?.searches_in_run ?? 1) > 1,
      existingRefreshed: measured ? num(answered!.refresh_queued) : null,
      // The ledger holds what was charged; a run only knows what it was told.
      spendUsd: num(task?.cost_usd ?? source.cost_usd),
      searchStatus: source.search_status,
      reason,
      submittedByJobId: first.job_id,
      ingestJobId: answered?.job_id ?? null,
      jobOutcome: (answered ?? first).job_outcome,
      // A market nobody could search is a fault to look at; our own ceiling refusing
      // to buy one is the ceiling working, and putting both under the same heading
      // would teach an operator to ignore the heading.
      needsAttention: needsAttentionState(salesBrainState)
        || (answered ?? first).job_outcome === 'PROVIDER_UNAVAILABLE',
    });
  }

  // A paid task no job row mentions still has to appear: it is money spent, and the
  // reason it is invisible is exactly the reason it needs looking at.
  for (const task of tasks) {
    if (grouped.has(task.provider_native_id)) continue;
    const salesBrainState = deriveSalesBrainState({
      providerState: task.status,
      collecting: inFlightTaskIds.has(task.provider_task_id),
      searchStatus: null,
    });
    rows.push({
      key: task.provider_native_id,
      verticalProfileId: task.vertical_profile_id,
      geographyType: task.geography_type,
      geography: task.geography_value,
      keyword: task.keyword,
      term: task.term,
      miningMode: task.mining_mode,
      requestedBy: null,
      marketName: null,
      provider: task.provider,
      providerTaskId: task.provider_native_id,
      providerState: task.status,
      salesBrainState,
      submittedAt: task.submitted_at,
      providerCollectedAt: task.collected_at,
      ingestedAt: null,
      rowsReturned: null, resolvedBusinesses: null, newBusinesses: null,
      matchedExisting: null, rejectedEntities: null, duplicateRows: null,
      needsReview: null, needsReviewIsRunWide: false, existingRefreshed: null,
      spendUsd: num(task.cost_usd),
      searchStatus: null,
      reason: 'This paid search is on the provider ledger and no run has reported on it.',
      submittedByJobId: task.job_id,
      ingestJobId: null,
      jobOutcome: null,
      needsAttention: true,
    });
  }

  rows.sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0));
  return rows;
}

/**
 * The one derivation the page depends on.
 *
 * Reads the ledger first and the job second, in that order, because the whole defect
 * was a page that read them the other way round.
 */
export function deriveSalesBrainState(input: {
  providerState: ProviderState;
  collecting: boolean;
  /** The status a run recorded for this search, or null if none ever did. */
  searchStatus: string | null;
}): SalesBrainState {
  const { providerState, collecting, searchStatus } = input;

  // A run that heard an answer the miner counts as an answer is the only thing that
  // puts businesses into inventory. `providerAnswered` is the miner's own rule, read
  // rather than restated: reading "anything but PENDING" as an answer turned our own
  // budget refusing to buy a search into a search whose results had been ingested.
  const resolved = searchStatus != null
    && providerAnswered(searchStatus as DiscoveryStatus);
  if (resolved) return 'INGESTED';

  if (providerState === 'ABANDONED') return 'ABANDONED';
  if (providerState === 'FAILED') return 'PROVIDER_FAILED';
  if (providerState === 'COLLECTED') {
    // The ledger says the answer is ours and no run has put it into inventory.
    return collecting ? 'COLLECTING' : 'COLLECTED_NOT_INGESTED';
  }
  if (providerState === 'PENDING') return collecting ? 'COLLECTING' : 'AWAITING_PROVIDER';
  // No task exists at all: nothing was bought. A refusal, a blocked provider, a
  // switched-off market -- and an unreadable answer from a provider that never got
  // as far as a ledger row.
  return searchStatus === 'MALFORMED' ? 'PROVIDER_FAILED' : 'NOT_SEARCHED';
}

function needsAttentionState(state: SalesBrainState): boolean {
  return state === 'ABANDONED' || state === 'PROVIDER_FAILED'
    || state === 'COLLECTED_NOT_INGESTED';
}

// --------------------------------------------------------------------- loading

/**
 * How far back the page looks.
 *
 * One number, used by the table and by the counts above it, because a summary
 * computed over a different population from the table it sits on is a summary an
 * operator cannot check. When the inventory outgrows this the answer is a maintained
 * counter, not a second query that classifies searches its own way.
 */
export const DISCOVERY_WINDOW = 2000;

/** Every search in the window, newest first. The table shows a page of these. */
async function assembleWindow(): Promise<MarketDiscoveryRow[]> {
  const jobWindow = DISCOVERY_WINDOW;

  const { rows: searches } = await query<PerSearchRow>(
    `with recent as (
       select j.* from jobs j
        where j.job_type = 'market_mine'
        order by j.created_at desc
        limit $1
     )
     select r.job_id, r.status as job_status, r.outcome as job_outcome,
            r.outcome_reason as job_outcome_reason,
            r.created_at, r.started_at, r.completed_at,
            u.display_name as requested_by_name,
            m.name as market_name,
            r.payload->>'vertical_profile_id' as vertical_profile_id,
            r.payload->>'geography_type' as geography_type,
            r.payload->>'geography_value' as geography_value,
            r.payload->>'mining_mode' as mining_mode,
            coalesce((r.progress->>'refreshQueued')::int, 0) as refresh_queued,
            jsonb_array_length(coalesce(r.progress->'perSearch','[]'::jsonb)) as searches_in_run,
            (s->>'index')::int as search_index,
            s->>'providerTaskId' as provider_native_id,
            s->>'status' as search_status,
            s->>'keyword' as keyword,
            s->>'term' as term,
            (s->>'providerRows')::int as provider_rows,
            (s->>'usableRows')::int as usable_rows,
            (s->>'created')::int as created_count,
            (s->>'matchedExisting')::int as matched_existing,
            (s->>'rejectedRows')::int as rejected_rows,
            (s->>'duplicateRows')::int as duplicate_rows,
            (s->>'costUsd')::numeric as cost_usd,
            s->>'reason' as reason
       from recent r
       left join users u on u.user_id = r.requested_by
       left join saved_markets m on m.market_id = r.market_id
       -- A left join lateral and not a comma join: a run refused before it planned
       -- anything has no perSearch entries at all, and it is precisely the run an
       -- operator needs to see. A cross join would delete it from the page.
       left join lateral jsonb_array_elements(coalesce(r.progress->'perSearch','[]'::jsonb)) s
         on true`,
    [jobWindow]);

  const { rows: tasks } = await query<TaskRow>(
    `select provider_task_id, provider, provider_native_id, status,
            submitted_at, collected_at, cost_usd, job_id,
            request->>'verticalProfileId' as vertical_profile_id,
            request->>'geographyType' as geography_type,
            request->>'geographyValue' as geography_value,
            request->'search'->>'keyword' as keyword,
            request->'search'->>'term' as term,
            request->>'miningMode' as mining_mode
       from provider_tasks
      order by submitted_at desc
      limit $1`, [jobWindow]);

  // Bounded to the runs on the page. Grouping the whole candidate table costs more
  // every week the miner runs, for counts belonging to rows nobody is looking at.
  const { rows: candidates } = await query<CandidateRow>(
    `select dc.job_id,
            count(*) filter (where upper(dc.entity_status) = 'NEEDS_REVIEW')::int as needs_review
       from discovery_candidates dc
      where dc.job_id in (select job_id from jobs
                           where job_type = 'market_mine'
                           order by created_at desc limit $1)
      group by dc.job_id`, [jobWindow]);

  // A collection that is queued or running now. Taken from the confirmed plan, which
  // names the exact task it is authorised to collect and nothing else.
  const { rows: inFlight } = await query<InFlightRow>(
    `select distinct s->>'approvedProviderTaskId' as provider_task_id, j.status as job_status
       from jobs j
       join search_plan_previews p on p.plan_id = (j.payload->>'confirmed_plan_id')::uuid
       cross join lateral jsonb_array_elements(coalesce(p.plan->'plan'->'searches','[]'::jsonb)) s
      where j.job_type = 'market_mine' and j.status in ('QUEUED','RUNNING')
        and s->>'approvedProviderTaskId' is not null`);

  return assembleDiscoveryRows({
    // A run with no perSearch entries arrives from the lateral join with every search
    // column null; it is one row about one refused run, which is what it should be.
    searches,
    tasks,
    needsReviewByJob: new Map(candidates.map((c) => [c.job_id, Number(c.needs_review)])),
    inFlightTaskIds: new Set(inFlight.map((f) => f.provider_task_id)),
  });
}

/** Most recent market searches. The default limit is a page, not a history. */
export async function marketDiscoveryRows(limit = 60): Promise<MarketDiscoveryRow[]> {
  return (await assembleWindow()).slice(0, limit);
}

/**
 * The counts above the tabs and the rows beneath them, from one classification.
 *
 * Both used to be derived separately -- the counts in SQL over `provider_tasks`, the
 * rows in TypeScript over searches -- and they disagreed in production by exactly the
 * one search that was made in live mode and therefore never created a task row. A
 * count an operator cannot reconcile with the table under it is worse than no count.
 */
export async function loadMiningView(limit = 60): Promise<{
  summary: MiningSummary; rows: MarketDiscoveryRow[];
}> {
  const all = await assembleWindow();
  const summary = await summarizeMiningView(all);
  return { summary, rows: all.slice(0, limit) };
}

// ------------------------------------------------------------ website research

export interface WebsiteResearchSummary {
  queued: number;
  running: number;
  /** The site was read. */
  completed: number;
  /** The site said no: a page was refused. */
  blocked: number;
  /** Nothing could be read and nothing refused us — the source was not there. */
  sourceUnavailable: number;
  failed: number;
  /** Completed runs where at least one page was still refused. */
  completedWithSomeBlocked: number;
  total: number;
}

export type ResearchBucket = 'completed' | 'blocked' | 'source_unavailable' | 'queued'
  | 'running' | 'failed';

/** The buckets a drill-down may ask for. A query string is not a type. */
export const RESEARCH_BUCKETS: ResearchBucket[] = [
  'completed', 'blocked', 'source_unavailable', 'queued', 'running', 'failed',
];

export interface WebsiteResearchRow {
  accountId: string | null;
  companyName: string | null;
  bucket: ResearchBucket;
  status: string | null;
  pagesFetched: number | null;
  pagesBlocked: number | null;
  at: Date | null;
  detail: string | null;
}

/**
 * Aggregate before enumerating.
 *
 * A hundred rows each saying "Researching website" is not information an operator can
 * act on; six numbers and a drill-down is. The counts come from `research_runs`,
 * because a job's outcome says the worker finished and the run says whether anything
 * was read -- production holds 320 `account_research` jobs that all say COMPLETED and
 * 94 runs underneath them that fetched no page at all.
 */
export async function websiteResearchSummary(): Promise<WebsiteResearchSummary> {
  const { rows } = await query<Record<string, number>>(
    `select
       (select count(*)::int from jobs
         where job_type = 'account_research' and status = 'QUEUED') as queued,
       (select count(*)::int from jobs
         where job_type = 'account_research' and status = 'RUNNING') as running,
       (select count(*)::int from jobs
         where job_type = 'account_research' and status = 'FAILED') as failed,
       (select count(*)::int from research_runs where status = 'completed') as completed,
       (select count(*)::int from research_runs
         where status = 'completed'
           and coalesce((adapter_results->>'pages_blocked')::int, 0) > 0)
         as completed_with_some_blocked,
       (select count(*)::int from research_runs
         where status <> 'completed'
           and coalesce((adapter_results->>'pages_blocked')::int, 0) > 0) as blocked,
       (select count(*)::int from research_runs
         where status <> 'completed'
           and coalesce((adapter_results->>'pages_blocked')::int, 0) = 0
           and coalesce((adapter_results->>'pages_fetched')::int, 0) = 0)
         as source_unavailable,
       (select count(*)::int from research_runs) as total_runs`);
  const row = rows[0]!;
  const n = (key: string): number => Number(row[key] ?? 0);
  return {
    queued: n('queued'), running: n('running'), failed: n('failed'),
    completed: n('completed'), blocked: n('blocked'),
    sourceUnavailable: n('source_unavailable'),
    completedWithSomeBlocked: n('completed_with_some_blocked'),
    total: n('total_runs'),
  };
}

/** The drill-down behind one bucket. Enumerating is a choice the operator makes. */
export async function websiteResearchRows(
  bucket: ResearchBucket, limit = 50,
): Promise<WebsiteResearchRow[]> {
  if (bucket === 'queued' || bucket === 'running' || bucket === 'failed') {
    const status = bucket === 'queued' ? 'QUEUED' : bucket === 'running' ? 'RUNNING' : 'FAILED';
    const { rows } = await query<{
      account_id: string | null; company_name: string | null; created_at: Date;
      last_error: string | null;
    }>(
      `select j.account_id, a.canonical_name as company_name, j.created_at, j.last_error
         from jobs j
         left join accounts a on a.account_id = j.account_id
        where j.job_type = 'account_research' and j.status = $1
        order by j.created_at desc limit $2`, [status, limit]);
    return rows.map((row) => ({
      accountId: row.account_id, companyName: row.company_name, bucket,
      status: status, pagesFetched: null, pagesBlocked: null, at: row.created_at,
      detail: row.last_error,
    }));
  }

  const predicate = bucket === 'completed'
    ? `r.status = 'completed'`
    : bucket === 'blocked'
      ? `r.status <> 'completed' and coalesce((r.adapter_results->>'pages_blocked')::int,0) > 0`
      : `r.status <> 'completed'
           and coalesce((r.adapter_results->>'pages_blocked')::int,0) = 0
           and coalesce((r.adapter_results->>'pages_fetched')::int,0) = 0`;

  const { rows } = await query<{
    account_id: string; company_name: string | null; status: string;
    pages_fetched: number | null; pages_blocked: number | null;
    completed_at: Date | null; error_summary: string | null;
  }>(
    `select r.account_id, a.canonical_name as company_name, r.status,
            (r.adapter_results->>'pages_fetched')::int as pages_fetched,
            (r.adapter_results->>'pages_blocked')::int as pages_blocked,
            r.completed_at, r.error_summary
       from research_runs r
       left join accounts a on a.account_id = r.account_id
      where ${predicate}
      order by r.completed_at desc nulls last
      limit $1`, [limit]);

  return rows.map((row) => ({
    accountId: row.account_id, companyName: row.company_name, bucket,
    status: row.status, pagesFetched: num(row.pages_fetched),
    pagesBlocked: num(row.pages_blocked), at: row.completed_at,
    detail: row.error_summary,
  }));
}

// ----------------------------------------------------------------- top summary

/**
 * The seven numbers, tallied from the searches themselves.
 *
 * Only the website-research and failed-job figures are read separately, because they
 * are about queues rather than about paid searches.
 */
export async function summarizeMiningView(
  rows: MarketDiscoveryRow[],
): Promise<MiningSummary> {
  const counted = (state: SalesBrainState): number =>
    rows.filter((row) => row.salesBrainState === state).length;

  const { rows: queues } = await query<Record<string, number>>(
    `select
       (select count(*)::int from jobs
         where job_type = 'account_research' and status = 'QUEUED') as website_queued,
       (select count(*)::int from jobs
         where job_type = 'account_research' and status = 'RUNNING') as website_running,
       (select count(*)::int from jobs where status = 'FAILED') as failed_jobs`);
  const queue = queues[0]!;
  const n = (key: string): number => Number(queue[key] ?? 0);

  return {
    providerProcessing: counted('AWAITING_PROVIDER'),
    waitingOnSalesBrain: counted('COLLECTED_NOT_INGESTED'),
    collecting: counted('COLLECTING'),
    resultsIngested: counted('INGESTED'),
    searchesCounted: rows.length,
    websiteResearchQueued: n('website_queued'),
    websiteResearchRunning: n('website_running'),
    needsAttention: rows.filter((row) => row.needsAttention).length + n('failed_jobs'),
  };
}

/** The same numbers when the caller does not also need the rows. */
export async function miningSummary(): Promise<MiningSummary> {
  return summarizeMiningView(await assembleWindow());
}

/**
 * Durable provider truth per job, for the All Activity tab.
 *
 * The historical rows stay on that tab, and a row saying "Provider still working"
 * about a task the ledger has since collected is the exact sentence this work exists
 * to remove. The tab keeps the job's own outcome and adds what the ledger now says.
 */
export interface JobProviderTruth {
  outstanding: number;
  collected: number;
  abandoned: number;
  failed: number;
}

export async function providerTruthByJob(jobIds: string[]): Promise<Map<string, JobProviderTruth>> {
  const truth = new Map<string, JobProviderTruth>();
  if (jobIds.length === 0) return truth;
  // Both places a run records what it bought. `perSearch` is the current shape and
  // `providerTaskIds` the older one; a job written before per-search accounting would
  // otherwise keep its stale sentence because nothing could find its tasks.
  const { rows } = await query<{
    job_id: string; status: ProviderState; n: number;
  }>(
    `select j.job_id, t.status, count(distinct t.provider_task_id)::int as n
       from jobs j
       cross join lateral (
         select s->>'providerTaskId' as native_id
           from jsonb_array_elements(coalesce(j.progress->'perSearch','[]'::jsonb)) s
         union
         select id.value #>> '{}'
           from jsonb_array_elements(coalesce(j.progress->'providerTaskIds','[]'::jsonb)) id
       ) ids
       join provider_tasks t on t.provider_native_id = ids.native_id
      where j.job_id = any($1::uuid[])
      group by j.job_id, t.status`, [jobIds]);
  for (const row of rows) {
    const entry = truth.get(row.job_id)
      ?? { outstanding: 0, collected: 0, abandoned: 0, failed: 0 };
    if (row.status === 'PENDING') entry.outstanding += Number(row.n);
    if (row.status === 'COLLECTED') entry.collected += Number(row.n);
    if (row.status === 'ABANDONED') entry.abandoned += Number(row.n);
    if (row.status === 'FAILED') entry.failed += Number(row.n);
    truth.set(row.job_id, entry);
  }
  return truth;
}
