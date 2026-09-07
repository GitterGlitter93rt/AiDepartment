import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { researchFirstParty } from '../resolver/adapters/firstParty.js';
import { reconcile } from '../resolver/reconcile.js';
import { persistResolution } from '../resolver/persist.js';
import { recordEvidence } from '../domain/accounts.js';
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
  /** Null when scoring could not run; the research itself still stands. */
  scoreTotal?: number | null;
  scoreTier?: string | null;
  /** How much of what matters this run now has an answer to. */
  completenessLabel?: string | null;
  completenessScore?: number | null;
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

/**
 * What caused this research run.
 *
 * research_runs.trigger has a vocabulary -- newly_discovered, scheduled_refresh,
 * human_requested, stale_evidence and the rest -- and every run ever written said
 * `human_requested`, whatever actually asked for it. So "research runs completed
 * today" could not be attributed: a nightly sweep, a discovery and a rep pressing a
 * button were the same row. A trigger we do not recognise falls back rather than
 * failing a research run over a label.
 */
const RESEARCH_TRIGGERS = new Set([
  'newly_discovered', 'refresh_before_call', 'scheduled_refresh', 'human_requested',
  'campaign_expansion', 'stale_evidence', 'import',
]);

export function researchTrigger(requested: string | null | undefined): string {
  const value = (requested ?? '').trim();
  if (RESEARCH_TRIGGERS.has(value)) return value;
  // The miner's own word for it, kept so callers read naturally.
  if (value === 'discovered') return 'newly_discovered';
  return 'human_requested';
}

export async function runContactResearch(
  accountId: string, trigger: string | null = null,
): Promise<ContactResearchOutcome> {
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

  // Which profile produced this run's evidence.
  //
  // The column has existed since the table was written and was null on every row. A
  // profile decides which terms are searched, which signals score and which results
  // are excluded, so editing one changes all three -- and without this, "why did this
  // company score differently last month" is unanswerable. The same problem the score
  // policy version already solved, one layer over and unsolved.
  //
  // The content hash rather than `profile_version`: every profile in the repository
  // still says 1.0.0, including the ones edited in this campaign, so the declared
  // version would record a constant.
  const { profileContentHash } = await import('../domain/verticals.js');
  const { rows: profileRows } = await query<{ definition: unknown; profile_version: string }>(
    'select definition, profile_version from vertical_profiles where vertical_profile_id = $1',
    [account.primary_vertical_profile_id]);
  const profileStamp = profileRows[0]
    ? `${profileRows[0].profile_version}+${profileContentHash(profileRows[0].definition)}`
    : null;

  const { rows: runRows } = await query<{ research_run_id: string }>(
    `insert into research_runs (account_id, trigger, vertical_profile_id,
                                vertical_profile_version, status)
     values ($1, $3, $2, $4, 'running') returning research_run_id`,
    [accountId, account.primary_vertical_profile_id, researchTrigger(trigger),
      profileStamp],
  );
  const researchRunId = runRows[0]!.research_run_id;

  const people: PersonObservation[] = [];
  const endpoints: EndpointObservation[] = [];
  let pagesFetched = 0;
  let pageText: { url: string; text: string }[] = [];
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
    pageText = firstParty.pageText;
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

  // What the company's own pages say about how it operates.
  //
  // The profiles have declared these signals since they were written -- emergency
  // cover, online booking, more than one branch, hiring, financing, membership plans
  // -- each with the score rule it feeds. Nothing produced them: this worker read the
  // very pages that state them and recorded only people and endpoints, so the
  // scoring model was weighing signals no part of the system could ever observe.
  const { extractFirstPartySignals } = await import('../resolver/signals.js');
  const signals = pageText.length > 0
    ? await extractFirstPartySignals({
      verticalProfileId: account.primary_vertical_profile_id, pages: pageText,
    })
    : [];

  await withTransaction(async (client) => {
    await persistResolution(client, accountId, resolution, researchRunId);

    for (const signal of signals) {
      await recordEvidence(client, {
        accountId,
        researchRunId,
        category: signal.category,
        claimKey: signal.claimKey,
        claimText: signal.claimText,
        normalizedValue: 'yes',
        // The company said it on its own site. That is the strongest kind of
        // evidence for what a company offers, and the weakest for whether it is
        // true -- so it is confirmed as an observation and safe to quote back,
        // which is exactly how a rep would use it.
        confidence: 'confirmed',
        canStateAsFact: true,
        sourceType: 'first_party',
        sourceReference: signal.sourceReference,
        expiresAt: new Date(Date.now() + signal.ttlHours * 3600_000),
        precedenceRank: 2,
      });
    }
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

  // Research that produces evidence and never scores it leaves the Account without a
  // tier, and a rep filtering "Tier B and better" cannot see it at all. Scoring runs
  // here, on the evidence this run just wrote, outside the transaction above so a
  // scoring fault cannot roll back the research it is reading.
  let scored: { totalPoints: number; tier: string } | null = null;
  try {
    const { scoreAccount } = await import('../scoring/score.js');
    const result = await scoreAccount(accountId, { researchRunId });
    scored = { totalPoints: result.totalPoints, tier: result.tier };
  } catch (error) {
    // A research run that succeeded is not undone by a scoring failure. The Account
    // keeps its evidence and stays unscored, which the operator can see and retry.
    console.error('[research] scoring failed', { accountId, error });
  }

  // How much of what matters we now have an answer to.
  //
  // The only writer of this used to set THIN or STALE and nothing else, so a
  // researched company's completeness stayed null for ever and three of the four
  // filter options on Find Prospects matched nothing at all. Computed from the same
  // fact model the Account page reads, so the filter and the page cannot disagree.
  // Outside the transaction and after scoring, for the same reason scoring is: a
  // completeness fault must not undo research that succeeded.
  let completeness: { label: string; score: number } | null = null;
  try {
    const { computeCompleteness, storeCompleteness } =
      await import('../domain/researchCompleteness.js');
    const result = await computeCompleteness(accountId);
    await storeCompleteness(accountId, result, researchRunId);
    completeness = { label: result.label, score: result.score };
  } catch (error) {
    console.error('[research] completeness failed', { accountId, error });
  }

  return {
    accountId,
    status: resolution.status,
    primaryPerson: resolution.primary?.personName ?? null,
    contactPaths: resolution.contactPaths.length,
    pagesFetched,
    pagesBlocked,
    stagesRun,
    stagesSkipped,
    scoreTotal: scored?.totalPoints ?? null,
    scoreTier: scored?.tier ?? null,
    completenessLabel: completeness?.label ?? null,
    completenessScore: completeness?.score ?? null,
  };
}

registerHandler('contact_research', async (job: JobRecord) => {
  const accountId = job.account_id ?? String(job.payload['account_id'] ?? '');
  if (!accountId) throw new Error('contact_research job has no account_id');
  return { ...(await runContactResearch(accountId, job.payload['trigger'] as string | null)) };
});

registerHandler('account_research', async (job: JobRecord) => {
  const accountId = job.account_id ?? String(job.payload['account_id'] ?? '');
  if (!accountId) throw new Error('account_research job has no account_id');
  return { ...(await runContactResearch(accountId, job.payload['trigger'] as string | null)) };
});
