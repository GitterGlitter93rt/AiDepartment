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
import { spendPosition, dailyBudgetUsd, assumedRunCostUsd } from '../src/miner/spend.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Block E: spend safety.
 *
 * The ceiling exists because a miner that searches correctly, cheaply and
 * continuously can still spend a great deal by morning, and the person who finds out
 * should not be whoever reads the invoice. Its own documentation is precise about
 * what it is: "refused before the money is spent, never after -- the check is a
 * precondition of the call, not a report about it."
 *
 * A precondition of *the call*. The handler treated it as a precondition of the run.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => {
  delete process.env['DISCOVERY_DAILY_BUDGET_USD'];
  delete process.env['DISCOVERY_ASSUMED_RUN_COST_USD'];
  await pool.end();
});
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  delete process.env['DISCOVERY_DAILY_BUDGET_USD'];
  delete process.env['DISCOVERY_ASSUMED_RUN_COST_USD'];
});

function chargingAdapter(costPerCall: number, counter: { calls: number }) {
  return {
    name: 'blocke-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      counter.calls += 1;
      return {
        status: 'OK',
        businesses: [{ name: `Block E Co ${++sequence}`, website: null,
          phone: `904-555-${String(2000 + sequence).slice(-4)}` }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, costUsd: costPerCall,
      };
    },
  };
}

async function runOneMarket(queryBudget: number): Promise<string> {
  const operator = await makeUser(`Block E Operator ${++sequence}`, 'SALES_MANAGER');
  const result = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: operator.userId, miningMode: 'advertiser_first',
    queryBudget,
  });
  await drainQueue();
  return result.jobId;
}

async function spentToday(): Promise<number> {
  const { rows } = await query<{ total: string }>(
    `select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd)), 0)::text as total
       from provider_usage where requested_at >= date_trunc('day', now())`);
  return Number(rows[0]!.total);
}

// =============================================================================
// E1 · the ceiling is a precondition of each call, not of the run
// =============================================================================

/**
 * Measured before it was fixed: with a $0.10 daily budget and $0.05 assumed per run,
 * one market refresh submitted eight searches and spent $0.40 -- four times the
 * ceiling -- because the refusal was evaluated once, at a moment when nothing had
 * been spent yet, and then applied to all eight.
 *
 * Eight rather than twenty-five because the hvac profile defines eight search terms.
 * The number an operator would have seen depends on their taxonomy, which is not a
 * comforting thought.
 */
test('E1 one run cannot spend past the daily ceiling', async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.10';
  process.env['DISCOVERY_ASSUMED_RUN_COST_USD'] = '0.05';
  const counter = { calls: 0 };
  registerDiscoveryAdapter(chargingAdapter(0.05, counter));

  await runOneMarket(25);

  const spent = await spentToday();
  assert.ok(spent <= 0.10 + 1e-9,
    `one run spent $${spent.toFixed(4)} against a $0.10 ceiling in ${counter.calls} `
    + 'call(s): the ceiling is being asked once per run rather than once per call');
  // Two calls at $0.05 is exactly the ceiling; the third would cross it and is refused.
  assert.equal(counter.calls, 2,
    `${counter.calls} searches were bought where two fit under the ceiling`);
});

test('E1 a run that cannot afford its first search buys nothing', async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.10';
  process.env['DISCOVERY_ASSUMED_RUN_COST_USD'] = '0.05';
  // Today is already spent.
  await query(
    `insert into provider_usage (provider, operation, requested_at, completed_at,
                                 units, estimated_cost_usd, actual_cost_usd, status)
     values ('blocke-provider', 'serp.discover', now(), now(), 1, 0.10, 0.10, 'OK')`);
  const counter = { calls: 0 };
  registerDiscoveryAdapter(chargingAdapter(0.05, counter));

  const jobId = await runOneMarket(4);

  assert.equal(counter.calls, 0, 'a run bought a search it could not afford');
  const { rows } = await query<Record<string, any>>(
    `select outcome, outcome_reason, progress from jobs where job_id = $1`, [jobId]);
  assert.equal(rows[0]!.outcome, 'DISCOVERY_BLOCKED');
  assert.match(rows[0]!.outcome_reason, /daily provider budget/i);
  // And it says nothing was learned, rather than reporting an empty market.
  assert.match(rows[0]!.outcome_reason, /nothing has been learned/i);
});

test('E1 the run reports what it spent, not what had been spent before it started',
  async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '1.00';
  const counter = { calls: 0 };
  registerDiscoveryAdapter(chargingAdapter(0.02, counter));

  const jobId = await runOneMarket(3);

  const { rows } = await query<{ progress: Record<string, unknown> }>(
    `select progress from jobs where job_id = $1`, [jobId]);
  const progress = rows[0]!.progress;
  assert.equal(progress['spentTodayUsdBeforeRun'], 0);
  assert.ok(Number(progress['spentTodayUsd']) > 0,
    'the run reported today as costing nothing after making charged calls');
  assert.equal(Number(progress['spentTodayUsd']),
    Number((counter.calls * 0.02).toFixed(4)));
  // Not refused, so it must not claim to have been.
  assert.equal(progress['budgetExhausted'], false);
  assert.equal(progress['budgetRefusals'], 0);
});

