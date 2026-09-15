import { config } from '../config.js';
import { mayResearchDomainWithHistory } from '../discovery/attribution.js';
import { query, withTransaction } from '../db/pool.js';
import { researchFirstParty } from '../resolver/adapters/firstParty.js';
import { reconcile } from '../resolver/reconcile.js';
import { persistResolution } from '../resolver/persist.js';
import { recordEvidence } from '../domain/accounts.js';
import type { EndpointObservation, PersonObservation } from '../resolver/types.js';
import { registerHandler, type JobRecord, type JobOutcome } from './runner.js';

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
  /** Hypotheses derived from the vertical's own declared leaks. */
  hypothesesWritten?: number;
  /**
   * PARTIAL when the crawl and the evidence stand but something after them did not
   * finish. Declared here rather than only spread in at runtime: the runner records
   * this on the job, and a field the type does not admit to is a field nothing
   * downstream can be written against.
   */
  outcome?: JobOutcome;
  outcomeReason?: string;
}

interface AccountRow {
  account_id: string;
  canonical_name: string;
  canonical_domain: string | null;
  entity_status: string | null;
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

/**
 * What the official sources need to know about this company.
 *
 * Address and phone come from what the account already holds, and they are here for
 * one purpose: corroboration. A registry name match alone is not an identification,
 * so the matcher needs something else to agree -- and the something else has to be
 * what we independently believe about the company, not what the registry told us.
 *
 * The location read is deliberately the account's own location rows, never the ZIP a
 * rep happened to search. A search geography is a question, not an address.
 */
async function buildSourceContext(
  accountId: string, account: AccountRow, hostname: string | null,
): Promise<import('../sources/types.js').SourceLookupContext> {
  const { rows: locationRows } = await query<{
    address_line_1: string | null; city: string | null; state_region: string | null;
    postal_code: string | null;
  }>(
    // `address_line_1`, which is what the column is called. Selecting a column that
    // does not exist threw, and the guard around this stage turned the throw into a
    // silently skipped stage -- so every official source quietly did nothing while the
    // unit tests, which hand-build this context, all passed.
    `select address_line_1, city, state_region, postal_code
       from locations
      where account_id = $1 and is_active
      order by (location_type = 'physical') desc, created_at asc
      limit 1`,
    [accountId]);
  const location = locationRows[0];

  const { rows: phoneRows } = await query<{ normalized_value: string }>(
    `select normalized_value from contact_endpoints
      where account_id = $1 and endpoint_type = 'PHONE' and is_active
      limit 10`,
    [accountId]);

  return {
    accountId,
    companyName: account.canonical_name,
    stateRegion: location?.state_region ?? null,
    city: location?.city ?? null,
    postalCode: location?.postal_code ?? null,
    domain: hostname ?? account.canonical_domain,
    verticalProfileId: account.primary_vertical_profile_id,
    knownPhones: phoneRows.map((row) => row.normalized_value),
    streetAddress: location?.address_line_1 ?? null,
  };
}

export async function runContactResearch(
  accountId: string, trigger: string | null = null,
): Promise<ContactResearchOutcome> {
  const { rows } = await query<AccountRow>(
    `select account_id, canonical_name, canonical_domain, entity_status,
            primary_vertical_profile_id, manual_tier
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
  let technologies: import('../resolver/techSignals.js').TechObservation[] = [];
  let socials: import('../resolver/companyProfile.js').SocialProfile[] = [];
  let contactRoutes: import('../resolver/companyProfile.js').ContactRoute[] = [];
  let profileClaims: import('../resolver/companyProfile.js').ProfileObservation[] = [];
  let siteQuality: import('../resolver/siteQuality.js').SiteQualitySignal[] = [];
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

  // Whose site is this?
  //
  // Research used to read whatever domain was attached and record what it found as
  // facts about the Account. When the domain belonged to a lead-generation directory
  // that produced a contractor with the directory's phone number, its financing copy
  // and, in one case, a news publisher's executive as the decision maker.
  const attribution = await mayResearchDomainWithHistory({
    domain: domainRows[0]?.hostname ?? account.canonical_domain,
    entityStatus: account.entity_status ?? null,
  });

  if (websiteUrl && attribution.allowed) {
    stagesRun.push('A_company_first_party');
    const firstParty = await researchFirstParty(websiteUrl, account.canonical_name);
    people.push(...firstParty.people);
    endpoints.push(...firstParty.endpoints);
    pagesFetched = firstParty.pagesFetched.length;
    pagesBlocked = firstParty.pagesBlocked.length;
    notes.push(...firstParty.notes);
    pageText = firstParty.pageText;
    technologies = firstParty.technologies;
    socials = firstParty.socials;
    contactRoutes = firstParty.contactRoutes;
    profileClaims = firstParty.profileClaims;
    siteQuality = firstParty.siteQuality;
  } else {
    stagesSkipped.push({ stage: 'A_company_first_party', reason: attribution.reason });
  }

  // --- Stages B and C: official company registries and licence registries. -----
  //
  // These were skipped from the day this worker was written, with the reason
  // "source governance review not signed off". That refusal was correct and is not
  // deleted here: what has changed is that the review it was waiting for now exists,
  // per source, in src/sources/governance.ts -- what we read, how often, under whose
  // terms, and what happens when the source refuses us. Each adapter still consults
  // it, and a source whose review says BLOCKED or DISABLED_PAID_SOURCE cannot be
  // switched on by any flag.
  //
  // Every source runs inside its own timeout and its own try/catch. A Texas plumbing
  // licence is no less true because the Comptroller timed out, so one source failing
  // must never cost the account what another source already established.
  //
  // Guarded as a whole, for the same reason scoring, completeness and hypotheses are:
  // official enrichment is optional, and a fault around it -- a database hiccup
  // building the lookup context, a module failing to import -- must not cost the
  // account the first-party evidence already gathered above. Individual adapters are
  // isolated inside runOfficialSources; this catches everything surrounding them.
  let official: import('../sources/run.js').SourceStageResult = {
    people: [], endpoints: [], facts: [], outcomes: [], stagesRun: [], stagesSkipped: [],
  };
  try {
    const { runOfficialSources } = await import('../sources/run.js');
    const officialContext = await buildSourceContext(
      accountId, account, domainRows[0]?.hostname ?? null);
    official = await runOfficialSources({ context: officialContext });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    for (const stage of ['B_public_company_registry', 'C_public_license_registry']) {
      stagesSkipped.push({ stage, reason: `official source research could not run: ${reason}` });
    }
    console.error('[research] official sources failed', { accountId, error });
  }

  people.push(...official.people);
  endpoints.push(...official.endpoints);
  stagesRun.push(...official.stagesRun);
  stagesSkipped.push(...official.stagesSkipped);
  for (const outcome of official.outcomes) {
    notes.push(`${outcome.displayName}: ${outcome.status} — ${outcome.reason}`);
  }

  // --- Stage D: search-indexed evidence. ----------------------------------------
  stagesSkipped.push({
    stage: 'D_search_indexed_evidence',
    reason: 'no approved search provider configured (blocker B-3)',
  });

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

    // Official facts, each carrying the agency that produced it and the date it was
    // captured. A snapshot-sourced fact captures at the snapshot's download time, so
    // freshness never claims more than the data supports.
    for (const entry of official.facts) {
      await recordEvidence(client, {
        accountId,
        researchRunId,
        category: 'official_record',
        claimKey: entry.fact.claimKey,
        claimText: entry.fact.claimText,
        normalizedValue: entry.fact.normalizedValue ?? null,
        confidence: entry.fact.confidence,
        canStateAsFact: entry.fact.canStateAsFact,
        sourceType: 'public_registry',
        sourceProvider: entry.sourceId,
        sourceReference: entry.sourceReference,
        observedAt: entry.capturedAt,
        expiresAt: new Date(entry.capturedAt.getTime() + entry.fact.ttlDays * 86_400_000),
        // Official records outrank the company's own marketing copy about itself,
        // and are outranked by a person telling us directly.
        precedenceRank: 1,
      });
    }

    // What the company says about itself: founding year, ownership claims, service
    // area, hours, licence numbers it displays. Its own words, recorded as its own
    // words -- strong evidence of what it claims, and no evidence at all that the
    // claim is true. The licence registries are what verify a displayed licence.
    // The structured service area, kept apart from the address on purpose.
    //
    // A company that serves forty ZIPs is located in one of them. This writes the
    // coverage it claims; nothing here touches `locations`, which is where the
    // business actually is.
    {
      const { extractStructuredServiceArea } = await import('../resolver/companyProfile.js');
      const joined = pageText.map((page) => page.text).join('\n');
      const area = joined ? extractStructuredServiceArea(joined) : null;
      if (area && (area.zips.length > 0 || area.cities.length > 0
        || area.counties.length > 0 || area.regions.length > 0)) {
        await recordEvidence(client, {
          accountId, researchRunId,
          category: 'service_area',
          claimKey: 'service_area_structured',
          claimText: `States it serves ${[
            area.zips.length > 0 ? `${area.zips.length} ZIP(s): ${area.zips.slice(0, 12).join(', ')}` : null,
            area.cities.length > 0 ? area.cities.slice(0, 8).map((city) => city.name).join(', ') : null,
            area.counties.length > 0 ? area.counties.join(', ') : null,
            area.regions.length > 0 ? area.regions.join(', ') : null,
          ].filter(Boolean).join('; ')}`
            + `${area.vague ? ', and unspecified surrounding areas' : ''}. `
            + 'A service area is where a company will travel, not where it is located.',
          normalizedValue: JSON.stringify({
            zips: area.zips,
            cities: area.cities.map((city) => city.name),
            counties: area.counties,
            regions: area.regions,
            vague: area.vague,
          }),
          confidence: 'confirmed',
          canStateAsFact: true,
          sourceType: 'first_party',
          sourceReference: pageText[0]?.url ?? websiteUrl,
          expiresAt: new Date(Date.now() + 365 * 86_400_000),
          precedenceRank: 2,
        });
      }
    }

    for (const claim of profileClaims) {
      await recordEvidence(client, {
        accountId, researchRunId,
        category: 'company_profile',
        claimKey: claim.claimKey,
        claimText: claim.claimText,
        normalizedValue: claim.normalizedValue,
        confidence: 'confirmed',
        canStateAsFact: true,
        sourceType: 'first_party',
        sourceReference: claim.sourceReference,
        expiresAt: new Date(Date.now() + claim.ttlDays * 86_400_000),
        precedenceRank: 2,
      });
    }

    // What the site itself is like. The only place in this worker that records a
    // deliberate "no": a home page either declares a mobile viewport or it does not,
    // and that absence is a fact about the page rather than a gap in our research.
    for (const signal of siteQuality) {
      await recordEvidence(client, {
        accountId, researchRunId,
        category: 'site_quality',
        claimKey: signal.claimKey,
        claimText: signal.claimText,
        normalizedValue: signal.normalizedValue,
        confidence: 'confirmed',
        canStateAsFact: true,
        sourceType: 'first_party',
        sourceReference: signal.sourceReference,
        expiresAt: new Date(Date.now() + signal.ttlDays * 86_400_000),
        precedenceRank: 3,
      });
    }

    // Which inbox is which.
    //
    // sales@ reaches somebody whose job is to answer us; service@ reaches a dispatch
    // queue that will treat us as a customer with a broken water heater. Both are
    // "an email address" to the endpoint model, and writing to the wrong one is a
    // wasted first touch.
    {
      const { classifyRoleInbox } = await import('../resolver/companyProfile.js');
      const seenInboxes = new Set<string>();
      for (const endpoint of endpoints) {
        if (endpoint.kind !== 'EMAIL') continue;
        const inbox = classifyRoleInbox(endpoint.value);
        if (!inbox || seenInboxes.has(inbox)) continue;
        seenInboxes.add(inbox);
        await recordEvidence(client, {
          accountId, researchRunId,
          category: 'contact_route',
          claimKey: `inbox_${inbox}`,
          claimText: `${endpoint.value} is the ${inbox} inbox.`,
          normalizedValue: endpoint.value,
          confidence: 'confirmed',
          canStateAsFact: true,
          sourceType: 'first_party',
          sourceReference: endpoint.sourceReference,
          expiresAt: new Date(Date.now() + 180 * 86_400_000),
          precedenceRank: 2,
        });
      }
    }

    // Technology, each with the marker that proves it. A rep reading "runs Google Ads
    // tags and call tracking, no booking widget" is reading a sales opening.
    for (const technology of technologies) {
      await recordEvidence(client, {
        accountId, researchRunId,
        category: 'technology',
        claimKey: `tech_${technology.id}`,
        claimText: `Runs ${technology.displayName} (${technology.category.replace(/_/g, ' ')})`
          + `${technology.salesNote ? `. ${technology.salesNote}` : '.'}`,
        normalizedValue: technology.id,
        confidence: 'confirmed',
        canStateAsFact: true,
        sourceType: 'first_party',
        sourceReference: technology.sourceReference,
        // Sites get rebuilt. A stack read three months ago is a guess.
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
        precedenceRank: 3,
        notes: `Detected from ${technology.evidence}`,
      });
    }

    // Social profiles the company links to from its own site. Attribution comes from
    // that link; nothing here searches a platform by name and guesses.
    for (const social of socials) {
      await recordEvidence(client, {
        accountId, researchRunId,
        category: 'social_profile',
        claimKey: `social_${social.network}`,
        claimText: `Links to its own ${social.network} profile: ${social.url}`,
        normalizedValue: social.url,
        confidence: 'confirmed',
        canStateAsFact: true,
        sourceType: 'first_party',
        sourceReference: social.sourceReference,
        expiresAt: new Date(Date.now() + 180 * 86_400_000),
        precedenceRank: 2,
      });
    }

    // Contact routes, kept apart from one another: a booking page and a quote form
    // are different things to a rep, and "has a form" hides which.
    for (const route of contactRoutes) {
      await recordEvidence(client, {
        accountId, researchRunId,
        category: 'contact_route',
        claimKey: `route_${route.kind}`,
        claimText: `Has a ${route.kind.replace(/_/g, ' ')} page: ${route.url}`,
        normalizedValue: route.url,
        confidence: 'confirmed',
        canStateAsFact: true,
        sourceType: 'first_party',
        sourceReference: route.sourceReference,
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
        precedenceRank: 2,
      });
    }

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
          // Per source: what it said, how it matched, how long it took, and whether
          // the answer came from a cached snapshot. This is what an operator needs to
          // answer "why does this account have no licence on it".
          official_sources: official.outcomes,
        }),
      ],
    );
  });

  // Research that produces evidence and never scores it leaves the Account without a
  // tier, and a rep filtering "Tier B and better" cannot see it at all. Scoring runs
  // here, on the evidence this run just wrote, outside the transaction above so a
  // scoring fault cannot roll back the research it is reading.
  let scored: { totalPoints: number; tier: string } | null = null;
  let scoreFault: string | null = null;
  let completenessFault: string | null = null;
  try {
    const { scoreAccount } = await import('../scoring/score.js');
    const result = await scoreAccount(accountId, { researchRunId });
    scored = { totalPoints: result.totalPoints, tier: result.tier };
  } catch (error) {
    // A research run that succeeded is not undone by a scoring failure. The Account
    // keeps its evidence and stays unscored, which the operator can see and retry.
    scoreFault = error instanceof Error ? error.message : String(error);
    console.error('[research] scoring failed', { accountId, error });
  }

  // The run happened, so the Account says so.
  //
  // Nothing in this product has ever written `last_researched_at`. Only seeds and
  // fixtures did -- which is why every test that needed a researched Account set it
  // by hand, and why the live box reads zero rep-ready with forty-eight stale
  // scores. The research worker crawled the site, wrote evidence and scored the
  // company, and then left no mark saying it had run.
  //
  // Everything downstream asks this column. The freshness projection marks an
  // unstamped Account THIN; completeness keys its label on it; the fact model uses it
  // to tell "we looked and found nothing" from "nobody has looked"; coverage counts
  // researched companies with it; Find Prospects filters on the label it produces. All
  // of them were reading null and answering honestly about the wrong thing.
  //
  // Freshness is thirty days: how long before the research should be re-run, which is
  // a different question from how long a single piece of evidence stays current. Ad
  // evidence expires in forty-eight hours, and using that here would call every
  // researched company stale two days later.
  await query(
    `update accounts
        set last_researched_at = now(),
            research_fresh_until = now() + interval '30 days'
      where account_id = $1`, [accountId]);

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
    completenessFault = error instanceof Error ? error.message : String(error);
    console.error('[research] completeness failed', { accountId, error });
  }

  // Why to call them, from what this run just observed.
  //
  // Nothing in the product ever wrote a hypothesis: the seed, a demo CLI and a
  // fixture were the only writers, so a real prospect's "Why reach out" panel was
  // empty while seeded demo companies looked finished. Derived from the vertical's
  // own `leak_hypotheses` -- their sentence, their questions, their trigger signals,
  // their hook order -- so a profile that declares nothing produces nothing.
  //
  // After scoring and outside its transaction, for the same reason scoring is: a
  // fault here must not undo research that succeeded.
  let hypothesisFault: string | null = null;
  let hypothesesWritten = 0;
  try {
    const { deriveHypotheses, storeHypotheses } = await import('../domain/hypotheses.js');
    const { deriveGapHypotheses } = await import('../domain/gapHypotheses.js');
    // Two producers, one list. The profile's hypotheses come from signals a company
    // has; the gap rules come from one signal sitting next to the absence of another,
    // which is where the most sellable openings are and which no single-signal rule
    // can see.
    const derived = [...await deriveHypotheses(accountId), ...await deriveGapHypotheses(accountId)];
    const stored = await storeHypotheses(accountId, derived);
    hypothesesWritten = stored.written;
  } catch (error) {
    hypothesisFault = error instanceof Error ? error.message : String(error);
    console.error('[research] hypotheses failed', { accountId, error });
  }

  const faults = [
    scoreFault === null ? null : `scoring failed: ${scoreFault}`,
    completenessFault === null ? null : `completeness failed: ${completenessFault}`,
    hypothesisFault === null ? null : `hypotheses failed: ${hypothesisFault}`,
  ].filter((fault): fault is string => fault !== null);

  return {
    // The run happened and its evidence stands, but a run that could not score the
    // company is not a finished one. PARTIAL says so on the job itself, where the
    // doctor and the support bundle can see it, instead of only in a log line.
    ...(faults.length > 0
      ? { outcome: 'PARTIAL' as const, outcomeReason: faults.join('; ') }
      : {}),
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
    hypothesesWritten,
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
