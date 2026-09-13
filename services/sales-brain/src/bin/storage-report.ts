import '../synthetic/scaleSetup.js';
import { pool, query } from '../db/pool.js';

/**
 * What the database costs, per account, measured rather than guessed.
 *
 *   npx tsx src/bin/storage-report.ts [--accounts 100000]
 *
 * Runs against the scale database, so the numbers come from a dataset with realistic
 * fan-out -- several locations, contacts, endpoints and evidence records per company
 * -- rather than from a table of empty rows.
 */

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] ?? fallback : fallback;
}

const { rows: accountRows } = await query<{ n: number }>(
  'select count(*)::int as n from accounts');
const accounts = accountRows[0]!.n;
if (accounts === 0) {
  console.log('The scale database is empty. Run scale-generate first.');
  process.exit(0);
}

const { rows: tables } = await query<{
  table_name: string; row_count: number; heap: number; indexes: number; total: number;
}>(
  `select c.relname as table_name,
          coalesce(s.n_live_tup, 0)::bigint as row_count,
          pg_relation_size(c.oid)::bigint as heap,
          pg_indexes_size(c.oid)::bigint as indexes,
          pg_total_relation_size(c.oid)::bigint as total
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     left join pg_stat_user_tables s on s.relid = c.oid
    where n.nspname = 'public' and c.relkind = 'r'
    order by pg_total_relation_size(c.oid) desc`);

const { rows: dbRows } = await query<{ size: number; name: string }>(
  'select pg_database_size(current_database())::bigint as size, current_database() as name');
const totalBytes = Number(dbRows[0]!.size);

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const perAccount = (bytes: number) => `${Math.round(bytes / accounts)} B`;

console.log(`database ${dbRows[0]!.name}: ${mb(totalBytes)} for ${accounts.toLocaleString()} accounts`);
console.log(`per account: ${(totalBytes / accounts / 1024).toFixed(1)} KB\n`);

console.log('table                        rows        heap    indexes      total   per account');
for (const table of tables.filter((t) => Number(t.total) > 512 * 1024)) {
  console.log([
    table.table_name.padEnd(24),
    String(Number(table.row_count).toLocaleString()).padStart(11),
    mb(Number(table.heap)).padStart(10),
    mb(Number(table.indexes)).padStart(10),
    mb(Number(table.total)).padStart(11),
    perAccount(Number(table.total)).padStart(12),
  ].join(' '));
}

// Projections. Storage is close to linear in accounts because the fan-out per
// account is fixed, so the honest projection is a multiplication with that stated.
console.log('\nprojection, assuming the same shape per account:');
for (const target of [25_000, 100_000, 250_000, 1_000_000]) {
  const projected = (totalBytes / accounts) * target;
  console.log(`  ${target.toLocaleString().padStart(9)} accounts  ->  ${mb(projected).padStart(10)}`
    + `  (${(projected / 1_073_741_824).toFixed(1)} GB)`);
}

// The specific figures the operator asked about.
const { rows: unitRows } = await query<{ evidence: number; activities: number; calls: number }>(
  `select
     (select coalesce(pg_total_relation_size('evidence_records'), 0))::bigint as evidence,
     (select coalesce(pg_total_relation_size('activities'), 0))::bigint as activities,
     (select coalesce(pg_total_relation_size('voice_calls')
        + pg_total_relation_size('voice_call_turns')
        + pg_total_relation_size('voice_call_events'), 0))::bigint as calls`);
const counts = await query<{ evidence: number; activities: number; calls: number; turns: number }>(
  `select (select count(*)::int from evidence_records) as evidence,
          (select count(*)::int from activities) as activities,
          (select count(*)::int from voice_calls) as calls,
          (select count(*)::int from voice_call_turns) as turns`);
const unit = unitRows[0]!;
const count = counts.rows[0]!;

console.log('\nunit costs, measured:');
const per = (bytes: number, rows: number) => rows > 0 ? `${Math.round(Number(bytes) / rows)} B` : 'n/a';
console.log(`  one evidence fact          ${per(unit.evidence, count.evidence)}`
  + `   -> 1,000,000 facts = ${mb((Number(unit.evidence) / Math.max(1, count.evidence)) * 1e6)}`);
console.log(`  one activity               ${per(unit.activities, count.activities)}`
  + `   -> 100,000 activities = ${mb((Number(unit.activities) / Math.max(1, count.activities)) * 1e5)}`);
console.log(`  one reviewed call          ${per(unit.calls, count.calls)}`
  + `   -> 10,000 calls = ${mb((Number(unit.calls) / Math.max(1, count.calls)) * 1e4)}`);
console.log(`  (${count.turns.toLocaleString()} transcript turns across ${count.calls.toLocaleString()} calls; `
  + 'no audio is stored, so a call costs its metadata and its turns and nothing else)');

console.log(`\naccounts requested for the projection: ${argument('accounts', String(accounts))}`);
await pool.end();
