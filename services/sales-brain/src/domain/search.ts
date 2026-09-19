import { query } from '../db/pool.js';
import { SCORE_VERSION } from '../scoring/model.js';
import type { Role } from './auth.js';
import { isUuid } from './ids.js';
import { workableEntitySql } from './entityStatus.js';

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
/**
 * The research states a rep can filter by.
 *
 * THIN was missing, and it was the only value besides STALE that anything ever
 * wrote -- so the six companies in that state were unreachable by this filter while
 * COMPLETE, GOOD and PARTIAL matched nothing at all. A filter whose options are
 * mostly guaranteed-empty teaches a rep that the inventory is thinner than it is.
 */
export type ResearchFilter = 'COMPLETE' | 'GOOD' | 'PARTIAL' | 'THIN' | 'STALE';
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

/**
 * A score counts as current only when the ruleset that produced it is the one in
 * force. Anything else is history.
 *
 * The filters and sorts below read `manual_tier` / `manual_score`, which are the
 * *projection* of the newest score -- and after a SCORE_VERSION bump that projection
 * holds the previous policy's answer until the recompute sweep reaches the Account.
 * Without this guard a superseded Tier A satisfied `minimumTier=B`, counted toward
 * the total, and outranked a current Tier B in `recommended_priority`: the surface
 * used to choose whom to call, driven by a ruleset no longer in force.
 *
 * `prospect_inventory` does not expose `score_version`, so the view path correlates
 * to `accounts` by primary key. That is deliberately not solved with a migration:
 * the view is defined in one place as a full `create view`, replacing it would mean
 * reproducing the whole definition, and the view path is only taken when a
 * lateral-derived filter is already in play.
 */
const SCORE_VERSION_LITERAL = (() => {
  if (!/^[A-Za-z0-9._-]+$/.test(SCORE_VERSION)) {
    throw new Error(`SCORE_VERSION "${SCORE_VERSION}" cannot be inlined into SQL`);
  }
  return `'${SCORE_VERSION}'`;
})();

const SCORE_IS_CURRENT_ACCOUNTS = `score_version = ${SCORE_VERSION_LITERAL}`;
const SCORE_IS_CURRENT_VIEW =
  `exists (select 1 from accounts cur
            where cur.account_id = prospect_inventory.account_id
              and cur.score_version = ${SCORE_VERSION_LITERAL})`;

/** Tier and score as they may drive a *current* decision: null when superseded. */
const CURRENT_TIER_ACCOUNTS = `case when ${SCORE_IS_CURRENT_ACCOUNTS} then manual_tier end`;
const CURRENT_SCORE_ACCOUNTS = `case when ${SCORE_IS_CURRENT_ACCOUNTS} then manual_score end`;
const CURRENT_TIER_VIEW = `case when ${SCORE_IS_CURRENT_VIEW} then manual_tier end`;
const CURRENT_SCORE_VIEW = `case when ${SCORE_IS_CURRENT_VIEW} then manual_score end`;

const tierRank = (expr: string): string =>
  `case ${expr} when 'A' then 1 when 'B' then 2 when 'C' then 3 when 'D' then 4 else 5 end asc`;

/**
 * The same orders, expressed against `accounts` rather than the view.
 *
 * Only the keys whose columns actually live on accounts. `follow_up_due` reads a
 * lateral, so a search sorted by it still pages through the view -- correctly, and
 * more slowly, which is the right trade for the rarer sort.
 */
const SORT_SQL_ACCOUNTS: Partial<Record<SortKey, string>> = {
  recommended_priority:
    `${tierRank(CURRENT_TIER_ACCOUNTS)},
     ${CURRENT_SCORE_ACCOUNTS} desc nulls last, a.last_researched_at desc nulls last`,
  manual_score: `${CURRENT_SCORE_ACCOUNTS} desc nulls last`,
  advertiser_strength:
    `case a.advertiser_strength when 'STRONG' then 1 when 'MODERATE' then 2 when 'WEAK' then 3
      when 'NONE' then 4 else 5 end asc, ${CURRENT_SCORE_ACCOUNTS} desc nulls last`,
  research_freshness: 'a.last_researched_at desc nulls last',
  claimed_at: 'a.claimed_at desc nulls last',
  company_name: 'a.canonical_name asc',
};

