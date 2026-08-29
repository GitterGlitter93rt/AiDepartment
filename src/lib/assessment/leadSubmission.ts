// Assessment lead submission — the real delivery path for a completed
// AI Department Assessment, replacing the previous
// submissionAdapter.ts placeholder (which intentionally never sent
// anything anywhere). Reuses the same Web3Forms account/endpoint
// pattern already used and proven by src/pages/contact/index.astro —
// same access key, same endpoint, same response-checking logic — kept
// as a small, separate function here rather than modifying the contact
// page, so the existing contact form's behavior is not touched at all.

import type { ContactInfo } from './persistence';
import type { FullAssessmentResult, AnswerMap, QuestionDef } from '../../data/assessment/types';
import { buildLeadAttributionFields, generateLeadId } from '../attribution.ts';
import { buildRepLeadFields } from '../repAttribution.ts';
import {
  ASSESSMENT_TYPE,
  buildAssessmentLeadSubmitParams,
} from './ga4Events.ts';

// Same Web3Forms account already configured and verified working for
// the Contact page. Not a secret in the security sense — Web3Forms
// access keys are designed to be used from client-side code (see the
// Contact page's own comments) — but still centralized here rather
// than duplicated ad hoc.
const WEB3FORMS_ACCESS_KEY = 'aef33e06-d5f2-450f-86f3-1908340e7e5d';
const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';

export interface AssessmentLeadOutcome {
  delivered: boolean;
  leadId: string;
}

/** Validate the required assessment contact fields. Returns an error
 * message string if invalid, or null if the contact is valid. Pure
 * function — no DOM/form access — so it's directly unit-testable and
 * shared between the live form-submit handler and any future caller. */
export function validateContact(contact: Pick<ContactInfo, 'firstName' | 'email' | 'company'>): string | null {
  if (!contact.firstName || !contact.email || !contact.company) {
    return 'First name, business email, and company are required.';
  }
  return null;
}

/** Build a human-readable "question — answer" summary block, using each
 * question's actual prompt and option labels (not raw internal IDs), so
 * the received lead email is genuinely readable rather than a JSON
 * dump. Unanswered/skipped (branch-hidden) questions are omitted. */
export function buildReadableAnswerSummary(answers: AnswerMap, questions: QuestionDef[]): string {
  const lines: string[] = [];
  for (const q of questions) {
    const val = answers[q.id];
    if (val === undefined || val === null) continue;
    let answerText: string;
    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      const labels = val.map((v) => q.options?.find((o) => (o.value ?? o.label) === v)?.label ?? v);
      answerText = labels.join('; ');
    } else if (typeof val === 'string') {
      if (val.trim().length === 0) continue;
      const optionLabel = q.options?.find((o) => (o.value ?? o.label) === val)?.label;
      answerText = optionLabel ?? val;
    } else {
      continue;
    }
    lines.push(`${q.prompt}\n${answerText}`);
  }
  return lines.join('\n\n');
}

export interface LeadSubmissionInput {
  contact: ContactInfo;
  result: FullAssessmentResult;
  answers: AnswerMap;
  questions: QuestionDef[];
}

/** Non-PII fields to attach to the comprehensive funnel's
 * ai_assessment_lead_submit GA4 event. Uses the shared GA4 module so
 * the funnel parameter (assessment_type "comprehensive_audit") has one
 * source of truth; the version stays the engine's real internal
 * version. Deliberately excludes the full result, answers, and any
 * contact field — only a lead correlation ID and a few coarse,
 * non-sensitive signals. */
export function buildLeadAnalyticsFields(
  leadId: string,
  result: FullAssessmentResult
): { lead_id: string; assessment_version: string; assessment_type: string; score_band: string } {
  const shared = buildAssessmentLeadSubmitParams(ASSESSMENT_TYPE.comprehensive, leadId, result.public.overallScore);
  return {
    lead_id: leadId,
    assessment_version: String(result.assessmentVersion),
    // Shared module contributes assessment_type + score_band; the
    // version above remains the engine's own (assessment_v1).
    assessment_type: shared.assessment_type,
    score_band: shared.score_band,
  };
}

