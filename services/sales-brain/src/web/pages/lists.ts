import { html, raw, type RawHtml } from '../html.js';
import { renderPage, type NavCounts } from '../layout.js';
import { emptyState, prospectTable, tierBadge } from '../components.js';
import { formatDateTime, pluralize, relativeTime, titleCase } from '../format.js';
import type { SessionUser } from '../../domain/auth.js';
import type { ProspectRow, SearchResponse } from '../../domain/search.js';

/** My Prospects, Markets, Follow-Ups and Team. */

const MY_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'NEWLY_CLAIMED', label: 'New' },
  { value: 'NOT_CONTACTED', label: 'Not contacted' },
  { value: 'CALL_READY', label: 'Call ready' },
  { value: 'EMAIL_READY', label: 'Email ready' },
  { value: 'CALL_AND_EMAIL', label: 'Call + email' },
  { value: 'CALLBACK_DUE', label: 'Callbacks due' },
  { value: 'POSITIVE_REPLY', label: 'Positive reply' },
  { value: 'OPPORTUNITY', label: 'Opportunity' },
];

export function renderMyProspectsPage(input: {
  user: SessionUser; counts: NavCounts; response: SearchResponse;
  activeFilter: string; sort: string;
}): string {
  const { user, counts, response, activeFilter, sort } = input;

  const body = html`
    <div class="chips" style="margin-bottom:16px">
      ${MY_FILTERS.map((filter) => html`
        <a class="chip" href="/prospects${filter.value ? `?filter=${filter.value}` : ''}"
           aria-pressed="${activeFilter === filter.value ? 'true' : 'false'}">${filter.label}</a>`)}
    </div>
    <div class="card">
      <div class="card-head">
        <h2>${pluralize(response.total, 'prospect')}</h2>
        <form method="get" class="row" style="gap:8px">
          ${activeFilter ? html`<input type="hidden" name="filter" value="${activeFilter}">` : ''}
          <label class="micro muted" for="sort">Sort</label>
          <select id="sort" name="sort" onchange="this.form.submit()" style="width:auto">
            ${[
              ['recommended_priority', 'Highest priority'],
              ['claimed_at', 'Recently claimed'],
              ['follow_up_due', 'Follow-up due'],
              ['manual_score', 'Score'],
              ['company_name', 'Company name'],
            ].map(([value, label]) => html`
              <option value="${value}" ${raw(sort === value ? 'selected' : '')}>${label}</option>`)}
          </select>
        </form>
      </div>
      ${prospectTable({
        rows: response.results, viewerId: user.userId, selectable: false, showOwner: false,
        emptyState: emptyState(
          activeFilter ? 'Nothing matches that filter' : "You haven't claimed any prospects yet",
          activeFilter
            ? 'Try a different filter, or go back to All.'
            : 'Search a market and claim the companies you want to work.',
          activeFilter ? { href: '/prospects', label: 'Show all' } : { href: '/find', label: 'Find Prospects' },
        ),
      })}
    </div>`;

  return renderPage({
    title: 'My Prospects',
    subtitle: 'Your book of business. Ranking suggests what to work first; the choice stays yours.',
    user, currentPath: '/prospects', counts, body,
    actions: html`<a class="btn btn-primary" href="/find">Find more</a>`,
  });
}

export interface MarketCard {
  market_id: string;
  name: string;
  vertical_display: string | null;
  geography_label: string;
  mining_mode: string;
  status: string;
  researched: number;
  unclaimed: number;
  claimed: number;
  tier_a: number;
  tier_b: number;
  phone_email: number;
  advertisers: number;
  last_mined_at: Date | null;
}

const MARKET_STATUS_TONE: Record<string, string> = {
  ACTIVE: 'badge-good', SATURATED: '', REFRESHING: 'badge-warn', PAUSED: 'badge-warn',
};

