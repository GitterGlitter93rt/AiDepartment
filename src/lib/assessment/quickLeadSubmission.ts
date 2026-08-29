// Quick Score lead submission — delivery of a completed quick-score
// lead via the same Web3Forms account/endpoint pattern already proven
// by the full assessment (leadSubmission.ts) and the Contact page.
// Deliberately a separate module so the full engine's delivery path
// stays untouched; the lead email is distinguishable by its subject
// line ("AI Quick Score Lead — …") so sales can triage the lighter
// funnel entry separately from full-assessment leads.
//
// The payload carries marketing attribution (utm/gclid) AND rep
// attribution (?rep=code) alongside a compact readable summary.

import type { QuickContactInfo } from './quickPersistence';
import type { QuickAnswerMap, QuickQuestionDef, QuickResult } from '../../data/assessment/quickTypes';
import { buildLeadAttributionFields, generateLeadId } from '../attribution.ts';
import { buildRepLeadFields } from '../repAttribution.ts';
import {
  ASSESSMENT_TYPE,
  buildAssessmentLeadSubmitParams,
} from './ga4Events.ts';

// Same Web3Forms account used by the Contact page and the full
// assessment. Client-side access keys are Web3Forms' documented,
// intended public identifier — not an account secret.
const WEB3FORMS_ACCESS_KEY = 'aef33e06-d5f2-450f-86f3-1908340e7e5d';
const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';

export interface QuickLeadOutcome {
  delivered: boolean;
  leadId: string;
}

/** Validate the required quick-score contact fields. Pure function. */
export function validateQuickContact(contact: Pick<QuickContactInfo, 'firstName' | 'email' | 'company'>): string | null {
  if (!contact.firstName || !contact.email || !contact.company) {
    return 'First name, business email, and company are required.';
  }
  return null;
}

/** Human-readable "question — answer" block using each question's real
 * prompt and option labels, so the lead email reads naturally. */
export function buildQuickAnswerSummary(answers: QuickAnswerMap, questions: QuickQuestionDef[]): string {
  const lines: string[] = [];
  for (const q of questions) {
    const val = answers[q.id];
    if (typeof val !== 'string' || val.trim().length === 0) continue;
    lines.push(`${q.prompt}\n${val}`);
  }
  return lines.join('\n\n');
}

/** Non-PII GA4 fields for the free funnel's ai_assessment_lead_submit
 * event. Delegates to the shared GA4 module so the funnel parameters
 * (assessment_type "free_opportunity", assessment_version "short_v1")
 * have exactly one source of truth. Contains no contact fields, no
 * answers, and no result data. */
export function buildQuickLeadAnalyticsFields(leadId: string, result: QuickResult): Record<string, string> {
  return buildAssessmentLeadSubmitParams(ASSESSMENT_TYPE.free, leadId, result.overallScore);
}

/** Readable one-line attribution summary for the lead block. */
function buildAttributionSummary(attribution: Record<string, string>): string {
  const parts: string[] = [];
  if (attribution.attribution_utm_source || attribution.attribution_utm_medium) {
    parts.push(`Source: ${attribution.attribution_utm_source || 'unknown'} / ${attribution.attribution_utm_medium || 'unknown'}`);
  }
  if (attribution.attribution_utm_campaign) parts.push(`Campaign: ${attribution.attribution_utm_campaign}`);
  if (attribution.attribution_gclid) parts.push('Google Ads click (gclid present)');
  if (attribution.attribution_first_landing_page) parts.push(`First landing page: ${attribution.attribution_first_landing_page}`);
  return parts.length > 0 ? parts.join(' | ') : 'No paid/UTM attribution captured for this session (organic, direct, or referral traffic).';
}

export interface QuickLeadSubmissionInput {
  contact: QuickContactInfo;
  result: QuickResult;
  answers: QuickAnswerMap;
  questions: QuickQuestionDef[];
}

