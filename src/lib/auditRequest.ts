// Comprehensive AI Business Audit — request delivery.
//
// Gating model (deliberate): the $495 audit is NOT sold through any
// payment infrastructure on this site. There is no checkout, no card
// fields, and no payment-processing code — the audit is gated behind a
// request form. The request arrives as a flagged lead email; the team
// then confirms scope and arranges payment directly (invoice / payment
// link). Only after payment is confirmed does the audit begin.
//
// INTEGRATION STATUS: a real checkout integration (e.g., Stripe) is
// still required before payment could ever be collected on-site. None
// exists today, and none is simulated — do not add UI that appears to
// process payment until that integration is built and approved. Do not
// invent Stripe links or keys.
//
// PAID-ACCESS RULE: payment/authorization must be implemented before
// paid customers are automatically granted access to the underlying
// comprehensive engine (/ai-assessment/full/). Until then, the engine is
// internal-access only and must never be publicly promoted as a free
// alternative to this $495 audit.
//
// Delivery uses the same Web3Forms account/endpoint pattern already
// proven by the Contact page and both assessment funnels. Marketing
// attribution and rep attribution (?rep=code) are attached so every
// audit request is attributable to the rep or campaign that produced
// it.

import { buildLeadAttributionFields, generateLeadId } from './attribution.ts';
import { buildRepLeadFields } from './repAttribution.ts';

// Same Web3Forms account used across the site — a client-side access
// key is Web3Forms' documented, intended public identifier.
const WEB3FORMS_ACCESS_KEY = 'aef33e06-d5f2-450f-86f3-1908340e7e5d';
const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';

export const AUDIT_PRICE_LABEL = '$495';

export interface AuditRequestInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company: string;
  website?: string;
  /** Optional: what the prospect most wants examined. */
  focus?: string;
}

export interface AuditLeadOutcome {
  delivered: boolean;
  leadId: string;
}

/** Validate the required audit-request fields. Pure function. */
export function validateAuditRequest(request: Pick<AuditRequestInfo, 'firstName' | 'email' | 'company'>): string | null {
  if (!request.firstName || !request.email || !request.company) {
    return 'First name, business email, and company are required.';
  }
  return null;
}

/** Non-PII GA4 fields for the paid_audit_request_submit event. */
export interface AuditRequestAnalyticsFields {
  lead_id: string;
}

export function buildAuditRequestAnalyticsFields(leadId: string): AuditRequestAnalyticsFields {
  return { lead_id: leadId };
}

function buildAuditLeadSummary(input: {
  request: AuditRequestInfo;
  leadId: string;
  attribution: Record<string, string>;
  repCode: string | null;
}): string {
  const { request, leadId, attribution, repCode } = input;
  const parts: string[] = [];
  if (attribution.attribution_utm_source || attribution.attribution_utm_medium) {
    parts.push(`Source: ${attribution.attribution_utm_source || 'unknown'} / ${attribution.attribution_utm_medium || 'unknown'}`);
  }
  if (attribution.attribution_utm_campaign) parts.push(`Campaign: ${attribution.attribution_utm_campaign}`);
  if (attribution.attribution_gclid) parts.push('Google Ads click (gclid present)');

  const lines = [
    `COMPREHENSIVE AI BUSINESS AUDIT REQUEST — ${AUDIT_PRICE_LABEL}`,
    `Payment is arranged manually after scope confirmation — do NOT begin the audit until payment is confirmed.`,
    ``,
    `Name: ${request.firstName}${request.lastName ? ' ' + request.lastName : ''}`,
    `Company: ${request.company}`,
    `Email: ${request.email}`,
    `Phone: ${request.phone || 'Not provided'}`,
    `Website: ${request.website || 'Not provided'}`,
    ``,
    `Requested Focus: ${request.focus || 'Not provided'}`,
    ``,
    `Lead ID: ${leadId}`,
    repCode ? `Sales Rep: ${repCode}` : `Sales Rep: none captured`,
    parts.length > 0 ? `Attribution: ${parts.join(' | ')}` : `Attribution: none captured`,
  ];
  return lines.join('\n');
}

/** Submit the audit request to Web3Forms as a flagged paid-audit lead
 * email. Returns whether delivery actually succeeded — callers must
 * only treat `delivered: true` as success. */
export async function submitAuditRequest(request: AuditRequestInfo): Promise<AuditLeadOutcome> {
  const leadId = generateLeadId();

  if (!WEB3FORMS_ACCESS_KEY || WEB3FORMS_ACCESS_KEY.startsWith('REPLACE_WITH')) {
    return { delivered: false, leadId };
  }

  const attributionFields = buildLeadAttributionFields();
  const repFields = buildRepLeadFields();
  const repCode = repFields.rep_code ?? null;

  const payload: Record<string, string> = {
    access_key: WEB3FORMS_ACCESS_KEY,
    subject: `Comprehensive AI Business Audit Request — ${AUDIT_PRICE_LABEL} — ${request.company || request.firstName}`,
    from_name: 'Your AI Department — Comprehensive AI Business Audit',

    lead_summary: buildAuditLeadSummary({ request, leadId, attribution: attributionFields, repCode }),

    first_name: request.firstName,
    last_name: request.lastName || '',
    email: request.email,
    phone: request.phone || '',
    company: request.company || '',
    website: request.website || '',
    requested_focus: request.focus || '',
    product: 'Comprehensive AI Business Audit',
    price: AUDIT_PRICE_LABEL,
    lead_id: leadId,
  };

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
