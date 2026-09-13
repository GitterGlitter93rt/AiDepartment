import { query } from '../db/pool.js';
import { planDiscoverySearches, type SearchPlan } from './searchPlan.js';
import { classifyGeography } from './geography.js';
import { assumedRunCostUsd, spendPosition, type SpendPosition } from './spend.js';
import { negativeTermsFor } from './searchTaxonomy.js';
import { availableDiscoveryAdapters } from '../workers/marketMiner.js';

/**
 * A market search an operator can read before it costs anything.
 *
 * Every defect this campaign found in the miner was invisible until money had been
 * spent and results looked wrong: a budget of twenty-five buying one search, a
 * roofing run asking for hail damage, a provider search id used as a business
 * identity. None of them needed a live call to see -- they needed somebody to be
 * shown the actual queries, the actual fingerprints and the actual cost before the
 * run rather than after it.
 *
 * So the plan is the product here, and the live run is a second step that reuses the
 * ordinary job and provider-task machinery. There is deliberately no fast path: a
 * canary that bypassed the queue would prove the canary works and tell us nothing
 * about the system that will actually run.
 */

export interface CanaryOptions {
  vertical: string | null;
  location: string | null;
  count: number;
  maxCostCents: number;
  /** Events to include. Empty means cause-neutral, per the vertical's own terms. */
  causes?: string[];
  miningMode?: string;
  live?: boolean;
  /** Must equal maxCostCents for a live run. Stating the money twice, on purpose. */
  confirmSpendCents?: number | null;
}

export interface CanaryRefusal {
  code: 'NO_VERTICAL' | 'NO_LOCATION' | 'BAD_GEOGRAPHY' | 'NO_QUERIES' | 'COUNT_CEILING'
    | 'COST_CEILING' | 'NO_PROVIDER' | 'LIVE_NOT_CONFIRMED' | 'DAILY_BUDGET'
    // Not "nothing spent today". A day this run could not read is a day it must not
    // add to: the per-run ceiling is not the per-day ceiling.
    | 'SPEND_UNKNOWN';
  message: string;
}

export interface CanaryPlan {
  vertical: string | null;
  /** What the operator typed, and what it was understood as. */
  locationInput: string | null;
  geography: { type: string; value: string; display: string } | null;
  strategy: string;
  causesRequested: string[];
  /** Event terms this vertical has that were not searched, and why they were not. */
  causesHeldBack: string[];
  searches: SearchPlan['searches'];
  requestedCount: number;
  /** Terms the vertical defines, before the count trimmed them. */
  availableTerms: number;
  providers: string[];
  /** What this system excludes for this vertical, applied to results not queries. */
  exclusions: string[];
  cost: {
    assumedPerSearchUsd: number;
    estimatedTotalUsd: number;
    maxAllowedUsd: number;
    /** Today's spend, because a ceiling per run is not a ceiling per day. */
    spentTodayUsd: number;
    dailyBudgetUsd: number | null;
  };
  live: boolean;
  refusals: CanaryRefusal[];
  /** True only when nothing refused and a live run would be permitted to proceed. */
  wouldRun: boolean;
}

/**
 * The most searches one canary may ask for.
 *
 * A canary is a small, deliberate experiment. A number far above this is a
 * production run wearing a canary's name, and it should be an explicit decision
 * rather than a typo in a flag.
 */
export const MAX_CANARY_SEARCHES = 25;

