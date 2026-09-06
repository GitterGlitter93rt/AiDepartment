import { planCanary, renderCanaryPlan, canaryReport, renderCanaryReport } from '../miner/canary.js';
import { registerConfiguredDiscoveryAdapters } from '../miner/registry.js';
import { enqueueMarketResearch } from '../workers/enqueue.js';
import { closePool, query } from '../db/pool.js';

/**
 * A market search an operator can read before it costs anything.
 *
 *   npm run miner:canary -- --vertical roofing --location 32095 --count 10 \
 *                           --max-cost-cents 10
 *
 * Dry by default. There is no flag ordering, no environment variable and no
 * shorthand that turns the command above into a paid run: --live must be given
 * together with --confirm-spend-cents repeating the ceiling, so a dry-run command
 * that somebody copies can never spend money by accident.
 *
 * A live run enqueues an ordinary market_mine job. It does not call an adapter
 * directly, because a canary that bypassed the queue would prove the canary works
 * and tell us nothing about the system that will actually run: provider task
 * persistence, restart recovery, idempotency, ingestion, provenance, research
 * queueing, scoring and cost accounting all live there.
 */

function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  const value = process.argv[at + 1];
  return value && !value.startsWith('--') ? value : '';
}

function has(name: string): boolean { return process.argv.includes(`--${name}`); }

const options = {
  vertical: flag('vertical') || null,
  location: flag('location') || null,
  count: Number(flag('count') ?? '5') || 5,
  maxCostCents: Number(flag('max-cost-cents') ?? '10') || 10,
  causes: (flag('cause') ?? '').split(',').map((cause) => cause.trim()).filter(Boolean),
  miningMode: flag('strategy') || 'advertiser_first',
  live: has('live'),
  confirmSpendCents: flag('confirm-spend-cents') !== null
    ? Number(flag('confirm-spend-cents')) : null,
};

// Registering is not enabling: the adapter reports itself unconfigured without a
// credential and a signed source review, so this changes nothing on a box with
// neither. It is here so the plan can say which provider would be asked.
registerConfiguredDiscoveryAdapters();

if (has('report')) {
  const jobId = flag('report');
  if (!jobId) {
    process.stderr.write('\n--report needs a job id.\n\n');
    await closePool();
    process.exit(2);
  }
  const report = await canaryReport(jobId);
  if (!report) {
    process.stderr.write(`\nNo job ${jobId}.\n\n`);
    await closePool();
    process.exit(2);
  }
  process.stdout.write(renderCanaryReport(report));
  await closePool();
  process.exit(0);
}

const plan = await planCanary(options);
process.stdout.write(renderCanaryPlan(plan));

if (!plan.wouldRun) {
  await closePool();
  // A dry run is a successful description; a refused live run is not.
  process.exit(plan.live ? 1 : 0);
}

// From here it is an ordinary queued job, and nothing else.
const { rows: operatorRows } = await query<{ user_id: string }>(
  `select user_id from users where role in ('ADMIN','RESEARCH_OPS') and is_active
    order by created_at limit 1`);
const requestedBy = operatorRows[0]?.user_id;
if (!requestedBy) {
  process.stderr.write('\nNo active operator account to attribute this run to.\n\n');
  await closePool();
  process.exit(2);
}

const job = await enqueueMarketResearch({
  verticalProfileId: options.vertical,
  geographyType: null,
  geographyValue: options.location,
  marketId: null,
  requestedBy,
  miningMode: options.miningMode,
  queryBudget: plan.searches.length,
});

process.stdout.write(`\n  queued as job ${job.jobId}`
  + `${job.created ? '' : ' (an identical run was already queued)'}\n`
  + `  the worker will run it; read the result with:\n`
  + `    npm run miner:canary -- --report ${job.jobId}\n\n`);
await closePool();
