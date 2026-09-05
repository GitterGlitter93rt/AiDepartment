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
  /** 1-5. How close to buying somebody typing this is. */
  intentWeight: number;
  /** 1 is highest. */
  priority: number;
  recommendedForPaidSerp: boolean;
}

export type DiscoveryStrategy =
  /** Prefer the queries where advertisers bid: companies already spending money. */
  | 'ADVERTISER_FIRST'
  /** Cover the market broadly, paid or not. */
  | 'BROAD_LOCAL';

interface TaxonomyEntry {
  query?: unknown;
  family?: unknown;
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
      intentWeight: Number(entry.intent_weight ?? 1) || 1,
      priority: Number(entry.priority ?? 9) || 9,
      recommendedForPaidSerp: entry.recommended_for_paid_serp === true,
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
export async function searchQueriesFor(verticalProfileId: string): Promise<SearchQuery[]> {
  const definition = await getVerticalProfile(verticalProfileId) as Record<string, unknown> | null;
  if (!definition) return [];

  const all = [
    ...readGroup(definition, 'high_intent_queries'),
    ...readGroup(definition, 'core_queries'),
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
export async function planSearchQueries(input: {
  verticalProfileId: string | null;
  strategy: DiscoveryStrategy;
  budget: number;
}): Promise<SearchQuery[]> {
  const queries = input.verticalProfileId
    ? await searchQueriesFor(input.verticalProfileId) : [];
  if (queries.length === 0) return [];

  const ordered = [...queries].sort((left, right) => {
    if (input.strategy === 'ADVERTISER_FIRST'
        && left.recommendedForPaidSerp !== right.recommendedForPaidSerp) {
      return left.recommendedForPaidSerp ? -1 : 1;
    }
    if (left.intentWeight !== right.intentWeight) return right.intentWeight - left.intentWeight;
    if (left.priority !== right.priority) return left.priority - right.priority;
    return left.query.localeCompare(right.query);
  });

  return ordered.slice(0, Math.max(0, input.budget));
}
