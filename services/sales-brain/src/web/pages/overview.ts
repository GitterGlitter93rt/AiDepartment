import { html } from '../html.js';
import { renderPage, type NavCounts } from '../layout.js';
import { emptyState, tierBadge } from '../components.js';
import { formatDateTime, relativeTime } from '../format.js';
import type { SessionUser } from '../../domain/auth.js';
import type { ProspectRow } from '../../domain/search.js';

/**
 * Overview. Useful without forcing a queue (rep-portal-ui-ux-spec.md §3):
 * it recommends what to work, it does not prescribe it.
 */

export interface OverviewInput {
  user: SessionUser;
  counts: NavCounts;
  kpis: {
    activeProspects: number;
    newThisWeek: number;
    followUpsDue: number;
    followUpsOverdue: number;
    meetingsBooked: number;
    notContacted: number;
  };
  recentlyClaimed: ProspectRow[];
  dueFollowUps: {
    followup_id: number; account_id: string; company_name: string; due_at: Date;
    followup_type: string; prospect_requested: boolean; context: string | null;
  }[];
  markets: {
    market_id: string; name: string; researched: number; unclaimed: number;
    tier_a: number; last_mined_at: Date | null;
  }[];
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function renderOverviewPage(input: OverviewInput): string {
  const { user, counts, kpis, recentlyClaimed, dueFollowUps, markets } = input;
  const firstName = user.displayName.split(' ')[0] ?? user.displayName;

  const body = html`
    <div class="grid grid-kpi">
      <div class="card kpi">
        <div class="kpi-label">My active prospects</div>
        <div class="kpi-value">${kpis.activeProspects}</div>
        <div class="kpi-sub">${kpis.notContacted} not yet contacted</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">Claimed this week</div>
        <div class="kpi-value">${kpis.newThisWeek}</div>
        <div class="kpi-sub">across all markets</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">Follow-ups due</div>
        <div class="kpi-value ${kpis.followUpsOverdue > 0 ? 'attention' : ''}">${kpis.followUpsDue}</div>
        <div class="kpi-sub">${kpis.followUpsOverdue > 0 ? `${kpis.followUpsOverdue} overdue` : 'nothing overdue'}</div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">Meetings booked</div>
        <div class="kpi-value ${kpis.meetingsBooked > 0 ? 'good' : ''}">${kpis.meetingsBooked}</div>
        <div class="kpi-sub">confirmed on the calendar</div>
      </div>
    </div>

    <div style="height:18px"></div>

    <div class="grid grid-two">
      <div class="card">
        <div class="card-head">
          <h2>Follow-ups due</h2>
          <a class="small" href="/follow-ups">View all</a>
        </div>
        ${dueFollowUps.length === 0
          ? html`<div class="card-pad muted small">Nothing is due right now.</div>`
          : html`<ul class="timeline" style="padding:6px 20px 12px">
              ${dueFollowUps.map((followUp) => html`
                <li>
                  <div style="flex:1">
                    <div class="timeline-type">
                      <a href="/accounts/${followUp.account_id}">${followUp.company_name}</a>
                      ${followUp.prospect_requested
                        ? html`<span class="badge badge-warn" style="margin-left:6px">They asked for this</span>`
                        : ''}
                    </div>
                    <div class="muted micro">${followUp.context ?? 'Callback'}</div>
                  </div>
                  <span class="timeline-when ${new Date(followUp.due_at) < new Date() ? 'badge badge-warn' : ''}">
                    ${formatDateTime(followUp.due_at)}
                  </span>
                </li>`)}
            </ul>`}
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Recently claimed</h2>
          <a class="small" href="/prospects">My Prospects</a>
        </div>
        ${recentlyClaimed.length === 0
          ? html`<div class="card-pad">${emptyState(
              "You haven't claimed any prospects yet",
              'Search a market and claim the companies you want to work.',
              { href: '/find', label: 'Find Prospects' },
            )}</div>`
          : html`<ul class="timeline" style="padding:6px 20px 12px">
              ${recentlyClaimed.map((row) => html`
                <li>
                  <div style="flex:1">
                    <div class="timeline-type"><a href="/accounts/${row.account_id}">${row.company_name}</a></div>
                    <div class="muted micro">${row.geography_summary}</div>
                  </div>
                  ${tierBadge(row.manual_tier, row.manual_score)}
                  <span class="timeline-when">${relativeTime(row.claimed_at)}</span>
                </li>`)}
            </ul>`}
      </div>
    </div>

    <div style="height:18px"></div>

    <div class="card">
      <div class="card-head">
        <h2>Markets you can work</h2>
        <a class="small" href="/markets">All markets</a>
      </div>
      ${markets.length === 0
        ? html`<div class="card-pad muted small">No saved markets have been configured yet.</div>`
        : html`<div class="card-pad grid grid-market">
            ${markets.slice(0, 4).map((market) => html`
              <a class="card card-pad" href="/find?market=${market.market_id}" style="text-decoration:none;color:inherit">
                <h3>${market.name}</h3>
                <div class="muted small" style="margin-top:6px">
                  ${market.researched} researched · <strong>${market.unclaimed} unclaimed</strong> · ${market.tier_a} Tier A
                </div>
                <div class="muted micro" style="margin-top:4px">Refreshed ${relativeTime(market.last_mined_at)}</div>
              </a>`)}
          </div>`}
    </div>`;

  return renderPage({
    title: `${greeting()}, ${firstName}`,
    subtitle: 'Your book of business and what the EdgeXpert has researched for you.',
    user, currentPath: '/', counts, body,
    actions: html`<a class="btn btn-primary" href="/find">Find Prospects</a>
                  <a class="btn btn-secondary" href="/prospects">My Prospects</a>`,
  });
}
