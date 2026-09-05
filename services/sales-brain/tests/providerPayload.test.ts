import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, withTransaction } from '../src/db/pool.js';
import { createDataForSeoAdapter, type DataForSeoConfig } from '../src/miner/dataForSeoAdapter.js';
import { normalizeGeography } from '../src/miner/geography.js';
import { providerTargetFor, cityForPostalCode } from '../src/miner/providerLocation.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { resetDatabase } from './helpers.js';

/**
 * Exactly what goes on the wire.
 * Authority: Issue #3 Phase E acceptance.
 *
 * The query construction was changed in `a891d2e` and never pinned, and pinning it
 * immediately found the next defect: DataForSEO's `location_name` takes a place --
 * "Jacksonville,Florida,United States" -- and the miner was sending a bare ZIP.
 * "32095" is not a place it resolves, so the search either fails or silently widens
 * to somewhere else, and either way the operator is told about a market nobody
 * searched.
 *
 * These assert the request body, not a summary of it. A change to what we ask a paid
 * provider for should have to be made deliberately.
 */

const READY: DataForSeoConfig = {
  login: 'user', password: 'secret', baseUrl: 'https://api.example.invalid/v3',
  mode: 'live', governanceReviewed: true, enabled: true,
  maxQueriesPerRun: 25, resultDepth: 100, maxRetries: 0, maxPollAttempts: 1,
  pollIntervalMs: 0,
};

interface Captured { url: string; method: string; body: any; headers: Record<string, string> }

function capturingTransport(): { transport: any; calls: Captured[] } {
  const calls: Captured[] = [];
  return {
    calls,
    transport: async (url: string, init: any) => {
      calls.push({
        url, method: init.method, headers: init.headers,
        body: init.body ? JSON.parse(init.body) : null,
      });
      return {
        ok: true, status: 200,
        json: async () => ({ cost: 0.001, tasks: [{ id: 't', status_code: 20000, result: [] }] }),
      };
    },
  };
}

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

let fixtureSequence = 0;

async function seedAccountIn(city: string, state: string, postalCode: string): Promise<void> {
  fixtureSequence += 1;
  await withTransaction((client) => upsertAccount(client, {
    canonicalName: `${city} Fixture Co ${fixtureSequence}`,
    website: `https://fixture${fixtureSequence}.invalid`,
    phone: `904-555-${String(3000 + fixtureSequence).slice(-4)}`,
    city, state, postalCode,
  }, { discoverySource: 'payload-test' }));
}

async function discoverWith(geographyType: string, geographyValue: string) {
  const { transport, calls } = capturingTransport();
  const adapter = createDataForSeoAdapter({ config: READY, transport, sleep: async () => {} });
  await adapter.discover({
    verticalProfileId: 'hvac', geographyType, geographyValue,
    miningMode: 'advertiser_first', queryBudget: 5,
  });
  return calls;
}

test('a city search asks a real question about a real place', async () => {
  const calls = await discoverWith('city', 'Jacksonville, FL');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'POST');
  assert.match(calls[0]!.url, /serp\/google\/organic\/live\/advanced$/);

  const task = calls[0]!.body[0];
  assert.deepEqual(Object.keys(task).sort(),
    ['depth', 'device', 'keyword', 'language_code', 'location_name']);
  assert.equal(task.location_name, 'Jacksonville,Florida,United States');
  assert.equal(task.language_code, 'en');
  assert.equal(task.device, 'desktop');
  assert.equal(task.depth, 100);

  // The words a customer would type, from the vertical's own taxonomy.
  assert.equal(task.keyword, 'AC repair');
  assert.ok(!/advertiser_first/.test(task.keyword),
    'the strategy name is how we choose a query, not a thing to search for');
  assert.ok(!/\bhvac\b/.test(task.keyword) || task.keyword.includes('HVAC'),
    'the internal vertical id is not a search term');
});

test('a state search targets the state, not a city called Florida', async () => {
  const calls = await discoverWith('state', 'FL');
  const task = calls[0]!.body[0];
  assert.equal(task.location_name, 'Florida,United States');
  assert.equal(task.keyword, 'AC repair');
});

test('a ZIP is resolved to the town it is in, and stays in the query', async () => {
  // We know 32095 is St. Augustine because we hold accounts there.
  await seedAccountIn('St. Augustine', 'FL', '32095');

  const calls = await discoverWith('zip_zcta', '32095');
  const task = calls[0]!.body[0];

  assert.equal(task.location_name, 'St. Augustine,Florida,United States',
    'a bare ZIP is not a place DataForSEO resolves');
  assert.equal(task.keyword, 'AC repair 32095',
    'the town is wider than the ZIP, so the query is what narrows it back');
});

