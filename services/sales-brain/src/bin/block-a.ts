import { config } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { closePool, query } from '../db/pool.js';
import { syncVerticalProfiles } from '../domain/verticals.js';
import { BLOCK_A_VERTICALS, BLOCK_A_CASES, walkCase, type BlockACase } from '../blockA/walk.js';
import { renderWalk } from '../blockA/render.js';

/**
 * The Block A acceptance artifact.
 *
 *   npm run blocka                       every vertical, every case
 *   npm run blocka -- --case A_STRONG_ADVERTISER
 *
 * Synthetic throughout: `.invalid` domains, 555 numbers, obviously-fixture names.
 * Refuses the live database, because it writes Accounts and a fixture company in
 * working inventory is worse than no artifact.
 */

const LIVE = 'yad_sales';
const target = (() => {
  try { return new URL(config.databaseUrl).pathname.replace(/^\//, ''); }
  catch { return ''; }
})();

if (target === LIVE) {
  process.stderr.write(
    `REFUSED: this writes synthetic Accounts and would put them in the live database `
    + `"${LIVE}".\nPoint DATABASE_URL at a scratch database.\n`);
  process.exit(2);
}

function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : (process.argv[at + 1] ?? '');
}

await runMigrations(() => {});
await syncVerticalProfiles();

// Start from a known state so the artifact is the same shape twice.
await query(`truncate table
  audit_log, ownership_events, activities, follow_ups, suppressions, prospect_statements,
  evidence_records, search_observations, research_runs, canonical_scores,
  research_completeness, opportunity_hypotheses, offer_hypotheses, call_packs,
  contact_endpoints, contacts, account_domains, locations, accounts
  restart identity cascade`);

const only = flag('case') as BlockACase | null;
const cases = only ? [only] : BLOCK_A_CASES;

process.stdout.write(`BLOCK A ACCEPTANCE — discovery → call pack\n`);
process.stdout.write(`  database: ${target}\n`);
process.stdout.write(`  ${BLOCK_A_VERTICALS.length} verticals × ${cases.length} cases\n\n`);

const problems: string[] = [];

for (const vertical of BLOCK_A_VERTICALS) {
  process.stdout.write(`\n${'='.repeat(78)}\n${vertical.toUpperCase()}\n${'='.repeat(78)}\n`);
  for (const caseId of cases) {
    const walk = await walkCase(vertical, caseId);
    process.stdout.write(`${renderWalk(walk)}\n\n`);

    // The checks worth failing the artifact over, gathered rather than thrown so the
    // whole matrix is visible in one read.
    if (walk.lineage) {
      const sum = walk.lineage.components
        .filter((c) => c.pointsAwarded > 0)
        .reduce((total, c) => total + c.pointsAwarded, 0);
      if (sum !== walk.lineage.totalPoints) {
        problems.push(`${vertical}/${caseId}: explanation sums to ${sum}, stored `
          + `${walk.lineage.totalPoints}`);
      }
    }
    if (caseId === 'B_NEVER_RESEARCHED' && walk.readiness?.state === 'NOT_WORKABLE') {
      problems.push(`${vertical}/${caseId}: a company nobody has researched reads as `
        + 'NOT_WORKABLE rather than RESEARCH_NEEDED');
    }
    if (caseId === 'F_SUPPRESSED' && walk.readiness?.state === 'REP_READY') {
      problems.push(`${vertical}/${caseId}: a suppressed Account is rep-ready`);
    }
    if (caseId === 'H_WEAK_MERGE' && !walk.siblingAccountId) {
      problems.push(`${vertical}/${caseId}: the sibling Account was absorbed`);
    }
  }
}

process.stdout.write(`\n${'='.repeat(78)}\nARTIFACT CHECKS\n${'='.repeat(78)}\n`);
if (problems.length === 0) {
  process.stdout.write('  no problems found by the artifact\'s own checks\n');
} else {
  for (const problem of problems) process.stdout.write(`  PROBLEM: ${problem}\n`);
}
process.stdout.write('\n  Nothing here contacted anybody, spent anything, or touched the '
  + 'live database.\n');

await closePool();
process.exit(problems.length === 0 ? 0 : 1);
