import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { runContactResearch } from './contactResearch.js';
import { registerHandler, type JobRecord, type JobOutcome } from './runner.js';
import { enqueueAccountResearch } from './enqueue.js';
import {
  closeProviderTask, openProviderTask, recordCollectionAttempt, recordProviderTask,
  MAX_TASK_COLLECTIONS,
} from '../miner/providerTasks.js';
import { recordEvidence } from '../domain/accounts.js';

/**
 * Market Miner orchestration.
 * Authority: market-miner-prospect-factory-spec.md, market-miner-refresh-orchestrator-spec.md,
 * outbound-sales-brain-saved-markets-inventory-replenishment-spec.md.
 *
 * Two halves, deliberately separable:
 *
 *   REFRESH  — re-research Accounts we already have. Needs no provider credential,
 *              runs today, and is what keeps a Saved Market honest rather than
 *              letting yesterday's ad evidence masquerade as current.
 *
 *   DISCOVERY — find Accounts we do not have. Needs an approved search/SERP provider
 *              and a signed source-governance review, so it is defined as an adapter
 *              interface and left disabled (blocker B-3).
 *
 * A Saved Market may never weaken its qualification standard to hit an inventory
 * target (SALES-TEAM-ACCESS-CURRENT.md §5, §19).
 */

// ---------------------------------------------------------------- discovery --

export interface DiscoveryQuery {
  verticalProfileId: string | null;
  geographyType: string | null;
  geographyValue: string | null;
  miningMode: string;
  /** Hard ceiling on provider calls for this run. */
  queryBudget: number;
  /**
   * The one search this call is for: its words, its place and its identity.
   *
   * Planning moved out of the adapter. It used to read the vertical taxonomy, order
   * it, slice it to the budget and then ask the provider for element zero -- so a
   * budget of twenty-five bought one search, and no two searches could ever have
   * separate provider tasks because they shared the job's fingerprint. The
   * orchestrator now plans, because it is the thing that owns fingerprints, task
   * lifecycle and accounting, and it hands the adapter one concrete search at a
   * time.
   */
  search?: {
    /** What to ask the provider, geography included. */
    keyword: string;
    /** A place name the provider can geocode. */
    locationName: string;
    /** The taxonomy term without the geography. */
    term: string;
    /** Identity of this search, for the provider task lifecycle. */
    fingerprint: string;
    index: number;
  };
}

export interface DiscoveredBusiness {
  name: string;
  website?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  providerNativeId?: string | null;
  resultType?: string;
  advertisedService?: string | null;
  landingUrl?: string | null;
  /**
   * What the provider actually showed us, kept so a rep can quote it.
   *
   * The adapter normalized every one of these and then dropped them on the way
   * here: the search that found the company, where it sat on the page, what the ad
   * said, the provider's own verification link, and when the SERP was really read.
   * `search_observations` has had a column waiting for each since migration 003.
   * Without them an observation says only "paid_search", which is a claim with no
   * proof behind it -- and on a collected task, one stamped at collection time
   * rather than at the moment the page was read, which overstates its freshness.
   */
  query?: string | null;
  position?: number | null;
  adHeadline?: string | null;
  checkUrl?: string | null;
  observedAt?: Date | null;
}

/**
 * Why a provider came back with what it came back with.
 *
 * An adapter used to answer with an array, and every failure -- no credential, a
 * 401, a timeout, a task still sitting in the provider's queue, an exhausted budget
 * -- answered with an empty one. The orchestrator counted that as "the provider was
 * asked and found nothing", which is the exact lie the job outcome field was built
 * to stop, reintroduced one layer further down. A provider that could not answer
 * must not be indistinguishable from a market with no businesses in it.
 */
export type DiscoveryStatus =
  /** The provider answered and the answer contained businesses. */
  | 'OK'
  /** The provider answered, and this market genuinely has nothing usable in it. */
  | 'ZERO_RESULTS'
  /** No credential, or the adapter is switched off. */
  | 'NOT_CONFIGURED'
  /** Credentialed, but the source governance review is not signed. */
  | 'GOVERNANCE_BLOCKED'
  /** The provider rejected the credential: 401 or 403. Retrying only spends money. */
  | 'CREDENTIALS_INVALID'
  /** The provider asked us to slow down. */
  | 'RATE_LIMITED'
  /** The provider did not answer in time. */
  | 'TIMEOUT'
  /** The provider is failing: 5xx, or the socket went away. */
  | 'OUTAGE'
  /** Our own ceiling stopped the call before the money was spent. */
  | 'BUDGET_EXHAUSTED'
  /** An asynchronous task was accepted and its results are not ready yet. */
  | 'PENDING'
  /** The provider answered with something this adapter cannot read. */
  | 'MALFORMED';

/** The statuses that mean the provider actually answered the question we asked. */
export function providerAnswered(status: DiscoveryStatus): boolean {
  return status === 'OK' || status === 'ZERO_RESULTS';
}

/**
 * What one provider call produced.
 *
 * The counters are separate on purpose. "The provider returned 50 rows" is not
 * "50 new businesses discovered": some rows identify nothing, some are the same
 * company twice, and some are companies we already hold. An operator needs those
 * numbers apart, or the Mining page is arithmetic nobody can check.
 */
export interface DiscoveryResult {
  status: DiscoveryStatus;
  businesses: DiscoveredBusiness[];
  /** Rows the provider returned, before any filtering of ours. */
  providerRows: number;
  /** Rows dropped because nothing in them identified a business. */
  rejectedRows: number;
  /** Rows collapsed into another row for the same company. */
  duplicateRows: number;
  /** The provider's own id for an asynchronous task, when there is one. */
  providerTaskId?: string | null;
  /** Operator-readable, and safe to render. Never a credential or a raw response. */
  reason?: string;
  costUsd?: number | null;
}

/**
 * The contract every discovery provider must satisfy. Implementations live behind
 * this so the orchestrator never learns a provider's shape, and so a provider can
 * be swapped after benchmarking without touching inventory logic.
 */
