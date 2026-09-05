import { html, raw, type RawHtml } from './html.js';
import { relativeTime, tierLabel, titleCase } from './format.js';
import type { ProspectRow } from '../domain/search.js';

/**
 * Shared prospect presentation. Two rules are load-bearing here:
 *   - a badge appears only when evidence supports it; unknown renders as nothing,
 *     never as a "no" (rep-inventory-browse-claim-spec §5);
 *   - stale evidence gets a visibly different treatment from current evidence.
 */

export function tierBadge(tier: string | null, score: number | null): RawHtml {
  // Unscored is not tier D. Styling it as the worst tier tells a rep scanning by
  // colour that we judged the company and found it poor, when what actually happened
  // is that nobody has researched it yet -- and an unresearched advertiser is the one
  // you want to look at, not the one you skip (component contract: unknown stays
  // unknown, and status is never colour alone).
  if (!tier) {
    return html`<span class="badge badge-unscored"
      title="Not researched yet. This is not a low score.">Unscored</span>`;
  }
  return html`<span class="badge badge-tier-${tier}"
    title="Fit score. Fit does not grant permission to contact.">${tierLabel(tier, score)}</span>`;
}

export function adBadges(row: {
  google_paid?: boolean | null; google_lsa?: boolean | null; meta_paid?: boolean | null;
}): RawHtml {
  const badges: RawHtml[] = [];
  if (row.google_paid) badges.push(html`<span class="badge badge-ad">Google</span>`);
  if (row.google_lsa) badges.push(html`<span class="badge badge-ad">LSA</span>`);
  if (row.meta_paid) badges.push(html`<span class="badge badge-ad">Meta</span>`);
  // No badge at all when nothing is observed. Absence of evidence is not evidence
  // that they do not advertise, so nothing is rendered rather than a "None" chip.
  if (badges.length === 0) return html`<span class="muted micro">—</span>`;
  return html`${badges}`;
}

const CHANNEL_BADGES: Record<string, { label: string; cls: string }> = {
  CALL_AND_EMAIL: { label: 'Phone + Email', cls: 'badge-good' },
  CALL_READY: { label: 'Phone', cls: 'badge-good' },
  EMAIL_READY: { label: 'Email', cls: 'badge-good' },
  CONTACT_RESEARCH_NEEDED: { label: 'Research needed', cls: 'badge-warn' },
  CALLBACK: { label: 'Callback due', cls: 'badge-warn' },
  SUPPRESSED: { label: 'Suppressed', cls: 'badge-bad' },
};

export function channelBadge(channelState: string): RawHtml {
  const badge = CHANNEL_BADGES[channelState] ?? { label: titleCase(channelState), cls: '' };
  return html`<span class="badge ${badge.cls}">${badge.label}</span>`;
}

export function freshnessBadge(lastResearchedAt: Date | null, freshUntil?: Date | null): RawHtml {
  if (!lastResearchedAt) return html`<span class="badge badge-stale">Not researched</span>`;
  const isStale = freshUntil ? new Date(freshUntil).getTime() < Date.now() : false;
  return isStale
    ? html`<span class="badge badge-stale">Stale · ${relativeTime(lastResearchedAt)}</span>`
    : html`<span class="muted micro">${relativeTime(lastResearchedAt)}</span>`;
}

export function ownerCell(row: ProspectRow, viewerId: string): RawHtml {
  if (row.is_suppressed) return html`<span class="badge badge-bad">Suppressed</span>`;
  if (!row.current_owner_user_id) return html`<span class="muted small">Unclaimed</span>`;
  if (row.current_owner_user_id === viewerId) return html`<span class="badge badge-owner-you">You</span>`;
  return html`<span class="muted small">${row.owner_display_name ?? 'Another rep'}</span>`;
}

/** One-line reason. Falls back to observable structure, never to an invented claim. */
export function whyItFits(row: ProspectRow): string {
  if (row.primary_hypothesis) return row.primary_hypothesis;
  const parts: string[] = [];
  if (row.google_paid || row.google_lsa || row.meta_paid) parts.push('Currently observed advertising');
  if (row.contactability_summary === 'PHONE_AND_EMAIL') parts.push('phone and email available');
  else if (row.contactability_summary === 'PHONE') parts.push('phone available');
  if (row.best_contact_name) parts.push(`named contact (${row.best_contact_title ?? 'role unknown'})`);
  if (parts.length === 0) return 'Researched company — no opportunity hypothesis generated yet.';
  return `${parts.join(', ')}.`;
}

export function contactCell(row: ProspectRow): RawHtml {
  if (row.contactability_summary === 'RESEARCH_NEEDED') {
    return html`<span class="badge badge-warn">Research needed</span>`;
  }
  const bits: RawHtml[] = [];
  if (row.phone_count > 0) {
    bits.push(
      row.has_direct_phone
        ? html`<span class="badge badge-good">Direct phone</span>`
        : html`<span class="badge">Main line</span>`,
    );
  }
  if (row.email_count > 0) {
    bits.push(
      row.has_named_email
        ? html`<span class="badge badge-good">Named email</span>`
        : html`<span class="badge">Email</span>`,
    );
  }
  return html`${bits}`;
}

