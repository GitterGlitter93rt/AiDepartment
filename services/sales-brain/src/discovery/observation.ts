import { resolveCandidates, type EntityCandidate } from './resolve.js';
import { registrableDomain } from './sourceClass.js';

/**
 * What a discovery provider is allowed to hand back, and what happens to it.
 *
 * Entity resolution used to live inside the DataForSEO adapter, which meant it was
 * that adapter's private policy rather than the product's rule. `DiscoveryResult`
 * carried `businesses`, so any adapter -- a second provider, a fixture, a benchmark
 * harness, anything registered later -- could put whatever it liked straight into
 * `ingestDiscoveries` and create Accounts from raw SERP rows without a single check
 * running. The resolver being correct is no protection when it is optional.
 *
 * So the contract is observations only. An adapter normalizes its provider's shapes
 * into `ProviderObservation` and stops; the orchestrator resolves. There is no other
 * way in, and there is no `businesses` field for one to appear on.
 */

/** Result types this product understands, per the normalization spec §2. */
export type NormalizedResultType =
  | 'PAID_SEARCH_TEXT' | 'PAID_LOCAL' | 'LOCAL_SERVICES_AD' | 'SHOPPING_OR_IRRELEVANT_PAID'
  | 'LOCAL_ORGANIC' | 'ORGANIC' | 'MAPS_LOCAL' | 'KNOWLEDGE_OR_ENTITY' | 'OTHER';

/** Only these types are evidence that somebody paid for placement. */
export function isPaidPlacement(type: NormalizedResultType): boolean {
  return type === 'PAID_SEARCH_TEXT' || type === 'PAID_LOCAL' || type === 'LOCAL_SERVICES_AD';
}

/**
 * Result types that can become a prospect. An unclassified block, a knowledge panel
 * or a shopping ad is an observation worth keeping but not a company to research.
 */
const CANDIDATE_TYPES = new Set<NormalizedResultType>([
  'PAID_SEARCH_TEXT', 'PAID_LOCAL', 'LOCAL_SERVICES_AD', 'LOCAL_ORGANIC', 'ORGANIC', 'MAPS_LOCAL',
]);

export interface ProviderObservation {
  /** The provider's id for *this business*, or nothing. Never the search's id. */
  providerNativeId: string | null;
  observedName: string | null;
  observedDomain: string | null;
  observedPhone: string | null;
  /**
   * An address the provider observed *for this business*, or nothing.
   *
   * This was `result.location_name ?? item.address`, which is two different facts
   * with the search target winning. `location_name` is where we asked the provider to
   * search -- "St. Augustine,Florida,United States" -- and it is present on every row
   * of every response, so a business's own address could never win the coalesce. The
   * classifier then read that field as evidence a Maps row identified a business,
   * which meant the geography we typed helped verify the entity.
   */
  observedBusinessAddress: string | null;
  /**
   * The same address in parts, and only when the provider resolved them itself.
   *
   * A free-form line is never parsed into these. The separation exists so that a
   * provider that does know the city and the ZIP can say so, and one that does not
   * leaves them null rather than having them guessed out of a string.
   */
  observedCity: string | null;
  observedRegion: string | null;
  observedPostalCode: string | null;
  /** Where the provider was asked to look. Discovery provenance, never an address. */
  searchLocationName: string | null;
  resultType: NormalizedResultType;
  position: number | null;
  adHeadline: string | null;
  landingUrl: string | null;
  advertisedService: string | null;
  checkUrl: string | null;
  observedAt: Date;
  query: string;
}

