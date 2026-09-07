import { query } from '../db/pool.js';
import { formatBytes } from '../release/growthProjection.js';
import { NO_POLICY, type RetentionPolicy, type TableRetention } from './policy.js';

/**
 * What a retention run would delete, and what it must never touch.
 *
 * The protection is the point. A row that is old is not the same as a row nobody
 * needs: a stored score cites the evidence ids that produced it, so pruning that
 * evidence would leave every score lineage pointing at nothing, and a rep asking
 * "why is this company Tier A" would get a number with no reasons. A provider task
 * still owed to us is a search we paid for and have not read. The activity that
 * records where an Account came from is the only answer to "how did we find these
 * people", which is a question a prospect is entitled to ask.
 *
 * So each table declares what makes a row protected, the plan counts protected rows
 * separately, and nothing here deletes anything at all.
 */

export interface TablePlan {
  table: string;
  rationale: string;
  keepDays: number | null;
  totalRows: number;
  /** Rows older than the policy allows. Zero when no period is set. */
  olderThanPolicy: number;
  /** Of those, how many are protected and would be kept anyway, and why. */
  protectedRows: number;
  protectionReason: string | null;
  /** What a run would actually delete. */
  deletable: number;
  /** Rows by age, so an operator can see the shape before choosing a period. */
  ageBuckets: { label: string; n: number }[];
  estimatedReclaimedBytes: number;
}

export interface RetentionPlan {
  policyApprovedBy: string | null;
  /** True when no period is set anywhere, so the plan is an inventory. */
  inventoryOnly: boolean;
  tables: TablePlan[];
  totalDeletable: number;
  totalReclaimedBytes: number;
  /** Anything that stopped the plan being built. */
  error: string | null;
}

/**
 * What makes a row in this table protected, as SQL.
 *
 * Written per table rather than generically, because "still needed" means something
 * different each time and a generic rule would be wrong somewhere.
 */
const PROTECTION: Record<string, { sql: string; reason: string }> = {
  search_observations: {
    // The provenance a rep quotes, and the only record of how a claimed company was
    // found. Deleting it under a worked Account removes the answer to a question the
    // prospect may ask on the call.
    sql: `exists (select 1 from accounts a
                   where a.account_id = o.account_id
                     and (a.ownership_state = 'CLAIMED' or a.is_suppressed))`,
    reason: 'the company is claimed by a rep or suppressed, so how we found them is '
      + 'still being relied on',
  },
  provider_tasks: {
    sql: `o.status = 'PENDING'`,
    reason: 'the provider still owes us this search and it has been paid for',
  },
  canonical_scores: {
    // The newest score per Account is the one every page reads.
    sql: `not exists (select 1 from canonical_scores newer
                       where newer.account_id = o.account_id
                         and newer.calculated_at > o.calculated_at)`,
    reason: 'it is the current score for that company',
  },
  research_runs: {
    sql: `exists (select 1 from evidence_records e where e.research_run_id = o.research_run_id)`,
    reason: 'evidence still cites this run as its source',
  },
  jobs: {
    sql: `o.status in ('QUEUED','RUNNING')`,
    reason: 'the job has not finished',
  },
  provider_usage: {
    sql: `o.actual_cost_usd is null and o.estimated_cost_usd > 0`,
    reason: 'the cost is still estimated, so the invoice has not been reconciled',
  },
};

const AGE_BUCKETS = [
  { label: 'under 7 days', from: 0, to: 7 },
  { label: '7-30 days', from: 7, to: 30 },
  { label: '30-90 days', from: 30, to: 90 },
  { label: '90-365 days', from: 90, to: 365 },
  { label: 'over a year', from: 365, to: null as number | null },
];

