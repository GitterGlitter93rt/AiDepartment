// Shared GA4 assessment-event architecture.
//
// Canonical event family (per the site's Sprint 9 GA4 architecture):
//   ai_assessment_start
//   ai_assessment_complete
//   ai_assessment_lead_submit
//
// There is ONE event family for both funnels, distinguished by
// non-PII parameters — NOT by separate event names:
//   - Free Opportunity Assessment (the short /free-ai-assessment/ flow)
//       assessment_type: "free_opportunity"
//       assessment_version: "short_v1"
//   - Comprehensive engine (the 64-question /ai-assessment/full/ flow)
//       assessment_type: "comprehensive_audit"
//
// NEVER send first name, last name, email, company, phone, or
// free-text PII through these events. The builders below only ever
// emit funnel identifiers, a lead correlation ID, and a coarse score
// band.
//
// Pure functions + constants only — no DOM, no storage — directly
// unit-testable in Node, and importable by both client apps
// (assessmentApp.ts, quickAssessmentApp.ts), the lead-submission
// analytics builders, and AnalyticsEvents.astro (via define:vars).

import { CAMPAIGN_PARAM_KEYS, type CampaignParams } from '../attribution.ts';

export const ASSESSMENT_EVENTS = {
  start: 'ai_assessment_start',
  complete: 'ai_assessment_complete',
  leadSubmit: 'ai_assessment_lead_submit',
} as const;

export type AssessmentType = 'free_opportunity' | 'comprehensive_audit';

export const ASSESSMENT_TYPE: Record<'free' | 'comprehensive', AssessmentType> = {
  free: 'free_opportunity',
  comprehensive: 'comprehensive_audit',
};

/** GA4 assessment_version label for the short/free funnel. Note this
 * is the analytics label; the internal scoring version remains
 * assessment_quick_v1 (quickTypes.ts) and is versioned separately. */
export const FREE_ASSESSMENT_GA4_VERSION = 'short_v1';

function scoreBand(overallScore: number): string {
  if (overallScore >= 80) return 'high';
  if (overallScore >= 50) return 'medium';
  return 'low';
}

/** Parameters for ai_assessment_start, by funnel. */
export function buildAssessmentStartParams(type: AssessmentType): Record<string, string> {
  return type === ASSESSMENT_TYPE.free
    ? { assessment_type: ASSESSMENT_TYPE.free, assessment_version: FREE_ASSESSMENT_GA4_VERSION }
    : { assessment_type: ASSESSMENT_TYPE.comprehensive };
}

/** Parameters for ai_assessment_complete, by funnel. */
export function buildAssessmentCompleteParams(type: AssessmentType): Record<string, string> {
  return buildAssessmentStartParams(type);
}

/** Parameters for ai_assessment_lead_submit, by funnel. Adds only the
 * non-PII lead correlation ID and coarse score band to the funnel
 * identifiers — never contact fields, never answers, never results. */
export function buildAssessmentLeadSubmitParams(
  type: AssessmentType,
  leadId: string,
  overallScore: number,
): Record<string, string> {
  return {
    ...buildAssessmentStartParams(type),
    lead_id: leadId,
    score_band: scoreBand(overallScore),
  };
}

/**
 * Merge campaign attribution onto an assessment event payload.
 *
 * Copies ONLY the six UTM fields from CAMPAIGN_PARAM_KEYS, and only
 * when non-empty. Everything else on the supplied object is dropped —
 * so even if a caller hands over a wider attribution record (which
 * contains landing_page, referrer, click IDs and so on), nothing beyond
 * the allowlist can reach GA4.
 *
 * This is the single choke point for campaign data entering the
 * assessment events, which is what makes the "no PII in the dataLayer"
 * guarantee mechanically testable rather than a convention.
 */
export function withCampaignParams(
  base: Record<string, string>,
  campaign: CampaignParams | undefined | null,
): Record<string, string> {
  const out: Record<string, string> = { ...base };
  if (!campaign) return out;
  for (const key of CAMPAIGN_PARAM_KEYS) {
    const value = (campaign as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.length > 0) out[key] = value;
  }
  return out;
}

/**
 * Attach the sales-rep / business-card attribution code to an event.
 *
 * rep_code is an APPROVED non-PII analytics parameter. It is safe by
 * construction, not by convention:
 *   - it can only originate from ?rep= / ?r= on a URL we publish
 *     ourselves (an employee QR code), never from anything a visitor
 *     types into a form;
 *   - sanitizeRepCode() in src/lib/repAttribution.ts strips it to
 *     [a-z0-9._-] and caps it at 64 characters, so an email address,
 *     phone number or free-text name cannot survive intact.
 *
 * Omitted entirely when absent, so organic visitors never carry a blank
 * rep_code into GA4.
 */
export function withRepCode(
  base: Record<string, string>,
  repCode: string | null | undefined,
): Record<string, string> {
  if (typeof repCode !== 'string' || repCode.length === 0) return { ...base };
  return { ...base, rep_code: repCode };
}
