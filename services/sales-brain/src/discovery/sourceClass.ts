/**
 * What kind of thing a search result actually is.
 *
 * A SERP row has a domain and a title. So does a Yelp search page, a News4Jax
 * article, a Facebook group and a YouTube video. The old pipeline asked only whether
 * a row had a domain or a phone, which every one of those has, and so every one of
 * them became a company a rep was asked to call.
 *
 * The rules here are structural on purpose. A denylist of the directories we already
 * know is a useful second layer and a worthless first one: it cannot see tomorrow's
 * directory, and the canary found several nobody had heard of
 * (`nationalroofingdirectory.com`, `localprobook.com`, `theagentpages.com`). What
 * catches those is behaviour -- a domain that carries several different businesses is
 * serving other people's businesses, whatever it is called.
 */

export type SourceClass =
  /** A provider business listing: name plus phone or address. The strongest thing we get. */
  | 'BUSINESS_LISTING'
  /** A page that looks like one company's own site. Promotable with corroboration. */
  | 'OFFICIAL_SITE'
  /** Lists other people's businesses. */
  | 'DIRECTORY'
  /** Sells introductions to other people's businesses. */
  | 'MARKETPLACE'
  /** News, magazine, blog network: writes *about* businesses. */
  | 'PUBLISHER'
  /** "Best 10 roofers in ..." — an article shaped like a list. */
  | 'LISTICLE'
  | 'SOCIAL'
  | 'VIDEO'
  | 'FORUM'
  /** A manufacturer's "find a contractor near you". The manufacturer is not the contractor. */
  | 'MANUFACTURER_LOCATOR'
  /** Nothing matched. Never promoted; quarantined for a human. */
  | 'UNKNOWN';

/** Classes that may ever become a business candidate. */
const PROMOTABLE: ReadonlySet<SourceClass> = new Set<SourceClass>([
  'BUSINESS_LISTING', 'OFFICIAL_SITE',
]);

export function mayPromote(sourceClass: SourceClass): boolean {
  return PROMOTABLE.has(sourceClass);
}

export interface ClassifiableObservation {
  resultType: string;
  observedName: string | null;
  observedDomain: string | null;
  observedPhone: string | null;
  observedLocation: string | null;
  landingUrl: string | null;
}

export interface Classification {
  sourceClass: SourceClass;
  /** Why, in words an operator can read. Bounded and never provider text. */
  reasons: string[];
}

/**
 * The registrable domain, near enough for our purposes.
 *
 * Not a public-suffix implementation: we need "two candidates share a host" to be a
 * stable key, and a wrong answer on `co.uk` costs us a slightly narrower grouping
 * rather than a wrong promotion. Multi-part public suffixes we actually meet are
 * listed so `reviews.birdeye.com` and `birdeye.com` group together.
 */
export function registrableDomain(domain: string | null): string | null {
  if (!domain) return null;
  const host = domain.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!host || !host.includes('.')) return null;
  const parts = host.split('.');
  const twoPartSuffix = /^(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/;
  const tail = parts.slice(-2).join('.');
  const take = twoPartSuffix.test(tail) ? 3 : 2;
  return parts.slice(-take).join('.');
}

/**
 * Known third parties, as a *second* layer.
 *
 * Everything here would also be caught structurally in a result set where it carries
 * more than one business, or by its URL shape. It is listed because the first search
 * of a market may legitimately contain exactly one Yelp row, and waiting for a second
 * one before recognising Yelp would be silly.
 */
const KNOWN_DIRECTORY = /^(yelp|angi|angieslist|homeadvisor|thumbtack|houzz|porch|networx|buildzoom|bbb|manta|yellowpages|superpages|chamberofcommerce|expertise|birdeye|trustpilot|localprobook|theagentpages|nationalroofingdirectory|floridarooferhub|mapquest|local\.yahoo|yahoo)\./;
// Deliberately excludes the roofing-specific lead-gen sites the canary actually hit
// (`freeroofquote.com` and friends). They are exactly what the structural rule has to
// catch on its own -- a vertical-specific entry here would let us pass a test that
// proves nothing, and would need writing again for the next trade.
const KNOWN_MARKETPLACE = /^(homeadvisor|thumbtack|networx|modernize|craftjack|quotewizard)\./;
const KNOWN_SOCIAL = /^(facebook|instagram|twitter|x|linkedin|tiktok|pinterest|nextdoor)\./;
const KNOWN_VIDEO = /^(youtube|youtu|vimeo)\./;
const KNOWN_FORUM = /^(reddit|quora|answers|city-data|houzz-discussions)\./;
const KNOWN_PUBLISHER = /^(news4jax|firstcoastnews|jacksonville|nytimes|cnn|forbes|usatoday|todayshomeowner|bobvila|thisoldhouse|angi-magazine|realtor|apnews|patch|wjxt|actionnewsjax)\./;
const KNOWN_MANUFACTURER = /^(gaf|owenscorning|certainteed|tamko|malarkey|iko|carrier|trane|lennox|rheem|bryant|goodman|kohler|moen)\./;

