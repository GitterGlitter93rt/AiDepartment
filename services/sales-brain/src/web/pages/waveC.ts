import { html, raw, type RawHtml } from '../html.js';
import { renderPage } from '../layout.js';
import type { NavCounts } from '../components/shell.js';
import {
  confirmDialog, emptyState, errorState, kpiCard, statusPill, tierBadge, timeline,
} from '../components/primitives.js';
import { formatDateTime, pluralize, relativeTime, titleCase } from '../format.js';
import type { SessionUser } from '../../domain/auth.js';
import type { ImportPreview, SessionSummary } from '../../import/session.js';
import type { OperationalSnapshot } from '../../api/operations.js';
import type { SemanticState } from '../components/primitives.js';
import {
  PROVIDER_STATE_LABEL, SALES_BRAIN_STATE_LABEL,
  type JobProviderTruth, type MarketDiscoveryRow, type MiningSummary,
  type ResearchBucket, type WebsiteResearchRow, type WebsiteResearchSummary,
} from '../../api/miningView.js';

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

export type MiningTab = 'discovery' | 'website' | 'activity';

const MINING_TABS: { value: MiningTab; label: string }[] = [
  { value: 'discovery', label: 'Market Discovery' },
  { value: 'website', label: 'Website Research' },
  { value: 'activity', label: 'All Activity' },
];

export function miningTabFrom(value: string | null | undefined): MiningTab {
  return value === 'website' || value === 'activity' ? value : 'discovery';
}

/**
 * Mining.
 *
 * The page was a list of job rows, which is a list of things workers believed at the
 * moments they stopped. An operator could not read off it what market was searched,
 * what the provider was doing, what Sales Brain was doing, or whether any business
 * had come of it — and for forty paid searches it said "Provider still working" about
 * results that were already in inventory.
 *
 * Three tabs now, defaulting to the one that answers "what did we search and what did
 * we get". Market Discovery is one row per paid search; Website Research aggregates
 * before it enumerates; All Activity keeps the raw job history for when the question
 * really is about a job.
 */
export function renderMiningPage(input: {
  user: SessionUser; counts: NavCounts; kpis: any; tab: MiningTab;
  summary: MiningSummary;
  discovery: MarketDiscoveryRow[];
  website: WebsiteResearchSummary | null;
  websiteBucket: ResearchBucket | null;
  websiteRows: WebsiteResearchRow[];
  jobs: any[];
  jobProviderTruth: Map<string, JobProviderTruth>;
}): string {
  const { user, counts, kpis, tab, summary } = input;

  const body = html`
    ${discoveryBanner(kpis)}
    ${miningSummaryStrip(summary)}

    <div class="chips" style="margin:16px 0">
      ${MINING_TABS.map((entry) => html`
        <a class="chip" href="/mining?tab=${entry.value}"
           aria-pressed="${tab === entry.value ? 'true' : 'false'}">${entry.label}</a>`)}
    </div>

    ${tab === 'discovery' ? marketDiscoverySection(input.discovery, kpis) : ''}
    ${tab === 'website'
      ? websiteResearchSection(input.website, input.websiteBucket, input.websiteRows)
      : ''}
    ${tab === 'activity' ? allActivitySection(input.jobs, input.jobProviderTruth) : ''}`;

  return renderPage({
    title: 'Mining',
    subtitle: 'Keep prospect inventory fresh without interrupting reps.',
    user, currentPath: '/mining', counts, body,
  });
}

/**
 * The seven numbers above the tabs.
 *
 * Provider work and our work are separate cards on purpose. "Waiting on Sales Brain"
 * is the one that never existed before: a search that is paid for, answered, and not
 * yet in inventory was indistinguishable from one the provider was still running.
 */