export async function planCanary(options: CanaryOptions): Promise<CanaryPlan> {
  const refusals: CanaryRefusal[] = [];
  const assumedPerSearchUsd = assumedRunCostUsd();
  const maxAllowedUsd = Math.max(0, options.maxCostCents) / 100;
  const miningMode = options.miningMode ?? 'advertiser_first';

  if (!options.vertical) {
    refusals.push({ code: 'NO_VERTICAL',
      message: 'Pick a vertical. A market search with no trade in it has nothing to '
        + 'ask a provider for, and asking anyway spends money on a question nobody has.' });
  }
  if (!options.location) {
    refusals.push({ code: 'NO_LOCATION',
      message: 'Pick a location: a ZIP, a city and state, or a state.' });
  }

  const count = Math.max(0, Math.floor(options.count));
  if (count > MAX_CANARY_SEARCHES) {
    refusals.push({ code: 'COUNT_CEILING',
      message: `${count} searches is above the canary ceiling of ${MAX_CANARY_SEARCHES}. `
        + 'A canary is a small deliberate experiment; a number this size is a '
        + 'production run and should be an explicit decision rather than a flag typo.' });
  }

  // An operator types a place, not a place and a type. "32095", "Jacksonville, FL"
  // and "Florida" are three different geographies and the operator should not have
  // to say which -- Find Prospects already reads them this way, and a canary that
  // demanded a --geography-type flag would be a different product from the one the
  // portal is.
  const classified = options.location ? classifyGeography(options.location) : null;
  if (classified && !classified.ok) {
    refusals.push({ code: 'BAD_GEOGRAPHY', message: classified.message });
  }

  // The type from the reading, the text the operator typed.
  //
  // This passed `classified.value`, which is normalised for storage: a city
  // normalises to "Jacksonville" without its state, `planDiscoverySearches`
  // re-normalises what it is given, and `normalizeGeography('city', 'Jacksonville')`
  // correctly refuses a city with no state as ambiguous. So the search plan came back
  // with no geography and no terms, and the canary silently planned nothing for every
  // city and every state -- it only ever worked for ZIPs, which survive the round
  // trip unchanged.
  //
  // Type plus original text is what `classifyGeography` feeds `normalizeGeography`
  // itself, so re-reading it here reproduces the same answer rather than a degraded
  // one.
  const plan = options.vertical && classified?.ok
    ? await planDiscoverySearches({
      verticalProfileId: options.vertical,
      geographyType: classified.type,
      geographyValue: options.location,
      miningMode,
      count: Math.min(count, MAX_CANARY_SEARCHES),
      ...(options.causes ? { causes: options.causes } : {}),
    })
    : null;

  if (plan?.refusal) {
    refusals.push({ code: 'NO_QUERIES', message: plan.refusal.reason });
  }

  const searches = plan?.searches ?? [];
  // Costed on what will actually run, not on what was asked for: a vertical with six
  // terms cannot spend ten searches' worth however high the count.
  const estimatedTotalUsd = Number((searches.length * assumedPerSearchUsd).toFixed(4));

  if (searches.length > 0 && estimatedTotalUsd > maxAllowedUsd) {
    refusals.push({ code: 'COST_CEILING',
      message: `${searches.length} search(es) at an assumed $${assumedPerSearchUsd.toFixed(3)} `
        + `each is $${estimatedTotalUsd.toFixed(3)}, above the $${maxAllowedUsd.toFixed(2)} `
        + 'ceiling for this run. Refused before the money is spent rather than stopped '
        + 'part-way through.' });
  }

  const providers = availableDiscoveryAdapters().map((adapter) => adapter.name);
  if (providers.length === 0) {
    refusals.push({ code: 'NO_PROVIDER',
      message: 'No discovery provider is configured, so a live run would find nothing. '
        + 'The plan below is still exactly what would be asked once one is.' });
  }

  let spend: SpendPosition = {
    spentTodayUsd: 0, estimatedPortionUsd: 0, budgetUsd: 0,
    wouldExceed: false, remainingUsd: null,
  };
  let spendKnown = true;
  try {
    spend = await spendPosition();
  } catch (error) {
    // Not reporting only. The refusal below reads these numbers, and a zeroed
    // position with no budget looks exactly like a day with nothing spent and no
    // ceiling -- so a failure here would take the daily ceiling off a live run
    // rather than stop it.
    spendKnown = false;
    refusals.push({ code: 'SPEND_UNKNOWN',
      message: 'What today has already cost could not be read '
        + `(${error instanceof Error ? error.message : String(error)}). A per-run `
        + 'ceiling is not a per-day ceiling, so a run that cannot see the day is '
        + 'refused rather than assumed to fit.' });
  }
  if (spendKnown && spend.budgetUsd > 0
      && spend.spentTodayUsd + estimatedTotalUsd > spend.budgetUsd) {
    refusals.push({ code: 'DAILY_BUDGET',
      message: `Today's provider budget is $${spend.budgetUsd.toFixed(2)} and `
        + `$${spend.spentTodayUsd.toFixed(2)} has gone already. This run would take it `
        + 'over, so it is refused: a per-run ceiling is not a per-day ceiling.' });
  }

  // Live is the second step, and it has to say the money twice.
  //
  // A single flag is one paste away from a run nobody meant. Requiring the ceiling to
  // be repeated means a copied dry-run command can never become a live one, and an
  // operator who does mean it has stated the number they are willing to spend.
  const live = options.live === true;
  if (live && options.confirmSpendCents !== options.maxCostCents) {
    refusals.push({ code: 'LIVE_NOT_CONFIRMED',
      message: `A live run needs --confirm-spend-cents ${options.maxCostCents} as well as `
        + '--live. Stating the ceiling twice is deliberate: a dry-run command copied '
        + 'and given --live must not be able to spend anything.' });
  }

  const exclusions = options.vertical ? await negativeTermsFor(options.vertical) : [];

  return {
    vertical: options.vertical,
    locationInput: options.location,
    // Read from the classification rather than from the search plan's echo of it.
    // The two are the same answer when a vertical has terms, and when it has none
    // the search plan is null -- which used to make the plan claim it had not
    // understood a location it had understood perfectly well.
    geography: classified?.ok
      ? { type: classified.type, value: classified.value, display: classified.display }
      : null,
    strategy: miningMode,
    causesRequested: plan?.causesRequested ?? [],
    causesHeldBack: plan?.causesAvailable ?? [],
    searches,
    requestedCount: count,
    availableTerms: plan?.available ?? 0,
    providers,
    exclusions,
    cost: {
      assumedPerSearchUsd, estimatedTotalUsd, maxAllowedUsd,
      // -1 rather than 0: a day nobody could read is not a day with nothing spent.
      spentTodayUsd: spendKnown ? spend.spentTodayUsd : -1,
      dailyBudgetUsd: spendKnown ? (spend.budgetUsd || null) : null,
    },
    live,
    refusals,
    // A dry run never "would run": it is a description, and calling it a go-ahead is
    // how somebody reads a plan as a receipt.
    wouldRun: live && refusals.length === 0,
  };
}

