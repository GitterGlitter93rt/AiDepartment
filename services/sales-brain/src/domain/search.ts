import { query } from '../db/pool.js';
import type { Role } from './auth.js';
import { isUuid } from './ids.js';

/**
 * Inventory search over the canonical durable inventory.
 * Authority: rep-portal-api-contract.v1.md §3-§4, §12, §20,
 * rep-inventory-contract.v1.yaml search_request/search_behavior.
 *
 * Reads the database first and never blocks on live mining. Sort keys are
 * whitelisted; nothing from the request is interpolated into SQL.
 */

/** True when a filter id is a uuid we can safely send to PostgreSQL. */
function isUuidish(value: string | null | undefined): value is string {
  return isUuid(value);
}

export type OwnershipFilter = 'UNCLAIMED' | 'MINE' | 'CLAIMED_BY_OTHER' | 'ANY_VISIBLE';
export type ContactFilter =
  | 'phone_available' | 'verified_business_phone' | 'email_available' | 'phone_and_email'
  | 'decision_maker_known' | 'direct_phone' | 'contact_research_needed';
export type AdvertisingFilter = 'google_paid' | 'google_lsa' | 'meta_paid' | 'multichannel';
export type ResearchFilter = 'COMPLETE' | 'GOOD' | 'PARTIAL' | 'STALE';
export type MyProspectsFilter =
  | 'NEWLY_CLAIMED' | 'NOT_CONTACTED' | 'CALL_READY' | 'EMAIL_READY' | 'CALL_AND_EMAIL'
  | 'CALLBACK_DUE' | 'POSITIVE_REPLY' | 'OPPORTUNITY';

export interface GeographyFilter {
  type: 'zip_zcta' | 'city' | 'county' | 'state' | 'saved_market' | 'any';
  value?: string;
  /**
   * The state a city was qualified with, when the operator gave one.
   *
   * "Jacksonville, FL" and "Jacksonville, TX" are different markets, and without
   * this the search finds both and calls them one.
   */
  state?: string | null;
}

export interface SearchRequest {
  verticalProfileId?: string | null;
  geography?: GeographyFilter | null;
  minimumTier?: 'A' | 'B' | 'C' | 'D' | null;
  ownership?: OwnershipFilter;
  contactability?: ContactFilter[];
  advertising?: AdvertisingFilter[];
  research?: ResearchFilter[];
  marketId?: string | null;
  myProspectsFilter?: MyProspectsFilter | null;
  text?: string | null;
  page?: number;
  pageSize?: number;
  sort?: SortKey;
}

export type SortKey =
  | 'recommended_priority' | 'manual_score' | 'advertiser_strength' | 'research_freshness'
  | 'claimed_at' | 'follow_up_due' | 'company_name';

const SORT_SQL: Record<SortKey, string> = {
  // Tier first, then score, then advertiser evidence — with unscored rows last
  // rather than pretending an unknown score is a zero.
  recommended_priority:
    `case manual_tier when 'A' then 1 when 'B' then 2 when 'C' then 3 when 'D' then 4 else 5 end asc,
     manual_score desc nulls last, last_researched_at desc nulls last`,
  manual_score: 'manual_score desc nulls last',
  advertiser_strength:
    `case advertiser_strength when 'STRONG' then 1 when 'MODERATE' then 2 when 'WEAK' then 3
      when 'NONE' then 4 else 5 end asc, manual_score desc nulls last`,
  research_freshness: 'last_researched_at desc nulls last',
  claimed_at: 'claimed_at desc nulls last',
  follow_up_due: 'next_followup_due asc nulls last',
  company_name: 'company_name asc',
};

const TIER_ORDER: Record<string, string[]> = {
  A: ['A'],
  B: ['A', 'B'],
  C: ['A', 'B', 'C'],
  D: ['A', 'B', 'C', 'D'],
};

export interface ProspectRow {
  account_id: string;
  company_name: string;
  geography_summary: string;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  primary_vertical_profile_id: string | null;
  manual_score: number | null;
  manual_tier: string | null;
  advertiser_strength: string | null;
  research_completeness: string | null;
  last_researched_at: Date | null;
  ownership_state: string;
  is_suppressed: boolean;
  current_owner_user_id: string | null;
  owner_display_name: string | null;
  relationship_state: string;
  channel_state: string;
  contactability_summary: string;
  phone_count: number;
  email_count: number;
  has_direct_phone: boolean | null;
  has_named_email: boolean | null;
  best_contact_id: string | null;
  best_contact_name: string | null;
  best_contact_title: string | null;
  best_contact_role: string | null;
  best_contact_role_confidence: string | null;
  best_contact_is_role_only: boolean | null;
  google_paid: boolean | null;
  google_lsa: boolean | null;
  meta_paid: boolean | null;
  primary_hypothesis: string | null;
  primary_hypothesis_category: string | null;
  open_callbacks: number;
  next_followup_due: Date | null;
  last_activity_at: Date | null;
  activity_count: number;
  claimed_at: Date | null;
}

