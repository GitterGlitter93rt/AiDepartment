import { createHash } from 'node:crypto';
import { query, withTransaction } from '../db/pool.js';
import { normalizeCompanyName } from '../domain/normalize.js';

/**
 * Official bulk datasets, downloaded once and matched many times.
 * Authority: migration 053, and the TSBPE governance entry.
 *
 * The rule this exists to enforce is in `downloadedAt`. A snapshot is as fresh as
 * its download and no fresher, so every read hands that date back and the read model
 * quotes it. Presenting cached data as newly verified is the same class of error as
 * a read model claiming a provider owes us results -- a true thing said about the
 * wrong moment.
 */

export interface SnapshotRecordInput {
  matchCompanyName?: string | null;
  matchPersonName?: string | null;
  licenseNumber?: string | null;
  city?: string | null;
  stateRegion?: string | null;
  payload: Record<string, unknown>;
}

export interface SnapshotMeta {
  snapshotId: string;
  sourceId: string;
  dataset: string;
  sourceReference: string | null;
  checksum: string;
  sourceGeneratedAt: Date | null;
  downloadedAt: Date;
  recordCount: number;
  parserVersion: string;
  state: 'LOADED' | 'CURRENT' | 'SUPERSEDED' | 'REJECTED';
}

export function checksumOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Loads a parsed dataset and makes it the one being read.
 *
 * Idempotent on content: loading the identical file twice returns the existing
 * snapshot rather than creating a second, because the unique key is the checksum. A
 * re-download that produces the same bytes is not new information and must not look
 * like a refresh.
 */
export interface LoadResult {
  snapshot: SnapshotMeta;
  created: boolean;
  /** Rows the parser produced that this loader would not index, and why. */
  rejected: { reason: string; count: number }[];
}

/**
 * Rows that cannot be matched against anything.
 *
 * A record with neither a company name nor a person name nor a licence number is not
 * a record we can ever join to an account: it would sit in the index for ever,
 * counted in `record_count`, inflating an operator's sense of how much data we hold.
 * Rejected loudly, with a count, rather than stored and forgotten.
 */
function rejectionReason(record: SnapshotRecordInput): string | null {
  const hasKey = Boolean(record.matchCompanyName?.trim())
    || Boolean(record.matchPersonName?.trim())
    || Boolean(record.licenseNumber?.trim());
  if (!hasKey) return 'no company name, person name or licence number to match on';
  if (!record.payload || Object.keys(record.payload).length === 0) {
    return 'empty payload, so nothing could be read back from it';
  }
  return null;
}

