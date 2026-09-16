/**
 * Whether a result is actually in the trade we were searching for.
 *
 * The search vertical and the business vertical are different facts, and the miner used
 * to treat them as one. `marketMiner` stamped `job.payload.vertical_profile_id` straight
 * onto every Account it created, so a company Google happened to return for
 * "HVAC contractor 33127" became an HVAC prospect on the strength of the question we
 * asked. Production put "U-Haul Locations in Miami, FL 33127" in front of a rep filtering
 * for HVAC: an organic result at position 51, no provider category, a truck rental
 * company.
 *
 * The same correction was already made one line above it for geography. The comment
 * there says it exactly -- "'Found while researching 32095' is a fact about the search.
 * 'Located in 32095' is a fact about the business" -- and the vertical was still being
 * inherited the way geography used to be.
 *
 * What counts as evidence is deliberately narrow, and chosen from what this system
 * actually has. Across 2065 production observations the provider's `category` column is
 * null every single time, so "structured business category" is not available to reason
 * from however much one would like it. What is available:
 *
 *   - `local_result`: Google's local pack for a trade query, which is category-filtered
 *     at the source. A plumber does not appear in the local pack for "HVAC contractor".
 *     57 of production's Accounts came this way.
 *   - `organic`: a ranked page, and nothing more. 166 Accounts came this way, U-Haul
 *     among them. Ranking is not membership.
 *
 * So discovery supports a vertical for a local business listing, and for a Local
 * Services Ad, which Google category-verifies before it runs. An ordinary paid text ad
 * is a third thing, and the distinction is the point: buying "HVAC contractor Orlando"
 * proves commercial intent toward that trade's customers, which manufacturers,
 * equipment renters, lead sellers, home warranty companies, marketplaces and retailers
 * all have without being contractors. Advertising relevance and business classification
 * are separate dimensions, so paid search corroborates a classification and never makes
 * one alone.
 *
 * None of this weakens the advertiser-first strategy. A paid sighting is still written
 * as `active_google_search_ad` evidence by the miner, and still earns its Module 4C
 * points, because what a company advertises for is a real fact about it -- just not
 * this fact. The two questions are answered from the same observation and kept apart.
 *
 * An organic result is a candidate: real company or not, in the trade or not, both
 * still open. The company's own website settles it later -- see
 * `firstPartyVerticalRelevance` -- which is why an unsupported vertical is left unset
 * rather than rejected. Unset is recoverable; wrong is what a rep sees.
 */

/** Whether the evidence to hand supports the trade, or does not yet. */
export type VerticalRelevance = 'SUPPORTED' | 'INSUFFICIENT';

/**
 * Provider result types that are themselves a statement about the business.
 *
 * A local/maps listing is returned because the business is categorised that way, and a
 * paid trade placement is bought by the business itself. Both are statements about the
 * company. An organic ranking only describes a page.
 */
const BUSINESS_LISTING_RESULT_TYPES: ReadonlySet<string> = new Set([
  // A local/maps listing: returned because the business is categorised that way.
  'local_result', 'local_pack', 'maps_search', 'google_business_listing', 'maps_local',
  /**
   * And a Local Services Ad, which Google category-verifies before it runs.
   *
   * An LSA advertiser has been checked as a provider of that service, so the listing is
   * a statement about the business. An ordinary paid text ad is not: buying
   * "HVAC contractor Orlando" proves commercial intent toward that trade's customers,
   * which manufacturers, equipment renters, lead sellers, home warranty companies,
   * marketplaces and retailers all have without being contractors. Paid search is
   * therefore corroborating evidence, handled below, never a standalone classification.
   */
  'local_services_ad',
]);

/**
 * Placements that show intent toward the trade without establishing membership of it.
 *
 * Kept separate so the distinction is visible rather than implied: this is the line
 * between "wants that trade's customers" and "is in that trade".
 */
const COMMERCIAL_INTENT_RESULT_TYPES: ReadonlySet<string> = new Set([
  'paid_search', 'paid_search_text',
]);

/**
 * What the provider's own answer supports, before anybody visits the website.
 *
 * `category`, when a provider ever supplies one, is the strongest signal and is checked
 * first. Today it is always null, so in practice this turns on the result type.
 */
export function discoveryVerticalRelevance(input: {
  resultType?: string | null;
  providerCategory?: string | null;
  verticalTerms: readonly string[];
  /** Independent trade evidence, e.g. landing-page or official-site services. */
  corroborated?: boolean;
}): VerticalRelevance {
  const category = (input.providerCategory ?? '').toLowerCase().trim();
  if (category && matchesAnyTerm(category, input.verticalTerms)) return 'SUPPORTED';

  const resultType = (input.resultType ?? '').toLowerCase().trim();
  if (BUSINESS_LISTING_RESULT_TYPES.has(resultType)) return 'SUPPORTED';

  // A paid text ad corroborates, and corroboration needs something to corroborate. On
  // its own it establishes commercial intent toward the trade, not membership of it.
  if (COMMERCIAL_INTENT_RESULT_TYPES.has(resultType) && input.corroborated === true) {
    return 'SUPPORTED';
  }

  // An organic hit, a directory page, an article, a product listing. Each says a page
  // was returned; none says the company works in this trade.
  return 'INSUFFICIENT';
}

/**
 * What the company's own website supports.
 *
 * The vertical profile already declares the words a business in that trade uses about
 * itself -- `search_taxonomy.core_queries` holds "HVAC contractor", "heating and
 * cooling", "air conditioning contractor" -- so the terms we search with are the terms
 * a genuine member of the trade publishes. That is not a coincidence to exploit
 * loosely: it is checked against the company's own pages, not against a SERP snippet
 * somebody else wrote about them.
 *
 * Deliberately requires more than one mention. A moving company's site can say "air
 * conditioning" once, about a truck. A plumber's site can mention heating in passing.
 * Two distinct declared terms is a weak bar but a real one, and it is the difference
 * between a page that is about the trade and a page that mentions it.
 */
export function firstPartyVerticalRelevance(input: {
  pageText: readonly string[];
  verticalTerms: readonly string[];
  minimumDistinctTerms?: number;
}): VerticalRelevance {
  const haystack = input.pageText.join(' \n ').toLowerCase();
  if (!haystack.trim()) return 'INSUFFICIENT';

  const matched = new Set<string>();
  for (const term of input.verticalTerms) {
    const needle = term.toLowerCase().trim();
    if (needle.length >= 4 && haystack.includes(needle)) matched.add(needle);
  }
  return matched.size >= (input.minimumDistinctTerms ?? 2) ? 'SUPPORTED' : 'INSUFFICIENT';
}

/** Whether a phrase contains any of the trade's declared terms. */
function matchesAnyTerm(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => {
    const needle = term.toLowerCase().trim();
    return needle.length >= 4 && value.includes(needle);
  });
}
