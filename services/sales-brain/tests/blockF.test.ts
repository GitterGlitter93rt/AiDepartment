import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters, availableDiscoveryAdapters,
  type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { planCanary, canaryReport } from '../src/miner/canary.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Block F: the live DataForSEO canary, rehearsed offline.
 *
 * The canary is already the most heavily tested thing in this repository, and it
 * should be: it is the one command whose purpose is to spend real money on purpose.
 * What a rehearsal adds is not another refusal test. It is the question of whether
 * the report an operator reads before authorising more spend is arithmetically
 * honest about what was bought -- and the answer changed when the daily ceiling
 * started being consulted per call rather than per run, because a single run can now
 * submit some searches and refuse others.
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

// =============================================================================
// F1 · the state the rehearsal was run in
// =============================================================================

test('F1 nothing in this build can reach DataForSEO', async () => {
  // The condition the whole marathon has been run under, asserted rather than
  // assumed. Two independent gates, and the review one is not a credential: a
  // signed-off source review is a different fact from having an account.
  assert.equal(availableDiscoveryAdapters().length, 0,
    'a discovery adapter is registered in a test process, so this assertion is '
    + 'measuring the harness rather than the product');
  assert.notEqual(process.env['DATAFORSEO_GOVERNANCE_REVIEWED'], 'true');
});

test('F1 the plan refuses a live run for every reason at once, and says all of them',
  async () => {
  // Refusals accumulate rather than short-circuiting. An operator fixing the first
  // one should not discover the second by running it again.
  const plan = await planCanary({
    vertical: null, location: null, count: 3, maxCostCents: 10,
    live: true, confirmSpendCents: null, causes: [], miningMode: 'advertiser_first',
  });
  const codes = plan.refusals.map((refusal) => refusal.code).sort();
  assert.ok(codes.includes('NO_VERTICAL'), `refusals were: ${codes.join(', ')}`);
  assert.ok(codes.includes('NO_LOCATION'));
  assert.ok(codes.includes('NO_PROVIDER'));
  assert.ok(codes.includes('LIVE_NOT_CONFIRMED'),
    'a --live run with no confirmed ceiling was not refused for it');
  assert.equal(plan.wouldRun, false);
});

test('F1 stating the ceiling twice is what makes a run live', async () => {
  const base = {
    vertical: 'hvac', location: '32095', count: 1, maxCostCents: 10,
    causes: [], miningMode: 'advertiser_first',
  };
  const unconfirmed = await planCanary({ ...base, live: true, confirmSpendCents: null });
  assert.ok(unconfirmed.refusals.some((r) => r.code === 'LIVE_NOT_CONFIRMED'));

  // The same command with the ceiling repeated loses that refusal -- and still
  // refuses, because there is no provider. Both facts matter: the confirmation is
  // doing something, and it is not the only thing standing in the way.
  const confirmed = await planCanary({ ...base, live: true, confirmSpendCents: 10 });
  assert.ok(!confirmed.refusals.some((r) => r.code === 'LIVE_NOT_CONFIRMED'));
  assert.ok(confirmed.refusals.some((r) => r.code === 'NO_PROVIDER'));
  assert.equal(confirmed.wouldRun, false);
});

test('F1 the per-run ceiling refuses before the money is spent, not part-way through',
  async () => {
  const plan = await planCanary({
    vertical: 'hvac', location: '32095', count: 3, maxCostCents: 10,
    live: false, confirmSpendCents: null, causes: [], miningMode: 'advertiser_first',
  });
  const ceiling = plan.refusals.find((refusal) => refusal.code === 'COST_CEILING');
  assert.ok(ceiling, `no cost refusal; refusals were ${plan.refusals.map(r => r.code)}`);
  assert.match(ceiling!.message, /before the money is spent/);
  // And it names the arithmetic rather than just refusing.
  assert.match(ceiling!.message, /3 search\(es\)/);
});

// =============================================================================
// F2 · the report must not call a refusal a submission
// =============================================================================

/**
 * The defect this rehearsal found.
 *
 * `searchesSubmitted` was `perSearch.length` -- one row per search the run
 * *considered*. That was survivable while the daily ceiling was consulted once per
 * run, because then either every search was refused or none was. Consulting it per
 * call, which is what stops a single run spending four times the ceiling, means a run
 * can submit two searches and refuse six -- and the canary would have reported eight
 * submitted. `searchesFailed` had the matching problem in the other direction: it
 * counted our own refusal to spend as a provider failure, so the artifact for
 * deciding whether the provider is trustworthy blamed the provider for our budget.
 */
