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
