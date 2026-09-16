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
 * So discovery supports a vertical for a local business listing, and for an
 * advertisement the company paid to place against the trade's own keywords -- Google's
 * opinion about a page is not evidence, but a company spending money to reach that
 * trade's customers is the company's own assertion. An organic result is a candidate:
 * real company or not, in the trade or not, both still open. The company's own website
 * settles it later -- see `firstPartyVerticalRelevance` -- which is why an unsupported
 * vertical is left unset rather than rejected. Unset is recoverable; wrong is what a
 * rep sees.
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
   * And an advertisement the company paid to place against the trade's own keywords.
   *
   * An organic ranking is Google's opinion about a page. A paid placement is the
   * company spending its own money to be shown to people searching for that trade,
   * which is the company asserting it serves them -- and a Local Services Ad is
   * category-verified by Google before it runs at all. This is the signal the
   * advertiser-first strategy is built on, so refusing it here would have made the
   * largest scoring input in that strategy unable to fire.
   *
   * Shopping and other product placements are deliberately absent: a listing for an
   * air conditioning unit is a product for sale, not a contractor.
   */
  'paid_search', 'paid_search_text', 'local_services_ad',
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
}): VerticalRelevance {
  const category = (input.providerCategory ?? '').toLowerCase().trim();
  if (category && matchesAnyTerm(category, input.verticalTerms)) return 'SUPPORTED';

  const resultType = (input.resultType ?? '').toLowerCase().trim();
  if (BUSINESS_LISTING_RESULT_TYPES.has(resultType)) return 'SUPPORTED';

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
