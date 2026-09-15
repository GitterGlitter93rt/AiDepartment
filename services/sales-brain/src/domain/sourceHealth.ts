import { query } from '../db/pool.js';
import { SOURCE_GOVERNANCE, availabilityFor } from '../sources/governance.js';
import { allSnapshotHealth, snapshotPolicyFor, type SnapshotHealth }
  from '../sources/snapshotPolicy.js';
import type { MatchStatus, SourceAvailability } from '../sources/types.js';

/**
 * Whether the official sources are actually working, for whoever has to fix them.
 *
 * Distinct from the per-account "where we looked" panel, which answers a rep's
 * question about one company. This answers an operator's question about the fleet:
 * is a source failing everywhere, has a dataset gone stale, is anything enabled at
 * all. Those have different audiences and different failure modes -- an operator
 * needs to see a source that has returned SOURCE_UNAVAILABLE two hundred times, and a
 * rep never should.
 *
 * Read in one query rather than one per source. The obvious shape here is a loop over
 * sources each asking the database a question, and at a few dozen sources across
 * thirty days of runs that is a page that gets slower every week.
 */

export interface SourceOutcomeCounts {
  MATCHED: number;
  AMBIGUOUS: number;
  NO_MATCH: number;
  SOURCE_UNAVAILABLE: number;
  NOT_APPLICABLE_STATEWIDE: number;
  SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS: number;
}

export interface SourceHealth {
  sourceId: string;
  displayName: string;
  /** What governance says, and whether a flag has turned it on. */
  governanceStatus: SourceAvailability;
  effectiveAvailability: SourceAvailability;
  enabled: boolean;
  statusReason: string;
  /** Lookup outcomes over the reporting window. */
  counts: SourceOutcomeCounts;
  lookups: number;
  lastMatchedAt: Date | null;
  lastUnavailableAt: Date | null;
  /** Present for snapshot-backed sources. */
  snapshot: SnapshotHealth | null;
  /** One line an operator can act on, or reassure themselves with. */
  verdict: string;
}

const EMPTY_COUNTS = (): SourceOutcomeCounts => ({
  MATCHED: 0, AMBIGUOUS: 0, NO_MATCH: 0, SOURCE_UNAVAILABLE: 0,
  NOT_APPLICABLE_STATEWIDE: 0, SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS: 0,
});

export async function sourceHealth(windowDays = 30): Promise<SourceHealth[]> {
  // One pass over the window, expanded in the database. Every source's counts come
  // back from this single query.
  const { rows } = await query<{
    source_id: string; status: string; n: number; latest: Date | null;
  }>(
    `with outcomes as (
       select outcome->>'sourceId' as source_id,
              outcome->>'status'   as status,
              runs.completed_at
         from research_runs runs,
              lateral jsonb_array_elements(runs.adapter_results->'official_sources') outcome
        where runs.adapter_results ? 'official_sources'
          and runs.completed_at > now() - ($1 || ' days')::interval
     )
     select source_id, status, count(*)::int as n, max(completed_at) as latest
       from outcomes
      where source_id is not null and status is not null
      group by source_id, status`,
    [String(windowDays)]);

  const bySource = new Map<string, { counts: SourceOutcomeCounts;
    latestByStatus: Map<string, Date | null> }>();
  for (const row of rows) {
    const entry = bySource.get(row.source_id)
      ?? { counts: EMPTY_COUNTS(), latestByStatus: new Map() };
    if (row.status in entry.counts) {
      entry.counts[row.status as keyof SourceOutcomeCounts] = row.n;
    }
    entry.latestByStatus.set(row.status, row.latest);
    bySource.set(row.source_id, entry);
  }

  const snapshots = await allSnapshotHealth();
  const snapshotBySource = new Map(snapshots.map((entry) => [entry.sourceId, entry]));

  return SOURCE_GOVERNANCE.map((governance) => {
    const observed = bySource.get(governance.sourceId);
    const counts = observed?.counts ?? EMPTY_COUNTS();
    const lookups = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const effective = availabilityFor(governance.sourceId);
    const snapshot = snapshotPolicyFor(governance.sourceId, 'licensees')
      ? snapshotBySource.get(governance.sourceId) ?? null : null;

    return {
      sourceId: governance.sourceId,
      displayName: governance.displayName,
      governanceStatus: governance.status,
      effectiveAvailability: effective,
      enabled: effective === 'LIVE',
      statusReason: governance.statusReason,
      counts,
      lookups,
      lastMatchedAt: observed?.latestByStatus.get('MATCHED') ?? null,
      lastUnavailableAt: observed?.latestByStatus.get('SOURCE_UNAVAILABLE') ?? null,
      snapshot,
      verdict: verdictFor({ effective, counts, lookups, snapshot, paid: governance.paid }),
    };
  });
}

function verdictFor(input: {
  effective: SourceAvailability;
  counts: SourceOutcomeCounts;
  lookups: number;
  snapshot: SnapshotHealth | null;
  paid: boolean;
}): string {
  if (input.paid) return 'Paid source. Never called, by design.';
  if (input.effective === 'BLOCKED') {
    return 'The source does not permit automated access. Fixtures and parser are ready '
      + 'if that changes.';
  }
  if (input.effective === 'FEATURE_FLAGGED') {
    return 'Built and tested, switched off. One governance sign-off away from running.';
  }
  if (input.snapshot && input.snapshot.state === 'MISSING') {
    return 'Enabled, but no dataset is loaded, so every lookup answers "could not look".';
  }
  if (input.snapshot && input.snapshot.state === 'STALE') {
    return `Enabled, answering from a dataset ${input.snapshot.ageDays} days old. `
      + 'Re-obtain it.';
  }
  if (input.lookups === 0) return 'Enabled, and nothing has asked it anything yet.';

  // The number that matters when a source is on: is it answering, or only failing.
  const unavailable = input.counts.SOURCE_UNAVAILABLE;
  if (unavailable > 0 && unavailable >= input.lookups / 2) {
    return `Failing: ${unavailable} of ${input.lookups} lookups could not reach the source.`;
  }
  if (input.counts.AMBIGUOUS > input.counts.MATCHED && input.counts.AMBIGUOUS > 3) {
    return `Answering, but ${input.counts.AMBIGUOUS} lookups were too ambiguous to use `
      + '— worth checking whether the accounts carry enough address or phone '
      + 'detail to corroborate a name.';
  }
  return `Answering: ${input.counts.MATCHED} matched of ${input.lookups} lookups.`;
}

/** Statuses in the order an operator wants to read them. */
export const OUTCOME_ORDER: (keyof SourceOutcomeCounts)[] = [
  'MATCHED', 'NO_MATCH', 'AMBIGUOUS', 'SOURCE_UNAVAILABLE',
  'NOT_APPLICABLE_STATEWIDE', 'SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS',
];

export function outcomeLabel(status: keyof SourceOutcomeCounts | MatchStatus): string {
  switch (status) {
    case 'MATCHED': return 'matched';
    case 'NO_MATCH': return 'no record';
    case 'AMBIGUOUS': return 'ambiguous';
    case 'SOURCE_UNAVAILABLE': return 'could not reach';
    case 'NOT_APPLICABLE_STATEWIDE': return 'not licensed by the state';
    case 'SOURCE_REQUIRES_MANUAL_OR_APPROVED_ACCESS': return 'not enabled';
    default: return String(status).toLowerCase();
  }
}
