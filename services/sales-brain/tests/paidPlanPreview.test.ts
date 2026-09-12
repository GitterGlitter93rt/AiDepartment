import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import {
  buildPaidPlan, persistPaidPlan, confirmPaidPlan, consumePaidPlan,
  canonicalPlanString, planHash, type PaidPlan, type PlanRequest,
} from '../src/miner/planPreview.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { recordProviderTask } from '../src/miner/providerTasks.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * A paid search is reviewed before it is bought, and what is bought is what was
 * reviewed.
 *
 * `POST /api/mining/jobs` used to take a vertical and a ZIP and submit chargeable
 * provider tasks. Nobody saw the queries, nobody saw the cost, and nothing recorded
 * what a person had agreed to pay for.
 *
 * No provider is called anywhere in this file: planning reads the taxonomy and the
 * outstanding-task table, and neither touches a network.
 */

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase(); await syncVerticalProfiles(); clearDiscoveryAdapters();
  registerDiscoveryAdapter({
    name: 'dataforseo', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      throw new Error('planning must never call a provider');
    },
  });
});

const REQUEST: PlanRequest = {
  verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: '32095',
  marketId: null, miningMode: 'advertisers_first', queryBudget: 3, causes: null,
};

test('the plan names every search before anything is bought', async () => {
  const plan = await buildPaidPlan(REQUEST);
  assert.equal(plan.searches.length, 3);
  for (const search of plan.searches) {
    assert.ok(search.keyword.includes('32095'), 'the geography is not in the keyword');
    assert.ok(search.term.length > 0);
    assert.ok(['ENTITY_DISCOVERY', 'COMMERCIAL_INTELLIGENCE'].includes(search.purpose));
  }
  assert.equal(plan.searches[0]!.purpose, 'ENTITY_DISCOVERY',
    'the first search a person authorises is not one that finds the market');
});

test('the plan says which searches will be charged for', async () => {
  const first = await buildPaidPlan(REQUEST);
  assert.equal(first.chargeableTaskCount, 3);
  assert.ok(first.searches.every((search) => search.disposition === 'NEW_PAID_TASK'));
  assert.ok(first.estimatedCostUsd > 0);

  // A task the provider already owes us is collected, not bought again, and the
  // quote has to say so or it overstates the cost of pressing the button.
  await recordProviderTask({
    provider: 'dataforseo', providerNativeId: 'task-1',
    fingerprint: first.searches[0]!.fingerprint, jobId: null, request: {},
  });

  const second = await buildPaidPlan(REQUEST);
  assert.equal(second.searches[0]!.disposition, 'ALREADY_SUBMITTED_WILL_COLLECT');
  assert.equal(second.searches[0]!.chargeable, false);
  assert.equal(second.chargeableTaskCount, 2);
  assert.ok(second.estimatedCostUsd < first.estimatedCostUsd,
    'a search already paid for was quoted for twice');
});

test('the plan reports when the budget does not cover the market', async () => {
  const narrow = await buildPaidPlan({ ...REQUEST, queryBudget: 1 });
  assert.equal(narrow.partialDiscoveryCoverage, true,
    'one search of a market was presented as covering it');
  const wide = await buildPaidPlan({ ...REQUEST, queryBudget: 50 });
  assert.equal(wide.partialDiscoveryCoverage, false);
});

test('the hash covers every field that changes what is bought', async () => {
  const plan = await buildPaidPlan(REQUEST);
  const base = planHash(plan);

  const mutations: { name: string; change: (plan: PaidPlan) => PaidPlan }[] = [
    { name: 'vertical', change: (p) => ({ ...p, verticalProfileId: 'hvac' }) },
    { name: 'geography', change: (p) => ({ ...p, geographyValue: '32080' }) },
    { name: 'normalised geography', change: (p) => ({ ...p, geographyNormalized: '32080' }) },
    { name: 'mining mode', change: (p) => ({ ...p, miningMode: 'broad_local' }) },
    { name: 'causes', change: (p) => ({ ...p, causes: ['hail'] }) },
    { name: 'provider', change: (p) => ({ ...p, provider: 'someone-else' }) },
    { name: 'provider mode', change: (p) => ({ ...p, providerMode: 'live' }) },
    { name: 'chargeable count', change: (p) => ({ ...p, chargeableTaskCount: 9 }) },
    { name: 'per-task cost', change: (p) => ({ ...p, assumedCostPerTaskUsd: 0.99 }) },
    { name: 'estimate', change: (p) => ({ ...p, estimatedCostUsd: 9.99 }) },
    { name: 'a query', change: (p) => ({
      ...p, searches: [{ ...p.searches[0]!, keyword: 'something else 32095' }, ...p.searches.slice(1)] }) },
    { name: 'a query purpose', change: (p) => ({
      ...p, searches: [{ ...p.searches[0]!, purpose: 'COMMERCIAL_INTELLIGENCE' }, ...p.searches.slice(1)] }) },
    { name: 'a fingerprint', change: (p) => ({
      ...p, searches: [{ ...p.searches[0]!, fingerprint: 'search:elsewhere' }, ...p.searches.slice(1)] }) },
    { name: 'whether a search is charged for', change: (p) => ({
      ...p, searches: [{ ...p.searches[0]!, chargeable: false }, ...p.searches.slice(1)] }) },
    { name: 'the number of searches', change: (p) => ({ ...p, searches: p.searches.slice(1) }) },
  ];
  for (const mutation of mutations) {
    assert.notEqual(planHash(mutation.change(plan)), base,
      `changing the ${mutation.name} did not change the hash, so it can change after review`);
  }
});

