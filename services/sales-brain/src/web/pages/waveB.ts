import { html, raw, type RawHtml } from '../html.js';
import { renderPage } from '../layout.js';
import type { NavCounts } from '../components/shell.js';
import {
  adEvidenceRow, channelStatusBadge, confirmDialog, contactRouteBadge, decisionToStatus,
  emptyState, evidenceFact, hypothesisCard, kpiCard, routeTypeFor, statusPill, tierBadge,
  timeline,
} from '../components/primitives.js';
import { formatDateTime, pluralize, relativeTime, titleCase } from '../format.js';
import type { SessionUser } from '../../domain/auth.js';
import { isManager } from '../../domain/auth.js';
import { STAGES, STAGE_LABEL, allowedTransitions, type OpportunityRow, type Stage } from '../../domain/opportunities.js';
import type { MeetingRow, ReplyRow } from '../../api/readModels.js';

/**
 * Wave B pages: Market Detail, Replies, Opportunities, Opportunity Detail, Meetings.
 * Authority: YAD-SALES-CRM-UI-MOCKUPS-CURRENT.md §9, §13-§16.
 *
 * Every page is composed from the shared primitives rather than its own markup.
 */

// ------------------------------------------------------------ Market Detail

export function renderMarketDetailPage(input: {
  user: SessionUser; counts: NavCounts; market: any; rows: any[]; jobs: any[]; canManage: boolean;
}): string {
  const { user, counts, market, rows, jobs, canManage } = input;
  const coverage = market.researched > 0 && market.fresh === market.researched ? 'Fresh'
    : market.researched === 0 ? 'Not yet mined'
    : market.fresh === 0 ? 'Stale' : 'Partial';

  const body = html`
    <div class="grid grid-kpi">
      ${kpiCard({ label: 'Researched', value: market.researched, sub: `${market.fresh} still fresh` })}
      ${kpiCard({ label: 'Unclaimed', value: market.unclaimed, sub: 'available to work',
                  tone: market.unclaimed > 0 ? 'good' : 'default',
                  href: `/find?market=${market.market_id}` })}
      ${kpiCard({ label: 'Named decision makers', value: market.named_dm,
                  sub: `${market.phone_email} with phone + email` })}
      ${kpiCard({ label: 'Advertisers', value: market.advertisers, sub: 'current ad evidence' })}
    </div>

    <div style="height:18px"></div>

    <div class="grid grid-two">
      <div class="card">
        <div class="card-head"><h2>Market intelligence</h2>${statusPill(coverage,
          coverage === 'Fresh' ? 'success' : coverage === 'Stale' ? 'stale' : 'warning')}</div>
        <div class="card-pad">
          <dl class="detail-list">
            <div><dt>Geography</dt><dd>${market.geography_type} · ${
              JSON.stringify(market.geography_definition ?? {}).replace(/[{}"]/g, ' ').trim() || '—'}</dd></div>
            <div><dt>Vertical</dt><dd>${market.vertical_display ?? 'All industries'}</dd></div>
            <div><dt>Mining mode</dt><dd>${titleCase(market.mining_mode)}</dd></div>
            <div><dt>Tier A / B</dt><dd>${market.tier_a} / ${market.tier_b}</dd></div>
            <div><dt>Last researched</dt><dd>${market.last_researched
              ? relativeTime(market.last_researched) : 'never'}</dd></div>
            <div><dt>Target depth</dt><dd>${market.target_inventory_depth ?? 'not set'}</dd></div>
          </dl>
          <p class="micro muted" style="margin-top:12px">
            Coverage describes what has been researched, not what exists. This market is not
            claimed to be complete.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Research activity</h2>
          ${canManage ? html`<button class="btn btn-secondary btn-sm js-research-more" type="button">Research more</button>` : ''}
        </div>
        ${jobs.length === 0
          ? html`<div class="card-pad muted small">No research jobs have run for this market yet.</div>`
          : html`<ul class="timeline-list" style="padding:8px 20px 14px">
              ${jobs.map((job: any) => html`<li class="timeline-item">
                <span class="timeline-icon" aria-hidden="true">❖</span>
                <div class="timeline-body">
                  <div class="timeline-head">
                    <strong>${titleCase(job.job_type)}</strong>
                    <span class="timeline-time">${relativeTime(job.created_at)}</span>
                  </div>
                  <div class="row" style="gap:6px;margin-top:4px">
                    ${statusPill(job.status,
                      job.status === 'SUCCEEDED' ? 'success'
                      : job.status === 'FAILED' ? 'destructive'
                      : job.status === 'RUNNING' ? 'info' : 'neutral')}
                    ${job.attempts > 1 ? statusPill(`${job.attempts} attempts`, 'warning') : ''}
                  </div>
                  ${job.last_error ? html`<div class="micro muted" style="margin-top:4px">${job.last_error}</div>` : ''}
                </div>
              </li>`)}
            </ul>`}
      </div>
    </div>

    <div style="height:18px"></div>

    <div class="card">
      <div class="card-head">
        <h2>${pluralize(rows.length, 'prospect')} in this market</h2>
        <a class="btn btn-secondary btn-sm" href="/find?market=${market.market_id}">Search and claim</a>
      </div>
      ${rows.length === 0
        ? emptyState({
            title: 'Nothing researched here yet',
            explanation: 'Market Miner has not produced inventory for this market.',
            action: canManage ? { href: `/mining`, label: 'Open Mining' } : null,
          })
        : prospectRows(rows, user.userId)}
    </div>`;

  return renderPage({
    title: market.name,
    subtitle: `${market.vertical_display ?? 'All industries'} · ${titleCase(market.mining_mode)}`,
    status: statusPill(titleCase(market.status), market.status === 'ACTIVE' ? 'success' : 'warning'),
    breadcrumbs: [{ href: '/markets', label: 'Markets' }, { href: '#', label: market.name }],
    user, currentPath: '/markets', counts, body,
    actions: html`<a class="btn btn-primary" href="/find?market=${market.market_id}">Browse prospects</a>`,
  });
}

