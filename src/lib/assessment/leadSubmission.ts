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

/** Non-PII fields to attach to the ai_assessment_lead_submit GA4 event.
 * Deliberately excludes the full result, answers, and any contact
 * field — only a lead correlation ID and a few coarse, non-sensitive
 * signals. */
export interface LeadAnalyticsFields {
  lead_id: string;
  assessment_version: string;
  score_band: string;
}

function scoreBand(overallScore: number): string {
  if (overallScore >= 80) return 'high';
  if (overallScore >= 50) return 'medium';
  return 'low';
}

export function buildLeadAnalyticsFields(leadId: string, result: FullAssessmentResult): LeadAnalyticsFields {
  return {
    lead_id: leadId,
    assessment_version: String(result.assessmentVersion),
    score_band: scoreBand(result.public.overallScore),
  };
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
    .map((r) => (r.available ? `${r.title}: ${r.estimateLabel}` : `${r.title}: not available (${r.reason})`))
    .join('\n');

  const payload: Record<string, string> = {
    access_key: WEB3FORMS_ACCESS_KEY,
    subject: `AI Assessment Lead — ${contact.company || contact.firstName}`,
    from_name: 'Your AI Department — AI Assessment',

    // CONTACT
    first_name: contact.firstName,
    last_name: contact.lastName || '',
    email: contact.email,
    phone: contact.phone || '',
    company: contact.company || '',
    website: contact.website || '',
    marketing_opt_in: contact.marketingOptIn ? 'yes' : 'no',

    // ASSESSMENT
    assessment_version: String(result.assessmentVersion),
    overall_score: String(pub.overallScore),
    maturity_stage: pub.stage,
    category_scores: categorySummary,
    recommendations: recommendationSummary,
    roi_estimates: roiSummary,
    flags: flags.join(', '),
    commercial_classification: result.commercial.classification,
    enterprise_candidate: result.commercial.enterpriseCandidate ? 'yes' : 'no',
    completed_at: result.completedAt,
    answer_summary: buildReadableAnswerSummary(answers, questions),

    // IDENTIFIER
    lead_id: leadId,
  };

  // ATTRIBUTION — non-PII acquisition context, same shared module used
  // by the Contact form and Cal.com link enrichment (src/lib/attribution.ts).
  Object.assign(payload, buildLeadAttributionFields());

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
