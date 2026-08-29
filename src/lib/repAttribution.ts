// Sales-rep attribution module.
//
// Captures a rep code from the landing URL (?rep=code or ?r=code) and
// persists it client-side so every lead generated later in the session
// — quick score, full assessment, paid-audit request, or Cal.com
// booking — can be attributed to the sales rep who shared the link.
//
// Design rules (mirrors src/lib/attribution.ts discipline):
//   - the rep code is a short, sanitized identifier — never prospect
//     PII, never displayed publicly on the page
//   - first capture wins: a later ?rep= in the same retention window
//     does not steal credit from the rep who originally sent the
//     prospect (unless the stored code has expired)
//   - all storage access is wrapped defensively; storage-disabled
//     browsers must not throw or log
//   - versioned JSON shape so the structure can evolve later
//
// Framework-free on purpose: usable from a plain <script>, Astro module
// scripts, and Node unit tests alike.

export const REP_ATTRIBUTION_VERSION = 1;

/** Default retention window for a captured rep code, in days. A rep
 * should keep credit for a slower-moving prospect longer than a paid
 * click stays fresh, so this is deliberately longer than the marketing
 * attribution window (90 days). */
export const REP_ATTRIBUTION_RETENTION_DAYS = 180;

const STORAGE_KEY = 'yai_rep_attribution';

export interface RepAttributionRecord {
  version: number;
  repCode: string;
  capturedAt: string; // ISO 8601
}

/** Allowed characters for a rep code: lowercase letters, digits, dot,
 * underscore, hyphen. Everything else is stripped. */
const REP_CODE_ALLOWED = /[^a-z0-9._-]/g;
const REP_CODE_MAX_LENGTH = 64;

/** Sanitize a raw query-string value into a canonical rep code.
 * Returns null when nothing usable remains (empty, whitespace, or
 * only invalid characters). Never throws. */
export function sanitizeRepCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(REP_CODE_ALLOWED, '')
    .slice(0, REP_CODE_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

/** Parse a rep code from a URL query string. Accepts `rep` (primary)
 * or `r` (short alias); `rep` wins when both are present. Returns the
 * sanitized code or null. Never throws on a malformed query string. */
export function parseRepFromSearch(search: string): string | null {
  try {
    const params = new URLSearchParams(search);
    return sanitizeRepCode(params.get('rep')) ?? sanitizeRepCode(params.get('r'));
  } catch {
    return null;
  }
}

function safeGetItem(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — rep attribution is best-effort only.
  }
}

function readRecord(): RepAttributionRecord | null {
  const raw = safeGetItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.version === 'number' &&
      typeof parsed.repCode === 'string' &&
      typeof parsed.capturedAt === 'string'
    ) {
      return parsed as RepAttributionRecord;
    }
    return null;
  } catch {
    return null;
  }
}

function isExpired(record: RepAttributionRecord, retentionDays: number): boolean {
  const ts = Date.parse(record.capturedAt);
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > retentionDays * 24 * 60 * 60 * 1000;
}

export interface RepCaptureOptions {
  search?: string;
  retentionDays?: number;
  now?: () => Date;
}

/** Call once per pageview (AttributionCapture.astro does this site-wide).
 * Stores the URL's rep code under first-capture-wins semantics: an
 * unexpired stored code is never overwritten by a new one. Safe to call
 * repeatedly; safe with storage unavailable; a no-op without a param. */
export function captureRepAttribution(options: RepCaptureOptions = {}): void {
  try {
    const retentionDays = options.retentionDays ?? REP_ATTRIBUTION_RETENTION_DAYS;
    const now = (options.now ?? (() => new Date()))();
    const searchString = options.search ?? (typeof window !== 'undefined' ? window.location.search : '');
    const repCode = parseRepFromSearch(searchString);
    if (!repCode) return;

    const existing = readRecord();
    if (existing && !isExpired(existing, retentionDays)) return; // first capture wins

    const record: RepAttributionRecord = {
      version: REP_ATTRIBUTION_VERSION,
      repCode,
      capturedAt: now.toISOString(),
    };
    safeSetItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Never let rep attribution break the page.
  }
}

/** Read the stored rep code, or null if none captured/expired. */
export function getRepCode(retentionDays: number = REP_ATTRIBUTION_RETENTION_DAYS): string | null {
  const record = readRecord();
  if (!record || isExpired(record, retentionDays)) return null;
  return record.repCode;
}

/** Flat lead-payload fields for a captured rep code. Returns {} when no
 * (valid) code is stored so payloads stay unchanged for organic leads. */
export function buildRepLeadFields(retentionDays: number = REP_ATTRIBUTION_RETENTION_DAYS): Record<string, string> {
  const code = getRepCode(retentionDays);
  return code ? { rep_code: code } : {};
}

/** Field map to forward onto a Cal.com (or other) booking URL so the
 * booking is attributed to the rep alongside the marketing fields. */
export function buildCalComRepField(retentionDays: number = REP_ATTRIBUTION_RETENTION_DAYS): Record<string, string> {
  const code = getRepCode(retentionDays);
  return code ? { rep: code } : {};
}