export interface DiscoveryAdapter {
  readonly name: string;
  readonly requiresCredential: boolean;
  readonly governanceReviewed: boolean;
  isConfigured(): boolean;
  discover(request: DiscoveryQuery): Promise<DiscoveryResult>;
  /**
   * Collects a task this provider accepted earlier.
   *
   * Optional, because a provider that answers synchronously has nothing to collect.
   * A provider that queues work must implement it, or a search we paid for is lost
   * the moment the worker that submitted it stops.
   */
  collect?(providerTaskId: string, request: DiscoveryQuery): Promise<DiscoveryResult>;
}

/** A result for a call that never reached the provider, or that it refused. */
export function refusedDiscovery(
  status: DiscoveryStatus, reason: string,
): DiscoveryResult {
  return { status, businesses: [], providerRows: 0, rejectedRows: 0, duplicateRows: 0, reason };
}

const discoveryAdapters: DiscoveryAdapter[] = [];

/**
 * One adapter per provider name, replaced rather than appended.
 *
 * This used to push unconditionally, so registering the same provider twice gave
 * the orchestrator two of it -- and it loops over the registry, so every market
 * search would have queried DataForSEO twice and been billed twice, while the
 * funnel counters reported the duplicate rows as duplicates and hid the fact. Today
 * each process registers once at boot, so it was latent; the shape of the mistake
 * is a second call added later by somebody with no reason to suspect it matters.
 *
 * The later registration wins, because the only reason to register again is a
 * configuration that has changed.
 */
export function registerDiscoveryAdapter(adapter: DiscoveryAdapter): void {
  const existing = discoveryAdapters.findIndex((held) => held.name === adapter.name);
  if (existing >= 0) discoveryAdapters[existing] = adapter;
  else discoveryAdapters.push(adapter);
}

/**
 * Removes every registered adapter.
 *
 * Registration is module-level, so a test that registers a fake provider would
 * otherwise leak it into every test that runs afterwards -- and the tests that
 * matter most here are the ones asserting what happens when there is no provider.
 * Exported for that reason and no other; nothing in the product calls it.
 */
export function clearDiscoveryAdapters(): void {
  discoveryAdapters.length = 0;
}

export function availableDiscoveryAdapters(): DiscoveryAdapter[] {
  // Both conditions are required: a configured adapter whose source has not passed
  // governance review must not run, and a reviewed adapter with no credential cannot.
  return discoveryAdapters.filter((adapter) => adapter.governanceReviewed && adapter.isConfigured());
}

// ------------------------------------------------------------------ refresh --

/**
 * TTLs from the data contract's §14 matrix. Configurable, not hard-coded policy.
 *
 * This was exported and read by nothing. The three 48-hour ad entries were written
 * for a step that did not exist: no path in the product turned an observed paid
 * result into advertiser evidence, so the freshness rule for ad evidence governed
 * evidence that was never written. Read now, by the promotion below.
 *
 * Two keys here were an older vocabulary -- `emergency_service_claim` and
 * `website_cta` -- for claims the recognisers now write as `emergency_24_7_service`
 * and `online_quote_booking`. Both names are kept: the recognisers carry their own
 * TTL and agree with these numbers, and a demo fixture still writes the old key, so
 * dropping them would silently change how long that evidence lasts.
 */
export const EVIDENCE_TTL_HOURS: Record<string, number> = {
  active_google_search_ad: 48,
  active_local_service_ad: 48,
  active_hail_search_ad: 48,
  active_meta_ad: 48,
  ad_transparency: 24 * 7,
  website_offer: 24 * 7,
  website_cta: 24 * 14,
  online_quote_booking: 24 * 14,
  website_technology: 24 * 14,
  emergency_service_claim: 24 * 30,
  emergency_24_7_service: 24 * 30,
  decision_maker_identity: 24 * 30,
  location: 24 * 30,
};

/** The §14 window for a claim, or the conservative default when it names none. */
export function evidenceTtlHours(claimKey: string): number {
  return EVIDENCE_TTL_HOURS[claimKey] ?? 24 * 7;
}

/**
 * Which advertiser claim an observed placement proves, if any.
 *
 * Read from the provider's own result type rather than the stored projection,
 * because the projection collapses `SHOPPING_OR_IRRELEVANT_PAID` into `paid_search`
 * -- and a shopping ad is not evidence that a contractor runs search ads.
 *
 * A sponsored local pack result is paid and is deliberately absent: it is not the
 * text-ad claim and it is not a Local Services Ad, and there is no third claim to
 * put it under. It stays an observation.
 */
export function promotedAdClaimKeys(): string[] {
  return [...new Set([
    ...Object.values(AD_CLAIM_BY_RESULT_TYPE).map((entry) => entry.claimKey),
    HAIL_AD_CLAIM,
  ])];
}

/**
 * A paid ad whose own headline names hail or storm work.
 *
 * pdr-hail triggers on `active_hail_ads`, which nothing declared or produced. This
 * is narrower than `active_google_search_ad` and it is evidenced rather than
 * inferred: the headline is a field the provider gave us and we already store it, so
 * the claim is "their ad said hail", not "they are a hail company because of their
 * trade".
 */
const HAIL_AD_CLAIM = 'active_hail_search_ad';
const HAIL_AD_HEADLINE = /\bhail\b|\bstorm damage\b|\bwind (?:and|&) hail\b/i;

const AD_CLAIM_BY_RESULT_TYPE: Record<string, { claimKey: string; what: string }> = {
  PAID_SEARCH_TEXT: { claimKey: 'active_google_search_ad', what: 'A paid Google search result' },
  paid_search: { claimKey: 'active_google_search_ad', what: 'A paid Google search result' },
  LOCAL_SERVICES_AD: { claimKey: 'active_local_service_ad', what: 'A Google Local Services ad' },
  local_service_ad: { claimKey: 'active_local_service_ad', what: 'A Google Local Services ad' },
};

