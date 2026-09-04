import { html, jsonScript, raw, type RawHtml } from '../html.js';
import { renderPage } from '../layout.js';
import { coverageNote, emptyState, prospectTable } from '../components.js';
import { pluralize } from '../format.js';
import type { SessionUser } from '../../domain/auth.js';
import { can } from '../../domain/auth.js';
import type { SearchRequest, SearchResponse } from '../../domain/search.js';
import type { VerticalOption } from '../../domain/verticals.js';
import type { NavCounts } from '../layout.js';

/**
 * Find Prospects — the hero workflow.
 * Authority: rep-portal-ui-ux-spec.md §4-§8, visual-system §10.
 *
 * The search row is one elevated panel, filters are chips below it, and everything
 * else lives behind Advanced. A rep does not start inside a 30-field form.
 */

const QUICK_FILTERS: { key: string; value: string; label: string }[] = [
  { key: 'ownership', value: 'UNCLAIMED', label: 'Unclaimed' },
  { key: 'tier', value: 'A', label: 'Tier A' },
  { key: 'tier', value: 'B', label: 'Tier B+' },
  { key: 'ad', value: 'google_paid', label: 'Google Ads' },
  { key: 'ad', value: 'google_lsa', label: 'LSA' },
  { key: 'contact', value: 'phone_and_email', label: 'Phone + Email' },
  { key: 'contact', value: 'direct_phone', label: 'Direct phone' },
  { key: 'contact', value: 'decision_maker_known', label: 'Named decision maker' },
];

export interface FindPageInput {
  user: SessionUser;
  counts: NavCounts;
  verticals: VerticalOption[];
  request: SearchRequest;
  response: SearchResponse | null;
  queryString: URLSearchParams;
  markets: { market_id: string; name: string }[];
}

function chipHref(params: URLSearchParams, key: string, value: string): string {
  const next = new URLSearchParams(params);
  next.delete('page');
  const current = next.getAll(key);
  if (current.includes(value)) {
    next.delete(key);
    for (const remaining of current.filter((item) => item !== value)) next.append(key, remaining);
  } else if (key === 'tier' || key === 'ownership') {
    next.set(key, value);
  } else {
    next.append(key, value);
  }
  return `/find?${next.toString()}`;
}

export function renderFindPage(input: FindPageInput): string {
  const { user, counts, verticals, request, response, queryString, markets } = input;
  const canResearch = can(user.role, 'request_market_refresh');

  const geographyValue = request.geography?.value ?? '';
  const geographyLabel = geographyValue || 'this market';

  const searchPanel = html`
  <form class="search-hero" method="get" action="/find">
    <div class="search-row">
      <div class="field" style="flex:0 0 190px">
        <label for="vertical">Industry</label>
        <select id="vertical" name="vertical">
          <option value="">All industries</option>
          ${verticals.map((vertical) => html`
            <option value="${vertical.id}" ${raw(request.verticalProfileId === vertical.id ? 'selected' : '')}>
              ${vertical.displayName}
            </option>`)}
        </select>
      </div>
      <div class="field field-grow">
        <label for="where">ZIP, city or state</label>
        <input id="where" name="where" type="search" placeholder="32256, Jacksonville, or FL"
               value="${geographyValue}">
      </div>
      <div class="field" style="flex:0 0 190px">
        <label for="market">Saved market</label>
        <select id="market" name="market">
          <option value="">Any</option>
          ${markets.map((market) => html`
            <option value="${market.market_id}" ${raw(request.marketId === market.market_id ? 'selected' : '')}>
              ${market.name}
            </option>`)}
        </select>
      </div>
      <button class="btn btn-primary" type="submit" style="height:38px">Search</button>
    </div>
    <div class="chips">
      ${QUICK_FILTERS.map((filter) => {
        const active =
          filter.key === 'ownership' ? (queryString.get('ownership') ?? 'UNCLAIMED') === filter.value
          : filter.key === 'tier' ? queryString.get('tier') === filter.value
          : queryString.getAll(filter.key).includes(filter.value);
        return html`<a class="chip" href="${chipHref(queryString, filter.key, filter.value)}"
                       aria-pressed="${active ? 'true' : 'false'}">${filter.label}</a>`;
      })}
    </div>
  </form>`;

  let results: RawHtml;
  if (!response) {
    results = emptyState(
      'Tell the Sales Brain where you want to prospect',
      'Pick an industry and a ZIP, city or saved market, then search the researched inventory.',
    );
  } else if (response.results.length === 0) {
    results = html`
      ${coverageNote(response.coverage, canResearch, geographyLabel)}
      ${emptyState(
        'No researched prospects match those filters',
        `Nothing in the current inventory matches this combination${geographyValue ? ` in ${geographyValue}` : ''}. Broaden the filters, or research this market.`,
      )}`;
  } else {
    const start = (response.page - 1) * response.pageSize + 1;
    const end = Math.min(response.page * response.pageSize, response.total);
    results = html`
      ${coverageNote(response.coverage, canResearch, geographyLabel)}
      <div class="card">
        <div class="card-head">
          <h2>${pluralize(response.total, 'researched prospect')}</h2>
          <span class="muted small">${pluralize(response.coverage.unclaimedCount, 'unclaimed')} in this market</span>
        </div>
        ${prospectTable({
          rows: response.results, viewerId: user.userId, selectable: true, showOwner: true,
          emptyState: emptyState('No results', 'Nothing matched.'),
        })}
        ${response.total > response.pageSize ? html`
        <div class="pagination">
          <span class="muted">Showing ${start}–${end} of ${response.total.toLocaleString('en-US')}</span>
          <span class="row">
            ${response.page > 1 ? html`<a class="btn btn-secondary btn-sm" href="${pageHref(queryString, response.page - 1)}">Previous</a>` : ''}
            ${end < response.total ? html`<a class="btn btn-secondary btn-sm" href="${pageHref(queryString, response.page + 1)}">Next</a>` : ''}
          </span>
        </div>` : ''}
      </div>`;
  }

  const body = html`
    ${searchPanel}
    <div style="height:18px"></div>
    ${results}
    <div class="bulk-bar" id="bulk-bar" hidden>
      <strong data-count>0 prospects selected</strong>
      <span class="spacer"></span>
      <button class="btn btn-secondary btn-sm" type="button" id="js-clear-selection">Clear</button>
      <button class="btn btn-primary" type="button" id="js-claim-selected">Claim to Me</button>
    </div>`;

  return renderPage({
    title: 'Find Prospects',
    subtitle: 'Search the researched inventory, then claim the companies you want to work.',
    user, currentPath: '/find', counts, body,
    script: html`window.__searchRequest = ${jsonScript(request)};
document.getElementById('js-clear-selection')?.addEventListener('click', function () {
  document.querySelectorAll('.js-row-select').forEach(function (input) { input.checked = false; });
  document.getElementById('bulk-bar').hidden = true;
  document.querySelectorAll('tr.selected').forEach(function (row) { row.classList.remove('selected'); });
});`,
  });
}

function pageHref(params: URLSearchParams, page: number): string {
  const next = new URLSearchParams(params);
  next.set('page', String(page));
  return `/find?${next.toString()}`;
}
