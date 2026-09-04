import { html, raw, type RawHtml } from '../html.js';
import { formatDateTime, relativeTime, titleCase } from '../format.js';

/**
 * Shared CRM primitives.
 * Authority: yad-sales-crm-component-contract.v1.yaml.
 *
 * Global rules these enforce, so no page has to remember them:
 *   - unknown stays unknown;
 *   - stale evidence renders as stale;
 *   - a main business line never renders as a direct person's phone;
 *   - status is never colour-only;
 *   - no component infers business truth the server did not supply.
 */

// ------------------------------------------------------------------ StatusPill

export type SemanticState =
  | 'neutral' | 'info' | 'success' | 'warning' | 'destructive' | 'stale' | 'blocked' | 'review';

const SEMANTIC_CLASS: Record<SemanticState, string> = {
  neutral: 'pill-neutral', info: 'pill-info', success: 'pill-success',
  warning: 'pill-warning', destructive: 'pill-destructive', stale: 'pill-stale',
  blocked: 'pill-blocked', review: 'pill-review',
};

/** Status is never colour-only: every pill carries its own label. */
export function statusPill(label: string, state: SemanticState = 'neutral', tooltip?: string): RawHtml {
  return html`<span class="pill ${SEMANTIC_CLASS[state]}"${
    tooltip ? raw(` title="${tooltip.replace(/"/g, '&quot;')}"`) : ''
  }>${label}</span>`;
}

// ------------------------------------------------------------------- TierBadge

/** A tier is a fit signal. It implies nothing about permission to contact. */
export function tierBadge(tier: string | null, score: number | null, maxScore = 15): RawHtml {
  if (!tier) return html`<span class="pill pill-unscored">Unscored</span>`;
  const label = score === null || score === undefined ? tier : `${tier} · ${score}`;
  return html`<span class="pill pill-tier-${tier}" title="Fit score ${score ?? '?'} of ${maxScore}. Fit does not grant permission to contact.">${label}</span>`;
}

// ------------------------------------------------------------- AdEvidenceBadge

export interface AdEvidence {
  channel: 'google_ads' | 'lsa' | 'meta' | 'other';
  observedAt?: Date | null;
  freshness?: 'fresh' | 'aging' | 'stale' | 'unknown';
}

const AD_LABEL: Record<AdEvidence['channel'], string> = {
  google_ads: 'Google', lsa: 'LSA', meta: 'Meta', other: 'Ads',
};

/** No spend is ever implied. Stale evidence looks different from current evidence. */
export function adEvidenceBadge(evidence: AdEvidence): RawHtml {
  const stale = evidence.freshness === 'stale';
  const seen = evidence.observedAt ? ` · seen ${relativeTime(evidence.observedAt)}` : '';
  return html`<span class="pill ${stale ? 'pill-stale' : 'pill-ad'}"
    title="Evidence that advertising exists${seen}. Never a claim about spend.">${
      AD_LABEL[evidence.channel]}${stale ? ' (stale)' : ''}</span>`;
}

export function adEvidenceRow(row: {
  google_paid?: boolean | null; google_lsa?: boolean | null; meta_paid?: boolean | null;
}): RawHtml {
  const badges: RawHtml[] = [];
  if (row.google_paid) badges.push(adEvidenceBadge({ channel: 'google_ads' }));
  if (row.google_lsa) badges.push(adEvidenceBadge({ channel: 'lsa' }));
  if (row.meta_paid) badges.push(adEvidenceBadge({ channel: 'meta' }));
  // Nothing observed renders as nothing. Absence of evidence is not evidence of absence.
  return badges.length === 0 ? html`<span class="muted micro">—</span>` : html`${badges}`;
}

// ---------------------------------------------------------- ContactRouteBadge

export type ContactRouteType =
  | 'direct_business' | 'extension' | 'business_mobile' | 'named_via_main_line'
  | 'role_via_main_line' | 'generic_main_line' | 'email_direct' | 'email_role'
  | 'email_general' | 'unknown';

const ROUTE_LABEL: Record<ContactRouteType, string> = {
  direct_business: 'Direct business line',
  extension: 'Extension',
  business_mobile: 'Business mobile',
  named_via_main_line: 'Main line — ask for the named person',
  role_via_main_line: 'Main line — ask for the role',
  generic_main_line: 'Generic main line',
  email_direct: 'Named work email',
  email_role: 'Role mailbox',
  email_general: 'General mailbox',
  unknown: 'Route unknown',
};

/**
 * Directness and person identity are separate axes. A main line stays a main line
 * however confident we are about who works there.
 */
export function contactRouteBadge(input: {
  routeType: ContactRouteType; quality?: string | null;
  sourceClass?: string | null; lastVerified?: Date | null;
}): RawHtml {
  const strong = input.routeType === 'direct_business' || input.routeType === 'email_direct';
  const tooltip = [
    input.quality ? `Quality: ${titleCase(input.quality)}` : null,
    input.sourceClass ? `Source: ${titleCase(input.sourceClass)}` : null,
    input.lastVerified ? `Verified ${relativeTime(input.lastVerified)}` : null,
  ].filter(Boolean).join(' · ');
  return html`<span class="pill ${strong ? 'pill-success' : 'pill-neutral'}"${
    tooltip ? raw(` title="${tooltip}"`) : ''
  }>${ROUTE_LABEL[input.routeType]}</span>`;
}

/** Derives the route type from stored endpoint semantics. Never guesses upward. */
export function routeTypeFor(input: {
  endpointRole: string | null; relationshipToPerson: string | null;
  hasNamedPerson: boolean; isRoleOnly: boolean;
}): ContactRouteType {
  const role = input.endpointRole ?? '';
  if (role === 'DIRECT_BUSINESS_LINE'
    && (input.relationshipToPerson === 'DIRECT_CONFIRMED'
      || input.relationshipToPerson === 'DIRECT_PROVIDER_ASSERTED')) {
    return 'direct_business';
  }
  if (role === 'EXTENSION') return 'extension';
  if (role === 'MOBILE_ASSERTED_BUSINESS') return 'business_mobile';
  if (role === 'DIRECT_PERSON_EMAIL') return 'email_direct';
  if (role === 'ROLE_EMAIL') return 'email_role';
  if (role === 'GENERAL_BUSINESS_EMAIL' || role === 'LOCATION_EMAIL') return 'email_general';
  if (role.includes('BUSINESS_LINE') || role === 'TOLL_FREE_BUSINESS' || role === 'CALL_TRACKING_NUMBER') {
    if (input.hasNamedPerson && !input.isRoleOnly) return 'named_via_main_line';
    if (input.isRoleOnly) return 'role_via_main_line';
    return 'generic_main_line';
  }
  return 'unknown';
}

// -------------------------------------------------------- ChannelStatusBadge

export type ChannelKind = 'human_phone' | 'email' | 'ai_voice' | 'sms';
export type ChannelStatus =
  | 'allowed' | 'ready' | 'review' | 'blocked' | 'research_needed' | 'suppressed';

const CHANNEL_LABEL: Record<ChannelKind, string> = {
  human_phone: 'Human call', email: 'Email', ai_voice: 'AI voice', sms: 'SMS',
};
const CHANNEL_STATE: Record<ChannelStatus, SemanticState> = {
  allowed: 'success', ready: 'success', review: 'review',
  blocked: 'blocked', research_needed: 'warning', suppressed: 'destructive',
};
const CHANNEL_STATUS_LABEL: Record<ChannelStatus, string> = {
  allowed: 'allowed', ready: 'ready', review: 'review required',
  blocked: 'blocked', research_needed: 'research needed', suppressed: 'suppressed',
};

/** The frontend renders this; it never decides it. */
export function channelStatusBadge(input: {
  channel: ChannelKind; status: ChannelStatus;
  reasonShort?: string | null; evaluatedAt?: Date | null;
}): RawHtml {
  const tooltip = [
    input.reasonShort,
    input.evaluatedAt ? `Checked ${relativeTime(input.evaluatedAt)}` : null,
  ].filter(Boolean).join(' · ');
  return html`<span class="pill ${SEMANTIC_CLASS[CHANNEL_STATE[input.status]]}"${
    tooltip ? raw(` title="${tooltip.replace(/"/g, '&quot;')}"`) : ''
  }>${CHANNEL_LABEL[input.channel]}: ${CHANNEL_STATUS_LABEL[input.status]}</span>`;
}

/** Maps a stored eligibility decision onto a badge status. */
export function decisionToStatus(decision: string | null | undefined): ChannelStatus {
  switch (decision) {
    case 'ALLOW': return 'allowed';
    case 'REVIEW_REQUIRED': return 'review';
    case 'BLOCK': return 'blocked';
    case 'NOT_APPLICABLE': return 'blocked';
    default: return 'research_needed';
  }
}

// ---------------------------------------------------------------- KpiCard

export function kpiCard(input: {
  label: string; value: string | number; sub?: string | null;
  tone?: 'default' | 'attention' | 'good'; href?: string | null;
}): RawHtml {
  const body = html`
    <div class="kpi-label">${input.label}</div>
    <div class="kpi-value ${input.tone === 'attention' ? 'attention' : input.tone === 'good' ? 'good' : ''}">${input.value}</div>
    ${input.sub ? html`<div class="kpi-sub">${input.sub}</div>` : ''}`;
  return input.href
    ? html`<a class="card kpi kpi-link" href="${input.href}">${body}</a>`
    : html`<div class="card kpi">${body}</div>`;
}

// ------------------------------------------------------------- state blocks

export function emptyState(input: {
  title: string; explanation: string; action?: { href: string; label: string } | null;
}): RawHtml {
  return html`<div class="state-block">
    <div class="state-icon" aria-hidden="true">◎</div>
    <h3>${input.title}</h3>
    <p>${input.explanation}</p>
    ${input.action ? html`<a class="btn btn-primary" href="${input.action.href}">${input.action.label}</a>` : ''}
  </div>`;
}

/** Mirrors the final layout rather than showing a generic spinner. */
export function loadingSkeleton(rows = 5): RawHtml {
  return html`<div class="skeleton-wrap" aria-busy="true" aria-label="Loading">
    ${Array.from({ length: rows }, () => html`<div class="skeleton-row">
      <span class="skeleton-cell wide"></span><span class="skeleton-cell"></span>
      <span class="skeleton-cell narrow"></span><span class="skeleton-cell narrow"></span>
    </div>`)}
  </div>`;
}

/** Never a stack trace, never a provider detail. */
export function errorState(input: {
  message: string; retryHref?: string | null; correlationId?: string | null;
}): RawHtml {
  return html`<div class="state-block state-error">
    <div class="state-icon" aria-hidden="true">!</div>
    <h3>Something went wrong</h3>
    <p>${input.message}</p>
    ${input.retryHref ? html`<a class="btn btn-secondary" href="${input.retryHref}">Try again</a>` : ''}
    ${input.correlationId ? html`<p class="micro muted">Reference: ${input.correlationId}</p>` : ''}
  </div>`;
}

// -------------------------------------------------------------- EvidenceFact

export type EvidenceClass = 'confirmed' | 'likely' | 'hypothesis' | 'contradicted' | 'unknown';

const EVIDENCE_STATE: Record<EvidenceClass, SemanticState> = {
  confirmed: 'success', likely: 'info', hypothesis: 'warning',
  contradicted: 'destructive', unknown: 'neutral',
};

/** A hypothesis must be visually distinct from a confirmed fact. */
export function evidenceFact(input: {
  statement: string; factClass: EvidenceClass; source?: string | null;
  observedAt?: Date | null; freshness?: string | null;
}): RawHtml {
  const stale = input.freshness === 'stale';
  return html`<li class="evidence-fact evidence-${input.factClass}${stale ? ' evidence-stale' : ''}">
    <div class="evidence-statement">${input.statement}</div>
    <div class="evidence-meta">
      ${statusPill(stale ? `${input.factClass} · stale` : input.factClass,
        stale ? 'stale' : EVIDENCE_STATE[input.factClass])}
      ${input.source ? html`<span class="muted micro">${titleCase(input.source)}</span>` : ''}
      ${input.observedAt ? html`<span class="muted micro">${relativeTime(input.observedAt)}</span>` : ''}
    </div>
  </li>`;
}

// ------------------------------------------------------------ HypothesisCard

export type HypothesisSupport = 'untested' | 'supported' | 'contradicted' | 'inconclusive';

export function hypothesisCard(input: {
  problemFamily: string; text: string; support: HypothesisSupport;
  firstQuestion?: string | null; isBackup?: boolean;
}): RawHtml {
  const state: SemanticState = input.support === 'supported' ? 'success'
    : input.support === 'contradicted' ? 'destructive'
    : input.support === 'inconclusive' ? 'warning' : 'info';
  return html`<div class="hypothesis-card${input.isBackup ? ' hypothesis-backup' : ''}">
    <div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px">
      <h4>${input.isBackup ? 'Backup: ' : ''}${titleCase(input.problemFamily)}</h4>
      ${statusPill(input.support, state)}
    </div>
    <p class="hypothesis-text">${input.text}</p>
    <p class="micro muted">A hypothesis to test on the call, not a fact about their business.</p>
    ${input.firstQuestion ? html`<div class="first-question">
      <span class="micro muted">Ask</span>
      <p>“${input.firstQuestion}”</p>
    </div>` : ''}
  </div>`;
}

// ------------------------------------------------------------------- Timeline

export interface TimelineEntry {
  occurredAt: Date;
  actor?: string | null;
  channel?: string | null;
  type: string;
  summary: string;
  outcome?: string | null;
}

const TIMELINE_ICON: Record<string, string> = {
  DISCOVERED: '◎', RESEARCHED: '❖', CONTACT_ENRICHED: '❖', SCORE_CHANGED: '◈',
  CLAIMED: '⚑', RELEASED: '⚐', REASSIGNED: '⇄',
  CALL_ATTEMPT: '☎', VOICEMAIL: '☎', EMAIL_SENT: '✉', EMAIL_REPLY: '✉',
  CALLBACK_REQUESTED: '⏱', MEETING_SCHEDULED: '★', MEETING_BOOKING_FAILED: '✕',
  DNC: '⊘', WRONG_ENDPOINT: '✕', NOTE: '•', OPPORTUNITY_CREATED: '◆',
  FIELD_VISIT: '⌂', IMPORTED: '⇩',
};

export function timeline(entries: TimelineEntry[]): RawHtml {
  if (entries.length === 0) {
    return html`<p class="muted small">Nothing has happened with this company yet.</p>`;
  }
  return html`<ol class="timeline-list">
    ${entries.map((entry) => html`<li class="timeline-item">
      <span class="timeline-icon" aria-hidden="true">${TIMELINE_ICON[entry.type] ?? '•'}</span>
      <div class="timeline-body">
        <div class="timeline-head">
          <strong>${titleCase(entry.outcome ?? entry.type)}</strong>
          <span class="timeline-time" title="${formatDateTime(entry.occurredAt)}">${relativeTime(entry.occurredAt)}</span>
        </div>
        ${entry.summary ? html`<div class="timeline-summary">${entry.summary}</div>` : ''}
        ${entry.actor ? html`<div class="micro muted">${entry.actor}</div>` : ''}
      </div>
    </li>`)}
  </ol>`;
}

// ------------------------------------------------------------- ConfirmDialog

/** Rendered inert; portal.js wires it. Used for anything material or destructive. */
export function confirmDialog(input: {
  id: string; title: string; consequence: string;
  confirmLabel: string; cancelLabel?: string; tone?: 'default' | 'destructive';
  /** When present the dialog posts here, so the confirmation is the action. */
  action?: string;
  /** Extra inputs the action needs, such as a required reason. */
  fields?: RawHtml;
}): RawHtml {
  const buttons = html`<div class="row" style="justify-content:flex-end;gap:8px;margin-top:16px">
    <button class="btn btn-secondary js-dialog-cancel" type="button" data-dialog="${input.id}">${input.cancelLabel ?? 'Cancel'}</button>
    <button class="btn ${input.tone === 'destructive' ? 'btn-danger' : 'btn-primary'} js-dialog-confirm"
            type="submit" data-dialog="${input.id}">${input.confirmLabel}</button>
  </div>`;

  return html`<div class="dialog-scrim" id="${input.id}-scrim" hidden>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="${input.id}-title">
      <h3 id="${input.id}-title">${input.title}</h3>
      <p>${input.consequence}</p>
      ${input.action
        ? html`<form method="post" action="${input.action}">
            ${input.fields ?? ''}
            ${buttons}
          </form>`
        : buttons}
    </div>
  </div>`;
}

export { titleCase, relativeTime, formatDateTime };
