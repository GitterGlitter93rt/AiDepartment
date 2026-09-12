import { query } from '../db/pool.js';
import { flag, numeric } from '../config.js';
import {
  isPaidPlacement,
  type NormalizedResultType, type ProviderObservation,
} from '../discovery/observation.js';
import {
  refusedDiscovery,
  type DiscoveryAdapter, type DiscoveryQuery,
  type DiscoveryResult, type DiscoveryStatus,
} from '../workers/marketMiner.js';

export type { NormalizedResultType, ProviderObservation };
export { isPaidPlacement };

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
    governanceReviewed: flag('DATAFORSEO_GOVERNANCE_REVIEWED', false, env),
    enabled: flag('DATAFORSEO_ENABLED', false, env),
    maxQueriesPerRun: numeric('DATAFORSEO_MAX_QUERIES_PER_RUN', 25, { env, min: 1 }),
    resultDepth: numeric('DATAFORSEO_RESULT_DEPTH', 100, { env, min: 1 }),
    maxRetries: numeric('DATAFORSEO_MAX_RETRIES', 2, { env }),
    maxPollAttempts: numeric('DATAFORSEO_MAX_POLL_ATTEMPTS', 10, { env, min: 1 }),
    pollIntervalMs: numeric('DATAFORSEO_POLL_INTERVAL_MS', 3000, { env }),
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
  /** Free-form, as the provider printed it. */
  address?: string;
  /**
   * The same address in parts, when the provider resolved it.
   *
   * Only used when the provider supplies the discrete fields. A free-form line is
   * never split into a city and a ZIP here: "Suite 4, 120 King St, St. Augustine FL"
   * parsed badly is a company filed under the wrong market, and a wrong address is
   * worse than a missing one because nothing later looks at it again.
   */
  address_info?: {
    address?: string; city?: string; region?: string; zip?: string;
    country_code?: string; borough?: string;
  };
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

/**
 * The adapter's output shape is the product's, not the provider's.
 *
 * Kept as an alias so a reader of this file can see what `normalizeResponse` returns
 * without following an import: the definition lives in `discovery/observation.ts`
 * because the orchestrator, not this adapter, decides what an observation means.
 */
export type NormalizedObservation = ProviderObservation;

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
          // The provider's id for *this business*, or nothing.
          //
          // This used to fall back to the task id, which identifies the search. Every
          // row in one response carries the same one, and account resolution matches
          // on provider identity before it looks at domain or phone -- so a search
          // that found twenty companies resolved all twenty to whichever was ingested
          // first, and reported the other nineteen as "already in inventory". None of
          // the existing fixtures could show it because they all set advertiser_id;
          // real organic and paid SERP items do not carry one at all.
          providerNativeId: item.advertiser_id?.trim() || null,
          observedName: item.title?.trim() || null,
          observedDomain: item.domain?.trim().toLowerCase() || null,
          observedPhone: item.phone?.trim() || null,
          // Kept apart, never coalesced.
          //
          // This was `result.location_name ?? item.address`, which is two different
          // facts with the search target winning. `location_name` is where we asked
          // the provider to search -- "St. Augustine,Florida,United States" -- and it
          // is present on every row of every response, so a business's own address
          // could never win the coalesce. The classifier then read that field as
          // evidence a Maps row identified a business, which meant the geography we
          // typed helped verify the entity.
          observedBusinessAddress: item.address?.trim()
            || item.address_info?.address?.trim() || null,
          // Parts only when the provider resolved them itself.
          observedCity: item.address_info?.city?.trim() || null,
          observedRegion: item.address_info?.region?.trim() || null,
          observedPostalCode: item.address_info?.zip?.trim() || null,
          searchLocationName: result.location_name ?? null,
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

/**
 * Which kind of failure this was, in the orchestrator's vocabulary.
 *
 * A 401 is a fact about the credential, a 429 is the provider asking us to wait, a
 * 5xx is the provider being down, and a dropped socket is a timeout. They lead to
 * different operator actions, so they are not one 'error'.
 */
function statusForError(errorCode: string | null, httpStatus: number): DiscoveryStatus {
  if (httpStatus === 401 || httpStatus === 403) return 'CREDENTIALS_INVALID';
  if (httpStatus === 429) return 'RATE_LIMITED';
  if (httpStatus === 408 || errorCode === 'AbortError' || errorCode === 'TimeoutError') return 'TIMEOUT';
  if (httpStatus >= 500) return 'OUTAGE';
  if (errorCode === 'TRANSPORT_ERROR' || httpStatus === 0) return 'OUTAGE';
  return 'OUTAGE';
}

