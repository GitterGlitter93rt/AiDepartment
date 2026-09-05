import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import { operationalSnapshot } from '../src/api/operations.js';
import { schemaState } from '../src/db/migrate.js';
import { parseOperatorDateTime, zoneOffsetAt } from '../src/domain/time.js';
import { resetDatabase } from './helpers.js';

/**
 * Starting, restarting, and knowing which build is talking to which database.
 * Authority: Issue #2 section A, and section F's timezone cases.
 *
 * The job-recovery half of section A is covered in workerRecovery.test.ts. What was
 * missing is everything around it: whether the running code and the schema agree,
 * whether a deliberate restart looks like an outage, and whether a time a rep typed
 * means the same thing on a UTC host as it does on this one.
 */

let app: FastifyInstance;
const PASSWORD = 'startup-recovery-password';
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

// --------------------------------------------- the build against the schema --

test('a database with every migration applied says so', async () => {
  const state = await schemaState();
  assert.deepEqual(state.pending, []);
  assert.deepEqual(state.changed, []);
  assert.deepEqual(state.unknown, []);
  assert.ok(state.applied > 30);

  const snapshot = await operationalSnapshot();
  const schema = snapshot.checks.find((check) => check.id === 'schema')!;
  assert.equal(schema.state, 'OK');
});

test('a migration this build has never run is named, not left to become a 500', async () => {
  await query(
    `delete from schema_migrations where filename = (
       select filename from schema_migrations order by filename desc limit 1)`);

  const state = await schemaState();
  assert.equal(state.pending.length, 1);

  const snapshot = await operationalSnapshot();
  const schema = snapshot.checks.find((check) => check.id === 'schema')!;
  assert.equal(schema.state, 'BLOCKED');
  assert.match(schema.detail ?? '', /npm run migrate/);
  assert.match(schema.detail ?? '', new RegExp(state.pending[0]!));

  // Put it back so the next test starts from a matching schema.
  await resetDatabase();
});

test('a migration edited after it was applied is a blocked state, not a warning', async () => {
  const { rows } = await query<{ filename: string; checksum: string }>(
    'select filename, checksum from schema_migrations order by filename limit 1');
  const original = rows[0]!;
  await query('update schema_migrations set checksum = $2 where filename = $1',
    [original.filename, 'not-what-the-file-hashes-to']);

  try {
    const state = await schemaState();
    assert.equal(state.changed.length, 1);

    const snapshot = await operationalSnapshot();
    const schema = snapshot.checks.find((check) => check.id === 'schema')!;
    assert.equal(schema.state, 'BLOCKED');
    assert.match(schema.detail ?? '', /no longer contains/);
  } finally {
    // Put the real checksum back by hand: the migration runner refuses to run at all
    // while a checksum disagrees, so resetDatabase cannot clean this one up.
    await query('update schema_migrations set checksum = $2 where filename = $1',
      [original.filename, original.checksum]);
  }
});

test('a database ahead of the running build says the code is the old part', async () => {
  await query(
    `insert into schema_migrations (filename, checksum) values ('999_from_the_future.sql', 'x')`);

  try {
    const state = await schemaState();
    assert.deepEqual(state.unknown, ['999_from_the_future.sql']);

    const snapshot = await operationalSnapshot();
    const schema = snapshot.checks.find((check) => check.id === 'schema')!;
    assert.equal(schema.state, 'ATTENTION');
    assert.match(schema.detail ?? '', /older than the schema/);
  } finally {
    await query(`delete from schema_migrations where filename = '999_from_the_future.sql'`);
  }
});

// ------------------------------------------------------ starting the process --

test('the API refuses to start without the environment it needs, and says which', () => {
  // config.ts loads .env from its own package root, so the case under test is a
  // deployment with neither the file nor the variables -- a fresh box, or a systemd
  // unit whose WorkingDirectory is wrong. The module is copied somewhere with no
  // .env beside it and run there.
  const sandbox = mkdtempSync(resolve(tmpdir(), 'yad-config-'));
  mkdirSync(resolve(sandbox, 'src'));
  copyFileSync(resolve(packageRoot, 'src/config.ts'), resolve(sandbox, 'src/config.ts'));

  const env = { ...process.env };
  delete env['DATABASE_URL'];
  delete env['SESSION_SECRET'];
  delete env['TEST_DB_CONFIGURED'];

  let message = '';
  try {
    execFileSync(process.execPath, ['--experimental-strip-types', 'src/config.ts'], {
      cwd: sandbox, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    });
  } catch (error) {
    message = String((error as { stderr?: Buffer }).stderr ?? '');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }

  assert.match(message, /DATABASE_URL/,
    'a missing variable must be named; "cannot read property of undefined" is not an answer');
  assert.match(message, /\.env\.example/, 'and it must say where to look');
});

test('a clean worker stop is not reported as an outage', async () => {
  const { recordHeartbeat, recordWorkerStopped } = await import('../src/workers/runner.js');
  await recordHeartbeat({ processed: 3 });

  const running = await operationalSnapshot();
  assert.equal(running.checks.find((c) => c.id === 'worker')!.state, 'OK');

  await recordWorkerStopped();

  const stopped = await operationalSnapshot();
  const worker = stopped.checks.find((c) => c.id === 'worker')!;
  assert.notEqual(worker.state, 'OK');
  assert.notEqual(worker.state, 'BLOCKED',
    'an empty queue with a deliberately stopped worker is not an emergency');
});

