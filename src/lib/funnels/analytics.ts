// GA4 (via GTM) event contract for the paid-social VSL funnels.
//
// Pure functions + constants — no DOM, no storage — so every payload is
// directly unit-testable in Node and importable both by
// FunnelAnalytics.astro (via define:vars) and by the test suite.
//
// NON-NEGOTIABLE: nothing here may ever emit first name, last name,
// email, phone, company, or free-text intake data. Every parameter
// below is an ad-platform identifier, an internal campaign label, or a
// fixed enum value. isPiiFreePayload() is the machine-checkable guard.
//
// Relationship to the existing site-wide architecture (do not duplicate):
//   - page_view stays owned by the existing GA4 tag in the GTM container
//   - booking_click_strategy still fires site-wide from
//     AnalyticsEvents.astro for every AI Strategy Call link, including
//     the ones on these funnels. The funnel-scoped booking_click_*
//     events below are an ADDITIONAL, narrower signal — a subset, not a
//     replacement. Reporting must treat booking_click_strategy as the
//     site-wide superset.
//   - booking_confirmed remains the ONLY true booked-call conversion and
//     is untouched by this module.

import type { CtaLocation, CtaType, FunnelId, FunnelVertical } from './types';

/** Funnel event names. Deliberately new names — no existing event is
 * renamed, and none of the site's retired quick-score event names are
 * revived. (The retired names are deliberately not spelled out here:
 * tests/paidSocialFunnels.test.ts greps funnel sources for them.) */
export const FUNNEL_EVENTS = {
  view: 'funnel_view',
  vslPlay: 'vsl_play',
  vslProgress: 'vsl_progress',
  ctaClick: 'funnel_cta_click',
} as const;

/** Funnel-scoped booking-click event names, per the tracking plan.
 * These are MICRO-conversions (intent), never booked calls. */
export const FUNNEL_BOOKING_CLICK_EVENTS: Record<FunnelId, string> = {
  plumbing_ai: 'booking_click_plumbing_ai',
  personal_injury_ai: 'booking_click_pi_ai',
  divorce_law_ai: 'booking_click_divorce_ai',
};

/** The only VSL progress thresholds we report. */
export const VSL_PROGRESS_THRESHOLDS = [25, 50, 75, 100] as const;
export type VslProgressThreshold = (typeof VSL_PROGRESS_THRESHOLDS)[number];

/** Creative-level attribution carried on every funnel event. Populated
 * from src/lib/attribution.ts (utm_content primary, creative_id
 * optional secondary) — never from anything user-entered. */
export interface CreativeParams {
  utm_content?: string;
  creative_id?: string;
  utm_campaign?: string;
  utm_source?: string;
  utm_medium?: string;
}

export interface FunnelIdentity {
  vertical: FunnelVertical;
  funnel_id: FunnelId;
}

/** Substrings that must never appear in a funnel analytics parameter
 * NAME. Used by isPiiFreePayload() and asserted in the test suite. */
export const PII_KEY_FRAGMENTS = [
  'name', 'email', 'phone', 'company', 'address', 'message',
  'notes', 'answer', 'firstname', 'lastname', 'attendee',
] as const;

/** True when no key in the payload looks like it could carry PII.
 * Key-name based on purpose: it is the shape of the contract we can
 * enforce mechanically, and every value we emit is already a fixed
 * enum or an ad-platform identifier. */
export function isPiiFreePayload(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).every((key) => {
    const lower = key.toLowerCase();
    return !PII_KEY_FRAGMENTS.some((bad) => lower.includes(bad));
  });
}

/**
 * Sales-rep / business-card attribution code, when the visitor arrived
 * from an employee QR code. Sanitized at capture in
 * src/lib/repAttribution.ts to [a-z0-9._-], max 64 chars — an approved
 * non-PII parameter that can only come from a URL we publish, never
 * from anything a visitor types.
 */
export type RepCode = string | null | undefined;

function repOnly(repCode: RepCode): Record<string, string | undefined> {
  return { rep_code: typeof repCode === 'string' && repCode.length > 0 ? repCode : undefined };
}

/** Drop empty/undefined values so GA4 never receives blank parameters. */
function compact(fields: Record<string, string | number | undefined>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/** Only ever forward the five known creative keys, even if the caller
 * hands over a wider object. This is what keeps an unexpected field
 * from leaking into GA4. */
function creativeOnly(creative: CreativeParams | undefined): Record<string, string | undefined> {
  return {
    utm_source: creative?.utm_source,
    utm_medium: creative?.utm_medium,
    utm_campaign: creative?.utm_campaign,
    utm_content: creative?.utm_content,
    creative_id: creative?.creative_id,
  };
}

/** funnel_view — one per funnel pageview. The audience-building event:
 * "everyone who landed on this funnel, from this creative". */
export function buildFunnelViewParams(
  identity: FunnelIdentity,
  creative?: CreativeParams,
  repCode?: RepCode,
): Record<string, string | number> {
  return compact({ ...identity, ...creativeOnly(creative), ...repOnly(repCode) });
}

/** funnel_cta_click — any primary CTA click on a funnel page. */
export function buildCtaClickParams(
  identity: FunnelIdentity,
  ctaLocation: CtaLocation,
  ctaType: CtaType,
  creative?: CreativeParams,
  repCode?: RepCode,
): Record<string, string | number> {
  return compact({
    ...identity,
    cta_location: ctaLocation,
    cta_type: ctaType,
    ...creativeOnly(creative),
    ...repOnly(repCode),
  });
}

/** vsl_play — first playback start only (once per pageview). */
export function buildVslPlayParams(
  identity: FunnelIdentity,
  creative?: CreativeParams,
  repCode?: RepCode,
): Record<string, string | number> {
  return compact({ ...identity, ...creativeOnly(creative), ...repOnly(repCode) });
}

/** vsl_progress — fired once per crossed threshold per pageview.
 * vsl_progress is a NUMBER (25/50/75/100) so GA4 can build
 * ">= 50%" style audiences without string parsing. */
export function buildVslProgressParams(
  identity: FunnelIdentity,
  threshold: VslProgressThreshold,
  creative?: CreativeParams,
  repCode?: RepCode,
): Record<string, string | number> {
  return compact({ ...identity, vsl_progress: threshold, ...creativeOnly(creative), ...repOnly(repCode) });
}

/** booking_click_<funnel> — micro-conversion. Adds the same creative
 * context so "which creative produced booking intent" is answerable
 * without stitching sessions. */
export function buildBookingClickEvent(
  identity: FunnelIdentity,
  ctaLocation: CtaLocation,
  ctaType: CtaType,
  creative?: CreativeParams,
  repCode?: RepCode,
): { event: string; params: Record<string, string | number> } {
  return {
    event: FUNNEL_BOOKING_CLICK_EVENTS[identity.funnel_id],
    params: buildCtaClickParams(identity, ctaLocation, ctaType, creative, repCode),
  };
}