export interface RefreshPlan {
  marketId: string | null;
  accountsInScope: number;
  staleAccounts: number;
  queued: number;
  skippedSuppressed: number;
  reason: string;
}

/**
 * Selects which Accounts in a market need re-research and queues them.
 * Suppressed Accounts are never refreshed: research on a company we may not contact
 * is wasted work and a privacy liability.
 */
export async function planMarketRefresh(input: {
  marketId?: string | null;
  verticalProfileId?: string | null;
  geographyType?: string | null;
  geographyValue?: string | null;
  limit?: number;
  requestedBy?: string | null;
}): Promise<RefreshPlan> {
  const conditions: string[] = ['not a.is_suppressed'];
  const values: unknown[] = [];
  const push = (value: unknown): string => { values.push(value); return `$${values.length}`; };

  if (input.marketId) {
    conditions.push(
      `a.account_id in (select account_id from account_market_membership where market_id = ${push(input.marketId)})`,
    );
  }
  if (input.verticalProfileId) {
    conditions.push(`a.primary_vertical_profile_id = ${push(input.verticalProfileId)}`);
  }
  if (input.geographyValue) {
    if (input.geographyType === 'zip_zcta') {
      conditions.push(`exists (select 1 from locations l where l.account_id = a.account_id and l.postal_code = ${push(input.geographyValue)})`);
    } else if (input.geographyType === 'city') {
      conditions.push(`exists (select 1 from locations l where l.account_id = a.account_id and lower(l.city) = lower(${push(input.geographyValue)}))`);
    } else if (input.geographyType === 'state') {
      conditions.push(`exists (select 1 from locations l where l.account_id = a.account_id and l.state_region = upper(${push(input.geographyValue)}))`);
    }
  }

  const scopeSql = conditions.join(' and ');

  const { rows: counts } = await query<{ in_scope: number; suppressed: number }>(
    `select count(*)::int as in_scope,
            (select count(*)::int from accounts s where s.is_suppressed) as suppressed
       from accounts a where ${scopeSql}`,
    values,
  );

  // Stale = never researched, or past its freshness window.
  const { rows: stale } = await query<{ account_id: string }>(
    `select a.account_id from accounts a
      where ${scopeSql}
        and (a.research_fresh_until is null or a.research_fresh_until <= now())
      order by
        case a.manual_tier when 'A' then 1 when 'B' then 2 when 'C' then 3 else 4 end,
        a.last_researched_at asc nulls first
      limit ${push(input.limit ?? 50)}`,
    values,
  );

  let queued = 0;
  for (const row of stale) {
    const result = await enqueueAccountResearch(row.account_id, input.requestedBy ?? null, 'scheduled_refresh');
    if (result.created) queued += 1;
  }

  return {
    marketId: input.marketId ?? null,
    accountsInScope: counts[0]?.in_scope ?? 0,
    staleAccounts: stale.length,
    queued,
    skippedSuppressed: counts[0]?.suppressed ?? 0,
    reason: queued === 0 && stale.length === 0 ? 'all in-scope research is still fresh' : 'refresh queued',
  };
}

/** Marks evidence past its TTL as stale so the UI stops presenting it as current. */
export async function expireStaleEvidence(): Promise<number> {
  const { rowCount } = await query(
    `update evidence_records set freshness = 'stale'
      where freshness <> 'stale'
        and expires_at is not null and expires_at <= now()`,
  );
  return rowCount ?? 0;
}

/** Recomputes the freshness projection on accounts. */
export async function refreshAccountFreshness(): Promise<number> {
  const { rowCount } = await query(
    `update accounts a set research_completeness = case
        when a.last_researched_at is null then 'THIN'
        when a.research_fresh_until is not null and a.research_fresh_until <= now() then 'STALE'
        else a.research_completeness end
      where a.last_researched_at is null
         or (a.research_fresh_until is not null and a.research_fresh_until <= now())`,
  );
  return rowCount ?? 0;
}

// --------------------------------------------------------------- job handler --

