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
