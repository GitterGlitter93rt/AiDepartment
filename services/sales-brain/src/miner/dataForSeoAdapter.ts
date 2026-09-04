import { query } from '../db/pool.js';
import type { DiscoveredBusiness, DiscoveryAdapter, DiscoveryQuery } from '../workers/marketMiner.js';

/**
 * DataForSEO SERP adapter — the first discovery provider to integrate and benchmark.
 * Authority: market-miner-serp-provider-selection-current.md,
 * market-miner-google-serp-normalization-spec.md §2-§4.
 *
 * Two rules shape this file:
 *
 *  - product logic must not learn the provider's response shape, so everything the
 *    orchestrator sees is normalized here and nothing DataForSEO-specific escapes;
 *  - a paid result observed once is an observation, never a standing claim that a
 *    company advertises. Freshness and evidence rules decide that elsewhere.
 *
 * The adapter reports itself unconfigured until both the credential and the source
 * governance review exist, so registering it cannot start traffic by accident.
 */

const DEFAULT_BASE_URL = 'https://api.dataforseo.com/v3';

/** Result types this product understands, per the normalization spec §2. */
export type NormalizedResultType =
  | 'PAID_SEARCH_TEXT' | 'PAID_LOCAL' | 'LOCAL_SERVICES_AD' | 'SHOPPING_OR_IRRELEVANT_PAID'
  | 'LOCAL_ORGANIC' | 'ORGANIC' | 'MAPS_LOCAL' | 'KNOWLEDGE_OR_ENTITY' | 'OTHER';

/**
 * Provider item types mapped to ours. An unmapped type becomes OTHER rather than
 * being guessed into a paid observation, which would manufacture ad evidence.
 */
const TYPE_MAP: Record<string, NormalizedResultType> = {
  paid: 'PAID_SEARCH_TEXT',
  ads: 'PAID_SEARCH_TEXT',
  google_ads: 'PAID_SEARCH_TEXT',
  local_services: 'LOCAL_SERVICES_AD',
  local_service_ads: 'LOCAL_SERVICES_AD',
  local_pack: 'MAPS_LOCAL',
  local_pack_paid: 'PAID_LOCAL',
  maps_search: 'MAPS_LOCAL',
  shopping: 'SHOPPING_OR_IRRELEVANT_PAID',
  paid_shopping: 'SHOPPING_OR_IRRELEVANT_PAID',
  organic: 'ORGANIC',
  local_organic: 'LOCAL_ORGANIC',
  knowledge_graph: 'KNOWLEDGE_OR_ENTITY',
};

export function normalizeResultType(providerType: string | null | undefined): NormalizedResultType {
  if (!providerType) return 'OTHER';
  return TYPE_MAP[providerType.toLowerCase()] ?? 'OTHER';
}

/**
 * Result types that can become a prospect. An unclassified block, a knowledge panel
 * or a shopping ad is an observation worth keeping but not a company to research.
 */
const CANDIDATE_TYPES = new Set<NormalizedResultType>([
  'PAID_SEARCH_TEXT', 'PAID_LOCAL', 'LOCAL_SERVICES_AD', 'LOCAL_ORGANIC', 'ORGANIC', 'MAPS_LOCAL',
]);

/** Only these types are evidence that somebody paid for placement. */
export function isPaidPlacement(type: NormalizedResultType): boolean {
  return type === 'PAID_SEARCH_TEXT' || type === 'PAID_LOCAL' || type === 'LOCAL_SERVICES_AD';
}

export interface DataForSeoConfig {
  login: string | null;
  password: string | null;
  baseUrl: string;
  /** Queued/Standard by default; Live only for small on-demand validation. */
  mode: 'standard' | 'live';
  /** Set true only once the source governance review is signed off. */
  governanceReviewed: boolean;
  enabled: boolean;
  /** Hard ceiling on provider calls per run, independent of the caller's request. */
  maxQueriesPerRun: number;
}

