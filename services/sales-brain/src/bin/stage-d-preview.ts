import { closePool } from '../db/pool.js';
import { previewStageDBatch } from '../research/stageDPreview.js';
import { MAX_QUERIES_PER_ACCOUNT, stageDRunnable } from '../research/stageD.js';

/**
 * What Stage D would ask, and what it would cost.
 *
 *   npm run stage-d:preview                 -- 100 Accounts
 *   npm run stage-d:preview -- --size 25    -- a smaller sample
 *   npm run stage-d:preview -- --show 10    -- how many plans to print in full
 *   npm run stage-d:preview -- --json
 *
 * Nothing here can spend money. There is no executor: `--run` is refused explicitly
 * rather than being an unrecognised flag, because the refusal is the point. A paid
 * batch needs Michael's authorisation after this report has been read, and the report
 * exists so that the authorisation is given against a number rather than a guess.
 */

interface Options { size: number; show: number; json: boolean; run: boolean }

function parseArgs(argv: string[]): Options {
  const options: Options = { size: 100, show: 5, json: false, run: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--size') options.size = Number(argv[i += 1]);
    else if (arg === '--show') options.show = Number(argv[i += 1]);
    else if (arg === '--json') options.json = true;
    else if (arg === '--run' || arg === '--apply' || arg === '--live') options.run = true;
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.run) {
    const gate = stageDRunnable();
    console.error('REFUSED: Stage D does not run.');
    console.error(gate.reason);
    process.exitCode = 2;
    return;
  }

  const preview = await previewStageDBatch(options.size);

  if (options.json) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  console.log('STAGE D PREVIEW — what would be asked, and what it would cost');
  console.log('nothing is bought by this command\n');
  console.log(`accounts examined                 ${preview.accounts.length}`);
  console.log(`already answered, nothing to buy  ${preview.alreadyAnswered}`);
  console.log(`queries planned in total          ${preview.totalQueries}`);
  console.log(`average queries per account       ${preview.averageQueriesPerAccount}`
    + `  (ceiling ${MAX_QUERIES_PER_ACCOUNT})`);
  console.log(`price per search                  $${preview.unitCostUsd.toFixed(4)}`);
  console.log(`  taken from                      ${preview.unitCostBasis}`);
  console.log(`cost of this batch                $${preview.totalCostUsd.toFixed(2)}`);
  console.log(`estimated cost per 100 accounts   $${preview.estimatedCostPer100Usd.toFixed(2)}`);
  console.log(`worst case per 100 accounts       $${preview.worstCasePer100Usd.toFixed(2)}`);
  console.log('');

  const distribution = new Map<number, number>();
  for (const entry of preview.accounts) {
    const n = entry.plan.queries.length;
    distribution.set(n, (distribution.get(n) ?? 0) + 1);
  }
  console.log('QUERIES PER ACCOUNT');
  for (const n of [...distribution.keys()].sort((a, b) => a - b)) {
    console.log(`  ${n}  ${String(distribution.get(n)).padStart(4)} account(s)`);
  }
  console.log('');

  const shown = preview.accounts.filter((entry) => entry.plan.queries.length > 0)
    .slice(0, Math.max(0, options.show));
  for (const entry of shown) {
    console.log(`=== ${entry.companyName}  (${entry.accountId})`);
    console.log(`    ${entry.plan.reason}`);
    for (const planned of entry.plan.queries) {
      console.log(`    [${planned.intent}] ${planned.query}`);
      console.log(`        why   ${planned.rationale}`);
      console.log(`        from  ${planned.builtFrom.join(', ')}`);
    }
    console.log('');
  }

  console.log('A result of any of these searches is candidate evidence. A snippet that');
  console.log('names a role is a sentence on a page, not a fact about who owns a company.');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => closePool());
