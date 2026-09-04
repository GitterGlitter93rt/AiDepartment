import { evaluateReleaseGates } from '../release/gates.js';
import { runDryRun } from '../release/dryRun.js';
import { pool } from '../db/pool.js';

/**
 * Prints the machine-readable release report.
 *
 * Usage:
 *   npx tsx src/bin/release-report.ts            gates only
 *   npx tsx src/bin/release-report.ts --dry-run  gates plus the end-to-end dry run
 *
 * Neither mode opens a network connection or places a call.
 */

const wantsDryRun = process.argv.includes('--dry-run');

const report = await evaluateReleaseGates({ evaluator: process.env['USER'] ?? 'automated' });
const dryRun = wantsDryRun ? await runDryRun() : null;

console.log(JSON.stringify({ release: report, ...(dryRun ? { dryRun } : {}) }, null, 2));

await pool.end();
// A failing gate is information, not a crash; a FAIL in the dry run is a real problem.
process.exit(dryRun && dryRun.status === 'FAIL' ? 1 : 0);