export interface SearchResponse {
  results: ProspectRow[];
  total: number;
  page: number;
  pageSize: number;
  coverage: CoverageSummary;
}

export interface CoverageSummary {
  /**
   * Accounts in this market that a tier filter is hiding because they have no tier.
   * Zero unless a minimum tier was asked for.
   */
  unscoredExcluded?: number;
  /**
   * Accounts an advertising filter is hiding because nobody has ever checked whether
   * they advertise -- as opposed to having checked and found nothing. Zero unless an
   * advertising filter was asked for.
   */
  unknownAdvertiserExcluded?: number;
  state: 'FRESH' | 'PARTIAL' | 'STALE' | 'NOT_YET_MINED' | 'REFRESHING';
  researchedCount: number;
  unclaimedCount: number;
  lastMinedAt: Date | null;
  activeJobId: string | null;
  /**
   * Whether the system can find a business it does not already hold.
   *
   * Without this the page said "Researching 32095 now... new ones will appear as
   * they land", and none could: with no search provider registered a market job can
   * only re-research inventory we already have. The operator reasonably read that
   * sentence as a search of the market.
   */
  discoveryAvailable: boolean;
  /** What the running job can actually do, when one is running. */
  activeJobScope: 'DISCOVER_NEW' | 'REFRESH_EXISTING' | null;
}

interface WhereBuild {
  clauses: string[];
  values: unknown[];
  /**
   * True when every clause reads a column that lives on `accounts` itself.
   *
   * The count then does not need prospect_inventory at all, which matters because
   * counting through the view evaluates three of its lateral subqueries for every
   * row -- 435 ms of the 485 ms an unfiltered page cost at 100,000 accounts. Any
   * filter on geography, contactability, advertising, hypothesis or activity is
   * derived from a lateral, so it clears this flag and the count goes back through
   * the view where it is correct.
   */
  accountOnly: boolean;
}

/** Columns the view renames. The count path reads the base table's own names. */
const BASE_COLUMN: Record<string, string> = { company_name: 'canonical_name' };

