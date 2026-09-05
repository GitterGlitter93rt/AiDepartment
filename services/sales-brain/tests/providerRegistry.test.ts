import './setup.js';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/pool.js';
import {
  availableDiscoveryAdapters, clearDiscoveryAdapters,
} from '../src/workers/marketMiner.js';
import { registerConfiguredDiscoveryAdapters } from '../src/miner/registry.js';

/**
 * The wiring that was never done.
 * Authority: Issue #3 Phase U.
 *
 * Everything about the provider path was built, tested and made durable -- the
 * result contract, the durable task table, the exact request payload, the budget
 * ceiling -- and nothing ever called registerDiscoveryAdapter with it.
 * `availableDiscoveryAdapters()` returned an empty list whatever was in the
 * environment, so a correctly credentialled DataForSEO account would still have
 * produced DISCOVERY_BLOCKED on every single search.
 *
 * "Add the credentials" would not have worked, and the failure would have looked
 * exactly like the defect this whole audit started from.
 */

after(async () => { await pool.end(); });
beforeEach(() => { clearDiscoveryAdapters(); });

const CREDENTIALLED = {
  DATAFORSEO_LOGIN: 'operator@example.com',
  DATAFORSEO_PASSWORD: 'a-real-looking-credential',
  DATAFORSEO_ENABLED: 'true',
  DATAFORSEO_GOVERNANCE_REVIEWED: 'true',
} as unknown as NodeJS.ProcessEnv;

test('a fully configured provider becomes available to the miner', () => {
  const names = registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  assert.deepEqual(names, ['dataforseo'],
    'credentials were set and the miner still could not see a provider');
  assert.equal(availableDiscoveryAdapters().length, 1);
});

test('registering is not enabling: no credential means no provider', () => {
  const names = registerConfiguredDiscoveryAdapters({} as NodeJS.ProcessEnv);
  assert.deepEqual(names, []);
  assert.equal(availableDiscoveryAdapters().length, 0,
    'an unconfigured adapter was offered to the miner');
});

test('a credential without the governance review is still not available', () => {
  const names = registerConfiguredDiscoveryAdapters({
    ...CREDENTIALLED, DATAFORSEO_GOVERNANCE_REVIEWED: 'false' } as NodeJS.ProcessEnv);
  assert.deepEqual(names, [],
    'the source governance gate was bypassed by having a password');
});

test('a reviewed provider that is switched off is still not available', () => {
  const names = registerConfiguredDiscoveryAdapters({
    ...CREDENTIALLED, DATAFORSEO_ENABLED: 'false' } as NodeJS.ProcessEnv);
  assert.deepEqual(names, []);
});

test('half a credential is not a credential', () => {
  for (const missing of ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'] as const) {
    clearDiscoveryAdapters();
    const env = { ...CREDENTIALLED };
    delete env[missing];
    assert.deepEqual(registerConfiguredDiscoveryAdapters(env as NodeJS.ProcessEnv), [],
      `${missing} was missing and the provider was still offered`);
  }
});

test('the same environment gives both processes the same answer', () => {
  // The API decides whether to tell a rep "discovery is unavailable"; the worker
  // decides whether it can search. A registry that differs between them is how a
  // page comes to say discovery is impossible while the worker is busy discovering.
  const fromApi = registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  clearDiscoveryAdapters();
  const fromWorker = registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  assert.deepEqual(fromApi, fromWorker);
});

// ------------------------------- through the orchestrator, not around it --------

/**
 * The tests above prove the registry function behaves. These prove the path that
 * actually runs a search reaches it -- which is the thing that was broken. An
 * adapter can be constructed correctly, report itself configured correctly, and
 * still never be asked anything.
 *
 * The provider host is 127.0.0.1:1, which refuses instantly. No network leaves the
 * machine and no paid request is possible; what is being tested is whether the
 * orchestrator got as far as trying.
 */

const UNREACHABLE = {
  ...CREDENTIALLED,
  DATAFORSEO_BASE_URL: 'http://127.0.0.1:1',
  DATAFORSEO_MODE: 'live',
  DATAFORSEO_MAX_RETRIES: '0',
  DATAFORSEO_POLL_INTERVAL_MS: '0',
} as unknown as NodeJS.ProcessEnv;

test('a credentialled provider makes the orchestrator try, not report blocked', async () => {
  const { resetDatabase, makeUser } = await import('./helpers.js');
  const { syncVerticalProfiles } = await import('../src/domain/verticals.js');
  const { enqueueMarketResearch } = await import('../src/workers/enqueue.js');
  const { drainQueue } = await import('../src/workers/runner.js');
  const { query } = await import('../src/db/pool.js');
  await import('../src/workers/marketMiner.js');

  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  const manager = await makeUser('Registry Manager', 'SALES_MANAGER');

  registerConfiguredDiscoveryAdapters(UNREACHABLE);
  assert.equal(availableDiscoveryAdapters().length, 1);

  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: manager.userId });
  await drainQueue(10);

  const { rows } = await query<{ outcome: string; outcome_reason: string }>(
    'select outcome, outcome_reason from jobs where job_id = $1', [job.jobId]);

  // The provider was unreachable, which is a provider problem. What must never
  // happen again is DISCOVERY_BLOCKED with credentials present, because that says
  // no provider exists when one is configured and waiting.
  assert.notEqual(rows[0]!.outcome, 'DISCOVERY_BLOCKED',
    'credentials were configured and the orchestrator still said no provider exists');
  assert.equal(rows[0]!.outcome, 'PROVIDER_UNAVAILABLE');
});

