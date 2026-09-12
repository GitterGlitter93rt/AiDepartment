import { normalizeGeography, type NormalizedGeography } from './geography.js';
import { providerTargetFor } from './providerLocation.js';
import {
  planSearchQueries, type DiscoveryStrategy, type QueryPurpose, type CoverageRole,
} from './searchTaxonomy.js';

/**
 * The N searches a discovery run will actually buy, decided before any of them runs.
 *
 * `queryBudget` used to mean "plan this many and run the first one". The vertical
 * taxonomy was read, ordered by intent, sliced to the budget -- and then index zero
 * was the only one anybody asked a provider for. An operator who set a budget of
 * twenty-five got one search, and the job reported a completed market search either
 * way. The market looked thin because we asked one question about it.
 *
 * A count now means that many independent searches: separate keywords, separate
 * provider tasks, separate fingerprints, separate accounting and separate outcomes.
 * "ac repair 32095" and "air conditioning replacement 32095" are two different
 * questions with two different answers, and joining them into one string asks a
 * question nobody types.
 *
 * The plan is built without touching a provider, so it can be printed and checked
 * before a penny is spent.
 */

export interface PlannedSearch {
  /** 1-based, in the order the strategy wants to spend. */
  index: number;
  /** The taxonomy term itself, e.g. "ac repair". */
  term: string;
  family: string;
  intentWeight: number;
  /** Whether advertisers are known to bid on this term. */
  advertiserTerm: boolean;
  /** The event this query assumes, when it assumes one. Null for a year-round service. */
  cause: string | null;
  /** What the provider is actually asked, geography included. */
  keyword: string;
  /** The place name the provider can geocode. */
  locationName: string;
  /** Identity of this one paid search, for the provider task lifecycle. */
  fingerprint: string;
  /** Finding the market, or learning what it sells. Shown in the paid preview. */
  purpose: QueryPurpose;
  coverageRole: CoverageRole;
}

export interface SearchPlan {
  searches: PlannedSearch[];
  /** What was asked for, before the taxonomy or the ceiling trimmed it. */
  requested: number;
  /** How many distinct terms the vertical actually defines. */
  available: number;
  /** Null when nothing trimmed the plan. */
  limitedBy: 'TAXONOMY' | 'PROVIDER_CEILING' | 'REQUEST' | null;
  /**
   * Cause-qualified queries held back because nobody asked for that event.
   *
   * Reported rather than silently dropped: an operator looking for storm-chasing
   * roofers needs to know the terms exist and how to ask for them.
   */
  causesAvailable: string[];
  /** Causes this run was asked to include. */
  causesRequested: string[];
  /** Set when no plan could be built at all. */
  refusal: { status: 'NOT_CONFIGURED'; reason: string } | null;
  geography: NormalizedGeography | null;
  /**
   * True when the budget did not cover this vertical's primary discovery terms.
   *
   * The taxonomy is phase-aware and this is where the phases get cut: a budget of one
   * buys the first primary term and leaves the rest of the market unasked. That is a
   * legitimate thing to do and an illegitimate thing to report as a searched market,
   * so the plan says so and the preview prints it.
   */
  partialDiscoveryCoverage: boolean;
  /** True when a commercial-intelligence query fitted in the budget. */
  commercialIntelligenceIncluded: boolean;
}

export interface SearchPlanRequest {
  verticalProfileId: string | null;
  geographyType: string | null;
  geographyValue: string | null;
  miningMode: string;
  /** How many independent searches to run. */
  count: number;
  /** The provider's own ceiling on calls per run, when it has one. */
  providerMaxQueries?: number;
  /**
   * Damage or weather events to include, on top of the vertical's own.
   *
   * Empty by default, deliberately. A rep who picks Roofing and a ZIP is asking for
   * roofers in that ZIP; searching for hail damage instead answers a question they
   * did not ask, finds a narrower slice, and does it silently. Storm work is a real
   * campaign an operator runs on purpose, so it is opt-in rather than a default.
   */
  causes?: string[];
  /** Included in every fingerprint so two markets never share a search identity. */
  marketId?: string | null;
}