test('a ZIP we have never seen is not guessed into a town', async () => {
  const calls = await discoverWith('zip_zcta', '99362');
  const task = calls[0]!.body[0];

  assert.equal(task.location_name, 'United States',
    'inventing a city for an unknown ZIP would target the wrong market and never say so');
  assert.equal(task.keyword, 'AC repair 99362');
});

test('a ZIP that straddles two towns resolves the same way every time', async () => {
  // An unstable target is an unstable fingerprint, and an unstable fingerprint is a
  // second paid search for the same market.
  await seedAccountIn('Arlington', 'FL', '32277');
  await seedAccountIn('Jacksonville', 'FL', '32277');
  await seedAccountIn('Jacksonville', 'FL', '32277');

  const first = await providerTargetFor(normalizeGeography('zip_zcta', '32277') as any);
  const second = await providerTargetFor(normalizeGeography('zip_zcta', '32277') as any);
  assert.equal(first.locationName, second.locationName);
  assert.equal(first.locationName, 'Jacksonville,Florida,United States',
    'the town we hold most accounts in wins');
});

test('the resolution says how precise it actually is', async () => {
  await seedAccountIn('St. Augustine', 'FL', '32095');

  assert.equal((await providerTargetFor(
    normalizeGeography('city', 'Jacksonville, FL') as any)).precision, 'CITY');
  assert.equal((await providerTargetFor(
    normalizeGeography('state', 'FL') as any)).precision, 'STATE');
  assert.equal((await providerTargetFor(
    normalizeGeography('zip_zcta', '32095') as any)).precision, 'ZIP_RESOLVED');
  assert.equal((await providerTargetFor(
    normalizeGeography('zip_zcta', '99362') as any)).precision, 'ZIP_UNRESOLVED');
});

test('an unknown postal code resolves to nothing rather than to something nearby', async () => {
  await seedAccountIn('St. Augustine', 'FL', '32095');
  assert.equal(await cityForPostalCode('99999'), null);
  assert.deepEqual(await cityForPostalCode('32095'), { city: 'St. Augustine', state: 'FL' });
});

test('the queued-task request carries the same body plus the queue priority', async () => {
  const { transport, calls } = capturingTransport();
  const adapter = createDataForSeoAdapter({
    config: { ...READY, mode: 'standard' }, transport, sleep: async () => {} });
  await adapter.discover({
    verticalProfileId: 'hvac', geographyType: 'city', geographyValue: 'Jacksonville, FL',
    miningMode: 'advertiser_first', queryBudget: 5,
  });

  const posted = calls.find((call) => call.url.includes('task_post'))!;
  assert.ok(posted, 'standard mode must post a task');
  assert.equal(posted.body[0].location_name, 'Jacksonville,Florida,United States');
  assert.equal(posted.body[0].keyword, 'AC repair');
  assert.equal(posted.body[0].priority, 1);
});

test('the credential is sent as a header and never in the query or body', async () => {
  const calls = await discoverWith('city', 'Jacksonville, FL');
  const call = calls[0]!;
  assert.match(call.headers['authorization'] ?? '', /^Basic /);
  assert.ok(!call.url.includes('secret'), 'a credential in a URL ends up in a log');
  assert.ok(!JSON.stringify(call.body).includes('secret'));
});

test('the depth requested stays inside what the provider accepts', async () => {
  for (const [configured, expected] of [[5, 10], [100, 100], [5000, 700]] as const) {
    const { transport, calls } = capturingTransport();
    const adapter = createDataForSeoAdapter({
      config: { ...READY, resultDepth: configured }, transport, sleep: async () => {} });
    await adapter.discover({
      verticalProfileId: 'hvac', geographyType: 'city', geographyValue: 'Jacksonville, FL',
      miningMode: 'advertiser_first', queryBudget: 5,
    });
    assert.equal(calls[0]!.body[0].depth, expected, `depth ${configured}`);
  }
});

test('a market we cannot express is refused before the money is spent', async () => {
  const { transport, calls } = capturingTransport();
  const adapter = createDataForSeoAdapter({ config: READY, transport, sleep: async () => {} });

  const result = await adapter.discover({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: 'not-a-zip',
    miningMode: 'advertiser_first', queryBudget: 5,
  });

  assert.equal(calls.length, 0, 'an unreadable market must not become a paid request');
  assert.notEqual(result.status, 'ZERO_RESULTS');
  assert.match(result.reason ?? '', /ZIP/);
});

test('a vertical with no taxonomy spends nothing', async () => {
  const { transport, calls } = capturingTransport();
  const adapter = createDataForSeoAdapter({ config: READY, transport, sleep: async () => {} });

  const result = await adapter.discover({
    verticalProfileId: null, geographyType: 'city', geographyValue: 'Jacksonville, FL',
    miningMode: 'advertiser_first', queryBudget: 5,
  });

  assert.equal(calls.length, 0);
  assert.notEqual(result.status, 'ZERO_RESULTS');
  assert.match(result.reason ?? '', /vertical/);
});