function miningSummaryStrip(summary: MiningSummary): RawHtml {
  return html`
    <div class="grid grid-kpi">
      ${kpiCard({ label: 'Provider processing', value: summary.providerProcessing,
                  sub: 'paid searches not answered yet' })}
      ${kpiCard({ label: 'Waiting on Sales Brain', value: summary.waitingOnSalesBrain,
                  tone: summary.waitingOnSalesBrain > 0 ? 'attention' : 'default',
                  sub: 'answered, not collected' })}
      ${kpiCard({ label: 'Collecting', value: summary.collecting,
                  sub: 'collection running now' })}
      ${kpiCard({ label: 'Results ingested', value: summary.resultsIngested,
                  sub: `of ${summary.searchesCounted} searches on this page` })}
      ${kpiCard({ label: 'Website research queued', value: summary.websiteResearchQueued,
                  sub: 'accounts waiting to be researched' })}
      ${kpiCard({ label: 'Website research running', value: summary.websiteResearchRunning,
                  sub: 'in progress now' })}
      ${kpiCard({ label: 'Needs attention', value: summary.needsAttention,
                  tone: summary.needsAttention > 0 ? 'attention' : 'default',
                  sub: 'failed, abandoned or uncollected' })}
    </div>`;
}

// ------------------------------------------------------------ Market Discovery

function marketDiscoverySection(rows: MarketDiscoveryRow[], kpis: any): RawHtml {
  return html`
    <div class="grid grid-kpi" style="margin-bottom:16px">
      ${kpiCard({ label: 'Discovered by the miner', value: kpis.discoveredByMinerToday,
                  tone: kpis.discoveredByMinerToday > 0 ? 'good' : 'default',
                  sub: 'new businesses found today' })}
      ${kpiCard({ label: 'Re-researched by a worker', value: kpis.refreshedByWorkerToday,
                  sub: 'completed research runs today' })}
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Market searches</h2>
        <span class="muted small">
          One row per search. Provider state comes from the paid-task ledger; Sales
          Brain state is what we have done with the answer.
        </span>
      </div>
      ${rows.length === 0
        ? emptyState({
            title: 'No market searches yet',
            explanation: 'A row appears here when a market search is submitted, whether or not the provider has answered.',
            action: { href: '/markets', label: 'Browse markets' },
          })
        : html`<div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>Industry</th><th>Geography</th><th>Keyword</th><th>Requested by</th>
                <th>Provider</th><th>Sales Brain</th><th>Submitted</th><th>Collected</th>
                <th>Rows returned</th><th>Duplicates</th><th>Resolved businesses</th>
                <th>New businesses</th><th>Matched existing</th><th>Existing refreshed</th>
                <th>Rejected</th>
                <th>Needs review</th><th>Spend</th><th>Outcome</th>
              </tr></thead>
              <tbody>
                ${rows.map((row) => html`<tr>
                  <td class="cell-company">${row.verticalProfileId ?? '—'}</td>
                  <td>${row.geography ?? row.marketName ?? '—'}
                      ${row.geographyType
                        ? html`<span class="micro muted"> ${row.geographyType}</span>` : ''}</td>
                  <td class="muted small">${row.keyword ?? row.term ?? '—'}</td>
                  <td class="muted small">${row.requestedBy ?? 'scheduler'}</td>
                  <td>${providerStatePill(row)}</td>
                  <td>${salesBrainStatePill(row)}</td>
                  <td class="muted small">${row.submittedAt ? relativeTime(row.submittedAt) : '—'}</td>
                  <td class="muted small">
                    ${row.providerCollectedAt ? relativeTime(row.providerCollectedAt) : '—'}</td>
                  <td>${count(row.rowsReturned)}</td>
                  <td>${count(row.duplicateRows)}</td>
                  <td>${count(row.resolvedBusinesses)}</td>
                  <td>${row.newBusinesses == null
                        ? html`<span class="muted small">—</span>`
                        : html`<strong>${row.newBusinesses}</strong>`}</td>
                  <td>${count(row.matchedExisting)}</td>
                  <td>${count(row.existingRefreshed)}</td>
                  <td>${count(row.rejectedEntities)}</td>
                  <td>${row.needsReview == null
                        ? html`<span class="muted small">—</span>`
                        : html`${row.needsReview}${row.needsReviewIsRunWide
                            ? html`<span class="micro muted" title="This run ingested several searches, so the figure covers all of them."> (run)</span>`
                            : ''}`}</td>
                  <td class="muted small">${row.spendUsd == null
                        ? html`<span title="No charge is recorded for this search.">—</span>`
                        : `$${row.spendUsd.toFixed(4)}`}</td>
                  <td>${searchOutcomePill(row)}</td>
                </tr>
                ${row.reason || row.rowsReturned ? html`<tr>
                  <td colspan="18" class="micro muted" style="padding-top:0">
                    ${row.providerTaskId
                      ? html`<span title="The provider's own task id.">${row.providerTaskId}</span>`
                      : ''}${row.providerTaskId && row.reason ? ' · ' : ''}${row.reason ?? ''}${
                      searchFunnelLine(row)}
                  </td>
                </tr>` : ''}`)}
              </tbody>
            </table>
          </div>`}
    </div>

    <div style="height:18px"></div>

    <div class="card">
      <div class="card-head">
        <h2>Where today’s accounts came from</h2>
        <span class="muted small">${kpis.createdTodayTotal} created in the last 24 hours</span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Source</th><th>Accounts</th><th>Is this mining output?</th></tr></thead>
          <tbody>
            <tr><td>Discovered by a search provider</td>
                <td><strong>${kpis.discoveredByMinerToday}</strong></td>
                <td class="muted small">Yes.</td></tr>
            <tr><td>Imported from a list</td>
                <td>${kpis.importedToday}</td>
                <td class="muted small">No. A person uploaded these.</td></tr>
            <tr><td>Synthetic or demo fixture</td>
                <td>${kpis.syntheticSeededToday}</td>
                <td class="muted small">No. These are test data and are not prospects.</td></tr>
            <tr><td>Created another way</td>
                <td>${kpis.manuallyAddedToday}</td>
                <td class="muted small">No. Added by hand or by another path.</td></tr>
          </tbody>
        </table>
      </div>
      <div class="card-pad micro muted">
        Research timestamps were refreshed on ${kpis.freshTimestampToday} account(s) in
        the last 24 hours; ${kpis.refreshedByWorkerToday} of those came from a research
        run that actually completed. A seeded or imported timestamp is not a refresh.
      </div>
    </div>`;
}