export function renderCanaryPlan(plan: CanaryPlan): string {
  const lines: string[] = ['', 'MINER CANARY — DRY RUN', ''];
  if (plan.live) { lines[1] = 'MINER CANARY — LIVE'; }

  lines.push(`  vertical    ${plan.vertical ?? '(none given)'}`);
  lines.push(`  location    ${plan.locationInput ?? '(none given)'}`
    + (plan.geography ? `  ->  ${plan.geography.display} (${plan.geography.type})` : ''));
  lines.push(`  strategy    ${plan.strategy}`);
  lines.push(`  events      ${plan.causesRequested.length > 0
    ? plan.causesRequested.join(', ') : 'none — cause-neutral'}`);
  lines.push(`  provider    ${plan.providers.length > 0
    ? plan.providers.join(', ') : 'none configured'}`);
  lines.push('');

  lines.push(`  ${plan.searches.length} independent provider task(s) would be submitted`
    + (plan.requestedCount !== plan.searches.length
      ? `, from ${plan.requestedCount} asked for and ${plan.availableTerms} the vertical defines`
      : ''));
  for (const search of plan.searches) {
    lines.push(`   ${String(search.index).padStart(2)}. "${search.keyword}"`);
    lines.push(`       in ${search.locationName}`);
    lines.push(`       ${search.fingerprint}`);
  }
  lines.push('');

  if (plan.causesHeldBack.length > 0) {
    lines.push(`  not searched: ${plan.causesHeldBack.join(', ')} damage. Those terms find`);
    lines.push('     companies advertising for that event, which is a different question');
    lines.push('     from who works in this trade here. Pass --cause to include them.');
    lines.push('');
  }

  if (plan.exclusions.length > 0) {
    lines.push(`  results excluded if they match: ${plan.exclusions.join(', ')}`);
    lines.push('');
  }

  lines.push('  cost');
  lines.push(`     assumed per search   $${plan.cost.assumedPerSearchUsd.toFixed(3)}`);
  lines.push(`     estimated total      $${plan.cost.estimatedTotalUsd.toFixed(3)}`);
  lines.push(`     ceiling for this run $${plan.cost.maxAllowedUsd.toFixed(2)}`);
  lines.push(`     spent today          $${plan.cost.spentTodayUsd.toFixed(2)}`
    + (plan.cost.dailyBudgetUsd !== null
      ? ` of $${plan.cost.dailyBudgetUsd.toFixed(2)}` : ' (no daily ceiling set)'));
  lines.push('');

  if (plan.refusals.length > 0) {
    lines.push('  REFUSED');
    for (const refusal of plan.refusals) {
      lines.push(`     ${refusal.code}: ${refusal.message}`);
    }
    lines.push('');
  }

  lines.push(plan.live
    ? (plan.wouldRun
      ? '  This is a live run. The searches above will be submitted as ordinary queued '
        + 'jobs.'
      : '  Nothing will be submitted: see the refusals above.')
    : '  Nothing was submitted and nothing was spent. This is a description of what a '
      + 'live run would do.');
  lines.push('');
  return lines.join('\n');
}

