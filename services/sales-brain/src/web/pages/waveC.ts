import { html, raw, type RawHtml } from '../html.js';
import { renderPage } from '../layout.js';
import type { NavCounts } from '../components/shell.js';
import {
  confirmDialog, emptyState, errorState, kpiCard, statusPill, tierBadge, timeline,
} from '../components/primitives.js';
import { formatDateTime, pluralize, relativeTime, titleCase } from '../format.js';
import type { SessionUser } from '../../domain/auth.js';
import type { ImportPreview, SessionSummary } from '../../import/session.js';

/**
 * Wave C pages: Mining, Research Health, Imports, Sales AI Pilot, Call Review.
 * Authority: YAD-SALES-CRM-UI-MOCKUPS-CURRENT.md §17-§18, §20-§22.
 */

// -------------------------------------------------------------------- Mining

/** Business-language job stages. Raw worker queues are not a rep-facing concept. */
const JOB_STAGE_LABEL: Record<string, string> = {
  market_mine: 'Searching market',
  zip_research: 'Searching market',
  account_research: 'Researching websites',
  contact_research: 'Resolving contacts',
};

export function renderMiningPage(input: {
  user: SessionUser; counts: NavCounts; kpis: any; jobs: any[];
}): string {
  const { user, counts, kpis, jobs } = input;

  const body = html`
    <div class="grid grid-kpi">
      ${kpiCard({ label: 'Active jobs', value: kpis.active, sub: `${kpis.queued} queued` })}
      ${kpiCard({ label: 'Accounts added today', value: kpis.addedToday, tone: 'good' })}
      ${kpiCard({ label: 'Accounts refreshed', value: kpis.refreshedToday, sub: 'in the last 24h' })}
      ${kpiCard({ label: 'Needs review', value: kpis.failed,
                  tone: kpis.failed > 0 ? 'attention' : 'default', sub: 'failed jobs' })}
    </div>

    <div style="height:18px"></div>

    <div class="card">
      <div class="card-head">
        <h2>Research jobs</h2>
        <span class="muted small">Keeping inventory fresh without interrupting reps</span>
      </div>
      ${jobs.length === 0
        ? emptyState({
            title: 'No research jobs yet',
            explanation: 'Jobs appear here when a market is refreshed or a rep requests research.',
            action: { href: '/markets', label: 'Browse markets' },
          })
        : html`<div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>Work</th><th>Market</th><th>Stage</th><th>Started</th>
                <th>Result</th><th>Status</th><th>Requested by</th>
              </tr></thead>
              <tbody>
                ${jobs.map((job: any) => html`<tr>
                  <td class="cell-company">${JOB_STAGE_LABEL[job.job_type] ?? titleCase(job.job_type)}</td>
                  <td class="muted small">${job.market_name ?? job.geography ?? '—'}</td>
                  <td>${jobStagePill(job)}</td>
                  <td class="muted small">${job.started_at ? relativeTime(job.started_at) : 'not started'}</td>
                  <td class="muted small">${describeJobResult(job)}</td>
                  <td>${statusPill(titleCase(job.status),
                    job.status === 'SUCCEEDED' ? 'success'
                    : job.status === 'FAILED' ? 'destructive'
                    : job.status === 'RUNNING' ? 'info' : 'neutral')}</td>
                  <td class="muted small">${job.requested_by_name ?? 'system'}</td>
                </tr>
                ${job.last_error ? html`<tr class="job-error-row">
                  <td colspan="7" class="micro" style="color:var(--crimson)">
                    ${job.last_error}
                    ${job.attempts < job.max_attempts
                      ? html`<span class="muted"> · will retry (${job.attempts}/${job.max_attempts})</span>`
                      : html`<span class="muted"> · retries exhausted</span>`}
                  </td>
                </tr>` : ''}`)}
              </tbody>
            </table>
          </div>`}
    </div>`;

  return renderPage({
    title: 'Mining',
    subtitle: 'Keep prospect inventory fresh without interrupting reps.',
    user, currentPath: '/mining', counts, body,
  });
}

