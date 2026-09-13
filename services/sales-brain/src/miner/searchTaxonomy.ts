import { getVerticalProfile } from '../domain/verticals.js';

/**
 * What to actually search for.
 *
 * The adapter built its provider query by joining the strategy name, the vertical id
 * and the geography: "advertiser_first hvac 32095". Nobody searches for that. The
 * strategy is how we choose queries, not a thing to type into a search box, and
 * "hvac" is our internal id rather than the words a customer uses.
 *
 * Every vertical profile already carries a search_taxonomy with real queries, an
 * intent weight and a flag saying whether the query is worth buying paid SERP data
 * for. This reads that, so a market search asks what a customer would ask.
 */

export interface SearchQuery {
  query: string;
  family: string;
  /**
   * The damage or weather event this query assumes, when it assumes one.
   *
   * The live failure: Michael picked Roofing and a ZIP and the provider was asked
   * for "hail damage roof 32095". That query is not roofing in that ZIP -- it is
   * roofers who bid on hail work, which is a narrower and event-dependent slice, and
   * an assumption nobody made. It came first because ADVERTISER_FIRST breaks ties
   * alphabetically among equal-intent queries and "hail" sorts before "roof".
   *
   * Null for a service a company sells all year. "water damage restoration" is a
   * service line; "hail damage roof" is a general service with an event stuck on
   * the front, and the difference is whether the query still makes sense in a week
   * with no weather.
   */
  cause: string | null;
  /** 1-5. How close to buying somebody typing this is. */
  intentWeight: number;
  /** 1 is highest. */
  priority: number;
  recommendedForPaidSerp: boolean;
  /**
   * What this query is *for*, which is not the same as how valuable it is.
   *
   * `intent_weight` answers "how close to buying is somebody typing this", and the
   * planner used it to answer "how should we find this market" as well. Those are
   * different questions with different right answers: "drain cleaning" is a better
   * sales signal than "plumber" and a much worse way to enumerate the plumbers in a
   * ZIP. Overloading one number to mean both is why Plumbing + 32095 bought
   * "drain cleaning 32095".
   */
  purpose: QueryPurpose;
  /** Whether this query is load-bearing for market coverage. */
  coverageRole: CoverageRole;
}

/** Finding the businesses, versus learning what they sell. */
export type QueryPurpose = 'ENTITY_DISCOVERY' | 'COMMERCIAL_INTELLIGENCE';
export type CoverageRole = 'PRIMARY' | 'SECONDARY';

/**
 * Which taxonomy group means what.
 *
 * The profiles already carried this distinction -- every one of the thirteen defines
 * `core_queries` separately from `high_intent_queries` -- and the loader flattened
 * them into one list before sorting, so the structure that encoded the answer was
 * discarded on the way in. Four of these groups were never read at all.
 */
const GROUP_PURPOSE: Record<string, { purpose: QueryPurpose; coverageRole: CoverageRole }> = {
  core_queries: { purpose: 'ENTITY_DISCOVERY', coverageRole: 'PRIMARY' },
  high_intent_queries: { purpose: 'COMMERCIAL_INTELLIGENCE', coverageRole: 'SECONDARY' },
  urgent_queries: { purpose: 'COMMERCIAL_INTELLIGENCE', coverageRole: 'SECONDARY' },
  high_ticket_queries: { purpose: 'COMMERCIAL_INTELLIGENCE', coverageRole: 'SECONDARY' },
  financing_queries: { purpose: 'COMMERCIAL_INTELLIGENCE', coverageRole: 'SECONDARY' },
  commercial_queries: { purpose: 'COMMERCIAL_INTELLIGENCE', coverageRole: 'SECONDARY' },
};

export type DiscoveryStrategy =
  /** Prefer the queries where advertisers bid: companies already spending money. */
  | 'ADVERTISER_FIRST'
  /** Cover the market broadly, paid or not. */
  | 'BROAD_LOCAL';

interface TaxonomyEntry {
  query?: unknown;
  family?: unknown;
  cause?: unknown;
  intent_weight?: unknown;
  priority?: unknown;
  recommended_for_paid_serp?: unknown;
}

function readGroup(definition: Record<string, unknown>, group: string): SearchQuery[] {
  const taxonomy = definition['search_taxonomy'] as Record<string, unknown> | undefined;
  const entries = (taxonomy?.[group] ?? []) as TaxonomyEntry[];
  const queries: SearchQuery[] = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const query = typeof entry.query === 'string' ? entry.query.trim() : '';
    if (!query) continue;
    queries.push({
      query,
      family: typeof entry.family === 'string' ? entry.family : 'core',
      cause: typeof entry.cause === 'string' && entry.cause.trim()
        ? entry.cause.trim().toLowerCase() : null,
      intentWeight: Number(entry.intent_weight ?? 1) || 1,
      priority: Number(entry.priority ?? 9) || 9,
      recommendedForPaidSerp: entry.recommended_for_paid_serp === true,
      purpose: GROUP_PURPOSE[group]?.purpose ?? 'COMMERCIAL_INTELLIGENCE',
      coverageRole: GROUP_PURPOSE[group]?.coverageRole ?? 'SECONDARY',
    });
  }
  return queries;
}