/** Everything one canary search actually did, once a live run has happened. */
export interface CanarySearchReport {
  index: number;
  term: string;
  keyword: string;
  fingerprint: string;
  providerTaskId: string | null;
  state: string;
  providerRows: number;
  usableRows: number;
  excludedRows: number;
  rejectedRows: number;
  duplicateRows: number;
  matchedExisting: number;
  newAccounts: number;
  costUsd: number | null;
  failureReason: string | null;
}

/**
 * States in which no provider was asked anything.
 *
 * The distinction the canary exists to make. A search we declined to buy is not a
 * search that failed and it is certainly not a search that was submitted: the first
 * costs nothing and tells us nothing, the second costs money and tells us the
 * provider is unwell. Reporting them together on the one artifact whose purpose is
 * to say exactly what was bought, before somebody authorises more of it, is the
 * wrong number to be wrong.
 *
 * BUDGET_EXHAUSTED and MARKET_DISABLED are our own controls refusing to spend.
 * NOT_CONFIGURED and GOVERNANCE_BLOCKED are a run that could not have asked anybody.
 * None of them reached a provider.
 */
const NOT_SUBMITTED_STATES = new Set([
  'BUDGET_EXHAUSTED', 'MARKET_DISABLED', 'NOT_CONFIGURED', 'GOVERNANCE_BLOCKED',
]);

export interface CanaryReport {
  jobId: string;
  outcome: string | null;
  outcomeReason: string | null;
  perSearch: CanarySearchReport[];
  totals: {
    /** Searches that actually reached a provider. What the money followed. */
    searchesSubmitted: number;
    /** Searches this system declined to buy, or could not have bought. */
    searchesRefused: number;
    searchesCompleted: number;
    searchesPending: number;
    /** Searches that reached a provider and came back wrong. */
    searchesFailed: number;
    providerRows: number;
    /**
     * Identities the resolver refused, and ones it could not name.
     *
     * The canary's own defect was that it reported "65 businesses identified" about a
     * page of articles. Rows are not identities and identities are not businesses, so
     * the three numbers are reported apart and the arithmetic is checkable.
     */
    entitiesRejected: number;
    entitiesNeedingReview: number;
    /** Companies a commercial-intelligence query found that we do not hold. */
    notInMarket: number;
    usableBusinesses: number;
    excludedByVertical: number;
    matchedExisting: number;
    newAccounts: number;
    researchQueued: number;
    researchCompleted: number;
    researchFailed: number;
    scored: number;
    repReady: number;
    totalSpendUsd: number | null;
    /** Searches submitted more than once for the same words and place. */
    duplicatePaidSubmits: number;
  };
  elapsedMs: number | null;
}

/**
 * What a run did, read from the durable record rather than from memory.
 *
 * Every number here comes from the same tables the portal reads, so a canary report
 * and the Mining page cannot disagree. A harness that kept its own tally would be
 * reporting on itself.
 */
