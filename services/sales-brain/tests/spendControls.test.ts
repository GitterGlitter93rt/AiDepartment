import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { scheduleDueMarkets } from '../src/workers/marketScheduler.js';
import { spendPosition, budgetRefusalReason } from '../src/miner/spend.js';
import { operationalSnapshot } from '../src/api/operations.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * What could accidentally cost Michael money.
 * Authority: Issue #3 Phase R.
 *
 * Every other cost control here bounds one call: a per-run query budget, bounded
 * retries, a bounded poll, one search per market at a time. None of them bounds the
 * day. A miner that searches correctly, cheaply and continuously can still spend a
 * great deal by morning, and the person who finds out is whoever reads the invoice.
 */

let manager: Awaited<ReturnType<typeof makeUser>>;
let calls = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => {
  delete process.env['DISCOVERY_DAILY_BUDGET_USD'];
  await pool.end();
});
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  delete process.env['DISCOVERY_DAILY_BUDGET_USD'];
  calls = 0;
  manager = await makeUser('Spend Manager', 'SALES_MANAGER');
});

function countingAdapter(): void {
  registerDiscoveryAdapter({
    name: 'spend-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      calls += 1;
      return { status: 'ZERO_RESULTS', businesses: [], providerRows: 0,
        rejectedRows: 0, duplicateRows: 0, costUsd: 0.01 };
    },
  });
}

async function spend(amountUsd: number, options: { estimated?: boolean } = {}): Promise<void> {
  await query(
    `insert into provider_usage (provider, operation, units, estimated_cost_usd,
                                 actual_cost_usd, status)
     values ('spend-provider', 'serp.discover', 1, $1, $2, 'OK')`,
    [amountUsd, options.estimated ? null : amountUsd]);
}

async function mine(zip = '32095'): Promise<Record<string, any>> {
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: zip,
    marketId: null, requestedBy: manager.userId });
  await drainQueue(20);
  const { rows } = await query<Record<string, any>>(
    'select outcome, outcome_reason, progress from jobs where job_id = $1', [job.jobId]);
  return rows[0]!;
}

// --------------------------------------------------------------- the ceiling --

test('with no ceiling configured, nothing is refused and the panel says so', async () => {
  countingAdapter();
  const position = await spendPosition();
  assert.equal(position.budgetUsd, 0);
  assert.equal(position.wouldExceed, false);
  assert.equal(position.remainingUsd, null);

  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'spend')!;
  assert.equal(check.state, 'UNKNOWN');
  assert.match(check.detail ?? '', /nothing stops a run of searches from costing whatever/);
});

test('a search that fits under the ceiling still runs', async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '1.00';
  countingAdapter();
  await spend(0.10);

  const job = await mine();
  assert.equal(calls, 1, 'a search well within budget was refused');
  assert.notEqual(job['outcome'], 'DISCOVERY_BLOCKED');
});

test('the day is bounded: a spent budget refuses the call before the money goes', async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.50';
  countingAdapter();
  await spend(0.50);

  const job = await mine();
  assert.equal(calls, 0, 'the provider was called after the budget was spent');
  assert.equal(job['outcome'], 'DISCOVERY_BLOCKED');
  assert.match(String(job['outcome_reason']), /daily provider budget/);
});

test('a budget refusal is a blocked search, never an empty market', async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.10';
  countingAdapter();
  await spend(0.10);

  const job = await mine();
  assert.notEqual(job['outcome'], 'ZERO_RESULTS',
    'our own ceiling was reported as the market having nothing in it');
  assert.match(String(job['outcome_reason']), /nothing has been learned about this market/);
});

test('the worst case has to fit, not the average', async () => {
  // The point of a ceiling is to be right on the expensive day.
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.10';
  process.env['DISCOVERY_ASSUMED_RUN_COST_USD'] = '0.05';
  await spend(0.08);

  const position = await spendPosition({ assumedRunCostUsd: 0.05 });
  assert.equal(position.wouldExceed, true,
    'a run whose worst case crosses the ceiling was allowed because its average did not');
  delete process.env['DISCOVERY_ASSUMED_RUN_COST_USD'];
});

test('actual and estimated are summed together and reported apart', async () => {
  await spend(0.20);
  await spend(0.30, { estimated: true });

  const position = await spendPosition();
  assert.equal(Number(position.spentTodayUsd.toFixed(2)), 0.50);
  assert.equal(Number(position.estimatedPortionUsd.toFixed(2)), 0.30,
    'a day whose cost is mostly estimated is a day nobody can hold the provider to');
});

