import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { runContactResearch } from './contactResearch.js';
import { registerHandler, type JobRecord, type JobOutcome } from './runner.js';
import { enqueueAccountResearch } from './enqueue.js';

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
 * The contract every discovery provider must satisfy. Implementations live behind
 * this so the orchestrator never learns a provider's shape, and so a provider can
 * be swapped after benchmarking without touching inventory logic.
 */
export interface DiscoveryAdapter {
  readonly name: string;
  readonly requiresCredential: boolean;
  readonly governanceReviewed: boolean;
  isConfigured(): boolean;
  discover(request: DiscoveryQuery): Promise<DiscoveredBusiness[]>;
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

  let discovered = 0;
  let providersQueried = 0;
  let providersFailed = 0;
  const discoveryNotes: string[] = [];

  if (adapters.length === 0) {
    discoveryNotes.push(
      'No discovery adapter is available: new-business discovery needs an approved search provider '
      + 'and a signed source-governance review (blocker B-3). Existing inventory was refreshed instead.',
    );
  } else {
    for (const adapter of adapters) {
      try {
        const businesses = await adapter.discover({
          verticalProfileId: (payload['vertical_profile_id'] as string | null) ?? null,
          geographyType: (payload['geography_type'] as string | null) ?? null,
          geographyValue: (payload['geography_value'] as string | null) ?? null,
          miningMode: (payload['mining_mode'] as string) ?? 'advertiser_first',
          queryBudget: Number(payload['query_budget'] ?? 25),
        });
        providersQueried += 1;
        discovered += await ingestDiscoveries(businesses, adapter.name, job);
      } catch (error) {
        // A provider that threw is not a market with no businesses in it. Recording
        // it as zero results is the exact lie this whole outcome field exists to
        // stop.
        providersFailed += 1;
        discoveryNotes.push(
          `${adapter.name} failed: ${(error as Error).message.slice(0, 200)}`);
      }
    }
  }

  /**
   * What actually happened, in the operator's terms.
   *
   * "Succeeded" answered whether the handler returned. A person who typed a ZIP into
   * Find Prospects and read "Succeeded — 0 found" concluded there are no businesses
   * in that ZIP. There was no provider to ask.
   */
  const outcome: JobOutcome =
    adapters.length === 0 ? 'DISCOVERY_BLOCKED'
    : providersFailed > 0 && providersQueried === 0 ? 'PROVIDER_UNAVAILABLE'
    : providersFailed > 0 ? 'PARTIAL'
    : discovered > 0 ? 'COMPLETED'
    : plan.queued > 0 ? 'ZERO_RESULTS'
    : plan.accountsInScope === 0 ? 'ZERO_RESULTS'
    : 'ZERO_RESULTS';

  const outcomeReason =
    outcome === 'DISCOVERY_BLOCKED'
      ? 'No search provider is configured, so no new business could be found. '
        + `${plan.queued} existing account(s) were queued for refresh.`
    : outcome === 'PROVIDER_UNAVAILABLE'
      ? `Every discovery provider failed: ${discoveryNotes.join('; ')}`
    : outcome === 'PARTIAL'
      ? `${providersQueried} provider(s) answered, ${providersFailed} failed: `
        + discoveryNotes.join('; ')
    : outcome === 'ZERO_RESULTS'
      ? `${providersQueried} provider(s) were asked and returned no new business.`
    : `${discovered} new business(es) discovered by ${providersQueried} provider(s).`;

  if (job.market_id) {
    await query(
      `update saved_markets set last_refresh_at = now(),
              last_mined_at = case when $2 > 0 then now() else last_mined_at end,
              status = 'ACTIVE'
        where market_id = $1`,
      [job.market_id, discovered],
    );
  }

  return {
    outcome,
    outcomeReason,
    // The two numbers a mining row has to keep apart. One is new businesses found in
    // the world; the other is companies we already had, queued to be looked at again.
    discoveredNew: discovered,
    refreshQueued: plan.queued,
    accountsInScope: plan.accountsInScope,
    staleAccounts: plan.staleAccounts,
    evidenceExpired: expired,
    discovered,
    discoveryAdapters: adapters.map((adapter) => adapter.name),
    discoveryAvailable: adapters.length > 0,
    providersQueried,
    providersFailed,
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

/** Resolves discovered businesses into canonical Accounts. Dedupe is not optional. */
async function ingestDiscoveries(
  businesses: DiscoveredBusiness[], providerName: string, job: JobRecord,
): Promise<number> {
  const { upsertAccount } = await import('../domain/accounts.js');
  let created = 0;

  for (const business of businesses) {
    await withTransaction(async (client) => {
      const result = await upsertAccount(
        client,
        {
          canonicalName: business.name,
          website: business.website ?? null,
          phone: business.phone ?? null,
          city: business.city ?? null,
          state: business.state ?? null,
          postalCode: business.postalCode ?? null,
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
      if (result.created) created += 1;

      // Every discovery is recorded as an observation, separate from durable evidence:
      // six sightings of one advertiser stay six observations of one Account.
      await client.query(
        `insert into search_observations (mining_job_id, provider, source_type, observed_name,
                                          observed_domain, observed_phone, observed_location,
                                          result_type, advertised_service, landing_url,
                                          retention_class, account_id)
         values (null, $1, 'discovery', $2, $3, $4, $5, $6, $7, $8, 'transient', $9)`,
        [
          providerName, business.name, business.website ?? null, business.phone ?? null,
          [business.city, business.state].filter(Boolean).join(', ') || null,
          business.resultType ?? null, business.advertisedService ?? null,
          business.landingUrl ?? null, result.accountId,
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
  return created;
}

export { runContactResearch, config };
