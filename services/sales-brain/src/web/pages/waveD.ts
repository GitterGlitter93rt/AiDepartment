import { html, type RawHtml } from '../html.js';
import { renderPage } from '../layout.js';
import type { NavCounts } from '../components/shell.js';
import {
  confirmDialog, emptyState, kpiCard, statusPill, tierBadge, timeline,
} from '../components/primitives.js';
import { formatDateTime, relativeTime, titleCase } from '../format.js';
import type { SessionUser } from '../../domain/auth.js';
import type { CandidateRow, PilotState } from '../../domain/pilot.js';
import type { IntegrationView } from '../../domain/settings.js';
import type { SearchHit } from '../../api/waveDQueries.js';

/**
 * Sales AI Pilot, Call Review, Campaigns, Analytics, Settings.
 * Authority: YAD-SALES-CRM-UI-MOCKUPS-CURRENT.md §17-§18, §23-§25;
 * yad-sales-crm-page-acceptance-matrix.v1.yaml.
 */

// ------------------------------------------------------------- Sales AI Pilot

const MODE_STATE: Record<string, Parameters<typeof statusPill>[1]> = {
  OFF: 'neutral',
  INTERNAL_TEST: 'info',
  CONTROLLED_PILOT: 'warning',
  ENABLED_BY_POLICY: 'success',
};

function switchRow(input: {
  field: string; label: string; explanation: string; on: boolean; disabled?: boolean;
}): RawHtml {
  return html`<div class="switch-row">
    <div>
      <div class="switch-label">${input.label}</div>
      <p class="muted small">${input.explanation}</p>
    </div>
    <form method="post" action="/ai/pilot/switch" class="row" style="gap:8px;align-items:center">
      <input type="hidden" name="field" value="${input.field}">
      <input type="hidden" name="value" value="${input.on ? 'false' : 'true'}">
      <input type="text" name="reason" placeholder="Reason" required
             aria-label="Reason for changing ${input.label}" class="input-inline">
      ${statusPill(input.on ? 'On' : 'Off', input.on ? 'success' : 'neutral')}
      <button type="submit" class="btn btn-sm ${input.on ? 'btn-secondary' : 'btn-primary'}"
              ${input.disabled ? 'disabled' : ''}>
        Turn ${input.on ? 'off' : 'on'}
      </button>
    </form>
  </div>`;
}

