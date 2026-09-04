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
  /** How deep into the SERP to read. DataForSEO pages by depth, not by offset. */
  resultDepth: number;
  /** Transient-failure retries, per provider call. */
  maxRetries: number;
  /** How many times a queued task is polled before the run gives up on it. */
  maxPollAttempts: number;
  pollIntervalMs: number;
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
    resultDepth: Number(env['DATAFORSEO_RESULT_DEPTH'] ?? '100'),
    maxRetries: Number(env['DATAFORSEO_MAX_RETRIES'] ?? '2'),
    maxPollAttempts: Number(env['DATAFORSEO_MAX_POLL_ATTEMPTS'] ?? '10'),
    pollIntervalMs: Number(env['DATAFORSEO_POLL_INTERVAL_MS'] ?? '3000'),
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
  /** 20100 = task created; 20000 = task done. Anything else is not a result. */
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
  url: string, init: {
    method: string; headers: Record<string, string>; body?: string;
  },
) => Promise<{
  ok: boolean; status: number; json: () => Promise<unknown>;
  headers?: { get(name: string): string | null };
}>;

/** Injectable so a retry or a poll costs a test nothing in wall-clock time. */
export type Sleep = (ms: number) => Promise<void>;

/**
 * Status codes worth trying again. A 429 or a 5xx is the provider asking us to wait;
 * a 401 or a 404 is a fact about the request, and repeating it just spends money.
 */
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

/** DataForSEO task status codes. 20000 done, 20100 created, 40602 still in queue. */
const TASK_DONE = 20000;
const TASK_CREATED = 20100;
const TASK_IN_QUEUE = 40602;

interface AttemptResult {
  ok: boolean;
  status: number;
  body: ProviderResponse | null;
  attempts: number;
  errorCode: string | null;
}

/**
 * One provider call, with bounded retries on transient failure.
 *
 * The delay honours Retry-After when the provider sends one, because guessing a
 * shorter wait than the provider asked for is how an account gets throttled harder.
 */
async function callWithRetry(
  transport: Transport, sleep: Sleep, config: DataForSeoConfig,
  url: string, init: { method: string; headers: Record<string, string>; body?: string },
): Promise<AttemptResult> {
  let attempts = 0;
  let lastStatus = 0;
  let lastError: string | null = null;

  while (attempts <= config.maxRetries) {
    attempts += 1;
    try {
      const raw = await transport(url, init);
      lastStatus = raw.status;
      if (raw.ok) {
        const body = await raw.json() as ProviderResponse;
        return { ok: true, status: raw.status, body, attempts, errorCode: null };
      }
      if (!RETRYABLE_HTTP.has(raw.status) || attempts > config.maxRetries) {
        return {
          ok: false, status: raw.status, body: null, attempts,
          errorCode: `HTTP_${raw.status}`,
        };
      }
      const retryAfter = Number(raw.headers?.get('retry-after') ?? '');
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1_000
        // Exponential, from the poll interval, so one config controls the pace.
        : config.pollIntervalMs * attempts);
    } catch (error) {
      lastError = (error as Error).name || 'TRANSPORT_ERROR';
      if (attempts > config.maxRetries) break;
      await sleep(config.pollIntervalMs * attempts);
    }
  }
  return {
    ok: false, status: lastStatus, body: null, attempts,
    errorCode: lastError ?? (lastStatus ? `HTTP_${lastStatus}` : 'TRANSPORT_ERROR'),
  };
}

/** True when the task carries results rather than only an acknowledgement. */
function taskHasResults(task: ProviderTask | undefined): boolean {
  if (!task) return false;
  if (task.status_code !== undefined && task.status_code !== TASK_DONE) return false;
  return (task.result ?? []).some((result) => (result.items ?? []).length > 0);
}

