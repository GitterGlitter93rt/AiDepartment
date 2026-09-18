/**
 * Apollo, normalised.
 *
 * Core Sales Brain logic never sees Apollo's JSON. The shapes here are what the resolver,
 * the attribution layer and the ledger agree to speak, so that a change at Apollo is a
 * change in one adapter rather than a change everywhere a person is decided.
 *
 * Documented behaviour this integration relies on, verified against docs.apollo.io on
 * 2026-09-18. Recorded here because the economics of the whole design follow from it:
 *
 *   POST /api/v1/mixed_people/api_search   people search       0 credits
 *   POST /api/v1/people/match              person enrichment   1 credit for demographics
 *                                                              or email; +8 if a mobile
 *                                                              phone is returned; nothing
 *                                                              when match_confidence is
 *                                                              "none"
 *   POST /api/v1/people/bulk_match         up to 10 people     same per person
 *   GET  /api/v1/organizations/enrich      organization        1 credit
 *
 * Authentication is the `x-api-key` header. `reveal_phone_number` makes the call
 * asynchronous and requires a `webhook_url` (or `poll_only`). Rate limiting answers 429
 * with `USAGE.RATE_LIMIT.API_RATE_LIMIT_EXCEEDED`.
 *
 * Two consequences shape everything below. Search is free and reports `has_email` and
 * `has_direct_phone` per person, so we can find the owner and know whether an address
 * exists before paying anything. And a phone costs nine times an email, which is why it
 * is off by default rather than merely discouraged.
 */

export type ApolloOperation =
  | 'PEOPLE_SEARCH' | 'PEOPLE_MATCH' | 'BULK_PEOPLE_MATCH' | 'ORGANIZATION_ENRICH';

export type ApolloRequestMode =
  | 'SEARCH_ONLY' | 'ENRICH_DEMOGRAPHIC' | 'ENRICH_EMAIL' | 'ENRICH_PHONE'
  | 'WATERFALL_EMAIL' | 'WATERFALL_PHONE' | 'ORGANIZATION';

/** Apollo's own word for how sure it is. `none` is documented to charge nothing. */
export type ApolloMatchConfidence = 'high' | 'medium' | 'low' | 'none';

export interface ApolloOrganization {
  apolloOrganizationId: string | null;
  name: string | null;
  domain: string | null;
  websiteUrl: string | null;
  industry: string | null;
  employeeCount: number | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  linkedinUrl: string | null;
}

/**
 * A person as search returns them: enough to choose, not enough to contact.
 *
 * `hasEmail` and `hasDirectPhone` are the fields that make the waterfall economical --
 * they say whether paying would get anything, for nothing.
 */
export interface ApolloPersonCandidate {
  apolloPersonId: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  title: string | null;
  seniority: string | null;
  organizationName: string | null;
  apolloOrganizationId: string | null;
  hasEmail: boolean;
  hasDirectPhone: boolean;
  city: string | null;
  state: string | null;
  linkedinUrl: string | null;
  lastRefreshedAt: string | null;
}

/** A person after enrichment: what was paid for. */
export interface ApolloPerson extends ApolloPersonCandidate {
  email: string | null;
  emailStatus: string | null;
  /** Only ever populated when phone reveal was explicitly requested and returned. */
  directPhone: string | null;
  organization: ApolloOrganization | null;
  matchConfidence: ApolloMatchConfidence;
}

/** What a call cost, honestly. */
export interface ApolloCost {
  /** YES when the response shows credit-consuming data came back. */
  creditConsuming: 'YES' | 'NO' | 'UNKNOWN';
  /** What Apollo said it charged. Null means unknown, and never means zero. */
  creditsCharged: number | null;
  /** What we expect it charged, from the documented schedule. */
  creditsEstimated: number;
}

export interface ApolloResponse<T> {
  ok: boolean;
  httpStatus: number;
  /** Apollo's request_id, for webhook and poll correlation. */
  providerRequestId: string | null;
  data: T | null;
  cost: ApolloCost;
  /** Set when the call failed. Never a credential, never a raw body. */
  errorClassification?: ApolloErrorClass;
  errorMessage?: string;
  /** True for the transient classes only. A 400 or a 401 is never retried. */
  retryable?: boolean;
}

export type ApolloErrorClass =
  | 'RATE_LIMITED' | 'SERVER_ERROR' | 'TIMEOUT' | 'NETWORK'
  | 'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_ENTITLED'
  | 'UNEXPECTED_SHAPE';

/** Error classes worth trying again. Everything else is a fact about the request. */
export const RETRYABLE_ERRORS: ReadonlySet<ApolloErrorClass> = new Set<ApolloErrorClass>([
  'RATE_LIMITED', 'SERVER_ERROR', 'TIMEOUT', 'NETWORK',
]);

export interface PeopleSearchRequest {
  /** The strongest key there is, and the one we prefer. */
  organizationDomains?: readonly string[];
  organizationNames?: readonly string[];
  personTitles?: readonly string[];
  personSeniorities?: readonly string[];
  page?: number;
  perPage?: number;
}

export interface PeopleSearchResult {
  totalEntries: number;
  people: ApolloPersonCandidate[];
}

export interface PersonEnrichRequest {
  apolloPersonId?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  domain?: string;
  organizationName?: string;
  linkedinUrl?: string;
  /** Costs 8 credits when a number comes back, and makes the call asynchronous. */
  revealPhoneNumber?: boolean;
  revealPersonalEmails?: boolean;
  runWaterfallEmail?: boolean;
  runWaterfallPhone?: boolean;
  /** Required by Apollo whenever a phone or a waterfall is requested. */
  webhookUrl?: string;
}

/**
 * The adapter the rest of Sales Brain talks to.
 *
 * Narrow on purpose. Every operation here is one that the orchestration layer has a
 * reason to call, and there is no general "call Apollo" escape hatch, because that is how
 * a provider's shape leaks into a codebase.
 */
export interface ApolloAdapter {
  readonly name: string;
  isConfigured(): boolean;
  /** Free. Used to find and rank candidates before anything is bought. */
  searchPeople(request: PeopleSearchRequest): Promise<ApolloResponse<PeopleSearchResult>>;
  /** Paid. One person. */
  enrichPerson(request: PersonEnrichRequest): Promise<ApolloResponse<ApolloPerson>>;
  /** Paid. Up to ten; correlated by Apollo person id, never by array position. */
  enrichPeopleBulk(requests: readonly PersonEnrichRequest[]):
    Promise<ApolloResponse<ApolloPerson[]>>;
  /** Paid, one credit. Only where the free path cannot answer. */
  enrichOrganization(domain: string): Promise<ApolloResponse<ApolloOrganization>>;
}
