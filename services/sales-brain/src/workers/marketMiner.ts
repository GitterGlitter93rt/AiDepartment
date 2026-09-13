import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { runContactResearch } from './contactResearch.js';
import { registerHandler, type JobRecord, type JobOutcome } from './runner.js';
import type { EntityCandidate } from '../discovery/resolve.js';
import { registrableDomain } from '../discovery/sourceClass.js';
import type { QueryPurpose, CoverageRole } from '../miner/searchTaxonomy.js';
import { miningModeOrDefault } from '../miner/miningMode.js';
import type pg from 'pg';
import type { SearchPlan } from '../miner/searchPlan.js';
import type { PaidPlan } from '../miner/planPreview.js';
import {
  resolveObservations,
  type DiscoveredBusiness, type ProviderObservation,
} from '../discovery/observation.js';

export type { DiscoveredBusiness, ProviderObservation };
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
    /**
     * What this search is for, and what it is therefore allowed to do.
     *
     * The planner has distinguished finding companies from learning what they sell
     * since the taxonomy was made phase-aware, and then threw the distinction away
     * at this boundary -- every search, whatever its purpose, created Accounts from
     * whatever it found. So "roof financing st augustine" defined the market: the
     * companies that rank for a financing question are as likely to be lenders,
     * comparison sites and national brokers as they are to be local roofers, and
     * they arrived as prospects with nothing recording that they were found by a
     * question about money rather than about roofs.
     *
     * COMMERCIAL_INTELLIGENCE is about a market we have already found. It may
     * confirm and enrich the companies in it. It may not decide who is in it.
     */
    purpose: QueryPurpose;
    coverageRole: CoverageRole;
  };
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
  | 'MALFORMED'
  /**
   * The saved market was switched off before this search was submitted, so nothing
   * new was bought. Deliberately not `ZERO_RESULTS`: nobody looked. Deliberately not
   * a failure either -- it is our own decision, like `BUDGET_EXHAUSTED`.
   */
  | 'MARKET_DISABLED'
  /**
   * A confirmed search authorised as "collect the task you already paid for", whose
   * task had already been collected by the time this run reached it.
   *
   * Nothing is owed and nothing is bought: the search the operator approved has
   * already happened and its results are already in inventory. Not a failure, and
   * emphatically not a licence to buy a replacement.
   */
  | 'ALREADY_FULFILLED'
  /**
   * A confirmed search whose approved task can no longer be collected, because it
   * failed, was abandoned, or is gone.
   *
   * The authorisation was to collect one specific task, not to buy a search of this
   * market, so this run cannot honour it and does not substitute a purchase. A new
   * preview is the way to buy it again.
   */
  | 'PLAN_UNFULFILLABLE';

/** The statuses that mean the provider actually answered the question we asked. */
export function providerAnswered(status: DiscoveryStatus): boolean {
  return status === 'OK' || status === 'ZERO_RESULTS';
}

/**
 * May this run still buy a search of this market?
 *
 * `enabled` was read once, by the scheduler, when the job was queued. A market
 * switched off after that -- and before the worker got to it, or between the first
 * and the third search of a multi-search plan -- went on buying, because nothing
 * downstream ever looked again. The window is not theoretical: a scheduled run sits
 * in the queue behind however much else is in flight, and a plan of N searches
 * submits N times over the life of one handler.
 *
 * So this is asked immediately before each submission rather than once at the start,
 * and it is re-read from the database each time rather than cached. Off means: create
 * no *new* chargeable task. It does not mean abandon a task already paid for, and the
 * caller keeps collecting those either way -- see the collect branch, which runs
 * first and is deliberately not gated on this.
 *
 * Two things it deliberately does not refuse:
 *
 *   - a run with no saved market behind it (somebody typed a ZIP into Find
 *     Prospects). There is no `enabled` to consult and nothing to respect.
 *   - a run a person asked for. `enabled` is the switch for unattended
 *     self-maintenance -- that is all the scheduler reads it for, and the operations
 *     page says so in those words ("nothing is being maintained on its own"). A
 *     human pressing search on a market they have paused is spending their own
 *     budget deliberately, and treating the pause as a prohibition would be
 *     inventing a contract the product has never had. Nothing in the codebase yet
 *     writes this column, so the manual case has no precedent to contradict.
 */
export async function mayBuyNewSearch(job: {
  market_id: string | null; requested_by: string | null;
}): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (!job.market_id) return { allowed: true };
  if (job.requested_by) return { allowed: true };

  const { rows } = await query<{ enabled: boolean; name: string }>(
    `select enabled, name from saved_markets where market_id = $1`, [job.market_id]);
  // A market that has been deleted underneath a queued run is not a market we should
  // be buying searches of either.
  if (rows.length === 0) {
    return { allowed: false,
      reason: 'This saved market no longer exists, so no new search was submitted. '
        + 'Anything already paid for was still collected.' };
  }
  if (rows[0]!.enabled) return { allowed: true };
  return { allowed: false,
    reason: 'This market was switched off after this refresh was queued, so no new '
      + 'search was submitted and nothing was charged. Any search already paid for '
      + 'was still collected, and any task the provider still owes us is still '
      + 'outstanding -- switching a market off does not cancel it.' };
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
  /**
   * The rows the provider returned, normalized. The only entity input there is.
   *
   * This field used to be `businesses`, and that was the defect. Entity resolution
   * ran inside the DataForSEO adapter, which made it that adapter's private policy:
   * any other adapter -- a second provider, a fixture, the benchmark harness -- could
   * hand up finished companies and every promotion rule was skipped, silently, with
   * no way to tell from the outside that it had been. A rule that an implementer can
   * decline is not a rule.
   *
   * So an adapter normalizes and stops. `resolveObservations` runs here, once, for
   * every provider, and there is no longer a field on which a finished Account-shaped
   * object could arrive.
   */
  observations: ProviderObservation[];
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
  /**
   * How this provider is being asked, when that changes what a search costs or means.
   *
   * DataForSEO queues a Standard task or answers a Live one, at different prices. The
   * paid preview reports it, and it is hashed into the confirmed plan -- so it has to
   * come from the adapter that will actually run, rather than from the DataForSEO
   * configuration regardless of which adapter was chosen, which is what it did.
   */
  readonly mode?: string;
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
  return { status, observations: [], reason };
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