const SORT_SQL: Record<SortKey, string> = {
  // Tier first, then score, then advertiser evidence — with unscored rows last
  // rather than pretending an unknown score is a zero, and with a *superseded* score
  // treated the same way. A 14-point v2 score must not outrank a 7-point current one
  // as though both were calculated under the same rules.
  recommended_priority:
    `${tierRank(CURRENT_TIER_VIEW)},
     ${CURRENT_SCORE_VIEW} desc nulls last, last_researched_at desc nulls last`,
  manual_score: `${CURRENT_SCORE_VIEW} desc nulls last`,
  advertiser_strength:
    `case advertiser_strength when 'STRONG' then 1 when 'MODERATE' then 2 when 'WEAK' then 3
      when 'NONE' then 4 else 5 end asc, ${CURRENT_SCORE_VIEW} desc nulls last`,
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

/**
 * What external discovery has actually done for this market.
 *
 * "No rows" meant eleven different things and the page said the same sentence for
 * all of them: nobody has searched, a search is running, a search could not run,
 * a search failed, a search is still with the provider, a search half-worked, a
 * search genuinely found nothing, and a search that found companies we already
 * hold. A rep reading one empty state cannot act on any of them.
 */
export type DiscoveryState =
  /** No external search has ever been made for this market. */
  | 'NEVER_RUN'
  /** A search is in flight right now. */
  | 'RUNNING'
  /** No provider is configured, so no external search is possible. */
  | 'BLOCKED'
  /** The provider accepted a search and has not answered yet. */
  | 'PENDING'
  /**
   * The provider finished a search after the run that bought it had already ended,
   * and its results are in inventory.
   *
   * Distinct from PENDING, which says something is still owed, and emphatically
   * distinct from PROVIDER_UNAVAILABLE, which says no provider answered. A task is
   * closed COLLECTED only once its businesses have been ingested, so this is a
   * completed, paid-for search whose answer we already hold -- and saying otherwise
   * invites buying the same market again to learn what is already here.
   */
  | 'FULFILLED_LATER'
  /** Every provider that was asked could not answer. */
  | 'PROVIDER_UNAVAILABLE'
  /** Some of the market was searched and some was not. */
  | 'PARTIAL'
  /** A provider searched and returned nothing usable. */
  | 'ZERO_RESULTS'
  /** A provider searched and every business it found was one we already hold. */
  | 'MATCHED_EXISTING'
  /** A provider searched and added companies we did not have. */
  | 'FOUND_NEW'
  /** The last successful search is old enough that the market may have moved. */
  | 'STALE'
  /**
   * The market was switched off, so the last run bought nothing. Distinct from
   * ZERO_RESULTS, which this used to fall through to: a paused market reported
   * itself as a market a provider had searched and found empty.
   */
  | 'MARKET_DISABLED';

export interface DiscoveryCoverage {
  state: DiscoveryState;
  /** When the last completed external search ran. */
  lastRunAt: Date | null;
  /** The job's own sentence about what happened. */
  reason: string | null;
  providerRows: number;
  matchedExisting: number;
  discoveredNew: number;
  /**
   * Identities the last run resolved and refused, and ones it could not name.
   *
   * The rows are not the point; these are. A market that answers "113 rows, 0 new
   * companies" reads as a thin market, and the same run reported as "113 rows, 47
   * identities, 11 directories and 34 pages about companies" reads as what it is.
   */
  entitiesRejected: number;
  entitiesNeedingReview: number;
}

/** How old a successful discovery run may be before the market is called stale. */
export const DISCOVERY_STALE_AFTER_DAYS = Number(
  process.env['DISCOVERY_STALE_AFTER_DAYS'] ?? '14');

export interface CoverageSummary {
  /**
   * What external discovery has done here, as one of ten distinguishable states
   * rather than the absence of rows.
   */
  discovery?: DiscoveryCoverage;
  /**
   * Accounts in this market that a tier filter is hiding because they have no tier.
   * Zero unless a minimum tier was asked for.
   */
  unscoredExcluded?: number;
  /**
   * Accounts a tier filter is hiding because their tier came from a superseded
   * ruleset and has not been recomputed yet.
   *
   * Deliberately not folded into `unscoredExcluded`. Three states are distinguishable
   * and they imply different things: never scored means research is owed, scored
   * under the current policy means the tier is the answer, and scored under a
   * superseded policy means the recompute sweep has not reached it. Collapsing the
   * third into the first would tell an operator to research a company that has
   * already been researched.
   */
  staleScoreExcluded?: number;
  /**
   * Accounts an advertising filter is hiding because nobody has ever checked whether
   * they advertise -- as opposed to having checked and found nothing. Zero unless an
   * advertising filter was asked for.
   */
  unknownAdvertiserExcluded?: number;
  /**
   * Records in this market that nobody may work because nothing has established they
   * are companies.
   *
   * Reported rather than quietly dropped. A market whose inventory falls from 65 to 3
   * has to say where the other 62 went, or the honest fix looks like data loss -- and
   * the number is also the measure of how much of a market's inventory was junk.
   */
  unverifiedExcluded?: number;
  state:
    | 'FRESH' | 'PARTIAL' | 'STALE' | 'NOT_YET_MINED' | 'NOT_YET_RESEARCHED' | 'REFRESHING'
    /**
     * No market was named, so none of the counts below describe one. Searching by
     * industry alone is an ordinary thing a rep does, and this used to answer FRESH
     * with zeroes -- the most reassuring state there is, about a market nobody
     * asked about, printed beside a list of claimable companies.
     */
    | 'NO_MARKET';
  /**
   * Accounts here that somebody has actually researched.
   *
   * This used to be every Account in scope, researched or not, and the stale branch
   * printed it as "N researched prospects, but the research has aged past its
   * freshness window. Treat advertising signals as historical." Said of a market
   * that had just been discovered and never researched, every clause of that is
   * false: nothing was researched, nothing aged, and there are no advertising
   * signals to treat as anything. Never-checked and checked-a-while-ago are
   * different states and a rep acts differently on them.
   */
  researchedCount: number;
  /** Everything here, researched or not. */
  inScopeCount: number;
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
/**
 * Words a rep types that do not narrow which company they mean.
 *
 * Connectors, and the legal suffixes that are in our stored name about half the time
 * and in what somebody types almost never.
 */
const SEARCH_STOPWORDS: ReadonlySet<string> = new Set([
  'and', 'the', 'of', 'an', 'inc', 'llc', 'ltd', 'co', 'corp', 'company',
]);

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
    // Nor is something nobody has established to be a company.
    //
    // Cold inventory is the one list the product hands a rep and says "these are
    // businesses you can call". Nineteen of the canary's sixty-five were a news
    // article, a Reddit thread, an HTTP 500 page and a dealer locator, and they sat
    // in exactly this list. The same rule that refuses the claim decides the list, so
    // a rep is never shown a row that will be refused when they click it.
    //
    // Only the cold list. A record somebody already holds stays visible to them
    // whatever its status: you cannot hide from a rep what is already in their hands,
    // and the account page is where they are told what is wrong with it.
    if (target === 'accounts') {
      clauses.push(workableEntitySql('a'));
    } else {
      needsView();
      clauses.push(`exists (select 1 from accounts ea
                             where ea.account_id = prospect_inventory.account_id
                               and ${workableEntitySql('ea')})`);
    }
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
    // On the accounts target this is an existence test against locations, which is
    // an index lookup. Through the view it forced every lateral to be evaluated for
    // every account in scope -- and "HVAC in 32095" is the query this product is
    // built around, so it was the slowest thing a rep does most often.
    // One deliberate behaviour change comes with this. The view exposes a single
    // primary location per Account -- headquarters if flagged, else the oldest -- so
    // a ZIP search through it missed a company whose head office is elsewhere and
    // whose branch is in the ZIP. The existence test finds it. That is the broader
    // and more useful reading of "businesses in 32095", and it is the same scope
    // planMarketRefresh has always used, so the rep's search and the miner's refresh
    // now cover the same companies instead of disagreeing.
    const onAccounts = target === 'accounts';
    const geoExists = (predicate: string): string =>
      `exists (select 1 from locations gl
                where gl.account_id = a.account_id and gl.is_active and ${predicate})`;
    switch (geography.type) {
      case 'zip_zcta': {
        // Verified address, or the market it was discovered in.
        //
        // The miner no longer copies the searched ZIP into a location, because that
        // manufactured an address for every company a provider returned without one.
        // Those companies are still in this market -- that is how they were found --
        // so the filter reads both facts. Which one matched is a separate question the
        // read model answers; this decides only whether to show the row at all.
        const zip = push(geography.value.trim());
        const discovered = `a.discovered_for_geography = ${zip}`;
        if (onAccounts) {
          clauses.push(`(${geoExists(`gl.postal_code = ${zip}`)} or ${discovered})`);
        } else {
          needsView();
          // The view exposes no discovery provenance and is defined once as a full
          // `create view`, so this correlates back to accounts by primary key rather
          // than replacing it -- the same shape the score-version filter uses.
          clauses.push(`(postal_code = ${zip} or exists (select 1 from accounts da `
            + `where da.account_id = prospect_inventory.account_id `
            + `and da.discovered_for_geography = ${zip}))`);
        }
        break;
      }
      case 'city': {
        const city = push(geography.value.trim());
        if (onAccounts) {
          const state = geography.state ? push(geography.state) : null;
          clauses.push(geoExists(state
            ? `lower(gl.city) = lower(${city}) and gl.state_region = upper(${state})`
            : `lower(gl.city) = lower(${city})`));
        } else {
          needsView();
          clauses.push(`lower(city) = lower(${city})`);
          // A city name qualified by a state stays qualified. There is a
          // Jacksonville in Florida and one in Texas.
          if (geography.state) clauses.push(`state_region = upper(${push(geography.state)})`);
        }
        break;
      }
      case 'state':
        if (onAccounts) {
          clauses.push(geoExists(`gl.state_region = upper(${push(geography.value.trim())})`));
        } else {
          needsView();
          clauses.push(`state_region = upper(${push(geography.value.trim())})`);
        }
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
    // ...and a tier from a superseded ruleset is not a current tier. It stays in the
    // database as provenance and is reported separately as `staleScoreExcluded`, but
    // it cannot satisfy a filter that promises a current Tier A/B result.
    const tierExpr = target === 'accounts' ? CURRENT_TIER_ACCOUNTS : CURRENT_TIER_VIEW;
    clauses.push(
      `${tierExpr} = any(${push(TIER_ORDER[request.minimumTier] ?? ['A', 'B', 'C', 'D'])})`);
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

  /**
   * Finding a company you already know the name of.
   *
   * The box matched `like '%term%'` against the name and the domain, so it could only
   * find a company somebody spelled exactly as we stored it. "Del Aire" does not
   * match "Del-Air Heating & Air Conditioning" and "Del-Air" does not match "Del Aire
   * Plumbing": one hyphen, and a rep looking up a company they are about to call is
   * told we do not have it. They then create it again, or conclude the market is
   * empty.
   *
   * So the comparison is made on both sides with the punctuation removed, which costs
   * one `regexp_replace` over a few hundred rows and makes spacing, hyphens,
   * ampersands and periods stop mattering. Substring matching is kept as well, so a
   * partial name still works.
   *
   * A phone number and an email address are also how a rep identifies a company --
   * from a missed call, or a reply -- and neither was searchable at all. A term
   * carrying at least seven digits is looked up as a phone, compared digits-only so
   * "(407) 555-0150", "407-555-0150" and "+14075550150" are one number. A term
   * containing "@" is looked up as an email.
   */
  if (request.text?.trim()) {
    const raw = request.text.trim().toLowerCase();
    const term = `%${raw}%`;
    const squashed = `%${raw.replace(/[^a-z0-9]+/g, '')}%`;
    const digits = raw.replace(/\D/g, '');
    // The row this subquery correlates to, which differs between the two read paths:
    // the fast count reads `accounts a` directly and everything else reads the view.
    const outerId = target === 'accounts' ? 'a.account_id' : 'prospect_inventory.account_id';
    const name = column('company_name');
    const termParam = push(term);
    const squashedParam = push(squashed);

    const parts = [
      `lower(${name}) like ${termParam}`,
      `regexp_replace(lower(${name}), '[^a-z0-9]+', '', 'g') like ${squashedParam}`,
      `lower(coalesce(canonical_domain,'')) like ${termParam}`,
      `regexp_replace(lower(coalesce(canonical_domain,'')), '[^a-z0-9]+', '', 'g') `
        + `like ${squashedParam}`,
    ];

    /**
     * "Del Aire" and "Del-Air" are not the same string with different punctuation.
     *
     * Removing the punctuation gives "delaire" and "delair", which still do not match:
     * this is a spelling the rep half-remembers, which is the normal case when
     * somebody is looking up a company they are about to call. So each word of the
     * query has to match some word of the name, and a word matches when either is a
     * prefix of the other -- "air" and "aire", "heating" and "heating".
     *
     * Every word must match, so this narrows rather than widens: "Del Aire" finds
     * Del-Air and does not find Bayside Cooling. The reverse direction needs a word of
     * at least three letters, or a stray two-letter word in a company name would match
     * almost any query beginning with those letters.
     *
     * Connectors and company suffixes are dropped, because a rep types "Heating and
     * Air" for a company stored as "Heating & Air" and means the same company.
     */
    const tokens = raw.split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2 && !SEARCH_STOPWORDS.has(token));
    if (tokens.length > 0) {
      const words = `regexp_split_to_table(regexp_replace(`
        + `lower(coalesce(${name},'') || ' ' || coalesce(canonical_domain,'')), `
        + `'[^a-z0-9]+', ' ', 'g'), ' ')`;
      const perToken = tokens.map((token) => {
        const prefixParam = push(`${token}%`);
        const tokenParam = push(token);
        return `exists (select 1 from ${words} as w where w <> '' `
          + `and (w like ${prefixParam} or (length(w) >= 3 and ${tokenParam} like w || '%')))`;
      });
      parts.push(`(${perToken.join(' and ')})`);
    }

    if (digits.length >= 7) {
      const digitsParam = push(`%${digits}%`);
      parts.push(`exists (select 1 from contact_endpoints ep `
        + `where ep.account_id = ${outerId} and ep.endpoint_type = 'PHONE' `
        + `and regexp_replace(ep.normalized_value, '[^0-9]', '', 'g') like ${digitsParam})`);
    }
    if (raw.includes('@')) {
      parts.push(`exists (select 1 from contact_endpoints ep `
        + `where ep.account_id = ${outerId} and ep.endpoint_type = 'EMAIL' `
        + `and lower(ep.normalized_value) like ${termParam})`);
    }

    clauses.push(`(${parts.join(' or ')})`);
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
  // Decided by what the accounts target can answer, not by what the view build
  // needed. Geography is a lateral column in the view and an index lookup against
  // locations on the base tables, so asking the view whether the fast path applies
  // ruled it out for every ZIP search -- the query this product is built around.
  const accountsBuild = clauses.length > 0 ? buildWhere(request, viewer, 'accounts') : null;
  const countBuild = accountsBuild?.accountOnly ? accountsBuild : null;
  const countResult = countBuild
    ? await query<{ total: number }>(
      `select count(*)::bigint as total from accounts a where ${countBuild.clauses.join(' and ')}`,
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
  //
  // Phase one runs on accounts whenever the filter and the sort both live there,
  // which includes the query this product is built around: a vertical and a ZIP.
  // Through the view that filter forced every lateral to be evaluated for every
  // account in the market before fifty could be picked.
  const accountsSort = SORT_SQL_ACCOUNTS[sortKey];
  const pageResult = countBuild && accountsSort
    ? await query<{ account_id: string }>(
      `select a.account_id from accounts a where ${countBuild.clauses.join(' and ')}
        order by ${accountsSort}, a.account_id
        limit $${countBuild.values.length + 1} offset $${countBuild.values.length + 2}`,
      [...countBuild.values, pageSize, (page - 1) * pageSize],
    )
    : await query<{ account_id: string }>(
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
 * The geography kinds that name an actual place, and so can appear in a job payload.
 *
 * `any` and `saved_market` are not places; constraining a job lookup by either would
 * match nothing and read as "never searched".
 */
const PLACE_TYPES = new Set<GeographyFilter['type']>(
  ['zip_zcta', 'city', 'county', 'state']);

/**
 * Honest coverage reporting. The UI must never imply a search found every business
 * in a market unless the coverage model actually supports that (browse-claim §10).
 */
export async function coverageFor(request: SearchRequest): Promise<CoverageSummary> {
  const unscoredExcluded = request.minimumTier
    ? await countUnscoredInScope(request) : 0;
  const staleScoreExcluded = request.minimumTier
    ? await countStaleScoreInScope(request) : 0;
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
      state: 'NO_MARKET', researchedCount: 0, inScopeCount: 0, unclaimedCount: 0,
      lastMinedAt: null,
      activeJobId: null, discoveryAvailable, activeJobScope: null, unscoredExcluded,
      // Also reported on this path. Omitting it here made the count silently absent
      // for every search without a geography -- which is the default view.
      staleScoreExcluded,
      unknownAdvertiserExcluded,
    };
  }

  const conditions: string[] = ['not a.is_suppressed', 'a.merged_into_account_id is null'];
  const values: unknown[] = [];
  if (verticalProfileId) {
    values.push(verticalProfileId);
    conditions.push(`a.primary_vertical_profile_id = $${values.length}`);
  }
  if (geography?.type === 'zip_zcta' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(inMarket(`l.postal_code = $${values.length}`, `$${values.length}`));
  } else if (geography?.type === 'city' && geography.value) {
    values.push(geography.value.trim());
    const cityClause = `lower(l.city) = lower($${values.length})`;
    if (geography.state) {
      values.push(geography.state);
      conditions.push(locationExists(
        `${cityClause} and l.state_region = upper($${values.length})`));
    } else {
      conditions.push(locationExists(cityClause));
    }
  } else if (geography?.type === 'state' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(locationExists(`l.state_region = upper($${values.length})`));
  }
  if (marketId) {
    values.push(marketId);
    conditions.push(
      `a.account_id in (select account_id from account_market_membership where market_id = $${values.length})`,
    );
  }

  // Counted from the base tables, not through prospect_inventory.
  //
  // Every column this needs -- suppression, ownership, research freshness, the
  // location -- lives on accounts and locations. Counting through the view made
  // PostgreSQL evaluate its lateral subqueries for every row in scope: 297ms at a
  // hundred thousand accounts, for four numbers, on every render of Find Prospects
  // and every poll of the coverage endpoint. Geography is an `exists` rather than a
  // join so an Account with two locations in one ZIP is still one Account.
  const { rows } = await query<{
    in_scope: number; researched: number; unclaimed: number; unverified: number;
    fresh: number; last_researched: Date | null;
  }>(
    `select count(*)::bigint as in_scope,
            count(*) filter (where a.last_researched_at is not null)::bigint as researched,
            -- Claimable, which is what the number is read as. It used to count every
            -- unowned row in the market, including the ones the list will not show
            -- and the claim will refuse.
            count(*) filter (where a.ownership_state = 'UNCLAIMED'
                               and ${workableEntitySql('a')})::bigint as unclaimed,
            count(*) filter (where a.ownership_state = 'UNCLAIMED'
                               and not ${workableEntitySql('a')})::bigint as unverified,
            count(*) filter (where a.research_fresh_until > now())::bigint as fresh,
            max(a.last_researched_at) as last_researched
       from accounts a where ${conditions.join(' and ')}`,
    values,
  );
  const summary = rows[0]!;

  // Scoped to the vertical as well as the place, for the same reason the discovery
  // query below is: a Roofing search of 32095 is not news about Plumbing in 32095,
  // and reporting one as the other told a rep a search was running for a market
  // nobody had searched.
  //
  // Lenient where the historical query is strict, and the asymmetry is deliberate.
  // The two failures are not symmetrical: mis-attributing a *finished* run invents
  // coverage that never happened, while hiding a *running* one tells a rep the
  // market is idle and invites them to buy a search that is already in flight. So a
  // job that does not name a vertical -- which a zip_research refresh does not -- is
  // still reported as active here, and still excluded from coverage there.
  const jobResult = await query<{ job_id: string; job_type: string }>(
    `select job_id, job_type from jobs
      where status in ('QUEUED','RUNNING') and job_type in ('market_mine','zip_research')
        and payload->>'geography_value' = $1
        and ($2::text is null
             or payload->>'vertical_profile_id' is null
             or payload->>'vertical_profile_id' = $2)
      order by created_at desc limit 1`,
    [geography?.value ?? '', verticalProfileId],
  );
  const activeJobId = jobResult.rows[0]?.job_id ?? null;
  // A zip_research job never looks for new businesses, and a market_mine job can
  // only do so when a provider exists. Either way the page must say which.
  const activeJobScope: CoverageSummary['activeJobScope'] = !activeJobId ? null
    : jobResult.rows[0]!.job_type === 'zip_research' || !discoveryAvailable
      ? 'REFRESH_EXISTING' : 'DISCOVER_NEW';

  let state: CoverageSummary['state'];
  if (activeJobId) state = 'REFRESHING';
  else if (summary.in_scope === 0) state = 'NOT_YET_MINED';
  // We hold companies here and have never looked into any of them. Saying their
  // research has "aged" invites a rep to treat never-checked as historically-checked.
  else if (summary.researched === 0) state = 'NOT_YET_RESEARCHED';
  else if (summary.fresh === 0) state = 'STALE';
  else if (summary.fresh < summary.researched) state = 'PARTIAL';
  else state = 'FRESH';

  // The whole market identity, not just the place. Passing geography alone is what
  // let one vertical's discovery history answer for another's.
  const discovery = await discoveryCoverageFor({
    geographyValue: geography?.value ?? null,
    verticalProfileId,
    // Only a real place type constrains anything. `any` and `saved_market` are ways
    // of *not* naming one, and no job payload records them.
    geographyType: geography && PLACE_TYPES.has(geography.type) ? geography.type : null,
    marketId,
    discoveryAvailable, activeJobId, activeJobScope,
  });

  return {
    state,
    researchedCount: summary.researched,
    inScopeCount: summary.in_scope,
    unclaimedCount: summary.unclaimed,
    lastMinedAt: summary.last_researched,
    activeJobId,
    discoveryAvailable,
    activeJobScope,
    unscoredExcluded,
    staleScoreExcluded,
    unknownAdvertiserExcluded,
    unverifiedExcluded: summary.unverified,
    discovery,
  };
}

/**
 * What external discovery has done for this market, from the jobs that ran.
 *
 * Read from the last completed `market_mine` job rather than inferred from how many
 * rows came back, because the row count cannot tell a market with nothing in it from
 * a market nobody has searched.
 */
export async function discoveryCoverageFor(input: {
  geographyValue: string | null;
  discoveryAvailable: boolean;
  activeJobId: string | null;
  activeJobScope: 'DISCOVER_NEW' | 'REFRESH_EXISTING' | null;
  /**
   * The rest of the market identity.
   *
   * Optional only so the existing direct callers keep compiling; `coverageFor`
   * always passes what it knows. A caller that omits the vertical is asking the
   * geography-only question and gets the geography-only answer -- which is the right
   * answer to that question, and the wrong one to "how is Plumbing 32095 doing".
   */
  verticalProfileId?: string | null;
  geographyType?: string | null;
  marketId?: string | null;
}): Promise<DiscoveryCoverage> {
  const empty = { providerRows: 0, matchedExisting: 0, discoveredNew: 0,
    entitiesRejected: 0, entitiesNeedingReview: 0, reason: null,
    lastRunAt: null } as const;

  // A search in flight outranks whatever the last one concluded: the answer is
  // about to change.
  if (input.activeJobId && input.activeJobScope === 'DISCOVER_NEW') {
    return { ...empty, state: 'RUNNING' };
  }

  // Scoped to the market, not to the place.
  //
  // This filtered on `geography_value` alone, so the newest completed market_mine job
  // for a ZIP answered for every vertical in it: a Roofing run of 32095 supplied the
  // discovery state -- its outcome, its counters, its "a provider searched this and
  // found nothing" -- to a rep looking at Plumbing in 32095, a market that had never
  // been searched at all.
  //
  // Strict on the vertical: a job that does not name one cannot be attributed to one.
  // Every market_mine job carries `vertical_profile_id` (enqueueMarketResearch has
  // written it since the payload existed), so this excludes nothing real -- and
  // matching NULL against the requested vertical would be identifying the market by
  // geography again, one row at a time.
  //
  // Tolerant of a missing type or market id, which is not the same leniency. The
  // oldest runs predate `geography_type` in the payload and simply do not carry one;
  // `geography_value` is matched exactly either way, so honouring those rows costs no
  // precision, while excluding them would report a market that has been searched as
  // one that never has. A job that *does* record either field still has to agree.
  const { rows } = await query<{
    job_id: string; payload: Record<string, unknown> | null;
    outcome: string | null; outcome_reason: string | null; completed_at: Date | null;
    provider_rows: number; matched_existing: number; discovered_new: number;
    entities_rejected: number; entities_needing_review: number;
  }>(
    `select job_id, payload, outcome, outcome_reason, completed_at,
            coalesce((progress->>'providerRows')::int, 0) as provider_rows,
            coalesce((progress->>'matchedExisting')::int, 0) as matched_existing,
            coalesce((progress->>'discoveredNew')::int, 0) as discovered_new,
            coalesce((progress->>'entitiesRejected')::int, 0) as entities_rejected,
            coalesce((progress->>'entitiesNeedingReview')::int, 0) as entities_needing_review
       from jobs
      where job_type = 'market_mine'
        and status in ('SUCCEEDED','FAILED')
        and payload->>'geography_value' = $1
        and ($2::text is null or payload->>'vertical_profile_id' = $2)
        and ($3::text is null or payload->>'geography_type' is null
             or payload->>'geography_type' = $3)
        and ($4::text is null or payload->>'market_id' is null
             or payload->>'market_id' = $4)
      order by completed_at desc nulls last
      limit 1`,
    [
      input.geographyValue ?? '', input.verticalProfileId ?? null,
      input.geographyType ?? null, input.marketId ?? null,
    ],
  );
  const last = rows[0];

  // Nothing has ever run. Whether that is because nobody asked or because nothing
  // could ask is a different sentence, and the rep needs the second one.
  if (!last) {
    return { ...empty, state: input.discoveryAvailable ? 'NEVER_RUN' : 'BLOCKED' };
  }

  const shared = {
    lastRunAt: last.completed_at,
    reason: last.outcome_reason,
    providerRows: last.provider_rows,
    matchedExisting: last.matched_existing,
    discoveredNew: last.discovered_new,
    entitiesRejected: last.entities_rejected,
    entitiesNeedingReview: last.entities_needing_review,
  };

  switch (last.outcome) {
    case 'DISCOVERY_BLOCKED':
      return { ...shared, state: 'BLOCKED' };
    // PENDING is a claim about right now -- the page says the provider "will be
    // collected rather than run again" -- and the job's outcome is a claim about a
    // moment in the past. A run that ended PROVIDER_PENDING keeps saying so for ever,
    // so the state survived its own task being collected, failed or abandoned. In
    // production a Plumbing 32095 run whose task had been deliberately abandoned was
    // still telling reps a provider owed us results.
    //
    // The task table decides. If nothing is outstanding the run simply did not come
    // back with an answer, which is what PROVIDER_UNAVAILABLE already means and
    // already says: the last search could not be completed, so it is not known
    // whether this market has businesses we do not hold. That leaves the market
    // researchable and keeps the run in the audit trail, without claiming a provider
    // owes us anything.
    case 'PROVIDER_PENDING': {
      const tasks = await discoveryTasksFor(last.job_id, last.payload);

      // A run buys a family of independent searches, so the family decides, and the
      // order is what each answer costs to get wrong.

      // Anything still owed outranks everything else: the answer is still coming,
      // and buying again would pay twice for it.
      if (tasks.pending > 0) return { ...shared, state: 'PENDING' };

      // Some searches landed and others were given up on. That is genuinely part of
      // the market rather than all of it, which is what PARTIAL already says.
      if (tasks.collected > 0 && tasks.unfulfilled > 0) {
        return { ...shared, state: 'PARTIAL' };
      }

      // Everything the run bought was delivered, after the run itself had ended.
      // Dated from the collection rather than from the job: a search delivered late
      // is news as of when it arrived, and that is also what decides when this
      // market goes stale and becomes worth researching again.
      if (tasks.collected > 0) {
        const collectedAt = tasks.latestCollectedAt;
        const ageDays = collectedAt
          ? (Date.now() - collectedAt.getTime()) / 86_400_000 : Number.POSITIVE_INFINITY;
        return {
          ...shared,
          lastRunAt: collectedAt ?? shared.lastRunAt,
          state: ageDays > DISCOVERY_STALE_AFTER_DAYS ? 'STALE' : 'FULFILLED_LATER',
        };
      }

      // Nothing outstanding and nothing delivered: the run did not come back with an
      // answer, which is what PROVIDER_UNAVAILABLE already means and already says.
      return { ...shared, state: 'PROVIDER_UNAVAILABLE' };
    }
    case 'PROVIDER_UNAVAILABLE':
    case 'FAILED':
      return { ...shared, state: 'PROVIDER_UNAVAILABLE' };
    case 'PARTIAL':
      return { ...shared, state: 'PARTIAL' };
    case 'ZERO_RESULTS':
      return { ...shared, state: 'ZERO_RESULTS' };
    // Without this the fall-through below reads provider_rows = 0 and
    // discovered_new = 0 and concludes ZERO_RESULTS -- "a provider searched this
    // market and found nothing usable" -- about a run in which no provider was
    // asked anything, because an operator had paused the market.
    case 'MARKET_DISABLED':
      return { ...shared, state: 'MARKET_DISABLED' };
    default:
      break;
  }

  // A completed search. Whether it added anything is the operator's question, and
  // "found only companies we already hold" is coverage rather than emptiness.
  const ageDays = last.completed_at
    ? (Date.now() - last.completed_at.getTime()) / 86_400_000 : Number.POSITIVE_INFINITY;
  if (ageDays > DISCOVERY_STALE_AFTER_DAYS) return { ...shared, state: 'STALE' };
  if (last.discovered_new > 0) return { ...shared, state: 'FOUND_NEW' };
  if (last.provider_rows > 0) return { ...shared, state: 'MATCHED_EXISTING' };
  return { ...shared, state: 'ZERO_RESULTS' };
}

/**
 * What became of the searches the run that ended PROVIDER_PENDING had bought.
 *
 * The job's own payload rebuilds the identity its tasks were fingerprinted with, so
 * the question asked is "is anything this run bought still outstanding" rather than
 * "is any task anywhere still pending" -- the latter would let an unrelated market's
 * open task keep this one falsely pending, which is the same bug wearing a hat.
 *
 * Imported lazily, in the style of the other cross-module reads in this file, so the
 * domain layer does not take a load-time dependency on the miner.
 */
async function discoveryTasksFor(
  jobId: string, payload: Record<string, unknown> | null,
): Promise<import('../miner/providerTasks.js').DiscoveryTaskSummary> {
  const [providerTasks, searchPlan, miningMode] = await Promise.all([
    import('../miner/providerTasks.js'),
    import('../miner/searchPlan.js'),
    import('../miner/miningMode.js'),
  ]);
  const fields = payload ?? {};
  const prefix = searchPlan.searchFingerprintPrefix({
    marketId: (fields['market_id'] as string | null) ?? null,
    verticalProfileId: (fields['vertical_profile_id'] as string | null) ?? null,
    geographyType: (fields['geography_type'] as string | null) ?? null,
    geographyValue: (fields['geography_value'] as string | null) ?? null,
    miningMode: miningMode.miningModeOrDefault(fields['mining_mode'] as string | null),
  });
  return providerTasks.discoveryTaskSummary({ jobId, fingerprintPrefix: prefix });
}

/**
 * Geography as an existence test rather than a join.
 *
 * An Account with two locations in one ZIP is still one Account, and a join would
 * count it twice.
 */
function locationExists(predicate: string): string {
  return `exists (select 1 from locations l
                   where l.account_id = a.account_id and l.is_active and ${predicate})`;
}

/**
 * In this market, by verified address *or* by where it was found.
 *
 * The miner used to copy the searched ZIP into `locations.postal_code` whenever the
 * provider gave no address, which made every mined company claim a physical location
 * nobody had observed. Removing that invention is right, and on its own it would have
 * made those companies vanish from the market they were discovered in -- a search of
 * 32095 returning nothing because none of them can prove they are in 32095.
 *
 * So the market predicate reads both facts and the read model keeps them apart: being
 * found while researching a ZIP is a reason to show a company in that market, and it
 * is never shown as its address.
 */
function inMarket(predicate: string, placeholder: string): string {
  return `(${locationExists(predicate)} or a.discovered_for_geography = ${placeholder})`;
}

/**
 * How many Accounts in this market the tier filter is hiding for want of a tier.
 *
 * Counted with the same geography and vertical the search used, so the number is
 * about the market the rep is looking at rather than the whole database.
 */
/**
 * Accounts a tier filter is hiding because their tier is from an older ruleset.
 *
 * Deliberately a sibling of `countUnscoredInScope` rather than a parameter on it:
 * the two answers go to different places in the UI and mean different work.
 */
async function countStaleScoreInScope(request: SearchRequest): Promise<number> {
  const conditions: string[] = [
    'not a.is_suppressed', 'a.merged_into_account_id is null',
    'a.manual_tier is not null',
    `(a.score_version is null or a.score_version <> $1)`];
  const values: unknown[] = [SCORE_VERSION];
  const geography = request.geography;

  if (request.verticalProfileId) {
    values.push(request.verticalProfileId);
    conditions.push(`a.primary_vertical_profile_id = $${values.length}`);
  }
  if (geography?.type === 'zip_zcta' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(inMarket(`l.postal_code = $${values.length}`, `$${values.length}`));
  } else if (geography?.type === 'city' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(locationExists(`lower(l.city) = lower($${values.length})`));
  } else if (geography?.type === 'state' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(locationExists(`l.state_region = upper($${values.length})`));
  }

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from accounts a where ${conditions.join(' and ')}`,
    values);
  return rows[0]?.n ?? 0;
}

async function countUnscoredInScope(request: SearchRequest): Promise<number> {
  // Base tables, for the same reason as the coverage counts above: nothing here
  // needs a column the view derives.
  const conditions: string[] = [
    'not a.is_suppressed', 'a.merged_into_account_id is null', 'a.manual_tier is null'];
  const values: unknown[] = [];
  const geography = request.geography;

  if (request.verticalProfileId) {
    values.push(request.verticalProfileId);
    conditions.push(`a.primary_vertical_profile_id = $${values.length}`);
  }
  if (geography?.type === 'zip_zcta' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(inMarket(`l.postal_code = $${values.length}`, `$${values.length}`));
  } else if (geography?.type === 'city' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(locationExists(`lower(l.city) = lower($${values.length})`));
  } else if (geography?.type === 'state' && geography.value) {
    values.push(geography.value.trim());
    conditions.push(locationExists(`l.state_region = upper($${values.length})`));
  }

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from accounts a where ${conditions.join(' and ')}`,
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
