import './setup.js';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import {
  createDataForSeoAdapter, normalizeResponse, normalizeResultType, isPaidPlacement,
  type DataForSeoConfig, type ProviderResponse, type Transport,
} from '../src/miner/dataForSeoAdapter.js';
import { availableDiscoveryAdapters, registerDiscoveryAdapter } from '../src/workers/marketMiner.js';

/**
 * DataForSEO discovery adapter, against fixtures rather than the provider.
 * Authority: market-miner-serp-provider-selection-current.md,
 * market-miner-google-serp-normalization-spec.md §2-§4.
 */

after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

const READY: DataForSeoConfig = {
  login: 'login', password: 'password', baseUrl: 'https://provider.test/v3',
  mode: 'standard', governanceReviewed: true, enabled: true, maxQueriesPerRun: 25,
};

/** A response shaped like the provider's, with one paid and one organic result. */
const RESPONSE: ProviderResponse = {
  status_code: 20000, cost: 0.0031,
  tasks: [{
    id: 'task-1', status_code: 20000, cost: 0.0031,
    result: [{
      keyword: 'emergency ac repair jacksonville',
      location_name: 'Jacksonville,Florida,United States',
      check_url: 'https://provider.test/check/1',
      datetime: '2026-09-03 14:00:00 +00:00',
      items: [
        { type: 'paid', rank_absolute: 1, title: 'Northgate Air & Heating',
          domain: 'northgateair.com', url: 'https://northgateair.com/ac-repair',
          description: '24/7 emergency AC repair', advertiser_id: 'adv-9' },
        { type: 'organic', rank_absolute: 2, title: 'Palmetto Plumbing',
          domain: 'palmettoplumbing.com', url: 'https://palmettoplumbing.com' },
        { type: 'some_new_block_google_added', rank_absolute: 3, title: 'Mystery Block' },
      ],
    }],
  }],
};

function transportReturning(response: ProviderResponse, ok = true, status = 200): Transport {
  return async () => ({ ok, status, json: async () => response });
}

test('an unmapped provider block never becomes ad evidence', () => {
  assert.equal(normalizeResultType('paid'), 'PAID_SEARCH_TEXT');
  assert.equal(normalizeResultType('local_services'), 'LOCAL_SERVICES_AD');
  assert.equal(normalizeResultType('some_new_block_google_added'), 'OTHER');
  assert.equal(normalizeResultType(null), 'OTHER');
  assert.equal(isPaidPlacement('OTHER'), false);
  assert.equal(isPaidPlacement('ORGANIC'), false);
  assert.equal(isPaidPlacement('LOCAL_SERVICES_AD'), true);
});

test('normalization keeps a paid result and an organic result apart', () => {
  const observations = normalizeResponse(RESPONSE, { query: 'emergency ac repair jacksonville' });
  assert.equal(observations.length, 3);

  const paid = observations[0]!;
  assert.equal(paid.resultType, 'PAID_SEARCH_TEXT');
  assert.equal(paid.adHeadline, 'Northgate Air & Heating');
  assert.equal(paid.advertisedService, 'emergency ac repair jacksonville');

  const organic = observations[1]!;
  assert.equal(organic.resultType, 'ORGANIC');
  assert.equal(organic.adHeadline, null, 'an organic result has no ad headline');
  assert.equal(organic.advertisedService, null, 'and advertises nothing');
});

test('nothing the response did not contain is invented', () => {
  const [, , mystery] = normalizeResponse(RESPONSE, { query: 'q' });
  assert.equal(mystery!.observedDomain, null);
  assert.equal(mystery!.observedPhone, null);
  assert.equal(mystery!.landingUrl, null);
  assert.equal(mystery!.resultType, 'OTHER');
});

