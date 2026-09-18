import { query } from '../db/pool.js';
import { registerHandler, type JobRecord, type JobResult } from './runner.js';
import { apolloConfig, createApolloAdapter } from '../providers/apollo/client.js';
import {
  DECISION_MAKER_TITLES, selectDecisionMaker,
} from '../providers/apollo/candidates.js';
import {
  judgeApolloEligibility, nextCheckAfter, type ApolloEligibilityInput,
} from '../providers/apollo/eligibility.js';
import {
  apolloFingerprint, beginApolloRequest, settleApolloRequest,
} from '../providers/apollo/ledger.js';
import { attributeEndpoint } from '../resolver/attribution.js';
import type { ApolloAdapter } from '../providers/apollo/types.js';

/**
 * Apollo, last in the waterfall.
 *
 * Company discovery, entity resolution, first-party research, public-web enrichment,
 * reconciliation -- and then, for whatever is still missing, this. The ordering is the
 * point: the 2026-09-17 audit found an owner's own email published on the company's own
 * contact page, and Apollo would have been paid to tell us the same thing.
 *
 * The economics come from Apollo's own documentation. People Search costs nothing and
 * reports whether an email exists; enrichment costs a credit and only charges when it
 * matches. So the expensive decision is made on free information: search, rank, and buy
 * only when there is something to buy.
 */

/** A provider can be injected, so tests never reach the network. */
let adapterOverride: ApolloAdapter | null = null;
export function setApolloAdapter(adapter: ApolloAdapter | null): void { adapterOverride = adapter; }
function adapter(): ApolloAdapter { return adapterOverride ?? createApolloAdapter(); }

interface AccountRow {
  account_id: string; canonical_name: string; canonical_domain: string | null;
  entity_status: string; is_suppressed: boolean; source_role: string | null;
  phone: string | null; address: string | null; city: string | null; region: string | null;
  has_listing: boolean;
}

async function loadAccount(accountId: string): Promise<AccountRow | null> {
  const { rows } = await query<AccountRow>(
    `select a.account_id, a.canonical_name, a.canonical_domain, a.entity_status,
            a.is_suppressed,
            (select dc.source_role from discovery_candidates dc
              where dc.account_id = a.account_id order by dc.created_at desc limit 1) as source_role,
            (select ce.normalized_value from contact_endpoints ce
              where ce.account_id = a.account_id and ce.endpoint_type = 'PHONE'
                and ce.is_active order by ce.observed_at desc limit 1) as phone,
            l.address_line_1 as address, l.city, l.state_region as region,
            exists (select 1 from discovery_candidates dc2
                     where dc2.account_id = a.account_id
                       and dc2.source_class = 'BUSINESS_LISTING') as has_listing
       from accounts a
       left join locations l on l.account_id = a.account_id
            and l.location_type = 'physical' and l.is_active
      where a.account_id = $1 limit 1`, [accountId]);
  return rows[0] ?? null;
}

async function eligibilityInputFor(account: AccountRow): Promise<ApolloEligibilityInput> {
  const people = await query<{ full_name: string | null }>(
    `select full_name from contacts
      where account_id = $1 and full_name is not null
        and not coalesce(is_role_placeholder, false)`, [account.account_id]);
  const routes = await query<{ normalized_value: string }>(
    `select normalized_value from contact_endpoints
      where account_id = $1 and endpoint_type = 'EMAIL' and is_active
        and contact_id is not null`, [account.account_id]);
  const personPhone = await query<{ n: string }>(
    `select count(*)::text as n from contact_endpoints
      where account_id = $1 and endpoint_type = 'PHONE' and is_active
        and endpoint_role = 'DIRECT_PERSON_PHONE' and contact_id is not null`,
    [account.account_id]);
  const state = await query<{
    next_check_at: Date | null; last_checked_at: Date | null; last_result: string | null;
    input_fingerprint: string | null;
  }>(`select next_check_at, last_checked_at, last_result, input_fingerprint
        from apollo_account_state where account_id = $1`, [account.account_id]);
  const prior = state.rows[0];

  return {
    accountId: account.account_id,
    companyName: account.canonical_name,
    canonicalDomain: account.canonical_domain,
    entityStatus: account.entity_status,
    isSuppressed: account.is_suppressed,
    sourceRole: account.source_role,
    verifiedPhone: account.phone,
    verifiedAddress: account.address,
    hasBusinessListing: account.has_listing,
    hasValidDecisionMaker: people.rows.length > 0,
    personRouteEmails: routes.rows.map((r) => r.normalized_value),
    hasAttributedPersonPhone: Number(personPhone.rows[0]?.n ?? 0) > 0,
    lastCheckedAt: prior?.last_checked_at ?? null,
    nextCheckAt: prior?.next_check_at ?? null,
    lastResult: prior?.last_result ?? null,
    previousFingerprint: prior?.input_fingerprint ?? null,
    currentFingerprint: organizationFingerprint(account),
  };
}