test('E1 budgetExhausted means this run was refused, not that it might have been',
  async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.10';
  process.env['DISCOVERY_ASSUMED_RUN_COST_USD'] = '0.05';
  const counter = { calls: 0 };
  registerDiscoveryAdapter(chargingAdapter(0.05, counter));

  const jobId = await runOneMarket(25);

  const { rows } = await query<{ progress: Record<string, unknown> }>(
    `select progress from jobs where job_id = $1`, [jobId]);
  const progress = rows[0]!.progress;
  assert.equal(progress['budgetExhausted'], true,
    'a run that had submissions refused for cost does not say so');
  assert.ok(Number(progress['budgetRefusals']) > 0);
  // The searches that did happen are still reported as having happened.
  assert.equal(progress['searchesPlanned'], 8);
});

// =============================================================================
// E2 · the ceiling itself
// =============================================================================

test('E2 an unset ceiling is no ceiling, and says so rather than blocking', async () => {
  // The documented behaviour, pinned because the alternative -- treating unset as
  // zero -- would silently stop all discovery on a fresh install.
  const position = await spendPosition();
  assert.equal(position.budgetUsd, 0);
  assert.equal(position.wouldExceed, false);
  assert.equal(position.remainingUsd, null);
});

test('E2 the ceiling uses the assumed worst case, not the average', async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '1.00';
  process.env['DISCOVERY_ASSUMED_RUN_COST_USD'] = '0.30';
  await query(
    `insert into provider_usage (provider, operation, requested_at, completed_at,
                                 units, estimated_cost_usd, actual_cost_usd, status)
     values ('blocke-provider', 'serp.discover', now(), now(), 1, 0.80, 0.80, 'OK')`);
  const position = await spendPosition();
  // $0.80 spent, $0.30 assumed, $1.00 ceiling: the next call would cross it.
  assert.equal(position.wouldExceed, true,
    'a call whose worst case crosses the ceiling was judged to fit');
  // Compared with a tolerance because these are floats: 1.00 - 0.80 is
  // 0.19999999999999996 here. Immaterial against a ceiling that already reserves a
  // whole assumed run cost and renders to two decimal places, but worth stating
  // rather than hiding behind a rounded assertion.
  assert.ok(Math.abs((position.remainingUsd ?? 0) - 0.2) < 1e-9,
    `remaining was ${position.remainingUsd}`);
  assert.equal(dailyBudgetUsd(), 1);
  assert.equal(assumedRunCostUsd(), 0.3);
});

test('E2 a ceiling nobody can parse refuses rather than reading as unset', async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '$20';
  assert.throws(() => dailyBudgetUsd(),
    'a currency symbol made the ceiling read as unset, which is unlimited');
});

test('E2 yesterday’s spend does not count against today', async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.10';
  await query(
    `insert into provider_usage (provider, operation, requested_at, completed_at,
                                 units, estimated_cost_usd, actual_cost_usd, status)
     values ('blocke-provider', 'serp.discover', now() - interval '1 day',
             now() - interval '1 day', 1, 5.00, 5.00, 'OK')`);
  const position = await spendPosition();
  assert.equal(position.spentTodayUsd, 0,
    'a ceiling that never resets is a ceiling that stops the product');
  assert.equal(position.wouldExceed, false);
});

test('E2 a cost the provider never confirmed still counts against the ceiling',
  async () => {
  // Estimated and actual are summed together and reported apart. A ceiling that only
  // counted confirmed costs would be raised by a provider that forgot to bill.
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.10';
  process.env['DISCOVERY_ASSUMED_RUN_COST_USD'] = '0.05';
  await query(
    `insert into provider_usage (provider, operation, requested_at, completed_at,
                                 units, estimated_cost_usd, actual_cost_usd, status)
     values ('blocke-provider', 'serp.discover', now(), now(), 1, 0.09, null, 'OK')`);
  const position = await spendPosition();
  assert.equal(position.spentTodayUsd, 0.09);
  assert.equal(position.estimatedPortionUsd, 0.09,
    'an unconfirmed cost is not reported as confirmed');
  assert.equal(position.wouldExceed, true);
});

test('E2 a provider that forgets to record its own spending is recorded anyway',
  async () => {
  // The ceiling reads provider_usage, and only adapters write to it. An adapter that
  // does not is the failure mode of the next one somebody writes, so the orchestrator
  // records the call it knows it made.
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '5.00';
  const counter = { calls: 0 };
  registerDiscoveryAdapter({
    name: 'blocke-silent', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      counter.calls += 1;
      // No costUsd, and no provider_usage row of its own.
      return { status: 'ZERO_RESULTS', businesses: [], providerRows: 0,
        rejectedRows: 0, duplicateRows: 0 };
    },
  });

  await runOneMarket(1);

  assert.equal(counter.calls, 1);
  const { rows } = await query<Record<string, any>>(
    `select provider, status, error_code, estimated_cost_usd, actual_cost_usd
       from provider_usage`);
  assert.equal(rows.length, 1,
    'a provider call that recorded nothing left no trace, so it was free to the ceiling');
  assert.equal(rows[0]!.provider, 'blocke-silent');
  // Assumed worst case, because a ceiling that counts an unknown call as free is not
  // a ceiling. And the estimate is marked as an estimate.
  assert.equal(Number(rows[0]!.estimated_cost_usd), assumedRunCostUsd());
  assert.equal(rows[0]!.actual_cost_usd, null);
});