test('the adapter refuses to run before the source governance review', async () => {
  const adapter = createDataForSeoAdapter({
    config: { ...READY, governanceReviewed: false },
    transport: () => { throw new Error('the provider must not be called'); },
  });
  assert.equal(adapter.isConfigured(), false);

  const found = await adapter.discover({
    verticalProfileId: 'hvac', geographyType: 'city', geographyValue: 'Jacksonville',
    miningMode: 'advertisers_first', queryBudget: 5,
  });
  assert.deepEqual(found, []);

  const { rows } = await pool.query(
    `select status, error_code, units from provider_usage where provider = 'dataforseo'`);
  assert.equal(rows[0]!.status, 'REFUSED');
  assert.equal(rows[0]!.error_code, 'GOVERNANCE_REVIEW_MISSING',
    'the refusal says which gate is missing');
});

test('a credential alone does not start traffic', async () => {
  const adapter = createDataForSeoAdapter({
    config: { ...READY, enabled: false },
    transport: () => { throw new Error('the provider must not be called'); },
  });
  assert.equal(adapter.isConfigured(), false);
  assert.deepEqual(await adapter.discover({
    verticalProfileId: 'hvac', geographyType: 'city', geographyValue: 'Jacksonville',
    miningMode: 'advertisers_first', queryBudget: 5,
  }), []);
});

test('the run budget is capped by configuration, not by the caller', async () => {
  let called = 0;
  const adapter = createDataForSeoAdapter({
    config: { ...READY, maxQueriesPerRun: 0 },
    transport: async () => { called += 1; return { ok: true, status: 200, json: async () => RESPONSE }; },
  });
  await adapter.discover({
    verticalProfileId: 'hvac', geographyType: 'city', geographyValue: 'Jacksonville',
    miningMode: 'advertisers_first', queryBudget: 10_000,
  });
  assert.equal(called, 0, 'a caller asking for ten thousand queries gets none');

  const { rows } = await pool.query(
    `select error_code from provider_usage where provider = 'dataforseo'`);
  assert.equal(rows[0]!.error_code, 'BUDGET_EXHAUSTED');
});

test('a discovered business carries its provider evidence, and no invented location', async () => {
  const adapter = createDataForSeoAdapter({
    config: READY, transport: transportReturning(RESPONSE),
  });
  const found = await adapter.discover({
    verticalProfileId: 'hvac', geographyType: 'city', geographyValue: 'Jacksonville',
    miningMode: 'advertisers_first', queryBudget: 5,
  });

  assert.equal(found.length, 2, 'only results identifying a business become candidates');
  assert.equal(found[0]!.name, 'Northgate Air & Heating');
  assert.equal(found[0]!.website, 'https://northgateair.com');
  assert.equal(found[0]!.resultType, 'PAID_SEARCH_TEXT');
  assert.equal(found[0]!.city, null, 'a city the provider did not give is not guessed');
  assert.equal(found[1]!.resultType, 'ORGANIC');
});

test('provider cost is recorded from the response, and a failure is still recorded', async () => {
  const ok = createDataForSeoAdapter({ config: READY, transport: transportReturning(RESPONSE) });
  await ok.discover({
    verticalProfileId: 'hvac', geographyType: 'city', geographyValue: 'Jacksonville',
    miningMode: 'advertisers_first', queryBudget: 5,
  });
  const success = await pool.query(
    `select status, actual_cost_usd from provider_usage where provider = 'dataforseo'`);
  assert.equal(success.rows[0]!.status, 'OK');
  assert.equal(Number(success.rows[0]!.actual_cost_usd), 0.0031);

  await resetDatabase();
  const failing = createDataForSeoAdapter({
    config: READY, transport: transportReturning(RESPONSE, false, 402) });
  const found = await failing.discover({
    verticalProfileId: 'hvac', geographyType: 'city', geographyValue: 'Jacksonville',
    miningMode: 'advertisers_first', queryBudget: 5,
  });
  assert.deepEqual(found, []);
  const failure = await pool.query(
    `select status, error_code from provider_usage where provider = 'dataforseo'`);
  assert.equal(failure.rows[0]!.status, 'FAILED');
  assert.equal(failure.rows[0]!.error_code, 'HTTP_402',
    'a provider that costs nothing because it failed must not look free');
});

