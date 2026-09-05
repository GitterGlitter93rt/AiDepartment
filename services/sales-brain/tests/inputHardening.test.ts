import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { recordDisposition } from '../src/domain/activities.js';
import { resetDatabase } from './helpers.js';

/**
 * What the portal does with input it cannot read.
 * Authority: Issue #2 sections C and K.
 *
 * A stale bookmark, a crawler, or a typed URL sends ids that are not ids. Every one
 * of them used to reach PostgreSQL, which answered 'invalid input syntax for type
 * uuid: "abc"' -- and Fastify handed that sentence to the browser, along with a 500
 * that made a genuine outage impossible to see in the logs.
 *
 * The rule these tests hold: input the server cannot read produces a 4xx, in the
 * product's own words, and nothing about the database.
 */

let app: FastifyInstance;
const PASSWORD = 'input-hardening-password';

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

interface Fixture { rep: string; manager: string; repUserId: string; accountId: string }

async function signIn(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/login', payload: { email, password: PASSWORD } });
  const cookie = response.cookies.find((c) => c.name === 'yad_sales_session');
  assert.ok(cookie, `sign-in for ${email}`);
  return `yad_sales_session=${cookie!.value}`;
}

async function fixture(): Promise<Fixture> {
  const repUserId = await createUser({
    email: 'rep@test.local', displayName: 'Rep', role: 'SALES_REP', password: PASSWORD });
  await createUser({
    email: 'mgr@test.local', displayName: 'Manager', role: 'SALES_MANAGER', password: PASSWORD });
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Input Hardening Co',
      website: 'https://inputhardening.example.com',
      phone: '904-555-0193', city: 'Jacksonville', state: 'FL', postalCode: '32095',
    }, { discoverySource: 'test' }));
  return {
    rep: await signIn('rep@test.local'),
    manager: await signIn('mgr@test.local'),
    repUserId, accountId,
  };
}

/**
 * Phrases that only appear when a server error reaches the browser.
 *
 * Deliberately specific: the page legitimately echoes back what was typed, so a bare
 * 'uuid' would flag the input rather than a leak. 'type uuid' is the driver talking.
 */
const DATABASE_TELLS = [
  'invalid input syntax', 'type uuid', 'syntax error at or near',
  'violates check constraint', 'violates foreign key', 'does not exist\n',
  'at Object.', 'node_modules', 'Internal Server Error',
  '/home/', 'src/db/pool', 'stack',
];

function leaksInternals(body: string): string | null {
  const lower = body.toLowerCase();
  for (const tell of DATABASE_TELLS) {
    if (lower.includes(tell.toLowerCase())) return tell;
  }
  return null;
}

const MALFORMED = [
  'not-a-uuid',
  '1',
  "' or 1=1--",
  '../../etc/passwd',
  '%00',
  'null',
  'undefined',
  '00000000-0000-0000-0000-00000000000',
];

test('a malformed id on a page is a 404, not a database error', async () => {
  const f = await fixture();
  const paths = [
    '/accounts/ID', '/accounts/ID/panel', '/markets/ID', '/opportunities/ID',
    '/meetings/ID', '/imports/ID', '/team/ID', '/campaigns/ID', '/calls/ID',
  ];

  const bad: string[] = [];
  for (const template of paths) {
    for (const id of MALFORMED) {
      const url = template.replace('ID', encodeURIComponent(id));
      const response = await app.inject({
        method: 'GET', url, headers: { cookie: f.manager } });
      if (response.statusCode >= 500) bad.push(`${url} -> ${response.statusCode}`);
      const tell = leaksInternals(response.body);
      if (tell) bad.push(`${url} leaked "${tell}"`);
    }
  }
  assert.deepEqual(bad, []);
});

test('a malformed id on the JSON API is a 404 with a plain message', async () => {
  const f = await fixture();
  const routes: { method: 'GET' | 'POST'; path: string; payload?: unknown }[] = [
    { method: 'GET', path: '/api/accounts/ID' },
    { method: 'GET', path: '/api/bookings/ID/brief' },
    { method: 'POST', path: '/api/accounts/ID/claim' },
    { method: 'POST', path: '/api/accounts/ID/release' },
    { method: 'POST', path: '/api/accounts/ID/notes', payload: { note: 'hello' } },
    { method: 'POST', path: '/api/accounts/ID/contact-research' },
    { method: 'POST', path: '/api/bookings/ID/cancel', payload: { reason: 'because' } },
  ];

  const bad: string[] = [];
  for (const route of routes) {
    for (const id of MALFORMED) {
      const url = route.path.replace('ID', encodeURIComponent(id));
      const response = await app.inject({
        method: route.method, url, headers: { cookie: f.manager },
        payload: route.payload ?? {} });
      if (response.statusCode >= 500) bad.push(`${url} -> ${response.statusCode}`);
      const tell = leaksInternals(response.body);
      if (tell) bad.push(`${url} leaked "${tell}"`);
    }
  }
  assert.deepEqual(bad, []);
});