/** What would make a previous Apollo answer be about a different company. */
function organizationFingerprint(account: AccountRow): string {
  return [(account.canonical_domain ?? '').toLowerCase(),
    account.canonical_name.toLowerCase().replace(/\s+/g, ' ').trim()].join('|');
}

async function recordState(accountId: string, patch: {
  status: string; reason?: string | null; result?: string | null;
  apolloPersonId?: string | null; apolloOrganizationId?: string | null;
  matchConfidence?: string | null; fingerprint?: string | null;
  nextCheckAt?: Date | null; enriched?: boolean; noMatch?: boolean;
}): Promise<void> {
  await query(
    `insert into apollo_account_state
       (account_id, status, eligibility_reason, last_result, apollo_person_id,
        apollo_organization_id, match_confidence, input_fingerprint,
        last_checked_at, last_enriched_at, next_check_at, consecutive_no_match)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now(), case when $9 then now() else null end, $10,
             case when $11 then 1 else 0 end)
     on conflict (account_id) do update set
       status = excluded.status,
       eligibility_reason = excluded.eligibility_reason,
       last_result = coalesce(excluded.last_result, apollo_account_state.last_result),
       apollo_person_id = coalesce(excluded.apollo_person_id, apollo_account_state.apollo_person_id),
       apollo_organization_id = coalesce(excluded.apollo_organization_id,
                                         apollo_account_state.apollo_organization_id),
       match_confidence = coalesce(excluded.match_confidence, apollo_account_state.match_confidence),
       input_fingerprint = coalesce(excluded.input_fingerprint, apollo_account_state.input_fingerprint),
       last_checked_at = now(),
       last_enriched_at = case when $9 then now() else apollo_account_state.last_enriched_at end,
       next_check_at = excluded.next_check_at,
       -- A streak of nothing backs the schedule off; anything else resets it.
       consecutive_no_match = case when $11
                                   then apollo_account_state.consecutive_no_match + 1 else 0 end,
       updated_at = now()`,
    [accountId, patch.status, patch.reason ?? null, patch.result ?? null,
     patch.apolloPersonId ?? null, patch.apolloOrganizationId ?? null,
     patch.matchConfidence ?? null, patch.fingerprint ?? null,
     patch.enriched ?? false, patch.nextCheckAt ?? null, patch.noMatch ?? false]);
}