/**
 * The arithmetic between what the provider sent and what reached inventory.
 *
 * The columns carry the same numbers; this restates them in their units, because
 * "5 provider rows became 1 new Account" is either good dedupe or a broken filter and
 * the only way to tell is to see the steps in between named.
 */
function searchFunnelLine(row: MarketDiscoveryRow): RawHtml {
  const rows = row.rowsReturned ?? 0;
  if (rows === 0) return raw('');
  const parts = [
    `${rows} provider row(s)`,
    (row.duplicateRows ?? 0) > 0 ? `${row.duplicateRows} duplicate` : null,
    (row.rejectedEntities ?? 0) > 0 ? `${row.rejectedEntities} unusable` : null,
    `${row.matchedExisting ?? 0} already held`,
    `${row.newBusinesses ?? 0} new`,
  ].filter(Boolean) as string[];
  return html` <span class="micro">· ${parts.join(' → ')}</span>`;
}

function count(value: number | null): RawHtml {
  // A dash, not a zero. Zero is a measurement; "we never got there" is not.
  return value == null ? html`<span class="muted small">—</span>` : html`${value}`;
}

/** The ledger's word, never a job's. */
function providerStatePill(row: MarketDiscoveryRow): RawHtml {
  const label = PROVIDER_STATE_LABEL[row.providerState];
  if (row.providerState === 'COLLECTED') return statusPill(label, 'success');
  if (row.providerState === 'PENDING') return statusPill(label, 'info');
  if (row.providerState === 'ABANDONED') return statusPill(label, 'warning');
  if (row.providerState === 'FAILED') return statusPill(label, 'destructive');
  return statusPill(label, 'neutral');
}

function salesBrainStatePill(row: MarketDiscoveryRow): RawHtml {
  const label = SALES_BRAIN_STATE_LABEL[row.salesBrainState];
  switch (row.salesBrainState) {
    case 'INGESTED': return statusPill(label, 'success');
    case 'COLLECTING': return statusPill(label, 'info');
    case 'AWAITING_PROVIDER': return statusPill(label, 'neutral');
    case 'COLLECTED_NOT_INGESTED': return statusPill(label, 'review');
    case 'ABANDONED': return statusPill(label, 'warning');
    case 'PROVIDER_FAILED': return statusPill(label, 'destructive');
    default: return statusPill(label, 'blocked');
  }
}

