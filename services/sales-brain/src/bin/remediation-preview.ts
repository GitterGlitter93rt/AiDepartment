import { closePool } from '../db/pool.js';
import { loadAccountBundles } from '../remediation/load.js';
import {
  CLASS_LABELS, classifyAccount, summarize,
  type AccountVerdict, type RemediationClass,
} from '../remediation/classify.js';

/**
 * What today's rules say about inventory built under yesterday's.
 *
 *   npm run remediation:preview                 -- counts and examples
 *   npm run remediation:preview -- --class B    -- one class in full
 *   npm run remediation:preview -- --json       -- the whole verdict set
 *   npm run remediation:preview -- --examples 5 -- how many to show per class
 *
 * Dry run is the only mode. `--apply` exists so that the refusal is explicit and
 * documented rather than the flag simply being unrecognised: mass remediation rewrites
 * records a rep may already have read, and it needs an authorization this tool does not
 * carry. When it is granted, the apply path belongs behind this same flag, taking its
 * plan from exactly this preview so that what was reviewed is what runs.
 */

interface Options {
  apply: boolean;
  json: boolean;
  limit: number | null;
  examples: number;
  only: RemediationClass | null;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, json: false, limit: null, examples: 3, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '--limit') options.limit = Number(argv[i += 1]);
    else if (arg === '--examples') options.examples = Number(argv[i += 1]);
    else if (arg === '--class') options.only = (argv[i += 1] ?? '').toUpperCase() as RemediationClass;
  }
  return options;
}

function line(verdict: AccountVerdict): string {
  const e = verdict.evidence;
  const finding = verdict.findings[0];
  return [
    `  account_id        ${verdict.accountId}`,
    `  canonical name    ${verdict.canonicalName}`,
    `  domain            ${verdict.canonicalDomain ?? '-'}`,
    `  vertical          ${verdict.verticalProfileId ?? '-'}`,
    `  entity status     ${verdict.entityStatus ?? '-'}`,
    `  entity basis      ${verdict.entityStatusBasis ?? '-'}`,
    `  discovery query   ${e.discoveryQuery ?? '-'}`,
    `  result types      ${e.resultTypes.join(', ') || '-'}   best position ${e.bestPosition ?? '-'}`,
    `  provider category ${e.providerCategories.join(', ') || 'none recorded'}`,
    `  source class      ${e.strongestSourceClass ?? '-'}`,
    `  first-party name  ${e.firstPartyName ?? '-'}`,
    `  physical location ${e.physicalLocations} recorded`,
    `  endpoints         ${e.endpointSummary}`,
    `  research          ${e.researchSummary}`,
    `  activity          ${verdict.activityState}`,
    ...verdict.findings.map((f) =>
      `  [${f.remediationClass}] ${f.code} (${f.confidence}${f.reviewRequired ? ', review required' : ''})\n`
      + `      why      ${f.reason}\n`
      + `      proposed ${f.proposedAction}`),
    finding ? '' : '',
  ].join('\n');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply) {
    console.error('REFUSED: --apply is not implemented and must not be.');
    console.error('Mass remediation rewrites Accounts under rules a person has not agreed to yet.');
    console.error('Run the dry run, have the plan authorized, then the apply path is built against it.');
    process.exitCode = 2;
    return;
  }

  const bundles = await loadAccountBundles(options.limit);
  const verdicts = bundles.map(classifyAccount);
  const summary = summarize(verdicts);

  if (options.json) {
    console.log(JSON.stringify({ summary, verdicts }, null, 2));
    return;
  }

  console.log('SB-V2-1 HISTORICAL INVENTORY REMEDIATION PREVIEW (dry run, nothing written)');
  console.log(`generated ${new Date().toISOString()}`);
  console.log(`accounts examined: ${summary.total}\n`);

  console.log('HUMAN ACTIVITY (decides what may ever be changed without a person)');
  for (const [state, n] of Object.entries(summary.activity)) {
    console.log(`  ${state.padEnd(22)} ${String(n).padStart(4)}`);
  }
  console.log('');

  console.log('PRIMARY CLASS (worst finding per Account, so these sum to the total)');
  for (const cls of Object.keys(CLASS_LABELS) as RemediationClass[]) {
    const n = summary.byPrimaryClass[cls] ?? 0;
    if (n > 0) console.log(`  ${cls}  ${String(n).padStart(4)}  ${CLASS_LABELS[cls]}`);
  }
  console.log('');

  console.log('ACCOUNTS AFFECTED PER CLASS (an Account can appear in several)');
  for (const cls of Object.keys(CLASS_LABELS) as RemediationClass[]) {
    const n = summary.byFindingClass[cls] ?? 0;
    if (n > 0) console.log(`  ${cls}  ${String(n).padStart(4)}  ${CLASS_LABELS[cls]}`);
  }
  console.log('');

  console.log('FINDINGS BY CODE  (accounts / underlying rows)');
  for (const [code, n] of Object.entries(summary.byCode).sort((a, b) => b[1] - a[1])) {
    const rows = summary.rowsByCode[code] ?? n;
    console.log(`  ${String(n).padStart(4)}${rows === n ? '       ' : ` / ${String(rows).padStart(4)}`}  ${code}`);
  }
  console.log('');
  console.log(`accounts needing human review: ${summary.reviewRequired}`);
  console.log(`accounts whose proposed action is mechanical: ${summary.autoProposable}`);
  console.log('');

  const classes = options.only ? [options.only] : (Object.keys(CLASS_LABELS) as RemediationClass[]);
  for (const cls of classes) {
    const matching = verdicts.filter((v) => v.findings.some((f) => f.remediationClass === cls));
    if (matching.length === 0) continue;
    const show = options.only ? matching : matching.slice(0, options.examples);
    console.log(`=== ${cls} — ${CLASS_LABELS[cls]} — ${matching.length} account(s), showing ${show.length} ===`);
    for (const verdict of show) console.log(line(verdict));
    console.log('');
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => closePool());