/** Look up a single question's raw answer by ID for the fields the lead
 * summary needs individually (revenue, employee count, ad spend,
 * budget, timeframe, role) — returns undefined if unanswered rather
 * than a misleading default, so the summary can say "Not provided"
 * explicitly instead of fabricating a value. */
function getAnswer(answers: AnswerMap, id: string): string | undefined {
  const val = answers[id];
  return typeof val === 'string' && val.trim().length > 0 ? val : undefined;
}

/** Build a short, readable one-line attribution summary for the lead
 * summary block — the individual attribution_* fields (below) remain
 * available for any automated processing, but a salesperson scanning
 * the email shouldn't have to piece together six separate fields to
 * know where the lead came from. */
function buildAttributionSummary(attribution: Record<string, string>): string {
  const parts: string[] = [];
  if (attribution.attribution_utm_source || attribution.attribution_utm_medium) {
    parts.push(`Source: ${attribution.attribution_utm_source || 'unknown'} / ${attribution.attribution_utm_medium || 'unknown'}`);
  }
  if (attribution.attribution_utm_campaign) parts.push(`Campaign: ${attribution.attribution_utm_campaign}`);
  if (attribution.attribution_gclid) parts.push('Google Ads click (gclid present)');
  if (attribution.attribution_keyword) parts.push(`Keyword: ${attribution.attribution_keyword}`);
  if (attribution.attribution_first_landing_page) parts.push(`First landing page: ${attribution.attribution_first_landing_page}`);
  return parts.length > 0 ? parts.join(' | ') : 'No paid/UTM attribution captured for this session (organic, direct, or referral traffic).';
}

/** Build the concise "scan in under 30 seconds" lead summary block that
 * leads the email. Every value is pulled from data already collected —
 * nothing here is fabricated, and any field genuinely not answered
 * reads "Not provided" rather than being silently omitted (so it's
 * obvious to the reader it was skipped, not that the field doesn't
 * exist). */
function buildLeadSummary(input: {
  contact: ContactInfo;
  result: FullAssessmentResult;
  answers: AnswerMap;
  leadId: string;
  attribution: Record<string, string>;
  repCode: string | null;
}): string {
  const { contact, result, answers, leadId, attribution, repCode } = input;
  const pub = result.public;
  const top3 = pub.recommendations
    .slice(0, 3)
    .map((r, i) => `  ${i + 1}. ${r.title} (${r.service})`)
    .join('\n');

  const lines = [
    `Name: ${contact.firstName}${contact.lastName ? ' ' + contact.lastName : ''}`,
    `Company: ${contact.company || 'Not provided'}`,
    `Email: ${contact.email}`,
    `Phone: ${contact.phone || 'Not provided'}`,
    `Website: ${contact.website || 'Not provided'}`,
    ``,
    `Overall AI Score: ${pub.overallScore}`,
    `Maturity Stage: ${pub.stage}`,
    `Commercial Classification: ${result.commercial.classification}`,
    `Enterprise Candidate: ${result.commercial.enterpriseCandidate ? 'Yes' : 'No'}`,
    ``,
    `Annual Revenue: ${getAnswer(answers, 'Q2') ?? 'Not provided'}`,
    `Employee Count: ${getAnswer(answers, 'Q3') ?? 'Not provided'}`,
    `Monthly Paid-Ad Spend: ${getAnswer(answers, 'Q11') ?? 'Not provided'}`,
    `Investment Willingness: ${getAnswer(answers, 'Q39') ?? 'Not provided'}`,
    `Implementation Timeframe: ${getAnswer(answers, 'Q38') ?? 'Not provided'}`,
    `Respondent Role: ${getAnswer(answers, 'Q40') ?? 'Not provided'}`,
    ``,
    `Top 3 Recommended Opportunities:`,
    top3 || '  None generated',
    ``,
    `Lead ID: ${leadId}`,
    repCode ? `Sales Rep: ${repCode}` : `Sales Rep: none captured`,
    `Attribution: ${buildAttributionSummary(attribution)}`,
  ];
  return lines.join('\n');
}

