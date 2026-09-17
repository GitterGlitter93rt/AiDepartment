import { query } from '../db/pool.js';
import { searchQueriesFor, serviceAliasesFor } from '../miner/searchTaxonomy.js';
import { decodeEntities } from '../resolver/siteIdentity.js';
import type { AccountBundle } from './classify.js';

/**
 * Reads the evidence behind every Account. Selects only.
 *
 * There is no write path in this file and there is not meant to be one. The preview has
 * to be runnable against production by anyone who wants to know what is in the
 * inventory, which is only true while running it cannot change anything.
 *
 * Loaded in bulk rather than per Account: 320 Accounts with six evidence queries each is
 * two thousand round trips for a report, and the inventory is expected to grow.
 */

const ENTITY_DISCOVERY = 'ENTITY_DISCOVERY';

/** ENTITY_DISCOVERY terms per vertical, read once and shared by every Account in it. */
async function verticalTermsByProfile(profileIds: string[]): Promise<Map<string, string[]>> {
  const terms = new Map<string, string[]>();
  for (const profileId of profileIds) {
    const queries = await searchQueriesFor(profileId);
    terms.set(profileId, queries
      .filter((entry) => entry.purpose === ENTITY_DISCOVERY)
      .map((entry) => entry.query));
  }
  return terms;
}

