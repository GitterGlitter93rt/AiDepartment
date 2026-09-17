import { closePool } from '../db/pool.js';
import { applyForAccount, planRemediation, type PlannedChange } from '../remediation/apply.js';

/**
 * Apply the remediation the preview has been describing.
 *
 *   npm run remediation:apply -- --dry-run          what would change, and nothing does
 *   npm run remediation:apply -- --apply            change it
 *   npm run remediation:apply -- --apply --limit 25 a bounded first batch
 *
 * Authorised by Michael on 2026-09-17; the grant and its limits are in
 * brain/releases/V2-OVERNIGHT-RELEASE-20260917.md. `--apply` is required and there is no
 * default: a flag that defaults to safe is one somebody forgets is there, and a flag that
 * defaults to acting is worse.
 *
 * Each Account is its own transaction. A failure on the three hundredth does not roll
 * back the two hundred and ninety-nine that were right, and the audit log fills as it
 * goes rather than appearing at the end.
 */

interface Options { apply: boolean; dryRun: boolean; limit: number | null; json: boolean }

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, dryRun: false, limit: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') options.apply = true;
    else if (argv[i] === '--dry-run') options.dryRun = true;
    else if (argv[i] === '--json') options.json = true;
    else if (argv[i] === '--limit') options.limit = Number(argv[i += 1]);
  }
  return options;
}

function byAccount(changes: PlannedChange[]): Map<string, PlannedChange[]> {
  const grouped = new Map<string, PlannedChange[]>();
  for (const change of changes) {
    const bucket = grouped.get(change.accountId);
    if (bucket) bucket.push(change); else grouped.set(change.accountId, [change]);
  }
  return grouped;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.apply && !options.dryRun) {
    console.error('Say which: --dry-run to see the plan, --apply to run it.');
    process.exitCode = 2;
    return;
  }

  const plan = await planRemediation();
  const grouped = byAccount(plan.changes);

  const counts = new Map<string, number>();
  for (const change of plan.changes) {
    counts.set(change.action, (counts.get(change.action) ?? 0) + 1);
  }

  console.log('V2 HISTORICAL REMEDIATION');
  console.log(`accounts examined                 ${plan.accountsExamined}`);
  console.log(`accounts with a change planned    ${grouped.size}`);
  console.log(`changes planned                   ${plan.changes.length}`);
  for (const [action, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${action.padEnd(30)} ${String(n).padStart(4)}`);
  }
  console.log(`accounts protected by human work  ${plan.protectedByHumanActivity.length}`);
  console.log(`findings sent to review           ${plan.review.length}`);
  console.log('');

  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  if (!options.apply) {
    for (const [accountId, changes] of [...grouped].slice(0, 15)) {
      console.log(`=== ${changes[0]!.companyName}  (${accountId})`);
      for (const change of changes) {
        console.log(`    ${change.action}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`);
        console.log(`      ${change.reason}`);
      }
    }
    console.log('\ndry run: nothing was changed');
    return;
  }

  let accountsChanged = 0;
  let applied = 0;
  let skipped = 0;
  const batches = [...grouped].slice(0, options.limit ?? grouped.size);
  for (const [accountId, changes] of batches) {
    const result = await applyForAccount(accountId, changes);
    if (result.applied.length > 0) accountsChanged += 1;
    applied += result.applied.length;
    skipped += result.skipped.length;
    for (const entry of result.skipped) {
      console.log(`skipped ${entry.change.action} on ${accountId}: ${entry.why}`);
    }
  }

  console.log(`accounts changed                  ${accountsChanged}`);
  console.log(`changes applied                   ${applied}`);
  console.log(`changes skipped                   ${skipped}`);
  console.log('every change is in audit_log with what it was before.');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => closePool());