/** Submit the completed assessment (contact + full result + attribution)
 * to Web3Forms as one readable lead email, distinguishable from a
 * normal Contact-page inquiry via its subject line. Returns whether
 * delivery actually succeeded — callers must not treat this as
 * successful unless `delivered` is true. */
export async function submitAssessmentLead(input: LeadSubmissionInput): Promise<AssessmentLeadOutcome> {
  const leadId = generateLeadId();

  if (!WEB3FORMS_ACCESS_KEY || WEB3FORMS_ACCESS_KEY.startsWith('REPLACE_WITH')) {
    return { delivered: false, leadId };
  }

  const { contact, result, answers, questions } = input;
  const { public: pub, flags, roi } = result;

  const recommendationSummary = pub.recommendations
    .slice(0, 5)
    .map((r) => `[P${r.priority}] ${r.title} — ${r.recommendedAction} (service: ${r.service})`)
    .join('\n');

  const categorySummary = pub.categories
    .map((c) => `${c.label}: ${c.scorePercent}%`)
    .join('\n');

  const roiSummary = roi
    .map((r) => (r.available ? `${r.title}: ${r.estimateLabel}` : `${r.title}: Not enough data to estimate`))
    .join('\n');

  const attributionFields = buildLeadAttributionFields();
  // Rep attribution (?rep=code) — additive field(s); omitted entirely
  // when no code was captured, so organic/direct leads keep the exact
  // payload shape they have always had.
  const repFields = buildRepLeadFields();
  const repCode = repFields.rep_code ?? null;

  const payload: Record<string, string> = {
    access_key: WEB3FORMS_ACCESS_KEY,
    subject: `AI Assessment Lead — ${contact.company || contact.firstName}`,
    from_name: 'Your AI Department — AI Assessment',

    // LEAD SUMMARY — everything a salesperson needs to triage this lead
    // in under 30 seconds, consolidated into one field so it always
    // appears together regardless of how Web3Forms orders the overall
    // set of submitted fields. The complete, granular data (category
    // scores, recommendations, ROI, full answers, individual
    // attribution fields) still follows below — nothing is removed,
    // only reordered and given a scannable summary up front.
    lead_summary: buildLeadSummary({ contact, result, answers, leadId, attribution: attributionFields, repCode }),

    // CONTACT (individual fields retained for any automated processing)
    first_name: contact.firstName,
    last_name: contact.lastName || '',
    email: contact.email,
    phone: contact.phone || '',
    company: contact.company || '',
    website: contact.website || '',
    marketing_opt_in: contact.marketingOptIn ? 'yes' : 'no',

    // CATEGORY SCORES
    category_scores: categorySummary,

    // RECOMMENDATIONS
    recommendations: recommendationSummary,

    // ROI / OPPORTUNITY ESTIMATES
    roi_estimates: roiSummary,

    // ASSESSMENT METADATA
    assessment_version: String(result.assessmentVersion),
    overall_score: String(pub.overallScore),
    maturity_stage: pub.stage,
    flags: flags.join(', '),
    commercial_classification: result.commercial.classification,
    enterprise_candidate: result.commercial.enterpriseCandidate ? 'yes' : 'no',
    completed_at: result.completedAt,

    // FULL ASSESSMENT ANSWERS
    answer_summary: buildReadableAnswerSummary(answers, questions),

    // IDENTIFIER
    lead_id: leadId,
  };

  // ATTRIBUTION — non-PII acquisition context, same shared module used
  // by the Contact form and Cal.com link enrichment (src/lib/attribution.ts).
  // Individual fields retained here for automated processing; the
  // readable one-line version already appears in lead_summary above.
  // Rep attribution fields join the same way (omitted when none).
  Object.assign(payload, attributionFields, repFields);

  try {
    const response = await fetch(WEB3FORMS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const result_ = await response.json().catch(() => null);
    return { delivered: Boolean(response.ok && result_?.success), leadId };
  } catch {
    return { delivered: false, leadId };
  }
}