registerHandler('market_mine', async (job: JobRecord): Promise<Record<string, unknown>> => {
  const payload = job.payload ?? {};
  const adapters = availableDiscoveryAdapters();

  const plan = await planMarketRefresh({
    marketId: job.market_id ?? (payload['market_id'] as string | null) ?? null,
    verticalProfileId: (payload['vertical_profile_id'] as string | null) ?? null,
    geographyType: (payload['geography_type'] as string | null) ?? null,
    geographyValue: (payload['geography_value'] as string | null) ?? null,
    requestedBy: job.requested_by,
  });

  const expired = await expireStaleEvidence();
  await refreshAccountFreshness();

  const funnel: IngestionCounts = {
    candidates: 0, rejected: 0, matchedExisting: 0, created: 0, researchQueued: 0,
    adEvidenceWritten: 0, excludedByVertical: 0, exclusionReasons: [],
  };
  let providerRows = 0;
  let providerRejected = 0;
  let providerDuplicates = 0;
  let costUsd = 0;
  let costKnown = false;
  const statuses: DiscoveryStatus[] = [];
  const pendingTaskIds: string[] = [];
  const discoveryNotes: string[] = [];
  /** One row per search actually attempted, so N outcomes stay N outcomes. */
  const perSearch: {
    index: number; term: string; keyword: string; fingerprint: string;
    status: DiscoveryStatus; providerRows: number; usableRows: number;
    duplicateRows: number; rejectedRows: number; costUsd: number | null;
    providerTaskId: string | null; created: number; matchedExisting: number;
  }[] = [];

  // Before any provider is asked: does another run fit under today's ceiling?
  // Refused before the money is spent, never after.
  const { spendPosition, budgetRefusalReason } = await import('../miner/spend.js');
  const spend = await spendPosition();
  const budgetExhausted = adapters.length > 0 && spend.wouldExceed;

  if (adapters.length === 0) {
    discoveryNotes.push(
      'No discovery adapter is available: new-business discovery needs an approved search '
      + 'provider and a signed source-governance review (blocker B-3). Existing inventory '
      + 'was refreshed instead.',
    );
  }

  const request: DiscoveryQuery = {
    verticalProfileId: (payload['vertical_profile_id'] as string | null) ?? null,
    geographyType: (payload['geography_type'] as string | null) ?? null,
    geographyValue: (payload['geography_value'] as string | null) ?? null,
    miningMode: (payload['mining_mode'] as string) ?? 'advertiser_first',
    // One unless an operator asks for more.
    //
    // This was 25, and it meant "plan 25, buy 1". Making the count real without
    // moving the default would have turned every scheduled market refresh into
    // twenty-five paid searches while nobody was watching -- a spend decision
    // dressed up as a bug fix. Raising it is an operator's call, per run.
    queryBudget: Number(payload['query_budget'] ?? 1),
  };
  // What this run will buy, decided before any of it is bought.
  //
  // `query_budget` used to mean "plan this many and run the first one", so a market
  // was judged on a single question whatever the budget said. A count is now a count
  // of independent searches, each with its own words, provider task, fingerprint,
  // accounting and outcome.
  //
  // The default is one. Making N real without moving the default would have turned
  // every scheduled market refresh into twenty-five paid searches overnight, which
  // is a spend decision rather than a bug fix.
  const { planDiscoverySearches } = await import('../miner/searchPlan.js');
  const searchPlan = await planDiscoverySearches({
    verticalProfileId: request.verticalProfileId,
    geographyType: request.geographyType,
    geographyValue: request.geographyValue,
    miningMode: request.miningMode,
    count: request.queryBudget,
    marketId: job.market_id,
  });
  if (searchPlan.limitedBy === 'TAXONOMY') {
    discoveryNotes.push(
      `${request.queryBudget} search(es) were asked for and the `
      + `${request.verticalProfileId} profile defines ${searchPlan.available}, so `
      + `${searchPlan.available} ran. Nothing was invented to fill the gap.`);
  }

  // The ceiling stops *buying*, not collecting.
  //
  // This used to skip the whole loop, so a run that hit the ceiling also refused to
  // go back for tasks it had already paid for. The provider charges on submission
  // and answers for free, so the money was gone, the answer was sitting at the
  // provider, and we declined to fetch it -- and because the collection counter only
  // advances when we try, a market could sit like that until the provider expired
  // the task and the search was simply lost. The budget belongs on the branch that
  // spends, which is the one below that calls discover().
  // A plan that could not be built still has to produce an answer per adapter.
  //
  // With no vertical there are no terms, so there is nothing to buy -- and asking a
  // provider for "businesses in 32095" with no category is not a search worth paying
  // for. But silently running zero searches leaves no status at all, and an empty
  // list of statuses makes every `every()` below vacuously true: a run that never
  // asked anybody anything reported itself as waiting on the provider. The refusal
  // is recorded as the outcome of the attempt it prevented.
  const attempts: (typeof searchPlan.searches[number] | null)[] =
    searchPlan.searches.length > 0 ? searchPlan.searches : [null];

  for (const adapter of adapters) {
   for (const planned of attempts) {
    if (!planned) {
      const reason = searchPlan.refusal?.reason
        ?? 'No searches could be planned for this market.';
      statuses.push('NOT_CONFIGURED');
      discoveryNotes.push(`${adapter.name}: ${reason}`);
      continue;
    }
    const fingerprint = planned.fingerprint;
    const searchRequest: DiscoveryQuery = {
      ...request,
      search: {
        keyword: planned.keyword, locationName: planned.locationName,
        term: planned.term, fingerprint, index: planned.index,
      },
    };
    let result: DiscoveryResult;
    // Set when a task's results are in hand but not yet in inventory.
    let collected: string | null = null;
    try {
      // Collect before submitting.
      //
      // A Standard-mode search is accepted, charged for, and answered later. If a
      // previous run submitted one for this same request -- and then the worker was
      // restarted, or the task was simply slower than the poll -- going back for it
      // is both cheaper and more honest than buying the same market twice.
      const outstanding = await openProviderTask(adapter.name, fingerprint);
      if (outstanding && adapter.collect) {
        const attempts = await recordCollectionAttempt(outstanding.provider_task_id);
        result = await adapter.collect(outstanding.provider_native_id, searchRequest);

        if (result.status === 'PENDING') {
          if (attempts >= MAX_TASK_COLLECTIONS) {
            // A task the provider will never finish must not become a job that polls
            // for ever. It is abandoned with a reason, so the operator can see that a
            // search was paid for and never delivered.
            await closeProviderTask({
              providerTaskId: outstanding.provider_task_id, status: 'ABANDONED',
              errorCode: 'NEVER_DELIVERED' });
            result = refusedDiscovery('TIMEOUT',
              `The provider accepted this search ${attempts} collection attempts ago and has `
              + 'never delivered it. It has been given up on rather than polled for ever.');
          }
        } else if (providerAnswered(result.status)) {
          // Closed after ingestion, not here.
          //
          // Marking the task collected first opens a window: a worker that dies
          // between the two loses the results and leaves a COLLECTED row nothing
          // will ever ask for again -- a search paid for, delivered, and thrown
          // away. Leaving it PENDING means a crash costs one more collection call
          // and nothing else, because ingestion resolves to the same Accounts.
          collected = outstanding.provider_task_id;
        } else {
          await closeProviderTask({
            providerTaskId: outstanding.provider_task_id, status: 'FAILED',
            errorCode: result.status });
        }
      } else if (outstanding) {
        // The provider owes us a result and this adapter cannot go back for it. Say
        // so rather than submitting a second paid search of the same market.
        result = refusedDiscovery('PENDING',
          `${adapter.name} accepted this search earlier and cannot be asked for it again, `
          + 'so no second search was submitted.');
      } else if (budgetExhausted) {
        // Nothing outstanding to collect and no room to buy: this is the one place
        // the ceiling refuses work, and it refuses it before the money is spent.
        result = refusedDiscovery('BUDGET_EXHAUSTED', budgetRefusalReason(spend));
      } else {
        // What the provider has cost today is read from provider_usage, and only
        // adapters write to it. So the daily ceiling protects us from exactly the
        // providers that remember to record their own spending, and not at all from
        // one that forgets -- which is the failure mode of the next adapter somebody
        // writes, not of the one that exists. The counter below closes that: the
        // orchestrator knows a call was made and what the result says it cost, and
        // records it when the adapter did not.
        const before = await providerUsageRows(adapter.name);
        result = await adapter.discover(searchRequest);
        await recordUnbilledRun(adapter.name, before, result, job.job_id);

        // A task the provider accepted is remembered before this job ends. Without
        // this row the id dies with the process and the search is bought again.
        if (result.status === 'PENDING' && result.providerTaskId) {
          await recordProviderTask({
            provider: adapter.name, providerNativeId: result.providerTaskId,
            fingerprint, jobId: job.job_id,
            request: searchRequest as unknown as Record<string, unknown>,
          });
        }
      }
    } catch (error) {
      // A provider that threw is not a market with no businesses in it. An adapter
      // is supposed to report its own failures rather than raise, so a throw is a
      // bug in the adapter, and it is recorded as an outage rather than swallowed.
      result = refusedDiscovery('OUTAGE',
        `${adapter.name} raised instead of reporting: ${(error as Error).message.slice(0, 200)}`);
    }

    statuses.push(result.status);
    providerRows += result.providerRows;
    providerRejected += result.rejectedRows;
    providerDuplicates += result.duplicateRows;
    if (typeof result.costUsd === 'number') { costUsd += result.costUsd; costKnown = true; }
    if (result.providerTaskId) pendingTaskIds.push(result.providerTaskId);
    if (result.reason) {
      discoveryNotes.push(searchPlan.searches.length > 1
        ? `${adapter.name} "${planned.term}": ${result.reason}`
        : `${adapter.name}: ${result.reason}`);
    }
    perSearch.push({
      index: planned.index, term: planned.term, keyword: planned.keyword,
      fingerprint, status: result.status, providerRows: result.providerRows,
      usableRows: result.businesses.length, duplicateRows: result.duplicateRows,
      rejectedRows: result.rejectedRows, costUsd: result.costUsd ?? null,
      providerTaskId: result.providerTaskId ?? null,
      created: 0, matchedExisting: 0,
    });

    if (result.businesses.length > 0) {
      const counts = await ingestDiscoveries(result.businesses, adapter.name, job);
      funnel.candidates += counts.candidates;
      funnel.rejected += counts.rejected;
      funnel.matchedExisting += counts.matchedExisting;
      funnel.created += counts.created;
      funnel.researchQueued += counts.researchQueued;
      funnel.adEvidenceWritten += counts.adEvidenceWritten;
      funnel.excludedByVertical += counts.excludedByVertical;
      funnel.exclusionReasons.push(...counts.exclusionReasons);
      const record = perSearch[perSearch.length - 1]!;
      record.created = counts.created;
      record.matchedExisting = counts.matchedExisting;
    }

    // The task is only finished with once its results are in inventory. A crash
    // before this line costs one more collection call; a crash after it costs
    // nothing, because ingestion resolves to the same Accounts either way.
    if (collected) {
      await closeProviderTask({
        providerTaskId: collected, status: 'COLLECTED', costUsd: result.costUsd ?? null });
    }
   }
  }

  const answered = statuses.filter(providerAnswered).length;
  const failed = statuses.length - answered;

  /**
   * What actually happened, in the operator's terms.
   *
   * "Succeeded" answered whether the handler returned. A person who typed a ZIP into
   * Find Prospects and read "Succeeded -- 0 found" concluded there are no businesses
   * in that ZIP. There was no provider to ask.
   *
   * The order matters. A provider that could not answer is never reported as a
   * market with nothing in it, and a search that returned businesses we already hold
   * is a completed search, not a zero-result one: twelve companies matched is twelve
   * companies found.
   */
  const outcome: JobOutcome =
    adapters.length === 0 ? 'DISCOVERY_BLOCKED'
    // Nothing was attempted, so nothing can be concluded. Guarded explicitly rather
    // than left to the branches below, where `[].every(...)` is true and would
    // report a run that asked nobody anything as one waiting for an answer.
    : statuses.length === 0 ? 'DISCOVERY_BLOCKED'
    // Our own ceiling stopping the call is a blocked search, not an empty market --
    // but only when it actually stopped one. A run that collected a task bought
    // earlier under the ceiling did search this market, and reporting it as blocked
    // would hide businesses that are now in inventory.
    : budgetExhausted && answered === 0 ? 'DISCOVERY_BLOCKED'
    : statuses.every((status) => status === 'PENDING') ? 'PROVIDER_PENDING'
    : answered === 0 ? 'PROVIDER_UNAVAILABLE'
    : failed > 0 ? 'PARTIAL'
    : providerRows > 0 ? 'COMPLETED'
    : 'ZERO_RESULTS';

  const failureSummary = discoveryNotes.length > 0 ? ` ${discoveryNotes.join('; ')}` : '';
  const outcomeReason =
    outcome === 'DISCOVERY_BLOCKED' && budgetExhausted
      ? budgetRefusalReason(spend)
    : outcome === 'DISCOVERY_BLOCKED'
      ? 'No search provider is configured, so no new business could be found. '
        + `${plan.queued} existing account(s) were queued for refresh.`
    : outcome === 'PROVIDER_PENDING'
      ? `The provider accepted the search and its results are not ready yet.${failureSummary}`
    : outcome === 'PROVIDER_UNAVAILABLE'
      ? `No provider answered, so this market was not searched. It is not known whether `
        + `it has businesses in it.${failureSummary}`
    : outcome === 'PARTIAL'
      ? `${answered} provider(s) answered and ${failed} could not, so this is part of the `
        + `market, not all of it.${failureSummary}`
    : outcome === 'ZERO_RESULTS'
      ? `${answered} provider(s) searched this market and returned nothing usable.`
    : `${providerRows} provider row(s): ${providerDuplicates} duplicate(s), `
      + `${providerRejected + funnel.rejected} unusable, ${funnel.matchedExisting} already `
      + `in inventory, ${funnel.created} new business(es) added.`;

  if (job.market_id) {
    await query(
      `update saved_markets set last_refresh_at = now(),
              last_mined_at = case when $2 > 0 then now() else last_mined_at end,
              status = 'ACTIVE'
        where market_id = $1`,
      [job.market_id, funnel.created],
    );
    // Attempted and succeeded are different facts, and the scheduler backs off on
    // the difference. A market searched every hour and failing every hour has a
    // recent attempt and no coverage at all.
    const { recordMarketOutcome } = await import('./marketScheduler.js');
    await recordMarketOutcome({
      marketId: job.market_id, outcome, outcomeReason,
    });
  }

  return {
    outcome,
    outcomeReason,
    // The numbers a mining row has to keep apart, from the provider's answer through
    // to what ended up in inventory.
    providerRows,
    providerDuplicates,
    rejectedRows: providerRejected + funnel.rejected,
    matchedExisting: funnel.matchedExisting,
    discoveredNew: funnel.created,
    researchQueued: funnel.researchQueued,
    // What advertiser_first mining set out to establish. Reported on the run because
    // "we found twenty companies" and "we can show that six of them are advertising"
    // are different results, and only the second is the reason to run this strategy.
    adEvidenceWritten: funnel.adEvidenceWritten,
    refreshQueued: plan.queued,
    accountsInScope: plan.accountsInScope,
    staleAccounts: plan.staleAccounts,
    evidenceExpired: expired,
    discovered: funnel.created,
    discoveryAdapters: adapters.map((adapter) => adapter.name),
    discoveryAvailable: adapters.length > 0,
    providerStatuses: statuses,
    providersQueried: answered,
    providersFailed: failed,
    providerTaskIds: pendingTaskIds,
    excludedByVertical: funnel.excludedByVertical,
    exclusionReasons: funnel.exclusionReasons.slice(0, 20),
    // What each search actually did. An aggregate cannot say that four of five
    // searches found nothing and the fifth found everything, and that difference is
    // the whole reason for running more than one.
    searchesPlanned: searchPlan.searches.length,
    searchesRequested: searchPlan.requested,
    searchTermsAvailable: searchPlan.available,
    perSearch,
    costUsd: costKnown ? Number(costUsd.toFixed(4)) : null,
    spentTodayUsd: spend.spentTodayUsd,
    dailyBudgetUsd: spend.budgetUsd || null,
    budgetExhausted,
    notes: discoveryNotes,
  };
});