function jobStagePill(job: any): RawHtml {
  if (job.status === 'RUNNING') return statusPill('In progress', 'info');
  if (job.status === 'QUEUED') return statusPill('Queued', 'neutral');
  if (job.status === 'SUCCEEDED') return statusPill('Scoring / saved', 'success');
  if (job.status === 'FAILED') return statusPill('Needs review', 'destructive');
  return statusPill(titleCase(job.status), 'neutral');
}

function describeJobResult(job: any): string {
  const progress = job.progress ?? {};
  if (progress.discovered !== undefined) {
    return `${progress.discovered} found · ${progress.refreshQueued ?? 0} refreshed`;
  }
  if (progress.primaryPerson) return `contact: ${progress.primaryPerson}`;
  if (progress.status) return String(progress.status);
  return '—';
}

// ----------------------------------------------------------- Research Health

export function renderResearchHealthPage(input: {
  user: SessionUser; counts: NavCounts; metrics: any; exceptions: any[];
}): string {
  const { user, counts, metrics, exceptions } = input;
  const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

  const body = html`
    <div class="grid grid-kpi">
      ${kpiCard({ label: 'Inventory freshness', value: pct(metrics.fresh, metrics.total),
                  sub: `${metrics.fresh} of ${metrics.total} accounts`,
                  tone: metrics.total > 0 && metrics.fresh / metrics.total < 0.5 ? 'attention' : 'default' })}
      ${kpiCard({ label: 'Website researched', value: pct(metrics.withWebsite, metrics.total),
                  sub: `${metrics.withWebsite} have a resolved site` })}
      ${kpiCard({ label: 'Named decision maker', value: pct(metrics.namedDm, metrics.total),
                  sub: `${metrics.roleOnly} role-route only` })}
      ${kpiCard({ label: 'Direct route coverage', value: pct(metrics.directRoute, metrics.total),
                  sub: 'endpoints published as direct' })}
    </div>

    <div style="height:18px"></div>

    <div class="grid grid-two">
      <div class="card">
        <div class="card-head"><h2>Freshness distribution</h2></div>
        <div class="card-pad">
          ${bar('Fresh', metrics.fresh, metrics.total, 'success')}
          ${bar('Aging', metrics.aging, metrics.total, 'warning')}
          ${bar('Stale', metrics.stale, metrics.total, 'stale')}
          ${bar('Never researched', metrics.never, metrics.total, 'neutral')}
          <p class="micro muted" style="margin-top:12px">
            Stale means refresh before relying on it, not that the fact is false.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Contact route quality</h2></div>
        <div class="card-pad">
          ${bar('Direct line or named email', metrics.directRoute, metrics.total, 'success')}
          ${bar('Named person via main line', metrics.namedViaMain, metrics.total, 'info')}
          ${bar('Role route only', metrics.roleOnly, metrics.total, 'warning')}
          ${bar('No usable contact', metrics.noContact, metrics.total, 'destructive')}
          <p class="micro muted" style="margin-top:12px">
            A role route is a usable record, not a failure.
          </p>
        </div>
      </div>
    </div>

    <div style="height:18px"></div>

    <div class="card">
      <div class="card-head">
        <h2>Data quality exceptions</h2>
        <span class="muted small">${pluralize(exceptions.length, 'exception')}</span>
      </div>
      ${exceptions.length === 0
        ? emptyState({ title: 'No exceptions', explanation: 'Nothing needs a human decision right now.' })
        : html`<div class="table-wrap">
            <table class="data">
              <thead><tr><th>Company</th><th>Exception</th><th>Detail</th><th>Since</th><th></th></tr></thead>
              <tbody>
                ${exceptions.map((row: any) => html`<tr>
                  <td class="cell-company">${row.company_name}</td>
                  <td>${statusPill(titleCase(row.exception_type),
                    row.exception_type === 'provider_failure' ? 'destructive' : 'warning')}</td>
                  <td class="cell-why" title="${row.detail}">${row.detail}</td>
                  <td class="muted small">${relativeTime(row.since)}</td>
                  <td><a class="btn btn-secondary btn-sm" href="/accounts/${row.account_id}">Open</a></td>
                </tr>`)}
              </tbody>
            </table>
          </div>`}
    </div>

    <p class="muted small" style="margin-top:14px">
      This page diagnoses data quality, not sales performance.
    </p>`;

  return renderPage({
    title: 'Research Health',
    subtitle: 'Is the research trustworthy enough to act on?',
    user, currentPath: '/research-health', counts, body,
  });
}

