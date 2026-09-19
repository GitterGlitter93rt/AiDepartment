import { closePool, query } from '../db/pool.js';
import { enqueueAccountResearch } from '../workers/enqueue.js';

/**
 * Re-research the whole estate under V2 rules.
 *
 *   npm run research:estate -- --dry-run     what would be queued, and nothing is
 *   npm run research:estate                  queue it
 *   npm run research:estate -- --limit 20    a measured first wave
 *
 * Authorised by Michael on 2026-09-17 (brain/releases/V2-OVERNIGHT-RELEASE-20260917.md):
 * first-party website re-research of all historical Accounts, on research paths that
 * incur no new paid spend.
 *
 * It queues `account_research`, which is the ordinary worker path: Stage A only, no
 * provider call, no `task_post`, no Stage D. The trigger recorded is `stale_evidence`,
 * which is both true and the only word in the table's vocabulary that describes it --
 * the evidence is not wrong, it was gathered under rules that have since changed.
 *
 * Every Account, including the ones nothing can research. An Account with no domain
 * produces a run that says so, and "we looked and there was nothing to read" is a
 * different fact from "nobody has looked", which is the distinction the whole estate is
 * being rebuilt around.
 */

interface Options { dryRun: boolean; limit: number | null }

function parseArgs(argv: string[]): Options {
  const options: Options = { dryRun: false, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') options.dryRun = true;
    else if (argv[i] === '--limit') options.limit = Number(argv[i += 1]);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const { rows: accounts } = await query<{
    account_id: string; canonical_name: string; canonical_domain: string | null;
  }>(
    `select account_id, canonical_name, canonical_domain
       from accounts
      where merged_into_account_id is null
      order by canonical_domain nulls last, created_at
      ${options.limit ? `limit ${Math.max(1, Math.floor(options.limit))}` : ''}`);

  const withDomain = accounts.filter((row) => row.canonical_domain).length;
  console.log(`accounts: ${accounts.length}  with a domain to read: ${withDomain}`);

  if (options.dryRun) {
    console.log('dry run: nothing queued');
    return;
  }

  let queued = 0;
  let joined = 0;
  for (const account of accounts) {
    const result = await enqueueAccountResearch(account.account_id, null, 'stale_evidence');
    if (result.created) queued += 1; else joined += 1;
  }
  console.log(`queued ${queued}, joined ${joined} already-queued run(s)`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => closePool());