/** Who to ask for. Never presents a role target as if it were a confirmed person. */
export function decisionMakerCell(row: ProspectRow): RawHtml {
  if (!row.best_contact_name) {
    return html`<span class="muted small">Not resolved</span>`;
  }
  if (row.best_contact_is_role_only) {
    return html`<span class="small">Ask for ${titleCase(row.best_contact_role)}</span>
      <div class="micro muted">Named person not verified</div>`;
  }
  const uncertain = row.best_contact_role_confidence === 'UNKNOWN_ROLE'
    || row.best_contact_role_confidence === 'HISTORICAL_ROLE';
  return html`<span class="small"><strong>${row.best_contact_name}</strong></span>
    <div class="micro muted">${row.best_contact_title ?? titleCase(row.best_contact_role)}${
      uncertain ? html` · <span style="color:var(--amber)">role unconfirmed</span>` : ''
    }</div>`;
}

export interface ProspectTableOptions {
  rows: ProspectRow[];
  viewerId: string;
  selectable: boolean;
  showOwner: boolean;
  emptyState: RawHtml;
}

export function prospectTable(options: ProspectTableOptions): RawHtml {
  const { rows, viewerId, selectable, showOwner, emptyState } = options;
  if (rows.length === 0) return emptyState;

  const claimable = (row: ProspectRow): boolean =>
    !row.is_suppressed && !row.current_owner_user_id;

  const actionCell = (row: ProspectRow): RawHtml => {
    if (row.is_suppressed) return html`<span class="muted micro">—</span>`;
    if (row.current_owner_user_id === viewerId) {
      return html`<a class="btn btn-secondary btn-sm" href="/accounts/${row.account_id}">Open</a>`;
    }
    if (row.current_owner_user_id) {
      return html`<span class="muted micro">Owned by ${row.owner_display_name ?? 'another rep'}</span>`;
    }
    return html`<button class="btn btn-primary btn-sm js-claim" data-account="${row.account_id}">Claim</button>`;
  };

  return html`
  <div class="table-wrap">
    <table class="data">
      <thead>
        <tr>
          ${selectable ? html`<th class="col-select"><input type="checkbox" id="select-all" aria-label="Select all"></th>` : ''}
          <th>Company</th>
          <th>Market</th>
          <th>Fit</th>
          <th>Advertising</th>
          <th>Contact</th>
          <th>Ask for</th>
          <th>Why it fits</th>
          <th>Researched</th>
          ${showOwner ? html`<th>Owner</th>` : ''}
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => html`
        <tr data-account="${row.account_id}">
          ${selectable ? html`<td class="col-select">${
            claimable(row)
              ? html`<input type="checkbox" class="js-row-select" value="${row.account_id}" aria-label="Select ${row.company_name}">`
              : ''
          }</td>` : ''}
          <td class="cell-company">
            <a href="#" class="js-open-drawer" data-account="${row.account_id}">${row.company_name}</a>
          </td>
          <td class="muted small">${row.geography_summary}</td>
          <td>${tierBadge(row.manual_tier, row.manual_score)}</td>
          <td>${adBadges(row)}</td>
          <td>${contactCell(row)}</td>
          <td>${decisionMakerCell(row)}</td>
          <td class="cell-why" title="${whyItFits(row)}">${whyItFits(row)}</td>
          <td>${freshnessBadge(row.last_researched_at, null)}</td>
          ${showOwner ? html`<td>${ownerCell(row, viewerId)}</td>` : ''}
          <td>${actionCell(row)}</td>
        </tr>`)}
      </tbody>
    </table>
  </div>

  <div class="cards-list">
    ${rows.map((row) => html`
    <article class="prospect-card" data-account="${row.account_id}">
      <div class="prospect-card-head">
        <div>
          <div class="cell-company">
            <a href="#" class="js-open-drawer" data-account="${row.account_id}">${row.company_name}</a>
          </div>
          <div class="muted small">${row.geography_summary}</div>
        </div>
        ${tierBadge(row.manual_tier, row.manual_score)}
      </div>
      <div class="row" style="gap:6px;margin-top:8px">${adBadges(row)} ${contactCell(row)}</div>
      <p class="why">${whyItFits(row)}</p>
      <div class="row micro muted">${ownerCell(row, viewerId)}</div>
      <div class="actions">
        <a class="btn btn-secondary" href="/accounts/${row.account_id}">Open</a>
        ${claimable(row)
          ? html`<button class="btn btn-primary js-claim" data-account="${row.account_id}">Claim to Me</button>`
          : ''}
      </div>
    </article>`)}
  </div>`;
}