export function renderPilotPage(input: {
  user: SessionUser; counts: NavCounts; state: PilotState; candidates: CandidateRow[];
  flash?: string | null; error?: string | null;
}): string {
  const { user, counts, state, candidates } = input;
  const live = candidates.filter((row) => row.state === 'QUEUED' || row.state === 'PREFLIGHT_PASSED');
  const called = candidates.filter((row) => row.state === 'CALLED');

  const body = html`
    ${input.flash ? html`<div class="coverage-note info" role="status" style="margin-bottom:16px">${input.flash}</div>` : ''}
    ${input.error ? html`<div class="coverage-note warn" role="alert" style="margin-bottom:16px">${input.error}</div>` : ''}

    <div class="grid grid-kpi">
      ${kpiCard({ label: 'Candidates', value: candidates.filter((row) => row.state === 'CANDIDATE').length,
                  sub: 'awaiting preflight' })}
      ${kpiCard({ label: 'Cleared to call', value: live.length,
                  tone: live.length > 0 ? 'good' : 'default', sub: 'preflight passed' })}
      ${kpiCard({ label: 'Calls made', value: called.length, sub: 'this pilot' })}
      ${kpiCard({ label: 'Concurrency', value: state.maxConcurrency,
                  sub: state.maxConcurrency === 1 ? 'one call at a time' : 'operator raised' })}
    </div>

    <div style="height:18px"></div>

    <div class="card">
      <div class="card-head">
        <h2>Operator switches</h2>
        <span class="muted small">
          Changes apply to new calls only. A call in progress keeps the mode it started under.
        </span>
      </div>
      <div class="switch-list">
        <div class="switch-row">
          <div>
            <div class="switch-label">Outbound Sales AI</div>
            <p class="muted small">
              OFF stops everything outbound. Internal test dials only allow-listed internal numbers.
            </p>
          </div>
          <form method="post" action="/ai/pilot/switch" class="row" style="gap:8px;align-items:center">
            <input type="hidden" name="field" value="outbound_mode">
            <label class="sr-only" for="outbound-mode">Outbound mode</label>
            <select name="value" id="outbound-mode" class="input-inline">
              ${(['OFF', 'INTERNAL_TEST', 'CONTROLLED_PILOT', 'ENABLED_BY_POLICY'] as const).map(
                (mode) => html`<option value="${mode}" ${mode === state.outboundMode ? 'selected' : ''}>
                  ${titleCase(mode.replace(/_/g, ' '))}
                </option>`)}
            </select>
            <input type="text" name="reason" placeholder="Reason" required
                   aria-label="Reason for the mode change" class="input-inline">
            <button type="submit" class="btn btn-primary">Apply</button>
          </form>
        </div>
        ${switchRow({
          field: 'inbound_receptionist', label: 'Inbound receptionist', on: state.inboundReceptionist,
          explanation: 'Independent of outbound. Turning outbound off never takes the receptionist down.',
        })}
        ${switchRow({
          field: 'outbound_dial_enabled', label: 'Outbound dial creation', on: state.outboundDialEnabled,
          explanation: 'Creates the actual call. Off means candidates can be prepared but never dialled.',
          disabled: state.outboundMode === 'OFF',
        })}
        ${switchRow({
          field: 'auto_book_enabled', label: 'Auto-book strategy calls', on: state.autoBookEnabled,
          explanation: 'When off, the agent captures a preferred time for a human to confirm.',
        })}
        ${switchRow({
          field: 'warm_transfer_enabled', label: 'Warm transfer to a human', on: state.warmTransferEnabled,
          explanation: 'Requires a reachable human on the other end; otherwise the agent must not promise one.',
        })}
      </div>
      ${state.stopReason ? html`<p class="muted small" style="margin-top:12px">
        Outbound was last stopped: ${state.stopReason}
      </p>` : ''}
      <p class="muted small" style="margin-top:12px">
        Last changed ${relativeTime(state.updatedAt)}${
          state.updatedByName ? ` by ${state.updatedByName}` : ''}.
      </p>
    </div>

    <div style="height:18px"></div>

    <div class="card">
      <div class="card-head">
        <h2>Candidate prospects</h2>
        <span class="muted small">Adding a prospect here never dials. Dialling needs a passed preflight.</span>
      </div>
      ${candidates.length === 0
        ? emptyState({
            title: 'No prospects on the pilot list',
            explanation: 'Add a prospect from an account page once its AI voice eligibility is resolved.',
            action: { href: '/find', label: 'Find prospects' },
          })
        : html`<div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>Company</th><th>Market</th><th>Fit</th><th>Target</th>
                <th>AI voice eligibility</th><th>State</th><th>Added</th><th>Action</th>
              </tr></thead>
              <tbody>
                ${candidates.map((row) => html`<tr>
                  <td><a href="/accounts/${row.accountId}">${row.companyName}</a></td>
                  <td>${row.market ?? html`<span class="muted">—</span>`}</td>
                  <td>${tierBadge(row.tier, row.score)}</td>
                  <td>${row.contactName
                    ? html`${row.contactName}${row.contactRole ? html` <span class="muted small">${row.contactRole}</span>` : ''}`
                    : html`<span class="muted">Not resolved</span>`}</td>
                  <td>
                    ${statusPill(
                      row.eligibilityAtAdd === 'ALLOW' ? 'Allowed'
                        : row.eligibilityAtAdd === 'BLOCK' ? 'Blocked'
                        : row.eligibilityAtAdd === 'REVIEW_REQUIRED' ? 'Review required' : 'Unknown',
                      row.eligibilityAtAdd === 'ALLOW' ? 'success'
                        : row.eligibilityAtAdd === 'BLOCK' ? 'blocked'
                        : row.eligibilityAtAdd === 'REVIEW_REQUIRED' ? 'review' : 'neutral',
                      row.eligibilityReason ?? undefined)}
                    ${row.evaluatedAt ? html`<div class="muted small">checked ${relativeTime(row.evaluatedAt)}</div>` : ''}
                  </td>
                  <td>${statusPill(titleCase(row.state.replace(/_/g, ' ')),
                        row.state === 'PREFLIGHT_PASSED' ? 'success'
                          : row.state === 'PREFLIGHT_FAILED' ? 'blocked' : 'neutral')}</td>
                  <td class="muted small">${relativeTime(row.addedAt)}${
                    row.addedByName ? html`<br>${row.addedByName}` : ''}</td>
                  <td class="row" style="gap:6px">
                    <form method="post" action="/ai/pilot/preflight">
                      <input type="hidden" name="pilotCandidateId" value="${row.pilotCandidateId}">
                      <button type="submit" class="btn btn-secondary btn-sm">Run preflight</button>
                    </form>
                    <form method="post" action="/ai/pilot/remove">
                      <input type="hidden" name="pilotCandidateId" value="${row.pilotCandidateId}">
                      <button type="submit" class="btn btn-secondary btn-sm">Remove</button>
                    </form>
                  </td>
                </tr>`)}
              </tbody>
            </table>
          </div>`}
    </div>`;

  return renderPage({
    title: 'Sales AI Pilot',
    subtitle: 'Operator control plane for outbound AI calling.',
    status: statusPill(titleCase(state.outboundMode.replace(/_/g, ' ')),
                       MODE_STATE[state.outboundMode] ?? 'neutral'),
    actions: html`<button type="button" class="btn btn-danger" data-dialog="stop-outbound">
      Stop new outbound calls
    </button>`,
    overlays: confirmDialog({
      id: 'stop-outbound',
      title: 'Stop new outbound calls',
      consequence: 'Outbound mode goes to OFF and dial creation is disabled. A call already in '
        + 'progress finishes normally; queued candidates go back to review. The inbound '
        + 'receptionist is not affected.',
      confirmLabel: 'Stop new outbound calls',
      cancelLabel: 'Cancel',
      action: '/ai/pilot/stop',
      fields: html`<label class="field">
        <span>Reason</span>
        <input type="text" name="reason" required placeholder="Why outbound is being stopped">
      </label>`,
    }),
    user, currentPath: '/ai/pilot', counts, body,
  });
}

