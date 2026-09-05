import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { resetDatabase } from './helpers.js';

/**
 * Every mutation is server-authorized.
 * Authority: YAD-SALES-CRM-UI-DATA-ACTION-CONTRACT.md §5, §8;
 * yad-sales-crm-page-acceptance-matrix.v1.yaml common_acceptance
 * (`direct_api_bypass_cannot_defeat_permissions`).
 *
 * The browser is replaceable. This walks every mutating route in the service and
 * proves that a caller with no session, and a caller with the wrong role, are both
 * refused by the server — not by a missing button.
 *
 * A route added without a place in this table fails the last test in the file, so
 * the check cannot quietly fall behind the surface it covers.
 */

let app: FastifyInstance;
const PASSWORD = 'authorization-test-password';

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });

type MinimumRole = 'any_authenticated' | 'manager' | 'admin' | 'signature_only';

interface RouteUnderTest {
  method: 'POST';
  path: string;
  minimum: MinimumRole;
  payload?: Record<string, unknown>;
}

/** Every mutating route, with the least privilege that may reach it. */
const ROUTES: RouteUnderTest[] = [
  // Rep-reachable work, still owner-checked inside the handler.
  { method: 'POST', path: '/accounts/ACCOUNT/book', minimum: 'any_authenticated' },
  { method: 'POST', path: '/accounts/ACCOUNT/contact-research', minimum: 'any_authenticated' },
  { method: 'POST', path: '/accounts/ACCOUNT/disposition', minimum: 'any_authenticated' },
  { method: 'POST', path: '/accounts/ACCOUNT/opportunity', minimum: 'any_authenticated' },
  { method: 'POST', path: '/accounts/ACCOUNT/release', minimum: 'any_authenticated' },
  // Merging moves another rep's work into somebody else's book.
  { method: 'POST', path: '/accounts/ACCOUNT/merge', minimum: 'manager' },
  { method: 'POST', path: '/follow-ups/00000000-0000-0000-0000-000000000000/complete',
    minimum: 'any_authenticated' },
  { method: 'POST', path: '/opportunities/00000000-0000-0000-0000-000000000000/transition',
    minimum: 'any_authenticated' },
  { method: 'POST', path: '/meetings/00000000-0000-0000-0000-000000000000/outcome',
    minimum: 'any_authenticated' },
  { method: 'POST', path: '/api/accounts/ACCOUNT/claim', minimum: 'any_authenticated' },
  { method: 'POST', path: '/api/accounts/ACCOUNT/release', minimum: 'any_authenticated' },
  { method: 'POST', path: '/api/accounts/ACCOUNT/notes', minimum: 'any_authenticated' },
  { method: 'POST', path: '/api/accounts/ACCOUNT/contact-research', minimum: 'any_authenticated' },
  { method: 'POST', path: '/api/accounts/ACCOUNT/activities/disposition', minimum: 'any_authenticated' },
  { method: 'POST', path: '/api/accounts/ACCOUNT/start-call', minimum: 'any_authenticated' },
  { method: 'POST', path: '/api/accounts/claim-batch', minimum: 'any_authenticated' },
  { method: 'POST', path: '/api/prospects/search', minimum: 'any_authenticated' },
  { method: 'POST', path: '/api/bookings/00000000-0000-0000-0000-000000000000/cancel',
    minimum: 'any_authenticated' },
  { method: 'POST', path: '/api/bookings/00000000-0000-0000-0000-000000000000/reschedule',
    minimum: 'any_authenticated' },

  // Manager and above.
  { method: 'POST', path: '/api/accounts/ACCOUNT/reassign', minimum: 'manager' },
  { method: 'POST', path: '/api/accounts/ACCOUNT/rescreen', minimum: 'manager' },
  { method: 'POST', path: '/api/mining/jobs', minimum: 'manager' },
  { method: 'POST', path: '/team/ACCOUNT/reassign', minimum: 'manager' },
  { method: 'POST', path: '/imports/upload', minimum: 'manager' },
  { method: 'POST', path: '/imports/00000000-0000-0000-0000-000000000000/map', minimum: 'manager' },
  { method: 'POST', path: '/imports/00000000-0000-0000-0000-000000000000/confirm', minimum: 'manager' },
  { method: 'POST', path: '/imports/00000000-0000-0000-0000-000000000000/cancel', minimum: 'manager' },
  { method: 'POST', path: '/ai/pilot/switch', minimum: 'manager',
    payload: { field: 'outbound_mode', value: 'OFF', reason: 'test' } },
  { method: 'POST', path: '/ai/pilot/stop', minimum: 'manager', payload: { reason: 'test' } },
  { method: 'POST', path: '/ai/pilot/candidates', minimum: 'manager' },
  { method: 'POST', path: '/ai/pilot/remove', minimum: 'manager' },
  { method: 'POST', path: '/ai/pilot/preflight', minimum: 'manager' },
  { method: 'POST', path: '/calls/00000000-0000-0000-0000-000000000000/review', minimum: 'manager' },

  // Administrator only.
  { method: 'POST', path: '/settings/integration', minimum: 'admin',
    payload: { key: 'calcom', enabled: 'true', reason: 'test' } },
  { method: 'POST', path: '/settings/test', minimum: 'admin', payload: { key: 'calcom' } },

  // Authenticated by provider signature rather than by session.
  { method: 'POST', path: '/api/webhooks/calcom', minimum: 'signature_only' },
  { method: 'POST', path: '/api/webhooks/smartlead', minimum: 'signature_only' },
];

