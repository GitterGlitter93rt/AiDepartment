import { flag, numeric } from '../../config.js';
import type {
  ApolloAdapter, ApolloErrorClass, ApolloOrganization, ApolloPerson, ApolloPersonCandidate,
  ApolloResponse, PeopleSearchRequest, PeopleSearchResult, PersonEnrichRequest,
} from './types.js';

/**
 * The Apollo HTTP client.
 *
 * The only place in the codebase that knows Apollo's JSON. Everything above it speaks the
 * normalised shapes in ./types.ts, so the day Apollo renames a field is a day one file
 * changes rather than a day the resolver breaks.
 *
 * Read at call time rather than captured at import, for the reason the spend ceiling and
 * the worker lane count both give: a value frozen at module load ignores anything set
 * after the process started, and no test can vary it.
 */

const BASE_URL = 'https://api.apollo.io/api/v1';

export interface ApolloConfig {
  apiKey: string | null;
  enabled: boolean;
  peopleSearchEnabled: boolean;
  peopleEnrichmentEnabled: boolean;
  organizationEnrichmentEnabled: boolean;
  phoneEnrichmentEnabled: boolean;
  waterfallEmailEnabled: boolean;
  waterfallPhoneEnabled: boolean;
  maxConcurrency: number;
  timeoutMs: number;
  webhookUrl: string | null;
}

export function apolloConfig(env: NodeJS.ProcessEnv = process.env): ApolloConfig {
  const text = (key: string): string | null => (env[key] ?? '').trim() || null;
  return {
    apiKey: text('APOLLO_API_KEY'),
    // Off globally by default. Every other flag is subordinate to this one.
    enabled: flag('APOLLO_ENABLED', false, env),
    peopleSearchEnabled: flag('APOLLO_PEOPLE_SEARCH_ENABLED', true, env),
    peopleEnrichmentEnabled: flag('APOLLO_PEOPLE_ENRICHMENT_ENABLED', false, env),
    organizationEnrichmentEnabled: flag('APOLLO_ORGANIZATION_ENRICHMENT_ENABLED', true, env),
    // Nine times the price of an email, and asynchronous. Off until measured.
    phoneEnrichmentEnabled: flag('APOLLO_PHONE_ENRICHMENT_ENABLED', false, env),
    waterfallEmailEnabled: flag('APOLLO_WATERFALL_EMAIL_ENABLED', false, env),
    waterfallPhoneEnabled: flag('APOLLO_WATERFALL_PHONE_ENABLED', false, env),
    maxConcurrency: numeric('APOLLO_MAX_CONCURRENCY', 2, { min: 1, max: 8, env }),
    timeoutMs: numeric('APOLLO_TIMEOUT_MS', 30_000, { min: 1000, env }),
    webhookUrl: text('APOLLO_WEBHOOK_URL'),
  };
}

/** The documented schedule, used where the response does not state a number. */
export const CREDIT_SCHEDULE = {
  peopleSearch: 0,
  /** "1 credit for demographics or email". */
  personDemographicOrEmail: 1,
  /** "plus 8 credits if a mobile phone is returned". */
  mobilePhone: 8,
  organizationEnrich: 1,
} as const;

function classifyHttp(status: number, body: unknown): ApolloErrorClass {
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) {
    // Apollo answers 403 both for a key without the scope and for a plan that does not
    // include the endpoint. They need different actions from a human, so they are
    // different classes rather than one shrug.
    const text = JSON.stringify(body ?? '').toLowerCase();
    return /plan|entitle|upgrade|not included|subscription/.test(text)
      ? 'NOT_ENTITLED' : 'FORBIDDEN';
  }
  if (status >= 400) return 'INVALID_REQUEST';
  return 'UNEXPECTED_SHAPE';
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function toText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeOrganization(raw: Record<string, unknown> | null): ApolloOrganization | null {
  if (!raw) return null;
  return {
    apolloOrganizationId: toText(raw['id']),
    name: toText(raw['name']),
    domain: toText(raw['primary_domain']) ?? toText(raw['domain']),
    websiteUrl: toText(raw['website_url']),
    industry: toText(raw['industry']),
    employeeCount: toNumber(raw['estimated_num_employees']),
    phone: toText(raw['phone']) ?? toText(raw['sanitized_phone']),
    street: toText(raw['street_address']),
    city: toText(raw['city']),
    state: toText(raw['state']),
    postalCode: toText(raw['postal_code']),
    country: toText(raw['country']),
    linkedinUrl: toText(raw['linkedin_url']),
  };
}