/**
 * One paid search's identity.
 *
 * The job fingerprint identifies "a mining run for this market"; this identifies
 * "the search for these words in this place". They were the same string while only
 * one search ever ran, and using the job's key for N searches would have made the
 * second search look like an outstanding task for the first -- so the run would
 * collect one task, decide the rest were already owed, and buy nothing.
 */
export function searchFingerprint(input: {
  marketId?: string | null;
  verticalProfileId: string | null;
  geographyType: string | null;
  geographyValue: string | null;
  miningMode: string;
  term: string;
}): string {
  const geography = normalizeGeography(input.geographyType, input.geographyValue);
  const place = geography.ok
    ? `${geography.type}:${geography.value.toLowerCase()}`
    : `raw:${String(input.geographyValue ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;

  return [
    'search',
    input.marketId ?? '',
    (input.verticalProfileId ?? '').trim().toLowerCase(),
    place,
    (input.miningMode ?? 'advertiser_first').trim().toLowerCase(),
    // The term is what makes two searches of one market different searches, so it
    // is normalized the same way twice-typed geography is: an operator asking for
    // "AC Repair" and "ac  repair" must not buy the same words twice.
    input.term.trim().toLowerCase().replace(/\s+/g, ' '),
  ].join(':');
}

/**
 * Everything a search fingerprint carries except the words.
 *
 * Lets a caller ask "is any search of this market still owed?" without planning the
 * whole taxonomy first -- which the scheduler wants once per market per pass, purely
 * to report whether a run it is about to queue will be collecting or buying.
 */
export function searchFingerprintPrefix(input: {
  marketId?: string | null;
  verticalProfileId: string | null;
  geographyType: string | null;
  geographyValue: string | null;
  miningMode: string;
}): string {
  const full = searchFingerprint({ ...input, term: '\u0000' });
  return full.slice(0, full.length - 1);
}

export async function planDiscoverySearches(request: SearchPlanRequest): Promise<SearchPlan> {
  const empty = (reason: string): SearchPlan => ({
    searches: [], requested: request.count, available: 0, limitedBy: null,
    causesAvailable: [], causesRequested: [],
    refusal: { status: 'NOT_CONFIGURED', reason }, geography: null,
    partialDiscoveryCoverage: false, commercialIntelligenceIncluded: false,
  });

  const geography = normalizeGeography(request.geographyType, request.geographyValue);
  if (!geography.ok) return empty(geography.message);

  if (!request.verticalProfileId) {
    return empty('Pick a vertical: a market search needs to know what kind of business to '
      + 'look for.');
  }

  // Every term the vertical defines, ordered by the strategy. Asked for without a
  // ceiling so the plan can say how many exist as well as how many will run.
  const plan = await planSearchQueries({
    verticalProfileId: request.verticalProfileId,
    strategy: request.miningMode === 'broad_local' ? 'BROAD_LOCAL' : 'ADVERTISER_FIRST',
    budget: Number.MAX_SAFE_INTEGER,
  });
  // A vertical that cannot be discovered fails closed rather than falling back to its
  // sales keywords, which would buy one service and call it the market.
  if (plan.refusal) return empty(plan.refusal.message);
  const all = plan.queries;
  if (all.length === 0) {
    return empty(`The ${request.verticalProfileId} profile defines no search queries, so `
      + 'there is nothing to ask a provider.');
  }

  // Cause-neutral by default, plus whatever this trade exists for, plus whatever was
  // explicitly asked for.
  const { inherentCausesFor } = await import('./searchTaxonomy.js');
  const inherent = await inherentCausesFor(request.verticalProfileId);
  const asked = new Set((request.causes ?? []).map((cause) => cause.trim().toLowerCase()));
  const allowed = new Set([...inherent, ...asked]);
  const usable = all.filter((entry) => entry.cause === null || allowed.has(entry.cause));
  const heldBack = [...new Set(
    all.filter((entry) => entry.cause !== null && !allowed.has(entry.cause))
      .map((entry) => entry.cause!))].sort();

  const requested = Math.max(0, Math.floor(request.count));
  if (requested === 0) {
    return {
      searches: [], requested: 0, available: usable.length, limitedBy: 'REQUEST',
      causesAvailable: heldBack, causesRequested: [...asked].sort(),
      refusal: { status: 'NOT_CONFIGURED',
        reason: 'This run was asked for zero searches, so no provider was called.' },
      geography,
      partialDiscoveryCoverage: false, commercialIntelligenceIncluded: false,
    };
  }

  const ceiling = request.providerMaxQueries ?? Number.MAX_SAFE_INTEGER;
  const take = Math.min(requested, usable.length, ceiling);

  // The place the provider can geocode, resolved once for the whole plan: it is a
  // fact about the geography, not about any one term.
  const target = await providerTargetFor(geography);

  const searches: PlannedSearch[] = usable.slice(0, take).map((entry, offset) => ({
    index: offset + 1,
    term: entry.query,
    family: entry.family,
    intentWeight: entry.intentWeight,
    advertiserTerm: entry.recommendedForPaidSerp,
    cause: entry.cause,
    purpose: entry.purpose,
    coverageRole: entry.coverageRole,
    keyword: [entry.query, target.keywordSuffix].filter(Boolean).join(' '),
    locationName: target.locationName,
    fingerprint: searchFingerprint({
      marketId: request.marketId ?? null,
      verticalProfileId: request.verticalProfileId,
      geographyType: request.geographyType,
      geographyValue: request.geographyValue,
      miningMode: request.miningMode,
      term: entry.query,
    }),
  }));

  // Whether the slice covers the market or a corner of it. Computed from what was
  // selected against what exists, here rather than in the taxonomy, because this is
  // where the budget actually cuts.
  const isPrimaryDiscovery = (entry: { purpose: string; coverageRole: string }): boolean =>
    entry.purpose === 'ENTITY_DISCOVERY' && entry.coverageRole === 'PRIMARY';
  const primaryAvailable = usable.filter(isPrimaryDiscovery).length;
  const primarySelected = searches.filter(isPrimaryDiscovery).length;

  return {
    searches,
    requested,
    available: usable.length,
    limitedBy: take < requested
      ? (usable.length <= ceiling ? 'TAXONOMY' : 'PROVIDER_CEILING')
      : null,
    causesAvailable: heldBack,
    causesRequested: [...asked].sort(),
    refusal: null,
    geography,
    partialDiscoveryCoverage: primarySelected < primaryAvailable,
    commercialIntelligenceIncluded:
      searches.some((search) => search.purpose === 'COMMERCIAL_INTELLIGENCE'),
  };
}

/**
 * The plan as text, for an operator about to spend money.
 *
 * Prints what will be bought before anything is bought, which is the whole point:
 * "hail damage roof 32095" was only visibly wrong once somebody saw the words.
 */
export function renderSearchPlan(plan: SearchPlan): string {
  if (plan.refusal) return `\nNo searches planned: ${plan.refusal.reason}\n`;

  const lines = ['', `${plan.searches.length} independent search(es) planned`, ''];
  for (const search of plan.searches) {
    lines.push(`  ${String(search.index).padStart(2)}. "${search.keyword}"`);
    lines.push(`      in ${search.locationName}`);
    lines.push(`      ${search.family}, intent ${search.intentWeight}`
      + `${search.advertiserTerm ? ', advertisers bid on this' : ''}`);
    lines.push(`      ${search.fingerprint}`);
  }

  if (plan.causesAvailable.length > 0) {
    lines.push('', `Not searched: ${plan.causesAvailable.join(', ')} damage. Those terms `
      + 'find companies advertising for that event, which is a different question from '
      + 'who works in this trade here. Ask for them explicitly to include them.');
  }
  if (plan.limitedBy === 'TAXONOMY') {
    lines.push('', `Asked for ${plan.requested}; the ${''}vertical defines ${plan.available} `
      + 'distinct terms, so that is what will run. Nothing was invented to fill the gap.');
  } else if (plan.limitedBy === 'PROVIDER_CEILING') {
    lines.push('', `Asked for ${plan.requested}; the provider's own per-run ceiling allows `
      + `${plan.searches.length}.`);
  }
  lines.push('');
  return lines.join('\n');
}
