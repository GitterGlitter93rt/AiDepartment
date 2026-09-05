import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { runContactResearch } from './contactResearch.js';
import { registerHandler, type JobRecord, type JobOutcome } from './runner.js';
import { discoveryFingerprint, enqueueAccountResearch } from './enqueue.js';
import {
  closeProviderTask, openProviderTask, recordCollectionAttempt, recordProviderTask,
  MAX_TASK_COLLECTIONS,
} from '../miner/providerTasks.js';

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

export function registerDiscoveryAdapter(adapter: DiscoveryAdapter): void {
  discoveryAdapters.push(adapter);
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

/** TTLs from the data contract's §14 matrix. Configurable, not hard-coded policy. */
export const EVIDENCE_TTL_HOURS: Record<string, number> = {
  active_google_search_ad: 48,
  active_local_service_ad: 48,
  active_meta_ad: 48,
  ad_transparency: 24 * 7,
  website_offer: 24 * 7,
  website_cta: 24 * 14,
  website_technology: 24 * 14,
  emergency_service_claim: 24 * 30,
  decision_maker_identity: 24 * 30,
  location: 24 * 30,
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
  };
  let providerRows = 0;
  let providerRejected = 0;
  let providerDuplicates = 0;
  let costUsd = 0;
  let costKnown = false;
  const statuses: DiscoveryStatus[] = [];
  const pendingTaskIds: string[] = [];
  const discoveryNotes: string[] = [];

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
    queryBudget: Number(payload['query_budget'] ?? 25),
  };
  const fingerprint = discoveryFingerprint({
    marketId: job.market_id,
    verticalProfileId: request.verticalProfileId,
    geographyType: request.geographyType,
    geographyValue: request.geographyValue,
    miningMode: request.miningMode,
  });

  for (const adapter of adapters) {
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
        result = await adapter.collect(outstanding.provider_native_id, request);

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
      } else {
        result = await adapter.discover(request);

        // A task the provider accepted is remembered before this job ends. Without
        // this row the id dies with the process and the search is bought again.
        if (result.status === 'PENDING' && result.providerTaskId) {
          await recordProviderTask({
            provider: adapter.name, providerNativeId: result.providerTaskId,
            fingerprint, jobId: job.job_id,
            request: request as unknown as Record<string, unknown>,
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
    if (result.reason) discoveryNotes.push(`${adapter.name}: ${result.reason}`);

    if (result.businesses.length > 0) {
      const counts = await ingestDiscoveries(result.businesses, adapter.name, job);
      funnel.candidates += counts.candidates;
      funnel.rejected += counts.rejected;
      funnel.matchedExisting += counts.matchedExisting;
      funnel.created += counts.created;
      funnel.researchQueued += counts.researchQueued;
    }

    // The task is only finished with once its results are in inventory. A crash
    // before this line costs one more collection call; a crash after it costs
    // nothing, because ingestion resolves to the same Accounts either way.
    if (collected) {
      await closeProviderTask({
        providerTaskId: collected, status: 'COLLECTED', costUsd: result.costUsd ?? null });
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
    : statuses.every((status) => status === 'PENDING') ? 'PROVIDER_PENDING'
    : answered === 0 ? 'PROVIDER_UNAVAILABLE'
    : failed > 0 ? 'PARTIAL'
    : providerRows > 0 ? 'COMPLETED'
    : 'ZERO_RESULTS';

  const failureSummary = discoveryNotes.length > 0 ? ` ${discoveryNotes.join('; ')}` : '';
  const outcomeReason =
    outcome === 'DISCOVERY_BLOCKED'
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
    costUsd: costKnown ? Number(costUsd.toFixed(4)) : null,
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

/** Resolves discovered businesses into canonical Accounts. Dedupe is not optional. */
async function ingestDiscoveries(
  businesses: DiscoveredBusiness[], providerName: string, job: JobRecord,
): Promise<IngestionCounts> {
  const { upsertAccount } = await import('../domain/accounts.js');
  const counts: IngestionCounts = {
    candidates: businesses.length, rejected: 0, matchedExisting: 0, created: 0, researchQueued: 0,
  };
  const createdAccountIds: string[] = [];

  // The geography the search was scoped to. A business returned by a search for one
  // ZIP was found in that ZIP -- that is a fact about how we found it, not a claim
  // about its mailing address -- so it is recorded as a service area rather than as a
  // street address, and only when the provider gave us nothing better. Without it a
  // discovered business is invisible to the very search that discovered it.
  const searchedGeographyType = (job.payload['geography_type'] as string | null) ?? null;
  const searchedGeography = (job.payload['geography_value'] as string | null) ?? null;

  for (const business of businesses) {
    if (!isUsableBusiness(business)) { counts.rejected += 1; continue; }

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
                                          retention_class, account_id, job_id)
         values (null, $1, 'discovery', $2, $3, $4, $5, $6, $7, $8, 'transient', $9, $10)`,
        [
          providerName, business.name, business.website ?? null, business.phone ?? null,
          [business.city, business.state].filter(Boolean).join(', ') || null,
          storedResultType(business.resultType), business.advertisedService ?? null,
          business.landingUrl ?? null, result.accountId,
          // An observation nobody can trace back to the run that made it cannot be
          // audited, and cannot be attributed a cost.
          job.job_id,
        ],
      );

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