// ------------------------------------------------------------- what time is it --

test('the zone offset is read from the zone, not from the process', () => {
  // Eastern is UTC-5 in January and UTC-4 in July, wherever this test runs.
  assert.equal(zoneOffsetAt(new Date('2026-01-15T12:00:00Z'), 'America/New_York'), -5 * 3_600_000);
  assert.equal(zoneOffsetAt(new Date('2026-07-15T12:00:00Z'), 'America/New_York'), -4 * 3_600_000);
});

test('a time a rep typed means the same instant whatever host the API runs on', () => {
  // 2pm Eastern on a summer day is 18:00Z. It is 18:00Z on a UTC box too.
  const parsed = parseOperatorDateTime('2026-07-15T14:00', 'America/New_York');
  assert.equal(parsed!.toISOString(), '2026-07-15T18:00:00.000Z');

  // And in winter, when the offset is an hour different.
  const winter = parseOperatorDateTime('2026-01-15T14:00', 'America/New_York');
  assert.equal(winter!.toISOString(), '2026-01-15T19:00:00.000Z');
});

test('a wall clock is not read in UTC just because the server is', () => {
  // This is the defect: new Date('2026-07-15T14:00') on a UTC host is 14:00Z, which
  // is 10am Eastern -- four hours before the prospect asked to be called.
  const naive = new Date('2026-07-15T14:00Z');
  const correct = parseOperatorDateTime('2026-07-15T14:00', 'America/New_York')!;
  assert.equal(correct.getTime() - naive.getTime(), 4 * 3_600_000);
});

test('the two awkward days of the year resolve deliberately', () => {
  // Spring forward 2026: 2am EST becomes 3am EDT, so 2:30am does not exist.
  const gap = parseOperatorDateTime('2026-03-08T02:30', 'America/New_York')!;
  assert.equal(gap.toISOString(), '2026-03-08T07:30:00.000Z',
    'a time that does not exist becomes the same wall clock after the jump');

  // Fall back 2026: 1:30am happens twice. The earlier one wins.
  const repeat = parseOperatorDateTime('2026-11-01T01:30', 'America/New_York')!;
  assert.equal(repeat.toISOString(), '2026-11-01T05:30:00.000Z',
    'calling early is the failure that matters, so the first occurrence wins');
});

test('a value that already says which instant it means is left alone', () => {
  const withZ = parseOperatorDateTime('2026-07-15T18:00:00Z', 'America/New_York')!;
  assert.equal(withZ.toISOString(), '2026-07-15T18:00:00.000Z');

  const withOffset = parseOperatorDateTime('2026-07-15T14:00:00-04:00', 'America/New_York')!;
  assert.equal(withOffset.toISOString(), '2026-07-15T18:00:00.000Z');
});

test('an unreadable time is refused rather than stored as an invalid date', () => {
  for (const value of ['', '  ', 'tomorrow', '2026-13-45T99:99', 'null', '15/07/2026 2pm']) {
    assert.equal(parseOperatorDateTime(value, 'America/New_York'), null, value);
  }
});

test('a callback saved from the portal lands at the hour the rep typed', async () => {
  const repUserId = await createUser({
    email: 'clock@test.local', displayName: 'Clock', role: 'SALES_REP', password: PASSWORD });
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Clock Co', website: 'https://clock.example.com',
      phone: '904-555-0221', city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'test' }));
  await claimAccount(accountId, { userId: repUserId, role: 'SALES_REP', activeClaimTarget: null }, null);

  const login = await app.inject({
    method: 'POST', url: '/login', payload: { email: 'clock@test.local', password: PASSWORD } });
  const cookie = `yad_sales_session=${login.cookies.find((c) => c.name === 'yad_sales_session')!.value}`;

  await app.inject({
    method: 'POST', url: `/accounts/${accountId}/disposition`, headers: { cookie },
    payload: {
      disposition: 'CALLBACK_REQUESTED',
      notes: 'Asked for two in the afternoon',
      callbackDueAt: '2026-07-15T14:00',
    },
  });

  const { rows } = await query<{ due_at: Date }>(
    'select due_at from follow_ups where account_id = $1', [accountId]);
  assert.equal(rows.length, 1, 'the callback was recorded');
  assert.equal(rows[0]!.due_at.toISOString(), '2026-07-15T18:00:00.000Z',
    'two in the afternoon Eastern, not two in the afternoon wherever the server is');
});

test('a callback with no time is still refused', async () => {
  const repUserId = await createUser({
    email: 'notime@test.local', displayName: 'No Time', role: 'SALES_REP', password: PASSWORD });
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'No Time Co', website: 'https://notime.example.com',
      phone: '904-555-0223', city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'test' }));
  const rep = { userId: repUserId, role: 'SALES_REP' as const, activeClaimTarget: null };
  await claimAccount(accountId, rep, null);

  const result = await recordDisposition({
    accountId, disposition: 'CALLBACK_REQUESTED', notes: 'They said call back',
    callbackDueAt: null, prospectRequested: true, channel: 'phone',
  }, rep);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CALLBACK_TIME_REQUIRED');
});