/**
 * A refresh of what we already hold. It does not look for new businesses and does
 * not claim to: the outcome says REFRESH_ONLY so a mining row cannot be read as
 * external coverage of a market.
 */
registerHandler('zip_research', async (job: JobRecord) => {
  const payload = job.payload ?? {};
  const plan = await planMarketRefresh({
    verticalProfileId: (payload['vertical_profile_id'] as string | null) ?? null,
    geographyType: (payload['geography_type'] as string | null) ?? null,
    geographyValue: (payload['geography_value'] as string | null) ?? null,
    requestedBy: job.requested_by,
  });
  return {
    ...plan,
    scope: 'REFRESH_EXISTING',
    discoveredNew: 0,
    refreshQueued: plan.queued,
    outcome: plan.queued > 0 ? 'COMPLETED' : 'NOTHING_TO_DO',
    outcomeReason: plan.queued > 0
      ? `${plan.queued} existing account(s) queued for re-research. This job does not `
        + 'look for new businesses.'
      : 'Every account already in this market has fresh research. No new businesses '
        + 'were looked for: this job only refreshes what we already hold.',
  };
});

/**
 * What ingestion did with what the provider returned.
 *
 * "Provider returned 50 rows" is not "50 new businesses discovered". Five identify
 * nothing, eight are the same company twice, twelve are companies we already hold,
 * and twenty-five are new. Those are four different numbers and an operator needs
 * them apart.
 */