/**
 * May this Account be given sales intelligence?
 *
 * The same gate that decides whether a rep may claim it, asked before evidence is
 * attached rather than only before a person sees it. An unverified record that
 * quietly accumulates advertiser evidence is a record that will look thoroughly
 * researched on the day somebody finally verifies it, and the evidence will be about
 * whatever the domain actually was.
 */
async function entityIsWorkable(client: pg.PoolClient, accountId: string): Promise<boolean> {
  const { entityGate } = await import('../domain/entityStatus.js');
  const { automatedDiscoveryPredicate } = await import('../domain/discoverySources.js');
  const { rows } = await client.query<{
    entity_status: string | null; found_by_machine: boolean;
  }>(
    `select entity_status,
            exists (select 1 from activities act
                     where act.account_id = accounts.account_id
                       and act.activity_type = 'DISCOVERED'
                       and ${automatedDiscoveryPredicate('act.source_system')}) as found_by_machine
       from accounts where account_id = $1`, [accountId]);
  const row = rows[0];
  if (!row) return false;
  return entityGate({
    entityStatus: row.entity_status, foundByMachine: row.found_by_machine }).workable;
}

/**
 * The plan a person approved, or a refusal, and never a substitute.
 *
 * Three answers, and the middle one is the whole point:
 *
 *   UNCONFIRMED  no plan linkage, so this is an unattended run and plans server-side
 *   CONFIRMED    the stored plan verified, and these exact searches execute
 *   INVALID      linkage exists and does not hold up, so nothing executes
 *
 * INVALID is not "fall back to planning". A job that claims to carry an approved plan
 * and cannot produce one is a job whose authority is unknown, and the safe reading of
 * unknown authority is to buy nothing. Falling back would be the original defect
 * wearing a different hat: the worker deciding for itself what to purchase.
 */
type ConfirmedPlanState =
  | { state: 'UNCONFIRMED' }
  | {
      state: 'CONFIRMED';
      provider: string;
      /**
       * The provider mode that was approved, enforced as part of its identity.
       *
       * Standard and Live are different endpoints, different lifecycles and different
       * prices. Matching on the adapter's name alone meant a plan previewed and
       * confirmed against Standard could execute against Live after a restart --
       * same provider, different purchase.
       */
      providerMode: string;
      searchPlan: SearchPlan;
      /** What each approved search may do, by fingerprint. */
      intent: Map<string, {
        executionDisposition: 'BUY_NEW' | 'COLLECT_EXISTING';
        approvedProviderTaskId: string | null;
      }>;
    }
  | { state: 'INVALID'; reason: string };

async function loadConfirmedPlan(
  payload: Record<string, unknown>,
): Promise<ConfirmedPlanState> {
  const planId = (payload['confirmed_plan_id'] as string | null) ?? null;
  const planHash = (payload['confirmed_plan_hash'] as string | null) ?? null;
  if (!planId && !planHash) return { state: 'UNCONFIRMED' };

  // Half a linkage is not a linkage. A job carrying one without the other cannot be
  // checked, and a job that cannot be checked does not spend.
  if (!planId || !planHash) {
    return { state: 'INVALID',
      reason: 'This run was queued as a confirmed purchase and its plan reference is '
        + 'incomplete, so nothing was bought.' };
  }

  const { rows } = await query<{
    plan_hash: string; plan: { plan: PaidPlan } | null;
    consumed_at: Date | null; consumed_job_id: string | null;
  }>(
    `select plan_hash, plan, consumed_at, consumed_job_id
       from search_plan_previews where plan_id = $1`, [planId]);
  const stored = rows[0];
  if (!stored?.plan?.plan) {
    return { state: 'INVALID',
      reason: 'The confirmed plan for this run is no longer on record, so the searches '
        + 'it authorised could not be identified and nothing was bought.' };
  }

  const { planHash: hashOf } = await import('../miner/planPreview.js');
  const recomputed = hashOf(stored.plan.plan);

  // Three-way, deliberately. The stored hash catches a row edited after it was
  // written; the job's hash catches a job pointed at a plan it was not queued for.
  if (recomputed !== stored.plan_hash || recomputed !== planHash) {
    return { state: 'INVALID',
      reason: 'The confirmed plan for this run no longer matches what was approved, so '
        + 'nothing was bought. Review a new plan before searching this market.' };
  }

  /**
   * A stored preview is not an authorisation.
   *
   * The row exists from the moment somebody asks what a search would cost. Verifying
   * the hash proves the plan has not changed; it does not prove anybody agreed to it.
   * Without this, any caller that could enqueue a job with a plan id would be able to
   * execute a preview nobody confirmed -- the approval step reduced to knowing an id.
   */
  if (!stored.consumed_at) {
    return { state: 'INVALID',
      reason: 'This run points at a research plan nobody confirmed, so nothing was '
        + 'bought. Review and confirm a plan before searching this market.' };
  }

  const plan = stored.plan.plan;
  if (plan.refusal || plan.searches.length === 0) {
    return { state: 'INVALID',
      reason: `The confirmed plan authorised no searches${plan.refusal ? `: ${plan.refusal}` : ''}.` };
  }

  return {
    state: 'CONFIRMED',
    provider: plan.provider,
    providerMode: plan.providerMode,
    intent: new Map(plan.searches.map((search) => [search.fingerprint, {
      executionDisposition: search.executionDisposition,
      approvedProviderTaskId: search.approvedProviderTaskId,
    }])),
    // Shaped as a plan the loop already understands, built from the approved rows
    // rather than from the taxonomy. Nothing here is recomputed: the keyword, the
    // place, the fingerprint and the purpose are the ones that were shown.
    searchPlan: {
      searches: plan.searches.map((search) => ({
        index: search.index,
        term: search.term,
        family: 'confirmed',
        intentWeight: 0,
        advertiserTerm: false,
        cause: null,
        keyword: search.keyword,
        locationName: search.locationName,
        fingerprint: search.fingerprint,
        purpose: search.purpose as QueryPurpose,
        coverageRole: search.coverageRole as CoverageRole,
      })),
      requested: plan.searches.length,
      available: plan.searches.length,
      limitedBy: null,
      causesAvailable: [],
      causesRequested: [...plan.causes],
      refusal: null,
      geography: null,
      partialDiscoveryCoverage: plan.partialDiscoveryCoverage,
      commercialIntelligenceIncluded: plan.searches.some(
        (search) => search.purpose === 'COMMERCIAL_INTELLIGENCE'),
    },
  };
}

