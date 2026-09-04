import { query } from '../db/pool.js';
import { normalizePhone } from '../domain/normalize.js';

/**
 * Twilio Lookup line-type adapter.
 * Authority: outbound-sales-brain-twilio-lookup-line-type-adapter-spec.md.
 *
 * Three rules the whole module exists to hold:
 *
 *  1. line type is telecom service, not ownership. A `mobile` result does not prove
 *     the number is personal, belongs to the named contact, or that consent exists.
 *     Nothing here writes an eligibility decision — it produces an input.
 *  2. a provider outage is never inferred into a line type. An error is an error and
 *     the type stays UNKNOWN, which the database enforces as well as this code.
 *  3. a paid lookup is not made where a free check already answers. An unparseable
 *     number is refused before it costs anything, and a fresh cached result is used.
 */

export type NormalizedLineType =
  | 'LANDLINE' | 'MOBILE' | 'FIXED_VOIP' | 'NON_FIXED_VOIP' | 'PERSONAL' | 'TOLL_FREE'
  | 'PREMIUM' | 'SHARED_COST' | 'UNIVERSAL_ACCESS' | 'VOICEMAIL' | 'PAGER' | 'UNKNOWN';

export type LookupStatus =
  | 'SUCCESS' | 'INVALID_NUMBER' | 'AUTH_FAILED' | 'RATE_LIMITED'
  | 'UNSUPPORTED_COVERAGE' | 'TIMEOUT' | 'PROVIDER_ERROR';

/** Provider vocabulary to ours. An unrecognised value becomes UNKNOWN, never a guess. */
const TYPE_MAP: Record<string, NormalizedLineType> = {
  landline: 'LANDLINE',
  mobile: 'MOBILE',
  fixedvoip: 'FIXED_VOIP',
  nonfixedvoip: 'NON_FIXED_VOIP',
  personal: 'PERSONAL',
  tollfree: 'TOLL_FREE',
  premium: 'PREMIUM',
  sharedcost: 'SHARED_COST',
  uan: 'UNIVERSAL_ACCESS',
  voicemail: 'VOICEMAIL',
  pager: 'PAGER',
  unknown: 'UNKNOWN',
};

export function normalizeLineType(providerType: string | null | undefined): NormalizedLineType {
  if (!providerType) return 'UNKNOWN';
  return TYPE_MAP[providerType.replace(/[\s_-]/g, '').toLowerCase()] ?? 'UNKNOWN';
}

export interface LineTypeResult {
  status: LookupStatus;
  normalizedLineType: NormalizedLineType;
  providerOriginalType: string | null;
  carrierName: string | null;
  mobileCountryCode: string | null;
  mobileNetworkCode: string | null;
  errorCode: string | null;
  checkedAt: Date;
  refreshBy: Date;
  providerRequestReference: string | null;
  wasCacheHit: boolean;
  costUsd: number;
}

export interface LineTypeConfig {
  accountSid: string | null;
  authToken: string | null;
  baseUrl: string;
  enabled: boolean;
  /** How long a result stays usable before a rescreen (§11). */
  cacheDays: number;
  /** What a lookup is charged, for usage accounting. Configuration, not a claim. */
  costPerLookupUsd: number;
}

export function lineTypeConfig(env: NodeJS.ProcessEnv = process.env): LineTypeConfig {
  return {
    accountSid: env['TWILIO_ACCOUNT_SID'] ?? null,
    authToken: env['TWILIO_AUTH_TOKEN'] ?? null,
    baseUrl: env['TWILIO_LOOKUP_BASE_URL'] ?? 'https://lookups.twilio.com/v2',
    enabled: env['TWILIO_LOOKUP_ENABLED'] === 'true',
    cacheDays: Number(env['TWILIO_LOOKUP_CACHE_DAYS'] ?? '90'),
    costPerLookupUsd: Number(env['TWILIO_LOOKUP_COST_USD'] ?? '0.008'),
  };
}

