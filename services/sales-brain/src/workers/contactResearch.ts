import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { researchFirstParty } from '../resolver/adapters/firstParty.js';
import { reconcile } from '../resolver/reconcile.js';
import { persistResolution } from '../resolver/persist.js';
import type { EndpointObservation, PersonObservation } from '../resolver/types.js';
import { registerHandler, type JobRecord } from './runner.js';

/**
 * Contact research worker.
 * Authority: outbound-sales-brain-public-contact-research-worker-spec.md.
 *
 * Runs the PUBLIC_ONLY waterfall for one account. Stage A (the company's own site)
 * is the only stage enabled today; every later stage sits behind an adapter that
 * stays disabled until its source passes governance review. An account is never
 * blocked because a paid provider is unavailable.
 */

export interface ContactResearchOutcome {
  accountId: string;
  status: string;
  primaryPerson: string | null;
  contactPaths: number;
  pagesFetched: number;
  pagesBlocked: number;
  stagesRun: string[];
  stagesSkipped: { stage: string; reason: string }[];
}

interface AccountRow {
  account_id: string;
  canonical_name: string;
  canonical_domain: string | null;
  primary_vertical_profile_id: string | null;
  manual_tier: string | null;
}

/**
 * Research depth by tier (resolution spec §15). Public research is not free even
 * when no vendor charges for it, so depth follows the account's value.
 */
function depthFor(tier: string | null): { maxPages: number; allowPaid: boolean } {
  switch (tier) {
    case 'A': return { maxPages: 8, allowPaid: true };
    case 'B': return { maxPages: 6, allowPaid: false };
    default: return { maxPages: 3, allowPaid: false };
  }
}

export async function runContactResearch(accountId: string): Promise<ContactResearchOutcome> {
  const { rows } = await query<AccountRow>(
    `select account_id, canonical_name, canonical_domain, primary_vertical_profile_id, manual_tier
       from accounts where account_id = $1`,
    [accountId],
  );
  const account = rows[0];
  if (!account) throw new Error(`Account ${accountId} not found`);

  const stagesRun: string[] = [];
  const stagesSkipped: { stage: string; reason: string }[] = [];

  const { rows: hypothesisRows } = await query<{ category: string }>(
    `select category from opportunity_hypotheses
      where account_id = $1 and is_current order by priority asc limit 1`,
    [accountId],
  );
  const hypothesisCategory = hypothesisRows[0]?.category ?? null;

  const { rows: runRows } = await query<{ research_run_id: string }>(
    `insert into research_runs (account_id, trigger, vertical_profile_id, status)
     values ($1, 'human_requested', $2, 'running') returning research_run_id`,
    [accountId, account.primary_vertical_profile_id],
  );
  const researchRunId = runRows[0]!.research_run_id;

  const people: PersonObservation[] = [];
  const endpoints: EndpointObservation[] = [];
  let pagesFetched = 0;
  let pagesBlocked = 0;
  const notes: string[] = [];

  // --- Stage A: the company's own public pages. No credential required. --------
  // Use the URL the site was actually observed at. Rebuilding `https://<hostname>`
  // discards the scheme, the port and any path the business really uses.
  const { rows: domainRows } = await query<{ canonical_url: string | null; hostname: string }>(
    `select canonical_url, hostname from account_domains
      where account_id = $1 and domain_role = 'primary'
      order by first_seen_at limit 1`,
    [accountId],
  );
  const websiteUrl = domainRows[0]?.canonical_url
    ?? (account.canonical_domain ? `https://${account.canonical_domain}` : null);

  if (websiteUrl) {
    stagesRun.push('A_company_first_party');
    const firstParty = await researchFirstParty(websiteUrl, account.canonical_name);
    people.push(...firstParty.people);
    endpoints.push(...firstParty.endpoints);
    pagesFetched = firstParty.pagesFetched.length;
    pagesBlocked = firstParty.pagesBlocked.length;
    notes.push(...firstParty.notes);
  } else {
    stagesSkipped.push({ stage: 'A_company_first_party', reason: 'no website on record' });
  }

  // --- Stages B–D: public registries, licences, directories, search. -----------
  // Each needs a credential and a written source-governance review before it may
  // run automatically. They are wired as adapters and deliberately left off.
  for (const stage of [
    { stage: 'B_public_company_registry', reason: 'source governance review not signed off (blocker B-3)' },
    { stage: 'C_public_license_registry', reason: 'source governance review not signed off (blocker B-3)' },
    { stage: 'D_search_indexed_evidence', reason: 'no approved search provider configured (blocker B-3)' },
  ]) {
    stagesSkipped.push(stage);
  }

  // --- Stage G: prospect and gatekeeper corrections already on file. -----------
  const { rows: corrections } = await query<{
    statement_text: string; normalized_value: string | null; captured_at: Date;
  }>(
    `select statement_text, normalized_value, captured_at from prospect_statements
      where account_id = $1 and category in ('decision_maker','contact_route')
      order by captured_at desc limit 20`,
    [accountId],
  );
  if (corrections.length > 0) {
    stagesRun.push('G_prospect_gatekeeper');
    // Corrections already carry the highest source priority in the reconciler.
    notes.push(`${corrections.length} prospect/gatekeeper correction(s) applied.`);
  }

  // --- Stage H: paid enrichment. Optional, never required. ---------------------
  const depth = depthFor(account.manual_tier);
  const paidConfigured = Boolean(config.apolloApiKey) && config.contactEnrichmentMode !== 'PUBLIC_ONLY';
  if (!paidConfigured) {
    stagesSkipped.push({
      stage: 'H_paid_enrichment',
      reason: config.contactEnrichmentMode === 'PUBLIC_ONLY'
        ? 'contact_enrichment_mode is PUBLIC_ONLY'
        : 'no paid provider configured',
    });
  }

  const resolution = reconcile({
    companyName: account.canonical_name,
    verticalProfileId: account.primary_vertical_profile_id,
    hypothesisCategory,
    people,
    endpoints,
    paidEnrichmentAvailable: paidConfigured && depth.allowPaid,
  });
  resolution.notes.push(...notes);

  await withTransaction(async (client) => {
    await persistResolution(client, accountId, resolution, researchRunId);
    await client.query(
      `update research_runs set status = $2, completed_at = now(), adapter_results = $3
        where research_run_id = $1`,
      [
        researchRunId,
        pagesFetched > 0 || corrections.length > 0 ? 'completed' : 'partial',
        JSON.stringify({
          stages_run: stagesRun,
          stages_skipped: stagesSkipped,
          pages_fetched: pagesFetched,
          pages_blocked: pagesBlocked,
          resolution_status: resolution.status,
        }),
      ],
    );
  });

  return {
    accountId,
    status: resolution.status,
    primaryPerson: resolution.primary?.personName ?? null,
    contactPaths: resolution.contactPaths.length,
    pagesFetched,
    pagesBlocked,
    stagesRun,
    stagesSkipped,
  };
}

registerHandler('contact_research', async (job: JobRecord) => {
  const accountId = job.account_id ?? String(job.payload['account_id'] ?? '');
  if (!accountId) throw new Error('contact_research job has no account_id');
  return { ...(await runContactResearch(accountId)) };
});

registerHandler('account_research', async (job: JobRecord) => {
  const accountId = job.account_id ?? String(job.payload['account_id'] ?? '');
  if (!accountId) throw new Error('account_research job has no account_id');
  return { ...(await runContactResearch(accountId)) };
});