async function planTable(entry: TableRetention): Promise<TablePlan> {
  const protection = PROTECTION[entry.table];

  const { rows: sizeRows } = await query<{ rows: number; bytes: number }>(
    `select coalesce(s.n_live_tup, 0)::bigint as rows,
            pg_total_relation_size(c.oid)::bigint as bytes
       from pg_class c
       left join pg_stat_user_tables s on s.relid = c.oid
      where c.relname = $1`, [entry.table]);
  const totalRows = Number(sizeRows[0]?.rows ?? 0);
  const bytes = Number(sizeRows[0]?.bytes ?? 0);
  const bytesPerRow = totalRows > 0 ? bytes / totalRows : 0;

  const buckets: { label: string; n: number }[] = [];
  for (const bucket of AGE_BUCKETS) {
    const upper = bucket.to === null ? '' :
      ` and ${entry.timestamp} > now() - interval '${bucket.to} days'`;
    const { rows } = await query<{ n: number }>(
      `select count(*)::int as n from ${entry.table} o
        where o.${entry.timestamp} <= now() - interval '${bucket.from} days'${upper}`);
    buckets.push({ label: bucket.label, n: rows[0]!.n });
  }

  if (entry.keepDays === null) {
    return {
      table: entry.table, rationale: entry.rationale, keepDays: null,
      totalRows, olderThanPolicy: 0, protectedRows: 0,
      protectionReason: protection?.reason ?? null,
      deletable: 0, ageBuckets: buckets, estimatedReclaimedBytes: 0,
    };
  }

  const { rows: candidateRows } = await query<{ older: number; guarded: number }>(
    `select count(*)::int as older,
            count(*) filter (where ${protection ? protection.sql : 'false'})::int as guarded
       from ${entry.table} o
      where o.${entry.timestamp} <= now() - interval '${entry.keepDays} days'`);
  const older = candidateRows[0]!.older;
  const guarded = candidateRows[0]!.guarded;
  const deletable = Math.max(0, older - guarded);

  return {
    table: entry.table, rationale: entry.rationale, keepDays: entry.keepDays,
    totalRows, olderThanPolicy: older, protectedRows: guarded,
    protectionReason: protection?.reason ?? null,
    deletable, ageBuckets: buckets,
    estimatedReclaimedBytes: Math.round(deletable * bytesPerRow),
  };
}

export async function planRetention(
  policy: RetentionPolicy = NO_POLICY, error: string | null = null,
): Promise<RetentionPlan> {
  const tables: TablePlan[] = [];
  for (const entry of policy.tables) {
    try { tables.push(await planTable(entry)); } catch { /* a table absent here */ }
  }

  return {
    policyApprovedBy: policy.approvedBy,
    inventoryOnly: policy.tables.every((entry) => entry.keepDays === null),
    tables,
    totalDeletable: tables.reduce((sum, table) => sum + table.deletable, 0),
    totalReclaimedBytes: tables.reduce(
      (sum, table) => sum + table.estimatedReclaimedBytes, 0),
    error,
  };
}

export function renderRetentionPlan(plan: RetentionPlan): string {
  const lines = ['', 'RETENTION PLAN — DRY RUN', ''];

  if (plan.error) {
    lines.push(`  REFUSED: ${plan.error}`, '');
    return lines.join('\n');
  }

  if (plan.inventoryOnly) {
    lines.push('  No retention period is set for any table, so this is an inventory of');
    lines.push('  what exists and how old it is. Nothing would be deleted.');
    lines.push('  Choosing the periods is a business decision — see INPUT-006.');
  } else {
    lines.push(`  Policy approved by ${plan.policyApprovedBy}.`);
  }
  lines.push('');

  for (const table of plan.tables) {
    lines.push(`  ${table.table}  (${table.totalRows} rows)`);
    lines.push(`     ${table.rationale}`);
    lines.push(`     ${table.ageBuckets.map(
      (bucket) => `${bucket.label}: ${bucket.n}`).join('   ')}`);
    if (table.keepDays === null) {
      lines.push('     keep: everything (no period set)');
    } else {
      lines.push(`     keep ${table.keepDays} days -> ${table.olderThanPolicy} older, `
        + `${table.protectedRows} protected, ${table.deletable} would be deleted `
        + `(~${formatBytes(table.estimatedReclaimedBytes)})`);
      if (table.protectedRows > 0 && table.protectionReason) {
        lines.push(`     protected because ${table.protectionReason}`);
      }
    }
    lines.push('');
  }

  lines.push(`  total: ${plan.totalDeletable} row(s), `
    + `~${formatBytes(plan.totalReclaimedBytes)} reclaimable`);
  lines.push('');
  lines.push('  Nothing was deleted. There is no command in this build that deletes');
  lines.push('  any of it: an apply path is written when a policy exists to apply.');
  lines.push('');
  return lines.join('\n');
}