/** True when the task carries results rather than only an acknowledgement. */
function taskHasResults(task: ProviderTask | undefined): boolean {
  if (!task) return false;
  if (task.status_code !== undefined && task.status_code !== TASK_DONE) return false;
  return (task.result ?? []).some((result) => (result.items ?? []).length > 0);
}

/**
 * One provider response, read the same way whether it arrived from a live call or
 * from collecting a task submitted an hour ago.
 *
 * Only results that identify a business become candidates. A block we could not
 * classify, or a title with nothing to resolve it against, cannot become an Account:
 * entity resolution has nothing to work with and a rep would be handed a company
 * that may not exist.
 */
function resultFromResponse(
  response: ProviderResponse, keyword: string, cost: number | null,
): DiscoveryResult {
  const observations = normalizeResponse(response, { query: keyword });
  return {
    // The provider answered. Whether the answer contains a business is not this
    // adapter's question and it no longer guesses at one: the orchestrator resolves
    // the rows and downgrades this to ZERO_RESULTS when nothing promotes.
    status: 'OK',
    observations,
    costUsd: cost,
  };
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
    mode: config.mode,

    isConfigured(): boolean {
      // Enabled, credentialed and reviewed. Any one missing means no traffic.
      return Boolean(config.enabled && config.login && config.password && config.governanceReviewed);
    },

    /**
      * One discovery run.
      *
      * Every exit says why. This used to return an empty array for a missing
      * credential, a 401, a timeout, a task still in the provider's queue and an
      * exhausted budget alike, and the orchestrator read all five as "the provider
      * was asked and this market has nothing in it".
      */
    async discover(request: DiscoveryQuery): Promise<DiscoveryResult> {
      if (!this.isConfigured()) {
        const blocked = !config.governanceReviewed && Boolean(config.login && config.password);
        await recordProviderUsage({
          operation: 'serp.discover', units: 0, status: 'REFUSED',
          errorCode: blocked ? 'GOVERNANCE_REVIEW_MISSING' : 'NOT_CONFIGURED',
        });
        return refusedDiscovery(
          blocked ? 'GOVERNANCE_BLOCKED' : 'NOT_CONFIGURED',
          blocked
            ? 'The credential is present but the source governance review is not signed, '
              + 'so no search was made.'
            : 'No DataForSEO credential is configured, so no search was made.');
      }

      const budget = Math.max(0, Math.min(request.queryBudget, config.maxQueriesPerRun));
      if (budget === 0) {
        await recordProviderUsage({
          operation: 'serp.discover', units: 0, status: 'REFUSED', errorCode: 'BUDGET_EXHAUSTED' });
        return refusedDiscovery('BUDGET_EXHAUSTED',
          'The query budget for this run is zero, so no search was made.');
      }

      // The one search this call is for.
      //
      // The adapter used to plan for itself: read the taxonomy, order it, slice it
      // to the budget, then ask the provider for element zero. Two things were wrong
      // with that. A budget of twenty-five bought exactly one search, so a market was
      // judged on one question. And the orchestrator, which owns fingerprints and
      // provider tasks, could not know which words were bought -- so N searches could
      // never have had N task lifecycles even if N had run.
      //
      // Planning now happens once, in the orchestrator, before any money moves.
      const search = request.search;
      if (!search) {
        await recordProviderUsage({
          operation: 'serp.discover', units: 0, status: 'REFUSED', errorCode: 'NO_SEARCH_PLANNED' });
        return refusedDiscovery('NOT_CONFIGURED',
          'This adapter was called without a planned search. Discovery plans its queries '
          + 'before it spends, so a call with no query is a bug rather than an empty market.');
      }

      const keyword = search.keyword;
      const target = { locationName: search.locationName };
      const auth = Buffer.from(`${config.login}:${config.password}`).toString('base64');
      const headers = {
        authorization: `Basic ${auth}`, 'content-type': 'application/json',
      };
      // depth is how DataForSEO pages a SERP: one request, N results deep. There is
      // no offset to walk, so asking for a page we do not want costs the same as
      // asking for the one we do.
      const task = {
        keyword,
        location_name: target.locationName,
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
          return refusedDiscovery(statusForError(live.errorCode, live.status),
            `The provider did not answer: ${live.errorCode ?? `HTTP ${live.status}`}.`);
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
          return refusedDiscovery(statusForError(posted.errorCode, posted.status),
            `The search could not be submitted: ${posted.errorCode ?? `HTTP ${posted.status}`}.`);
        }
        const created = (posted.body.tasks ?? [])[0];
        const taskId = created?.id;
        if (!taskId) {
          await recordProviderUsage({
            operation: 'serp.discover.task_post', units: posted.attempts, status: 'FAILED',
            errorCode: `NO_TASK_ID_${created?.status_code ?? 'UNKNOWN'}` });
          return refusedDiscovery('MALFORMED',
            'The provider accepted the request without returning a task id, so there is '
            + 'nothing to collect.');
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
            return {
              ...refusedDiscovery(statusForError(got.errorCode, got.status),
                `The search was submitted but its results could not be collected: `
                + `${got.errorCode ?? `HTTP ${got.status}`}.`),
              // The task id survives the failure. It was paid for, and collecting it
              // later is cheaper and more honest than submitting the search again.
              providerTaskId: taskId,
            };
          }
          const first = (got.body.tasks ?? [])[0];
          const code = first?.status_code;
          if (taskHasResults(first) || code === TASK_DONE) { fetched = got.body; break; }
          if (code !== undefined && code !== TASK_CREATED && code !== TASK_IN_QUEUE) {
            await recordProviderUsage({
              operation: 'serp.discover.task_get', units: pollUnits, status: 'FAILED',
              errorCode: `TASK_${code}` });
            return {
              ...refusedDiscovery('MALFORMED',
                `The provider reported task status ${code}, which is not a result.`),
              providerTaskId: taskId,
            };
          }
          if (attempt < config.maxPollAttempts) await sleep(config.pollIntervalMs);
        }
        if (!fetched) {
          // No results and no error: the task is still queued. It is PENDING, not
          // empty -- the money is spent and the answer is still coming -- and the
          // task id goes back with it so a later run collects this one rather than
          // paying for a second search of the same market.
          await recordProviderUsage({
            operation: 'serp.discover.task_get', units: pollUnits, status: 'FAILED',
            errorCode: 'TASK_NOT_READY' });
          return {
            ...refusedDiscovery('PENDING',
              'The provider accepted the search and has not finished it yet. The task is '
              + 'recorded and will be collected rather than submitted again.'),
            providerTaskId: taskId,
          };
        }
        response = fetched;
      }

      const cost = typeof response.cost === 'number' ? response.cost : null;
      await recordProviderUsage({
        operation: config.mode === 'live' ? 'serp.discover.live' : 'serp.discover.task_get',
        units: 1, status: 'OK', actualCostUsd: cost,
      });
      return resultFromResponse(response, keyword, cost);
    },

    /**
     * Collects a task submitted by an earlier run, possibly by an earlier process.
     *
     * One request, not a poll loop: the run that submitted this already waited, and
     * a job that sits here waiting again is a lease held for no reason. If it is
     * still not ready it stays PENDING and the next run asks again.
     */
    async collect(providerTaskId: string, request: DiscoveryQuery): Promise<DiscoveryResult> {
      if (!this.isConfigured()) {
        return refusedDiscovery('NOT_CONFIGURED',
          'The provider is no longer configured, so a task it accepted cannot be collected.');
      }
      const auth = Buffer.from(`${config.login}:${config.password}`).toString('base64');
      const got = await callWithRetry(transport, sleep, config,
        `${config.baseUrl}/serp/google/organic/task_get/advanced/${providerTaskId}`,
        { method: 'GET', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' } });

      if (!got.ok || !got.body) {
        await recordProviderUsage({
          operation: 'serp.discover.task_collect', units: got.attempts, status: 'FAILED',
          errorCode: got.errorCode });
        return {
          ...refusedDiscovery(statusForError(got.errorCode, got.status),
            `Collecting the submitted search failed: ${got.errorCode ?? `HTTP ${got.status}`}.`),
          providerTaskId,
        };
      }

      const first = (got.body.tasks ?? [])[0];
      const code = first?.status_code;
      if (!taskHasResults(first) && (code === TASK_CREATED || code === TASK_IN_QUEUE)) {
        return {
          ...refusedDiscovery('PENDING',
            'The provider has still not finished this search. It is recorded and will be '
            + 'collected rather than submitted again.'),
          providerTaskId,
        };
      }
      if (code !== undefined && code !== TASK_DONE && !taskHasResults(first)) {
        await recordProviderUsage({
          operation: 'serp.discover.task_collect', units: got.attempts, status: 'FAILED',
          errorCode: `TASK_${code}` });
        return {
          ...refusedDiscovery('MALFORMED',
            `The provider reported task status ${code}, which is not a result.`),
          providerTaskId,
        };
      }

      const cost = typeof got.body.cost === 'number' ? got.body.cost : null;
      await recordProviderUsage({
        operation: 'serp.discover.task_collect', units: 1, status: 'OK', actualCostUsd: cost });
      const keyword = String((request as { keyword?: string }).keyword
        ?? first?.result?.[0]?.keyword ?? '');
      return { ...resultFromResponse(got.body, keyword, cost), providerTaskId };
    },
  };
}