export function normalizeCandidate(raw: Record<string, unknown>): ApolloPersonCandidate | null {
  const id = toText(raw['id']);
  if (!id) return null;
  const org = raw['organization'] as Record<string, unknown> | undefined;
  const first = toText(raw['first_name']);
  const last = toText(raw['last_name']);
  return {
    apolloPersonId: id,
    firstName: first,
    lastName: last,
    fullName: toText(raw['name']) ?? ([first, last].filter(Boolean).join(' ') || null),
    title: toText(raw['title']),
    seniority: toText(raw['seniority']),
    organizationName: org ? toText(org['name']) : toText(raw['organization_name']),
    apolloOrganizationId: org ? toText(org['id']) : toText(raw['organization_id']),
    hasEmail: raw['has_email'] === true || Boolean(toText(raw['email'])),
    hasDirectPhone: raw['has_direct_phone'] === true,
    city: toText(raw['city']),
    state: toText(raw['state']),
    linkedinUrl: toText(raw['linkedin_url']),
    lastRefreshedAt: toText(raw['last_refreshed_at']),
  };
}

export function normalizePerson(raw: Record<string, unknown>): ApolloPerson | null {
  const base = normalizeCandidate(raw);
  if (!base) return null;
  const confidence = (toText(raw['match_confidence']) ?? 'none').toLowerCase();
  /**
   * A phone is only ever read from the field Apollo fills when a reveal was requested.
   *
   * The organization's own number arrives on the same object and is a switchboard. Reading
   * it here would turn a company line into somebody's mobile, which is the exact
   * distinction the endpoint model exists to keep.
   */
  const phoneNumbers = Array.isArray(raw['phone_numbers']) ? raw['phone_numbers'] : [];
  const mobile = (phoneNumbers as Record<string, unknown>[])
    .find((p) => /mobile|direct/i.test(String(p['type'] ?? '')));
  return {
    ...base,
    email: toText(raw['email']),
    emailStatus: toText(raw['email_status']),
    directPhone: mobile ? toText(mobile['sanitized_number']) ?? toText(mobile['raw_number']) : null,
    organization: normalizeOrganization(
      (raw['organization'] as Record<string, unknown> | undefined) ?? null),
    matchConfidence: (['high', 'medium', 'low', 'none'].includes(confidence)
      ? confidence : 'none') as ApolloPerson['matchConfidence'],
  };
}

/** What a settled enrichment cost, from what came back. */
export function costOfEnrichment(person: ApolloPerson | null): {
  creditConsuming: 'YES' | 'NO' | 'UNKNOWN'; creditsEstimated: number;
} {
  // Documented: nothing is charged when the match confidence is none.
  if (!person || person.matchConfidence === 'none') {
    return { creditConsuming: 'NO', creditsEstimated: 0 };
  }
  let estimated = CREDIT_SCHEDULE.personDemographicOrEmail;
  if (person.directPhone) estimated += CREDIT_SCHEDULE.mobilePhone;
  return { creditConsuming: 'YES', creditsEstimated: estimated };
}