registerHandler('apollo_enrichment', async (job: JobRecord): Promise<JobResult> => {
  const accountId = String(job.payload['account_id'] ?? '');
  if (!accountId) return { outcome: 'NOTHING_TO_DO', outcomeReason: 'no account named' };

  const settings = apolloConfig();
  if (!settings.enabled) {
    return { outcome: 'NOTHING_TO_DO',
      outcomeReason: 'Apollo is switched off, so no request was made and nothing was spent.' };
  }
  const provider = adapter();
  if (!provider.isConfigured()) {
    await recordState(accountId, { status: 'APOLLO_PERMISSION_ERROR',
      reason: 'no Apollo credential is configured', nextCheckAt: null });
    return { outcome: 'PROVIDER_UNAVAILABLE',
      outcomeReason: 'No Apollo credential is configured. Nothing was bought and nothing '
        + 'was concluded about the company.' };
  }

  const account = await loadAccount(accountId);
  if (!account) return { outcome: 'NOTHING_TO_DO', outcomeReason: 'the Account is gone' };

  const input = await eligibilityInputFor(account);
  const eligibility = judgeApolloEligibility(input);
  if (!eligibility.eligible) {
    await recordState(accountId, {
      status: eligibility.verdict === 'NOT_ELIGIBLE_ALREADY_COMPLETE'
        ? 'APOLLO_NOT_NEEDED' : 'APOLLO_NOT_NEEDED',
      reason: eligibility.reason,
      fingerprint: input.currentFingerprint,
      nextCheckAt: eligibility.verdict === 'NOT_ELIGIBLE_ALREADY_COMPLETE'
        ? nextCheckAfter({ result: 'COMPLETE' }) : null,
    });
    return { outcome: 'NOTHING_TO_DO',
      outcomeReason: `${eligibility.verdict}: ${eligibility.reason}` };
  }

  /* ------------------------------------------------ free: who works here? --- */

  if (!settings.peopleSearchEnabled) {
    return { outcome: 'NOTHING_TO_DO', outcomeReason: 'Apollo people search is switched off' };
  }
  const searchKey = apolloFingerprint({
    accountId, canonicalDomain: account.canonical_domain,
    organizationIdentity: input.currentFingerprint,
    operation: 'PEOPLE_SEARCH', mode: 'SEARCH_ONLY', fields: ['candidates'],
  });
  const searchClaim = await beginApolloRequest({
    accountId, operation: 'PEOPLE_SEARCH', mode: 'SEARCH_ONLY',
    idempotencyKey: searchKey, inputFingerprint: input.currentFingerprint ?? '' });

  let candidates: Awaited<ReturnType<ApolloAdapter['searchPeople']>> | null = null;
  if (searchClaim.apolloRequestId) {
    candidates = await provider.searchPeople({
      organizationDomains: account.canonical_domain ? [account.canonical_domain] : undefined,
      organizationNames: account.canonical_domain ? undefined : [account.canonical_name],
      personTitles: DECISION_MAKER_TITLES,
      perPage: 25,
    });
    await settleApolloRequest({
      apolloRequestId: searchClaim.apolloRequestId,
      result: candidates.ok
        ? (candidates.data?.people.length ? 'MATCHED' : 'NO_MATCH')
        : 'ERROR',
      httpStatus: candidates.httpStatus,
      providerRequestId: candidates.providerRequestId,
      // Documented at zero credits, so this is a fact rather than an estimate.
      creditConsuming: 'NO', creditsEstimated: 0,
      errorClassification: candidates.errorClassification ?? null,
      matchConfidence: null,
      notes: `${candidates.data?.people.length ?? 0} candidate(s) returned`,
    });
  }

  if (!candidates || !candidates.ok) {
    /**
     * A provider outage is never evidence about a business.
     *
     * The Account keeps everything it had and is asked again tomorrow. Nothing about the
     * company changed because Apollo was unreachable.
     */
    await recordState(accountId, { status: 'APOLLO_PROVIDER_ERROR',
      reason: candidates?.errorMessage ?? 'the search could not be made',
      nextCheckAt: nextCheckAfter({ result: 'ERROR' }),
      fingerprint: input.currentFingerprint });
    return { outcome: 'PROVIDER_UNAVAILABLE',
      outcomeReason: `Apollo could not be reached (${candidates?.errorClassification ?? 'unknown'}). `
        + 'The Account is unchanged.' };
  }

  const firstParty = await query<{ full_name: string }>(
    `select full_name from contacts where account_id = $1 and full_name is not null`,
    [accountId]);
  const selection = selectDecisionMaker(candidates.data?.people ?? [], {
    searchScopedByDomain: Boolean(account.canonical_domain),
    companyName: account.canonical_name,
    canonicalDomain: account.canonical_domain,
    city: account.city, state: account.region,
    firstPartyPersonNames: firstParty.rows.map((r) => r.full_name),
  });

  if (selection.ambiguous) {
    await recordState(accountId, { status: 'APOLLO_AMBIGUOUS', reason: selection.reason,
      result: 'AMBIGUOUS', fingerprint: input.currentFingerprint,
      nextCheckAt: nextCheckAfter({ result: 'AMBIGUOUS' }) });
    return { outcome: 'PARTIAL',
      outcomeReason: `Two or more equally plausible decision makers, so none was chosen: `
        + `${selection.reason}. Sent to review rather than guessed.` };
  }
  if (!selection.chosen) {
    await recordState(accountId, { status: 'APOLLO_NO_MATCH', reason: selection.reason,
      result: 'NO_MATCH', noMatch: true, fingerprint: input.currentFingerprint,
      nextCheckAt: nextCheckAfter({ result: 'NO_MATCH' }) });
    return { outcome: 'ZERO_RESULTS',
      outcomeReason: `Apollo found nobody usable at ${account.canonical_name}: ${selection.reason}` };
  }

  const chosen = selection.chosen.candidate;

  /**
   * Nothing to buy.
   *
   * Apollo told us for free that it holds no address for this person. Paying to be told
   * that again is the clearest possible waste, and this is the branch that prevents it.
   */
  if (!chosen.hasEmail) {
    await recordState(accountId, { status: 'APOLLO_SEARCHED',
      reason: `${chosen.fullName} identified, but Apollo holds no email for them`,
      result: 'MATCHED', apolloPersonId: chosen.apolloPersonId,
      apolloOrganizationId: chosen.apolloOrganizationId,
      fingerprint: input.currentFingerprint,
      nextCheckAt: nextCheckAfter({ result: 'MATCHED' }) });
    return { outcome: 'PARTIAL',
      outcomeReason: `${chosen.fullName} (${chosen.title}) identified at no cost. Apollo holds `
        + 'no email for them, so no enrichment was bought.' };
  }

  if (!settings.peopleEnrichmentEnabled) {
    await recordState(accountId, { status: 'APOLLO_SEARCHED',
      reason: 'people enrichment is switched off', result: 'MATCHED',
      apolloPersonId: chosen.apolloPersonId,
      apolloOrganizationId: chosen.apolloOrganizationId,
      fingerprint: input.currentFingerprint,
      nextCheckAt: nextCheckAfter({ result: 'MATCHED' }) });
    return { outcome: 'PARTIAL',
      outcomeReason: `${chosen.fullName} (${chosen.title}) identified for free. Paid enrichment `
        + 'is switched off, so nothing was bought.' };
  }

  /* ------------------------------------------------ paid: how to reach them --- */

  const enrichKey = apolloFingerprint({
    accountId, canonicalDomain: account.canonical_domain,
    organizationIdentity: input.currentFingerprint,
    apolloPersonId: chosen.apolloPersonId, personName: chosen.fullName,
    operation: 'PEOPLE_MATCH', mode: 'ENRICH_EMAIL', fields: ['email'],
  });
  const enrichClaim = await beginApolloRequest({
    accountId, operation: 'PEOPLE_MATCH', mode: 'ENRICH_EMAIL',
    idempotencyKey: enrichKey, inputFingerprint: input.currentFingerprint ?? '',
    apolloPersonId: chosen.apolloPersonId,
    apolloOrganizationId: chosen.apolloOrganizationId });

  if (!enrichClaim.apolloRequestId) {
    return { outcome: 'NOTHING_TO_DO',
      outcomeReason: `This exact enrichment has already been bought (${enrichClaim.existing?.result}). `
        + 'No second request was made.' };
  }

  const enriched = await provider.enrichPerson({
    apolloPersonId: chosen.apolloPersonId,
    domain: account.canonical_domain ?? undefined,
    organizationName: account.canonical_name,
    // Explicitly not asked for: a mobile is eight further credits and arrives
    // asynchronously. It stays off until the email yield has been measured.
    revealPhoneNumber: false,
    revealPersonalEmails: false,
  });

  if (!enriched.ok || !enriched.data) {
    await settleApolloRequest({ apolloRequestId: enrichClaim.apolloRequestId,
      result: 'ERROR', httpStatus: enriched.httpStatus,
      providerRequestId: enriched.providerRequestId,
      creditConsuming: 'NO', creditsEstimated: 0,
      errorClassification: enriched.errorClassification ?? null });
    await recordState(accountId, { status: 'APOLLO_PROVIDER_ERROR',
      reason: enriched.errorMessage ?? 'enrichment failed',
      nextCheckAt: nextCheckAfter({ result: 'ERROR' }),
      fingerprint: input.currentFingerprint });
    return { outcome: 'PROVIDER_UNAVAILABLE',
      outcomeReason: `Apollo enrichment failed (${enriched.errorClassification}). The Account `
        + 'is unchanged.' };
  }

  const person = enriched.data;
  const gained: string[] = [];

  /**
   * The address goes through the same attribution gate as everything else.
   *
   * Apollo returning a person and an email together is a provider stating the link, which
   * is one of the ranked bases -- but a role mailbox is still a role mailbox, and the gate
   * is where that is enforced rather than here.
   */
  let attributed: ReturnType<typeof attributeEndpoint> | null = null;
  if (person.email && person.matchConfidence !== 'none') {
    attributed = attributeEndpoint({
      endpointKind: 'EMAIL', value: person.email,
      personName: person.fullName ?? chosen.fullName,
      observedBasis: 'PROVIDER_STATED',
    });
    if (attributed.role === 'DIRECT_PERSON_EMAIL') gained.push('email');
  }

  await settleApolloRequest({
    apolloRequestId: enrichClaim.apolloRequestId,
    result: person.matchConfidence === 'none' ? 'NO_MATCH' : 'MATCHED',
    httpStatus: enriched.httpStatus,
    providerRequestId: enriched.providerRequestId,
    matchConfidence: person.matchConfidence,
    creditConsuming: enriched.cost.creditConsuming,
    creditsCharged: enriched.cost.creditsCharged,
    creditsEstimated: enriched.cost.creditsEstimated,
    fieldsGained: gained,
    apolloPersonId: person.apolloPersonId,
    apolloOrganizationId: person.apolloOrganizationId,
  });

  await recordState(accountId, {
    status: gained.length > 0 ? 'APOLLO_ENRICHED' : 'APOLLO_MATCHED',
    reason: selection.reason,
    result: person.matchConfidence === 'none' ? 'NO_MATCH' : 'MATCHED',
    noMatch: person.matchConfidence === 'none',
    apolloPersonId: person.apolloPersonId,
    apolloOrganizationId: person.apolloOrganizationId,
    matchConfidence: person.matchConfidence,
    fingerprint: input.currentFingerprint,
    enriched: gained.length > 0,
    nextCheckAt: nextCheckAfter({
      result: gained.length > 0 ? 'ENRICHED' : 'MATCHED' }),
  });

  return { outcome: 'COMPLETED',
    outcomeReason: gained.length > 0
      ? `${person.fullName} (${person.title}) with a ${person.matchConfidence}-confidence `
        + `match; ${gained.join(', ')} attributed to them. Estimated `
        + `${enriched.cost.creditsEstimated} credit(s).`
      : `${person.fullName} matched at ${person.matchConfidence} confidence, but nothing `
        + 'attributable came back.' };
});