export interface DiscoveredBusiness {
  name: string;
  website?: string | null;
  phone?: string | null;
  /** As the provider printed it, when it observed one for this business. */
  observedBusinessAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  providerNativeId?: string | null;
  resultType?: string;
  advertisedService?: string | null;
  landingUrl?: string | null;
  /**
   * What the provider actually showed us, kept so a rep can quote it.
   *
   * The adapter normalized every one of these and then dropped them on the way
   * here: the search that found the company, where it sat on the page, what the ad
   * said, the provider's own verification link, and when the SERP was really read.
   * `search_observations` has had a column waiting for each since migration 003.
   * Without them an observation says only "paid_search", which is a claim with no
   * proof behind it -- and on a collected task, one stamped at collection time
   * rather than at the moment the page was read, which overstates its freshness.
   */
  query?: string | null;
  position?: number | null;
  adHeadline?: string | null;
  checkUrl?: string | null;
  observedAt?: Date | null;
}

/**
 * One resolution of one provider answer.
 *
 * The counters are separate on purpose. "The provider returned 50 rows" is not
 * "50 new businesses discovered": some rows identify nothing, some are the same
 * company twice, and some are not companies at all. An operator needs those numbers
 * apart, or the Mining page is arithmetic nobody can check.
 */
export interface ResolvedObservations {
  candidates: EntityCandidate[];
  businesses: DiscoveredBusiness[];
  /** Rows the provider returned, before any filtering of ours. */
  providerRows: number;
  /** Rows dropped because nothing in them identified a business. */
  rejectedRows: number;
  /** Rows collapsed into another row for the same company. */
  duplicateRows: number;
  reason: string;
}

/**
 * Rows in, identities out. The one place either happens.
 *
 * This used to be "dedupe": group by domain, keep the best row, ship it as a company.
 * What was missing is the question in between -- is this a company at all, and if so
 * which one -- and that question needs the whole result set rather than one row.
 */
export function resolveObservations(
  observations: ProviderObservation[],
  /** Words that are generic in this market, from the vertical's own taxonomy. */
  genericTerms: ReadonlySet<string> = new Set(),
): ResolvedObservations {
  /**
   * The market's own vocabulary, plus the place the provider says it searched.
   *
   * The caller derives the first from the vertical's taxonomy and the geography it
   * asked for. The second comes from the response: `location_name` is on every row,
   * it is how the provider spells this market's place, and a ZIP that our own records
   * cannot resolve to a town still arrives here with the town written on it. Without
   * it, the first search of an unfamiliar ZIP is exactly the case where a
   * city-plus-trade domain has nothing to stop it corroborating itself.
   *
   * This says nothing about where any business is; `searchLocationName` is never
   * business-address evidence. It decides only which words are too widely shared to
   * prove a domain belongs to a particular company.
   */
  const marketVocabulary = new Set<string>(genericTerms);
  for (const observation of observations) {
    for (const word of (observation.searchLocationName ?? '')
      .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)) {
      if (word.length >= 3) marketVocabulary.add(word);
    }
  }

  const eligible = observations.filter((observation) => CANDIDATE_TYPES.has(observation.resultType));
  const candidates = resolveCandidates(eligible.map((observation) => ({
    resultType: observation.resultType,
    observedName: observation.observedName,
    observedDomain: observation.observedDomain,
    observedPhone: observation.observedPhone,
    observedBusinessAddress: observation.observedBusinessAddress,
    landingUrl: observation.landingUrl,
    position: observation.position,
  })), marketVocabulary);

  const verified = candidates.filter((candidate) => candidate.status === 'VERIFIED');
  const businesses = businessesFromCandidates(verified, eligible);

  // The funnel an operator can check, kept as the arithmetic it always was: rows the
  // provider sent, minus rows with nothing to identify them, minus rows that collapsed
  // into another row for the same company, equals the identities that came out.
  const identified = eligible.filter((observation) =>
    registrableDomain(observation.observedDomain) || observation.observedPhone?.trim());
  const refused = candidates.length - verified.length;

  return {
    candidates,
    businesses,
    providerRows: observations.length,
    rejectedRows: observations.length - identified.length,
    duplicateRows: identified.length - candidates.length,
    reason: `${observations.length} row(s) read, ${candidates.length} identit(ies) resolved, `
      + `${businesses.length} business(es) verified, ${refused} not promoted.`,
  };
}

