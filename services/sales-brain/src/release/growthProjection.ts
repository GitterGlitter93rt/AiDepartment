import { query } from '../db/pool.js';

/**
 * How big this database gets if nobody intervenes.
 *
 * The EdgeXpert has a finite disk and the miner is meant to run continuously. Most
 * tables here are bounded by how many companies exist in the markets we watch, which
 * is a number that stops growing. A few are bounded by how long the system has been
 * running, which is not -- one row per job, per provider call, per sighting, for
 * ever -- and those are the ones that decide when somebody gets woken up.
 *
 * Measured from what the database actually holds rather than modelled: rows and
 * bytes per table, and for the tables that grow with time, the rate they have grown
 * at since the oldest row in them.
 */

export interface TableGrowth {
  table: string;
  rows: number;
  bytes: number;
  bytesPerRow: number;
  /**
   * Null when there is nothing to measure a rate from: no timestamp column, too few
   * rows, or too short a history. A rate extrapolated from a table that is one hour
   * old and holds three rows is arithmetic, not a projection.
   */
  rowsPerDay: number | null;
  /** Why there is no rate, when there is none. */
  rateUnavailable: string | null;
  /** True when nothing in the product ever deletes from this table. */
  unpruned: boolean;
  note: string;
}

export interface GrowthProjection {
  totalBytes: number;
  tables: TableGrowth[];
  /** Bytes per day across every table with a rate worth reporting. */
  bytesPerDay: number;
  /**
   * Null unless there is a disk figure AND a rate measured from enough data to
   * mean something. A date derived from an empty database is worse than no date:
   * somebody plans around it.
   */
  daysUntilFull: number | null;
  /** True when this database is too new or too small to project from at all. */
  tooEarlyToProject: boolean;
  summary: string;
}

/**
 * Below this, a table's size is mostly empty pages and index overhead rather than
 * data, so bytes-per-row says nothing about what a million rows would cost.
 */
const MIN_ROWS_FOR_SIZE = 1_000;

/** Below this, "since the oldest row" is noise rather than a history. */
const MIN_DAYS_FOR_RATE = 1;

/**
 * Tables that grow with running time rather than with the size of the market, and
 * the column that dates a row.
 *
 * Deliberately a list rather than a guess from the schema: whether a table is
 * bounded by the world or by the clock is a fact about what it means, and a new one
 * should be added here on purpose.
 */
const TIME_SERIES: { table: string; timestamp: string; note: string }[] = [
  { table: 'jobs', timestamp: 'created_at',
    note: 'One row per mining run, research run and refresh, kept after completion.' },
  { table: 'search_observations', timestamp: 'observed_at',
    note: 'One row per business per search. The fastest-growing table in the system, '
      + 'and every row carries a retention_class that nothing reads.' },
  { table: 'provider_usage', timestamp: 'requested_at',
    note: 'One row per provider call, including refusals and failures.' },
  { table: 'activities', timestamp: 'occurred_at',
    note: 'The account timeline. Business history rather than machine exhaust.' },
  { table: 'canonical_scores', timestamp: 'scored_at',
    note: 'Append-only by design: a score is never overwritten, so a recompute adds '
      + 'a row to every scored Account.' },
  { table: 'audit_log', timestamp: 'occurred_at',
    note: 'Deliberately never expired.' },
  { table: 'provider_tasks', timestamp: 'submitted_at',
    note: 'One row per submitted provider search.' },
  { table: 'research_runs', timestamp: 'started_at',
    note: 'One row per research attempt per Account.' },
];

/** Tables something in the product actually deletes from. */
const PRUNED = new Set(['sessions', 'login_attempts', 'import_rows', 'import_sessions']);

