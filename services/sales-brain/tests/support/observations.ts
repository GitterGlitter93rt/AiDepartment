import type {
  NormalizedResultType, ProviderObservation,
} from '../../src/discovery/observation.js';

/**
 * Provider rows for a fixture adapter.
 *
 * Adapters return observations now, not businesses, so a test that wants to say "the
 * provider found this company" has to say it the way a provider would. That is the
 * point of the change: there is no longer a way for a fake adapter to hand the
 * orchestrator a finished Account and skip every promotion rule, which is exactly
 * what a second real provider would otherwise have been free to do.
 *
 * The default shape is a provider business listing carrying a name and contact
 * detail, because that is the strongest thing a SERP gives us and the one a fixture
 * usually means. A paid spec also emits the ad row it is describing, first, so the
 * promoted business keeps the ad copy and the landing page.
 */
export interface BusinessSpec {
  name: string;
  website?: string | null;
  phone?: string | null;
  resultType?: string;
  advertisedService?: string | null;
  landingUrl?: string | null;
  adHeadline?: string | null;
  query?: string | null;
  position?: number | null;
  providerNativeId?: string | null;
  observedAt?: Date | null;
  /** An address the provider observed for the business. Never a search geography. */
  observedBusinessAddress?: string | null;
  /** Accepted and ignored: a SERP row does not observe one. */
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

/**
 * A fixture's word for a result type, in the product's vocabulary.
 *
 * A spec that says `PAID_LOCAL` must produce a sponsored local result, not a text ad.
 * Flattening the paid types into one would let a sponsored local row be promoted to
 * "this company runs search ads", which is a claim about a company's spending that
 * the row does not support.
 */
const NORMALIZED: Record<string, NormalizedResultType> = {
  PAID_SEARCH_TEXT: 'PAID_SEARCH_TEXT', paid_search: 'PAID_SEARCH_TEXT',
  PAID_LOCAL: 'PAID_LOCAL', sponsored_local: 'PAID_LOCAL',
  LOCAL_SERVICES_AD: 'LOCAL_SERVICES_AD', local_service_ad: 'LOCAL_SERVICES_AD',
  MAPS_LOCAL: 'MAPS_LOCAL', local_result: 'MAPS_LOCAL',
  LOCAL_ORGANIC: 'LOCAL_ORGANIC',
  ORGANIC: 'ORGANIC', organic: 'ORGANIC',
  SHOPPING_OR_IRRELEVANT_PAID: 'SHOPPING_OR_IRRELEVANT_PAID',
  KNOWLEDGE_OR_ENTITY: 'KNOWLEDGE_OR_ENTITY',
};

/** A word this product does not know is OTHER, exactly as the adapter would say. */
function normalized(resultType: string | undefined): NormalizedResultType {
  if (!resultType) return 'MAPS_LOCAL';
  return NORMALIZED[resultType] ?? 'OTHER';
}

/** Paid rows whose title is a campaign, so something else has to name the company. */
const NEEDS_A_NAME_FROM_ELSEWHERE: ReadonlySet<NormalizedResultType> =
  new Set(['PAID_SEARCH_TEXT', 'PAID_LOCAL']);

function domainOf(website: string | null | undefined): string | null {
  const value = (website ?? '').trim();
  if (!value) return null;
  return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0]!.toLowerCase()
    || null;
}

function base(spec: BusinessSpec): ProviderObservation {
  return {
    providerNativeId: spec.providerNativeId ?? null,
    observedName: spec.name,
    observedDomain: domainOf(spec.website),
    observedPhone: spec.phone ?? null,
    observedBusinessAddress: spec.observedBusinessAddress
      // A listing with no phone still has to be identified by something the provider
      // observed about the business itself.
      ?? (spec.phone ? null : `${spec.name} premises`),
    searchLocationName: null,
    resultType: 'MAPS_LOCAL',
    position: spec.position ?? null,
    adHeadline: null,
    landingUrl: spec.landingUrl ?? null,
    advertisedService: null,
    checkUrl: null,
    observedAt: spec.observedAt ?? new Date(),
    query: spec.query ?? 'fixture search',
  };
}

export function observationsFor(specs: BusinessSpec[]): ProviderObservation[] {
  const observations: ProviderObservation[] = [];
  for (const spec of specs) {
    const type = normalized(spec.resultType);
    const advertised = {
      adHeadline: spec.adHeadline ?? spec.name,
      advertisedService: spec.advertisedService ?? spec.query ?? 'fixture search',
    };

    if (NEEDS_A_NAME_FROM_ELSEWHERE.has(type)) {
      // The ad, and then the listing that says whose ad it is. Both are real rows in
      // a real response, and the resolver needs the second one before it will let a
      // paid placement become a company -- an aggregator and a franchise portal buy
      // the same keywords, and a campaign title names neither.
      observations.push({
        ...base(spec), resultType: type, ...advertised, observedBusinessAddress: null,
      });
      observations.push(base(spec));
      continue;
    }

    if (type === 'LOCAL_SERVICES_AD') {
      // Google shows the business name on an LSA, so the row names itself.
      observations.push({ ...base(spec), resultType: type, ...advertised });
      continue;
    }

    if (type === 'ORGANIC' || type === 'LOCAL_ORGANIC') {
      observations.push({ ...base(spec), resultType: type, observedBusinessAddress: null });
      continue;
    }

    // MAPS_LOCAL by default, and anything this product does not recognise exactly as
    // it came: a shopping ad and an unknown block are observations, never companies.
    observations.push({ ...base(spec), resultType: type });
  }
  return observations;
}

/** Rows a provider returned that identify no business at all. */
export function junkObservations(count: number, query = 'fixture search'): ProviderObservation[] {
  return Array.from({ length: count }, (_unused, index) => ({
    providerNativeId: null,
    observedName: `Top 10 Contractors Near Me (${index + 1})`,
    observedDomain: null,
    observedPhone: null,
    observedBusinessAddress: null,
    searchLocationName: null,
    resultType: 'ORGANIC' as const,
    position: index + 1,
    adHeadline: null,
    landingUrl: null,
    advertisedService: null,
    checkUrl: null,
    observedAt: new Date(),
    query,
  }));
}