export function createApolloAdapter(options: { config?: ApolloConfig } = {}): ApolloAdapter {
  const settings = options.config ?? apolloConfig();

  async function call<T>(input: {
    path: string; method: 'GET' | 'POST'; body?: unknown; query?: Record<string, string>;
    parse: (raw: Record<string, unknown>) => T | null;
    estimate: (data: T | null) => { creditConsuming: 'YES' | 'NO' | 'UNKNOWN'; creditsEstimated: number };
  }): Promise<ApolloResponse<T>> {
    if (!settings.apiKey) {
      return { ok: false, httpStatus: 0, providerRequestId: null, data: null,
        cost: { creditConsuming: 'NO', creditsCharged: null, creditsEstimated: 0 },
        errorClassification: 'UNAUTHENTICATED', retryable: false,
        errorMessage: 'No Apollo API key is configured, so no request was made.' };
    }

    const url = new URL(`${BASE_URL}${input.path}`);
    for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
      const response = await fetch(url, {
        method: input.method,
        headers: {
          // Apollo authenticates on this header. It is never logged and never stored.
          'x-api-key': settings.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: input.method === 'POST' ? JSON.stringify(input.body ?? {}) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: Record<string, unknown> = {};
      try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; }
      catch { /* handled as an unexpected shape below */ }

      const providerRequestId = toText(parsed['request_id']);
      if (!response.ok) {
        const classification = classifyHttp(response.status, parsed);
        return { ok: false, httpStatus: response.status, providerRequestId, data: null,
          // A refused call buys nothing, which is a fact worth recording rather than
          // leaving unknown.
          cost: { creditConsuming: 'NO', creditsCharged: null, creditsEstimated: 0 },
          errorClassification: classification,
          errorMessage: `Apollo answered ${response.status}`,
          retryable: classification === 'RATE_LIMITED' || classification === 'SERVER_ERROR' };
      }

      const data = input.parse(parsed);
      const estimate = input.estimate(data);
      return { ok: true, httpStatus: response.status, providerRequestId, data,
        cost: {
          creditConsuming: estimate.creditConsuming,
          // Apollo does not return a per-call charge on these endpoints. Recorded as
          // unknown rather than invented; the estimate sits beside it.
          creditsCharged: null,
          creditsEstimated: estimate.creditsEstimated,
        } };
    } catch (error) {
      const aborted = (error as { name?: string }).name === 'AbortError';
      return { ok: false, httpStatus: 0, providerRequestId: null, data: null,
        cost: { creditConsuming: 'UNKNOWN', creditsCharged: null, creditsEstimated: 0 },
        errorClassification: aborted ? 'TIMEOUT' : 'NETWORK',
        errorMessage: aborted ? 'the request timed out' : 'the request did not complete',
        retryable: true };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: 'apollo',
    isConfigured: () => Boolean(settings.apiKey) && settings.enabled,

    async searchPeople(request: PeopleSearchRequest) {
      return call<PeopleSearchResult>({
        path: '/mixed_people/api_search', method: 'POST',
        body: {
          q_organization_domains_list: request.organizationDomains ?? undefined,
          organization_names: request.organizationNames ?? undefined,
          person_titles: request.personTitles ?? undefined,
          person_seniorities: request.personSeniorities ?? undefined,
          page: request.page ?? 1,
          per_page: Math.min(request.perPage ?? 25, 100),
        },
        parse: (raw) => ({
          totalEntries: toNumber(raw['total_entries']) ?? 0,
          people: (Array.isArray(raw['people']) ? raw['people'] : [])
            .map((p) => normalizeCandidate(p as Record<string, unknown>))
            .filter((p): p is ApolloPersonCandidate => p !== null),
        }),
        // Documented at zero. Recorded as NO rather than UNKNOWN because that is what
        // the documentation states, and the ledger has to be able to say "free".
        estimate: () => ({ creditConsuming: 'NO', creditsEstimated: CREDIT_SCHEDULE.peopleSearch }),
      });
    },

    async enrichPerson(request: PersonEnrichRequest) {
      return call<ApolloPerson>({
        path: '/people/match', method: 'POST',
        body: buildEnrichBody(request, settings),
        parse: (raw) => normalizePerson(
          (raw['person'] as Record<string, unknown>) ?? raw),
        estimate: (person) => costOfEnrichment(person),
      });
    },

    async enrichPeopleBulk(requests) {
      return call<ApolloPerson[]>({
        path: '/people/bulk_match', method: 'POST',
        // Apollo accepts ten per call. More than that is silently truncated by the
        // provider, so it is refused here instead.
        body: { details: requests.slice(0, 10).map((r) => buildEnrichBody(r, settings)) },
        parse: (raw) => (Array.isArray(raw['matches']) ? raw['matches'] : [])
          .map((p) => normalizePerson(p as Record<string, unknown>))
          .filter((p): p is ApolloPerson => p !== null),
        estimate: (people) => {
          const list = people ?? [];
          const charged = list.filter((p) => p.matchConfidence !== 'none');
          return {
            creditConsuming: charged.length > 0 ? 'YES' : 'NO',
            creditsEstimated: charged.reduce(
              (sum, p) => sum + costOfEnrichment(p).creditsEstimated, 0),
          };
        },
      });
    },

    async enrichOrganization(domain: string) {
      return call<ApolloOrganization>({
        path: '/organizations/enrich', method: 'GET', query: { domain },
        parse: (raw) => normalizeOrganization(
          (raw['organization'] as Record<string, unknown>) ?? null),
        estimate: (org) => org
          ? { creditConsuming: 'YES', creditsEstimated: CREDIT_SCHEDULE.organizationEnrich }
          : { creditConsuming: 'NO', creditsEstimated: 0 },
      });
    },
  };
}

/**
 * The request body, with the expensive switches held down by configuration.
 *
 * A caller can ask for a phone; whether one is requested is decided here, against the
 * flags. That way "phone enrichment is off" is a property of the system rather than a
 * discipline every call site has to remember.
 */
function buildEnrichBody(request: PersonEnrichRequest, settings: ApolloConfig): Record<string, unknown> {
  const wantsPhone = Boolean(request.revealPhoneNumber) && settings.phoneEnrichmentEnabled;
  const wantsWaterfallEmail = Boolean(request.runWaterfallEmail) && settings.waterfallEmailEnabled;
  const wantsWaterfallPhone = Boolean(request.runWaterfallPhone) && settings.waterfallPhoneEnabled;
  const webhookUrl = request.webhookUrl ?? settings.webhookUrl ?? undefined;

  return {
    id: request.apolloPersonId,
    first_name: request.firstName,
    last_name: request.lastName,
    name: request.name,
    email: request.email,
    domain: request.domain,
    organization_name: request.organizationName,
    linkedin_url: request.linkedinUrl,
    reveal_personal_emails: Boolean(request.revealPersonalEmails),
    reveal_phone_number: wantsPhone,
    run_waterfall_email: wantsWaterfallEmail,
    run_waterfall_phone: wantsWaterfallPhone,
    // Apollo requires a webhook for a phone or a waterfall; sending one of those without
    // it is a request that cannot deliver its answer.
    ...((wantsPhone || wantsWaterfallEmail || wantsWaterfallPhone) && webhookUrl
      ? { webhook_url: webhookUrl } : {}),
  };
}