export async function growthProjection(options: {
  diskBytesAvailable?: number | null;
} = {}): Promise<GrowthProjection> {
  const { rows: sizes } = await query<{
    table_name: string; rows: number; bytes: number;
  }>(
    `select c.relname as table_name,
            coalesce(s.n_live_tup, 0)::bigint as rows,
            pg_total_relation_size(c.oid)::bigint as bytes
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public' and c.relkind = 'r'
      order by pg_total_relation_size(c.oid) desc`);

  const tables: TableGrowth[] = [];
  let bytesPerDay = 0;

  for (const size of sizes) {
    const rows = Number(size.rows);
    const bytes = Number(size.bytes);
    const series = TIME_SERIES.find((entry) => entry.table === size.table_name);

    let rowsPerDay: number | null = null;
    let rateUnavailable: string | null = null;

    if (!series) {
      rateUnavailable = null;
    } else if (rows < MIN_ROWS_FOR_SIZE) {
      rateUnavailable = `only ${rows} row(s): too few for the size per row to mean `
        + 'anything, since most of this table is empty pages and index overhead';
    } else {
      const { rows: spanRows } = await query<{ days: number | null }>(
        `select extract(epoch from (now() - min(${size.table_name}.${series.timestamp})))
                  / 86400 as days
           from ${size.table_name}`);
      const days = Number(spanRows[0]?.days ?? 0);
      if (days < MIN_DAYS_FOR_RATE) {
        rateUnavailable = `only ${(days * 24).toFixed(1)} hour(s) of history: not long `
          + 'enough to call a rate';
      } else {
        rowsPerDay = rows / days;
      }
    }

    const bytesPerRow = rows > 0 ? bytes / rows : 0;
    if (rowsPerDay !== null) bytesPerDay += rowsPerDay * bytesPerRow;

    tables.push({
      table: size.table_name,
      rows,
      bytes,
      bytesPerRow,
      rowsPerDay,
      rateUnavailable,
      unpruned: series !== undefined && !PRUNED.has(size.table_name),
      note: series?.note ?? (PRUNED.has(size.table_name)
        ? 'Pruned by housekeeping.'
        : 'Bounded by how many companies are in the markets we watch.'),
    });
  }

  const totalBytes = tables.reduce((sum, table) => sum + table.bytes, 0);
  const disk = options.diskBytesAvailable ?? null;
  const tooEarlyToProject = bytesPerDay === 0;
  const daysUntilFull = disk !== null && !tooEarlyToProject
    ? Math.floor((disk - totalBytes) / bytesPerDay) : null;

  const growing = tables.filter((table) => (table.rowsPerDay ?? 0) > 0)
    .sort((a, b) => (b.rowsPerDay ?? 0) * b.bytesPerRow - (a.rowsPerDay ?? 0) * a.bytesPerRow);

  const waiting = tables.filter((table) => table.rateUnavailable !== null);

  return {
    totalBytes,
    tables,
    bytesPerDay,
    daysUntilFull,
    tooEarlyToProject,
    summary: tooEarlyToProject
      ? 'No table here has enough rows or enough history to project from, so this '
        + 'report deliberately gives no date. '
        + (waiting.length > 0
          ? `${waiting.length} table(s) are waiting on data: `
            + `${waiting.slice(0, 3).map((table) => table.table).join(', ')}. `
          : '')
        + 'Run the miner against real markets for a few days and ask again.'
      : `Growing at about ${formatBytes(bytesPerDay)} a day, led by `
        + `${growing.slice(0, 3).map((table) => table.table).join(', ')}.`
        + (daysUntilFull !== null
          ? ` At that rate the space given fills in about ${daysUntilFull} day(s).`
          : ' No disk figure was given, so there is no date attached to that.'),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} kB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** The projection as text, biggest grower first. */
export function renderGrowth(projection: GrowthProjection): string {
  const lines = ['', 'DATABASE GROWTH', '',
    `total ${formatBytes(projection.totalBytes)}`, ''];

  const growing = projection.tables
    .filter((table) => table.rowsPerDay !== null)
    .sort((a, b) => (b.rowsPerDay ?? 0) * b.bytesPerRow - (a.rowsPerDay ?? 0) * a.bytesPerRow);

  const waiting = projection.tables.filter((table) => table.rateUnavailable !== null);

  lines.push('grows with time:');
  for (const table of growing) {
    const perDay = (table.rowsPerDay ?? 0) * table.bytesPerRow;
    lines.push(`  ${table.table.padEnd(24)} ${String(table.rows).padStart(9)} rows  `
      + `${formatBytes(table.bytes).padStart(9)}  ${formatBytes(perDay).padStart(9)}/day`
      + `${table.unpruned ? '  UNPRUNED' : ''}`);
    lines.push(`      ${table.note}`);
  }

  if (growing.length === 0) lines.push('  (nothing measurable yet)');

  if (waiting.length > 0) {
    lines.push('', 'not enough data to give a rate:');
    for (const table of waiting) {
      lines.push(`  ${table.table.padEnd(24)} ${table.rateUnavailable}`);
    }
  }

  lines.push('', projection.summary, '');
  return lines.join('\n');
}