// ---------------------------------------------------------------- Call Review

export function renderCallListPage(input: {
  user: SessionUser; counts: NavCounts; calls: any[];
}): string {
  const { user, counts, calls } = input;
  const body = html`
    <div class="card">
      <div class="card-head">
        <h2>Voice calls</h2>
        <span class="muted small">Newest first. Reviewing a call never changes what was said on it.</span>
      </div>
      ${calls.length === 0
        ? emptyState({
            title: 'No calls recorded yet',
            explanation: 'Calls appear here once the Sales AI pilot has placed one, or the '
              + 'receptionist runtime has reported one.',
            action: { href: '/ai/pilot', label: 'Open the pilot' },
          })
        : html`<div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>When</th><th>Company</th><th>Direction</th><th>Profile</th>
                <th>Outcome</th><th>Length</th><th>QA</th><th>Review</th>
              </tr></thead>
              <tbody>
                ${calls.map((call: any) => html`<tr>
                  <td><a href="/calls/${call.voice_call_id}">${formatDateTime(call.started_at)}</a></td>
                  <td>${call.company_name ?? html`<span class="muted">Unknown</span>`}</td>
                  <td>${titleCase(call.direction)}</td>
                  <td class="muted small">${call.agent_profile_id}</td>
                  <td>${call.outcome
                    ? statusPill(titleCase(String(call.outcome).replace(/_/g, ' ')),
                        call.outcome === 'BOOKED' ? 'success'
                          : call.outcome === 'DNC' ? 'destructive' : 'neutral')
                    : html`<span class="muted">—</span>`}</td>
                  <td>${call.duration_seconds != null
                    ? `${Math.round(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s`
                    : html`<span class="muted">—</span>`}</td>
                  <td>${call.qa_score != null
                    ? html`${call.qa_score}${call.qa_hard_failure
                        ? html` ${statusPill('Hard fail', 'destructive')}` : ''}`
                    : html`<span class="muted">Not scored</span>`}</td>
                  <td>${call.reviewed_at
                    ? statusPill('Reviewed', 'success')
                    : statusPill('Needs review', 'review')}</td>
                </tr>`)}
              </tbody>
            </table>
          </div>`}
    </div>`;

  return renderPage({
    title: 'Call Review', subtitle: 'Quality and root cause for every voice call.',
    user, currentPath: '/calls', counts, body,
  });
}

export function renderCallReviewPage(input: {
  user: SessionUser; counts: NavCounts; call: any; turns: any[]; events: any[];
}): string {
  const { user, counts, call, turns, events } = input;

  const latency = call.latency_ms && typeof call.latency_ms === 'object'
    ? Object.entries(call.latency_ms as Record<string, unknown>) : [];

  const body = html`
    <div class="split-60-40">
      <div class="card">
        <div class="card-head">
          <h2>Transcript</h2>
          <span class="muted small">What was said. Never the model's internal reasoning.</span>
        </div>
        ${call.recording_url
          ? html`<audio controls preload="none" src="${call.recording_url}" style="width:100%"></audio>`
          : html`<p class="muted small">No recording is stored for this call.</p>`}
        ${turns.length === 0
          ? emptyState({ title: 'No transcript', explanation: 'This call has no stored turns.' })
          : html`<ol class="transcript">
              ${turns.map((turn: any) => html`<li class="turn turn-${String(turn.speaker).toLowerCase()}">
                <div class="turn-meta">
                  <span class="turn-speaker">${titleCase(turn.speaker)}</span>
                  ${turn.offset_ms != null
                    ? html`<span class="muted small">${(turn.offset_ms / 1000).toFixed(1)}s</span>` : ''}
                  ${turn.interrupted ? statusPill('Interrupted', 'warning') : ''}
                </div>
                <p>${turn.text}</p>
                ${turn.component_id
                  ? html`<span class="muted small">${turn.component_id}</span>` : ''}
              </li>`)}
            </ol>`}
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Call</h2></div>
          <dl class="detail-list">
            <dt>Account</dt>
            <dd>${call.account_id
              ? html`<a href="/accounts/${call.account_id}">${call.company_name}</a>`
              : html`<span class="muted">Not linked</span>`}</dd>
            <dt>Contact</dt>
            <dd>${call.contact_name ?? html`<span class="muted">Unknown</span>`}</dd>
            <dt>Agent profile</dt>
            <dd>${call.agent_profile_id}${call.prompt_version ? html` · ${call.prompt_version}` : ''}</dd>
            <dt>Mode at start</dt>
            <dd>${titleCase(String(call.mode_at_start).replace(/_/g, ' '))}</dd>
            <dt>Readiness decision</dt>
            <dd>${call.readiness_decision ?? html`<span class="muted">—</span>`}</dd>
            <dt>Disposition</dt>
            <dd>${call.disposition ?? html`<span class="muted">—</span>`}</dd>
          </dl>
        </div>

        <div class="card">
          <div class="card-head"><h2>State &amp; tools</h2></div>
          ${events.length === 0
            ? html`<p class="muted small">No events were recorded for this call.</p>`
            : timeline(events.map((event: any) => ({
                occurredAt: event.occurred_at,
                type: String(event.kind).toLowerCase(),
                actor: titleCase(String(event.kind).replace(/_/g, ' ')),
                summary: event.label,
              })))}
        </div>

        <div class="card">
          <div class="card-head">
            <h2>Latency</h2>
            <span class="muted small">Measured, not estimated</span>
          </div>
          ${latency.length === 0
            ? html`<p class="muted small">No latency was measured on this call.</p>`
            : html`<dl class="detail-list">
                ${latency.map(([key, value]) => html`
                  <dt>${titleCase(key.replace(/_/g, ' '))}</dt><dd>${String(value)}</dd>`)}
              </dl>`}
        </div>
      </div>
    </div>

    <div style="height:18px"></div>

    <div class="card">
      <div class="card-head">
        <h2>QA review</h2>
        <span class="muted small">A call is scored by a person, never by itself.</span>
      </div>
      <form method="post" action="/calls/${call.voice_call_id}/review" class="form-grid">
        <label class="field">
          <span>Score (0-100)</span>
          <input type="number" name="qaScore" min="0" max="100" value="${call.qa_score ?? ''}">
        </label>
        <label class="field">
          <span>Root cause</span>
          <select name="rootCause">
            <option value="">Not assigned</option>
            ${['research', 'contact_data', 'opener', 'dialogue', 'model', 'stt', 'tts', 'latency',
               'telephony', 'booking', 'policy', 'other'].map((cause) => html`
              <option value="${cause}" ${cause === call.root_cause ? 'selected' : ''}>
                ${titleCase(cause.replace(/_/g, ' '))}
              </option>`)}
          </select>
        </label>
        <label class="field">
          <span>Action</span>
          <select name="reviewAction">
            <option value="">Choose</option>
            ${['KEEP', 'RETEST', 'NEEDS_SCRIPT_CHANGE', 'RUNTIME_ISSUE'].map((action) => html`
              <option value="${action}" ${action === call.review_action ? 'selected' : ''}>
                ${titleCase(action.replace(/_/g, ' '))}
              </option>`)}
          </select>
        </label>
        <label class="field field-wide">
          <span>Hard failure</span>
          <label class="checkbox">
            <input type="checkbox" name="hardFailure" value="true" ${call.qa_hard_failure ? 'checked' : ''}>
            <span>Something happened on this call that must never happen again</span>
          </label>
        </label>
        <label class="field field-wide">
          <span>Reviewer notes</span>
          <textarea name="reviewerNotes" rows="3">${call.reviewer_notes ?? ''}</textarea>
        </label>
        <div class="field-wide">
          <button type="submit" class="btn btn-primary">Save review</button>
          ${call.reviewed_at ? html`<span class="muted small" style="margin-left:10px">
            Last reviewed ${relativeTime(call.reviewed_at)}${
              call.reviewed_by_name ? ` by ${call.reviewed_by_name}` : ''}
          </span>` : ''}
        </div>
      </form>
    </div>`;

  return renderPage({
    title: call.company_name ?? 'Call review',
    subtitle: `${titleCase(call.direction)} · ${formatDateTime(call.started_at)}`,
    ...(call.qa_hard_failure ? { status: statusPill('Hard failure', 'destructive') } : {}),
    breadcrumbs: [{ href: '/calls', label: 'Call Review' }, { href: '#', label: 'Call' }],
    user, currentPath: '/calls', counts, body,
  });
}

// ------------------------------------------------------------------ Campaigns

export function renderCampaignsPage(input: {
  user: SessionUser; counts: NavCounts; campaigns: any[]; conflicts: any[];
}): string {
  const { user, counts, campaigns, conflicts } = input;

  const body = html`
    ${conflicts.length > 0 ? html`
      <div class="card card-attention">
        <div class="card-head">
          <h2>Relationship state overrides campaign membership</h2>
          <span class="muted small">
            These accounts are in an active campaign but the relationship says they are not cold.
          </span>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Company</th><th>Relationship</th><th>Campaign</th><th>Enrollment</th></tr></thead>
            <tbody>
              ${conflicts.map((row: any) => html`<tr>
                <td><a href="/accounts/${row.account_id}">${row.company_name}</a></td>
                <td>${statusPill(titleCase(String(row.relationship_state).replace(/_/g, ' ')), 'warning')}</td>
                <td>${row.campaign_name}</td>
                <td class="muted small">${titleCase(String(row.enrollment_status).replace(/_/g, ' '))}</td>
              </tr>`)}
            </tbody>
          </table>
        </div>
      </div>
      <div style="height:18px"></div>` : ''}

    <div class="card">
      <div class="card-head">
        <h2>Campaigns</h2>
        <span class="muted small">Smartlead executes sending. The canonical record stays here.</span>
      </div>
      ${campaigns.length === 0
        ? emptyState({
            title: 'No campaigns yet',
            explanation: 'A campaign coordinates outreach across channels. It does not own the '
              + 'relationship: the Account does.',
          })
        : html`<div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>Campaign</th><th>Vertical</th><th>Channel</th><th>Status</th>
                <th>Accounts</th><th>Attempted</th><th>Replied</th><th>Paused</th><th>Suppressed</th>
              </tr></thead>
              <tbody>
                ${campaigns.map((row: any) => html`<tr>
                  <td>${row.name}
                    ${row.hook_family
                      ? html`<div class="muted small">${titleCase(String(row.hook_family).replace(/_/g, ' '))}</div>`
                      : ''}</td>
                  <td>${row.vertical_name ?? html`<span class="muted">All</span>`}</td>
                  <td class="muted small">Email · ${row.provider}</td>
                  <td>${statusPill(titleCase(row.status),
                        row.status === 'ACTIVE' ? 'success'
                          : row.status === 'PAUSED' ? 'warning' : 'neutral')}</td>
                  <td>${row.accounts}</td>
                  <td>${row.attempted}</td>
                  <td>${row.replied}</td>
                  <td>${row.paused}</td>
                  <td>${row.suppressed}</td>
                </tr>`)}
              </tbody>
            </table>
          </div>`}
    </div>`;

  return renderPage({
    title: 'Campaigns', subtitle: 'Coordinated outreach, with the Account as the source of truth.',
    user, currentPath: '/campaigns', counts, body,
  });
}

// ------------------------------------------------------------------ Analytics

const FUNNEL_STAGES: { key: string; label: string; denominator: string }[] = [
  { key: 'researched', label: 'Researched', denominator: 'Accounts created in range' },
  { key: 'contactable', label: 'Contactable', denominator: 'of researched, with a live endpoint' },
  { key: 'attempted', label: 'Attempted', denominator: 'of contactable, with a logged attempt' },
  { key: 'connected', label: 'Connected', denominator: 'of attempted, reaching a person' },
  { key: 'qualified', label: 'Qualified', denominator: 'of connected, with an opportunity' },
  { key: 'booked', label: 'Booked', denominator: 'of qualified, provider-confirmed' },
  { key: 'attended', label: 'Attended', denominator: 'of booked, marked attended' },
];

export function renderAnalyticsPage(input: {
  user: SessionUser; counts: NavCounts; funnel: any; breakdowns: Record<string, any[]>;
  filters: { fromDate: string | null; toDate: string | null };
}): string {
  const { user, counts, funnel, breakdowns, filters } = input;
  const researched = Number(funnel?.researched ?? 0);

  const body = html`
    <div class="card">
      <form method="get" action="/analytics" class="row" style="gap:12px;flex-wrap:wrap">
        <label class="field">
          <span>From</span>
          <input type="date" name="from" value="${filters.fromDate ?? ''}">
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" name="to" value="${filters.toDate ?? ''}">
        </label>
        <div class="field" style="justify-content:flex-end">
          <button type="submit" class="btn btn-primary">Apply</button>
        </div>
      </form>
    </div>

    <div style="height:18px"></div>

    <div class="grid grid-kpi">
      ${kpiCard({ label: 'Researched accounts', value: researched })}
      ${kpiCard({ label: 'Decision-makers reached', value: Number(funnel?.connected ?? 0) })}
      ${kpiCard({ label: 'Meetings booked', value: Number(funnel?.booked ?? 0),
                  sub: 'provider-confirmed only' })}
      ${kpiCard({ label: 'Attended', value: Number(funnel?.attended ?? 0),
                  sub: 'booked is not attended' })}
      ${kpiCard({ label: 'Suppressed / DNC', value: Number(funnel?.suppressed ?? 0),
                  tone: Number(funnel?.suppressed ?? 0) > 0 ? 'attention' : 'default',
                  sub: 'never hidden' })}
    </div>

    <div style="height:18px"></div>

    <div class="card">
      <div class="card-head">
        <h2>Funnel</h2>
        <span class="muted small">Every stage states what it counts.</span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Stage</th><th>Count</th><th>Share of researched</th><th>Denominator</th></tr></thead>
          <tbody>
            ${FUNNEL_STAGES.map((stage) => {
              const value = Number(funnel?.[stage.key] ?? 0);
              const share = researched > 0 ? `${((value / researched) * 100).toFixed(1)}%` : '—';
              return html`<tr>
                <td>${stage.label}</td>
                <td>${value}</td>
                <td>${share}</td>
                <td class="muted small">${stage.denominator}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </div>

    <div style="height:18px"></div>

    <div class="grid grid-two">
      ${Object.entries(breakdowns).map(([dimension, rows]) => html`
        <div class="card">
          <div class="card-head"><h2>By ${titleCase(dimension)}</h2></div>
          ${rows.length === 0
            ? html`<p class="muted small">Nothing recorded for this breakdown yet.</p>`
            : html`<div>
                ${rows.map((row: any) => {
                  const max = Math.max(...rows.map((other: any) => Number(other.accounts)));
                  const width = max > 0 ? Math.round((Number(row.accounts) / max) * 100) : 0;
                  return html`<div class="metric-bar">
                    <div class="metric-bar-head">
                      <span>${row.label}</span><span class="muted">${row.accounts}</span>
                    </div>
                    <div class="metric-bar-track">
                      <div class="metric-bar-fill fill-info" style="width:${width}%"></div>
                    </div>
                  </div>`;
                })}
              </div>`}
        </div>`)}
    </div>`;

  return renderPage({
    title: 'Analytics',
    subtitle: 'Booked and attended are separate numbers, and negative outcomes are shown.',
    user, currentPath: '/analytics', counts, body,
  });
}

// ------------------------------------------------------------------- Settings

export function renderSettingsPage(input: {
  user: SessionUser; counts: NavCounts; integrations: IntegrationView[];
  pilot: PilotState; canEdit: boolean; flash?: string | null; error?: string | null;
}): string {
  const { user, counts, integrations, pilot, canEdit } = input;

  const statusFor = (row: IntegrationView) => {
    if (!row.secretEnvVar) return statusPill('No credential needed', 'neutral');
    if (!row.secretPresent) return statusPill('Credential not set', 'review');
    if (row.lastCheckStatus === 'OK') return statusPill('Connected', 'success');
    if (row.lastCheckStatus === 'FAILED') return statusPill('Failing', 'destructive');
    if (row.lastCheckStatus === 'DEGRADED') return statusPill('Degraded', 'warning');
    return statusPill('Not tested', 'neutral');
  };

  const body = html`
    ${input.flash ? html`<div class="coverage-note info" role="status" style="margin-bottom:16px">${input.flash}</div>` : ''}
    ${input.error ? html`<div class="coverage-note warn" role="alert" style="margin-bottom:16px">${input.error}</div>` : ''}

    <div class="card">
      <div class="card-head">
        <h2>Integrations</h2>
        <span class="muted small">
          Credentials live in the server environment. This page can show that one is set; it
          cannot show what it is.
        </span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Integration</th><th>Status</th><th>Credential</th><th>Configuration</th>
            <th>Last checked</th><th>Enabled</th>
          </tr></thead>
          <tbody>
            ${integrations.map((row) => html`<tr>
              <td>${row.displayName}</td>
              <td>${statusFor(row)}
                ${row.lastCheckDetail
                  ? html`<div class="muted small">${row.lastCheckDetail}</div>` : ''}</td>
              <td class="muted small">${row.secretEnvVar
                ? html`${row.secretEnvVar}<br>${row.secretPresent ? 'set on this server' : 'not set'}`
                : '—'}</td>
              <td class="muted small">${Object.keys(row.config).length === 0
                ? 'None'
                : Object.entries(row.config).map(([key, value]) => html`
                    ${key}: ${String(value)}<br>`)}</td>
              <td class="muted small">${row.lastCheckAt ? relativeTime(row.lastCheckAt) : 'Never'}</td>
              <td>
                ${canEdit
                  ? html`<form method="post" action="/settings/integration" class="row" style="gap:6px">
                      <input type="hidden" name="key" value="${row.key}">
                      <input type="hidden" name="enabled" value="${row.enabled ? 'false' : 'true'}">
                      <input type="text" name="reason" placeholder="Reason" required
                             aria-label="Reason for changing ${row.displayName}" class="input-inline">
                      <button type="submit" class="btn btn-secondary btn-sm">
                        ${row.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </form>`
                  : statusPill(row.enabled ? 'Enabled' : 'Disabled',
                      row.enabled ? 'success' : 'neutral')}
              </td>
            </tr>`)}
          </tbody>
        </table>
      </div>
    </div>

    <div style="height:18px"></div>

    <div class="card">
      <div class="card-head">
        <h2>Voice runtimes</h2>
        <span class="muted small">Inbound and outbound are separate services and separate switches.</span>
      </div>
      <dl class="detail-list">
        <dt>Inbound receptionist</dt>
        <dd>${statusPill(pilot.inboundReceptionist ? 'On' : 'Off',
              pilot.inboundReceptionist ? 'success' : 'neutral')}</dd>
        <dt>Outbound Sales AI</dt>
        <dd>${statusPill(titleCase(pilot.outboundMode.replace(/_/g, ' ')),
              MODE_STATE[pilot.outboundMode] ?? 'neutral')}</dd>
        <dt>Outbound dial creation</dt>
        <dd>${statusPill(pilot.outboundDialEnabled ? 'On' : 'Off',
              pilot.outboundDialEnabled ? 'success' : 'neutral')}</dd>
        <dt>Auto-book strategy calls</dt>
        <dd>${statusPill(pilot.autoBookEnabled ? 'On' : 'Off',
              pilot.autoBookEnabled ? 'success' : 'neutral')}</dd>
      </dl>
      <p class="muted small">
        Change these on the <a href="/ai/pilot">Sales AI Pilot</a> page, where each change is
        recorded with a reason.
      </p>
    </div>`;

  return renderPage({
    title: 'Settings',
    subtitle: canEdit
      ? 'Organisation, integrations and operating modes.'
      : 'Integration health. Changing these requires an administrator.',
    user, currentPath: '/settings', counts, body,
  });
}

// -------------------------------------------------------------- global search

export function renderSearchPage(input: {
  user: SessionUser; counts: NavCounts; term: string; hits: SearchHit[];
}): string {
  const { user, counts, term, hits } = input;

  const body = html`
    <div class="card">
      <form method="get" action="/search" class="row" style="gap:10px">
        <label class="field" style="flex:1">
          <span class="sr-only">Search</span>
          <input type="search" name="q" value="${term}" autofocus
                 placeholder="Company, person, phone, email, city or website">
        </label>
        <div class="field" style="justify-content:flex-end">
          <button type="submit" class="btn btn-primary">Search</button>
        </div>
      </form>
    </div>

    <div style="height:18px"></div>

    <div class="card">
      <div class="card-head">
        <h2>${hits.length === 0 ? 'Results' : `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`}</h2>
        <span class="muted small">Every result opens the same canonical account record.</span>
      </div>
      ${term.trim().length < 2
        ? emptyState({
            title: 'Search the whole book',
            explanation: 'A company, a person, a phone number, an email address, a city or a website.',
          })
        : hits.length === 0
          ? emptyState({
              title: `Nothing matches “${term}”`,
              explanation: 'Nothing in the researched inventory matches that. Searching does not '
                + 'create a record, so a company that has not been researched will not appear here.',
              action: { href: '/find', label: 'Find prospects' },
            })
          : html`<div class="table-wrap">
              <table class="data">
                <thead><tr>
                  <th>Company</th><th>Matched</th><th>Location</th><th>Owner</th><th>Status</th>
                </tr></thead>
                <tbody>
                  ${hits.map((hit) => html`<tr>
                    <td><a href="/accounts/${hit.accountId}">${hit.companyName}</a></td>
                    <td class="muted small">${hit.matchedOn}: ${hit.matchedValue}</td>
                    <td>${hit.city
                      ? html`${hit.city}${hit.state ? `, ${hit.state}` : ''}`
                      : html`<span class="muted">—</span>`}</td>
                    <td>${hit.ownerName ?? html`<span class="muted">Unclaimed</span>`}</td>
                    <td>${hit.isSuppressed
                      ? statusPill('Suppressed', 'blocked', 'This company must not be contacted.')
                      : statusPill('Available', 'neutral')}</td>
                  </tr>`)}
                </tbody>
              </table>
            </div>`}
    </div>`;

  return renderPage({
    title: 'Search',
    subtitle: term.trim() ? `Results for “${term}”` : 'Company, person, phone, email, city or website.',
    user, currentPath: '/search', counts, body,
  });
}