export function dataForSeoConfig(env: NodeJS.ProcessEnv = process.env): DataForSeoConfig {
  return {
    login: env['DATAFORSEO_LOGIN'] ?? null,
    password: env['DATAFORSEO_PASSWORD'] ?? null,
    baseUrl: env['DATAFORSEO_BASE_URL'] ?? DEFAULT_BASE_URL,
    mode: env['DATAFORSEO_MODE'] === 'live' ? 'live' : 'standard',
    governanceReviewed: env['DATAFORSEO_GOVERNANCE_REVIEWED'] === 'true',
    enabled: env['DATAFORSEO_ENABLED'] === 'true',
    maxQueriesPerRun: Number(env['DATAFORSEO_MAX_QUERIES_PER_RUN'] ?? '25'),
  };
}

/** The provider response shape, kept in one place so nothing else depends on it. */
export interface ProviderItem {
  type?: string;
  rank_absolute?: number;
  rank_group?: number;
  title?: string;
  domain?: string;
  url?: string;
  breadcrumb?: string;
  description?: string;
  phone?: string;
  address?: string;
  advertiser_id?: string;
}

export interface ProviderTask {
  id?: string;
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: {
    keyword?: string;
    location_code?: number;
    location_name?: string;
    language_code?: string;
    check_url?: string;
    datetime?: string;
    items?: ProviderItem[];
  }[];
}

export interface ProviderResponse {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: ProviderTask[];
}

export interface NormalizedObservation {
  providerNativeId: string | null;
  observedName: string | null;
  observedDomain: string | null;
  observedPhone: string | null;
  observedLocation: string | null;
  resultType: NormalizedResultType;
  position: number | null;
  adHeadline: string | null;
  landingUrl: string | null;
  advertisedService: string | null;
  checkUrl: string | null;
  observedAt: Date;
  query: string;
}

/**
 * Turns a provider response into observations.
 *
 * Nothing is inferred that the response did not contain: a missing domain stays
 * null rather than being derived from a display URL that might belong to a
 * different company.
 */
export function normalizeResponse(
  response: ProviderResponse, context: { query: string; observedAt?: Date },
): NormalizedObservation[] {
  const observations: NormalizedObservation[] = [];
  for (const task of response.tasks ?? []) {
    for (const result of task.result ?? []) {
      const observedAt = context.observedAt
        ?? (result.datetime ? new Date(result.datetime) : new Date());
      for (const item of result.items ?? []) {
        const type = normalizeResultType(item.type);
        observations.push({
          providerNativeId: item.advertiser_id ?? task.id ?? null,
          observedName: item.title?.trim() || null,
          observedDomain: item.domain?.trim().toLowerCase() || null,
          observedPhone: item.phone?.trim() || null,
          observedLocation: result.location_name ?? item.address ?? null,
          resultType: type,
          position: item.rank_absolute ?? item.rank_group ?? null,
          adHeadline: isPaidPlacement(type) ? (item.title?.trim() || null) : null,
          landingUrl: item.url ?? null,
          advertisedService: isPaidPlacement(type) ? (result.keyword ?? context.query) : null,
          checkUrl: result.check_url ?? null,
          observedAt: Number.isNaN(observedAt.getTime()) ? new Date() : observedAt,
          query: result.keyword ?? context.query,
        });
      }
    }
  }
  return observations;
}

/**
 * Records what the provider was asked for and what it cost.
 * Written whether the call succeeded or failed: an error that cost nothing still
 * has to appear in the usage record, or a failing provider looks free.
 */
export async function recordProviderUsage(input: {
  operation: string; miningJobId?: string | null; units: number;
  estimatedCostUsd?: number | null; actualCostUsd?: number | null;
  status: 'OK' | 'FAILED' | 'REFUSED'; errorCode?: string | null;
}): Promise<void> {
  await query(
    `insert into provider_usage
       (provider, operation, mining_job_id, requested_at, completed_at, units,
        estimated_cost_usd, actual_cost_usd, status, error_code)
     values ('dataforseo', $1, $2, now(), now(), $3, $4, $5, $6, $7)`,
    [input.operation, input.miningJobId ?? null, input.units,
     input.estimatedCostUsd ?? 0, input.actualCostUsd ?? null,
     input.status, input.errorCode ?? null],
  );
}

