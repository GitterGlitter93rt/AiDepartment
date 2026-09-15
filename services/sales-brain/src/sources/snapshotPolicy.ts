import { query } from '../db/pool.js';
import { currentSnapshot, type SnapshotMeta } from './snapshots.js';

/**
 * How long a downloaded dataset may be believed, and what to do when it cannot be.
 *
 * A snapshot is the one place in this system where old data looks exactly like new
 * data. A licence row read out of a file downloaded in March is indistinguishable, at
 * the point of use, from one read this morning -- unless something keeps saying how
 * old the file is. That is this module's whole job.
 *
 * Two dates, deliberately kept apart. `downloadedAt` is when we fetched it;
 * `sourceGeneratedAt` is when the publisher says it was produced. A file pulled today
 * can be a quarter old, and reporting the download date as the data date would be a
 * true sentence about the wrong thing.
 */

export interface SnapshotPolicy {
  sourceId: string;
  dataset: string;
  /** How often the dataset should be re-obtained. */
  refreshDays: number;
  /**
   * When the data stops being usable as evidence rather than merely aging.
   *
   * Past this, matches are still returned -- withholding a known licence helps nobody
   * -- but the read model marks them stale and the UI says when the file was pulled.
   */
  staleAfterDays: number;
  /** What a human has to do to obtain it, in enough detail to act on. */
  howToObtain: string;
}

export const SNAPSHOT_POLICIES: SnapshotPolicy[] = [
  {
    sourceId: 'tx_tsbpe',
    dataset: 'licensees',
    refreshDays: 30,
    staleAfterDays: 120,
    howToObtain:
      'The Texas State Board of Plumbing Examiners publishes licensee information but '
      + 'exposes verification through a session-based application at '
      + 'vo.licensing.hpc.texas.gov/datamart, which is not appropriate to drive once '
      + 'per account. Request a licensee data extract from TSBPE (a public information '
      + 'request), asking specifically for: licence number, licence type (including '
      + 'Responsible Master Plumber), licensee name, associated company name, status, '
      + 'expiration date, insurance expiration where held, city and county. Load it '
      + 'with loadSnapshot({ sourceId: "tx_tsbpe", dataset: "licensees" }).',
  },
  {
    sourceId: 'fl_dbpr',
    dataset: 'licensees',
    refreshDays: 30,
    staleAfterDays: 120,
    howToObtain:
      'Florida DBPR publishes downloadable licensee files. Obtain the file for the '
      + 'Construction Industry and Electrical Contractors boards, containing licence '
      + 'number, licence type, rank, licensee name, DBA, business name, qualifying '
      + 'agent, primary and secondary status, original licensure date, expiry, city '
      + 'and county. The live search is a session-bearing POST form and is not used. '
      + 'Load with loadSnapshot({ sourceId: "fl_dbpr", dataset: "licensees" }).',
  },
];

export function snapshotPolicyFor(
  sourceId: string, dataset: string,
): SnapshotPolicy | null {
  return SNAPSHOT_POLICIES.find(
    (policy) => policy.sourceId === sourceId && policy.dataset === dataset) ?? null;
}

export type SnapshotHealthState =
  /** Loaded, and inside its refresh window. */
  | 'CURRENT'
  /** Loaded, past its refresh window, still inside the usable window. */
  | 'DUE_REFRESH'
  /** Loaded, and old enough that a rep should be told when it was pulled. */
  | 'STALE'
  /** Nothing loaded. Not the same as "no licence": we have not looked. */
  | 'MISSING';