export interface IngestionCounts {
  /** Businesses handed to ingestion, after the adapter's own dedupe. */
  candidates: number;
  /** Dropped here because nothing in the row identified a business. */
  rejected: number;
  /** Resolved to an Account we already had. */
  matchedExisting: number;
  /** New canonical Accounts. */
  created: number;
  /** Newly created Accounts queued for research. */
  researchQueued: number;
  /**
   * Observed paid placements promoted to advertiser evidence. Counted separately
   * from the observations: six sightings of one advertiser are six observations,
   * and each is its own dated piece of evidence for the claim.
   */
  adEvidenceWritten: number;
  /**
   * Rows that named a real business the vertical is not looking for -- a supply
   * house, a trade school, a manufacturer. Counted apart from `rejected` because
   * they are different findings: one is a row with nothing in it, the other is a
   * company we deliberately did not want.
   */
  excludedByVertical: number;
  /** Which company matched which exclusion, so the filter can be checked. */
  exclusionReasons: string[];
}

/**
 * A row has to identify a company before it can become one.
 *
 * A name alone is a string somebody could have typed; the rep who opens it finds a
 * company with no way to reach it and no way to tell whether it exists. A domain or
 * a phone is the least that makes a row resolvable.
 */
export function isUsableBusiness(business: DiscoveredBusiness): boolean {
  const name = (business.name ?? '').trim();
  if (name.length < 2) return false;
  const hasDomain = Boolean((business.website ?? '').trim());
  const hasPhone = Boolean((business.phone ?? '').trim());
  return hasDomain || hasPhone;
}