export async function loadAccountBundles(limit: number | null = null): Promise<AccountBundle[]> {
  const { rows: accounts } = await query<{
    account_id: string; canonical_name: string; canonical_domain: string | null;
    primary_vertical_profile_id: string | null; entity_status: string | null;
    entity_status_basis: string | null; research_completeness: string | null;
    discovered_for_geography_type: string | null; discovered_for_geography: string | null;
    claimed_at: string | null; current_owner_user_id: string | null;
  }>(`select account_id, canonical_name, canonical_domain, primary_vertical_profile_id,
             entity_status, entity_status_basis, research_completeness,
             discovered_for_geography_type, discovered_for_geography,
             claimed_at, current_owner_user_id
        from accounts
       where merged_into_account_id is null
       order by canonical_name
       ${limit ? `limit ${Math.max(1, Math.floor(limit))}` : ''}`);

  const ids = accounts.map((a) => a.account_id);
  if (ids.length === 0) return [];

  const { rows: candidates } = await query<{
    account_id: string; source_class: string | null; resolved_name: string | null;
    name_basis: string | null;
  }>(`select account_id, source_class, resolved_name, name_basis
        from discovery_candidates where account_id = any($1::uuid[])`, [ids]);

  const { rows: observations } = await query<{
    account_id: string; result_type: string | null; category: string | null;
    position: number | null; query: string | null; observed_name: string | null;
    observed_domain: string | null; observed_phone: string | null; observed_location: string | null;
  }>(`select account_id, result_type, category, position, query, observed_name,
             observed_domain, observed_phone, observed_location
        from search_observations where account_id = any($1::uuid[])
       order by position nulls last`, [ids]);

  /**
   * The person an email endpoint is attributed to, if any.
   *
   * Taken from the linked contact and nowhere else. A mailbox whose local part reads
   * like a name is not attribution -- that inference is the thing being audited.
   */
  const { rows: endpoints } = await query<{
    account_id: string; endpoint_id: string; endpoint_type: string;
    normalized_value: string; endpoint_role: string | null; person_name: string | null;
  }>(`select ce.account_id, ce.endpoint_id, ce.endpoint_type, ce.normalized_value,
             ce.endpoint_role, c.full_name as person_name
        from contact_endpoints ce
        left join contacts c on c.contact_id = ce.contact_id
       where ce.account_id = any($1::uuid[])`, [ids]);

  /**
   * Locations, counted three ways.
   *
   * A row with a street is a place. A row without one is a geography, and a row with
   * no recorded basis is a geography nobody can account for -- which is exactly what
   * the 66 legacy rows are: ZIP 32095, the ZIP the canary searched, on 66 Accounts.
   */
  //
  // `basis` arrived with migration 053 and the preview has to keep running against a
  // database that has not had it applied -- which is the point of a read-only tool:
  // production is where the question is asked, and production is by definition behind
  // the branch asking it. Where the column does not exist, no row can account for
  // itself, which is the same answer the column would give.
  const { rows: hasBasis } = await query<{ present: boolean }>(
    `select exists (select 1 from information_schema.columns
                     where table_name = 'locations' and column_name = 'basis') as present`);
  const basisExpression = hasBasis[0]?.present
    ? `count(*) filter (where basis is not null)::text` : `'0'::text`;

  /**
   * What each site calls itself, from the evidence `npm run identity:estate` records.
   *
   * The newest per Account, and only ones that have not been contradicted. An Account
   * nobody has asked about arrives with null, which the classifier reads as "nobody
   * asked" rather than as "the site named nothing".
   */
  const { rows: identities } = await query<{
    account_id: string; claim_text: string; notes: string | null;
  }>(
    `select distinct on (account_id) account_id, claim_text, notes
       from evidence_records
      where account_id = any($1::uuid[])
        and claim_key = 'first_party_site_name'
        and contradicted_by_evidence_id is null
      order by account_id, observed_at desc`, [ids]);

  const { rows: locations } = await query<{
    account_id: string; n: string; with_street: string; with_basis: string;
  }>(
    `select account_id, count(*)::text n,
            count(*) filter (where address_line_1 is not null)::text with_street,
            ${basisExpression} as with_basis
       from locations
      where account_id = any($1::uuid[])
      group by account_id`, [ids]);

  // The run that produced the state currently on the Account: the most recent one.
  const { rows: research } = await query<{
    account_id: string; status: string | null; completed_at: string | null;
    pages_fetched: number | null; pages_blocked: number | null;
    source_state: string | null;
  }>(`select distinct on (account_id) account_id, status, completed_at::text,
             adapter_results->>'source_state' as source_state,
             (adapter_results->>'pages_fetched')::int as pages_fetched,
             (adapter_results->>'pages_blocked')::int as pages_blocked
        from research_runs where account_id = any($1::uuid[])
       order by account_id, started_at desc`, [ids]);

  const { rows: activity } = await query<{
    account_id: string; with_actor: string; with_notes: string; system_rows: string;
  }>(`select account_id,
             count(*) filter (where actor_user_id is not null)::text with_actor,
             count(*) filter (where notes is not null or disposition is not null)::text with_notes,
             count(*) filter (where actor_user_id is null)::text system_rows
        from activities where account_id = any($1::uuid[]) group by account_id`, [ids]);

  const counts = async (table: string) => {
    const { rows } = await query<{ account_id: string; n: string }>(
      `select account_id, count(*)::text n from ${table}
        where account_id = any($1::uuid[]) group by account_id`, [ids]);
    return new Map(rows.map((r) => [r.account_id, Number(r.n)]));
  };
  const ownership = await counts('ownership_events');
  const followUps = await counts('follow_ups');
  const opportunities = await counts('opportunities');
  const contactAttempts = await counts('contact_attempts');
  const meetings = await counts('meeting_bookings');

  const profileIds = [...new Set(accounts
    .map((a) => a.primary_vertical_profile_id)
    .filter((id): id is string => !!id))];
  const terms = await verticalTermsByProfile(profileIds);
  // The trade's own words for itself, so the preview judges a provider category by the
  // same rule the miner does. Null on every historical observation, and that is the
  // point: when the miner starts capturing categories, both readers already agree.
  const aliases = new Map<string, string[]>();
  for (const profileId of profileIds) aliases.set(profileId, await serviceAliasesFor(profileId));

  const group = <T>(rows: T[], key: (row: T) => string): Map<string, T[]> => {
    const out = new Map<string, T[]>();
    for (const row of rows) {
      const k = key(row);
      const list = out.get(k); if (list) list.push(row); else out.set(k, [row]);
    }
    return out;
  };
  const candidatesBy = group(candidates, (r) => r.account_id);
  const observationsBy = group(observations, (r) => r.account_id);
  const endpointsBy = group(endpoints, (r) => r.account_id);
  const locationsBy = new Map(locations.map((r) => [r.account_id, Number(r.with_street)]));
  const locationClaimsBy = new Map(locations.map((r) => [r.account_id, {
    total: Number(r.n), withStreet: Number(r.with_street), withBasis: Number(r.with_basis),
  }]));
  const researchBy = new Map(research.map((r) => [r.account_id, r]));
  const activityBy = new Map(activity.map((r) => [r.account_id, r]));

  return accounts.map((account): AccountBundle => {
    const mine = endpointsBy.get(account.account_id) ?? [];
    const act = activityBy.get(account.account_id);
    const run = researchBy.get(account.account_id);
    return {
      accountId: account.account_id,
      canonicalName: account.canonical_name,
      canonicalDomain: account.canonical_domain,
      verticalProfileId: account.primary_vertical_profile_id,
      entityStatus: account.entity_status,
      entityStatusBasis: account.entity_status_basis,
      researchCompleteness: account.research_completeness,
      discoveredForGeographyType: account.discovered_for_geography_type,
      discoveredForGeography: account.discovered_for_geography,
      candidateSourceClasses: [...new Set((candidatesBy.get(account.account_id) ?? [])
        .map((c) => c.source_class).filter((c): c is string => !!c))],
      candidateResolvedNames: (candidatesBy.get(account.account_id) ?? [])
        .filter((c) => c.resolved_name)
        .map((c) => ({ name: c.resolved_name as string, basis: c.name_basis })),
      observations: (observationsBy.get(account.account_id) ?? []).map((o) => ({
        resultType: o.result_type, category: o.category, position: o.position,
        query: o.query, observedName: o.observed_name, observedDomain: o.observed_domain,
        observedPhone: o.observed_phone, observedLocation: o.observed_location,
      })),
      siteIdentity: (() => {
        const row = identities.find((entry) => entry.account_id === account.account_id);
        if (!row) return null;
        // The claim text is the sentence a reviewer reads; the name inside it is what
        // the comparison needs, so it is taken from the quotes rather than re-derived.
        const named = /"([^"]+)"/.exec(row.claim_text)?.[1] ?? null;
        // Decoded on the way in, not on the way out: the evidence keeps what the site
        // actually said, and the comparison uses what a person would read. An undecoded
        // `Solar Pool &amp; Roof` reads as a different company from `Solar Pool & Roof`,
        // which proposed suppressing a real roofer as somebody else's page.
        return named ? { name: decodeEntities(named), basis: row.notes } : null;
      })(),
      serviceAliases: account.primary_vertical_profile_id
        ? aliases.get(account.primary_vertical_profile_id) ?? [] : [],
      verticalTerms: account.primary_vertical_profile_id
        ? terms.get(account.primary_vertical_profile_id) ?? [] : [],
      emails: mine.filter((e) => e.endpoint_type === 'EMAIL').map((e) => ({
        endpointId: e.endpoint_id, normalizedValue: e.normalized_value,
        persistedRole: e.endpoint_role, attributedToPersonName: e.person_name,
      })),
      phoneCount: mine.filter((e) => e.endpoint_type === 'PHONE').length,
      locationCount: locationsBy.get(account.account_id) ?? 0,
      locationClaims: locationClaimsBy.get(account.account_id)
        ?? { total: 0, withStreet: 0, withBasis: 0 },
      latestResearch: run
        ? { status: run.status, sourceState: run.source_state,
            pagesFetched: run.pages_fetched, pagesBlocked: run.pages_blocked,
            completedAt: run.completed_at }
        : null,
      humanActivity: {
        claimed: account.claimed_at != null || account.current_owner_user_id != null,
        ownershipEvents: ownership.get(account.account_id) ?? 0,
        activitiesWithActor: Number(act?.with_actor ?? 0),
        activitiesWithNotesOrDisposition: Number(act?.with_notes ?? 0),
        followUps: followUps.get(account.account_id) ?? 0,
        opportunities: opportunities.get(account.account_id) ?? 0,
        contactAttempts: contactAttempts.get(account.account_id) ?? 0,
        meetings: meetings.get(account.account_id) ?? 0,
        emailsLogged: 0,
        systemActivities: Number(act?.system_rows ?? 0),
      },
    };
  });
}