export interface SnapshotHealth {
  sourceId: string;
  dataset: string;
  state: SnapshotHealthState;
  downloadedAt: Date | null;
  /** When the publisher says the data was produced, when the file says. */
  sourceGeneratedAt: Date | null;
  /** Age of the *data*, when known, otherwise age of the download. */
  ageDays: number | null;
  recordCount: number;
  parserVersion: string | null;
  nextRefreshDue: Date | null;
  /** A sentence an operator can act on. */
  summary: string;
  howToObtain: string | null;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

export async function snapshotHealth(
  sourceId: string, dataset: string, now: Date = new Date(),
): Promise<SnapshotHealth> {
  const policy = snapshotPolicyFor(sourceId, dataset);
  const snapshot = await currentSnapshot(sourceId, dataset);

  if (!snapshot) {
    return {
      sourceId, dataset, state: 'MISSING', downloadedAt: null, sourceGeneratedAt: null,
      ageDays: null, recordCount: 0, parserVersion: null, nextRefreshDue: null,
      summary: 'No dataset has been loaded, so this source cannot answer. That is not '
        + 'the same as a company having no licence.',
      howToObtain: policy?.howToObtain ?? null,
    };
  }

  // Age the *data* where the publisher dates it, and the download otherwise. A file
  // fetched today can be a quarter old, and the first is what a rep is relying on.
  const dataAge = daysBetween(snapshot.sourceGeneratedAt ?? snapshot.downloadedAt, now);
  const refreshDays = policy?.refreshDays ?? 30;
  const staleAfterDays = policy?.staleAfterDays ?? 120;

  const state: SnapshotHealthState = dataAge > staleAfterDays ? 'STALE'
    : dataAge > refreshDays ? 'DUE_REFRESH' : 'CURRENT';

  const nextRefreshDue = new Date(
    (snapshot.sourceGeneratedAt ?? snapshot.downloadedAt).getTime()
    + refreshDays * 86_400_000);

  const dated = snapshot.sourceGeneratedAt
    ? `published ${snapshot.sourceGeneratedAt.toISOString().slice(0, 10)}`
    : `downloaded ${snapshot.downloadedAt.toISOString().slice(0, 10)}`;

  return {
    sourceId, dataset, state,
    downloadedAt: snapshot.downloadedAt,
    sourceGeneratedAt: snapshot.sourceGeneratedAt,
    ageDays: dataAge,
    recordCount: snapshot.recordCount,
    parserVersion: snapshot.parserVersion,
    nextRefreshDue,
    summary: state === 'STALE'
      ? `${snapshot.recordCount} records, ${dated} — ${dataAge} days old. Matches are `
        + 'still returned and are marked stale; re-obtain the dataset.'
      : state === 'DUE_REFRESH'
        ? `${snapshot.recordCount} records, ${dated}. Due a refresh.`
        : `${snapshot.recordCount} records, ${dated}.`,
    howToObtain: policy?.howToObtain ?? null,
  };
}

/** Health for every dataset this product knows how to load. */
export async function allSnapshotHealth(now: Date = new Date()): Promise<SnapshotHealth[]> {
  return Promise.all(
    SNAPSHOT_POLICIES.map((policy) =>
      snapshotHealth(policy.sourceId, policy.dataset, now)));
}

/**
 * Snapshots kept after a load, newest first.
 *
 * A superseded snapshot is history rather than rubbish: an account researched last
 * month was researched against that file, and the audit trail has to be able to say
 * so. This is what an operator reads to answer "what changed between March and now".
 */
export async function snapshotHistory(
  sourceId: string, dataset: string, limit = 10,
): Promise<Pick<SnapshotMeta, 'snapshotId' | 'checksum' | 'downloadedAt'
| 'sourceGeneratedAt' | 'recordCount' | 'parserVersion' | 'state'>[]> {
  const { rows } = await query<{
    snapshot_id: string; checksum: string; downloaded_at: Date;
    source_generated_at: Date | null; record_count: number; parser_version: string;
    state: SnapshotMeta['state'];
  }>(
    `select snapshot_id, checksum, downloaded_at, source_generated_at, record_count,
            parser_version, state
       from source_snapshots
      where source_id = $1 and dataset = $2
      order by downloaded_at desc
      limit $3`,
    [sourceId, dataset, limit]);
  return rows.map((row) => ({
    snapshotId: row.snapshot_id, checksum: row.checksum, downloadedAt: row.downloaded_at,
    sourceGeneratedAt: row.source_generated_at, recordCount: row.record_count,
    parserVersion: row.parser_version, state: row.state,
  }));
}