export async function canaryReport(jobId: string): Promise<CanaryReport | null> {
  const { rows: jobRows } = await query<{
    outcome: string | null; outcome_reason: string | null; progress: Record<string, any>;
    started_at: Date | null; completed_at: Date | null; market_id: string | null;
  }>(
    `select outcome, outcome_reason, progress, started_at, completed_at, market_id
       from jobs where job_id = $1`, [jobId]);
  const job = jobRows[0];
  if (!job) return null;

  const progress = job.progress ?? {};
  const perSearchRaw = (progress['perSearch'] ?? []) as Record<string, any>[];
  const perSearch: CanarySearchReport[] = perSearchRaw.map((row) => ({
    index: Number(row['index'] ?? 0),
    term: String(row['term'] ?? ''),
    keyword: String(row['keyword'] ?? ''),
    fingerprint: String(row['fingerprint'] ?? ''),
    providerTaskId: row['providerTaskId'] ?? null,
    state: String(row['status'] ?? 'UNKNOWN'),
    providerRows: Number(row['providerRows'] ?? 0),
    usableRows: Number(row['usableRows'] ?? 0),
    excludedRows: Number(row['excludedRows'] ?? 0),
    rejectedRows: Number(row['rejectedRows'] ?? 0),
    duplicateRows: Number(row['duplicateRows'] ?? 0),
    matchedExisting: Number(row['matchedExisting'] ?? 0),
    newAccounts: Number(row['created'] ?? 0),
    costUsd: row['costUsd'] === null || row['costUsd'] === undefined
      ? null : Number(row['costUsd']),
    // The search's own sentence where there is one, falling back to the bare status
    // so a run recorded before the reason was carried still says something.
    failureReason: row['status'] && !['OK', 'ZERO_RESULTS'].includes(String(row['status']))
      ? (row['reason'] ? `${String(row['status'])}: ${String(row['reason'])}`
                       : String(row['status']))
      : null,
  }));

  // Accounts this run touched, so research and scoring completion are about the
  // companies the canary found rather than about the whole database.
  const { rows: accountRows } = await query<{ account_id: string }>(
    `select distinct account_id from search_observations
      where job_id = $1 and account_id is not null`, [jobId]);
  const accountIds = accountRows.map((row) => row.account_id);

  const { rows: researchRows } = await query<{
    queued: number; completed: number; failed: number; scored: number;
  }>(
    `select
       (select count(*)::int from jobs
         where job_type in ('account_research','contact_research')
           and account_id = any($1::uuid[])) as queued,
       (select count(*)::int from jobs
         where job_type in ('account_research','contact_research')
           and account_id = any($1::uuid[]) and status = 'SUCCEEDED') as completed,
       (select count(*)::int from jobs
         where job_type in ('account_research','contact_research')
           and account_id = any($1::uuid[]) and status = 'FAILED') as failed,
       (select count(*)::int from accounts
         where account_id = any($1::uuid[]) and manual_tier is not null) as scored`,
    [accountIds.length > 0 ? accountIds : ['00000000-0000-0000-0000-000000000000']]);
  const research = researchRows[0]!;

  let repReady = 0;
  if (accountIds.length > 0) {
    const { readinessFor } = await import('../domain/repReady.js');
    for (const accountId of accountIds) {
      const readiness = await readinessFor(accountId);
      if (readiness?.state === 'REP_READY') repReady += 1;
    }
  }

  // A search bought twice for the same words and place is the most expensive mistake
  // this system can make, so it is counted rather than assumed absent.
  const { rows: duplicateRows } = await query<{ n: number }>(
    `select coalesce(sum(c - 1), 0)::int as n from (
       select count(*)::int as c from provider_tasks
        where job_id = $1 group by fingerprint having count(*) > 1) t`, [jobId]);

  const states = perSearch.map((row) => row.state);
  const costs = perSearch.map((row) => row.costUsd).filter(
    (cost): cost is number => cost !== null);

  return {
    jobId,
    outcome: job.outcome,
    outcomeReason: job.outcome_reason,
    perSearch,
    totals: {
      entitiesRejected: Number(progress['entitiesRejected'] ?? 0),
      entitiesNeedingReview: Number(progress['entitiesNeedingReview'] ?? 0),
      notInMarket: Number(progress['notInMarket'] ?? 0),
      // Attempted is not submitted. `perSearch` has a row per search the run
      // considered, and a run can now submit some and refuse others in the same pass,
      // because the daily ceiling is consulted per call rather than per run.
      searchesSubmitted: states.filter((state) => !NOT_SUBMITTED_STATES.has(state)).length,
      searchesRefused: states.filter((state) => NOT_SUBMITTED_STATES.has(state)).length,
      searchesCompleted: states.filter((state) => state === 'OK' || state === 'ZERO_RESULTS').length,
      searchesPending: states.filter((state) => state === 'PENDING').length,
      searchesFailed: states.filter(
        (state) => !['OK', 'ZERO_RESULTS', 'PENDING'].includes(state)
          && !NOT_SUBMITTED_STATES.has(state)).length,
      providerRows: perSearch.reduce((sum, row) => sum + row.providerRows, 0),
      usableBusinesses: perSearch.reduce((sum, row) => sum + row.usableRows, 0),
      excludedByVertical: Number(progress['excludedByVertical'] ?? 0),
      matchedExisting: perSearch.reduce((sum, row) => sum + row.matchedExisting, 0),
      newAccounts: perSearch.reduce((sum, row) => sum + row.newAccounts, 0),
      researchQueued: research.queued,
      researchCompleted: research.completed,
      researchFailed: research.failed,
      scored: research.scored,
      repReady,
      // Null rather than zero when no provider declared a cost: a run whose cost is
      // unknown is not a free run.
      totalSpendUsd: costs.length > 0
        ? Number(costs.reduce((sum, cost) => sum + cost, 0).toFixed(4)) : null,
      duplicatePaidSubmits: duplicateRows[0]?.n ?? 0,
    },
    elapsedMs: job.started_at && job.completed_at
      ? job.completed_at.getTime() - job.started_at.getTime() : null,
  };
}

