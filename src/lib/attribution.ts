// Central first-party attribution module.
//
// Captures acquisition context (Google Ads click IDs, UTMs, ValueTrack
// fields) from the landing URL and persists it client-side so it can be
// attached to a contact-form lead or a Cal.com booking later in the
// session — without ever storing PII.
//
// Design rules (do not violate):
//   - never store name/email/phone/message/assessment answers here
//   - first touch is captured once and never overwritten
//   - latest touch updates only when a meaningful new acquisition
//     signal is present (a paid click ID or a UTM parameter) — a plain
//     internal navigation or a direct visit with no query string must
//     never erase or blank out previously stored attribution
//   - all storage access is wrapped defensively; a browser with storage
//     disabled/unavailable must not throw or log errors
//   - one documented JSON shape per stored key, versioned so the shape
//     can evolve later without breaking older stored records
//
// This module is intentionally framework-free (no Astro/DOM-framework
// imports) so it can be safely used both from a plain <script> and from
// any future build tooling without change.

export const ATTRIBUTION_VERSION = 1;

/** Default retention window for stored attribution, in days. */
export const ATTRIBUTION_RETENTION_DAYS = 90;

const STORAGE_KEY_FIRST = 'yai_attribution_first';
const STORAGE_KEY_LATEST = 'yai_attribution_latest';

/** Fields captured from the URL and environment. Every field is
 * optional — most sessions will have only a handful populated. None of
 * these fields may ever hold personally identifiable information. */
export interface AttributionFields {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  /** Campaign ID from the sending platform. Smartlead cold-email
   * sequences set this (e.g. sl_roofing_20260820) so a lead can be tied
   * back to a specific send even when campaign names are reused. */
  utm_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  /** Meta click ID. Captured for the same reason gclid/gbraid/wbraid
   * are: it identifies a paid click and is required for any future
   * Meta Conversions API deduplication/matching work. */
  fbclid?: string;
  /** Optional internal creative identifier (?creative_id=). SECONDARY
   * to utm_content, which remains the primary Meta creative field —
   * this exists so a human-readable internal label
   * ("plumbing_v1_missed_calls_hook") can travel alongside the ad
   * platform's own creative value. Sanitized on capture. */
  creative_id?: string;
  campaignid?: string;
  adgroupid?: string;
  keyword?: string;
  matchtype?: string;
  device?: string;
  network?: string;
  creative?: string;
  targetid?: string;
  landing_page?: string;
  referrer?: string;
}

export interface AttributionRecord extends AttributionFields {
  version: number;
  timestamp: string; // ISO 8601
}

const URL_PARAM_KEYS: (keyof AttributionFields)[] = [
  'gclid', 'gbraid', 'wbraid', 'fbclid',
  'utm_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'creative_id',
  'campaignid', 'adgroupid', 'keyword', 'matchtype', 'device', 'network', 'creative', 'targetid',
];

/** Allowed characters for the internal creative_id: lowercase letters,
 * digits, dot, underscore, hyphen. Everything else is stripped. This
 * mirrors the rep-code discipline in src/lib/repAttribution.ts — the
 * value is ours by convention, arrives from a URL, and is forwarded
 * into booking URLs and GA4 custom dimensions, so it is normalized on
 * capture rather than trusted verbatim. Note this is deliberately NOT
 * applied to ad-platform-owned values (gclid, fbclid, utm_content),
 * which must be preserved exactly as the platform issued them. */
const CREATIVE_ID_DISALLOWED = /[^a-z0-9._-]/g;
const CREATIVE_ID_MAX_LENGTH = 64;

/** Normalize a raw ?creative_id= value. Returns null when nothing
 * usable remains. Never throws. */
