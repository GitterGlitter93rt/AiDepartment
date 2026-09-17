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
  /**
   * The trade's own words for itself, from the profile's `service_aliases`.
   *
   * Separate from `verticalTerms`, which are search queries. A company called "Mills
   * Air Inc" is an HVAC company and contains none of the discovery queries; it
   * contains an alias. Optional, so a caller that has not loaded the profile behaves
   * exactly as before.
   */
  serviceAliases?: readonly string[];
  /**
   * The resolver found a provider entity listing for this identity in this search.
   *
   * The same evidence `local_result` is, but read from the identity rather than from
   * whichever single row a projection happened to pick. A company that appears as
   * both a paid ad and a local listing was being judged on the ad alone, because the
   * ad is the row the projection keeps -- and advertiser-first mining means that is
   * the common case, not the corner case.
   */
  providerListing?: boolean;
  /** Independent trade evidence, e.g. landing-page or official-site services. */
  corroborated?: boolean;
}): VerticalRelevance {
  const category = (input.providerCategory ?? '').toLowerCase().trim();
  if (category) {
    /**
     * The provider's own classification outranks everything below it, both ways.
     *
     * A category that agrees settles the question. A category that *disagrees* settles
     * it too, and that is the half V1 did not have: a business listing returned for
     * "HVAC contractor 33701" and categorised by the provider as a plumber used to
     * inherit HVAC anyway, because the listing branch returned before anything read
     * the category. The listing proves a business exists. The category is the only
     * thing either of them says about which trade it is in.
     *
     * Before this, no `search_observation` in production had ever carried a category
     * at all -- the miner did not capture the field -- so the rule could not fire even
     * when the provider supplied one.
     */
    const agrees = matchesAnyTerm(category, input.verticalTerms)
      || matchesAnyTerm(category, input.serviceAliases ?? []);
    return agrees ? 'SUPPORTED' : 'INSUFFICIENT';
  }

  if (input.providerListing === true) return 'SUPPORTED';

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
 * Generic words that appear in every trade's language and name none of them.
 *
 * "Roofing contractor" is distinctive because of "roofing". Keeping "contractor"
 * would make a general contractor's page evidence of roofing, plumbing and HVAC at
 * once, which is the failure this module exists to prevent, arrived at from the
 * opposite direction.
 */
const GENERIC_TRADE_WORDS: ReadonlySet<string> = new Set([
  'contractor', 'contractors', 'service', 'services', 'repair', 'repairs', 'company',
  'near', 'best', 'local', 'install', 'installation', 'replacement', 'commercial',
  'residential', 'emergency', 'quote', 'estimate', 'free', 'call', 'same',
]);

/**
 * The words that actually name this trade, taken from what the profile declares.
 *
 * "HVAC contractor", "heating and cooling", "air conditioning contractor" yield
 * hvac, heating, cooling, conditioning.
 */
function distinctiveTradeWords(terms: readonly string[]): string[] {
  const words = new Set<string>();
  for (const term of terms) {
    for (const word of term.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length >= 4 && !GENERIC_TRADE_WORDS.has(word)) words.add(word);
    }
  }
  return [...words];
}

/**
 * The root a trade's words share, for reading a domain.
 *
 * "roofer" and "roofing" are both "roof", which is what a company puts in its domain:
 * coastalroof, delair, firstcoastroof. A domain is written to be typed, so it
 * compresses, and comparing it against the full word finds nothing.
 */
function tradeWordStems(words: readonly string[]): string[] {
  const stems = new Set<string>();
  for (const word of words) {
    let stem = word;
    for (const suffix of ['ing', 'ers', 'er', 's']) {
      if (stem.endsWith(suffix) && stem.length - suffix.length >= 4) {
        stem = stem.slice(0, -suffix.length);
        break;
      }
    }
    stems.add(stem);
  }
  return [...stems];
}