/** Injectable so the adapter is testable without a network or a credential. */
export type Transport = (
  url: string, init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export function createDataForSeoAdapter(options: {
  config?: DataForSeoConfig; transport?: Transport;
} = {}): DiscoveryAdapter {
  const config = options.config ?? dataForSeoConfig();
  const transport = options.transport
    ?? ((url, init) => fetch(url, init) as unknown as ReturnType<Transport>);

  return {
    name: 'dataforseo',
    requiresCredential: true,
    governanceReviewed: config.governanceReviewed,

    isConfigured(): boolean {
      // Enabled, credentialed and reviewed. Any one missing means no traffic.
      return Boolean(config.enabled && config.login && config.password && config.governanceReviewed);
    },

    async discover(request: DiscoveryQuery): Promise<DiscoveredBusiness[]> {
      if (!this.isConfigured()) {
        await recordProviderUsage({
          operation: 'serp.discover', units: 0, status: 'REFUSED',
          errorCode: !config.governanceReviewed ? 'GOVERNANCE_REVIEW_MISSING' : 'NOT_CONFIGURED',
        });
        return [];
      }

      const budget = Math.max(0, Math.min(request.queryBudget, config.maxQueriesPerRun));
      if (budget === 0) {
        await recordProviderUsage({
          operation: 'serp.discover', units: 0, status: 'REFUSED', errorCode: 'BUDGET_EXHAUSTED' });
        return [];
      }

      const keyword = [request.miningMode, request.verticalProfileId, request.geographyValue]
        .filter(Boolean).join(' ');
      const endpoint = `${config.baseUrl}/serp/google/organic/task_post`;
      const auth = Buffer.from(`${config.login}:${config.password}`).toString('base64');

      let response: ProviderResponse;
      try {
        const raw = await transport(endpoint, {
          method: 'POST',
          headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
          body: JSON.stringify([{
            keyword,
            location_name: request.geographyValue,
            language_code: 'en',
            device: 'desktop',
            // Queued by default; Live is for small on-demand validation only.
            priority: config.mode === 'live' ? 2 : 1,
          }]),
        });
        if (!raw.ok) {
          await recordProviderUsage({
            operation: 'serp.discover', units: 1, status: 'FAILED',
            errorCode: `HTTP_${raw.status}` });
          return [];
        }
        response = await raw.json() as ProviderResponse;
      } catch (error) {
        await recordProviderUsage({
          operation: 'serp.discover', units: 1, status: 'FAILED',
          errorCode: (error as Error).name || 'TRANSPORT_ERROR' });
        return [];
      }

      const observations = normalizeResponse(response, { query: keyword });
      await recordProviderUsage({
        operation: 'serp.discover', units: 1, status: 'OK',
        actualCostUsd: typeof response.cost === 'number' ? response.cost : null,
      });

      // Only results that identify a business become candidates. A block we could not
      // classify, or a title with nothing to resolve it against, cannot become an
      // Account: entity resolution has nothing to work with and a rep would be handed
      // a company that may not exist.
      return observations
        .filter((observation) => CANDIDATE_TYPES.has(observation.resultType))
        .filter((observation) =>
          observation.observedDomain || (observation.observedName && observation.observedPhone))
        .map((observation) => ({
          name: observation.observedName ?? observation.observedDomain!,
          website: observation.observedDomain ? `https://${observation.observedDomain}` : null,
          phone: observation.observedPhone,
          city: null, state: null, postalCode: null,
          providerNativeId: observation.providerNativeId,
          resultType: observation.resultType,
          advertisedService: observation.advertisedService,
          landingUrl: observation.landingUrl,
        }));
    },
  };
}