test('with no credential the orchestrator correctly reports blocked', async () => {
  const { resetDatabase, makeUser } = await import('./helpers.js');
  const { syncVerticalProfiles } = await import('../src/domain/verticals.js');
  const { enqueueMarketResearch } = await import('../src/workers/enqueue.js');
  const { drainQueue } = await import('../src/workers/runner.js');
  const { query } = await import('../src/db/pool.js');

  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  const manager = await makeUser('Registry Manager Two', 'SALES_MANAGER');
  registerConfiguredDiscoveryAdapters({} as NodeJS.ProcessEnv);

  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: manager.userId });
  await drainQueue(10);

  const { rows } = await query<{ outcome: string }>(
    'select outcome from jobs where job_id = $1', [job.jobId]);
  assert.equal(rows[0]!.outcome, 'DISCOVERY_BLOCKED');
});

test('what the API says about discovery matches what the worker can do', async () => {
  const { resetDatabase } = await import('./helpers.js');
  const { coverageFor } = await import('../src/domain/search.js');
  const { operationalSnapshot } = await import('../src/api/operations.js');

  await resetDatabase();
  clearDiscoveryAdapters();
  registerConfiguredDiscoveryAdapters(UNREACHABLE);

  // The two places the API answers "can this system find a new business".
  const coverage = await coverageFor({ geography: { type: 'zip_zcta', value: '32095' } });
  assert.equal(coverage.discoveryAvailable, true,
    'the page would tell a rep discovery is impossible while the worker can search');

  const snapshot = await operationalSnapshot();
  assert.equal(snapshot.checks.find((check) => check.id === 'discovery')!.state, 'OK');
});

test('what the Settings page reports and what the miner can do never diverge', async () => {
  // This is the divergence that hid M-15 for the whole build: settings constructed
  // an adapter and reported on it, while the registry the miner reads had never
  // heard of one. Construction and invocation are now checked against each other
  // for every combination of the three gates.
  const { resetDatabase } = await import('./helpers.js');
  const { listIntegrations } = await import('../src/domain/settings.js');
  await resetDatabase();

  const combinations = [
    {}, { DATAFORSEO_LOGIN: 'u' }, { DATAFORSEO_PASSWORD: 'p' },
    { DATAFORSEO_LOGIN: 'u', DATAFORSEO_PASSWORD: 'p' },
    { DATAFORSEO_LOGIN: 'u', DATAFORSEO_PASSWORD: 'p', DATAFORSEO_ENABLED: 'true' },
    { DATAFORSEO_LOGIN: 'u', DATAFORSEO_PASSWORD: 'p', DATAFORSEO_GOVERNANCE_REVIEWED: 'true' },
    { ...CREDENTIALLED },
  ];

  for (const env of combinations) {
    clearDiscoveryAdapters();
    const integrations = await listIntegrations(env as NodeJS.ProcessEnv);
    const dataforseo = integrations.find((row) => row.key === 'dataforseo')!;
    const settingsSaysReady = dataforseo.missing.length === 0;
    const minerCanSearch = registerConfiguredDiscoveryAdapters(
      env as NodeJS.ProcessEnv).length > 0;

    assert.equal(minerCanSearch, settingsSaysReady,
      `Settings shows ${settingsSaysReady ? 'ready' : `missing ${dataforseo.missing.join(', ')}`}`
      + ` and the miner ${minerCanSearch ? 'can' : 'cannot'} search, for `
      + `${JSON.stringify(env)}`);
  }
});

test('configuring a search provider does not arm anything that contacts anybody', async () => {
  const { resetDatabase } = await import('./helpers.js');
  const { readPilotState } = await import('../src/domain/pilot.js');
  const { config } = await import('../src/config.js');

  await resetDatabase();
  clearDiscoveryAdapters();
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);

  const pilot = await readPilotState();
  assert.equal(pilot.outboundMode, 'OFF');
  assert.equal(pilot.outboundDialEnabled, false,
    'registering a search provider armed the dialler');
  assert.equal(pilot.autoBookEnabled, false);
  assert.equal(config.outbound.dialEnabled, false);
});

test('registering twice does not double the provider', () => {
  // This test used to assert the opposite of its own name: it found the registry
  // append-only, wrote down `first + 1`, and called it the contract. It is not a
  // contract worth having. The orchestrator loops over the registry, so a provider
  // held twice is a market searched twice and billed twice, and the duplicate rows
  // come back through the funnel counters looking like ordinary duplicates.
  clearDiscoveryAdapters();
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  registerConfiguredDiscoveryAdapters(CREDENTIALLED);
  assert.equal(availableDiscoveryAdapters().length, 1,
    'one provider registered twice is two providers, so every search costs double');
  assert.deepEqual(availableDiscoveryAdapters().map((adapter) => adapter.name), ['dataforseo']);
});