/** Build the compact scan-first lead summary block. */
function buildQuickLeadSummary(input: {
  contact: QuickContactInfo;
  result: QuickResult;
  leadId: string;
  attribution: Record<string, string>;
  repCode: string | null;
}): string {
  const { contact, result, leadId, attribution, repCode } = input;
  const signals = result.signals
    .slice(0, 3)
    .map((s, i) => `  ${i + 1}. ${s.title}`)
    .join('\n');

  const lines = [
    `Name: ${contact.firstName}${contact.lastName ? ' ' + contact.lastName : ''}`,
    `Company: ${contact.company || 'Not provided'}`,
    `Email: ${contact.email}`,
    `Phone: ${contact.phone || 'Not provided'}`,
    `Website: ${contact.website || 'Not provided'}`,
    ``,
    `Overall AI Score: ${result.overallScore}`,
    `Maturity Stage: ${result.stage}`,
    `Enterprise Candidate: ${result.enterpriseCandidate ? 'Yes' : 'No'}`,
    ``,
    `Industry: ${result.commercial.industry ?? 'Not provided'}`,
    `Employee Count: ${result.commercial.employeeBand ?? 'Not provided'}`,
    `Implementation Timeframe: ${result.commercial.timeframe ?? 'Not provided'}`,
    `Internal Urgency (0-5): ${result.commercial.urgency}`,
    ``,
    `Top Opportunity Signals:`,
    signals || '  None generated',
    ``,
    `Lead ID: ${leadId}`,
    repCode ? `Sales Rep: ${repCode}` : `Sales Rep: none captured`,
    `Attribution: ${buildAttributionSummary(attribution)}`,
  ];
  return lines.join('\n');
}

/** Submit the completed quick score (contact + result + answers +
 * attribution) to Web3Forms as one readable lead email. Returns whether
 * delivery actually succeeded — callers must only treat `delivered:
 * true` as success. */
export async function submitQuickLead(input: QuickLeadSubmissionInput): Promise<QuickLeadOutcome> {
  const leadId = generateLeadId();

  if (!WEB3FORMS_ACCESS_KEY || WEB3FORMS_ACCESS_KEY.startsWith('REPLACE_WITH')) {
    return { delivered: false, leadId };
  }

  const { contact, result, answers, questions } = input;

  const categorySummary = result.categories
    .map((c) => `${c.label}: ${c.scorePercent}%`)
    .join('\n');

  const signalsSummary = result.signals
    .map((s) => `${s.title} — ${s.action} (service: ${s.serviceLabel})`)
    .join('\n') || 'None generated';

  const attributionFields = buildLeadAttributionFields();
  const repFields = buildRepLeadFields();
  const repCode = repFields.rep_code ?? null;

  const payload: Record<string, string> = {
    access_key: WEB3FORMS_ACCESS_KEY,
    subject: `AI Quick Score Lead — ${contact.company || contact.firstName}`,
    from_name: 'Your AI Department — AI Quick Score',

    // Scan-first summary for the salesperson.
    lead_summary: buildQuickLeadSummary({ contact, result, leadId, attribution: attributionFields, repCode }),

    // CONTACT
    first_name: contact.firstName,
    last_name: contact.lastName || '',
    email: contact.email,
    phone: contact.phone || '',
    company: contact.company || '',
    website: contact.website || '',
    marketing_opt_in: contact.marketingOptIn ? 'yes' : 'no',

    // SCORE + SIGNALS
    assessment_version: String(result.assessmentVersion),
    overall_score: String(result.overallScore),
    maturity_stage: result.stage,
    category_scores: categorySummary,
    opportunity_signals: signalsSummary,
    enterprise_candidate: result.enterpriseCandidate ? 'yes' : 'no',
    completed_at: result.completedAt,

    // FULL ANSWERS
    answer_summary: buildQuickAnswerSummary(answers, questions),

    // IDENTIFIER
    lead_id: leadId,
  };

  // Marketing attribution + rep attribution (omitted entirely when
  // nothing was captured, so organic/direct leads keep the same shape).
  Object.assign(payload, attributionFields, repFields);

  try {
    const response = await fetch(WEB3FORMS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);
    return { delivered: Boolean(response.ok && body?.success), leadId };
  } catch {
    return { delivered: false, leadId };
  }
}