test('the hash does not depend on the order fields were assigned in', async () => {
  const plan = await buildPaidPlan(REQUEST);
  // The same plan, rebuilt with its keys in a different insertion order. JSON
  // stringification would hash these differently and refuse an identical plan.
  const reordered = JSON.parse(JSON.stringify({
    dailyBudgetUsd: plan.dailyBudgetUsd, spentTodayUsd: plan.spentTodayUsd,
    searches: plan.searches, refusal: plan.refusal, provider: plan.provider,
    providerMode: plan.providerMode, causes: plan.causes, miningMode: plan.miningMode,
    marketId: plan.marketId, geographyNormalized: plan.geographyNormalized,
    geographyValue: plan.geographyValue, geographyType: plan.geographyType,
    verticalProfileId: plan.verticalProfileId,
    chargeableTaskCount: plan.chargeableTaskCount,
    assumedCostPerTaskUsd: plan.assumedCostPerTaskUsd,
    estimatedCostUsd: plan.estimatedCostUsd,
    partialDiscoveryCoverage: plan.partialDiscoveryCoverage,
  })) as PaidPlan;
  assert.equal(planHash(reordered), planHash(plan));
});

test('nothing secret is in the plan or its hash', async () => {
  process.env['DATAFORSEO_LOGIN'] = 'plan-login@example.invalid';
  process.env['DATAFORSEO_PASSWORD'] = 'plan-password-secret';
  try {
    const plan = await buildPaidPlan(REQUEST);
    const serialized = `${JSON.stringify(plan)}\n${canonicalPlanString(plan)}`;
    assert.equal(serialized.includes('plan-password-secret'), false,
      'a credential reached a plan a person is shown');
    assert.equal(serialized.includes('plan-login@example.invalid'), false);
  } finally {
    delete process.env['DATAFORSEO_LOGIN'];
    delete process.env['DATAFORSEO_PASSWORD'];
  }
});

test('a confirmation of an unchanged plan is accepted', async () => {
  const user = await makeUser('Plan Operator', 'SALES_MANAGER');
  const plan = await buildPaidPlan(REQUEST);
  const stored = await persistPaidPlan(plan, user.userId, REQUEST);

  const confirmation = await confirmPaidPlan({
    planId: stored.planId, planHash: stored.planHash, userId: user.userId });
  assert.equal(confirmation.ok, true,
    confirmation.ok ? '' : `${confirmation.code}: ${confirmation.message}`);
});

test('a plan that changed after review is refused, in those words', async () => {
  const user = await makeUser('Plan Changed Operator', 'SALES_MANAGER');
  const plan = await buildPaidPlan(REQUEST);
  const stored = await persistPaidPlan(plan, user.userId, REQUEST);

  // The world moves: one of the reviewed searches turns out to be already paid for,
  // so the plan a confirmation would buy is cheaper and different from the one shown.
  await recordProviderTask({
    provider: 'dataforseo', providerNativeId: 'task-moved',
    fingerprint: plan.searches[0]!.fingerprint, jobId: null, request: {},
  });

  const confirmation = await confirmPaidPlan({
    planId: stored.planId, planHash: stored.planHash, userId: user.userId });
  assert.equal(confirmation.ok, false);
  assert.equal(confirmation.ok ? '' : confirmation.code, 'CHANGED');
  assert.equal(confirmation.ok ? '' : confirmation.message,
    'The research plan changed after you reviewed it. Review the updated plan before '
    + 'submitting paid searches.');
});