/** Compact row list reused by Market Detail. */
function prospectRows(rows: any[], viewerId: string): RawHtml {
  return html`<div class="table-wrap">
    <table class="data">
      <thead><tr>
        <th>Company</th><th>Fit</th><th>Advertising</th><th>Contact route</th>
        <th>Researched</th><th>Owner</th><th></th>
      </tr></thead>
      <tbody>
        ${rows.map((row) => html`<tr data-account="${row.account_id}">
          <td class="cell-company"><a href="/accounts/${row.account_id}">${row.company_name}</a>
            <div class="micro muted">${row.geography_summary}</div></td>
          <td>${tierBadge(row.manual_tier, row.manual_score)}</td>
          <td>${adEvidenceRow(row)}</td>
          <td>${contactRouteBadge({
            routeType: routeTypeFor({
              endpointRole: row.has_direct_phone ? 'DIRECT_BUSINESS_LINE' : 'MAIN_BUSINESS_LINE',
              relationshipToPerson: row.has_direct_phone ? 'DIRECT_CONFIRMED' : 'COMPANY_ROUTE',
              hasNamedPerson: Boolean(row.best_contact_name),
              isRoleOnly: Boolean(row.best_contact_is_role_only),
            }),
          })}</td>
          <td>${row.last_researched_at
            ? html`<span class="muted micro">${relativeTime(row.last_researched_at)}</span>`
            : statusPill('not researched', 'stale')}</td>
          <td>${row.current_owner_user_id
            ? (row.current_owner_user_id === viewerId
                ? statusPill('You', 'info')
                : html`<span class="muted small">${row.owner_display_name}</span>`)
            : html`<span class="muted small">Unclaimed</span>`}</td>
          <td><a class="btn btn-secondary btn-sm" href="/accounts/${row.account_id}">Open</a></td>
        </tr>`)}
      </tbody>
    </table>
  </div>`;
}

// ------------------------------------------------------------------- Replies