function buildWhere(
  request: SearchRequest, viewer: { userId: string; role: Role },
  target: 'view' | 'accounts' = 'view',
): WhereBuild {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let accountOnly = true;
  const push = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  /** Marks a clause as needing the view, because its column comes from a lateral. */
  const needsView = (): void => { accountOnly = false; };
  const column = (name: string): string =>
    target === 'accounts' ? (BASE_COLUMN[name] ?? name) : name;

  // Suppressed Accounts never appear as cold inventory. This is the single most
  // important filter in the system (SALES-TEAM-ACCESS-CURRENT.md §19).
  clauses.push('not is_suppressed');

  // A merged Account is a tombstone: a redirect, not a company. prospect_inventory
  // drops them, so the rows never showed one -- but the fast count path reads
  // `accounts` directly, and counted them. "1,001 results" above a thousand rows.
  if (target === 'accounts') clauses.push('merged_into_account_id is null');

  const ownership: OwnershipFilter = request.ownership ?? 'UNCLAIMED';
  if (request.myProspectsFilter !== undefined && request.myProspectsFilter !== null) {
    clauses.push(`current_owner_user_id = ${push(viewer.userId)}`);
  } else if (ownership === 'UNCLAIMED') {
    clauses.push(`ownership_state = 'UNCLAIMED'`);
    // A client or an active opportunity is not generic cold inventory even if
    // ownership somehow reads UNCLAIMED.
    clauses.push(`relationship_state not in ('CLIENT','PROPOSAL','ACTIVE_OPPORTUNITY')`);
  } else if (ownership === 'MINE') {
    clauses.push(`current_owner_user_id = ${push(viewer.userId)}`);
  } else if (ownership === 'CLAIMED_BY_OTHER') {
    clauses.push(`current_owner_user_id is not null and current_owner_user_id <> ${push(viewer.userId)}`);
  }

  // A vertical profile is keyed by a slug, so any text is a legal parameter and an
  // unknown one simply matches nothing.
  if (request.verticalProfileId) {
    clauses.push(`primary_vertical_profile_id = ${push(request.verticalProfileId)}`);
  }

  const geography = request.geography;
  if (geography && geography.value) {
    switch (geography.type) {
      case 'zip_zcta':
        needsView();
        clauses.push(`postal_code = ${push(geography.value.trim())}`);
        break;
      case 'city':
        needsView();
        clauses.push(`lower(city) = lower(${push(geography.value.trim())})`);
        // A city name qualified by a state stays qualified. There is a Jacksonville
        // in Florida and one in Texas.
        if (geography.state) clauses.push(`state_region = upper(${push(geography.state)})`);
        break;
      case 'state':
        needsView();
        clauses.push(`state_region = upper(${push(geography.value.trim())})`);
        break;
      default:
        break;
    }
  }

  // A market id is a uuid, so a filter that cannot be one names no market. Sending
  // it to PostgreSQL instead turns a typo in the URL bar into a 500 carrying a
  // database error message.
  if (isUuidish(request.marketId)) {
    clauses.push(
      `account_id in (select account_id from account_market_membership where market_id = ${push(request.marketId)})`,
    );
  } else if (request.marketId) {
    clauses.push('false');
  }

  if (request.minimumTier) {
    // An Account with no tier is not an Account below D. It is one nobody has
    // researched yet, and `manual_tier = any(...)` drops it silently -- so a rep
    // filtering "Tier B and better" saw an empty market and had no way to learn that
    // the companies were there and simply unscored. They are still excluded from the
    // filtered rows, because a tier filter that ignores the tier is not a filter;
    // what changes is that the page is told how many were left out and why.
    clauses.push(`manual_tier = any(${push(TIER_ORDER[request.minimumTier] ?? ['A', 'B', 'C', 'D'])})`);
  }

  for (const filter of request.contactability ?? []) {
    needsView();
    switch (filter) {
      case 'phone_available': clauses.push('phone_count > 0'); break;
      case 'email_available': clauses.push('email_count > 0'); break;
      case 'phone_and_email': clauses.push('phone_count > 0 and email_count > 0'); break;
      // "Direct phone" means an actual direct line. If that returns 28 rows it
      // returns 28 — front-desk numbers are never padded in (start prompt §5).
      case 'direct_phone': clauses.push('has_direct_phone'); break;
      case 'verified_business_phone': clauses.push('phone_count > 0'); break;
      case 'decision_maker_known':
        clauses.push('best_contact_name is not null and coalesce(best_contact_is_role_only, false) = false');
        break;
      case 'contact_research_needed': clauses.push(`contactability_summary = 'RESEARCH_NEEDED'`); break;
    }
  }

  for (const filter of request.advertising ?? []) {
    needsView();
    switch (filter) {
      case 'google_paid': clauses.push('coalesce(google_paid, false)'); break;
      case 'google_lsa': clauses.push('coalesce(google_lsa, false)'); break;
      case 'meta_paid': clauses.push('coalesce(meta_paid, false)'); break;
      case 'multichannel':
        clauses.push(
          '(coalesce(google_paid,false)::int + coalesce(google_lsa,false)::int + coalesce(meta_paid,false)::int) >= 2',
        );
        break;
    }
  }

  if (request.research?.length) {
    clauses.push(`research_completeness = any(${push(request.research)})`);
  }

  switch (request.myProspectsFilter) {
    case 'NEWLY_CLAIMED': clauses.push(`claimed_at > now() - interval '7 days'`); break;
    case 'NOT_CONTACTED': needsView(); clauses.push('activity_count = 0'); break;
    case 'CALL_READY': needsView(); clauses.push(`channel_state in ('CALL_READY','CALL_AND_EMAIL')`); break;
    case 'EMAIL_READY': needsView(); clauses.push(`channel_state in ('EMAIL_READY','CALL_AND_EMAIL')`); break;
    case 'CALL_AND_EMAIL': needsView(); clauses.push(`channel_state = 'CALL_AND_EMAIL'`); break;
    case 'CALLBACK_DUE':
      needsView();
      clauses.push('open_callbacks > 0 and next_followup_due <= now()');
      break;
    case 'POSITIVE_REPLY': clauses.push(`relationship_state = 'POSITIVE_REPLY'`); break;
    case 'OPPORTUNITY': clauses.push(`relationship_state in ('ACTIVE_OPPORTUNITY','PROPOSAL')`); break;
    default: break;
  }

  if (request.text?.trim()) {
    const term = `%${request.text.trim().toLowerCase()}%`;
    clauses.push(`(lower(${column('company_name')}) like ${push(term)} `
      + `or lower(coalesce(canonical_domain,'')) like $${values.length})`);
  }

  return { clauses, values, accountOnly };
}