export function emptyState(title: string, message: string, cta?: { href: string; label: string }): RawHtml {
  return html`<div class="empty">
    <h3>${title}</h3>
    <p>${message}</p>
    ${cta ? html`<a class="btn btn-primary" href="${cta.href}">${cta.label}</a>` : ''}
  </div>`;
}

export function coverageNote(coverage: {
  state: string; researchedCount: number; unclaimedCount: number; lastMinedAt: Date | null;
  discoveryAvailable?: boolean; activeJobScope?: string | null; unscoredExcluded?: number;
  unknownAdvertiserExcluded?: number;
}, canResearch: boolean, geographyLabel: string): RawHtml {
  // Never imply complete market coverage (browse-claim spec §10), and never imply a
  // search happened that could not have happened.
  const canDiscover = coverage.discoveryAvailable !== false;

  // A tier filter hides Accounts with no tier, and an Account with no tier is one
  // nobody has researched -- not one that scored badly. Without this line the rep
  // sees an empty market and has no way to learn the companies are there.
  const unscored = Number(coverage.unscoredExcluded ?? 0);
  const hidden = unscored === 0 ? raw('') : html`
    <div class="coverage-note">
      <span class="dot"></span>
      <span><strong>${unscored} compan${unscored === 1 ? 'y is' : 'ies are'} not shown
      because ${unscored === 1 ? 'it has' : 'they have'} no tier yet.</strong>
      A tier comes from research, so ${unscored === 1 ? 'this one has' : 'these have'}
      not been researched -- not scored badly. Clear the tier filter to see
      ${unscored === 1 ? 'it' : 'them'}.</span>
    </div>`;

  // The same collapse, one filter over. An advertising filter drops companies whose
  // ad status is unknown, and unknown is not the same as checked-and-not-advertising.
  const unchecked = Number(coverage.unknownAdvertiserExcluded ?? 0);
  const uncheckedNote = unchecked === 0 ? raw('') : html`
    <div class="coverage-note">
      <span class="dot"></span>
      <span><strong>${unchecked} compan${unchecked === 1 ? 'y has' : 'ies have'} never been
      checked for advertising.</strong> They are not in these results, and that is not
      the same as them not advertising -- nobody has looked yet.</span>
    </div>`;

  // The sentence an operator has to see before any of the others. Without a search
  // provider, nothing in this market can be found that is not already here, and an
  // empty result is not evidence about the market.
  const blocked = canDiscover ? raw('') : html`
    <div class="coverage-note warn">
      <span class="dot"></span>
      <span><strong>New-business search is unavailable.</strong> No search provider is
      configured, so this page can only show companies already in inventory and a
      refresh cannot add one. An empty result here does not mean
      ${geographyLabel} has no businesses.</span>
    </div>`;

  switch (coverage.state) {
    case 'NOT_YET_MINED':
      return html`${blocked}${hidden}${uncheckedNote}<div class="coverage-note">
        <span class="dot"></span>
        <span>${canDiscover
          ? html`No researched prospects yet for ${geographyLabel}. Market Miner has not covered this area.`
          : html`Nothing in inventory for ${geographyLabel} yet, and the system cannot
                 search for any: this is what we hold, not what exists.`}</span>
        ${canResearch && canDiscover
          ? html`<button class="btn btn-secondary btn-sm js-research-more">Research this market</button>`
          : ''}
      </div>`;
    case 'STALE':
      return html`<div class="coverage-note">
        <span class="dot"></span>
        <span>${coverage.researchedCount} researched prospects, but the research has aged past its freshness window.
        Treat advertising signals as historical until refreshed.</span>
        ${canResearch ? html`<button class="btn btn-secondary btn-sm js-research-more">Refresh</button>` : ''}
      </div>`;
    case 'PARTIAL':
      return html`${blocked}${hidden}${uncheckedNote}<div class="coverage-note">
        <span class="dot"></span>
        <span>More businesses may exist in ${geographyLabel}. Coverage here is partial, not complete.</span>
        ${canResearch && canDiscover
          ? html`<button class="btn btn-secondary btn-sm js-research-more">Research more</button>`
          : ''}
      </div>`;
    case 'REFRESHING':
      // "New ones will appear as they land" was the exact sentence a market search
      // showed while no provider existed to find one.
      return html`${blocked}${hidden}${uncheckedNote}<div class="coverage-note info">
        <span class="dot"></span>
        <span>${coverage.activeJobScope === 'DISCOVER_NEW'
          ? html`Searching ${geographyLabel} for new businesses now. Existing results
                 are shown below and new ones will appear as they land.`
          : html`Re-researching the companies already in inventory for
                 ${geographyLabel}. This does not look for new businesses, so nothing
                 new will appear.`}</span>
      </div>`;
    default:
      return html`${blocked}${hidden}${uncheckedNote}`;
  }
}