export function sanitizeCreativeId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase().replace(CREATIVE_ID_DISALLOWED, '').slice(0, CREATIVE_ID_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

/** A touch is only "meaningful" (worth capturing/updating latest-touch
 * for) if it carries an actual paid-attribution or UTM signal. A bare
 * pageview with no query parameters — e.g. someone clicking an internal
 * nav link — must never count as a new touch, or it would silently
 * erase real acquisition data on the very next pageview. */
function hasMeaningfulSignal(fields: AttributionFields): boolean {
  return URL_PARAM_KEYS.some((key) => typeof fields[key] === 'string' && fields[key]!.length > 0);
}

/** Parse attribution fields from a URL's query string. Never throws —
 * a malformed URL/search string simply yields an object with no
 * populated fields. Google click IDs are preserved exactly as received
 * (case-sensitive, no trimming beyond removing surrounding whitespace
 * that couldn't legitimately be part of a real ID). */
export function parseAttributionFromSearch(search: string): AttributionFields {
  const result: AttributionFields = {};
  try {
    const params = new URLSearchParams(search);
    for (const key of URL_PARAM_KEYS) {
      const raw = params.get(key);
      if (raw === null || raw.trim().length === 0) continue;
      if (key === 'creative_id') {
        const cleaned = sanitizeCreativeId(raw);
        if (cleaned) (result as Record<string, string>)[key] = cleaned;
        continue;
      }
      (result as Record<string, string>)[key] = raw;
    }
  } catch {
    // Malformed query string — return whatever was already collected
    // (nothing) rather than throwing.
  }
  return result;
}

/** Safe wrapper around localStorage. Returns null on any failure
 * (storage disabled, quota exceeded, private-browsing restrictions,
 * running outside a browser, etc.) instead of throwing. */
function safeGetItem(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function readRecord(key: string): AttributionRecord | null {
  const raw = safeGetItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.version === 'number') {
      return parsed as AttributionRecord;
    }
    return null;
  } catch {
    return null;
  }
}

function isExpired(record: AttributionRecord, retentionDays: number): boolean {
  const ts = Date.parse(record.timestamp);
  if (Number.isNaN(ts)) return true;
  const ageMs = Date.now() - ts;
  return ageMs > retentionDays * 24 * 60 * 60 * 1000;
}

function writeRecord(key: string, fields: AttributionFields, timestamp: string): void {
  const record: AttributionRecord = { version: ATTRIBUTION_VERSION, timestamp, ...fields };
  safeSetItem(key, JSON.stringify(record));
}

/** Merge new fields onto an existing record without ever replacing a
 * populated field with an empty/missing one. This is what guarantees a
 * later pageview with no gclid can't blank out a gclid captured
 * earlier in the same touch. */
function mergePreferringExisting(existing: AttributionFields, incoming: AttributionFields): AttributionFields {
  const merged: AttributionFields = { ...existing };
  for (const key of URL_PARAM_KEYS) {
    const incomingVal = incoming[key];
    if (typeof incomingVal === 'string' && incomingVal.length > 0) {
      merged[key] = incomingVal;
    }
  }
  if (incoming.landing_page) merged.landing_page = incoming.landing_page;
  if (incoming.referrer) merged.referrer = incoming.referrer;
  return merged;
}

export interface CaptureOptions {
  search?: string;
  landingPage?: string;
  referrer?: string;
  retentionDays?: number;
  now?: () => Date;
}

/** Call once per pageview (early, ideally before any user interaction).
 * Captures the current URL's attribution parameters and updates stored
 * first-touch / latest-touch records according to the rules above.
 * Safe to call repeatedly; safe to call with storage unavailable. */
export function captureAttribution(options: CaptureOptions = {}): void {
  try {
    const retentionDays = options.retentionDays ?? ATTRIBUTION_RETENTION_DAYS;
    const now = (options.now ?? (() => new Date()))();
    const nowIso = now.toISOString();

    const searchString = options.search ?? (typeof window !== 'undefined' ? window.location.search : '');
    const parsed = parseAttributionFromSearch(searchString);
    const landingPage = options.landingPage ?? (typeof window !== 'undefined' ? window.location.pathname : undefined);
    const referrer = options.referrer ?? (typeof document !== 'undefined' ? document.referrer : undefined);

    const meaningful = hasMeaningfulSignal(parsed);

    // First touch: write once, never overwritten afterward.
    const existingFirst = readRecord(STORAGE_KEY_FIRST);
    const firstIsValid = existingFirst && !isExpired(existingFirst, retentionDays);
    if (!firstIsValid && meaningful) {
      const fields: AttributionFields = { ...parsed };
      if (landingPage) fields.landing_page = landingPage;
      if (referrer) fields.referrer = referrer;
      writeRecord(STORAGE_KEY_FIRST, fields, nowIso);
    }

    // Latest touch: only update when this pageview carries a genuine
    // new acquisition signal. A plain internal navigation or a direct
    // revisit with no query string must leave the stored latest-touch
    // record untouched, not blank it out.
    if (meaningful) {
      const existingLatest = readRecord(STORAGE_KEY_LATEST);
      const latestIsValid = existingLatest && !isExpired(existingLatest, retentionDays);
      const baseline: AttributionFields = latestIsValid ? existingLatest! : {};
      const merged = mergePreferringExisting(baseline, {
        ...parsed,
        landing_page: landingPage,
        referrer,
      });
      writeRecord(STORAGE_KEY_LATEST, merged, nowIso);
    } else if (!readRecord(STORAGE_KEY_LATEST)) {
      // No stored latest touch at all yet (first ever pageview, no
      // params) — still worth recording landing_page/referrer alone so
      // there is *some* context, without inventing paid attribution.
      const fields: AttributionFields = {};
      if (landingPage) fields.landing_page = landingPage;
      if (referrer) fields.referrer = referrer;
      writeRecord(STORAGE_KEY_LATEST, fields, nowIso);
    }
  } catch {
    // Never let attribution capture break the page.
  }
}