export function createDataForSeoAdapter(options: {
  config?: DataForSeoConfig; transport?: Transport; sleep?: Sleep;
} = {}): DiscoveryAdapter {
  const config = options.config ?? dataForSeoConfig();
  const transport = options.transport
    ?? ((url, init) => fetch(url, init) as unknown as ReturnType<Transport>);
  const sleep = options.sleep
    ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));

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
      const auth = Buffer.from(`${config.login}:${config.password}`).toString('base64');
      const headers = {
        authorization: `Basic ${auth}`, 'content-type': 'application/json',
      };
      // depth is how DataForSEO pages a SERP: one request, N results deep. There is
      // no offset to walk, so asking for a page we do not want costs the same as
      // asking for the one we do.
      const task = {
        keyword,
        location_name: request.geographyValue,
        language_code: 'en',
        device: 'desktop',
        depth: Math.max(10, Math.min(700, config.resultDepth)),
      };

      // Live and Standard are different endpoints, not a priority flag on one.
      // Standard queues the task and answers with an id; the results have to be
      // fetched afterwards. Treating the task_post acknowledgement as a result set
      // is why this used to find nothing at all in the mode it defaults to.
      let response: ProviderResponse;
      let pollUnits = 0;

      if (config.mode === 'live') {
        const live = await callWithRetry(transport, sleep, config,
          `${config.baseUrl}/serp/google/organic/live/advanced`,
          { method: 'POST', headers, body: JSON.stringify([task]) });
        if (!live.ok || !live.body) {
          await recordProviderUsage({
            operation: 'serp.discover.live', units: live.attempts, status: 'FAILED',
            errorCode: live.errorCode });
          return [];
        }
        response = live.body;
      } else {
        const posted = await callWithRetry(transport, sleep, config,
          `${config.baseUrl}/serp/google/organic/task_post`,
          { method: 'POST', headers, body: JSON.stringify([{ ...task, priority: 1 }]) });
        if (!posted.ok || !posted.body) {
          await recordProviderUsage({
            operation: 'serp.discover.task_post', units: posted.attempts, status: 'FAILED',
            errorCode: posted.errorCode });
          return [];
        }
        const created = (posted.body.tasks ?? [])[0];
        const taskId = created?.id;
        if (!taskId) {
          await recordProviderUsage({
            operation: 'serp.discover.task_post', units: posted.attempts, status: 'FAILED',
            errorCode: `NO_TASK_ID_${created?.status_code ?? 'UNKNOWN'}` });
          return [];
        }
        // A task that was posted but never collected is still a task we paid for, so
        // the poll is bounded and its outcome is recorded either way.
        let fetched: ProviderResponse | null = null;
        for (let attempt = 1; attempt <= Math.max(1, config.maxPollAttempts); attempt += 1) {
          const got = await callWithRetry(transport, sleep, config,
            `${config.baseUrl}/serp/google/organic/task_get/advanced/${taskId}`,
            { method: 'GET', headers });
          pollUnits += got.attempts;
          if (!got.ok || !got.body) {
            await recordProviderUsage({
              operation: 'serp.discover.task_get', units: pollUnits, status: 'FAILED',
              errorCode: got.errorCode });
            return [];
          }
          const first = (got.body.tasks ?? [])[0];
          const code = first?.status_code;
          if (taskHasResults(first) || code === TASK_DONE) { fetched = got.body; break; }
          if (code !== undefined && code !== TASK_CREATED && code !== TASK_IN_QUEUE) {
            await recordProviderUsage({
              operation: 'serp.discover.task_get', units: pollUnits, status: 'FAILED',
              errorCode: `TASK_${code}` });
            return [];
          }
          if (attempt < config.maxPollAttempts) await sleep(config.pollIntervalMs);
        }
        if (!fetched) {
          // No results and no error: the task is still queued. Nothing is invented,
          // and the run says why it came back empty.
          await recordProviderUsage({
            operation: 'serp.discover.task_get', units: pollUnits, status: 'FAILED',
            errorCode: 'TASK_NOT_READY' });
          return [];
        }
        response = fetched;
      }

      const observations = normalizeResponse(response, { query: keyword });
      await recordProviderUsage({
        operation: config.mode === 'live' ? 'serp.discover.live' : 'serp.discover.task_get',
        units: 1, status: 'OK',
        actualCostUsd: typeof response.cost === 'number' ? response.cost : null,
      });

      // Only results that identify a business become candidates. A block we could not
      // classify, or a title with nothing to resolve it against, cannot become an
      // Account: entity resolution has nothing to work with and a rep would be handed
      // a company that may not exist.
      return dedupeCandidates(observations
        .filter((observation) => CANDIDATE_TYPES.has(observation.resultType))
        .filter((observation) =>
          observation.observedDomain || (observation.observedName && observation.observedPhone)));
    },
  };
}


/**
 * One company per discover(), not one per SERP row.
 *
 * A business that buys the top ad and also ranks organically appears twice in the
 * same response. Handing both up produces two candidates for one company, and the
 * paid one is the interesting one -- so the rows are collapsed on identity and the
 * paid placement wins, keeping the ad copy and the landing page that came with it.
 *
 * Identity here is the domain, or the phone when there is no domain. Anything
 * subtler than that belongs to entity resolution, which runs later with more to go
 * on than a single search page.
 */
export function dedupeCandidates(
  observations: NormalizedObservation[],
): DiscoveredBusiness[] {
  const byIdentity = new Map<string, NormalizedObservation>();

  for (const observation of observations) {
    const identity = observation.observedDomain ?? observation.observedPhone;
    if (!identity) continue;
    const held = byIdentity.get(identity);
    if (!held) { byIdentity.set(identity, observation); continue; }

    const heldPaid = isPaidPlacement(held.resultType);
    const paid = isPaidPlacement(observation.resultType);
    if (paid && !heldPaid) { byIdentity.set(identity, observation); continue; }
    if (paid === heldPaid) {
      // Same class: keep whichever sat higher on the page.
      const heldRank = held.position ?? Number.MAX_SAFE_INTEGER;
      const rank = observation.position ?? Number.MAX_SAFE_INTEGER;
      if (rank < heldRank) byIdentity.set(identity, observation);
    }
    // A paid row already held is never displaced by an organic one.
  }

  return [...byIdentity.values()].map((observation) => ({
    name: observation.observedName ?? observation.observedDomain!,
    website: observation.observedDomain ? `https://${observation.observedDomain}` : null,
    phone: observation.observedPhone,
    city: null, state: null, postalCode: null,
    providerNativeId: observation.providerNativeId,
    resultType: observation.resultType,
    advertisedService: observation.advertisedService,
    landingUrl: observation.landingUrl,
  }));
}
