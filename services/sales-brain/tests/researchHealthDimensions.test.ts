import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { operationalSnapshot, type HealthDimension } from '../src/api/operations.js';
import { recordHeartbeat, recordWorkerDraining } from '../src/workers/runner.js';
import { recordProviderTask } from '../src/miner/providerTasks.js';
import { clearDiscoveryAdapters, registerDiscoveryAdapter } from '../src/workers/marketMiner.js';
import { resetDatabase } from './helpers.js';

/**
 * Eight independent answers, not one light.
 * Authority: Issue #3 Phase P.
 *
 * A single green light cannot be right about all of these at once. The database can
 * be up while the schema is behind. A worker can be alive while the discovery
 * provider is unusable. The queue can be empty because everything is fine or because
 * nothing is scheduling work. Rolled together they produce a light that is true of
 * nothing in particular -- which is how "systemd active" and "workers online: 0"
 * managed to coexist on this machine.
 */

let app: FastifyInstance;
const PASSWORD = 'health-dimensions-password';
let sequence = 0;

before(async () => { app = await buildServer(); await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
});

function dimensionState(checks: { dimension: HealthDimension; state: string }[],
  dimension: HealthDimension): string {
  const rank: Record<string, number> = { OK: 0, UNKNOWN: 1, ATTENTION: 2, BLOCKED: 3 };
  return checks
    .filter((check) => check.dimension === dimension)
    .reduce((worst, check) => (rank[check.state]! > rank[worst]! ? check.state : worst), 'OK');
}

async function healthPage(): Promise<string> {
  sequence += 1;
  await createUser({
    email: `health${sequence}@test.local`, displayName: 'Health Ops', role: 'RESEARCH_OPS',
    password: PASSWORD });
  const login = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: `health${sequence}@test.local`, password: PASSWORD } });
  const cookie = login.cookies.find((c) => c.name === 'yad_sales_session')!;
  const page = await app.inject({
    method: 'GET', url: '/research-health',
    headers: { cookie: `yad_sales_session=${cookie.value}` } });
  assert.equal(page.statusCode, 200);
  return page.body;
}

test('every check belongs to a named dimension', async () => {
  const snapshot = await operationalSnapshot();
  for (const check of snapshot.checks) {
    assert.ok(check.dimension, `${check.id} has no dimension`);
  }
  const dimensions = new Set(snapshot.checks.map((check) => check.dimension));
  for (const required of ['DATABASE', 'SCHEMA', 'WORKER', 'QUEUE', 'DISCOVERY_PROVIDER',
    'PROVIDER_TASKS', 'RESEARCH', 'SAVED_MARKETS', 'SPEND'] as HealthDimension[]) {
    assert.ok(dimensions.has(required), `nothing answers for ${required}`);
  }
});

test('a healthy database does not make a blocked provider look fine', async () => {
  // The database is up by construction -- the snapshot came from it -- and no
  // discovery provider is configured.
  const snapshot = await operationalSnapshot();
  assert.equal(dimensionState(snapshot.checks, 'DATABASE'), 'OK');
  assert.notEqual(dimensionState(snapshot.checks, 'DISCOVERY_PROVIDER'), 'OK',
    'a green database was allowed to speak for the miner');
});

test('a live worker does not make a stale schema look fine', async () => {
  await recordHeartbeat({ processed: 1 });
  const { rows } = await query<{ filename: string }>(
    'select filename from schema_migrations order by filename desc limit 1');
  await query('delete from schema_migrations where filename = $1', [rows[0]!.filename]);

  try {
    const snapshot = await operationalSnapshot();
    assert.equal(dimensionState(snapshot.checks, 'WORKER'), 'OK');
    assert.equal(dimensionState(snapshot.checks, 'SCHEMA'), 'BLOCKED',
      'a running worker was allowed to speak for the build it is running');
  } finally {
    await resetDatabase();
  }
});

test('an empty queue with no worker is not reported as a healthy queue', async () => {
  const snapshot = await operationalSnapshot();
  assert.notEqual(dimensionState(snapshot.checks, 'WORKER'), 'OK');
});

test('a provider task nobody collected is visible on its own axis', async () => {
  await recordProviderTask({
    provider: 'dataforseo', providerNativeId: 'forgotten-task',
    fingerprint: 'market_mine::hvac:zip_zcta:32095:advertiser_first' });
  await query(
    `update provider_tasks set submitted_at = now() - interval '3 days'`);

  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'provider_tasks')!;
  assert.equal(check.state, 'BLOCKED');
  assert.match(check.detail ?? '', /paid for and have produced nothing/,
    'money spent for nothing was invisible on every other number');
});