const REPLY_TABS: { key: string; label: string }[] = [
  { key: 'needs_response', label: 'Needs response' },
  { key: 'positive', label: 'Positive' },
  { key: 'neutral', label: 'Neutral' },
  { key: 'negative', label: 'Negative' },
  { key: 'unsubscribe', label: 'Unsubscribe' },
];

const REPLY_CLASS_TONE: Record<string, Parameters<typeof statusPill>[1]> = {
  POSITIVE_INTEREST: 'success', QUESTION: 'info', SEND_INFO: 'info',
  CORRECT_PERSON_REFERRAL: 'warning', TIMING_LATER: 'neutral', ALREADY_SOLVED: 'neutral',
  NOT_INTERESTED: 'destructive', UNSUBSCRIBE_OPT_OUT: 'destructive',
  WRONG_PERSON: 'warning', WRONG_COMPANY: 'warning', OUT_OF_OFFICE: 'neutral',
  BOUNCE: 'destructive', OTHER_REVIEW: 'review',
};

export function renderRepliesPage(input: {
  user: SessionUser; counts: NavCounts; replies: ReplyRow[]; activeTab: string;
}): string {
  const { user, counts, replies, activeTab } = input;

  const body = html`
    <div class="chips" style="margin-bottom:16px">
      ${REPLY_TABS.map((tab) => html`
        <a class="chip" href="/replies?tab=${tab.key}"
           aria-pressed="${activeTab === tab.key ? 'true' : 'false'}">${tab.label}</a>`)}
    </div>

    ${replies.length === 0
      ? emptyState({
          title: activeTab === 'needs_response' ? 'Nothing waiting on you' : 'No replies here',
          explanation: activeTab === 'needs_response'
            ? 'Replies that need a person appear here. Everything current has been handled.'
            : 'No replies match this filter yet.',
          action: { href: '/prospects', label: 'My Prospects' },
        })
      : html`<div class="stack">
          ${replies.map((reply) => html`
          <article class="card reply-card">
            <div class="card-pad">
              <div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">
                <div style="min-width:0">
                  <h3 style="margin-bottom:2px">
                    <a href="/accounts/${reply.account_id}">${reply.company_name}</a>
                  </h3>
                  <div class="muted small">
                    ${reply.contact_name ?? 'Unknown contact'}${reply.geography ? ` · ${reply.geography}` : ''}
                    · ${relativeTime(reply.occurred_at)}
                  </div>
                </div>
                <div class="row" style="gap:6px">
                  ${reply.reply_class
                    ? statusPill(titleCase(reply.reply_class), REPLY_CLASS_TONE[reply.reply_class] ?? 'neutral')
                    : ''}
                  ${reply.is_suppressed ? statusPill('Suppressed', 'destructive') : ''}
                </div>
              </div>

              ${reply.reply_excerpt ? html`
                <blockquote class="reply-excerpt">${reply.reply_excerpt}</blockquote>` : ''}

              <div class="row micro muted" style="gap:12px;margin-top:10px">
                ${reply.campaign_name ? html`<span>Campaign: ${reply.campaign_name}</span>` : ''}
                ${reply.owner_name ? html`<span>Owner: ${reply.owner_name}</span>` : ''}
                ${reply.has_open_task ? statusPill('Task open', 'info') : ''}
              </div>

              <div class="row" style="gap:8px;margin-top:14px">
                <a class="btn btn-secondary btn-sm" href="/accounts/${reply.account_id}">Open account</a>
                ${reply.reply_class === 'UNSUBSCRIBE_OPT_OUT' || reply.is_suppressed ? '' : html`
                  <a class="btn btn-primary btn-sm" href="/accounts/${reply.account_id}#booking">Book a call</a>`}
              </div>
              ${reply.reply_class === 'UNSUBSCRIBE_OPT_OUT' ? html`
                <p class="micro" style="color:var(--crimson);margin:10px 0 0">
                  They opted out of email. Do not re-add them to a sequence.
                </p>` : ''}
            </div>
          </article>`)}
        </div>`}`;

  return renderPage({
    title: 'Replies',
    subtitle: 'Inbound responses, attached to the same Account memory as calls and meetings.',
    user, currentPath: '/replies', counts, body,
  });
}

