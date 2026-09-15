import { pool, query } from '../db/pool.js';
import { availableDiscoveryAdapters } from '../workers/marketMiner.js';
import { PROVIDER_TASK_RETENTION_DAYS, isBeyondRetention } from '../miner/providerTasks.js';
import '../workers/marketMiner.js';

/**
 * What the provider still owes us, and what can still be done about it.
 *
 * Read-only, always. This command never writes to the database, never collects and
 * never buys; the only thing it can be asked to do beyond reading local rows is ask
 * the provider which tasks are ready, which is a free GET.
 *
 * There is deliberately no `--recover-all`. The backlog is money already spent, and a
 * single flag that acts on all of it is exactly the shape of command that turns one
 * mistaken assumption into a bulk mutation. Recovery is the sweeper's job, task by
 * task, on evidence; anything an operator drives by hand should name the task it
 * means.
 *
 * Usage:
 *   npm run audit:backlog                 local ledger only
 *   npm run audit:backlog -- --check-provider   also ask which tasks are ready (free)
 */

type Classification =
  /** Paid, still recoverable, and produced under the current resolver. */
  | 'CURRENT_SAFE'
  /** Predates the P0 entity-resolution remediation. Quarantined on purpose. */
  | 'LEGACY_PRE_P0'
  /** Delivered and in inventory. Nothing is owed. */
  | 'ALREADY_COLLECTED'
  /** The provider listed it as ready but we hold no ledger row for it. */
  | 'MISSING_LOCAL_RECORD'
  /** Cannot be recovered: a terminal provider failure, or past result retention. */
  | 'TERMINAL_FAILURE';

interface Row {
  provider_task_id: string;
  provider: string;
  provider_native_id: string;
  fingerprint: string;
  status: string;
  poll_attempts: number;
  submitted_at: Date;
  last_polled_at: Date | null;
  collected_at: Date | null;
  cost_usd: string | null;
  error_code: string | null;
  request: Record<string, unknown> | null;
}

function keywordOf(row: Row): string {
  const search = (row.request ?? {})['search'] as Record<string, unknown> | undefined;
  const keyword = search?.['keyword'];
  // The fingerprint's last segment is the term, which is the honest fallback when the
  // stored request predates the shape that carries the keyword.
  return typeof keyword === 'string' && keyword
    ? keyword
    : row.fingerprint.split(':').pop() || '(unknown)';
}

function classify(row: Row, now: Date): { classification: Classification; action: string } {
  if (row.status === 'COLLECTED') {
    return { classification: 'ALREADY_COLLECTED',
      action: 'Nothing. The results are in inventory; buying this market again would pay twice.' };
  }
  if (row.status === 'FAILED') {
    return { classification: 'TERMINAL_FAILURE',
      action: `Nothing automatic. The provider failed this task (${row.error_code ?? 'no code'}).` };
  }
  if (row.status === 'ABANDONED') {
    // A deliberate quarantine is not a failure, and must not be re-opened by anybody
    // reading this table as a worklist.
    if (row.error_code === 'SUPERSEDED_BY_P0_MINER_REMEDIATION') {
      return { classification: 'LEGACY_PRE_P0',
        action: 'Leave closed. Quarantined deliberately; its results predate the current '
          + 'entity resolution and must not be ingested into production.' };
    }
    return { classification: 'TERMINAL_FAILURE',
      action: `Nothing. Given up on (${row.error_code ?? 'no code'}).` };
  }
  if (isBeyondRetention(row.submitted_at, now)) {
    return { classification: 'TERMINAL_FAILURE',
      action: `Nothing. Past the ${PROVIDER_TASK_RETENTION_DAYS}-day result retention, so it `
        + 'can no longer be fetched. Re-searching is a new, separately approved purchase.' };
  }
  return { classification: 'CURRENT_SAFE',
    action: 'None needed. The sweeper will collect it; no replacement search is required.' };
}

function ageOf(from: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - from.getTime()) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}

async function main(): Promise<void> {
  const checkProvider = process.argv.includes('--check-provider');
  const now = new Date();

  const { rows } = await query<Row>(
    `select provider_task_id, provider, provider_native_id, fingerprint, status,
            poll_attempts, submitted_at, last_polled_at, collected_at, cost_usd,
            error_code, request
       from provider_tasks
      order by submitted_at desc`);

  // Free, and only when asked: an operator running this to read the ledger should not
  // silently generate provider traffic.
  let readyIds: string[] | null = null;
  if (checkProvider) {
    for (const adapter of availableDiscoveryAdapters()) {
      if (!adapter.tasksReady) continue;
      const ready = await adapter.tasksReady();
      if (ready) readyIds = [...(readyIds ?? []), ...ready];
    }
  }

  console.log(`Provider task backlog — ${rows.length} row(s), read-only\n`);
  const counts = new Map<Classification, number>();
  let owedCost = 0;

  for (const row of rows) {
    const { classification, action } = classify(row, now);
    counts.set(classification, (counts.get(classification) ?? 0) + 1);
    if (row.status === 'PENDING' && row.cost_usd) owedCost += Number(row.cost_usd);

    const ready = readyIds === null ? 'not checked'
      : readyIds.includes(row.provider_native_id) ? 'READY at provider'
      : row.status === 'PENDING' ? 'not in ready list (may still be queued, or already fetched)'
      : 'n/a';

    console.log(`${row.provider_native_id}  [${classification}]`);
    console.log(`  local id     ${row.provider_task_id}`);
    console.log(`  provider     ${row.provider}`);
    console.log(`  keyword      ${keywordOf(row)}`);
    console.log(`  fingerprint  ${row.fingerprint}`);
    console.log(`  status       ${row.status}${row.error_code ? ` (${row.error_code})` : ''}`);
    console.log(`  submitted    ${row.submitted_at.toISOString()}  (age ${ageOf(row.submitted_at, now)})`);
    console.log(`  last polled  ${row.last_polled_at ? row.last_polled_at.toISOString() : 'never'}`
      + `   attempts ${row.poll_attempts}`);
    console.log(`  collected    ${row.collected_at ? row.collected_at.toISOString() : '-'}`);
    console.log(`  cost         ${row.cost_usd ? `$${row.cost_usd}` : 'not recorded'}`);
    console.log(`  retrievable  ${ready}`);
    console.log(`  action       ${action}`);
    console.log('');
  }

  // A ready task with no local row is the one case this table cannot show on its own.
  // Reported, never repaired: fabricating a ledger row for a task we cannot attribute
  // to a search would invent provenance for results we would then ingest.
  if (readyIds) {
    const known = new Set(rows.map((row) => row.provider_native_id));
    for (const id of readyIds) {
      if (known.has(id)) continue;
      counts.set('MISSING_LOCAL_RECORD', (counts.get('MISSING_LOCAL_RECORD') ?? 0) + 1);
      console.log(`${id}  [MISSING_LOCAL_RECORD]`);
      console.log('  action       Report only. The provider holds a finished task we have no '
        + 'record of. Do not fabricate a ledger row: investigate which run bought it first.\n');
    }
  }

  console.log('Summary');
  for (const [classification, count] of [...counts.entries()].sort()) {
    console.log(`  ${classification.padEnd(22)} ${count}`);
  }
  if (owedCost > 0) {
    console.log(`\n  $${owedCost.toFixed(4)} of paid work is still outstanding and recoverable.`);
  }
  console.log('\nThis command made no writes. Collection is the sweeper\'s job, task by task.');
}

main()
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
