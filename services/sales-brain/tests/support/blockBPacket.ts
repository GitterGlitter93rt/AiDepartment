import { config } from '../../src/config.js';
import { runMigrations } from '../../src/db/migrate.js';
import { closePool, query } from '../../src/db/pool.js';
import { syncVerticalProfiles } from '../../src/domain/verticals.js';
import { runConvergence, runPauseInBacklog } from './blockBConverge.js';
import {
  MAX_MARKETS_PER_PASS, MAX_MARKETS_IN_FLIGHT, SWEEP_INTERVAL_MS,
  DEFAULT_REFRESH_INTERVAL_HOURS, sustainableMarketCount,
} from '../../src/workers/marketScheduler.js';

/**
 * The Block B scheduler packet.
 *
 *   npm run blockb
 *   npm run blockb -- --markets 40 --restart-at 3
 *
 * Every provider call is a local stub. Refuses the live database, because it writes
 * saved markets and Accounts.
 */

const LIVE = 'yad_sales';
const target = (() => {
  try { return new URL(config.databaseUrl).pathname.replace(/^\//, ''); }
  catch { return ''; }
})();

if (target === LIVE) {
  process.stderr.write(
    `REFUSED: this writes synthetic markets and Accounts and would put them in the `
    + `live database "${LIVE}".\nPoint DATABASE_URL at a scratch database.\n`);
  process.exit(2);
}

function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : (process.argv[at + 1] ?? '');
}

await runMigrations(() => {});
await syncVerticalProfiles();
await query(`truncate table
  audit_log, ownership_events, activities, follow_ups, suppressions, prospect_statements,
  evidence_records, search_observations, research_runs, canonical_scores,
  research_completeness, opportunity_hypotheses, offer_hypotheses, call_packs,
  contact_endpoints, contacts, account_domains, locations, accounts,
  provider_tasks, provider_usage, jobs, account_market_membership, saved_markets
  restart identity cascade`);

const markets = Number(flag('markets') ?? '100');
const restartFlag = flag('restart-at');
const restartAtPass = restartFlag === null ? 4
  : restartFlag === 'never' ? null : Number(restartFlag);

const pad = (value: string | number, width: number): string =>
  String(value).padStart(width);

process.stdout.write('BLOCK B PACKET — a hundred markets, a restart, and the bill\n');
process.stdout.write(`  database: ${target}\n`);
process.stdout.write(`  batch limit ${MAX_MARKETS_PER_PASS} per pass · `
  + `in-flight ceiling ${MAX_MARKETS_IN_FLIGHT} · `
  + `sweep every ${Math.round(SWEEP_INTERVAL_MS / 60_000)}m\n`);
process.stdout.write(`  sustainable at these settings: ${sustainableMarketCount()} market(s) `
  + `on a ${DEFAULT_REFRESH_INTERVAL_HOURS}h refresh interval\n\n`);

const report = await runConvergence({ markets, restartAtPass });

process.stdout.write(`${'='.repeat(78)}\nCONVERGENCE\n${'='.repeat(78)}\n`);
process.stdout.write('  pass   due  queued  collect  batch  inflt  running  drained  note\n');
for (const record of report.passes) {
  process.stdout.write(
    `  ${pad(record.pass, 4)}  ${pad(record.due, 4)}  ${pad(record.queued, 6)}`
    + `  ${pad(record.collecting, 7)}  ${pad(record.skippedBatch, 5)}`
    + `  ${pad(record.skippedInFlight, 5)}  ${pad(record.skippedRunning, 7)}`
    + `  ${pad(record.drained, 7)}`
    + `${record.note ? `  ${record.note}` : ''}\n`);
}

process.stdout.write(`\n  markets                    ${report.markets}\n`);
process.stdout.write(`  passes to drain            ${report.passes.length}\n`);
process.stdout.write(`  searches bought            ${report.submissions}`
  + `  (one per market is ${report.markets})\n`);
process.stdout.write(`  markets refreshed          ${report.refreshed}\n`);
process.stdout.write(`  still due at the end       ${report.stillDue}\n`);
process.stdout.write(`  peak markets in flight     ${report.peakInFlight}`
  + `  (ceiling ${MAX_MARKETS_IN_FLIGHT})\n`);
process.stdout.write(`  bought more than once      ${report.boughtTwice.length}\n`);
process.stdout.write(`  restart simulated at pass  ${report.restartAtPass ?? 'never'}\n`);
process.stdout.write(`  recovered after restart    ${report.recoveredAfterRestart}`
  + ' job(s) re-leased rather than lost\n');

// What the pass count means in wall-clock, which is the part a bounded scheduler
// hides: the backlog drains, and an operator still has to know how long that takes
// before deciding whether to add another fifty markets.
const wallClockHours = (report.passes.length * SWEEP_INTERVAL_MS) / 3_600_000;
process.stdout.write(`  wall clock to drain        ${wallClockHours.toFixed(1)}h `
  + `at one sweep every ${Math.round(SWEEP_INTERVAL_MS / 60_000)}m\n`);
process.stdout.write(`  headroom                   ${report.markets} of `
  + `${sustainableMarketCount()} sustainable`
  + `${report.markets > sustainableMarketCount()
      ? ' — OVER: the backlog would grow faster than it drains' : ''}\n`);

// Fairness, read off the data rather than asserted: the spread between the first and
// last market to be served is the thing that would hide a starving market.
const served = await query<{ name: string; refreshed: Date | null }>(
  `select name, last_refresh_at as refreshed from saved_markets
    order by last_refresh_at asc nulls last`);
const first = served.rows[0];
const last = served.rows[served.rows.length - 1];
process.stdout.write(`\n  first served               ${first?.name}\n`);
process.stdout.write(`  last served                ${last?.name}\n`);
const neverServed = served.rows.filter((row) => row.refreshed === null);
process.stdout.write(`  never served               ${neverServed.length}\n`);

process.stdout.write(`\n${'='.repeat(78)}\nPAUSED MID-BACKLOG\n${'='.repeat(78)}\n`);
const pause = await runPauseInBacklog();
process.stdout.write(`  searches bought while off  ${pause.submissionsWhilePaused}\n`);
process.stdout.write(`  jobs churned while off     ${pause.churnedJobs}\n`);
process.stdout.write(`  outcome recorded           ${pause.outcome}\n`);
process.stdout.write(`  searches to resume         ${pause.submissionsAfterResume}\n`);

const problems = [...report.problems, ...pause.problems];
process.stdout.write(`\n${'='.repeat(78)}\nPACKET CHECKS\n${'='.repeat(78)}\n`);
if (problems.length === 0) {
  process.stdout.write('  no problems found by the packet\'s own checks\n');
} else {
  for (const problem of problems) process.stdout.write(`  PROBLEM: ${problem}\n`);
}
process.stdout.write('\n  Every provider call here was a local stub. Nothing contacted '
  + 'anybody, spent anything,\n  or touched the live database.\n');

await closePool();
process.exit(problems.length === 0 ? 0 : 1);