/**
 * The Accounts that are due, and only those.
 *
 * Michael's instruction, and the shape that makes it affordable: a sweep may run daily,
 * and a provider call happens only for an Account whose next check has come round. The
 * schedule lives in a column rather than in a timer, so a deployment does not reset it.
 */
export async function sweepApolloDue(limit = 100): Promise<{ queued: number; due: number }> {
  const settings = apolloConfig();
  if (!settings.enabled) return { queued: 0, due: 0 };

  const { rows } = await query<{ account_id: string }>(
    `select a.account_id
       from accounts a
       left join apollo_account_state s on s.account_id = a.account_id
      where not a.is_suppressed
        and a.entity_status = 'verified'
        and (s.account_id is null or (s.next_check_at is not null and s.next_check_at <= now()))
        and s.status is distinct from 'APOLLO_PERMISSION_ERROR'
        and not exists (select 1 from jobs j
                         where j.job_type = 'apollo_enrichment'
                           and j.status in ('QUEUED','RUNNING')
                           and j.account_id = a.account_id)
      order by s.next_check_at asc nulls first
      limit $1`, [limit]);

  const { enqueueApolloEnrichment } = await import('./enqueue.js');
  let queued = 0;
  for (const row of rows) {
    const result = await enqueueApolloEnrichment({ accountId: row.account_id });
    if (result.created) queued += 1;
  }
  return { queued, due: rows.length };
}