/** Read the stored first-touch record, or null if none/expired. */
export function getFirstTouch(retentionDays: number = ATTRIBUTION_RETENTION_DAYS): AttributionRecord | null {
  const record = readRecord(STORAGE_KEY_FIRST);
  if (!record || isExpired(record, retentionDays)) return null;
  return record;
}

/** Read the stored latest-touch record, or null if none/expired. */
export function getLatestTouch(retentionDays: number = ATTRIBUTION_RETENTION_DAYS): AttributionRecord | null {
  const record = readRecord(STORAGE_KEY_LATEST);
  if (!record || isExpired(record, retentionDays)) return null;
  return record;
}

/** Build the flat, prefixed field set used on the contact-form lead
 * payload and any other place that needs a single combined snapshot of
 * first + latest touch. Every key is prefixed with "attribution_" per
 * the agreed lead-payload contract. Never includes PII. */
export function buildLeadAttributionFields(retentionDays: number = ATTRIBUTION_RETENTION_DAYS): Record<string, string> {
  const first = getFirstTouch(retentionDays);
  const latest = getLatestTouch(retentionDays);
  const out: Record<string, string> = {};

  const mapField = (prefix: string, record: AttributionRecord | null, key: keyof AttributionFields, outKey: string) => {
    const val = record?.[key];
    if (typeof val === 'string' && val.length > 0) out[`attribution_${prefix}${outKey}`] = val;
  };

  if (latest) {
    mapField('', latest, 'gclid', 'gclid');
    mapField('', latest, 'gbraid', 'gbraid');
    mapField('', latest, 'wbraid', 'wbraid');
    mapField('', latest, 'fbclid', 'fbclid');
    mapField('', latest, 'utm_id', 'utm_id');
    mapField('', latest, 'utm_source', 'utm_source');
    mapField('', latest, 'utm_medium', 'utm_medium');
    mapField('', latest, 'utm_campaign', 'utm_campaign');
    mapField('', latest, 'utm_term', 'utm_term');
    mapField('', latest, 'utm_content', 'utm_content');
    mapField('', latest, 'creative_id', 'creative_id');
    mapField('', latest, 'campaignid', 'campaign_id');
    mapField('', latest, 'adgroupid', 'adgroup_id');
    mapField('', latest, 'keyword', 'keyword');
    mapField('', latest, 'matchtype', 'match_type');
    mapField('', latest, 'device', 'device');
    mapField('', latest, 'network', 'network');
    mapField('', latest, 'creative', 'creative');
    mapField('', latest, 'targetid', 'target_id');
    mapField('', latest, 'landing_page', 'latest_landing_page');
    mapField('', latest, 'referrer', 'referrer');
    if (latest.timestamp) out.attribution_latest_timestamp = latest.timestamp;
  }
  if (first) {
    mapField('', first, 'landing_page', 'first_landing_page');
    if (first.timestamp) out.attribution_first_timestamp = first.timestamp;
  }

  return out;
}

/** Generate a non-PII lead identifier. Uses crypto.randomUUID() where
 * available (all modern browsers), with a safe fallback for older
 * environments. This value identifies a submission for later matching
 * against a Cal.com booking or Google Ads offline conversion — it is
 * not derived from and does not contain any personal information. */
export function generateLeadId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to manual fallback
  }
  // Fallback: RFC4122-ish v4 using Math.random. Not cryptographically
  // strong, but this is a non-secret correlation ID, not a security
  // token, so this is an acceptable degraded path for older browsers.
  return 'lead-' + Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
  ).join('-').slice(0, 36);
}

/** Append attribution parameters onto a destination URL (e.g. a Cal.com
 * booking link) without clobbering any parameters already present on
 * that URL. Empty/missing fields are simply omitted — this function
 * never appends a blank parameter. Uses URL/URLSearchParams throughout,
 * never manual string concatenation. Returns the original urlString
 * unchanged if it cannot be parsed as a valid URL. */