export function renderMarketsPage(input: {
  user: SessionUser; counts: NavCounts; markets: MarketCard[]; canManage: boolean;
}): string {
  const { user, counts, markets, canManage } = input;

  const body = markets.length === 0
    ? emptyState(
        'No saved markets yet',
        'Saved markets are the inventories the EdgeXpert keeps replenished. A manager can create the first one.',
      )
    : html`<div class="grid grid-market">
        ${markets.map((market) => html`
        <div class="card card-pad">
          <div class="row" style="justify-content:space-between;align-items:flex-start">
            <div>
              <h3>${market.name}</h3>
              <div class="muted small">${market.geography_label} · ${market.vertical_display ?? 'All industries'}</div>
            </div>
            <span class="badge ${MARKET_STATUS_TONE[market.status] ?? ''}">${titleCase(market.status)}</span>
          </div>

          <div class="grid" style="grid-template-columns:repeat(2,1fr);gap:8px;margin:14px 0">
            <div>
              <div class="kpi-label">Researched</div>
              <div style="font-weight:700;font-size:1.15rem">${market.researched}</div>
            </div>
            <div>
              <div class="kpi-label">Unclaimed</div>
              <div style="font-weight:700;font-size:1.15rem;color:var(--electric-blue)">${market.unclaimed}</div>
            </div>
          </div>

          <div class="row micro muted" style="gap:10px">
            <span>${market.tier_a} Tier A</span>
            <span>${market.tier_b} Tier B</span>
            <span>${market.phone_email} phone + email</span>
            ${market.advertisers > 0 ? html`<span>${market.advertisers} advertisers</span>` : ''}
          </div>
          <div class="micro muted" style="margin-top:6px">
            ${market.last_mined_at ? `Refreshed ${relativeTime(market.last_mined_at)}` : 'Not yet mined'}
          </div>

          <div class="row" style="margin-top:14px;gap:8px">
            <a class="btn btn-primary btn-sm" href="/find?market=${market.market_id}">Browse prospects</a>
            ${canManage
              ? html`<button class="btn btn-secondary btn-sm js-research-more" type="button">Research more</button>`
              : ''}
          </div>
        </div>`)}
      </div>`;

  return renderPage({
    title: 'Markets',
    subtitle: 'Inventories the EdgeXpert keeps researched and replenished.',
    user, currentPath: '/markets', counts, body: html`${body}`,
  });
}

export interface FollowUpRow {
  followup_id: number;
  account_id: string;
  company_name: string;
  geography_summary: string;
  followup_type: string;
  due_at: Date;
  prospect_requested: boolean;
  context: string | null;
  manual_tier: string | null;
  manual_score: number | null;
  owner_name: string | null;
}

export function renderFollowUpsPage(input: {
  user: SessionUser; counts: NavCounts; overdue: FollowUpRow[]; upcoming: FollowUpRow[];
}): string {
  const { user, counts, overdue, upcoming } = input;

  const section = (title: string, rows: FollowUpRow[], tone: 'warn' | 'plain'): RawHtml => html`
    <div class="card" style="margin-bottom:16px">
      <div class="card-head">
        <h2>${title}</h2>
        <span class="muted small">${pluralize(rows.length, 'item')}</span>
      </div>
      ${rows.length === 0
        ? html`<div class="card-pad muted small">Nothing here.</div>`
        : html`<ul class="timeline" style="padding:6px 20px 12px">
            ${rows.map((row) => html`
            <li>
              <div style="flex:1">
                <div class="timeline-type">
                  <a href="/accounts/${row.account_id}">${row.company_name}</a>
                  ${tierBadge(row.manual_tier, row.manual_score)}
                  ${row.prospect_requested ? html`<span class="badge badge-warn">They asked for this</span>` : ''}
                </div>
                <div class="muted micro">${row.geography_summary} · ${titleCase(row.followup_type)}${
                  row.context ? ` — ${row.context}` : ''}</div>
              </div>
              <span class="timeline-when ${tone === 'warn' ? 'badge badge-warn' : ''}">${formatDateTime(row.due_at)}</span>
              <form method="post" action="/follow-ups/${row.followup_id}/complete">
                <button class="btn btn-ghost btn-sm" type="submit">Done</button>
              </form>
            </li>`)}
          </ul>`}
    </div>`;

  const body = overdue.length === 0 && upcoming.length === 0
    ? emptyState('Nothing to follow up', 'Callbacks and follow-ups you commit to will appear here.',
        { href: '/prospects', label: 'My Prospects' })
    : html`${section('Overdue', overdue, 'warn')}${section('Coming up', upcoming, 'plain')}`;

  return renderPage({
    title: 'Follow-Ups',
    subtitle: 'Commitments you made, in the order they are due.',
    user, currentPath: '/follow-ups', counts, body: html`${body}`,
  });
}

