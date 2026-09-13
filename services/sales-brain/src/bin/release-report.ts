import { evaluateReleaseGates } from '../release/gates.js';
import { runDryRun } from '../release/dryRun.js';
import { runDryRunMatrix } from '../release/dryRunMatrix.js';
import { pool } from '../db/pool.js';

/**
 * Prints the machine-readable release report.
 *
 * Usage:
 *   npx tsx src/bin/release-report.ts            gates only
 *   npx tsx src/bin/release-report.ts --dry-run  gates plus the end-to-end dry run
 *   npx tsx src/bin/release-report.ts --matrix   gates plus the twenty-class matrix
 *
 * Neither mode opens a network connection or places a call.
 */

const wantsDryRun = process.argv.includes('--dry-run');
const wantsMatrix = process.argv.includes('--matrix');

const report = await evaluateReleaseGates({ evaluator: process.env['USER'] ?? 'automated' });
const dryRun = wantsDryRun ? await runDryRun() : null;
// The matrix seeds twenty accounts, so it is opt-in and belongs on a scratch database.
const matrix = wantsMatrix ? await runDryRunMatrix() : null;

console.log(JSON.stringify({
  release: report,
  ...(dryRun ? { dryRun } : {}),
  ...(matrix ? { matrix: {
    status: matrix.status, counts: matrix.counts, offline: matrix.offline,
    classes: matrix.classes.map((row) => ({
      id: row.id, status: row.status, failed: row.failed,
    })),
  } } : {}),
}, null, 2));

await pool.end();
// A failing gate is information, not a crash; a FAIL in a dry run is a real problem.
process.exit((dryRun && dryRun.status === 'FAIL') || (matrix && matrix.status === 'FAIL')
  ? 1 : 0);