/**
 * What the company's own website supports, weighed rather than counted.
 *
 * The vertical profile already declares the words a business in that trade uses about
 * itself -- `search_taxonomy.core_queries` holds "HVAC contractor", "heating and
 * cooling", "air conditioning contractor" -- so the terms we search with are the terms
 * a genuine member of the trade publishes. That is checked against the company's own
 * pages, not against a SERP snippet somebody else wrote about them.
 *
 * This used to demand two distinct declared terms, always, and that bar is wrong in
 * both directions at once. "No Catch Roofing", whose whole site is its name, is
 * plainly a roofing company and failed it. A moving company whose site says "air
 * conditioning" once, about a truck cab, would pass it the moment a second HVAC phrase
 * appeared anywhere on the page.
 *
 * So the evidence is weighted by where it appears, because that is what actually
 * distinguishes the two:
 *
 *   - the company's own name naming the trade is worth the whole bar on its own. A
 *     business called "X Roofing" is telling you what it does, and no moving company
 *     is called "U-Haul Air Conditioning".
 *   - each distinct declared term published on the site is worth half of it, so two
 *     of them still carry a company whose name says nothing, and one of them -- a
 *     passing mention -- carries nothing.
 *
 * Deliberately not a score anybody has to interpret: two ways to reach the same bar,
 * each of which can be stated in a sentence to whoever asks why a company was called
 * a roofer.
 */
export function firstPartyVerticalRelevance(input: {
  pageText: readonly string[];
  verticalTerms: readonly string[];
  /** What we call this company. Its own name is evidence about its own trade. */
  companyName?: string | null;
  minimumDistinctTerms?: number;
}): VerticalRelevance {
  const haystack = input.pageText.join(' \n ').toLowerCase();
  const name = (input.companyName ?? '').toLowerCase();
  if (!haystack.trim() && !name.trim()) return 'INSUFFICIENT';

  // A page we could not read is not evidence, whatever the company is called: the
  // name alone would promote every unreachable site in the trade's search results.
  if (!haystack.trim()) return 'INSUFFICIENT';

  const REQUIRED = 2;
  let weight = 0;
  const words = distinctiveTradeWords(input.verticalTerms);

  // The company calling itself a roofer, which is the strongest single thing a site
  // can say about its own trade.
  const nameSaysTheTrade = name
    ? matchesAnyTerm(name, input.verticalTerms) || words.some((word) => name.includes(word))
    : false;
  if (nameSaysTheTrade) weight += REQUIRED;

  /*
   * A domain saying it, which is the same claim compressed: coastalroof, delair,
   * firstcoastroof. Weaker on its own, because a stem is short enough to turn up by
   * accident -- "cool" is in "Coolidge" -- so it is worth half the bar and needs the
   * site to agree with it. It is never enough by itself.
   */
  const nameHintsTheTrade = !nameSaysTheTrade && name
    ? tradeWordStems(words).some((stem) => name.includes(stem))
    : false;
  if (nameHintsTheTrade) weight += 1;

  // Declared phrases the site publishes verbatim: "roofing contractor", "heating and
  // cooling". The strongest page evidence, because it is the trade's own language.
  const matched = new Set<string>();
  for (const term of input.verticalTerms) {
    const needle = term.toLowerCase().trim();
    if (needle.length >= 4 && haystack.includes(needle)) matched.add(needle);
  }
  weight += matched.size;

  /*
   * And the trade's distinctive words alone, because the declared terms are search
   * phrases and a company writes prose. Roofing declares "roofer", "roofing company"
   * and "roofing contractor"; a roofer's own page says "Residential roofing since
   * 1998" and matches none of them verbatim while plainly being a roofer.
   *
   * Worth half the bar, so one of them is a mention and two are a subject. This is
   * what keeps a moving company out: its site says "air conditioning" once, about a
   * truck cab, and one mention does not reach the bar from anywhere.
   */
  const matchedWords = new Set<string>();
  for (const word of words) if (haystack.includes(word)) matchedWords.add(word);
  weight += matchedWords.size;

  // An explicit override stays exact, for callers that mean a specific bar.
  if (input.minimumDistinctTerms !== undefined) {
    return matched.size >= input.minimumDistinctTerms ? 'SUPPORTED' : 'INSUFFICIENT';
  }

  return weight >= REQUIRED ? 'SUPPORTED' : 'INSUFFICIENT';
}

/** Whether a phrase contains any of the trade's declared terms. */
function matchesAnyTerm(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => {
    const needle = term.toLowerCase().trim();
    return needle.length >= 4 && value.includes(needle);
  });
}