/** Path shapes a company's own site does not use to describe itself. */
const DIRECTORY_PATH = /\/(biz|profile|listing|listings|directory|company|companies|pro|pros|find-a|find_a|reviews?)\//;
const PUBLISHER_PATH = /\/(news|article|articles|story|stories|blog|press|20\d\d)\//;
const SOCIAL_PATH = /\/(posts|groups|status|reel|shorts|watch)\b/;
const FORUM_PATH = /\/(questions|thread|threads|topic|forum|comments)\b/;

/** A company is not called "Top 10 Best Roofers in Saint Augustine, FL". */
const LISTICLE_TITLE = /^\s*(the\s+)?(top|best)\b|\btop\s*\d+\b|\bbest\s*\d+\b|\b\d+\s+best\b|\bnear\s+me\b|\bguide\b|\bvs\.?\b/i;
/** Nor is a question. */
const QUESTION_TITLE = /^\s*(who|what|when|where|why|how|is|are|do|does|should|can)\b.*|\?\s*$/i;
/** Nor a news sentence. */
const NEWS_TITLE = /\b(says|said|warns?|sues?|sued|investigat\w+|arrested|charged|lawsuit|according to)\b/i;
const LOCATOR_TITLE = /\bfind (a|an|your)\b.*\b(contractor|dealer|installer|pro)\b|\b(contractor|dealer|installer) locator\b/i;

function pathOf(landingUrl: string | null): string {
  if (!landingUrl) return '';
  try { return new URL(landingUrl).pathname.toLowerCase(); }
  catch { return ''; }
}

/**
 * One observation, classified on its own.
 *
 * Deliberately knows nothing about the rest of the result set: the multiplicity rule
 * that catches an unknown directory needs the whole set and lives in the resolver, so
 * that this function stays a pure per-row decision that is easy to reason about.
 */
export function classifyObservation(observation: ClassifiableObservation): Classification {
  const reasons: string[] = [];
  const domain = registrableDomain(observation.observedDomain);
  const host = domain ? `${domain}.` : '';
  const title = (observation.observedName ?? '').trim();
  const path = pathOf(observation.landingUrl);

  // A provider business listing is the one source that is *about* a business by
  // construction: the provider resolved the entity, we did not infer it.
  if (observation.resultType === 'MAPS_LOCAL' || observation.resultType === 'LOCAL_SERVICES_AD') {
    if (title && (observation.observedPhone || observation.observedLocation)) {
      return { sourceClass: 'BUSINESS_LISTING',
        reasons: ['a provider business listing carrying a name and contact detail'] };
    }
    reasons.push('a listing result with no name and contact detail to identify it by');
    return { sourceClass: 'UNKNOWN', reasons };
  }

  if (!domain) {
    return { sourceClass: 'UNKNOWN', reasons: ['no domain to attribute this row to'] };
  }

  // Known third parties first, because one of them may legitimately appear once.
  if (KNOWN_MARKETPLACE.test(host)) {
    return { sourceClass: 'MARKETPLACE', reasons: ['a lead-generation marketplace'] };
  }
  if (KNOWN_DIRECTORY.test(host)) {
    return { sourceClass: 'DIRECTORY', reasons: ['a business directory'] };
  }
  if (KNOWN_SOCIAL.test(host)) return { sourceClass: 'SOCIAL', reasons: ['a social network'] };
  if (KNOWN_VIDEO.test(host)) return { sourceClass: 'VIDEO', reasons: ['a video platform'] };
  if (KNOWN_FORUM.test(host)) return { sourceClass: 'FORUM', reasons: ['a discussion forum'] };
  if (KNOWN_PUBLISHER.test(host)) return { sourceClass: 'PUBLISHER', reasons: ['a news publisher'] };
  if (KNOWN_MANUFACTURER.test(host)) {
    return { sourceClass: 'MANUFACTURER_LOCATOR',
      reasons: ['a manufacturer site; its dealers are not it'] };
  }

  // Then shape, which is what catches a directory nobody has heard of.
  if (LOCATOR_TITLE.test(title)) {
    return { sourceClass: 'MANUFACTURER_LOCATOR', reasons: ['a "find a contractor" locator page'] };
  }
  if (SOCIAL_PATH.test(path)) return { sourceClass: 'SOCIAL', reasons: ['a social post URL'] };
  if (FORUM_PATH.test(path) || QUESTION_TITLE.test(title)) {
    return { sourceClass: 'FORUM', reasons: ['a question rather than a business'] };
  }
  if (PUBLISHER_PATH.test(path) || NEWS_TITLE.test(title)) {
    return { sourceClass: 'PUBLISHER', reasons: ['an article about a business, not a business'] };
  }
  if (DIRECTORY_PATH.test(path)) {
    return { sourceClass: 'DIRECTORY',
      reasons: ['a URL shaped like a listing of other businesses'] };
  }
  if (LISTICLE_TITLE.test(title)) {
    return { sourceClass: 'LISTICLE', reasons: ['a ranked list of businesses'] };
  }

  // What is left looks like somebody's own site. Promotable, but only with
  // corroboration -- see the resolver.
  return { sourceClass: 'OFFICIAL_SITE', reasons: ['a page that may be this company’s own site'] };
}