/**
 * The vocabulary an observation is stored in.
 *
 * Adapters normalize a provider's own item types into their own words, and the
 * column has a check constraint with a different set. Nothing matched: every value
 * the DataForSEO adapter produces was rejected by the database, so the first row of
 * the first real discovery would have thrown, failed the job, retried, and failed
 * again -- and none of it showed while no provider was configured, because a fixture
 * adapter that sets no result type writes a null the column accepts.
 *
 * An adapter's word we do not recognise is stored as null rather than guessed into
 * one we do: an unclassified observation is honest, a mislabelled paid placement is
 * manufactured ad evidence.
 */
const OBSERVATION_RESULT_TYPE: Record<string, string> = {
  PAID_SEARCH_TEXT: 'paid_search',
  PAID_LOCAL: 'sponsored_local',
  LOCAL_SERVICES_AD: 'local_service_ad',
  SHOPPING_OR_IRRELEVANT_PAID: 'paid_search',
  LOCAL_ORGANIC: 'local_result',
  MAPS_LOCAL: 'local_result',
  ORGANIC: 'organic',
  KNOWLEDGE_OR_ENTITY: 'directory_result',
  // Already in the stored vocabulary: an adapter may speak it directly.
  paid_search: 'paid_search',
  local_service_ad: 'local_service_ad',
  sponsored_local: 'sponsored_local',
  organic: 'organic',
  local_result: 'local_result',
  transparency_ad: 'transparency_ad',
  directory_result: 'directory_result',
};

export function storedResultType(value: string | null | undefined): string | null {
  if (!value) return null;
  return OBSERVATION_RESULT_TYPE[value] ?? null;
}

const { assumedRunCostUsd } = await import('../miner/spend.js');