test('a hash the client invented is refused', async () => {
  const user = await makeUser('Plan Forger', 'SALES_MANAGER');
  const plan = await buildPaidPlan(REQUEST);
  const stored = await persistPaidPlan(plan, user.userId, REQUEST);

  const confirmation = await confirmPaidPlan({
    planId: stored.planId, userId: user.userId,
    planHash: '0'.repeat(64),
  });
  assert.equal(confirmation.ok, false, 'a made-up hash bought a search');
  assert.equal(confirmation.ok ? '' : confirmation.code, 'CHANGED');
});

test('a plan whose stored row was edited is refused', async () => {
  const user = await makeUser('Plan Tamperer', 'SALES_MANAGER');
  const plan = await buildPaidPlan(REQUEST);
  const stored = await persistPaidPlan(plan, user.userId, REQUEST);

  // Somebody edits the row to claim a cheaper plan was approved. The server rebuilds
  // from the request and the recomputed hash no longer matches the stored one.
  await query(
    `update search_plan_previews set plan = jsonb_set(plan, '{plan,estimatedCostUsd}', '0')
      where plan_id = $1`, [stored.planId]);
  const confirmation = await confirmPaidPlan({
    planId: stored.planId, planHash: stored.planHash, userId: user.userId });
  assert.equal(confirmation.ok, false);
});

test('a plan expires, and an expired one buys nothing', async () => {
  const user = await makeUser('Plan Expiry Operator', 'SALES_MANAGER');
  const plan = await buildPaidPlan(REQUEST);
  const stored = await persistPaidPlan(plan, user.userId, REQUEST);
  await query(`update search_plan_previews set expires_at = now() - interval '1 minute'
                where plan_id = $1`, [stored.planId]);

  const confirmation = await confirmPaidPlan({
    planId: stored.planId, planHash: stored.planHash, userId: user.userId });
  assert.equal(confirmation.ok, false);
  assert.equal(confirmation.ok ? '' : confirmation.code, 'EXPIRED');
});

test('one review buys one run', async () => {
  const user = await makeUser('Plan Double Clicker', 'SALES_MANAGER');
  const plan = await buildPaidPlan(REQUEST);
  const stored = await persistPaidPlan(plan, user.userId, REQUEST);
  assert.equal((await confirmPaidPlan({
    planId: stored.planId, planHash: stored.planHash, userId: user.userId })).ok, true);
  await consumePaidPlan(stored.planId, null);

  const second = await confirmPaidPlan({
    planId: stored.planId, planHash: stored.planHash, userId: user.userId });
  assert.equal(second.ok, false, 'a second click on the same plan bought a second run');
  assert.equal(second.ok ? '' : second.code, 'ALREADY_USED');
});

test('somebody else’s plan is not yours to submit', async () => {
  const reviewer = await makeUser('Plan Reviewer', 'SALES_MANAGER');
  const other = await makeUser('Plan Other', 'SALES_MANAGER');
  const plan = await buildPaidPlan(REQUEST);
  const stored = await persistPaidPlan(plan, reviewer.userId, REQUEST);

  const confirmation = await confirmPaidPlan({
    planId: stored.planId, planHash: stored.planHash, userId: other.userId });
  assert.equal(confirmation.ok, false);
  assert.equal(confirmation.ok ? '' : confirmation.code, 'NOT_YOURS');
});

test('a vertical with no discovery query fails closed, and no plan can be confirmed',
  async () => {
  // The planner refuses rather than falling back to sales keywords, and the refusal
  // survives into the plan, so there is no plan a confirmation could turn into spend.
  const plan = await buildPaidPlan({ ...REQUEST, verticalProfileId: null });
  assert.ok(plan.refusal, 'a plan with no vertical was quoted for anyway');
  assert.equal(plan.searches.length, 0);
  assert.equal(plan.chargeableTaskCount, 0);
  assert.equal(plan.estimatedCostUsd, 0);

  const user = await makeUser('Plan Refusal Operator', 'SALES_MANAGER');
  const stored = await persistPaidPlan(plan, user.userId, { ...REQUEST, verticalProfileId: null });
  const confirmation = await confirmPaidPlan({
    planId: stored.planId, planHash: stored.planHash, userId: user.userId });
  assert.equal(confirmation.ok, false);
  assert.equal(confirmation.ok ? '' : confirmation.code, 'REFUSED');
});

test('a plan id nobody issued is refused', async () => {
  const user = await makeUser('Plan Ghost', 'SALES_MANAGER');
  const confirmation = await confirmPaidPlan({
    planId: '00000000-0000-0000-0000-000000000000',
    planHash: '0'.repeat(64), userId: user.userId });
  assert.equal(confirmation.ok, false);
  assert.equal(confirmation.ok ? '' : confirmation.code, 'NOT_FOUND');
});
