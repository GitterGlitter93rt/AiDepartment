import type { PersonObservation, EndpointObservation } from '../resolver/types.js';
import { allSourceAdapters, type Fetcher } from './registry.js';
import { licensingRequirement } from './requirements.js';
import { NON_FINDING_STATUSES, type MatchStatus, type OfficialFact,
  type SourceAdapter, type SourceLookupContext, type SourceLookupResult } from './types.js';

/**
 * Running the official-source stages.
 *
 * The rule that shapes this file: one source failing must not cost an account the
 * evidence another source already produced. Stage B and Stage C are independent
 * questions asked of independent agencies, and a Texas plumbing licence is no less
 * true because the Comptroller timed out. So every adapter runs inside its own
 * timeout and its own try/catch, and a thrown adapter becomes a recorded
 * SOURCE_UNAVAILABLE rather than a failed research run.
 */

export interface SourceStageOutcome {
  sourceId: string;
  displayName: string;
  stage: string;
  status: MatchStatus;
  reason: string;
  sourceReference: string | null;
  matchMethod: string | null;
  durationMs: number;
  factCount: number;
  peopleCount: number;
  /** Set when the answer came from a cached dataset rather than a live look. */
  snapshotDownloadedAt: string | null;
}

export interface SourceStageResult {
  people: PersonObservation[];
  endpoints: EndpointObservation[];
  /** Facts to write as evidence, each carrying the source that produced it. */
  facts: { fact: OfficialFact; sourceId: string; sourceReference: string | null;
    capturedAt: Date }[];
  outcomes: SourceStageOutcome[];
  /** Stages that ran at all, for research_runs.adapter_results. */
  stagesRun: string[];
  stagesSkipped: { stage: string; reason: string }[];
}

/** A promise that loses to its own clock. */
async function withTimeout<T>(
  work: Promise<T>, timeoutMs: number, onTimeout: () => T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Runs every applicable official source for one account.
 *
 * Adapters run in sequence rather than in parallel. They are all reading state
 * agencies at a polite rate, and the shared fetcher serialises per host anyway;
 * running them concurrently would buy nothing and make the rate limiting harder to
 * reason about.
 */
export async function runOfficialSources(input: {
  context: SourceLookupContext;
  fetcher?: Fetcher;
  adapters?: SourceAdapter[];
}): Promise<SourceStageResult> {
  const adapters = input.adapters ?? allSourceAdapters(input.fetcher);
  const result: SourceStageResult = {
    people: [], endpoints: [], facts: [], outcomes: [], stagesRun: [], stagesSkipped: [],
  };

  const stagesAttempted = new Set<string>();

  for (const adapter of adapters) {
    if (!adapter.supports(input.context)) continue;

    const availability = adapter.availability();
    if (availability === 'DISABLED_PAID_SOURCE' || availability === 'BLOCKED') {
      result.outcomes.push({
        sourceId: adapter.id, displayName: adapter.displayName, stage: adapter.stage,
        status: 'SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS',
        reason: availability === 'DISABLED_PAID_SOURCE'
          ? 'Paid source. No spending is authorised, so no request is made.'
          : 'The source does not permit automated access, and that is not worked around.',
        sourceReference: null, matchMethod: null, durationMs: 0,
        factCount: 0, peopleCount: 0, snapshotDownloadedAt: null,
      });
      continue;
    }

    const startedAt = Date.now();
    stagesAttempted.add(adapter.stage);

    let lookup: SourceLookupResult;
    try {
      lookup = await withTimeout(
        adapter.lookup(input.context),
        adapter.timeoutMs,
        () => ({
          sourceId: adapter.id, status: 'SOURCE_UNAVAILABLE' as const,
          reason: `The source did not answer within ${adapter.timeoutMs}ms.`,
          sourceReference: null, capturedAt: new Date(),
          facts: [], people: [], endpoints: [],
        }),
      );
    } catch (error) {
      // A source that throws is a source we could not read. It is never a finding
      // about the company, and it never fails the research run.
      lookup = {
        sourceId: adapter.id, status: 'SOURCE_UNAVAILABLE',
        reason: `The source could not be read: `
          + `${error instanceof Error ? error.message : String(error)}`,
        sourceReference: null, capturedAt: new Date(),
        facts: [], people: [], endpoints: [],
      };
    }

    result.outcomes.push({
      sourceId: adapter.id, displayName: adapter.displayName, stage: adapter.stage,
      status: lookup.status, reason: lookup.reason,
      sourceReference: lookup.sourceReference, matchMethod: lookup.matchMethod ?? null,
      durationMs: Date.now() - startedAt,
      factCount: lookup.facts.length, peopleCount: lookup.people.length,
      snapshotDownloadedAt: lookup.fromSnapshot?.downloadedAt.toISOString() ?? null,
    });

    // Only a match writes anything. AMBIGUOUS in particular is deliberately barren:
    // it means we found candidates and could not tell them apart, and writing "one of
    // these three companies' officers" is worse than writing nothing.
    if (lookup.status !== 'MATCHED') continue;

    result.people.push(...lookup.people);
    result.endpoints.push(...lookup.endpoints);
    for (const fact of lookup.facts) {
      result.facts.push({
        fact, sourceId: adapter.id, sourceReference: lookup.sourceReference,
        capturedAt: lookup.capturedAt,
      });
    }
  }

  // A licence stage that never ran because the state issues no licence is recorded
  // as exactly that, so completeness and the UI can tell it from a gap.
  const requirement = licensingRequirement(
    input.context.stateRegion, input.context.verticalProfileId);
  if (!stagesAttempted.has('C_public_license_registry')) {
    result.stagesSkipped.push({
      stage: 'C_public_license_registry',
      reason: requirement.scope === 'NONE' || requirement.scope === 'LOCAL_ONLY'
        ? requirement.note
        : requirement.scope === 'UNKNOWN'
          ? requirement.note
          : 'No licence source is configured for this state and trade.',
    });
  }
  if (!stagesAttempted.has('B_public_company_registry')) {
    result.stagesSkipped.push({
      stage: 'B_public_company_registry',
      reason: input.context.stateRegion
        ? `No company registry source covers ${input.context.stateRegion}.`
        : 'The account has no state on record, so no state registry applies.',
    });
  }
  result.stagesRun.push(...stagesAttempted);

  return result;
}

/** Whether an outcome should ever be shown to a rep as a negative finding. */
export function isNegativeFinding(status: MatchStatus): boolean {
  return status === 'NO_MATCH' && !NON_FINDING_STATUSES.has(status);
}