/**
 * What the search achieved, in the words the rest of the product uses.
 *
 * Derived from the search rather than from its job, so a run that bought four
 * searches no longer describes all four with one verdict.
 */
function searchOutcomePill(row: MarketDiscoveryRow): RawHtml {
  if (row.salesBrainState === 'NOT_SEARCHED') {
    if (row.jobOutcome === 'MARKET_DISABLED') {
      return statusPill('Market switched off — not searched', 'neutral');
    }
    if (row.jobOutcome === 'PROVIDER_UNAVAILABLE') {
      return statusPill('Provider unavailable', 'destructive');
    }
    // Includes our own daily ceiling: the search was refused before it was bought.
    return statusPill('Could not search', 'warning');
  }
  if (row.salesBrainState === 'ABANDONED') return statusPill('Paid, never collected', 'warning');
  if (row.salesBrainState === 'PROVIDER_FAILED') return statusPill('Failed', 'destructive');
  if (row.salesBrainState !== 'INGESTED') return statusPill('In flight', 'info');
  if (row.searchStatus === 'MALFORMED') {
    return statusPill('Answer could not be read', 'destructive');
  }
  if ((row.newBusinesses ?? 0) > 0) return statusPill('Found new businesses', 'success');
  if ((row.matchedExisting ?? 0) > 0) {
    return statusPill('Searched, all already held', 'neutral');
  }
  return statusPill('Searched, found nothing new', 'neutral');
}

// ------------------------------------------------------------ Website Research

const RESEARCH_BUCKET_LABEL: Record<ResearchBucket, string> = {
  queued: 'Queued', running: 'Running', completed: 'Completed',
  blocked: 'Blocked', source_unavailable: 'Source unavailable', failed: 'Failed',
};

function websiteResearchSection(
  summary: WebsiteResearchSummary | null, bucket: ResearchBucket | null,
  rows: WebsiteResearchRow[],
): RawHtml {
  if (!summary) return emptyState({ title: 'No website research yet', explanation: 'Research runs appear here once accounts are queued for it.' });

  // Each aggregate is the way into its own drill-down, which is what keeps a hundred
  // "Researching website" rows off the page an operator opens.
  const card = (key: ResearchBucket, value: number, sub: string): RawHtml =>
    kpiCard({
      label: RESEARCH_BUCKET_LABEL[key], value,
      sub: bucket === key ? `${sub} · showing below` : sub,
      href: `/mining?tab=website&bucket=${key}`,
      tone: (key === 'failed' || key === 'blocked' || key === 'source_unavailable')
        && value > 0 ? 'attention' : 'default',
    });

  return html`
    <div class="card">
      <div class="card-head">
        <h2>Website research</h2>
        <span class="muted small">
          ${summary.total} run(s) recorded. A run that finished is not a site that was read.
        </span>
      </div>
      <div class="card-pad">
        <div class="grid grid-kpi">
          ${card('queued', summary.queued, 'waiting for a worker')}
          ${card('running', summary.running, 'in progress now')}
          ${card('completed', summary.completed, 'the site was read')}
          ${card('blocked', summary.blocked, 'a page refused us')}
          ${card('source_unavailable', summary.sourceUnavailable, 'nothing could be read')}
          ${card('failed', summary.failed, 'the job itself failed')}
        </div>
        <p class="micro muted" style="margin:12px 0 0">
          ${summary.completedWithSomeBlocked} completed run(s) still had at least one page
          refused, so "completed" does not mean the whole site was readable.
        </p>
      </div>
    </div>

    <div style="height:18px"></div>

    ${bucket
      ? html`<div class="card">
          <div class="card-head">
            <h2>${RESEARCH_BUCKET_LABEL[bucket]}</h2>
            <span class="muted small">${rows.length} shown</span>
          </div>
          ${rows.length === 0
            ? emptyState({ title: 'Nothing in this state', explanation: 'No research run is currently in this state.' })
            : html`<div class="table-wrap">
                <table class="data">
                  <thead><tr>
                    <th>Company</th><th>State</th><th>Pages read</th><th>Pages refused</th>
                    <th>When</th><th>Detail</th>
                  </tr></thead>
                  <tbody>
                    ${rows.map((row) => html`<tr>
                      <td class="cell-company">${row.accountId
                        ? html`<a href="/accounts/${row.accountId}">${row.companyName ?? 'Unnamed account'}</a>`
                        : (row.companyName ?? '—')}</td>
                      <td>${statusPill(RESEARCH_BUCKET_LABEL[row.bucket],
                            row.bucket === 'completed' ? 'success'
                              : row.bucket === 'failed' ? 'destructive'
                              : row.bucket === 'blocked' ? 'blocked'
                              : row.bucket === 'running' ? 'info' : 'warning')}</td>
                      <td>${count(row.pagesFetched)}</td>
                      <td>${count(row.pagesBlocked)}</td>
                      <td class="muted small">${row.at ? relativeTime(row.at) : '—'}</td>
                      <td class="muted small cell-why">${row.detail ?? '—'}</td>
                    </tr>`)}
                  </tbody>
                </table>
              </div>`}
        </div>`
      : html`<p class="muted small">Choose a state above to see the accounts in it.</p>`}`;
}