/** How many usage rows this provider has written today. */
async function providerUsageRows(provider: string): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from provider_usage
      where provider = $1 and requested_at >= date_trunc('day', now())`, [provider]);
  return rows[0]?.n ?? 0;
}

/**
 * The backstop for an adapter that spends money and does not say so.
 *
 * Recording usage is the adapter's job, and the DataForSEO one does it properly with
 * the operation and the error code, which is detail the orchestrator cannot supply.
 * But the daily ceiling reads provider_usage, so an adapter that skips it is an
 * adapter with no ceiling at all -- and nothing would show that until an invoice
 * arrived. Here the orchestrator knows a call happened and what the result claims it
 * cost, so it writes the row the adapter did not.
 *
 * Only when the count did not move: a well-behaved adapter must not be billed twice
 * for one call.
 */
async function recordUnbilledRun(
  provider: string, rowsBefore: number, result: DiscoveryResult, jobId: string,
): Promise<void> {
  const rowsAfter = await providerUsageRows(provider);
  if (rowsAfter > rowsBefore) return;

  const answered = providerAnswered(result.status);
  await query(
    `insert into provider_usage (provider, operation, mining_job_id, requested_at,
                                 completed_at, units, estimated_cost_usd, actual_cost_usd,
                                 status, error_code)
     values ($1, 'serp.discover', null, now(), now(), 1, $2, $3, $4, $5)`,
    [provider,
     // With no cost from the adapter, the assumed worst case is used: a ceiling that
     // counts an unknown call as free is not a ceiling.
     result.costUsd ?? assumedRunCostUsd(),
     result.costUsd ?? null,
     answered ? 'OK' : 'FAILED',
     answered ? null : `UNBILLED_${result.status}`],
  );
  void jobId;
}

/** Resolves discovered businesses into canonical Accounts. Dedupe is not optional. */
async function ingestDiscoveries(
  businesses: DiscoveredBusiness[], providerName: string, job: JobRecord,
): Promise<IngestionCounts> {
  const { upsertAccount } = await import('../domain/accounts.js');
  const counts: IngestionCounts = {
    candidates: businesses.length, rejected: 0, matchedExisting: 0, created: 0,
    researchQueued: 0, adEvidenceWritten: 0, excludedByVertical: 0, exclusionReasons: [],
  };
  const createdAccountIds: string[] = [];

  // The geography the search was scoped to. A business returned by a search for one
  // ZIP was found in that ZIP -- that is a fact about how we found it, not a claim
  // about its mailing address -- so it is recorded as a service area rather than as a
  // street address, and only when the provider gave us nothing better. Without it a
  // discovered business is invisible to the very search that discovered it.
  const searchedGeographyType = (job.payload['geography_type'] as string | null) ?? null;
  const searchedGeography = (job.payload['geography_value'] as string | null) ?? null;

  // What this vertical is not. Every profile has declared these since it was
  // written -- "roofing supply", "HVAC school", "dental lab only" -- and nothing
  // read them, so a roofing search put supply houses and training providers in
  // front of a rep. Applied to the answer rather than stuffed into the query: a
  // negative term in the search changes what the engine ranks, which is a different
  // and worse thing than filtering what comes back.
  const { negativeTermsFor, matchesNegativeTerm } = await import('../miner/searchTaxonomy.js');
  const verticalProfileId = (job.payload['vertical_profile_id'] as string | null) ?? null;
  const negativeTerms = verticalProfileId ? await negativeTermsFor(verticalProfileId) : [];

  for (const business of businesses) {
    if (!isUsableBusiness(business)) { counts.rejected += 1; continue; }

    const excluded = negativeTerms.length > 0
      ? matchesNegativeTerm(business.name, business.website ?? null, negativeTerms)
      : null;
    if (excluded) {
      counts.rejected += 1;
      counts.excludedByVertical += 1;
      counts.exclusionReasons.push(`${business.name}: "${excluded}"`);
      continue;
    }

    await withTransaction(async (client) => {
      const result = await upsertAccount(
        client,
        {
          canonicalName: business.name,
          website: business.website ?? null,
          phone: business.phone ?? null,
          city: business.city ?? (searchedGeographyType === 'city' ? searchedGeography : null),
          state: business.state ?? (searchedGeographyType === 'state' ? searchedGeography : null),
          postalCode: business.postalCode
            ?? (searchedGeographyType === 'zip_zcta' ? searchedGeography : null),
          verticalProfileId: (job.payload['vertical_profile_id'] as string | null) ?? null,
          sourceIdentity: business.providerNativeId
            ? {
                provider: providerName, entityType: 'business',
                nativeId: business.providerNativeId, retentionClass: 'identifier_only',
              }
            : null,
        },
        { discoverySource: `market_miner:${providerName}`, marketId: job.market_id },
      );
      if (result.created) { counts.created += 1; createdAccountIds.push(result.accountId); }
      else counts.matchedExisting += 1;

      // Every discovery is recorded as an observation, separate from durable evidence:
      // six sightings of one advertiser stay six observations of one Account.
      await client.query(
        `insert into search_observations (mining_job_id, provider, source_type, observed_name,
                                          observed_domain, observed_phone, observed_location,
                                          result_type, advertised_service, landing_url,
                                          retention_class, account_id, job_id,
                                          query, position, ad_headline, provider_native_id,
                                          observed_at)
         values (null, $1, 'discovery', $2, $3, $4, $5, $6, $7, $8, 'transient', $9, $10,
                 $11, $12, $13, $14, coalesce($15::timestamptz, now()))`,
        [
          providerName, business.name, business.website ?? null, business.phone ?? null,
          [business.city, business.state].filter(Boolean).join(', ') || null,
          storedResultType(business.resultType), business.advertisedService ?? null,
          business.landingUrl ?? null, result.accountId,
          // An observation nobody can trace back to the run that made it cannot be
          // audited, and cannot be attributed a cost.
          job.job_id,
          business.query ?? null, business.position ?? null, business.adHeadline ?? null,
          business.providerNativeId ?? null,
          // The provider's own timestamp when it gave us one. A task submitted on
          // Monday and collected on Thursday was read on Monday, and saying
          // otherwise makes three-day-old ad evidence look like today's.
          business.observedAt ?? null,
        ],
      );

      // An observed paid placement is advertiser evidence, and nothing wrote it.
      //
      // This is what advertiser_first mining exists to find: the strategy selects
      // companies *because* they are advertising. The observation above recorded
      // that we saw a paid result, and the record a rep reads -- and the Module 4C
      // rule worth +4, which every vertical profile declares as
      // `evidence_claim_key: active_google_search_ad` -- both read
      // `evidence_records`, which nothing populated for these claims. So the panel
      // said "nobody has looked" about a company we found in an ad, and the largest
      // scoring input in the strategy could never fire.
      //
      // Written in the same transaction as the observation: evidence that outlived
      // a rolled-back observation would be a claim with no provenance behind it.
      const adClaim = AD_CLAIM_BY_RESULT_TYPE[String(business.resultType ?? '')];
      if (adClaim) {
        const observedAt = business.observedAt ?? new Date();
        const when = observedAt.toISOString().slice(0, 10);
        await recordEvidence(client, {
          accountId: result.accountId,
          category: 'paid_acquisition',
          claimKey: adClaim.claimKey,
          // Says what was seen, for which search, on which day. A rep can repeat
          // this sentence; they cannot turn it into "you always advertise", and it
          // says nothing about what the advertising costs.
          claimText: business.query
            ? `${adClaim.what} was observed for "${business.query}" on ${when}.`
            : `${adClaim.what} was observed on ${when}.`,
          normalizedValue: 'yes',
          confidence: 'confirmed',
          // We did observe it. That is a fact about the observation, which is the
          // only kind of advertising fact this system ever claims.
          canStateAsFact: true,
          sourceType: 'provider_serp',
          sourceProvider: providerName,
          sourceReference: business.query
            ? `serp://${providerName}/${business.query}${
              business.position === undefined || business.position === null
                ? '' : `#${business.position}`}`
            : `serp://${providerName}`,
          expiresAt: new Date(
            observedAt.getTime() + evidenceTtlHours(adClaim.claimKey) * 3_600_000),
          notes: business.adHeadline ?? null,
        });
        counts.adEvidenceWritten += 1;

        // The same placement, said more precisely, when their own headline says so.
        // Written as its own claim rather than replacing the general one: a hail ad
        // is still a Google search ad, and both facts are true of the same sighting.
        if (business.adHeadline && HAIL_AD_HEADLINE.test(business.adHeadline)) {
          await recordEvidence(client, {
            accountId: result.accountId,
            category: 'surge',
            claimKey: HAIL_AD_CLAIM,
            claimText: `A paid result for "${business.query ?? 'this company'}" carried `
              + `the headline "${business.adHeadline.slice(0, 120)}" on ${when}.`,
            normalizedValue: 'yes',
            confidence: 'confirmed',
            canStateAsFact: true,
            sourceType: 'provider_serp',
            sourceProvider: providerName,
            sourceReference: `serp://${providerName}/${business.query ?? ''}`,
            expiresAt: new Date(
              observedAt.getTime() + evidenceTtlHours(HAIL_AD_CLAIM) * 3_600_000),
            notes: business.adHeadline,
          });
          counts.adEvidenceWritten += 1;
        }
      }

      if (job.market_id) {
        await client.query(
          `insert into account_market_membership (account_id, market_id, discovery_source)
           values ($1, $2, $3)
           on conflict (account_id, market_id) do update set last_seen_at = now()`,
          [result.accountId, job.market_id, `market_miner:${providerName}`],
        );
      }
    });
  }

  // Finding a company is step one. Without this a discovered Account sat in
  // inventory with no research, no contact route and no score -- a name and a
  // number, which is not what a rep needs to make a call. Enqueued after the
  // transactions so a research job never exists for an Account that rolled back.
  for (const accountId of createdAccountIds) {
    const queued = await enqueueAccountResearch(accountId, job.requested_by, 'newly_discovered');
    if (queued.created) counts.researchQueued += 1;
  }

  return counts;
}

export { runContactResearch, config };