export interface TeamRow {
  user_id: string;
  display_name: string;
  role: string;
  active_prospects: number;
  uncontacted: number;
  overdue_followups: number;
  meetings: number;
  opportunities: number;
  stale_claims: number;
}

export function renderTeamPage(input: {
  user: SessionUser; counts: NavCounts; team: TeamRow[]; staleThresholdDays: number;
}): string {
  const { user, counts, team, staleThresholdDays } = input;

  const body = html`
    <div class="card">
      <div class="card-head">
        <h2>Team ownership</h2>
        <span class="muted small">Claimed prospects with no activity for ${staleThresholdDays}+ days are flagged</span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Rep</th><th>Role</th><th>Active</th><th>Not contacted</th>
              <th>Overdue follow-ups</th><th>Meetings</th><th>Opportunities</th><th>Stale claims</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${team.map((row) => html`
            <tr>
              <td class="cell-company">${row.display_name}</td>
              <td class="muted small">${titleCase(row.role)}</td>
              <td>${row.active_prospects}</td>
              <td>${row.uncontacted > 0 ? html`<span class="badge badge-warn">${row.uncontacted}</span>` : '0'}</td>
              <td>${row.overdue_followups > 0 ? html`<span class="badge badge-warn">${row.overdue_followups}</span>` : '0'}</td>
              <td>${row.meetings}</td>
              <td>${row.opportunities}</td>
              <td>${row.stale_claims > 0
                    ? html`<span class="badge badge-warn">${row.stale_claims}</span>`
                    : html`<span class="muted">0</span>`}</td>
              <td><a class="btn btn-secondary btn-sm" href="/team/${row.user_id}">View book</a></td>
            </tr>`)}
          </tbody>
        </table>
      </div>
    </div>
    <p class="muted small" style="margin-top:12px">
      Stale claims identify hoarding without taking anything away automatically. Accounts with a
      requested callback, a positive reply, a booked meeting, an active opportunity, a proposal or a
      client relationship are never auto-released.
    </p>`;

  return renderPage({
    title: 'Team',
    subtitle: 'Who owns what, and where ownership has gone quiet.',
    user, currentPath: '/team', counts, body,
  });
}

export function renderRepBookPage(input: {
  user: SessionUser; counts: NavCounts; rep: { user_id: string; display_name: string };
  response: SearchResponse; reps: { user_id: string; display_name: string }[];
}): string {
  const { user, counts, rep, response, reps } = input;

  const body = html`
    <div class="card">
      <div class="card-head">
        <h2>${rep.display_name} · ${pluralize(response.total, 'prospect')}</h2>
        <a class="small" href="/team">Back to team</a>
      </div>
      ${prospectTable({
        rows: response.results, viewerId: user.userId, selectable: true, showOwner: true,
        emptyState: emptyState('No prospects', `${rep.display_name} does not own any accounts yet.`),
      })}
    </div>
    <div class="bulk-bar" id="bulk-bar" hidden>
      <strong data-count>0 prospects selected</strong>
      <span class="spacer"></span>
      <form method="post" action="/team/${rep.user_id}/reassign" class="row" style="gap:8px" id="reassign-form">
        <input type="hidden" name="accountIds" id="reassign-ids">
        <select name="newOwnerUserId" required style="width:auto">
          <option value="">Reassign to…</option>
          ${reps.filter((candidate) => candidate.user_id !== rep.user_id).map((candidate) => html`
            <option value="${candidate.user_id}">${candidate.display_name}</option>`)}
        </select>
        <input type="text" name="reason" placeholder="Reason (required)" required style="width:200px">
        <button class="btn btn-primary btn-sm" type="submit">Reassign</button>
      </form>
    </div>`;

  return renderPage({
    title: `${rep.display_name}'s book`,
    subtitle: 'Manager view. Reassignment is audited and preserves prior ownership history.',
    user, currentPath: '/team', counts, body,
    script: html`document.getElementById('reassign-form')?.addEventListener('submit', function () {
  var ids = Array.prototype.slice.call(document.querySelectorAll('.js-row-select:checked'))
    .map(function (input) { return input.value; });
  document.getElementById('reassign-ids').value = ids.join(',');
});`,
  });
}