interface Fixture { rep: string; manager: string; admin: string; accountId: string }

async function signIn(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/login', payload: { email, password: PASSWORD } });
  const cookie = response.cookies.find((c) => c.name === 'yad_sales_session');
  assert.ok(cookie, `sign-in for ${email}`);
  return `yad_sales_session=${cookie!.value}`;
}

async function fixture(): Promise<Fixture> {
  await createUser({ email: 'r@test.local', displayName: 'Rep', role: 'SALES_REP', password: PASSWORD });
  await createUser({ email: 'm@test.local', displayName: 'Manager', role: 'SALES_MANAGER', password: PASSWORD });
  await createUser({ email: 'ad@test.local', displayName: 'Admin', role: 'ADMIN', password: PASSWORD });
  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Authorization Fixture Co',
      website: 'https://authfixture.example.com',
      phone: '904-555-0177', city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'test' }));
  return {
    rep: await signIn('r@test.local'),
    manager: await signIn('m@test.local'),
    admin: await signIn('ad@test.local'),
    accountId,
  };
}

beforeEach(async () => { await resetDatabase(); });

/** A refusal is any of: redirect to sign-in, 401, or 403. Never a 2xx. */
function refused(statusCode: number, location: string | undefined): boolean {
  if (statusCode === 401 || statusCode === 403) return true;
  if (statusCode === 302 && location === '/login') return true;
  return false;
}

test('no mutating route accepts a caller with no session', async () => {
  const f = await fixture();
  const accepted: string[] = [];

  for (const route of ROUTES) {
    const url = route.path.replace('ACCOUNT', f.accountId);
    const response = await app.inject({
      method: route.method, url, payload: route.payload ?? {} });

    if (route.minimum === 'signature_only') {
      // A webhook has no session, so it must reject on the signature instead.
      assert.notEqual(response.statusCode, 200,
        `${url} accepted an unsigned webhook`);
      continue;
    }
    if (!refused(response.statusCode, response.headers.location as string | undefined)) {
      accepted.push(`${url} -> ${response.statusCode}`);
    }
  }

  assert.deepEqual(accepted, [], 'these routes served an anonymous caller');
});

test('no manager-or-admin route accepts an ordinary rep', async () => {
  const f = await fixture();
  const accepted: string[] = [];

  for (const route of ROUTES.filter((r) => r.minimum === 'manager' || r.minimum === 'admin')) {
    const url = route.path.replace('ACCOUNT', f.accountId);
    const response = await app.inject({
      method: route.method, url, headers: { cookie: f.rep }, payload: route.payload ?? {} });
    if (!refused(response.statusCode, response.headers.location as string | undefined)) {
      accepted.push(`${url} -> ${response.statusCode}`);
    }
  }

  assert.deepEqual(accepted, [], 'these routes served a rep who should not reach them');
});

test('no admin-only route accepts a manager', async () => {
  const f = await fixture();
  const accepted: string[] = [];

  for (const route of ROUTES.filter((r) => r.minimum === 'admin')) {
    const url = route.path.replace('ACCOUNT', f.accountId);
    const response = await app.inject({
      method: route.method, url, headers: { cookie: f.manager }, payload: route.payload ?? {} });
    if (!refused(response.statusCode, response.headers.location as string | undefined)) {
      accepted.push(`${url} -> ${response.statusCode}`);
    }
  }

  assert.deepEqual(accepted, [], 'these routes served a manager who should not reach them');
});

test('a forged role in the request body changes nothing', async () => {
  const f = await fixture();
  // The client claims to be an administrator. The server reads the session, not the body.
  const response = await app.inject({
    method: 'POST', url: '/settings/integration', headers: { cookie: f.rep },
    payload: { key: 'calcom', enabled: 'true', reason: 'test', role: 'ADMIN', userId: 'anything' },
  });
  assert.equal(response.statusCode, 403);

  const row = await pool.query(
    `select enabled from integration_settings where integration_key = 'calcom'`);
  assert.equal(row.rows[0]!.enabled, false, 'the refused write did not land');
});

test('the authorization table covers every mutating route in the service', async () => {
  const { readFileSync } = await import('node:fs');
  const declared = new Set(ROUTES.map((route) =>
    route.path.replace('ACCOUNT', ':id')
      .replace('00000000-0000-0000-0000-000000000000', ':id')));

  const found = new Set<string>();
  for (const file of ['src/api/portal.ts', 'src/api/routes.ts']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(
      /app\.(?:post|put|delete)(?:<[\s\S]{0,400}?>)?\(\s*\n?\s*'([^']+)'/g)) {
      found.add(match[1]!.replace(/:[A-Za-z]+/g, ':id'));
    }
  }

  const uncovered = [...found].filter((route) => !declared.has(route)).sort();
  assert.deepEqual(uncovered, [],
    'a mutating route exists with no authorization expectation declared for it');
});