test('an unclassified block is observed but never becomes a company', async () => {
  const adapter = createDataForSeoAdapter({
    config: READY, transport: transportReturning(RESPONSE) });
  const found = await adapter.discover({
    verticalProfileId: 'hvac', geographyType: 'city', geographyValue: 'Jacksonville',
    miningMode: 'advertisers_first', queryBudget: 5,
  });
  assert.equal(found.some((row) => row.name === 'Mystery Block'), false,
    'a block we could not classify has nothing entity resolution can work with');

  // It is still normalized, so the observation is not lost — only its promotion.
  const observations = normalizeResponse(RESPONSE, { query: 'q' });
  assert.ok(observations.some((row) => row.observedName === 'Mystery Block'));
});

test('an unreviewed adapter is not offered to the orchestrator', () => {
  const before = availableDiscoveryAdapters().length;
  registerDiscoveryAdapter(createDataForSeoAdapter({
    config: { ...READY, governanceReviewed: false } }));
  assert.equal(availableDiscoveryAdapters().length, before,
    'registering an adapter must not be the same as enabling it');
});

// --- the first-benchmark harness ---------------------------------------------

import {
  runBenchmark, yieldTable, providerSpendUsd, firstHvacBenchmarkCells,
  BENCHMARK_CEILINGS, type BenchmarkCell,
} from '../src/miner/benchmark.js';
import type { DiscoveryAdapter } from '../src/workers/marketMiner.js';

/** An adapter that always answers, and reports what each task cost. */
function countingAdapter(options: { costPerTask?: number; results?: number } = {}): {
  adapter: DiscoveryAdapter; calls: number; cost: () => Promise<number>;
} {
  const state = { calls: 0 };
  return {
    get calls() { return state.calls; },
    cost: async () => options.costPerTask ?? 0.01,
    adapter: {
      name: 'counting', requiresCredential: false, governanceReviewed: true,
      isConfigured: () => true,
      async discover() {
        state.calls += 1;
        return Array.from({ length: options.results ?? 2 }, (_, index) => ({
          name: `Result ${index}`, website: 'https://example.com',
          resultType: index === 0 ? 'PAID_SEARCH_TEXT' : 'ORGANIC',
        }));
      },
    },
  };
}

function cells(count: number, phase: BenchmarkCell['phase'] = 'phase_2_zcta'): BenchmarkCell[] {
  return Array.from({ length: count }, (_, index) => ({
    phase, label: `cell ${index}`,
    query: {
      verticalProfileId: 'hvac', geographyType: 'zcta', geographyValue: `3225${index % 10}`,
      miningMode: 'emergency ac repair', queryBudget: 1,
    },
  }));
}

test('the dollar ceiling stops the benchmark before the money is spent, not after', async () => {
  const counting = countingAdapter({ costPerTask: 0.40 });
  const result = await runBenchmark({
    adapter: counting.adapter,
    cells: cells(20),
    worstCaseTaskCostUsd: 0.40,
    maxProviderCostUsd: 2.00,
    spentSoFarUsd: 0,
    costOfLastTaskUsd: counting.cost,
  });

  assert.equal(result.stopReason, 'COST_CEILING');
  assert.ok(result.costUsd <= 2.00, `spent ${result.costUsd}`);
  assert.ok(result.tasksSkipped > 0, 'the remaining cells are refused, not attempted');
  // The worst case for the next task would have crossed the ceiling, so it never ran.
  assert.ok(result.costUsd + 0.40 > 2.00);
});

test('spend already recorded counts against the same ceiling', async () => {
  const counting = countingAdapter({ costPerTask: 0.10 });
  const result = await runBenchmark({
    adapter: counting.adapter,
    cells: cells(20),
    worstCaseTaskCostUsd: 0.10,
    maxProviderCostUsd: 2.00,
    // A benchmark resumed after a crash must not spend the ceiling a second time.
    spentSoFarUsd: 1.95,
    costOfLastTaskUsd: counting.cost,
  });
  assert.equal(result.stopReason, 'COST_CEILING');
  assert.equal(counting.calls, 0, 'nothing runs when the ceiling is already reached');
});

