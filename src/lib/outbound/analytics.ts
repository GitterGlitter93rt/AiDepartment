// GA4 (via GTM) event contract for the cold-email outbound landing
// pages under /go/.
//
// Pure functions + constants — no DOM, no storage — so every payload is
// directly unit-testable in Node and importable both by
// OutboundAnalytics.astro and by the test suite.
//
// ---------------------------------------------------------------------
// THE QUESTION THESE EVENTS EXIST TO ANSWER
// ---------------------------------------------------------------------
//
// Smartlead reports a click count. In the roofing sequence that count
// was ~227 against ~230 opens, with zero replies. A near-100% click
// rate with no human response is not a click rate; something is opening
// those links that is not a roofer. Security appliances, link
// scanners, and privacy proxies all fetch URLs in email.
//
// We cannot inspect Smartlead's counter, and we must not assert what it
// is measuring. What we CAN do is measure the far side of the click
// ourselves and let the two numbers be compared:
//
//   Smartlead clicks   a URL was fetched, by something
//   cold_lp_view       a browser rendered the page and ran JavaScript
//   cold_lp_engaged    that browser then stayed, or did something
//
// Neither of our events proves a human. A sufficiently determined
// headless scanner executes JavaScript. They NARROW it, and the shape
// of the gap between the three numbers is itself the finding: 227 / 12
// / 3 tells a very different story from 227 / 210 / 180, and today we
// cannot tell those two worlds apart at all.
//
// ---------------------------------------------------------------------
// WHAT THIS DOES NOT DO (do not duplicate)
// ---------------------------------------------------------------------
//   - page_view stays owned by the existing GA4 tag in the GTM
//     container. cold_lp_view is NOT a page view; it is a narrower
//     signal that JavaScript executed on a campaign landing page.
//   - booking_click_strategy still fires site-wide from
//     AnalyticsEvents.astro for the primary CTA on these pages, exactly
//     as it does everywhere else. outbound_cta_click is an ADDITIONAL,
//     narrower signal carrying placement and audience — a subset, not a
//     replacement. Reporting must treat booking_click_strategy as the
//     site-wide superset.
//   - booking_confirmed on /booking-confirmed/ remains the ONLY event
//     that means a call was actually booked. Nothing in this file may
//     ever be treated as a booking.
//
// NON-NEGOTIABLE: nothing here may emit first name, last name, email,
// phone, company, or free-text data. Every parameter below is a fixed
// enum value, an internal campaign label, or a UTM field from a URL we
// publish ourselves. isPiiFreeOutboundPayload() is the machine-checkable
// guard.

import type { CampaignParams } from '../attribution.ts';
import { CAMPAIGN_PARAM_KEYS } from '../attribution.ts';
import type { CtaLocation, CtaType } from '../funnels/types.ts';
import type { OutboundAudience, OutboundCampaignId } from './types.ts';

export const OUTBOUND_EVENTS = {
  /** A browser rendered a /go/ page and ran JavaScript. Once per
   * pageview. A diagnostic, never a conversion. */
  view: 'cold_lp_view',
  /** That browser then stayed or interacted. Once per pageview. */
  engaged: 'cold_lp_engaged',
  /** Any tracked CTA click on a /go/ page. */
  ctaClick: 'outbound_cta_click',
} as const;

/**
 * How engagement was established.
 *
 * 'interaction' is the stronger of the two — a scroll, a pointer press,
 * a key, a touch. 'dwell' means the tab stayed visible for the
 * threshold without any of that, which a person reading a short page on
 * a phone genuinely can do.
 *
 * Reported as a parameter rather than as two event names so the
 * combined "engaged at all" number stays a single, unsplit metric while
 * the stronger signal remains separable.
 */
export const ENGAGEMENT_SIGNALS = ['interaction', 'dwell'] as const;
export type EngagementSignal = (typeof ENGAGEMENT_SIGNALS)[number];

/**
 * Visible milliseconds before dwell counts as engagement.
 *
 * Fifteen seconds. Short enough that someone who reads the hero and the
 * chain diagram qualifies; long enough that a prefetch, a preview pane,
 * or a scanner that renders and immediately discards does not. Measured
 * against VISIBLE time, not wall-clock, so a page opened in a
 * background tab does not accrue it.
 */
export const DWELL_THRESHOLD_MS = 15_000;

export interface OutboundIdentity {
  audience: OutboundAudience;
  campaign_id: OutboundCampaignId;
}

/** Substrings that must never appear in an outbound analytics parameter
 * NAME. Same discipline as src/lib/funnels/analytics.ts. */
export const PII_KEY_FRAGMENTS = [
  'name', 'email', 'phone', 'company', 'address', 'message',
  'notes', 'answer', 'firstname', 'lastname', 'attendee',
] as const;

/** True when no key in the payload looks like it could carry PII. */
export function isPiiFreeOutboundPayload(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).every((key) => {
    const lower = key.toLowerCase();
    return !PII_KEY_FRAGMENTS.some((bad) => lower.includes(bad));
  });
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

/**
 * Copy ONLY the six UTM fields, even if the caller hands over a wider
 * attribution record. Same fixed allowlist the assessment events and
 * booking_confirmed use, so all four surfaces agree on exactly what
 * campaign data may reach GA4.
 */
function campaignOnly(campaign: CampaignParams | undefined | null): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (!campaign) return out;
  for (const key of CAMPAIGN_PARAM_KEYS) {
    const value = (campaign as Record<string, unknown>)[key];
    out[key] = typeof value === 'string' ? value : undefined;
  }
  return out;
}

/** Sales-rep / business-card attribution code. Sanitized at capture in
 * src/lib/repAttribution.ts to [a-z0-9._-], max 64 chars. */
export type RepCode = string | null | undefined;

function repOnly(repCode: RepCode): Record<string, string | undefined> {
  return { rep_code: typeof repCode === 'string' && repCode.length > 0 ? repCode : undefined };
}

/** cold_lp_view — a real browser rendered this campaign page. */
export function buildOutboundViewParams(
  identity: OutboundIdentity,
  campaign?: CampaignParams | null,
  repCode?: RepCode,
): Record<string, string | number> {
  return compact({ ...identity, ...campaignOnly(campaign), ...repOnly(repCode) });
}

/** cold_lp_engaged — that browser stayed or interacted. */
export function buildOutboundEngagedParams(
  identity: OutboundIdentity,
  signal: EngagementSignal,
  campaign?: CampaignParams | null,
  repCode?: RepCode,
): Record<string, string | number> {
  return compact({
    ...identity,
    engagement_signal: signal,
    ...campaignOnly(campaign),
    ...repOnly(repCode),
  });
}

/** outbound_cta_click — any tracked CTA on a /go/ page.
 *
 * cta_type distinguishes the primary strategy call from the secondary
 * assessment, which is the whole point of running them side by side:
 * the experiment is which one a cold reader actually takes. */
export function buildOutboundCtaClickParams(
  identity: OutboundIdentity,
  ctaLocation: CtaLocation,
  ctaType: CtaType,
  campaign?: CampaignParams | null,
  repCode?: RepCode,
): Record<string, string | number> {
  return compact({
    ...identity,
    cta_location: ctaLocation,
    cta_type: ctaType,
    ...campaignOnly(campaign),
    ...repOnly(repCode),
  });
}