function bar(label: string, value: number, total: number, tone: string): RawHtml {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return html`<div class="metric-bar">
    <div class="metric-bar-head"><span>${label}</span><span class="muted">${value} · ${percent}%</span></div>
    <div class="metric-bar-track"><div class="metric-bar-fill fill-${tone}" style="width:${percent}%"></div></div>
  </div>`;
}

// ------------------------------------------------------------------- Imports

export function renderImportsPage(input: {
  user: SessionUser; counts: NavCounts; history: any[]; flash?: string | null; error?: string | null;
}): string {
  const { user, counts, history, flash, error } = input;

  const body = html`
    ${flash ? html`<div class="coverage-note info" style="margin-bottom:16px">${flash}</div>` : ''}
    ${error ? html`<div class="callout callout-danger" style="margin-bottom:16px">${error}</div>` : ''}

    <div class="grid grid-market">
      <form class="card card-pad import-source" method="post" action="/imports/upload"
            enctype="multipart/form-data">
        <h3>CSV upload</h3>
        <p class="muted small">A spreadsheet exported from anywhere. Columns are matched
           automatically and you review the result before anything is written.</p>
        <div class="field" style="margin:12px 0">
          <label for="sourceName">What is this list?</label>
          <input id="sourceName" name="sourceName" type="text" required
                 placeholder="e.g. airtable-brent-2026-09">
        </div>
        <div class="field" style="margin-bottom:12px">
          <label for="sourceKind">Where did it come from?</label>
          <select id="sourceKind" name="sourceKind">
            <option value="csv">Generic CSV</option>
            <option value="airtable_export">Airtable export</option>
            <option value="apollo_export">Apollo export</option>
            <option value="prior_yad_list">Prior YAD list</option>
            <option value="other">Other approved source</option>
          </select>
        </div>
        <div class="field" style="margin-bottom:14px">
          <label for="file">File</label>
          <input id="file" name="file" type="file" accept=".csv,text/csv,text/plain" required>
        </div>
        <button class="btn btn-primary" type="submit">Upload and review</button>
        <p class="micro muted" style="margin:12px 0 0">
          Nothing is imported until you confirm, and importing never starts outreach.
        </p>
      </form>

      <div class="card card-pad">
        <h3>What happens next</h3>
        <ol class="plain-list numbered" style="margin-top:10px">
          <li>Columns are matched to the canonical fields.</li>
          <li>You review the normalization and correct the mapping.</li>
          <li>You see which rows create a new company and which merge into one we already have.</li>
          <li>Suppressed companies and other reps' accounts are called out before you commit.</li>
          <li>You confirm, and the rows enter shared inventory as unclaimed.</li>
        </ol>
      </div>
    </div>

    <div style="height:18px"></div>

    <div class="card">
      <div class="card-head"><h2>Import history</h2></div>
      ${history.length === 0
        ? emptyState({ title: 'No imports yet', explanation: 'Uploaded lists appear here with their results.' })
        : html`<div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>Source</th><th>File</th><th>Rows</th><th>Created</th><th>Merged</th>
                <th>Rejected</th><th>Suppressed</th><th>By</th><th>When</th>
              </tr></thead>
              <tbody>
                ${history.map((row: any) => html`<tr>
                  <td class="cell-company">${row.source_name}
                    <div class="micro muted">${titleCase(row.source_kind)}</div></td>
                  <td class="muted small">${row.file_name ?? '—'}</td>
                  <td>${row.row_count}</td>
                  <td>${row.accounts_created}</td>
                  <td>${row.accounts_matched}</td>
                  <td>${row.rows_rejected > 0
                    ? statusPill(String(row.rows_rejected), 'warning') : '0'}</td>
                  <td>${row.rows_suppressed > 0
                    ? statusPill(String(row.rows_suppressed), 'destructive') : '0'}</td>
                  <td class="muted small">${row.imported_by ?? '—'}</td>
                  <td class="muted small">${relativeTime(row.created_at)}</td>
                </tr>`)}
              </tbody>
            </table>
          </div>`}
    </div>`;

  return renderPage({
    title: 'Imports & Data Sources',
    subtitle: 'Bring an existing list into the same canonical Account model.',
    user, currentPath: '/imports', counts, body,
  });
}

