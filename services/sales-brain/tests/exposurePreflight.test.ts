import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase } from './helpers.js';
import { createUser } from '../src/domain/auth.js';
import { exposurePreflight, renderPreflight } from '../src/release/exposurePreflight.js';

/**
 * The list that has to be walked before this thing is reachable from the internet.
 * Authority: Issue #3 BO.
 *
 * Today the portal binds to loopback on the EdgeXpert and the only way in is the
 * console. Several settings that are perfectly safe under that assumption stop being
 * safe the moment a tunnel is put in front -- and that change is made in a
 * Cloudflare dashboard, by somebody who has no reason to be thinking about a session
 * cookie flag.
 */

const SAFE: NodeJS.ProcessEnv = {
  SESSION_COOKIE_SECURE: 'true',
  SESSION_SECRET: 'a'.repeat(48),
  SALES_PORTAL_BIND: '127.0.0.1',
  DATABASE_URL: 'postgres://user:pw@127.0.0.1:5432/yad_sales',
  OUTBOUND_DIAL_ENABLED: 'false',
};

before(async () => { await resetDatabase(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await createUser({ email: 'owner@youraidepartment.ai', displayName: 'Owner',
    role: 'ADMIN', password: 'preflight-owner-password' });
});

function check(report: Awaited<ReturnType<typeof exposurePreflight>>, id: string) {
  const found = report.checks.find((item) => item.id === id);
  assert.ok(found, `no check called ${id}`);
  return found!;
}

test('an insecure session cookie stops the exposure', async () => {
  const report = await exposurePreflight({ ...SAFE, SESSION_COOKIE_SECURE: 'false' });
  const cookie = check(report, 'session_cookie_secure');
  assert.equal(cookie.state, 'FAIL');
  assert.match(cookie.finding, /take a signed-in session/);
  assert.ok(cookie.remedy);
  assert.equal(report.safeToExpose, false);
});

test('a short or well-known session secret stops the exposure', async () => {
  for (const secret of ['', 'change-me', 'test-session-secret-value-only', 'short']) {
    const report = await exposurePreflight({ ...SAFE, SESSION_SECRET: secret });
    assert.equal(check(report, 'session_secret_strength').state, 'FAIL',
      `"${secret}" was accepted as a session secret`);
  }
});

test('binding to every interface is a failure whatever the proxy does', async () => {
  for (const bind of ['0.0.0.0', '::']) {
    const report = await exposurePreflight({ ...SAFE, SALES_PORTAL_BIND: bind });
    const bound = check(report, 'bind_address');
    assert.equal(bound.state, 'FAIL');
    assert.match(bound.finding, /local network/,
      'the finding does not say what binding everywhere actually exposes');
  }
});

test('a database somewhere else is unchecked, not assumed safe', async () => {
  const remote = await exposurePreflight({
    ...SAFE, DATABASE_URL: 'postgres://user:pw@db.example.com:5432/yad_sales' });
  const database = check(remote, 'database_not_public');
  assert.equal(database.state, 'UNCHECKED',
    'a database on another host was reported as safe by a process that cannot see it');
  assert.match(database.finding, /cannot be answered from inside/);

  const local = await exposurePreflight(SAFE);
  assert.equal(check(local, 'database_not_public').state, 'PASS');
});

test('exposing and arming the dialler are not the same decision', async () => {
  const report = await exposurePreflight({ ...SAFE, OUTBOUND_DIAL_ENABLED: 'true' });
  const dialling = check(report, 'outbound_dialling');
  assert.equal(dialling.state, 'FAIL');
  assert.match(dialling.finding, /two decisions/);
});

test('a demo login that still works stops the exposure', async () => {
  await createUser({ email: 'brent@demo.invalid', displayName: 'Demo Rep',
    role: 'SALES_REP', password: 'demo-password-known' });
  const report = await exposurePreflight(SAFE);
  const demo = check(report, 'no_demo_logins');
  assert.equal(demo.state, 'FAIL');
  assert.match(demo.finding, /brent@demo\.invalid/);
  assert.match(demo.finding, /known\s+passwords/);

  await query('update users set is_active = false where email = $1', ['brent@demo.invalid']);
  assert.equal(check(await exposurePreflight(SAFE), 'no_demo_logins').state, 'PASS');
});

test('nobody to lock it down again is a failure', async () => {
  await query(`update users set role = 'SALES_REP' where role = 'ADMIN'`);
  const report = await exposurePreflight(SAFE);
  assert.equal(check(report, 'accounts_exist').state, 'FAIL');
  assert.match(check(report, 'accounts_exist').finding, /lock the portal down/);
});

test('what it cannot see is listed as unchecked, never counted as a pass', async () => {
  const report = await exposurePreflight(SAFE);

  // Everything answerable from inside this process passes here. It must still refuse
  // to say the system is ready, because four of the checks are facts about the
  // machine and the proxy. A preflight that turns green on the checks it happens to
  // be able to run is how somebody opens a firewall on a partial answer.
  const failed = report.checks.filter((item) => item.state === 'FAIL');
  assert.deepEqual(failed, []);

  const unchecked = report.checks.filter((item) => item.state === 'UNCHECKED');
  assert.equal(unchecked.length, 4);
  assert.deepEqual(unchecked.map((item) => item.id).sort(),
    ['backups_restorable', 'firewall', 'proxy_auth', 'tls_termination']);

  assert.equal(report.safeToExpose, false,
    'the preflight said it was safe to expose while four things were unchecked');
  assert.match(report.summary, /have to be established by hand/);
  for (const item of unchecked) assert.ok(item.remedy, `${item.id} says nothing to do`);
});

test('the report reads as a list a person can act on', async () => {
  const rendered = renderPreflight(await exposurePreflight({
    ...SAFE, SESSION_COOKIE_SECURE: 'false' }));
  assert.match(rendered, /FAIL/);
  assert.match(rendered, /-> Set SESSION_COOKIE_SECURE=true/);
  assert.match(rendered, /\?\?/, 'the unchecked items are not visible in the output');
});

test('the current .env is measured rather than assumed', async () => {
  // Whatever this box actually holds. This does not assert the box is ready -- it is
  // not, and it should not be -- only that the preflight runs against real settings
  // rather than only against fixtures.
  const report = await exposurePreflight();
  assert.ok(report.checks.length >= 9);
  assert.equal(report.safeToExpose, false,
    'this machine reported itself ready to be exposed to the internet');
});