test('a recent provider task is noted without being an emergency', async () => {
  await recordProviderTask({
    provider: 'dataforseo', providerNativeId: 'working-task',
    fingerprint: 'market_mine::hvac:zip_zcta:32095:advertiser_first' });

  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'provider_tasks')!;
  assert.equal(check.state, 'ATTENTION');
  assert.match(check.detail ?? '', /collected rather than submitted again/);
});

test('no saved markets says inventory does not maintain itself', async () => {
  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'markets')!;
  assert.equal(check.state, 'UNKNOWN');
  assert.match(check.detail ?? '', /only grows when somebody searches by hand/);
});

test('every enabled market blocked is a blocked dimension, not a quiet one', async () => {
  await query(
    `insert into saved_markets (name, geography_type, geography_definition, enabled, blocker_reason)
     values ('Blocked One', 'zip_zcta', '{"value":"32095"}'::jsonb, true, 'no provider'),
            ('Blocked Two', 'zip_zcta', '{"value":"32256"}'::jsonb, true, 'no provider')`);

  const snapshot = await operationalSnapshot();
  assert.equal(dimensionState(snapshot.checks, 'SAVED_MARKETS'), 'BLOCKED');
  const check = snapshot.checks.find((item) => item.id === 'markets')!;
  assert.match(check.detail ?? '', /None of them is being refreshed/);
});

test('a market backing off after failures is attention, not a blockage', async () => {
  await query(
    `insert into saved_markets (name, geography_type, geography_definition, enabled,
                                consecutive_failures)
     values ('Failing Market', 'zip_zcta', '{"value":"32095"}'::jsonb, true, 2)`);

  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'markets')!;
  assert.equal(check.state, 'ATTENTION');
  assert.match(check.detail ?? '', /still scheduled, just less often/);
});

// ------------------------------------------- the failure this machine showed us --

test('a heartbeating worker that takes no work never reads as a healthy worker', async () => {
  // The exact shape of the original: a process that exists, reporting in, doing
  // nothing, with work waiting.
  await recordHeartbeat({ processed: 10 });
  await recordWorkerDraining();
  await query(
    `insert into jobs (job_type, status, payload) values ('market_mine','QUEUED','{}'::jsonb)`);

  const snapshot = await operationalSnapshot();
  assert.equal(dimensionState(snapshot.checks, 'WORKER'), 'BLOCKED');

  const page = await healthPage();
  assert.ok(!/Worker: ok/i.test(page), 'the page said the worker was fine');
});

test('the page shows one answer per dimension, and the panel cannot say all is well', async () => {
  await query(
    `insert into jobs (job_type, status, payload) values ('market_mine','QUEUED','{}'::jsonb)`);

  const page = await healthPage();
  for (const label of ['Database', 'Schema', 'Worker', 'Queue', 'Discovery provider',
    'Provider tasks', 'Research', 'Saved markets', 'Spend']) {
    assert.ok(page.includes(label), `${label} is not on the page`);
  }
  assert.ok(!/Nothing needs attention/.test(page),
    'a queue with no worker was summarised as nothing needing attention');
});

test('the summary counts every state that needs a human', async () => {
  const snapshot = await operationalSnapshot();
  const needing = snapshot.checks.filter(
    (check) => check.state === 'ATTENTION' || check.state === 'BLOCKED').length;
  assert.equal(snapshot.counts.ATTENTION + snapshot.counts.BLOCKED, needing,
    'the summary and the rows disagree about how much is wrong');
});

test('an unset budget does not make a working provider look unavailable', async () => {
  // "Can we search" and "may we afford to" are different questions. Filing spend
  // under the provider axis made a configured, working provider read as not-OK
  // purely because no ceiling was set.
  registerDiscoveryAdapter({
    name: 'configured-two', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return { status: 'ZERO_RESULTS' as const, businesses: [], providerRows: 0,
        rejectedRows: 0, duplicateRows: 0 };
    },
  });

  const snapshot = await operationalSnapshot();
  assert.equal(dimensionState(snapshot.checks, 'DISCOVERY_PROVIDER'), 'OK');
  assert.equal(dimensionState(snapshot.checks, 'SPEND'), 'UNKNOWN',
    'and the absence of a spending limit is still said out loud, on its own axis');
});

test('a configured provider moves only its own dimension', async () => {
  registerDiscoveryAdapter({
    name: 'configured', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return { status: 'ZERO_RESULTS' as const, businesses: [], providerRows: 0,
        rejectedRows: 0, duplicateRows: 0 };
    },
  });

  const snapshot = await operationalSnapshot();
  assert.equal(dimensionState(snapshot.checks, 'DISCOVERY_PROVIDER'), 'OK');
  // And having a provider does not make the absence of a worker acceptable.
  assert.notEqual(dimensionState(snapshot.checks, 'WORKER'), 'OK');
});