export async function loadSnapshot(input: {
  sourceId: string;
  dataset: string;
  parserVersion: string;
  content: string;
  records: SnapshotRecordInput[];
  sourceReference?: string | null;
  sourceGeneratedAt?: Date | null;
  notes?: string | null;
}): Promise<LoadResult> {
  const checksum = checksumOf(input.content);

  const existing = await query<SnapshotRow>(
    `select * from source_snapshots
      where source_id = $1 and dataset = $2 and checksum = $3`,
    [input.sourceId, input.dataset, checksum]);
  if (existing.rows[0]) {
    return { snapshot: toMeta(existing.rows[0]), created: false, rejected: [] };
  }

  const rejectedCounts = new Map<string, number>();
  const usable: SnapshotRecordInput[] = [];
  for (const record of input.records) {
    const reason = rejectionReason(record);
    if (reason) {
      rejectedCounts.set(reason, (rejectedCounts.get(reason) ?? 0) + 1);
      continue;
    }
    usable.push(record);
  }
  const rejected = [...rejectedCounts.entries()]
    .map(([reason, count]) => ({ reason, count }));

  return withTransaction(async (client) => {
    /**
     * One loader at a time per dataset.
     *
     * Two concurrent loads of different files would both supersede the other's
     * CURRENT row and could leave the dataset with none, or with two. The advisory
     * lock is released when the transaction ends, including on failure -- which is
     * also what makes a failed load leave the previous snapshot untouched and still
     * CURRENT.
     */
    await client.query('select pg_advisory_xact_lock(hashtext($1))',
      [`source_snapshot:${input.sourceId}:${input.dataset}`]);

    const inserted = await client.query<SnapshotRow>(
      `insert into source_snapshots
         (source_id, dataset, source_reference, checksum, source_generated_at,
          record_count, parser_version, state, notes)
       values ($1,$2,$3,$4,$5,$6,$7,'LOADED',$8)
       returning *`,
      [input.sourceId, input.dataset, input.sourceReference ?? null, checksum,
        // The count is what was indexed, not what was parsed: a record_count that
        // includes rows nothing can match overstates what this source can answer.
        input.sourceGeneratedAt ?? null, usable.length, input.parserVersion,
        input.notes ?? null]);
    const snapshot = inserted.rows[0]!;

    for (const record of usable) {
      await client.query(
        `insert into source_snapshot_records
           (snapshot_id, match_company_name, match_person_name, license_number,
            city, state_region, payload)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [snapshot.snapshot_id,
          record.matchCompanyName ? normalizeCompanyName(record.matchCompanyName) : null,
          record.matchPersonName ? record.matchPersonName.trim().toLowerCase() : null,
          record.licenseNumber ?? null, record.city ?? null,
          record.stateRegion ?? null, JSON.stringify(record.payload)]);
    }

    // The previous current snapshot becomes history rather than disappearing: an
    // account researched last month was researched against that data, and the audit
    // trail has to be able to say so.
    await client.query(
      `update source_snapshots set state = 'SUPERSEDED'
        where source_id = $1 and dataset = $2 and state = 'CURRENT'`,
      [input.sourceId, input.dataset]);
    await client.query(
      `update source_snapshots set state = 'CURRENT' where snapshot_id = $1`,
      [snapshot.snapshot_id]);

    const refreshed = await client.query<SnapshotRow>(
      'select * from source_snapshots where snapshot_id = $1', [snapshot.snapshot_id]);
    return { snapshot: toMeta(refreshed.rows[0]!), created: true, rejected };
  });
}

interface SnapshotRow {
  snapshot_id: string; source_id: string; dataset: string;
  source_reference: string | null; checksum: string;
  source_generated_at: Date | null; downloaded_at: Date; record_count: number;
  parser_version: string; state: SnapshotMeta['state'];
}

function toMeta(row: SnapshotRow): SnapshotMeta {
  return {
    snapshotId: row.snapshot_id, sourceId: row.source_id, dataset: row.dataset,
    sourceReference: row.source_reference, checksum: row.checksum,
    sourceGeneratedAt: row.source_generated_at, downloadedAt: row.downloaded_at,
    recordCount: row.record_count, parserVersion: row.parser_version, state: row.state,
  };
}

export async function currentSnapshot(
  sourceId: string, dataset: string,
): Promise<SnapshotMeta | null> {
  const { rows } = await query<SnapshotRow>(
    `select * from source_snapshots
      where source_id = $1 and dataset = $2 and state = 'CURRENT' limit 1`,
    [sourceId, dataset]);
  return rows[0] ? toMeta(rows[0]) : null;
}

/**
 * Every record in the current snapshot whose company name matches.
 *
 * Matching happens on the normalized name in SQL because the alternative -- reading
 * a hundred thousand rows into the worker to compare them in JavaScript -- is how a
 * per-account lookup becomes a per-account table scan.
 */
export async function findSnapshotRecordsByCompany(input: {
  sourceId: string;
  dataset: string;
  companyName: string;
  limit?: number;
}): Promise<{ snapshot: SnapshotMeta; payloads: Record<string, unknown>[] } | null> {
  const snapshot = await currentSnapshot(input.sourceId, input.dataset);
  if (!snapshot) return null;

  const { rows } = await query<{ payload: Record<string, unknown> }>(
    `select payload from source_snapshot_records
      where snapshot_id = $1 and match_company_name = $2
      limit $3`,
    [snapshot.snapshotId, normalizeCompanyName(input.companyName), input.limit ?? 25]);
  return { snapshot, payloads: rows.map((row) => row.payload) };
}