// --------------------------------------------------------------- job handler --

registerHandler('market_mine', async (job: JobRecord): Promise<Record<string, unknown>> => {
  const payload = job.payload ?? {};
  const allAdapters = availableDiscoveryAdapters();

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
    entitiesRejected: 0, entitiesNeedingReview: 0, notInMarket: 0,
  };
  let providerRows = 0;
  let providerRejected = 0;
  let providerDuplicates = 0;
  let costUsd = 0;
  let costKnown = false;
  /** Searches already paid for whose results this run went back for. */
  let collectedPaid = 0;
  /** Submissions the daily ceiling refused, counted where the refusal happens. */
  let budgetRefusals = 0;
  const statuses: DiscoveryStatus[] = [];
  const pendingTaskIds: string[] = [];
  const discoveryNotes: string[] = [];
  /** One row per search actually attempted, so N outcomes stay N outcomes. */
  const perSearch: {
    index: number; term: string; keyword: string; fingerprint: string;
    status: DiscoveryStatus; providerRows: number; usableRows: number;
    duplicateRows: number; rejectedRows: number; costUsd: number | null;
    providerTaskId: string | null; created: number; matchedExisting: number;
    reason: string | null;
  }[] = [];

  // The ceiling is consulted per submission, inside the loop below, because a run
  // buys N searches and "does another run fit" is a question about one call. What is
  // read here is only the opening position, for the report at the end.
  const { spendPosition, budgetRefusalReason } = await import('../miner/spend.js');
  const openingSpend = await spendPosition();


  const request: DiscoveryQuery = {
    verticalProfileId: (payload['vertical_profile_id'] as string | null) ?? null,
    geographyType: (payload['geography_type'] as string | null) ?? null,
    geographyValue: (payload['geography_value'] as string | null) ?? null,
    miningMode: miningModeOrDefault(payload['mining_mode'] as string | null),
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
  //
  // A run somebody confirmed does not plan at all.
  //
  // It used to: the route verified the plan, threw it away, and passed the vertical,
  // the geography and a budget to the worker, which called the planner again minutes
  // or hours later. Anything that moved in between -- a profile edited, a term added,
  // a cause enabled -- changed what was bought, and the operator had approved
  // something else. The hash proved the plan at confirmation time and then guarded
  // nothing. The confirmed plan is the instruction now, and the planner is not
  // consulted for it.
  const confirmed = await loadConfirmedPlan(payload);
  if (confirmed.state === 'INVALID') discoveryNotes.push(confirmed.reason);

  /**
   * Who may execute this run.
   *
   * A confirmed plan names one provider and that is the only one allowed: the preview
   * quoted one and the worker looped over every registered adapter, so a second
   * configured provider would have executed the same approved searches again, at the
   * same price, appearing nowhere in what the operator agreed to.
   *
   * A plan whose linkage is missing or no longer verifies leaves this empty, which is
   * how the refusal is enforced rather than merely reported: every provider call in
   * this handler is inside a loop over `adapters`, so an empty list cannot spend, and
   * `outcome` already reads an empty list as DISCOVERY_BLOCKED.
   */
  const adapters = confirmed.state === 'INVALID' ? []
    : confirmed.state === 'CONFIRMED'
      // Name *and* mode. A provider's mode decides which endpoint is called, what the
      // task lifecycle is and what it costs, so DataForSEO Standard and DataForSEO
      // Live are two different purchases wearing one name.
      ? allAdapters.filter((adapter) =>
        adapter.name === confirmed.provider
        && (adapter.mode ?? 'default') === confirmed.providerMode)
      : allAdapters;
  if (confirmed.state === 'CONFIRMED' && adapters.length === 0) {
    const sameName = allAdapters.find((adapter) => adapter.name === confirmed.provider);
    discoveryNotes.push(sameName
      ? `The confirmed plan was to be executed by ${confirmed.provider} in `
        + `${confirmed.providerMode} mode, and it is configured in `
        + `${sameName.mode ?? 'default'} mode now. Those are different purchases, so `
        + 'nothing was bought. Review a new plan.'
      : `The confirmed plan was to be executed by ${confirmed.provider}, which is not `
        + 'configured now. Nothing was bought, and nothing was substituted for it.');
  }

  /**
   * Whether the refusal is about the plan or about the provider registry.
   *
   * Both end in DISCOVERY_BLOCKED and they are not the same finding: one says a
   * purchase somebody approved could not be honoured, the other says this deployment
   * cannot discover at all. Reporting the second sentence for the first would send an
   * operator to check a credential when the answer is to review a new plan.
   */
  const blockedByPlan = confirmed.state === 'INVALID'
    || (confirmed.state === 'CONFIRMED' && adapters.length === 0);

  if (confirmed.state === 'UNCONFIRMED' && adapters.length === 0) {
    discoveryNotes.push(
      'No discovery adapter is available: new-business discovery needs an approved search '
      + 'provider and a signed source-governance review (blocker B-3). Existing inventory '
      + 'was refreshed instead.',
    );
  }
  const { planDiscoverySearches } = await import('../miner/searchPlan.js');
  const searchPlan = confirmed.state === 'CONFIRMED'
    ? confirmed.searchPlan
    : await planDiscoverySearches({
      verticalProfileId: request.verticalProfileId,
      geographyType: request.geographyType,
      geographyValue: request.geographyValue,
      miningMode: request.miningMode,
      count: request.queryBudget,
      marketId: job.market_id,
      ...(Array.isArray(payload['causes']) && (payload['causes'] as string[]).length > 0
        ? { causes: payload['causes'] as string[] } : {}),
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
  /**
   * The words that cannot tell one company in this market from another.
   *
   * Read once per run, from the vertical's own taxonomy plus the geography being
   * searched, and handed to the resolver so that "plumbing" matching between a name
   * and a domain proves nothing in a plumbing market.
   */
  const { genericTermsFor } = await import('../miner/searchTaxonomy.js');
  const genericTerms = await genericTermsFor(
    request.verticalProfileId,
    request.geographyValue,
    // The place as the provider was asked about it, which is where the city's own
    // name is written down. Every search in a plan shares one location.
    searchPlan.searches[0]?.locationName ?? null);

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
        purpose: planned.purpose, coverageRole: planned.coverageRole,
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
      /**
       * What this search is allowed to do, decided at approval rather than now.
       *
       * For an unattended run this is the same question it always was: is a task for
       * these words already outstanding, and if so collect it instead of buying
       * another. For a confirmed run the answer was fixed when a person approved it,
       * and re-deriving it here is precisely the defect -- the preview said "already
       * paid for, will collect", the task was collected by something else in the
       * meantime, and the worker found nothing pending and bought a replacement. The
       * approval said one thing and the spend did another, in the one direction that
       * is not allowed to move.
       */
      const approved = confirmed.state === 'CONFIRMED'
        ? confirmed.intent.get(fingerprint) ?? null : null;

      /**
       * A confirmed search with no approved intent is not a search this run may make.
       *
       * The plan's searches and the intent map are built from the same rows, so this
       * cannot happen today. It is here because the consequence of it happening is a
       * purchase nobody authorised: `approved` being null is indistinguishable from an
       * unattended run, and an unattended run buys. Failing closed makes the absence
       * of an authorisation mean "no", which is the only reading that is safe when the
       * two structures ever drift apart.
       */
      if (confirmed.state === 'CONFIRMED' && !approved) {
        statuses.push('PLAN_UNFULFILLABLE');
        perSearch.push({
          index: planned.index, term: planned.term, keyword: planned.keyword,
          fingerprint, status: 'PLAN_UNFULFILLABLE', providerRows: 0, usableRows: 0,
          duplicateRows: 0, rejectedRows: 0, costUsd: null, providerTaskId: null,
          reason: 'This search is not in the confirmed plan, so it was not bought.',
          created: 0, matchedExisting: 0,
        });
        continue;
      }

      let outstanding = await openProviderTask(adapter.name, fingerprint);
      /** Set when an approved collection cannot happen, so nothing is bought instead. */
      let unfulfillable: string | null = null;

      if (approved?.executionDisposition === 'COLLECT_EXISTING') {
        // The one task the operator was told already existed, by id. Not "whatever is
        // pending for these words now", which is how a different task -- or none --
        // could end up standing in for the approved one.
        const { rows: approvedTask } = await query<{
          provider_task_id: string; provider: string; provider_native_id: string;
          fingerprint: string; status: string; poll_attempts: number;
          submitted_at: Date; request: Record<string, unknown> | null;
        }>(
          `select provider_task_id, provider, provider_native_id, fingerprint, status,
                  poll_attempts, submitted_at, request
             from provider_tasks where provider_task_id = $1`,
          [approved.approvedProviderTaskId]);
        const task = approvedTask[0];

        if (task && task.status === 'PENDING') {
          outstanding = task as unknown as typeof outstanding;
        } else if (task && task.status === 'COLLECTED') {
          // Already done, by an earlier run or another worker. The search the operator
          // approved has happened and its results are in inventory; buying a second
          // copy would spend money to learn what we already know.
          outstanding = null;
          unfulfillable = 'ALREADY_FULFILLED';
        } else {
          outstanding = null;
          unfulfillable = 'PLAN_UNFULFILLABLE';
        }
      }

      // Asked once per search, and only when a purchase is actually on the table --
      // not once at the top of the handler, because the question is whether *this*
      // submission may happen and a plan of N searches asks it N times. Read fresh
      // each time: a market switched off between the first search and the third has
      // to stop the third.
      const buy = !outstanding ? await mayBuyNewSearch(job) : null;

      // The ceiling, re-read the same way and for the same reason.
      //
      // `spendPosition()` was called once at the top of the handler and its verdict
      // applied to every search in the plan. Its own arithmetic is about one call --
      // "would this run fit" uses the assumed cost of a single run -- so a plan of N
      // searches asked a one-call question once and then made N chargeable calls.
      // Measured on a $0.10 daily budget: one run submitted eight searches and spent
      // $0.40, four times the ceiling, and the refusal never fired because at the
      // moment it was evaluated nothing had been spent yet.
      //
      // Re-read here, after each submission has been recorded in provider_usage, the
      // ceiling holds: the worst case for the *next* call has to fit before that call
      // is made. That is what the module already says it does -- "the check is a
      // precondition of the call" -- applied per call rather than per run.
      const affordable = (!outstanding && (!buy || buy.allowed))
        ? await spendPosition() : null;

      if (unfulfillable === 'ALREADY_FULFILLED') {
        result = refusedDiscovery('ALREADY_FULFILLED',
          'This search was approved as a collection of a task already paid for, and '
          + 'that task had already been collected. Nothing was owed and nothing was '
          + 'bought.');
      } else if (unfulfillable) {
        result = refusedDiscovery('PLAN_UNFULFILLABLE',
          'This search was approved as a collection of one specific task already paid '
          + 'for, and that task can no longer be collected. Buying a replacement was '
          + 'not what was approved, so nothing was bought. Review a new plan.');
      } else if (outstanding && adapter.collect) {
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
          collectedPaid += 1;
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
      } else if (affordable && affordable.wouldExceed) {
        // Nothing outstanding to collect and no room to buy: this is the one place
        // the ceiling refuses work, and it refuses it before the money is spent.
        budgetRefusals += 1;
        result = refusedDiscovery('BUDGET_EXHAUSTED', budgetRefusalReason(affordable));
      } else if (buy && !buy.allowed) {
        // A market switched off after this run was queued. Nothing new is bought;
        // anything already paid for was collected by the branch above.
        result = refusedDiscovery('MARKET_DISABLED', buy.reason);
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

    // Resolution happens here, for every provider, or it does not happen.
    const resolution = resolveObservations(result.observations, genericTerms);

    // The provider answered; whether it found anything is ours to say. An adapter
    // reporting OK on a page of directories would otherwise mark the market as having
    // businesses in it, which is the claim this whole remediation exists to stop.
    const status: DiscoveryStatus = result.status === 'OK' && resolution.businesses.length === 0
      ? 'ZERO_RESULTS' : result.status;

    statuses.push(status);
    providerRows += resolution.providerRows;
    providerRejected += resolution.rejectedRows;
    providerDuplicates += resolution.duplicateRows;
    if (typeof result.costUsd === 'number') { costUsd += result.costUsd; costKnown = true; }
    if (result.providerTaskId) pendingTaskIds.push(result.providerTaskId);
    // The adapter explains its refusals; resolution explains its answers.
    const reason = result.reason ?? (providerAnswered(status) ? resolution.reason : null);
    if (reason) {
      discoveryNotes.push(searchPlan.searches.length > 1
        ? `${adapter.name} "${planned.term}": ${reason}`
        : `${adapter.name}: ${reason}`);
    }
    perSearch.push({
      index: planned.index, term: planned.term, keyword: planned.keyword,
      fingerprint, status, providerRows: resolution.providerRows,
      usableRows: resolution.businesses.length, duplicateRows: resolution.duplicateRows,
      rejectedRows: resolution.rejectedRows, costUsd: result.costUsd ?? null,
      providerTaskId: result.providerTaskId ?? null,
      // Each search's own explanation. It was dropped here and only survived in the
      // run-level notes, so the canary -- whose stated job is to account for every
      // search separately -- could say a search was BUDGET_EXHAUSTED without saying
      // that the daily ceiling is what refused it.
      reason: reason ?? null,
      created: 0, matchedExisting: 0,
    });

    // Persisted whether or not anything promoted.
    //
    // This used to be `if (result.businesses.length > 0)`, so a search that resolved
    // eleven directories and no companies wrote nothing at all: no observations, no
    // candidates, no trace beyond a job row saying zero. The rejections are the most
    // valuable thing a run of that shape produces -- they are how an operator sees
    // that the search *was* made, what it cost, and what it actually found -- and
    // they are what the next run needs in order not to research the same directory
    // again. A paid search that leaves no evidence is a paid search nobody can audit.
    if (result.observations.length > 0 || resolution.candidates.length > 0) {
      const counts = await ingestDiscoveries(resolution.businesses, adapter.name, job,
        resolution.candidates, result.observations, planned.purpose);
      funnel.candidates += counts.candidates;
      funnel.rejected += counts.rejected;
      funnel.matchedExisting += counts.matchedExisting;
      funnel.created += counts.created;
      funnel.researchQueued += counts.researchQueued;
      funnel.adEvidenceWritten += counts.adEvidenceWritten;
      funnel.excludedByVertical += counts.excludedByVertical;
      funnel.entitiesRejected += counts.entitiesRejected;
      funnel.entitiesNeedingReview += counts.entitiesNeedingReview;
      funnel.notInMarket += counts.notInMarket;
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

  // Read after the run rather than before it, so what the page shows is what was
  // spent rather than what had been spent by the time the first decision was taken.
  const closingSpend = await spendPosition();

  const answered = statuses.filter(providerAnswered).length;
  /**
   * Searches we chose not to buy because the market was switched off.
   *
   * Held apart from `failed` deliberately. Nothing failed: no provider was asked, so
   * calling the run PARTIAL -- "some providers answered and some could not" -- would
   * blame a provider for our own decision, and would put a healthy market into the
   * failure backoff on the way out.
   */
  const declined = statuses.filter((status) => status === 'MARKET_DISABLED').length;
  /**
   * Confirmed searches this run correctly did not buy.
   *
   * Held apart from both `answered` and `failed`. A search whose approved task had
   * already been collected is finished work, and one whose approved task died cannot
   * be honoured without a new approval -- neither is a provider that failed, and
   * counting them as failures would put a healthy market into the failure backoff for
   * doing exactly the right thing.
   */
  const alreadyFulfilled = statuses.filter((status) => status === 'ALREADY_FULFILLED').length;
  const unfulfillable = statuses.filter((status) => status === 'PLAN_UNFULFILLABLE').length;
  const stillOwed = statuses.filter((status) => status === 'PENDING').length;
  const failed = statuses.length - answered - declined - alreadyFulfilled - unfulfillable;

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
    // The refusals this run actually made, not a verdict formed before it started.
    : budgetRefusals > 0 && answered === 0 ? 'DISCOVERY_BLOCKED'
    // A task the provider still owes us outranks our own refusal to buy more. The
    // task row is untouched and still PENDING -- switching a market off does not
    // cancel a search already paid for -- and the market has to keep saying so, or
    // the one fact an operator needs about an outstanding purchase disappears the
    // moment somebody pauses the market.
    : stillOwed > 0 && answered === 0 && failed === 0 ? 'PROVIDER_PENDING'
    : statuses.every((status) => status === 'PENDING') ? 'PROVIDER_PENDING'
    // Our own switch stopped the buying and nothing was collected: not an empty
    // market, not a provider outage, and not a market that failed.
    // Everything the plan authorised had already been done. Reporting that as an
    // empty market would say something false about the market.
    : alreadyFulfilled > 0 && answered === 0 && failed === 0 && declined === 0
      && unfulfillable === 0 ? 'COMPLETED'
    // The approved tasks can no longer be collected and buying instead was not
    // authorised, so this is blocked on a new approval rather than on a provider.
    : unfulfillable > 0 && answered === 0 && failed === 0 ? 'DISCOVERY_BLOCKED'
    : declined > 0 && answered === 0 && failed === 0 ? 'MARKET_DISABLED'
    : answered === 0 ? 'PROVIDER_UNAVAILABLE'
    : failed > 0 ? 'PARTIAL'
    : providerRows > 0 ? 'COMPLETED'
    : 'ZERO_RESULTS';

  const failureSummary = discoveryNotes.length > 0 ? ` ${discoveryNotes.join('; ')}` : '';

  /**
   * A paused market that still had work owed to it.
   *
   * "Disabled" and "a search we had already paid for came back" are both true at
   * once, and the run reports the second on its merits -- it did find businesses, and
   * calling that anything but a completed search would hide them. But an operator
   * reading a COMPLETED market refresh on a market they switched off is owed the
   * first fact too, or the page reads as though the pause did nothing. Said here
   * rather than folded into the outcome, because the outcome is about what happened
   * and this is about what will not happen next.
   */
  const paused = job.market_id && !job.requested_by
    ? !(await mayBuyNewSearch(job)).allowed : false;
  const pausedNote = !paused ? ''
    : collectedPaid > 0
      ? ` This market is switched off for new refreshes; ${collectedPaid} search(es) `
        + 'already paid for were still collected, and nothing new was bought.'
      : ' This market is switched off for new refreshes, so nothing new was bought.';
  const outcomeReason =
    outcome === 'DISCOVERY_BLOCKED' && budgetRefusals > 0
      ? budgetRefusalReason(closingSpend)
    : outcome === 'DISCOVERY_BLOCKED' && blockedByPlan
      // A confirmed plan that could not be honoured says so in its own words. The
      // sentence below is about a missing provider, and would be a different and
      // wrong explanation for a plan that failed verification.
      ? `Nothing was searched and nothing was charged.${failureSummary}`
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
    : outcome === 'MARKET_DISABLED'
      ? `This market is switched off, so no new search was bought.${failureSummary}`
    : outcome === 'ZERO_RESULTS'
      ? `${answered} provider(s) searched this market and returned nothing usable.`
        + (declined > 0 ? failureSummary : '') + pausedNote
    : `${providerRows} provider row(s): ${providerDuplicates} duplicate(s), `
      + `${providerRejected + funnel.rejected} unusable, ${funnel.matchedExisting} already `
      + `in inventory, ${funnel.created} new business(es) added.`
      + (declined > 0 ? failureSummary : '') + pausedNote;

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
    // The funnel an operator actually needs: rows are not identities, identities are
    // not businesses, and businesses are not Accounts. Reported apart so "65
    // businesses" can never again describe a page of articles.
    entitiesRejected: funnel.entitiesRejected,
    entitiesNeedingReview: funnel.entitiesNeedingReview,
    // Companies a commercial-intelligence search turned up that we do not hold. A
    // finding about the query, not a failure: it is the number that says whether
    // those queries are describing the market or discovering a different one.
    notInMarket: funnel.notInMarket,
    exclusionReasons: funnel.exclusionReasons.slice(0, 20),
    // What each search actually did. An aggregate cannot say that four of five
    // searches found nothing and the fifth found everything, and that difference is
    // the whole reason for running more than one.
    searchesPlanned: searchPlan.searches.length,
    searchesRequested: searchPlan.requested,
    searchTermsAvailable: searchPlan.available,
    perSearch,
    costUsd: costKnown ? Number(costUsd.toFixed(4)) : null,
    spentTodayUsd: closingSpend.spentTodayUsd,
    spentTodayUsdBeforeRun: openingSpend.spentTodayUsd,
    dailyBudgetUsd: closingSpend.budgetUsd || null,
    // "The ceiling refused at least one submission in this run", which is the thing
    // an operator is asking. It used to be a verdict formed before the run started,
    // and so could be false on a run that went on to cross the ceiling.
    budgetExhausted: budgetRefusals > 0,
    budgetRefusals,
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
  /** Identities the resolver refused: directories, publishers, forums, locators. */
  entitiesRejected: number;
  /** Identities that may be businesses but could not be named. Not promoted. */
  entitiesNeedingReview: number;
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
  /**
   * Companies a commercial-intelligence search found that we do not already hold.
   *
   * Not created, and not an error. "roof financing st augustine" is a question about
   * a market we have already defined; the companies that rank for it are as likely to
   * be lenders and national comparison sites as local roofers, and letting that query
   * decide who is in the market is how a financing portal becomes a prospect.
   */
  notInMarket: number;
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
  candidates: EntityCandidate[] = [], observations: ProviderObservation[] = [],
  /**
   * What the search was for. Only an entity-discovery query decides who is in a
   * market; anything else may confirm and enrich the companies already in it.
   *
   * Defaulted to discovery so a caller that predates the distinction -- a listings
   * ingest, a test -- keeps behaving as it did. The miner always passes the real one.
   */
  purpose: QueryPurpose = 'ENTITY_DISCOVERY',
): Promise<IngestionCounts> {
  const { upsertAccount } = await import('../domain/accounts.js');
  const counts: IngestionCounts = {
    candidates: businesses.length, rejected: 0, matchedExisting: 0, created: 0,
    researchQueued: 0, adEvidenceWritten: 0, excludedByVertical: 0, exclusionReasons: [],
    entitiesRejected: 0, entitiesNeedingReview: 0, notInMarket: 0,
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

  // Every identity this search resolved, kept whether or not it became anything.
  //
  // The run that found eleven directories and two companies has to be able to say so
  // afterwards. Previously a refused row left no trace at all -- observations were
  // written inside the promotion loop, after upsertAccount -- so the only evidence a
  // search had been made was the Accounts it created, which is why "65 businesses
  // identified" could describe a page of articles.
  for (const candidate of candidates) {
    await query(
      `insert into discovery_candidates
         (job_id, vertical_profile_id, identity, source_class, entity_status,
          resolved_name, name_basis, observed_domain, observed_phone, observed_location,
          observation_count, reasons, discovered_for_geography_type, discovered_for_geography)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        job.job_id, verticalProfileId, candidate.identity, candidate.sourceClass,
        candidate.status, candidate.resolvedName, candidate.nameBasis,
        candidate.domain, candidate.phone, candidate.observedBusinessAddress,
        candidate.observationCount, candidate.reasons.map((r) => r.slice(0, 300)),
        searchedGeographyType, searchedGeography,
      ]);
    if (candidate.status === 'REJECTED') counts.entitiesRejected += 1;
    if (candidate.status === 'NEEDS_REVIEW') counts.entitiesNeedingReview += 1;
  }

  // The rows themselves, all of them, before anything is promoted.
  //
  // An observation used to be written inside the promotion loop, one per created
  // Account, which made the evidence a consequence of the decision rather than the
  // basis for it: a run that promoted nothing recorded nothing, and there was no way
  // afterwards to see what the search had returned or to check the decision against
  // it. A row that was refused is exactly the row somebody needs to read.
  //
  // `account_id` stays null until an Account exists. The row is evidence of a
  // sighting; it is not a claim that the sighting is a company.
  const observationIdsByIdentity = new Map<string, string[]>();
  /** The rows themselves, so advertising evidence reads every sighting, not one. */
  const observationsByIdentity = new Map<string, ProviderObservation[]>();
  for (const observation of observations) {
    const identity = registrableDomain(observation.observedDomain)
      ?? (observation.observedPhone?.trim() || null);
    const { rows } = await query<{ observation_id: string }>(
      `insert into search_observations (mining_job_id, provider, source_type, observed_name,
                                        observed_domain, observed_phone, observed_location,
                                        result_type, advertised_service, landing_url,
                                        retention_class, account_id, job_id,
                                        query, position, ad_headline, provider_native_id,
                                        observed_at)
       values (null, $1, 'discovery', $2, $3, $4, $5, $6, $7, $8, 'transient', null, $9,
               $10, $11, $12, $13, coalesce($14::timestamptz, now()))
       returning observation_id`,
      [
        providerName, observation.observedName, observation.observedDomain,
        observation.observedPhone,
        // The business's own address or nothing. Never `searchLocationName`: the
        // geography we typed into the provider is not somewhere this company is.
        observation.observedBusinessAddress,
        storedResultType(observation.resultType), observation.advertisedService,
        observation.landingUrl, job.job_id,
        observation.query, observation.position, observation.adHeadline,
        observation.providerNativeId, observation.observedAt ?? null,
      ]);
    if (!identity) continue;
    const held = observationIdsByIdentity.get(identity) ?? [];
    held.push(rows[0]!.observation_id);
    observationIdsByIdentity.set(identity, held);
    const rowsHeld = observationsByIdentity.get(identity) ?? [];
    rowsHeld.push(observation);
    observationsByIdentity.set(identity, rowsHeld);
  }

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
      /**
       * Two questions before anything is written, and they are not the same question.
       *
       *   is there already a record with this identity?
       *   is that record something we may attach sales intelligence to?
       *
       * `resolveAccountIdentity` answers the first. It matches on a domain or a phone,
       * and the rows it can match include the legacy records nothing has established
       * to be companies -- the canary's 65 among them. Attaching advertiser and
       * service evidence to one of those makes a webpage look like a researched
       * advertiser, which is the same failure as creating it, reached from the other
       * side. So the entity gate decides the second question, for every purpose: a
       * discovery query that re-finds a piece of that junk must not enrich it either.
       *
       * Nothing is lost. The observations are already written and the candidate row
       * keeps the identity and the reason, which is what a reprocess run reads.
       */
      const { resolveAccountIdentity } = await import('../domain/accounts.js');
      const existing = await resolveAccountIdentity(client, {
        canonicalName: business.name,
        website: business.website ?? null,
        phone: business.phone ?? null,
        sourceIdentity: business.providerNativeId
          ? {
              provider: providerName, entityType: 'business',
              nativeId: business.providerNativeId, retentionClass: 'identifier_only',
            }
          : null,
      });
      const matchedUnverified = existing
        ? !(await entityIsWorkable(client, existing.accountId)) : false;

      // A commercial-intelligence query may confirm a company, never introduce one.
      const mayNotIntroduce = !existing && purpose !== 'ENTITY_DISCOVERY';

      if (matchedUnverified || mayNotIntroduce) {
        counts.notInMarket += 1;
        await client.query(
          `update discovery_candidates
              set entity_status = 'NEEDS_REVIEW',
                  reasons = reasons || $3::text[]
            where job_id = $1 and identity = $2 and account_id is null`,
          [job.job_id,
           registrableDomain(business.website ?? null) ?? (business.phone?.trim() || ''),
           [matchedUnverified
             ? 'the record this matches has never been established to be a company, so '
               + 'nothing was attached to it'
             : 'found by a question about what this market sells rather than about who '
               + 'is in it, and we do not already hold this company']]);
        return;
      }

      const result = await upsertAccount(
        client,
        {
          canonicalName: business.name,
          website: business.website ?? null,
          phone: business.phone ?? null,
          // Only what was actually observed.
          //
          // These used to fall back to the geography the run was searching, so a
          // provider that returned no address produced an Account claiming to sit in
          // the ZIP we happened to type. Sixty-five of sixty-five canary Accounts
          // claimed a physical location nobody had observed, including a Jacksonville
          // company and one whose own page title said 32080.
          //
          // "Found while researching 32095" is a fact about the search. "Located in
          // 32095" is a fact about the business. The first is recorded as discovery
          // provenance below; it is never promoted into the second.
          // Only what the provider resolved itself. A free-form address line is kept
          // below as observed evidence rather than parsed into these.
          city: business.city ?? null,
          state: business.state ?? null,
          postalCode: business.postalCode ?? null,
          addressLine1: business.observedBusinessAddress ?? null,
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

      // Promoted through the resolver, so it is a verified entity rather than a row
      // that merely had a domain. Existing Accounts keep whatever status they had:
      // a legacy record is not laundered by being seen again.
      if (result.created) {
        await client.query(
          `update accounts set entity_status = 'verified',
                  entity_status_basis = $2, entity_status_at = now()
            where account_id = $1 and entity_status = 'legacy_unverified'`,
          [result.accountId, `resolved from ${providerName} discovery`]);
      }

      // The geography this run was searching, kept as provenance so a rep can be told
      // where a company was found without being told where it is.
      if (result.created && searchedGeography) {
        await client.query(
          `update accounts
              set discovered_for_geography_type = $2, discovered_for_geography = $3
            where account_id = $1 and discovered_for_geography is null`,
          [result.accountId, searchedGeographyType, searchedGeography]);
      }

      // The sighting already exists; what is new is that it turned out to be this
      // Account. Six sightings of one advertiser stay six observations of one
      // Account -- they are not collapsed, because the count is the evidence that a
      // company keeps appearing rather than appeared once.
      const identity = registrableDomain(business.website ?? null) ?? (business.phone?.trim() || null);
      const observationIds = identity ? observationIdsByIdentity.get(identity) ?? [] : [];
      if (observationIds.length > 0) {
        await client.query(
          `update search_observations set account_id = $1
            where observation_id = any($2::uuid[]) and account_id is null`,
          [result.accountId, observationIds]);
      } else {
        // A business with no observation behind it: an adapter that resolved from
        // something this run did not record. Written rather than dropped, so the
        // Account still has provenance.
        await client.query(
          `insert into search_observations (mining_job_id, provider, source_type, observed_name,
                                            observed_domain, observed_phone, observed_location,
                                            result_type, advertised_service, landing_url,
                                            retention_class, account_id, job_id,
                                            query, position, ad_headline, provider_native_id,
                                            observed_at)
           values (null, $1, 'discovery', $2, $3, $4, null, $5, $6, $7, 'transient', $8, $9,
                   $10, $11, $12, $13, coalesce($14::timestamptz, now()))`,
          [
            providerName, business.name, business.website ?? null, business.phone ?? null,
            storedResultType(business.resultType), business.advertisedService ?? null,
            business.landingUrl ?? null, result.accountId, job.job_id,
            business.query ?? null, business.position ?? null, business.adHeadline ?? null,
            business.providerNativeId ?? null, business.observedAt ?? null,
          ]);
      }

      // The candidate that became this Account, so the decision and the record of it
      // point at each other.
      if (identity) {
        await client.query(
          `update discovery_candidates set account_id = $1
            where job_id = $2 and identity = $3 and account_id is null`,
          [result.accountId, job.job_id, identity]);
      }

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
      /**
       * Every paid sighting is its own dated claim, not one claim per company.
       *
       * The evidence used to be written from the single representative row, so a
       * company that appeared as an organic result *and* a paid ad *and* a Local
       * Services ad produced whichever the projection had picked -- and if that was
       * the organic row, the advertising was simply missed, even though all three
       * observations were sitting in the table. Advertising is a fact about a
       * sighting, so it is read from the sightings.
       */
      const paidSightings = (identity ? observationsByIdentity.get(identity) ?? [] : [])
        .filter((observation) => AD_CLAIM_BY_RESULT_TYPE[String(observation.resultType)]);
      for (const sighting of paidSightings) {
        const adClaim = AD_CLAIM_BY_RESULT_TYPE[String(sighting.resultType)]!;
        const observedAt = sighting.observedAt ?? new Date();
        const when = observedAt.toISOString().slice(0, 10);
        await recordEvidence(client, {
          accountId: result.accountId,
          category: 'paid_acquisition',
          claimKey: adClaim.claimKey,
          // Says what was seen, for which search, on which day. A rep can repeat
          // this sentence; they cannot turn it into "you always advertise", and it
          // says nothing about what the advertising costs.
          claimText: sighting.query
            ? `${adClaim.what} was observed for "${sighting.query}" on ${when}.`
            : `${adClaim.what} was observed on ${when}.`,
          normalizedValue: 'yes',
          confidence: 'confirmed',
          // We did observe it. That is a fact about the observation, which is the
          // only kind of advertising fact this system ever claims.
          canStateAsFact: true,
          sourceType: 'provider_serp',
          sourceProvider: providerName,
          sourceReference: sighting.query
            ? `serp://${providerName}/${sighting.query}${
              sighting.position === undefined || sighting.position === null
                ? '' : `#${sighting.position}`}`
            : `serp://${providerName}`,
          expiresAt: new Date(
            observedAt.getTime() + evidenceTtlHours(adClaim.claimKey) * 3_600_000),
          notes: sighting.adHeadline ?? null,
        });
        counts.adEvidenceWritten += 1;

        // The same placement, said more precisely, when their own headline says so.
        // Written as its own claim rather than replacing the general one: a hail ad
        // is still a Google search ad, and both facts are true of the same sighting.
        if (sighting.adHeadline && HAIL_AD_HEADLINE.test(sighting.adHeadline)) {
          await recordEvidence(client, {
            accountId: result.accountId,
            category: 'surge',
            claimKey: HAIL_AD_CLAIM,
            claimText: `A paid result for "${sighting.query ?? 'this company'}" carried `
              + `the headline "${sighting.adHeadline.slice(0, 120)}" on ${when}.`,
            normalizedValue: 'yes',
            confidence: 'confirmed',
            canStateAsFact: true,
            sourceType: 'provider_serp',
            sourceProvider: providerName,
            sourceReference: `serp://${providerName}/${sighting.query ?? ''}`,
            expiresAt: new Date(
              observedAt.getTime() + evidenceTtlHours(HAIL_AD_CLAIM) * 3_600_000),
            notes: sighting.adHeadline.slice(0, 200),
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