// ---------------------------------------------------------------- All Activity

function allActivitySection(jobs: any[], truth: Map<string, JobProviderTruth>): RawHtml {
  return html`
    <div class="card">
      <div class="card-head">
        <h2>All activity</h2>
        <span class="muted small">Every job, newest first — the raw history behind the tabs above</span>
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
                <th>New businesses</th><th>Existing refreshed</th>
                <th>What happened</th><th>Requested by</th>
              </tr></thead>
              <tbody>
                ${jobs.map((job: any) => html`<tr>
                  <td class="cell-company">${JOB_STAGE_LABEL[job.job_type] ?? titleCase(job.job_type)}</td>
                  <td class="muted small">${job.market_name ?? job.geography ?? '—'}</td>
                  <td>${jobStagePill(job)}</td>
                  <td class="muted small">${job.started_at ? relativeTime(job.started_at) : 'not started'}</td>
                  <td>${discoveredCell(job)}</td>
                  <td class="muted small">${job.refresh_queued ?? 0}</td>
                  <td>${outcomePill(job, truth.get(job.job_id) ?? null)}</td>
                  <td class="muted small">${job.requested_by_name ?? 'system'}</td>
                </tr>
                ${job.outcome_reason ? html`<tr>
                  <td colspan="8" class="micro muted" style="padding-top:0">
                    ${job.outcome_reason}${funnelLine(job)}
                  </td>
                </tr>` : ''}
                ${job.last_error ? html`<tr class="job-error-row">
                  <td colspan="8" class="micro" style="color:var(--crimson)">
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
}

function jobStagePill(job: any): RawHtml {
  if (job.status === 'RUNNING') return statusPill('In progress', 'info');
  if (job.status === 'QUEUED') return statusPill('Queued', 'neutral');
  if (job.status === 'SUCCEEDED') return statusPill('Scoring / saved', 'success');
  if (job.status === 'FAILED') return statusPill('Needs review', 'destructive');
  return statusPill(titleCase(job.status), 'neutral');
}

/**
 * What the job achieved, not whether it returned.
 *
 * "Succeeded" was true of every market search ever run, including the ones that
 * could not search: with no provider registered there is nothing to ask, and a
 * person reading "Succeeded — 0 found" concluded the market was empty.
 */
const JOB_OUTCOME_LABEL: Record<string, { label: string; tone: SemanticState }> = {
  COMPLETED: { label: 'Found new businesses', tone: 'success' },
  ZERO_RESULTS: { label: 'Searched, found nothing new', tone: 'neutral' },
  NOTHING_TO_DO: { label: 'Nothing needed doing', tone: 'neutral' },
  DISCOVERY_BLOCKED: { label: 'Could not search', tone: 'warning' },
  PROVIDER_UNAVAILABLE: { label: 'Provider unavailable', tone: 'destructive' },
  PARTIAL: { label: 'Partly searched', tone: 'warning' },
  PROVIDER_PENDING: { label: 'Provider still working', tone: 'info' },
  // Neutral, not a warning: nothing went wrong, an operator switched the market off.
  // Without an entry here it fell through to the bare "Ran" pill, which is the
  // sentence this whole map exists to stop.
  MARKET_DISABLED: { label: 'Market switched off — not searched', tone: 'neutral' },
  FAILED: { label: 'Failed', tone: 'destructive' },
};

/**
 * What the job was told, corrected by what the ledger has since recorded.
 *
 * A `market_mine` run that bought an asynchronous search ends before the answer
 * exists and records PROVIDER_PENDING for ever. Forty production rows say "Provider
 * still working" about searches DataForSEO finished days ago, whose results are in
 * inventory. The job's own outcome is not rewritten -- it was true when it was
 * written -- but the sentence a person reads is the current one.
 */
function outcomePill(job: any, truth: JobProviderTruth | null): RawHtml {
  if (job.status === 'RUNNING') return statusPill('Running', 'info');
  if (job.status === 'QUEUED') return statusPill('Queued', 'neutral');
  if (job.status === 'CANCELLED') return statusPill('Cancelled', 'neutral');
  if (job.outcome === 'PROVIDER_PENDING' && truth && truth.outstanding === 0) {
    if (truth.collected > 0) {
      return statusPill('Provider finished — collected since', 'success',
        'This run ended before the provider answered. The paid-task ledger records the '
        + 'answer as collected afterwards.');
    }
    if (truth.abandoned > 0) {
      return statusPill('Provider never delivered', 'warning',
        'The paid task was given up on: its result is no longer retrievable.');
    }
    if (truth.failed > 0) return statusPill('Provider failed', 'destructive');
  }
  const outcome = job.outcome ? JOB_OUTCOME_LABEL[job.outcome] : null;
  if (outcome) return statusPill(outcome.label, outcome.tone);
  // A job that ran before outcomes existed. Saying "succeeded" is the thing this
  // column was built to stop, so it says what it can honestly say.
  return statusPill(job.status === 'FAILED' ? 'Failed' : 'Ran', 
    job.status === 'FAILED' ? 'destructive' : 'neutral');
}

/**
 * The arithmetic between what the provider sent and what reached inventory.
 *
 * A single "new businesses" number cannot be checked. Fifty rows becoming
 * twenty-five Accounts is either good dedupe or a broken filter, and the operator
 * can only tell which if the four numbers in between are on the page.
 */
function funnelLine(job: any): RawHtml {
  const rows = Number(job.provider_rows ?? 0);
  if (rows === 0) return raw('');
  const parts = [
    `${rows} provider row(s)`,
    Number(job.provider_duplicates ?? 0) > 0 ? `${job.provider_duplicates} duplicate` : null,
    Number(job.rejected_rows ?? 0) > 0 ? `${job.rejected_rows} unusable` : null,
    `${job.matched_existing ?? 0} already held`,
    `${job.discovered_new ?? 0} new`,
    Number(job.research_queued ?? 0) > 0 ? `${job.research_queued} queued for research` : null,
    job.cost_usd != null ? `$${Number(job.cost_usd).toFixed(4)}` : null,
  ].filter(Boolean) as string[];
  return html` <span class="micro">· ${parts.join(' → ')}</span>`;
}

function discoveredCell(job: any): RawHtml {
  if (job.job_type === 'zip_research') {
    return html`<span class="muted small" title="This job only refreshes accounts we already hold.">not searched</span>`;
  }
  if (job.outcome === 'DISCOVERY_BLOCKED' || job.outcome === 'PROVIDER_UNAVAILABLE'
      || job.outcome === 'MARKET_DISABLED') {
    // A dash, not a zero. "0 new" is a claim about the market; nobody looked.
    return html`<span class="muted small">—</span>`;
  }
  return html`<strong>${job.discovered_new ?? 0}</strong>`;
}

/**
 * The banner an operator needs above everything else on this page: whether the
 * system can find a new business at all.
 */
function discoveryBanner(kpis: any): RawHtml {
  if (kpis.discoveryAvailable) return raw('');
  return html`
    <div class="callout callout-warn">
      <strong>New-business discovery is not available.</strong>
      <p style="margin:6px 0 0">
        No search provider is configured, so a market search can only re-research
        companies already in inventory. It cannot find a business we do not already
        have, and a market that returns nothing new is not evidence that the market
        is empty.
        ${kpis.discoveryBlockedJobsToday > 0
          ? html`${kpis.discoveryBlockedJobsToday} job(s) in the last 24 hours were
                 limited by this.`
          : ''}
      </p>
    </div>
    <div style="height:14px"></div>`;
}

// ----------------------------------------------------------- Research Health

export function renderResearchHealthPage(input: {
  user: SessionUser; counts: NavCounts; metrics: any; exceptions: any[];
  operations?: OperationalSnapshot | null;
}): string {
  const { user, counts, metrics, exceptions } = input;
  const pct = (n: number, d: number): string => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

  const body = html`
    ${operationsPanel(input.operations ?? null)}
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


/**
 * The operator's Monday morning.
 *
 * One panel that answers whether anything is broken, backing up, going stale or
 * quietly armed, using the same tables every other page reads. Not a second
 * monitoring product: a question with an answer next to it, and the reason the
 * answer matters where it is not obvious.
 */
function operationsPanel(snapshot: OperationalSnapshot | null): RawHtml {
  if (!snapshot) return raw('');
  const tone: Record<string, SemanticState> = {
    OK: 'success', ATTENTION: 'warning', BLOCKED: 'destructive', UNKNOWN: 'neutral',
  };
  const attention = snapshot.counts.ATTENTION + snapshot.counts.BLOCKED;

  // The worst state on each axis, so an operator reads eight independent answers
  // rather than one light that is true of nothing in particular. A green database
  // has never meant a working miner.
  const RANK: Record<string, number> = { OK: 0, UNKNOWN: 1, ATTENTION: 2, BLOCKED: 3 };
  const DIMENSION_LABEL: Record<string, string> = {
    DATABASE: 'Database', SCHEMA: 'Schema', WORKER: 'Worker', QUEUE: 'Queue',
    DISCOVERY_PROVIDER: 'Discovery provider', PROVIDER_TASKS: 'Provider tasks',
    RESEARCH: 'Research', SAVED_MARKETS: 'Saved markets', SPEND: 'Spend',
    INVENTORY: 'Inventory',
    SALES: 'Sales', COMPLIANCE: 'Compliance',
  };
  const worst = new Map<string, string>();
  for (const check of snapshot.checks) {
    const held = worst.get(check.dimension);
    if (!held || (RANK[check.state] ?? 0) > (RANK[held] ?? 0)) {
      worst.set(check.dimension, check.state);
    }
  }

  return html`
    <div class="card">
      <div class="card-head">
        <h2>Operations</h2>
        <span class="muted small">${attention === 0
          ? 'Nothing needs attention.'
          : `${attention} thing${attention === 1 ? ' needs' : 's need'} attention.`}</span>
      </div>
      <div class="card-pad" style="padding-bottom:0">
        <div class="row" style="gap:8px;flex-wrap:wrap">
          ${[...worst.entries()].map(([dimension, state]) => html`<span
            class="badge badge-${tone[state] === 'success' ? 'ok'
              : tone[state] === 'destructive' ? 'bad' : tone[state] === 'warning' ? 'warn' : 'neutral'}"
            title="${DIMENSION_LABEL[dimension] ?? dimension}: ${state.toLowerCase()}"
            >${DIMENSION_LABEL[dimension] ?? dimension}: ${state.toLowerCase()}</span>`)}
        </div>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Question</th><th>Answer</th><th>State</th><th>Why it matters</th></tr></thead>
          <tbody>
            ${snapshot.checks.map((check) => html`<tr>
              <td>${check.question}</td>
              <td><strong>${check.value}</strong></td>
              <td>${statusPill(check.state.toLowerCase(), tone[check.state] ?? 'neutral')}</td>
              <td class="muted small">${check.detail ?? ''}</td>
            </tr>`)}
          </tbody>
        </table>
      </div>
    </div>
    <div style="height:18px"></div>`;
}