export function appendAttributionToUrl(
  urlString: string,
  fields: Record<string, string | undefined>,
): string {
  try {
    const url = new URL(urlString);
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'string' && value.length > 0) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  } catch {
    return urlString;
  }
}

/** Build the standard UTM + custom ValueTrack field map to forward onto
 * a Cal.com booking URL, sourced from the latest-touch record. Returns
 * only populated fields. */
export function buildCalComForwardFields(retentionDays: number = ATTRIBUTION_RETENTION_DAYS): Record<string, string> {
  const latest = getLatestTouch(retentionDays);
  if (!latest) return {};
  const out: Record<string, string> = {};
  const keys: (keyof AttributionFields)[] = [
    'utm_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'creative_id',
    'gclid', 'gbraid', 'wbraid', 'fbclid',
    'campaignid', 'adgroupid', 'keyword', 'matchtype', 'device', 'network', 'creative', 'targetid',
  ];
  for (const key of keys) {
    const val = latest[key];
    if (typeof val === 'string' && val.length > 0) out[key] = val;
  }
  return out;
}

/** The creative-level attribution snapshot used to stamp funnel
 * analytics events (non-PII by construction — these are ad-platform
 * and internal campaign identifiers only).
 *
 * utm_content is the PRIMARY Meta creative field; creative_id is the
 * OPTIONAL internal secondary identifier. Latest touch wins, with a
 * fall back to first touch so a visitor who arrived on a creative and
 * then navigated internally (e.g. funnel -> free assessment -> booking)
 * still carries the creative that actually produced the visit. */
export interface CreativeAttribution {
  utm_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  creative_id?: string;
}

const CREATIVE_KEYS: (keyof CreativeAttribution)[] = [
  'utm_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'creative_id',
];

/** Read the creative-level attribution for the current session.
 * Prefers latest touch, falls back per-field to first touch. Returns
 * only populated fields — never blank values, never PII. */
export function getCreativeAttribution(
  retentionDays: number = ATTRIBUTION_RETENTION_DAYS,
): CreativeAttribution {
  const latest = getLatestTouch(retentionDays);
  const first = getFirstTouch(retentionDays);
  const out: CreativeAttribution = {};
  for (const key of CREATIVE_KEYS) {
    const val = latest?.[key] ?? first?.[key];
    if (typeof val === 'string' && val.length > 0) out[key] = val;
  }
  return out;
}

// ---------------------------------------------------------------------
// Campaign attribution (email / paid / any tagged source)
// ---------------------------------------------------------------------

/**
 * The six standard UTM fields, and nothing else.
 *
 * This is the ONLY shape allowed onto GA4 assessment events. It is a
 * fixed allowlist rather than a pass-through so that a future field
 * added to AttributionFields can never silently start flowing into
 * analytics — a new key has to be added here deliberately.
 */
export const CAMPAIGN_PARAM_KEYS = [
  'utm_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
] as const;

export type CampaignParams = Partial<Record<(typeof CAMPAIGN_PARAM_KEYS)[number], string>>;

/**
 * The campaign snapshot for the current session.
 *
 * Latest touch wins, falling back per-field to first touch, so a
 * visitor who arrives from a Smartlead email and then navigates
 * (landing page -> industry page -> /free-ai-assessment/) still carries
 * the campaign that actually produced the visit. Internal navigation
 * never overwrites it: captureAttribution() only updates latest touch
 * when a pageview carries a genuine acquisition signal.
 *
 * Values are returned EXACTLY as the platform issued them. They are
 * deliberately not lower-cased: utm_content in particular doubles as an
 * ad-creative identifier elsewhere on this site, and normalising it
 * would corrupt creative-level reporting. Lowercase naming is a
 * convention applied when the links are AUTHORED — see
 * docs/analytics/smartlead-campaign-links.md — not a runtime transform.
 *
 * Returns only populated fields, so an organic visitor produces {} and
 * no blank parameters reach GA4. Never contains PII: every value here
 * comes from a query string we publish ourselves.
 */
export function getCampaignAttribution(
  retentionDays: number = ATTRIBUTION_RETENTION_DAYS,
): CampaignParams {
  const latest = getLatestTouch(retentionDays);
  const first = getFirstTouch(retentionDays);
  const out: CampaignParams = {};
  for (const key of CAMPAIGN_PARAM_KEYS) {
    const val = latest?.[key] ?? first?.[key];
    if (typeof val === 'string' && val.length > 0) out[key] = val;
  }
  return out;
}