const CANONICAL_FIELDS: { key: string; label: string }[] = [
  { key: 'company', label: 'Company name' },
  { key: 'domain', label: 'Website' },
  { key: 'phone', label: 'Business phone' },
  { key: 'direct_phone', label: 'Direct phone' },
  { key: 'email', label: 'Email' },
  { key: 'contact_name', label: 'Contact name' },
  { key: 'contact_first_name', label: 'First name' },
  { key: 'contact_last_name', label: 'Last name' },
  { key: 'contact_title', label: 'Title' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'postal_code', label: 'ZIP / postal code' },
  { key: 'industry', label: 'Industry' },
  { key: 'provider_id', label: 'Source record ID' },
  { key: 'notes', label: 'Notes' },
];

const OUTCOME_TONE: Record<string, Parameters<typeof statusPill>[1]> = {
  CREATE: 'success', MERGE: 'info', REJECT: 'warning',
  SUPPRESSED: 'destructive', OWNED_BY_OTHER: 'review',
};
const OUTCOME_LABEL: Record<string, string> = {
  CREATE: 'New', MERGE: 'Merge', REJECT: 'Skipped',
  SUPPRESSED: 'Suppressed', OWNED_BY_OTHER: 'Owned',
};

export function renderImportWizardPage(input: {
  user: SessionUser; counts: NavCounts; session: SessionSummary;
  preview: ImportPreview | null; verticals: { id: string; displayName: string }[];
}): string {
  const { user, counts, session, preview, verticals } = input;

  const body = html`
    <div class="wizard-steps">
      ${['Upload', 'Map columns', 'Review', 'Confirm'].map((label, index) => {
        const current = preview ? 2 : 1;
        const state = index < current ? 'done' : index === current ? 'active' : 'todo';
        return html`<div class="wizard-step wizard-${state}">
          <span class="wizard-num">${index + 1}</span><span>${label}</span></div>`;
      })}
    </div>

    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(280px,340px);align-items:start">
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <h2>Column mapping</h2>
            <span class="muted small">${pluralize(session.rowCount, 'row')} in ${session.fileName ?? 'the file'}</span>
          </div>
          <form class="card-pad" method="post" action="/imports/${session.importSessionId}/map">
            <div class="mapping-grid">
              ${CANONICAL_FIELDS.map((field) => html`
                <div class="field">
                  <label for="map_${field.key}">${field.label}</label>
                  <select id="map_${field.key}" name="map_${field.key}">
                    <option value="">— not in this file —</option>
                    ${session.headers.map((header) => html`
                      <option value="${header}"${
                        raw((session.columnMap as Record<string, string>)[field.key] === header ? ' selected' : '')
                      }>${header}</option>`)}
                  </select>
                </div>`)}
            </div>
            <div class="field" style="margin-top:14px;max-width:320px">
              <label for="defaultVertical">Industry for every row (optional)</label>
              <select id="defaultVertical" name="defaultVertical">
                <option value="">Use each row's own industry column</option>
                ${verticals.map((vertical) => html`
                  <option value="${vertical.id}">${vertical.displayName}</option>`)}
              </select>
            </div>
            ${session.unmappedHeaders.length > 0 ? html`
              <p class="micro muted" style="margin-top:12px">
                Kept as raw data only: ${session.unmappedHeaders.join(', ')}
              </p>` : ''}
            <button class="btn btn-primary btn-sm" type="submit" style="margin-top:14px">
              ${preview ? 'Re-check with this mapping' : 'Check this mapping'}
            </button>
          </form>
        </div>

        ${preview ? html`
        <div class="card">
          <div class="card-head">
            <h2>What confirming would do</h2>
            <span class="muted small">${pluralize(preview.rows.length, 'row')} previewed</span>
          </div>
          <div class="card-pad">
            <div class="row" style="gap:8px;flex-wrap:wrap">
              ${statusPill(`${preview.totals.create} new`, 'success')}
              ${statusPill(`${preview.totals.merge} merge`, 'info')}
              ${preview.totals.ownedByOther > 0
                ? statusPill(`${preview.totals.ownedByOther} owned by another rep`, 'review') : ''}
              ${preview.totals.suppressed > 0
                ? statusPill(`${preview.totals.suppressed} suppressed`, 'destructive') : ''}
              ${preview.totals.reject > 0
                ? statusPill(`${preview.totals.reject} skipped`, 'warning') : ''}
            </div>
            ${preview.qualityNotes.length > 0 ? html`
              <ul class="plain-list" style="margin-top:12px">
                ${preview.qualityNotes.map((note) => html`<li class="muted small">${note}</li>`)}
              </ul>` : ''}
          </div>
          <div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>Line</th><th>Company</th><th>Contact</th><th>Phone</th>
                <th>Email</th><th>Where</th><th>Outcome</th><th>Detail</th>
              </tr></thead>
              <tbody>
                ${preview.rows.slice(0, 60).map((row) => html`<tr>
                  <td class="muted micro">${row.line}</td>
                  <td class="cell-company">${row.company ?? '—'}</td>
                  <td class="muted small">${row.contact ?? '—'}</td>
                  <td class="muted small">${row.phone ?? '—'}</td>
                  <td class="muted small">${row.email ?? '—'}</td>
                  <td class="muted small">${row.geography ?? '—'}</td>
                  <td>${statusPill(OUTCOME_LABEL[row.outcome] ?? row.outcome,
                    OUTCOME_TONE[row.outcome] ?? 'neutral')}</td>
                  <td class="cell-why" title="${row.detail ?? ''}">${row.detail ?? ''}</td>
                </tr>`)}
              </tbody>
            </table>
          </div>
        </div>` : ''}
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Confirm</h2></div>
          <div class="card-pad">
            ${!preview
              ? html`<p class="muted small" style="margin:0">Check the mapping first, then review
                       what the import would do.</p>`
              : html`
                <p class="small">Confirming writes ${preview.totals.create} new accounts and merges
                   ${preview.totals.merge} into companies already in the system.</p>
                <p class="micro muted">Suppressed companies stay suppressed. Accounts owned by another
                   rep keep their owner. No outreach is scheduled.</p>
                <form method="post" action="/imports/${session.importSessionId}/confirm" style="margin-top:14px">
                  <button class="btn btn-primary" type="submit" style="width:100%">
                    Import ${pluralize(session.rowCount, 'row')}
                  </button>
                </form>`}
            <form method="post" action="/imports/${session.importSessionId}/cancel" style="margin-top:8px">
              <button class="btn btn-ghost btn-sm" type="submit" style="width:100%">Discard this upload</button>
            </form>
          </div>
        </div>
      </div>
    </div>`;

  return renderPage({
    title: session.sourceName,
    subtitle: 'Review before anything is written.',
    breadcrumbs: [{ href: '/imports', label: 'Imports' }, { href: '#', label: session.sourceName }],
    user, currentPath: '/imports', counts, body,
  });
}

export { confirmDialog, errorState, tierBadge, timeline, formatDateTime };