export async function searchProspects(
  request: SearchRequest, viewer: { userId: string; role: Role },
): Promise<SearchResponse> {
  const page = Math.max(1, request.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, request.pageSize ?? 50));
  const sortKey: SortKey = SORT_SQL[request.sort as SortKey] ? (request.sort as SortKey) : 'recommended_priority';

  const build = buildWhere(request, viewer);
  const { clauses, values } = build;
  const where = clauses.length ? `where ${clauses.join(' and ')}` : '';

  // The count runs against accounts when no filter needs a lateral-derived column.
  // Counting through the view means evaluating three of its lateral subqueries for
  // every row, which was 435 ms of the 485 ms an unfiltered page cost at 100,000
  // accounts, for a number the page shows as "25,000 results".
  const countBuild = clauses.length > 0 && build.accountOnly
    ? buildWhere(request, viewer, 'accounts')
    : null;
  const countResult = countBuild
    ? await query<{ total: number }>(
      `select count(*)::bigint as total from accounts where ${countBuild.clauses.join(' and ')}`,
      countBuild.values)
    : await query<{ total: number }>(
      `select count(*)::bigint as total from prospect_inventory ${where}`, values);
  const total = countResult.rows[0]?.total ?? 0;

  // Two phases, on purpose, and two round trips rather than one query.
  //
  // prospect_inventory carries seven lateral subqueries. `select * ... limit 50` over
  // it evaluates all seven for every account before the sort can pick fifty, which at
  // twenty-five thousand accounts measured 1.8 seconds. Phase one asks only for the
  // page of ids, so Postgres prunes the laterals that no filter or sort mentions.
  // Phase two asks for those ids by equality, which becomes an index lookup on
  // accounts, so the projection is assembled for fifty rows.
  //
  // A single query with the page as a CTE is *slower* than the original -- the CTE is
  // materialised and the view is then scanned again to join against it, so all seven
  // laterals run twice over the whole table. Measured at 2.2 seconds. Two round trips
  // it is.
  const pageResult = await query<{ account_id: string }>(
    `select account_id from prospect_inventory ${where}
      order by ${SORT_SQL[sortKey]}, account_id
      limit $${values.length + 1} offset $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  const ids = pageResult.rows.map((row) => row.account_id);

  const rowsResult = ids.length === 0
    ? { rows: [] as ProspectRow[] }
    : await query<ProspectRow>(
      `select * from prospect_inventory where account_id = any($1::uuid[])
        order by ${SORT_SQL[sortKey]}, account_id`,
      [ids],
    );

  return {
    results: rowsResult.rows,
    total,
    page,
    pageSize,
    coverage: await coverageFor(request),
  };
}

/**
 * Honest coverage reporting. The UI must never imply a search found every business
 * in a market unless the coverage model actually supports that (browse-claim §10).
 */
export async function coverageFor(request: SearchRequest): Promise<CoverageSummary> {
  const unscoredExcluded = request.minimumTier
    ? await countUnscoredInScope(request) : 0;
  const { unknownAdvertiserCount } = await import('./advertiserEvidence.js');
  const unknownAdvertiserExcluded = (request.advertising ?? []).length > 0
    ? await unknownAdvertiserCount({
      verticalProfileId: request.verticalProfileId ?? null,
      geography: request.geography ?? null,
    })
    : 0;
  const geography = request.geography;
  const { availableDiscoveryAdapters } = await import('../workers/marketMiner.js');
  const discoveryAvailable = availableDiscoveryAdapters().length > 0;

  // Same rule as the search itself: a market id that cannot be a uuid is not a
  // filter, it is a typo, and it must not reach the database.
  const verticalProfileId = request.verticalProfileId ?? null;
  const marketId = isUuidish(request.marketId) ? request.marketId : null;

  if (!geography?.value && !marketId) {
    return {
      state: 'FRESH', researchedCount: 0, unclaimedCount: 0, lastMinedAt: null,
      activeJobId: null, discoveryAvailable, activeJobScope: null, unscoredExcluded,
      unknownAdvertiserExcluded,
    };
  }

  const conditions: string[] = ['not is_suppressed'];
  const values: unknown[] = [];
  if (verticalProfileId) {
    values.push(verticalProfileId);
    conditions.push(`primary_vertical_profile_id = $${values.length}`);
  }
  if (geography?.type === 'zip_zcta' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(`postal_code = $${values.length}`);
  } else if (geography?.type === 'city' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(`lower(city) = lower($${values.length})`);
    if (geography.state) {
      values.push(geography.state);
      conditions.push(`state_region = upper($${values.length})`);
    }
  } else if (geography?.type === 'state' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(`state_region = upper($${values.length})`);
  }
  if (marketId) {
    values.push(marketId);
    conditions.push(
      `account_id in (select account_id from account_market_membership where market_id = $${values.length})`,
    );
  }

  const { rows } = await query<{
    researched: number; unclaimed: number; fresh: number; last_researched: Date | null;
  }>(
    `select count(*)::bigint as researched,
            count(*) filter (where ownership_state = 'UNCLAIMED')::bigint as unclaimed,
            count(*) filter (where research_fresh_until > now())::bigint as fresh,
            max(last_researched_at) as last_researched
       from prospect_inventory where ${conditions.join(' and ')}`,
    values,
  );
  const summary = rows[0]!;

  const jobResult = await query<{ job_id: string; job_type: string }>(
    `select job_id, job_type from jobs
      where status in ('QUEUED','RUNNING') and job_type in ('market_mine','zip_research')
        and payload->>'geography_value' = $1
      order by created_at desc limit 1`,
    [geography?.value ?? ''],
  );
  const activeJobId = jobResult.rows[0]?.job_id ?? null;
  // A zip_research job never looks for new businesses, and a market_mine job can
  // only do so when a provider exists. Either way the page must say which.
  const activeJobScope: CoverageSummary['activeJobScope'] = !activeJobId ? null
    : jobResult.rows[0]!.job_type === 'zip_research' || !discoveryAvailable
      ? 'REFRESH_EXISTING' : 'DISCOVER_NEW';

  let state: CoverageSummary['state'];
  if (activeJobId) state = 'REFRESHING';
  else if (summary.researched === 0) state = 'NOT_YET_MINED';
  else if (summary.fresh === 0) state = 'STALE';
  else if (summary.fresh < summary.researched) state = 'PARTIAL';
  else state = 'FRESH';

  return {
    state,
    researchedCount: summary.researched,
    unclaimedCount: summary.unclaimed,
    lastMinedAt: summary.last_researched,
    activeJobId,
    discoveryAvailable,
    activeJobScope,
    unscoredExcluded,
    unknownAdvertiserExcluded,
  };
}

/**
 * How many Accounts in this market the tier filter is hiding for want of a tier.
 *
 * Counted with the same geography and vertical the search used, so the number is
 * about the market the rep is looking at rather than the whole database.
 */
async function countUnscoredInScope(request: SearchRequest): Promise<number> {
  const conditions: string[] = ['not is_suppressed', 'manual_tier is null'];
  const values: unknown[] = [];
  const geography = request.geography;

  if (request.verticalProfileId) {
    values.push(request.verticalProfileId);
    conditions.push(`primary_vertical_profile_id = $${values.length}`);
  }
  if (geography?.type === 'zip_zcta' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(`postal_code = $${values.length}`);
  } else if (geography?.type === 'city' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(`lower(city) = lower($${values.length})`);
  } else if (geography?.type === 'state' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(`state_region = upper($${values.length})`);
  }

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from prospect_inventory where ${conditions.join(' and ')}`,
    values,
  );
  return rows[0]?.n ?? 0;
}

export async function recordSearchContext(
  userId: string, request: SearchRequest, resultCount: number,
): Promise<string> {
  const { rows } = await query<{ search_context_id: string }>(
    `insert into search_contexts (user_id, vertical_profile_id, geography, filters, sort, result_count)
     values ($1, $2, $3, $4, $5, $6) returning search_context_id`,
    [
      userId, request.verticalProfileId ?? null, JSON.stringify(request.geography ?? {}),
      JSON.stringify({
        minimumTier: request.minimumTier ?? null,
        ownership: request.ownership ?? 'UNCLAIMED',
        contactability: request.contactability ?? [],
        advertising: request.advertising ?? [],
        research: request.research ?? [],
        marketId: isUuidish(request.marketId) ? request.marketId : null,
      }),
      request.sort ?? 'recommended_priority', resultCount,
    ],
  );
  return rows[0]!.search_context_id;
}