test('yesterday does not count against today', async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.50';
  await spend(5.00);
  await query(
    `update provider_usage set requested_at = now() - interval '2 days'`);

  const position = await spendPosition();
  assert.equal(position.spentTodayUsd, 0, 'the ceiling never resets');
  assert.equal(position.wouldExceed, false);
});

test('the operations panel escalates as the budget is used up', async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '1.00';

  await spend(0.10);
  let check = (await operationalSnapshot()).checks.find((item) => item.id === 'spend')!;
  assert.equal(check.state, 'OK');

  await spend(0.75);
  check = (await operationalSnapshot()).checks.find((item) => item.id === 'spend')!;
  assert.equal(check.state, 'ATTENTION');

  await spend(0.20);
  check = (await operationalSnapshot()).checks.find((item) => item.id === 'spend')!;
  assert.equal(check.state, 'BLOCKED');
  assert.match(check.detail ?? '', /refused until midnight/);
});

test('the refusal sentence tells an operator what to do about it', () => {
  const reason = budgetRefusalReason({
    spentTodayUsd: 5, estimatedPortionUsd: 0, budgetUsd: 5,
    wouldExceed: true, remainingUsd: 0,
  });
  assert.match(reason, /\$5\.00/);
  assert.match(reason, /resets at midnight/);
  assert.match(reason, /DISCOVERY_DAILY_BUDGET_USD/);
});

// ------------------------------------------------- the race Michael described --

test('two reps and the scheduler wanting the same market buy one search', async () => {
  // Rep A clicks HVAC 32095. Rep B clicks the equivalent normalized search seconds
  // later. The saved-market scheduler wakes up wanting the same market.
  countingAdapter();
  await query(
    `insert into saved_markets (name, vertical_profile_id, geography_type,
                                geography_definition, mining_mode, enabled)
     values ('Contested Market', 'hvac', 'zip_zcta',
             jsonb_build_object('value', '32095'::text), 'advertiser_first', true)`);

  const repA = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: manager.userId });
  const repB = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: ' 32095 ',
    marketId: null, requestedBy: manager.userId });
  const scheduled = await scheduleDueMarkets();

  await drainQueue(20);

  assert.equal(repA.created, true);
  assert.equal(repB.created, false, 'the second rep bought a second search of one market');

  // The saved market carries its own market_id, so its fingerprint differs by design:
  // a market someone configured is a different request from an ad-hoc search. What
  // must not happen is the two reps producing two.
  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'market_mine'`);
  assert.ok(rows[0]!.n <= 1 + scheduled.queued,
    `${rows[0]!.n} searches were queued for one market`);
  assert.ok(calls <= 2, `the provider was called ${calls} times for one market`);
});

test('a double click is one search however fast the second one is', async () => {
  countingAdapter();
  const results = await Promise.all([
    enqueueMarketResearch({ verticalProfileId: 'hvac', geographyType: 'zip_zcta',
      geographyValue: '32095', marketId: null, requestedBy: manager.userId }),
    enqueueMarketResearch({ verticalProfileId: 'hvac', geographyType: 'zip_zcta',
      geographyValue: '32095', marketId: null, requestedBy: manager.userId }),
    enqueueMarketResearch({ verticalProfileId: 'hvac', geographyType: 'zip_zcta',
      geographyValue: '32095', marketId: null, requestedBy: manager.userId }),
  ]);
  await drainQueue(20);

  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(calls, 1, `three clicks called the provider ${calls} times`);
});

test('a refused search does not mark the market as covered', async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.01';
  countingAdapter();
  await spend(0.01);

  const { rows } = await query<{ market_id: string }>(
    `insert into saved_markets (name, vertical_profile_id, geography_type,
                                geography_definition, mining_mode, enabled)
     values ('Refused Market', 'hvac', 'zip_zcta',
             jsonb_build_object('value', '32256'::text), 'advertiser_first', true)
     returning market_id`);

  await scheduleDueMarkets();
  await drainQueue(20);

  const market = await query<{ last_success_at: Date | null; consecutive_failures: number }>(
    'select last_success_at, consecutive_failures from saved_markets where market_id = $1',
    [rows[0]!.market_id]);
  assert.equal(market.rows[0]!.last_success_at, null,
    'a market nobody searched was recorded as successfully searched');
});