/**
 * Every query a vertical profile defines, deduplicated on the query text.
 *
 * Read from the database rather than the repository files: a deployed box has the
 * synced profiles and may not have the docs tree beside it.
 */
/**
 * The events this trade exists for.
 *
 * A cause listed here is the business rather than an assumption about this week, so
 * it is searched by default. Paintless dent repair without hail is a different and
 * much smaller trade; roofing without hail is just roofing.
 */
/**
 * What this vertical is not.
 *
 * Every profile has carried these since it was written -- "roofing supply",
 * "wholesale", "HVAC school", "dental lab only" -- and nothing has ever read them.
 * A roofing search returns supply houses, training providers and manufacturers, and
 * a rep opens one, reads the name, and learns that the list contains things that are
 * not prospects.
 *
 * Applied to what a provider sends back rather than to what it is asked: a negative
 * term stuffed into the query changes what the search engine ranks, which is a
 * different and worse thing than filtering the answer.
 */
export async function negativeTermsFor(verticalProfileId: string): Promise<string[]> {
  const definition = await getVerticalProfile(verticalProfileId) as Record<string, unknown> | null;
  const taxonomy = definition?.['search_taxonomy'] as Record<string, unknown> | undefined;
  const terms = taxonomy?.['negative_terms'];
  return (Array.isArray(terms) ? terms : [])
    .filter((term): term is string => typeof term === 'string')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether a discovered company is the kind of business this vertical is looking for.
 *
 * Matched on whole words so "wholesale" does not reject "Wholesale Heating & Air"
 * by accident -- a company can have an unfortunate name and still be a contractor.
 * A term of several words has to appear as a phrase.
 */
export function matchesNegativeTerm(
  name: string, domain: string | null, terms: string[],
): string | null {
  const haystack = `${name} ${domain ?? ''}`.toLowerCase();
  for (const term of terms) {
    const pattern = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '[^a-z0-9]+')}([^a-z0-9]|$)`, 'i');
    if (pattern.test(haystack)) return term;
  }
  return null;
}

export async function inherentCausesFor(verticalProfileId: string): Promise<Set<string>> {
  const definition = await getVerticalProfile(verticalProfileId) as Record<string, unknown> | null;
  const listed = definition?.['inherent_causes'];
  return new Set(
    (Array.isArray(listed) ? listed : [])
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim().toLowerCase()));
}

export async function searchQueriesFor(verticalProfileId: string): Promise<SearchQuery[]> {
  const definition = await getVerticalProfile(verticalProfileId) as Record<string, unknown> | null;
  if (!definition) return [];

  // Entity discovery first, so that when two groups define the same words the query
  // keeps its discovery purpose. The order here is not the plan order -- the planner
  // decides that -- but a term that is both core and high-intent is a way of finding
  // the market that also happens to sell.
  const all = [
    ...readGroup(definition, 'core_queries'),
    ...readGroup(definition, 'high_intent_queries'),
    ...readGroup(definition, 'urgent_queries'),
    ...readGroup(definition, 'high_ticket_queries'),
    ...readGroup(definition, 'financing_queries'),
    ...readGroup(definition, 'commercial_queries'),
  ];
  const seen = new Set<string>();
  return all.filter((entry) => {
    const key = entry.query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The queries to run for one discovery request, in the order they should be spent on.
 *
 * Advertiser-first orders by whether advertisers bid on the query and then by intent,
 * because a company paying for "AC repair" is a company with a budget and a problem
 * we can help with. It orders; it does not exclude. A non-advertiser is still a
 * business in the market, and dropping it here would make the market look smaller
 * than it is.
 */
export interface QueryPlanRefusal { code: 'NO_ENTITY_DISCOVERY_QUERY'; message: string; }

export interface QueryPlan {
  queries: SearchQuery[];
  /** Set when the vertical cannot be discovered at all. Nothing is bought. */
  refusal: QueryPlanRefusal | null;
  /** True when the budget did not cover the vertical's primary discovery terms. */
  partialDiscoveryCoverage: boolean;
  /** True when no commercial-intelligence query fitted in the budget. */
  commercialIntelligenceIncluded: boolean;
}

/** Within one phase. Alphabetical survives only as the last deterministic tie-break. */
function withinPhase(strategy: DiscoveryStrategy) {
  return (left: SearchQuery, right: SearchQuery): number => {
    if (strategy === 'ADVERTISER_FIRST'
        && left.recommendedForPaidSerp !== right.recommendedForPaidSerp) {
      return left.recommendedForPaidSerp ? -1 : 1;
    }
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (left.intentWeight !== right.intentWeight) return right.intentWeight - left.intentWeight;
    return left.query.localeCompare(right.query);
  };
}

/**
 * The queries to run for one discovery request, in the order they should be spent on.
 *
 * Phase-aware, because finding a market and pricing it are different jobs. The old
 * version was one sort over one flattened list, so the most commercially valuable
 * query was also treated as the best way to enumerate a trade -- and for Plumbing,
 * where every core term is intent 4 and every service term is intent 5, that put all
 * five service terms ahead of "plumber" and let the alphabet pick "drain cleaning" as
 * the definition of the market.
 *
 * Entity discovery is satisfied first and completely. Commercial intelligence spends
 * only what is left. Alphabetical order still breaks ties, but only inside a phase,
 * where it decides between comparable queries rather than deciding what the market is.
 */
export async function planSearchQueries(input: {
  verticalProfileId: string | null;
  strategy: DiscoveryStrategy;
  budget: number;
}): Promise<QueryPlan> {
  const empty: QueryPlan = {
    queries: [], refusal: null, partialDiscoveryCoverage: false,
    commercialIntelligenceIncluded: false,
  };
  const queries = input.verticalProfileId
    ? await searchQueriesFor(input.verticalProfileId) : [];
  if (queries.length === 0) return empty;

  const order = withinPhase(input.strategy);
  const discovery = queries.filter((q) => q.purpose === 'ENTITY_DISCOVERY').sort(order);
  const commercial = queries.filter((q) => q.purpose === 'COMMERCIAL_INTELLIGENCE').sort(order);

  // Fail closed. A vertical with no way to enumerate its businesses must not quietly
  // fall back to its sales keywords: that is the defect, not the recovery from it.
  if (discovery.length === 0) {
    return {
      ...empty,
      refusal: {
        code: 'NO_ENTITY_DISCOVERY_QUERY',
        message: 'This vertical has no configured market-discovery query, so a broad '
          + 'search of it cannot be planned. Add a core query to the profile: buying a '
          + 'high-intent service query instead would describe one service, not the market.',
      },
    };
  }

  const budget = Math.max(0, input.budget);
  const chosen = discovery.slice(0, budget);
  const remaining = budget - chosen.length;
  const extra = remaining > 0 ? commercial.slice(0, remaining) : [];

  return {
    queries: [...chosen, ...extra],
    refusal: null,
    partialDiscoveryCoverage: chosen.length < discovery.length,
    commercialIntelligenceIncluded: extra.length > 0,
  };
}

/**
 * The words that are generic in this market.
 *
 * A trade's own vocabulary cannot identify one company within that trade: every
 * roofer's name may contain "roofing", so "roofing" appearing in both a name and a
 * domain says only that both are about roofs. The vertical already writes this
 * vocabulary down -- its search taxonomy is precisely the words the market is
 * described by -- so it is read from there rather than listed per trade in the
 * resolver, which would be thirteen lists to forget to update.
 *
 * The searched geography goes in for the same reason: within one ZIP, the town's name
 * is shared by everyone in it.
 */
export async function genericTermsFor(
  verticalProfileId: string | null,
  /**
   * Every way this market's place is spelled: the operator's ZIP, and the location
   * the provider was actually asked about.
   *
   * The ZIP alone was not enough. "St Augustine Plumbing" on
   * `staugustineplumbing.example` still corroborated itself, because "plumbing" was
   * generic and "augustine" was not -- and a city-plus-trade lead-generation domain
   * is exactly the shape that repeats its own title. The provider's normalised place
   * ("St. Augustine,Florida,United States") carries the words that make the city
   * generic, so it is market vocabulary too.
   *
   * This says nothing about where any business is. It decides only which words are
   * too widely shared to prove that a domain belongs to a particular company.
   */
  ...geographies: (string | null | undefined)[]
): Promise<Set<string>> {
  const terms = new Set<string>();
  const add = (text: string | null | undefined): void => {
    for (const word of (text ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)) {
      if (word.length >= 3) terms.add(word);
    }
  };

  if (verticalProfileId) {
    for (const entry of await searchQueriesFor(verticalProfileId)) add(entry.query);
    // What the trade is called, and what it is not, are both market vocabulary.
    for (const term of await negativeTermsFor(verticalProfileId)) add(term);
    add(verticalProfileId.replace(/[_-]+/g, ' '));
  }
  for (const geography of geographies) add(geography ?? null);
  return terms;
}
