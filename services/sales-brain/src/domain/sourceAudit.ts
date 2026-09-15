import { query } from '../db/pool.js';
import { governanceFor } from '../sources/governance.js';
import type { MatchStatus } from '../sources/types.js';

/**
 * Where we looked, and what happened.
 *
 * `research_runs.adapter_results.official_sources` has recorded this since stages B
 * and C started running, and nothing read it back. It is the answer to the question a
 * rep actually asks when a panel is empty -- "why is there no licence on this
 * account?" -- and the four answers are completely different:
 *
 *   we looked and there is none · we could not look · this state issues none ·
 *   we found several and could not tell them apart
 *
 * An empty panel says all four at once, which is to say nothing.
 */

export interface SourceAttempt {
  sourceId: string;
  displayName: string;
  status: MatchStatus;
  /** A sentence for a rep, not the adapter's internal reason. */
  summary: string;
  /** True when this says something about the company rather than about us. */
  aboutTheCompany: boolean;
  checkedAt: Date | null;
  sourceReference: string | null;
  /** Set when the answer came from a cached dataset rather than a live look. */
  snapshotDownloadedAt: Date | null;
}

const SUMMARIES: Record<MatchStatus, (name: string) => string> = {
  MATCHED: (name) => `${name} confirmed a record for this company.`,
  NO_MATCH: (name) => `${name} was searched and holds no record under this name. `
    + 'They may trade under a different legal name.',
  AMBIGUOUS: (name) => `${name} returned more than one company of this name and none `
    + 'could be told apart, so nothing was attached.',
  SOURCE_UNAVAILABLE: (name) => `${name} could not be reached, so nothing was checked. `
    + 'This says nothing about the company.',
  NOT_APPLICABLE_STATEWIDE: (name) => `${name} does not license this trade, so there is `
    + 'nothing to verify.',
  SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS: (name) =>
    `${name} is not checked automatically in this deployment.`,
};

/** Statuses that describe the company; the rest describe us. */
const ABOUT_THE_COMPANY: ReadonlySet<MatchStatus> = new Set<MatchStatus>([
  'MATCHED', 'NO_MATCH', 'AMBIGUOUS',
]);

interface RecordedOutcome {
  sourceId?: string;
  displayName?: string;
  status?: string;
  sourceReference?: string | null;
  snapshotDownloadedAt?: string | null;
}

/**
 * The newest attempt per source, from the most recent run that recorded any.
 *
 * Reads the newest run rather than merging history: an account page is not a
 * changelog, and "we checked DBPR in March and again in June" is one fact about June.
 */
export async function sourceAttemptsFor(accountId: string): Promise<SourceAttempt[]> {
  const { rows } = await query<{ adapter_results: unknown; completed_at: Date | null }>(
    `select adapter_results, completed_at
       from research_runs
      where account_id = $1 and adapter_results ? 'official_sources'
      order by completed_at desc nulls last
      limit 1`,
    [accountId]);

  const results = rows[0]?.adapter_results as { official_sources?: RecordedOutcome[] } | null;
  const outcomes = results?.official_sources ?? [];
  const checkedAt = rows[0]?.completed_at ?? null;

  const attempts: SourceAttempt[] = [];
  for (const outcome of outcomes) {
    const status = outcome.status as MatchStatus | undefined;
    if (!status || !(status in SUMMARIES)) continue;
    const name = outcome.displayName
      ?? governanceFor(outcome.sourceId ?? '')?.displayName
      ?? outcome.sourceId ?? 'A public source';
    attempts.push({
      sourceId: outcome.sourceId ?? 'unknown',
      displayName: name,
      status,
      summary: SUMMARIES[status](name),
      aboutTheCompany: ABOUT_THE_COMPANY.has(status),
      checkedAt,
      sourceReference: outcome.sourceReference ?? null,
      snapshotDownloadedAt: outcome.snapshotDownloadedAt
        ? new Date(outcome.snapshotDownloadedAt) : null,
    });
  }
  // Findings first: what a source concluded outranks what it could not do.
  return attempts.sort((left, right) =>
    Number(right.aboutTheCompany) - Number(left.aboutTheCompany));
}