// ------------------------------------------------------------- Opportunities

export function renderOpportunitiesPage(input: {
  user: SessionUser; counts: NavCounts; opportunities: OpportunityRow[];
  view: 'pipeline' | 'table'; stageFilter: Stage | null;
}): string {
  const { user, counts, opportunities, view } = input;

  const byStage = new Map<Stage, OpportunityRow[]>();
  for (const stage of STAGES) byStage.set(stage, []);
  for (const opportunity of opportunities) {
    if (!byStage.has(opportunity.stage)) byStage.set(opportunity.stage, []);
    byStage.get(opportunity.stage)!.push(opportunity);
  }

  const card = (opportunity: OpportunityRow): RawHtml => html`
    <a class="opp-card" href="/opportunities/${opportunity.opportunity_id}">
      <div class="opp-company">${opportunity.company_name}</div>
      <p class="opp-problem">${opportunity.problem_summary}</p>
      <div class="row micro muted" style="gap:8px">
        ${opportunity.owner_name ? html`<span>${opportunity.owner_name}</span>` : ''}
        ${opportunity.meeting_status === 'CONFIRMED' && opportunity.meeting_start
          ? statusPill(`Meeting ${relativeTime(opportunity.meeting_start)}`, 'success')
          : ''}
      </div>
      ${opportunity.next_step ? html`<div class="opp-next">Next: ${opportunity.next_step}</div>` : ''}
      ${opportunity.value_amount
        ? html`<div class="opp-value">${Number(opportunity.value_amount).toLocaleString('en-US',
            { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
            <span class="micro muted">${opportunity.value_basis}</span></div>`
        : ''}
    </a>`;

  const body = opportunities.length === 0
    ? emptyState({
        title: 'No qualified opportunities yet',
        explanation: 'An opportunity needs a problem the prospect actually described. '
          + 'A polite call is not an opportunity.',
        action: { href: '/prospects', label: 'My Prospects' },
      })
    : view === 'pipeline'
      ? html`<div class="pipeline">
          ${STAGES.map((stage) => html`
            <section class="pipeline-column">
              <header>
                <h3>${STAGE_LABEL[stage]}</h3>
                <span class="pill pill-neutral">${byStage.get(stage)!.length}</span>
              </header>
              <div class="pipeline-cards">
                ${byStage.get(stage)!.length === 0
                  ? html`<p class="muted micro" style="padding:10px 2px">Nothing here.</p>`
                  : byStage.get(stage)!.map(card)}
              </div>
            </section>`)}
        </div>`
      : html`<div class="card"><div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Company</th><th>Stage</th><th>Problem</th><th>Owner</th>
              <th>Meeting</th><th>Next step</th><th></th>
            </tr></thead>
            <tbody>
              ${opportunities.map((opportunity) => html`<tr>
                <td class="cell-company">${opportunity.company_name}</td>
                <td>${statusPill(STAGE_LABEL[opportunity.stage],
                  opportunity.stage === 'CLOSED_WON' ? 'success'
                  : opportunity.stage === 'CLOSED_LOST' ? 'destructive' : 'info')}</td>
                <td class="cell-why" title="${opportunity.problem_summary}">${opportunity.problem_summary}</td>
                <td class="muted small">${opportunity.owner_name ?? '—'}</td>
                <td>${opportunity.meeting_status === 'CONFIRMED'
                  ? statusPill('Booked', 'success') : html`<span class="muted micro">—</span>`}</td>
                <td class="muted small">${opportunity.next_step ?? '—'}</td>
                <td><a class="btn btn-secondary btn-sm"
                       href="/opportunities/${opportunity.opportunity_id}">Open</a></td>
              </tr>`)}
            </tbody>
          </table>
        </div></div>`;

  return renderPage({
    title: 'Opportunities',
    subtitle: 'Qualified pipeline. Cold prospects do not appear here until a real problem is stated.',
    user, currentPath: '/opportunities', counts, body,
    actions: html`
      <a class="btn ${view === 'pipeline' ? 'btn-primary' : 'btn-secondary'}" href="/opportunities?view=pipeline">Pipeline</a>
      <a class="btn ${view === 'table' ? 'btn-primary' : 'btn-secondary'}" href="/opportunities?view=table">Table</a>`,
  });
}

// -------------------------------------------------------- Opportunity Detail

export function renderOpportunityDetailPage(input: {
  user: SessionUser; counts: NavCounts; opportunity: any; stageEvents: any[];
  timeline: any[]; canEdit: boolean;
}): string {
  const { user, counts, opportunity, stageEvents, canEdit } = input;
  const stage = opportunity.stage as Stage;
  const transitions = allowedTransitions(stage);
  const inputs: any[] = Array.isArray(opportunity.business_case_inputs)
    ? opportunity.business_case_inputs : [];
  const statements: any[] = opportunity.prospect_statements ?? [];

  const body = html`
    <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr);align-items:start">
      <div class="stack">
        <div class="card card-pad">
          <div class="section">
            <h3>Problem and desired outcome</h3>
            <p class="lead">${opportunity.problem_summary}</p>
            ${opportunity.desired_outcome
              ? html`<p class="muted">${opportunity.desired_outcome}</p>`
              : html`<p class="muted small">No desired outcome recorded yet.</p>`}
          </div>

          <div class="section">
            <h3>What they actually said</h3>
            ${statements.length === 0
              ? html`<p class="muted small">Nothing captured verbatim yet. Record their words, not a paraphrase.</p>`
              : html`<ul class="evidence-list">
                  ${statements.map((statement: any) => evidenceFact({
                    statement: `“${statement.statement_text}”`,
                    factClass: statement.source_class === 'prospect_verified' ? 'confirmed' : 'likely',
                    source: statement.source_class, observedAt: statement.captured_at,
                  }))}
                </ul>`}
          </div>

          <div class="section">
            <h3>Confirmed workflow</h3>
            ${opportunity.confirmed_workflow
              ? html`<p>${opportunity.confirmed_workflow}</p>`
              : html`<p class="muted small">Not yet mapped.</p>`}
          </div>

          <div class="section">
            <h3>Business-case inputs</h3>
            ${inputs.length === 0
              ? html`<p class="muted small">No numbers captured. Only use figures the prospect supplied.</p>`
              : html`<ul class="evidence-list">
                  ${inputs.map((entry: any) => evidenceFact({
                    statement: `${entry.label}: ${entry.value}`,
                    // A prospect-supplied number and an illustrative assumption must
                    // never look the same on this page.
                    factClass: entry.source === 'prospect' ? 'confirmed' : 'hypothesis',
                    source: entry.source === 'prospect' ? 'they told us' : 'illustrative assumption',
                  }))}
                </ul>`}
          </div>

          <div class="section">
            <h3>Still unknown</h3>
            ${(opportunity.unknowns ?? []).length === 0
              ? html`<p class="muted small">Nothing recorded as outstanding.</p>`
              : html`<ul class="plain-list">${(opportunity.unknowns ?? []).map((item: string) =>
                  html`<li>${item}</li>`)}</ul>`}
          </div>

          <div class="section">
            <h3>Activity</h3>
            ${timeline(input.timeline.slice(0, 20).map((entry: any) => ({
              occurredAt: entry.occurred_at, actor: entry.actor_name, channel: entry.channel,
              type: entry.activity_type, summary: entry.notes ?? '', outcome: entry.disposition,
            })))}
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Stage</h2>${statusPill(STAGE_LABEL[stage],
            stage === 'CLOSED_WON' ? 'success' : stage === 'CLOSED_LOST' ? 'destructive' : 'info')}</div>
          <div class="card-pad">
            ${!canEdit
              ? html`<p class="muted small" style="margin:0">
                  ${opportunity.owner_name} owns this opportunity.</p>`
              : transitions.length === 0
                ? html`<p class="muted small" style="margin:0">This opportunity is closed.</p>`
                : html`<form method="post" action="/opportunities/${opportunity.opportunity_id}/transition">
                    <div class="field" style="margin-bottom:10px">
                      <label for="targetStage">Move to</label>
                      <select id="targetStage" name="targetStage" required>
                        ${transitions.map((target) => html`
                          <option value="${target}">${STAGE_LABEL[target]}</option>`)}
                      </select>
                    </div>
                    <div class="field" style="margin-bottom:10px">
                      <label for="reason">Why</label>
                      <input id="reason" name="reason" type="text" required
                             placeholder="What changed to justify this?">
                    </div>
                    <div class="field" style="margin-bottom:12px">
                      <label for="closeReason">Close reason (required to close)</label>
                      <input id="closeReason" name="closeReason" type="text">
                    </div>
                    <button class="btn btn-primary btn-sm" type="submit">Change stage</button>
                    <p class="micro muted" style="margin:10px 0 0">
                      Stage changes are audited and cannot skip a step.
                    </p>
                  </form>`}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Next action</h2></div>
          <div class="card-pad">
            <p style="margin:0 0 6px">${opportunity.next_step ?? 'Not set.'}</p>
            ${opportunity.next_step_at
              ? html`<div class="muted small">${formatDateTime(opportunity.next_step_at)}</div>` : ''}
            <div class="row" style="gap:8px;margin-top:12px">
              <a class="btn btn-secondary btn-sm" href="/accounts/${opportunity.account_id}">Open account</a>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Stage history</h2></div>
          <div class="card-pad">
            ${stageEvents.length === 0
              ? html`<p class="muted small" style="margin:0">No transitions recorded.</p>`
              : html`<ul class="timeline-list">
                  ${stageEvents.map((event: any) => html`<li class="timeline-item">
                    <span class="timeline-icon" aria-hidden="true">◈</span>
                    <div class="timeline-body">
                      <div class="timeline-head">
                        <strong>${event.from_stage
                          ? `${STAGE_LABEL[event.from_stage as Stage]} → ${STAGE_LABEL[event.to_stage as Stage]}`
                          : STAGE_LABEL[event.to_stage as Stage]}</strong>
                        <span class="timeline-time">${relativeTime(event.occurred_at)}</span>
                      </div>
                      <div class="timeline-summary">${event.reason}</div>
                      <div class="micro muted">${event.actor_name ?? 'system'}</div>
                    </div>
                  </li>`)}
                </ul>`}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2>Source</h2></div>
          <div class="card-pad micro muted">
            <div>Channel: ${titleCase(opportunity.source_channel ?? 'unknown')}</div>
            <div>Opened ${relativeTime(opportunity.created_at)}</div>
          </div>
        </div>
      </div>
    </div>`;

  return renderPage({
    title: opportunity.company_name,
    subtitle: opportunity.title,
    status: statusPill(STAGE_LABEL[stage], stage === 'CLOSED_WON' ? 'success' : 'info'),
    breadcrumbs: [
      { href: '/opportunities', label: 'Opportunities' },
      { href: '#', label: opportunity.company_name },
    ],
    user, currentPath: '/opportunities', counts, body,
    actions: html`<a class="btn btn-secondary" href="/accounts/${opportunity.account_id}">Open Account</a>`,
  });
}

// ------------------------------------------------------------------ Meetings

const MEETING_TABS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'today', label: 'Today' },
  { key: 'completed', label: 'Completed' },
  { key: 'needs_attention', label: 'No-show / needs reschedule' },
];

export function renderMeetingsPage(input: {
  user: SessionUser; counts: NavCounts; meetings: MeetingRow[]; activeTab: string;
}): string {
  const { user, counts, meetings, activeTab } = input;

  const body = html`
    <div class="chips" style="margin-bottom:16px">
      ${MEETING_TABS.map((tab) => html`
        <a class="chip" href="/meetings?tab=${tab.key}"
           aria-pressed="${activeTab === tab.key ? 'true' : 'false'}">${tab.label}</a>`)}
    </div>

    ${meetings.length === 0
      ? emptyState({
          title: activeTab === 'upcoming' ? 'No meetings booked' : 'Nothing here',
          explanation: activeTab === 'upcoming'
            ? 'Confirmed strategy calls appear here once the calendar provider confirms them.'
            : 'No meetings match this filter.',
          action: { href: '/prospects', label: 'My Prospects' },
        })
      : html`<div class="stack">
          ${meetings.map((meeting) => html`
          <article class="card meeting-card">
            <div class="card-pad">
              <div class="row" style="justify-content:space-between;align-items:flex-start;gap:14px">
                <div style="min-width:0">
                  <div class="meeting-time">${formatDateTime(meeting.requested_start,
                    meeting.prospect_timezone ?? 'America/New_York')}
                    <span class="micro muted">${meeting.prospect_timezone ?? 'America/New_York'}</span>
                  </div>
                  <h3 style="margin:4px 0 2px">
                    <a href="/accounts/${meeting.account_id}">${meeting.company_name}</a>
                  </h3>
                  <div class="muted small">
                    ${meeting.attendee_name ?? meeting.contact_name ?? 'Attendee unknown'}
                    ${meeting.contact_title ? ` · ${meeting.contact_title}` : ''}
                    · hosted by ${meeting.calendar_upn}
                  </div>
                </div>
                <div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">
                  ${meetingStatusPill(meeting)}
                  ${meeting.has_prep_brief
                    ? statusPill('Brief ready', 'success')
                    : statusPill('No brief', 'warning')}
                </div>
              </div>

              <div class="row" style="gap:8px;margin-top:14px">
                ${meeting.status === 'CONFIRMED' && meeting.provider_web_link
                  ? html`<a class="btn btn-primary btn-sm" href="${meeting.provider_web_link}"
                            target="_blank" rel="noreferrer noopener">Join ${
                              meeting.meeting_location_type === 'cal_video' ? 'Cal Video' : 'meeting'}</a>`
                  : ''}
                <a class="btn btn-secondary btn-sm" href="/meetings/${meeting.booking_id}">Prep brief</a>
                <a class="btn btn-ghost btn-sm" href="/accounts/${meeting.account_id}">Account</a>
              </div>
            </div>
          </article>`)}
        </div>`}`;

  return renderPage({
    title: 'Meetings',
    subtitle: 'Strategy calls. A meeting appears as confirmed only after the calendar confirms it.',
    user, currentPath: '/meetings', counts, body,
  });
}

function meetingStatusPill(meeting: MeetingRow): RawHtml {
  if (meeting.attended_state === 'NO_SHOW') return statusPill('No-show', 'destructive');
  if (meeting.status === 'CANCELLED') return statusPill('Cancelled', 'destructive');
  if (meeting.status === 'FAILED') return statusPill('Never confirmed', 'destructive');
  if (meeting.status === 'COMPLETED' || meeting.attended_state === 'ATTENDED') {
    return statusPill('Completed', 'success');
  }
  if (meeting.status === 'PENDING') return statusPill('Awaiting confirmation', 'warning');
  return statusPill('Confirmed', 'success');
}

export function renderMeetingDetailPage(input: {
  user: SessionUser; counts: NavCounts; meeting: any; brief: any | null;
}): string {
  const { user, counts, meeting, brief } = input;

  const body = html`
    <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr);align-items:start">
      <div class="card card-pad">
        ${!brief
          ? emptyState({
              title: 'No prep brief yet',
              explanation: 'A brief is generated when the booking is confirmed.',
              action: { href: `/accounts/${meeting.account_id}`, label: 'Open account' },
            })
          : html`
            <div class="section">
              <h3>Why this meeting was booked</h3>
              <p class="lead">${brief.primaryHypothesis ?? 'No hypothesis recorded.'}</p>
              <p class="muted small">${brief.meetingObjective}</p>
            </div>

            <div class="section">
              <h3>What they actually said</h3>
              ${(brief.prospectSaid ?? []).length === 0
                ? html`<p class="muted small">Nothing captured verbatim.</p>`
                : html`<ul class="evidence-list">
                    ${(brief.prospectSaid ?? []).map((statement: any) => evidenceFact({
                      statement: `“${statement.text}”`, factClass: 'confirmed',
                      source: 'prospect', observedAt: new Date(statement.capturedAt),
                    }))}
                  </ul>`}
            </div>

            ${(brief.numbersTheyGave ?? []).length > 0 ? html`
            <div class="section">
              <h3>Numbers they gave</h3>
              <ul class="plain-list">${brief.numbersTheyGave.map((n: string) => html`<li>${n}</li>`)}</ul>
            </div>` : ''}

            ${(brief.systemsTheyNamed ?? []).length > 0 ? html`
            <div class="section">
              <h3>Systems they named</h3>
              <div class="row" style="gap:6px">${brief.systemsTheyNamed.map((s: string) =>
                statusPill(titleCase(s), 'info'))}</div>
            </div>` : ''}

            <div class="section">
              <h3>What we observed but they have not confirmed</h3>
              ${(brief.observedContext ?? []).length === 0
                ? html`<p class="muted small">Nothing.</p>`
                : html`<ul class="evidence-list">
                    ${(brief.observedContext ?? []).map((claim: string) => evidenceFact({
                      statement: claim, factClass: 'likely', source: 'public research',
                    }))}
                  </ul>`}
            </div>

            <div class="section">
              <h3>Suggested first questions</h3>
              <ol class="plain-list numbered">
                ${(brief.suggestedQuestions ?? []).map((q: string) => html`<li>“${q}”</li>`)}
              </ol>
            </div>`}
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Meeting</h2>${meetingStatusPill(meeting)}</div>
          <div class="card-pad">
            <dl class="detail-list">
              <div><dt>When</dt><dd>${formatDateTime(meeting.requested_start,
                meeting.prospect_timezone ?? 'America/New_York')}</dd></div>
              <div><dt>Timezone</dt><dd>${meeting.prospect_timezone ?? 'America/New_York'}</dd></div>
              <div><dt>Host</dt><dd>${meeting.calendar_upn}</dd></div>
              <div><dt>Attendee</dt><dd>${meeting.attendee_name ?? '—'}<br>
                <span class="micro muted">${meeting.attendee_email ?? ''}</span></dd></div>
              <div><dt>Location</dt><dd>${meeting.meeting_location_type === 'cal_video'
                ? 'Cal Video' : titleCase(meeting.meeting_location_type)}</dd></div>
              <div><dt>Source</dt><dd>${titleCase(meeting.source_channel)}</dd></div>
            </dl>
            ${meeting.provider_web_link && meeting.status === 'CONFIRMED' ? html`
              <a class="btn btn-primary btn-sm" style="width:100%;margin-top:12px"
                 href="${meeting.provider_web_link}" target="_blank" rel="noreferrer noopener">Join</a>` : ''}
          </div>
        </div>

        ${brief && (brief.doNotAssume ?? []).length > 0 ? html`
        <div class="card">
          <div class="card-head"><h2>Do not assume</h2></div>
          <div class="card-pad">
            <ul class="plain-list">${brief.doNotAssume.map((item: string) => html`<li>${item}</li>`)}</ul>
          </div>
        </div>` : ''}
      </div>
    </div>`;

  return renderPage({
    title: meeting.company_name,
    subtitle: 'Strategy call prep brief',
    breadcrumbs: [{ href: '/meetings', label: 'Meetings' }, { href: '#', label: meeting.company_name }],
    user, currentPath: '/meetings', counts, body,
    actions: html`<a class="btn btn-secondary" href="/accounts/${meeting.account_id}">Open Account</a>`,
  });
}

export { confirmDialog, channelStatusBadge, decisionToStatus, hypothesisCard, isManager, raw };
