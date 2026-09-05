import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { buildIdentity, resetBuildIdentity } from '../src/release/identity.js';
import { recordHeartbeat } from '../src/workers/runner.js';
import { operationalSnapshot } from '../src/api/operations.js';

/**
 * Which build is serving this queue.
 * Authority: Issue #3 — release/build identity.
 *
 * The API and the worker are separate processes, restarted separately, so a deploy
 * that misses one leaves two builds against one database. Every symptom of that
 * shows up somewhere other than the cause: a job type nothing can run, a column one
 * process writes and the other never reads, a page that works from one and not the
 * other. The runner's own "no handler" message already blames "a worker running an
 * older build than the queue it is serving" -- which was a guess. This makes it a
 * fact somebody can check.
 */

before(async () => { await resetDatabase(); });
after(async () => { delete process.env['BUILD_SHA']; resetBuildIdentity(); await pool.end(); });
beforeEach(async () => { await resetDatabase(); resetBuildIdentity(); });

test('a build says which commit it is and which schema it expects', () => {
  process.env['BUILD_SHA'] = 'deadbee';
  resetBuildIdentity();
  const identity = buildIdentity();
  assert.equal(identity.sha, 'deadbee');
  assert.ok(identity.migrationsExpected > 0,
    'this build claims to ship no migrations, so a schema check has nothing to compare');
});

test('a box with no build id degrades to unknown rather than refusing to start', () => {
  delete process.env['BUILD_SHA'];
  resetBuildIdentity();
  const identity = buildIdentity();
  // A checkout answers from git; a stripped container answers 'unknown'. Either is
  // fine, and neither may throw -- a missing build id must not stop a worker.
  assert.ok(identity.sha.length > 0);
});

test('the worker records its build on every heartbeat', async () => {
  process.env['BUILD_SHA'] = 'aaaaaaa';
  resetBuildIdentity();
  await recordHeartbeat();

  const { rows } = await query<{ build_sha: string; migrations_expected: number }>(
    'select build_sha, migrations_expected from worker_instances');
  assert.equal(rows[0]!.build_sha, 'aaaaaaa');
  assert.ok(rows[0]!.migrations_expected > 0);
});

test('a worker on a different build than the API is visible, not inferred', async () => {
  process.env['BUILD_SHA'] = 'old0000';
  resetBuildIdentity();
  await recordHeartbeat();

  // The API is now the new build; the worker heartbeat still carries the old one.
  process.env['BUILD_SHA'] = 'new1111';
  resetBuildIdentity();

  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'build_identity')!;
  assert.equal(check.dimension, 'WORKER');
  assert.equal(check.state, 'ATTENTION');
  assert.match(check.detail ?? '', /new1111/);
  assert.match(check.detail ?? '', /old0000/);
  assert.match(check.detail ?? '', /Restart whichever is behind/);
});

test('matching builds are reported as matching, not as a problem', async () => {
  process.env['BUILD_SHA'] = 'same222';
  resetBuildIdentity();
  await recordHeartbeat();

  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'build_identity')!;
  assert.equal(check.state, 'OK');
  assert.equal(check.value, 'same222');
});

test('no worker at all is stated as such, not as agreement', async () => {
  process.env['BUILD_SHA'] = 'lonely1';
  resetBuildIdentity();

  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'build_identity')!;
  assert.match(check.value, /no worker/);
  assert.match(check.detail ?? '', /nothing to compare/,
    'a page with no worker to compare against reported the builds as agreeing');
});

test('two workers on two builds is worse than one being behind, and says so', async () => {
  process.env['BUILD_SHA'] = 'first11';
  resetBuildIdentity();
  await recordHeartbeat();
  // A second worker, on a different build, heartbeating at the same time.
  await query(
    `insert into worker_instances (worker_id, hostname, pid, handlers, build_sha,
                                   migrations_expected)
     values ('other:1', 'other-host', 999, '{market_mine}', 'second2', 41)`);

  const snapshot = await operationalSnapshot();
  const check = snapshot.checks.find((item) => item.id === 'build_identity')!;
  assert.equal(check.state, 'ATTENTION');
  assert.match(check.value, /2 builds serving/);
  assert.match(check.detail ?? '', /Whichever worker picks a job decides how it behaves/);
});