test('a phase task ceiling stops that phase without ending the run', async () => {
  const counting = countingAdapter({ costPerTask: 0.0001 });
  const result = await runBenchmark({
    adapter: counting.adapter,
    cells: cells(BENCHMARK_CEILINGS.phase0SmokeMax + 4, 'phase_0_smoke'),
    worstCaseTaskCostUsd: 0.0001,
    spentSoFarUsd: 0,
    costOfLastTaskUsd: counting.cost,
  });
  assert.equal(result.tasksRun, BENCHMARK_CEILINGS.phase0SmokeMax);
  assert.equal(result.tasksSkipped, 4);
  assert.equal(result.stopReason, 'PHASE_TASK_CEILING');
});

test('an unconfigured provider runs nothing and says why', async () => {
  const result = await runBenchmark({
    adapter: {
      name: 'x', requiresCredential: true, governanceReviewed: false,
      isConfigured: () => false,
      discover: async () => { throw new Error('must not be called'); },
    },
    cells: cells(5),
    spentSoFarUsd: 0,
  });
  assert.equal(result.stopReason, 'PROVIDER_NOT_AVAILABLE');
  assert.equal(result.tasksRun, 0);
  assert.equal(result.tasksSkipped, 5);
});

test('a failing task still counts against both ceilings', async () => {
  let calls = 0;
  const result = await runBenchmark({
    adapter: {
      name: 'failing', requiresCredential: false, governanceReviewed: true,
      isConfigured: () => true,
      async discover() { calls += 1; throw new Error('provider exploded'); },
    },
    cells: cells(3, 'phase_0_smoke'),
    worstCaseTaskCostUsd: 0.01,
    spentSoFarUsd: 0,
    costOfLastTaskUsd: async () => 0.01,
  });
  assert.equal(calls, 3);
  assert.equal(result.tasksRun, 3, 'a task that failed is still a task that was sent');
  assert.ok(result.costUsd > 0, 'and still cost money');
});

test('the yield table reports counts and a stop reason, and invents no rate', () => {
  const table = yieldTable({
    tasksRun: 2, tasksSkipped: 0, costUsd: 0.02, stopReason: 'PHASE_COMPLETE',
    rows: [
      { phase: 'phase_0_smoke', label: 'a', returned: 5, paidResults: 2, withDomain: 4, costUsd: 0.01 },
      { phase: 'phase_0_smoke', label: 'b', returned: 3, paidResults: 0, withDomain: 3, costUsd: 0.01 },
    ],
  });
  assert.match(table, /TOTAL \| 2 task\(s\) \| 8 \| 2 \| 7 \| 0\.0200/);
  assert.match(table, /stopped: PHASE_COMPLETE/);
  assert.equal(/%|pass|fail|good|excellent/i.test(table), false,
    'the verdict is a person\'s, from the counts');
});

test('the first benchmark cells stay inside the plan ceilings', () => {
  const plan = firstHvacBenchmarkCells();
  const smoke = plan.filter((cell) => cell.phase === 'phase_0_smoke').length;
  const city = plan.filter((cell) => cell.phase === 'phase_1_city').length;
  assert.ok(smoke <= BENCHMARK_CEILINGS.phase0SmokeMax, `${smoke} smoke cells`);
  assert.ok(city <= BENCHMARK_CEILINGS.phase1City, `${city} city cells`);
  assert.ok(plan.every((cell) => /Jacksonville|St\. Augustine/.test(cell.label)),
    'the first benchmark is the two markets the plan names');
});

test('recorded spend is read back from usage, not held in memory', async () => {
  await resetDatabase();
  const before = await providerSpendUsd('dataforseo');
  assert.equal(before, 0);

  const adapter = createDataForSeoAdapter({
    config: READY, transport: transportReturning(RESPONSE) });
  await adapter.discover({
    verticalProfileId: 'hvac', geographyType: 'city', geographyValue: 'Jacksonville',
    miningMode: 'advertisers_first', queryBudget: 1,
  });
  assert.equal(await providerSpendUsd('dataforseo'), 0.0031,
    'the ceiling is checked against what was actually charged');
});