test('a filter id typed into the URL bar returns nothing rather than an error', async () => {
  const f = await fixture();
  // A market id is a uuid; a vertical profile is a slug, so any text is legal there
  // and an unknown one simply matches nothing.
  for (const value of MALFORMED) {
    for (const query of [`market=${encodeURIComponent(value)}`,
      `vertical=${encodeURIComponent(value)}&where=32095`]) {
      const response = await app.inject({
        method: 'GET', url: `/find?${query}`, headers: { cookie: f.rep } });
      assert.equal(response.statusCode, 200, `/find?${query}`);
      assert.equal(leaksInternals(response.body), null, `/find?${query}`);
      assert.ok(!response.body.includes('Input Hardening Co'),
        `an unreadable filter behaved as no filter at all: ${query}`);
    }
  }
});

test('a malformed market filter does not crash the coverage poll', async () => {
  const f = await fixture();
  const response = await app.inject({
    method: 'GET', url: '/api/coverage?market=not-a-uuid&where=32095',
    headers: { cookie: f.rep } });
  assert.equal(response.statusCode, 200);
  assert.equal(leaksInternals(response.body), null);
});

test('an unhandled failure tells the browser nothing about the server', async () => {
  const f = await fixture();
  // A number far outside bigint range reaches the driver as a numeric-value error.
  const response = await app.inject({
    method: 'GET', url: '/audit?limit=99999999999999999999999',
    headers: { cookie: f.manager } });
  assert.ok(response.statusCode < 500, `audit answered ${response.statusCode}`);
  assert.equal(leaksInternals(response.body), null);
});

// ------------------------------------------------------- numeric record ids --

test('a follow-up can actually be marked done from the portal', async () => {
  const f = await fixture();
  const rep = { userId: f.repUserId, role: 'SALES_REP' as const, activeClaimTarget: null };
  await claimAccount(f.accountId, rep, null);

  const disposition = await recordDisposition({
    accountId: f.accountId,
    disposition: 'CALLBACK_REQUESTED',
    notes: 'Asked me to try again Thursday morning',
    callbackDueAt: new Date(Date.now() + 86_400_000),
    prospectRequested: true,
    channel: 'phone',
  }, rep);
  assert.ok(disposition.ok, 'the callback was recorded');

  const { rows } = await pool.query<{ followup_id: string }>(
    'select followup_id from follow_ups where account_id = $1 and status = $2',
    [f.accountId, 'OPEN']);
  const followupId = rows[0]!.followup_id;
  // Follow-ups are keyed by bigserial. Guarding the route with the uuid check
  // refused every real id, so "Done" answered 404 for every follow-up there was.
  assert.ok(/^[0-9]+$/.test(String(followupId)), 'follow-up ids are numbers');

  const response = await app.inject({
    method: 'POST', url: `/follow-ups/${followupId}/complete`, headers: { cookie: f.rep } });
  assert.equal(response.statusCode, 302);

  const after = await pool.query<{ status: string }>(
    'select status from follow_ups where followup_id = $1', [followupId]);
  assert.equal(after.rows[0]!.status, 'COMPLETED');
});

test('a follow-up id that is not a number is still a 404', async () => {
  const f = await fixture();
  for (const id of ['not-a-number', '00000000-0000-0000-0000-000000000000', '1e9', '-1']) {
    const response = await app.inject({
      method: 'POST', url: `/follow-ups/${encodeURIComponent(id)}/complete`,
      headers: { cookie: f.rep } });
    assert.equal(response.statusCode, 404, id);
  }
});

test('completing another rep\'s follow-up says so instead of failing quietly', async () => {
  const f = await fixture();
  const otherUserId = await createUser({
    email: 'other@test.local', displayName: 'Other', role: 'SALES_REP', password: PASSWORD });
  const other = { userId: otherUserId, role: 'SALES_REP' as const, activeClaimTarget: null };
  await claimAccount(f.accountId, other, null);
  await recordDisposition({
    accountId: f.accountId, disposition: 'CALLBACK_REQUESTED',
    notes: 'Thursday morning', callbackDueAt: new Date(Date.now() + 86_400_000),
    prospectRequested: true, channel: 'phone',
  }, other);

  const { rows } = await pool.query<{ followup_id: string }>(
    'select followup_id from follow_ups where account_id = $1', [f.accountId]);

  const response = await app.inject({
    method: 'POST', url: `/follow-ups/${rows[0]!.followup_id}/complete`,
    headers: { cookie: f.rep } });
  assert.equal(response.statusCode, 302);
  const location = String(response.headers.location);
  assert.ok(location.includes('flash='), 'the rep is told what happened');
  assert.ok(decodeURIComponent(location).includes('another rep'));

  const after = await pool.query<{ status: string }>(
    'select status from follow_ups where followup_id = $1', [rows[0]!.followup_id]);
  assert.equal(after.rows[0]!.status, 'OPEN', 'and nothing was completed');
});