/**
 * The promotable candidates, in the shape ingestion already understands.
 *
 * Only verified candidates reach this, and each carries the name the resolver was
 * willing to defend rather than whichever page title ranked highest.
 */
function businessesFromCandidates(
  verified: EntityCandidate[], observations: ProviderObservation[],
): DiscoveredBusiness[] {
  /**
   * Which row speaks for the company, chosen rather than encountered.
   *
   * This used to keep the first observation seen for an identity, so a company that
   * appeared as an organic result, a paid ad and a Maps listing had its address,
   * provider id and result type decided by whichever the provider happened to print
   * first. The same three rows in a different order produced a different Account.
   *
   * A provider business listing is the strongest thing here by construction -- the
   * provider resolved the entity rather than us inferring it -- so it speaks for the
   * company, then whichever row carries a structured address, then page order. The
   * *sighting* fields that come with it are only a representative sighting: the
   * advertising evidence is built from every paid observation separately, because a
   * company that both ranks and advertises has two facts about it and one of them is
   * not a consequence of the other.
   */
  const strength = (observation: ProviderObservation): number => {
    let score = 0;
    if (observation.resultType === 'MAPS_LOCAL'
      || observation.resultType === 'LOCAL_SERVICES_AD') score += 8;
    if (observation.observedCity || observation.observedPostalCode) score += 4;
    if (observation.observedBusinessAddress) score += 2;
    if (observation.providerNativeId) score += 1;
    return score;
  };

  const byIdentity = new Map<string, ProviderObservation>();
  for (const observation of observations) {
    const identity = registrableDomain(observation.observedDomain)
      ?? (observation.observedPhone?.trim() || null);
    if (!identity) continue;
    const held = byIdentity.get(identity);
    if (!held) { byIdentity.set(identity, observation); continue; }
    const better = strength(observation) - strength(held);
    if (better > 0) { byIdentity.set(identity, observation); continue; }
    // A deterministic tie-break, so equal rows do not depend on arrival order.
    if (better === 0
      && (observation.position ?? Number.MAX_SAFE_INTEGER)
         < (held.position ?? Number.MAX_SAFE_INTEGER)) {
      byIdentity.set(identity, observation);
    }
  }

  const businesses: DiscoveredBusiness[] = [];
  for (const candidate of verified) {
    if (!candidate.resolvedName) continue;
    const seen = byIdentity.get(candidate.identity);
    businesses.push({
      name: candidate.resolvedName,
      // The URL form, as inventory has always stored it. The candidate carries the
      // registrable domain because that is the identity; this is the address.
      website: candidate.domain ? `https://${candidate.domain}` : null,
      phone: candidate.phone,
      /**
       * An address only when the provider observed one, in parts it resolved itself.
       *
       * Never the searched geography -- that fallback is what made 65 of 65 canary
       * Accounts claim a location nobody had seen -- and never a free-form line split
       * up here. When the provider gave only a printed address it stays as
       * `observedBusinessAddress`, which the Account keeps as observed evidence
       * without pretending to know which ZIP it is in.
       */
      observedBusinessAddress: candidate.observedBusinessAddress,
      city: seen?.observedCity ?? null,
      state: seen?.observedRegion ?? null,
      postalCode: seen?.observedPostalCode ?? null,
      providerNativeId: seen?.providerNativeId ?? null,
      resultType: seen?.resultType,
      advertisedService: seen?.advertisedService ?? null,
      landingUrl: seen?.landingUrl ?? null,
      query: seen?.query ?? null,
      position: seen?.position ?? null,
      adHeadline: seen?.adHeadline ?? null,
      checkUrl: seen?.checkUrl ?? null,
      observedAt: seen?.observedAt ?? null,
    });
  }
  return businesses;
}