export function renderCanaryReport(report: CanaryReport): string {
  const lines = ['', `MINER CANARY REPORT — job ${report.jobId}`, '',
    `  outcome  ${report.outcome ?? 'unknown'}`,
    `  ${report.outcomeReason ?? ''}`, ''];

  for (const search of report.perSearch) {
    lines.push(`  ${String(search.index).padStart(2)}. "${search.keyword}"  [${search.state}]`);
    lines.push(`      task ${search.providerTaskId ?? 'none'}  `
      + `rows ${search.providerRows}  usable ${search.usableRows}  `
      + `dupes ${search.duplicateRows}  matched ${search.matchedExisting}  `
      + `new ${search.newAccounts}  `
      + `cost ${search.costUsd === null ? 'unknown' : `$${search.costUsd.toFixed(4)}`}`);
    if (search.failureReason) lines.push(`      ${search.failureReason}`);
  }

  const totals = report.totals;
  lines.push('', '  totals');
  lines.push(`     searches   ${totals.searchesSubmitted} submitted`
    + `${totals.searchesRefused > 0
        ? `, ${totals.searchesRefused} refused before spending` : ''}, `
    + `${totals.searchesCompleted} completed, ${totals.searchesPending} pending, `
    + `${totals.searchesFailed} failed`);
  lines.push(`     rows       ${totals.providerRows} provider, ${totals.usableBusinesses} usable, `
    + `${totals.excludedByVertical} excluded by vertical`);
  // Rows are not identities and identities are not businesses. Printed apart so
  // "65 businesses identified" can never again describe a page of articles.
  lines.push(`     entities   ${totals.entitiesRejected} not a business, `
    + `${totals.entitiesNeedingReview} could not be named`
    + `${totals.notInMarket > 0
        ? `, ${totals.notInMarket} found by a commercial query and not already held` : ''}`);
  lines.push(`     accounts   ${totals.newAccounts} new, ${totals.matchedExisting} already held`);
  lines.push(`     research   ${totals.researchQueued} queued, ${totals.researchCompleted} done, `
    + `${totals.researchFailed} failed`);
  lines.push(`     scored     ${totals.scored}`);
  lines.push(`     rep-ready  ${totals.repReady}`);
  lines.push(`     spend      ${totals.totalSpendUsd === null
    ? 'not declared by the provider' : `$${totals.totalSpendUsd.toFixed(4)}`}`);
  if (totals.duplicatePaidSubmits > 0) {
    lines.push(`     WARNING    ${totals.duplicatePaidSubmits} search(es) were submitted `
      + 'more than once for the same words and place');
  }
  lines.push('');
  return lines.join('\n');
}