test('F2 a run cut short by the daily ceiling reports what it bought', async () => {
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.10';
  process.env['DISCOVERY_ASSUMED_RUN_COST_USD'] = '0.05';
  let calls = 0;
  registerDiscoveryAdapter({
    name: 'blockf-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      calls += 1;
      return {
        status: 'OK',
        businesses: [{ name: `Block F Co ${++sequence}`, website: null,
          phone: `904-555-${String(3300 + sequence).slice(-4)}` }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, costUsd: 0.05,
      };
    },
  });

  const operator = await makeUser('Block F Operator', 'SALES_MANAGER');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: operator.userId, miningMode: 'advertiser_first',
    queryBudget: 8,
  });
  await drainQueue();

  const report = await canaryReport(job.jobId);
  assert.ok(report, 'no report was produced for the run');

  // Two searches fit under $0.10 at $0.05 each; the rest were refused before spending.
  assert.equal(calls, 2, `${calls} provider calls were made under a $0.10 ceiling`);
  assert.equal(report!.totals.searchesSubmitted, 2,
    `the report claims ${report!.totals.searchesSubmitted} searches were submitted `
    + `when ${calls} reached a provider`);
  assert.equal(report!.totals.searchesRefused, 6,
    'the searches the ceiling refused are not reported as refused');
  assert.equal(report!.totals.searchesCompleted, 2);

  // And our own refusal is not recorded against the provider.
  assert.equal(report!.totals.searchesFailed, 0,
    'a budget refusal was reported as a provider failure, which would make the '
    + 'provider look unreliable on the artifact used to judge it');

  // The money reported is the money spent.
  assert.equal(report!.totals.totalSpendUsd, 0.1);

  // Every considered search is still individually visible: nothing is hidden, it is
  // just counted correctly.
  assert.equal(report!.perSearch.length, 8);
  const refused = report!.perSearch.filter((row) => row.state === 'BUDGET_EXHAUSTED');
  assert.equal(refused.length, 6);
  for (const row of refused) {
    assert.equal(row.providerTaskId, null, 'a refused search has a provider task id');
    assert.equal(row.costUsd, null, 'a search that was never made has a cost');
    assert.match(String(row.failureReason), /daily provider budget/i);
  }
});

test('F2 a run nobody refused reports no refusals', async () => {
  // The other side, so "refused" cannot become a number that is always non-zero.
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '5.00';
  registerDiscoveryAdapter({
    name: 'blockf-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return { status: 'ZERO_RESULTS', businesses: [], providerRows: 0,
        rejectedRows: 0, duplicateRows: 0, costUsd: 0.01 };
    },
  });
  const operator = await makeUser('Block F Operator 2', 'SALES_MANAGER');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: operator.userId, miningMode: 'advertiser_first',
    queryBudget: 3,
  });
  await drainQueue();

  const report = await canaryReport(job.jobId);
  assert.equal(report!.totals.searchesSubmitted, 3);
  assert.equal(report!.totals.searchesRefused, 0);
  assert.equal(report!.totals.searchesFailed, 0);
  // A market that genuinely has nothing usable in it is a completed search.
  assert.equal(report!.totals.searchesCompleted, 3);
});

test('F2 a provider that fails is still reported as a provider failure', async () => {
  // The distinction has to cut both ways, or it is just a way of never blaming the
  // provider.
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '5.00';
  registerDiscoveryAdapter({
    name: 'blockf-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return { status: 'OUTAGE', businesses: [], providerRows: 0, rejectedRows: 0,
        duplicateRows: 0, reason: 'the provider is down' };
    },
  });
  const operator = await makeUser('Block F Operator 3', 'SALES_MANAGER');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: operator.userId, miningMode: 'advertiser_first',
    queryBudget: 2,
  });
  await drainQueue();

  const report = await canaryReport(job.jobId);
  assert.equal(report!.totals.searchesSubmitted, 2,
    'a search that reached a failing provider was not counted as submitted');
  assert.equal(report!.totals.searchesRefused, 0);
  assert.equal(report!.totals.searchesFailed, 2);
  assert.equal(report!.totals.searchesCompleted, 0);
});