export type Transport = (
  url: string, init: { method: string; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

interface LookupResponse {
  phone_number?: string;
  valid?: boolean;
  line_type_intelligence?: {
    type?: string;
    carrier_name?: string;
    mobile_country_code?: string;
    mobile_network_code?: string;
    error_code?: number | string | null;
  };
}

export interface LineTypeAdapter {
  isConfigured(): boolean;
  /** Looks the number up, using a fresh cached result where one exists. */
  screen(input: { phone: string; endpointId?: string | null; now?: Date }): Promise<LineTypeResult>;
}

const NOT_CONFIGURED = (now: Date, cacheDays: number): LineTypeResult => ({
  status: 'AUTH_FAILED', normalizedLineType: 'UNKNOWN', providerOriginalType: null,
  carrierName: null, mobileCountryCode: null, mobileNetworkCode: null,
  errorCode: 'NOT_CONFIGURED', checkedAt: now,
  refreshBy: new Date(now.getTime() + cacheDays * 24 * 60 * 60 * 1000),
  providerRequestReference: null, wasCacheHit: false, costUsd: 0,
});

export function createTwilioLookupAdapter(options: {
  config?: LineTypeConfig; transport?: Transport;
} = {}): LineTypeAdapter {
  const config = options.config ?? lineTypeConfig();
  const transport = options.transport
    ?? ((url, init) => fetch(url, init) as unknown as ReturnType<Transport>);

  return {
    isConfigured: () => Boolean(config.enabled && config.accountSid && config.authToken),

    async screen({ phone, endpointId, now = new Date() }) {
      const refreshBy = new Date(now.getTime() + config.cacheDays * 24 * 60 * 60 * 1000);

      // Free validation first: an unparseable number cannot be looked up, and paying
      // to be told so is waste (§9).
      const normalized = normalizePhone(phone);
      if (!normalized) {
        const invalid: LineTypeResult = {
          status: 'INVALID_NUMBER', normalizedLineType: 'UNKNOWN', providerOriginalType: null,
          carrierName: null, mobileCountryCode: null, mobileNetworkCode: null,
          errorCode: 'UNPARSEABLE', checkedAt: now, refreshBy,
          providerRequestReference: null, wasCacheHit: false, costUsd: 0,
        };
        await persist(invalid, phone, endpointId ?? null, config);
        return invalid;
      }

      const cached = await readCache(normalized, config, now);
      if (cached) {
        // A cache hit is still a request the operator made, and it has to appear in
        // the ledger — at zero — or the hit rate cannot be read off it.
        await recordUsage({ status: 'OK', costUsd: 0, units: 0, errorCode: 'CACHE_HIT' });
        return cached;
      }

      if (!this.isConfigured()) {
        const unavailable = NOT_CONFIGURED(now, config.cacheDays);
        await persist(unavailable, normalized, endpointId ?? null, config);
        return unavailable;
      }

      const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
      let response: { ok: boolean; status: number; json: () => Promise<unknown> };
      try {
        response = await transport(
          `${config.baseUrl}/PhoneNumbers/${encodeURIComponent(normalized)}`
          + `?Fields=line_type_intelligence`,
          { method: 'GET', headers: { authorization: `Basic ${auth}` } },
        );
      } catch (error) {
        return await failure('TIMEOUT', (error as Error).name || 'TRANSPORT_ERROR');
      }

      if (!response.ok) {
        const status: LookupStatus = response.status === 401 || response.status === 403
          ? 'AUTH_FAILED'
          : response.status === 429 ? 'RATE_LIMITED'
          : response.status === 404 ? 'INVALID_NUMBER'
          : 'PROVIDER_ERROR';
        return await failure(status, `HTTP_${response.status}`);
      }

      const body = await response.json() as LookupResponse;
      if (body.valid === false) return await failure('INVALID_NUMBER', 'PROVIDER_SAYS_INVALID');

      const intelligence = body.line_type_intelligence ?? {};
      // A lookup that succeeded and returned type=unknown is a success whose answer is
      // UNKNOWN. Recording it as an error would make a rescreen look overdue forever.
      const result: LineTypeResult = {
        status: 'SUCCESS',
        normalizedLineType: normalizeLineType(intelligence.type),
        providerOriginalType: intelligence.type ?? null,
        carrierName: intelligence.carrier_name ?? null,
        mobileCountryCode: intelligence.mobile_country_code ?? null,
        mobileNetworkCode: intelligence.mobile_network_code ?? null,
        errorCode: intelligence.error_code != null ? String(intelligence.error_code) : null,
        checkedAt: now, refreshBy,
        providerRequestReference: body.phone_number ?? normalized,
        wasCacheHit: false, costUsd: config.costPerLookupUsd,
      };
      await persist(result, normalized, endpointId ?? null, config);
      return result;

      async function failure(
        status: LookupStatus, code: string, value = normalized ?? phone,
      ): Promise<LineTypeResult> {
        // An outage is never inferred into a line type.
        const failed: LineTypeResult = {
          status, normalizedLineType: 'UNKNOWN', providerOriginalType: null,
          carrierName: null, mobileCountryCode: null, mobileNetworkCode: null,
          errorCode: code, checkedAt: now, refreshBy,
          providerRequestReference: null, wasCacheHit: false,
          // A failed request may still be billed; recording zero would understate it.
          costUsd: status === 'INVALID_NUMBER' ? 0 : config.costPerLookupUsd,
        };
        await persist(failed, value, endpointId ?? null, config);
        return failed;
      }
    },
  };
}

/** A cached result is used only while it is fresh and only if it succeeded. */
async function readCache(
  normalized: string, config: LineTypeConfig, now: Date,
): Promise<LineTypeResult | null> {
  const { rows } = await query<any>(
    `select * from line_type_screen_results
      where normalized_value = $1 and provider_id = $2 and data_package = $3
        and status = 'SUCCESS' and refresh_by > $4
      order by checked_at desc limit 1`,
    [normalized, 'TWILIO_LOOKUP_V2', 'LINE_TYPE_INTELLIGENCE', now],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    status: 'SUCCESS',
    normalizedLineType: row.normalized_line_type,
    providerOriginalType: row.provider_original_type,
    carrierName: row.carrier_name,
    mobileCountryCode: row.mobile_country_code,
    mobileNetworkCode: row.mobile_network_code,
    errorCode: row.error_code,
    checkedAt: row.checked_at,
    refreshBy: row.refresh_by,
    providerRequestReference: row.provider_request_reference,
    wasCacheHit: true,
    costUsd: 0,
  };
}

async function persist(
  result: LineTypeResult, normalizedValue: string, endpointId: string | null,
  config: LineTypeConfig,
): Promise<void> {
  await query(
    `insert into line_type_screen_results
       (endpoint_id, normalized_value, provider_id, data_package, status, normalized_line_type,
        provider_original_type, carrier_name, mobile_country_code, mobile_network_code,
        error_code, checked_at, refresh_by, provider_request_reference, was_cache_hit, cost_usd)
     values ($1,$2,'TWILIO_LOOKUP_V2','LINE_TYPE_INTELLIGENCE',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [endpointId, normalizedValue, result.status, result.normalizedLineType,
     result.providerOriginalType, result.carrierName, result.mobileCountryCode,
     result.mobileNetworkCode, result.errorCode, result.checkedAt, result.refreshBy,
     result.providerRequestReference, result.wasCacheHit, result.costUsd],
  );
  await recordUsage({
    status: result.status === 'SUCCESS' ? 'OK' : 'FAILED',
    costUsd: result.costUsd, units: 1, errorCode: result.errorCode,
  });
  void config;
}

async function recordUsage(input: {
  status: 'OK' | 'FAILED'; costUsd: number; units: number; errorCode: string | null;
}): Promise<void> {
  await query(
    `insert into provider_usage
       (provider, operation, requested_at, completed_at, units, estimated_cost_usd,
        actual_cost_usd, status, error_code)
     values ('twilio_lookup', 'line_type_intelligence', now(), now(), $1, $2, $2, $3, $4)`,
    [input.units, input.costUsd, input.status, input.errorCode],
  );
}

/**
 * Usage accounting for the operator (§13).
 *
 * Requests and cost come from the ledger, so a cache hit counts as a request that
 * cost nothing rather than disappearing. The line-type distribution comes from the
 * screening results, which are facts about numbers rather than about spending.
 */
export async function lineTypeUsageSummary() {
  const { rows } = await query<any>(
    `select count(*)::int as requests,
            count(*) filter (where error_code = 'CACHE_HIT')::int as cache_hits,
            count(*) filter (where status = 'OK' and error_code is distinct from 'CACHE_HIT')::int
              as successes,
            count(*) filter (where status = 'FAILED')::int as errors,
            coalesce(sum(actual_cost_usd), 0)::text as cost_usd
       from provider_usage
      where provider = 'twilio_lookup' and operation = 'line_type_intelligence'`,
  );
  const distribution = await query<any>(
    `select normalized_line_type as line_type, count(*)::int as n
       from line_type_screen_results where status = 'SUCCESS'
      group by 1 order by n desc`,
  );
  return { ...rows[0], costUsd: Number(rows[0].cost_usd), distribution: distribution.rows };
}
