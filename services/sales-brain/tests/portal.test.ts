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
 * HTTP-level acceptance for the rep portal.
 * Authority: rep-portal-api-contract.v1.md §21-§22, rep-inventory-contract hard_fail_fixtures.
 *
 * These assert the server-authoritative behaviour: a client that lies about who it is,
 * or posts straight at an account id it does not own, must be refused by the server.
 */

let app: FastifyInstance;
const PASSWORD = 'portal-test-password';

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });

async function signIn(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/login', payload: { email, password: PASSWORD },
  });
  assert.equal(response.statusCode, 302, `sign-in for ${email} should redirect`);
  const cookie = response.cookies.find((c) => c.name === 'yad_sales_session');
  assert.ok(cookie, 'a session cookie must be set');
  return `yad_sales_session=${cookie!.value}`;
}

interface Fixture {
  repA: string; repB: string; manager: string;
  repAId: string; repBId: string;
  accountId: string;
}

async function fixture(): Promise<Fixture> {
  const repAId = await createUser({
    email: 'a@test.local', displayName: 'Rep A', role: 'SALES_REP', password: PASSWORD,
  });
  const repBId = await createUser({
    email: 'b@test.local', displayName: 'Rep B', role: 'SALES_REP', password: PASSWORD,
  });
  await createUser({
    email: 'm@test.local', displayName: 'Manager', role: 'SALES_MANAGER', password: PASSWORD,
  });

  const { accountId } = await withTransaction((client) =>
    upsertAccount(
      client,
      {
        canonicalName: 'Northgate Air & Heating',
        website: 'https://northgate.example.com',
        phone: '904-555-0101',
        city: 'Jacksonville', state: 'FL', postalCode: '32256',
      },
      { discoverySource: 'test' },
    ),
  );
  await pool.query(
    `update accounts set manual_tier = 'A', manual_score = 13, last_researched_at = now()
      where account_id = $1`,
    [accountId],
  );

  return {
    repA: await signIn('a@test.local'),
    repB: await signIn('b@test.local'),
    manager: await signIn('m@test.local'),
    repAId, repBId, accountId,
  };
}

beforeEach(async () => { await resetDatabase(); });

test('every data surface refuses an anonymous caller', async () => {
  await fixture();
  for (const url of ['/', '/find', '/my-prospects', '/markets', '/follow-ups', '/team']) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 302, `${url} should redirect anonymous users`);
    assert.equal(response.headers.location, '/login');
  }
  for (const url of ['/api/me', '/api/markets']) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 401, `${url} should 401 anonymous callers`);
  }
  const claim = await app.inject({
    method: 'POST', url: '/api/accounts/00000000-0000-0000-0000-000000000000/claim', payload: {},
  });
  assert.equal(claim.statusCode, 401);
});

test('sign-in does not reveal whether an email exists', async () => {
  await fixture();
  const unknown = await app.inject({
    method: 'POST', url: '/login', payload: { email: 'nobody@test.local', password: 'whatever' },
  });
  const wrongPassword = await app.inject({
    method: 'POST', url: '/login', payload: { email: 'a@test.local', password: 'wrong' },
  });
  assert.equal(unknown.statusCode, 401);
  assert.equal(wrongPassword.statusCode, 401);

  // The form legitimately echoes back whatever address was typed, so compare the
  // part that could leak: the error message itself must be byte-identical.
  const errorOf = (body: string): string =>
    body.match(/<div class="form-error">([^<]*)<\/div>/)?.[1] ?? '';
  assert.ok(errorOf(unknown.body).length > 0, 'an error is shown');
  assert.equal(errorOf(unknown.body), errorOf(wrongPassword.body),
    'an unknown address and a wrong password must produce the same message');

  // And a disabled account must not be distinguishable either.
  await pool.query(`update users set is_active = false where email_normalized = 'b@test.local'`);
  const disabled = await app.inject({
    method: 'POST', url: '/login', payload: { email: 'b@test.local', password: PASSWORD },
  });
  assert.equal(disabled.statusCode, 401);
  assert.equal(errorOf(disabled.body), errorOf(wrongPassword.body));
});

test('a revoked session stops working immediately', async () => {
  const { repA } = await fixture();
  assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: repA } })).statusCode, 200);
  await app.inject({ method: 'POST', url: '/logout', headers: { cookie: repA } });
  assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: repA } })).statusCode, 401);
});

test('HTTP claim race leaves one owner and tells the loser who won', async () => {
  const { repA, repB, accountId } = await fixture();
  const [first, second] = await Promise.all([
    app.inject({ method: 'POST', url: `/api/accounts/${accountId}/claim`, headers: { cookie: repA }, payload: {} }),
    app.inject({ method: 'POST', url: `/api/accounts/${accountId}/claim`, headers: { cookie: repB }, payload: {} }),
  ]);
  const bodies = [first.json(), second.json()];
  const winners = bodies.filter((body: any) => body.ok);
  const losers = bodies.filter((body: any) => !body.ok);

  assert.equal(winners.length, 1);
  assert.equal(losers[0].reason, 'ALREADY_CLAIMED');
  assert.ok(losers[0].ownerDisplayName, 'the losing rep is told who owns it');

  const { rows } = await pool.query(
    `select count(*)::int as n from ownership_events
      where account_id = $1 and event_type = 'CLAIMED'`, [accountId],
  );
  assert.equal(rows[0].n, 1);
});

test('a rep cannot work an account they do not own by posting at the id', async () => {
  const { repA, repB, accountId } = await fixture();
  await app.inject({ method: 'POST', url: `/api/accounts/${accountId}/claim`, headers: { cookie: repB }, payload: {} });

  const disposition = await app.inject({
    method: 'POST', url: `/api/accounts/${accountId}/activities/disposition`,
    headers: { cookie: repA },
    payload: { disposition: 'DECISION_MAKER_REACHED', notes: 'bypass attempt' },
  });
  assert.equal(disposition.statusCode, 403);
  assert.equal(disposition.json().reason, 'NOT_OWNER');

  const release = await app.inject({
    method: 'POST', url: `/api/accounts/${accountId}/release`, headers: { cookie: repA }, payload: {},
  });
  assert.equal(release.json().reason, 'NOT_OWNER');

  const { rows } = await pool.query(
    `select count(*)::int as n from activities where account_id = $1 and disposition is not null`,
    [accountId],
  );
  assert.equal(rows[0].n, 0, 'no activity was written by the non-owner');
});

test('reassign and the team view are manager-only', async () => {
  const { repA, manager, repAId, accountId } = await fixture();

  const repAttempt = await app.inject({
    method: 'POST', url: `/api/accounts/${accountId}/reassign`, headers: { cookie: repA },
    payload: { newOwnerUserId: repAId, reason: 'mine now' },
  });
  assert.equal(repAttempt.statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/team', headers: { cookie: repA } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/team', headers: { cookie: manager } })).statusCode, 200);

  const managerAttempt = await app.inject({
    method: 'POST', url: `/api/accounts/${accountId}/reassign`, headers: { cookie: manager },
    payload: { newOwnerUserId: repAId, reason: 'Territory change' },
  });
  assert.equal(managerAttempt.json().ok, true);

  // A reassign without a reason is refused: the audit trail must stay meaningful.
  const noReason = await app.inject({
    method: 'POST', url: `/api/accounts/${accountId}/reassign`, headers: { cookie: manager },
    payload: { newOwnerUserId: repAId },
  });
  assert.equal(noReason.statusCode, 400);
});

test('DNC removes the account from inventory for everyone', async () => {
  const { repA, repB, accountId } = await fixture();
  await app.inject({ method: 'POST', url: `/api/accounts/${accountId}/claim`, headers: { cookie: repA }, payload: {} });
  await app.inject({
    method: 'POST', url: `/api/accounts/${accountId}/activities/disposition`, headers: { cookie: repA },
    payload: { disposition: 'DO_NOT_CONTACT', notes: 'Asked to be removed' },
  });

  const search = await app.inject({
    method: 'POST', url: '/api/prospects/search', headers: { cookie: repB },
    payload: { ownership: 'UNCLAIMED' },
  });
  assert.equal(search.json().total, 0, 'a suppressed account is not claimable inventory');

  const claim = await app.inject({
    method: 'POST', url: `/api/accounts/${accountId}/claim`, headers: { cookie: repB }, payload: {},
  });
  assert.equal(claim.json().reason, 'SUPPRESSED');

  // A rep may add DNC but must never be able to lift it.
  const { rows } = await pool.query(
    `select is_active from suppressions where account_id = $1`, [accountId],
  );
  assert.equal(rows[0].is_active, true);
});

test('the Find page renders results and never leaks another rep a claim button', async () => {
  const { repA, repB, accountId } = await fixture();
  await app.inject({ method: 'POST', url: `/api/accounts/${accountId}/claim`, headers: { cookie: repB }, payload: {} });

  const page = await app.inject({
    method: 'GET', url: '/find?vertical=&where=32256&ownership=ANY_VISIBLE', headers: { cookie: repA },
  });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Northgate Air/, 'the company is visible to other reps');
  assert.match(page.body, /Owned by Rep B/, 'ownership is shown');
  assert.doesNotMatch(
    page.body, new RegExp(`js-claim" data-account="${accountId}"`),
    'no claim affordance is rendered for an account owned by someone else',
  );
});

test('search filters do not accept an injected sort key', async () => {
  const { repA } = await fixture();
  const response = await app.inject({
    method: 'POST', url: '/api/prospects/search', headers: { cookie: repA },
    payload: { ownership: 'UNCLAIMED', sort: 'company_name; drop table accounts' },
  });
  assert.equal(response.statusCode, 200, 'an unknown sort falls back rather than reaching SQL');
  const { rows } = await pool.query('select count(*)::int as n from accounts');
  assert.equal(rows[0].n, 1, 'the accounts table is intact');
});

test('a bulk claim reports per-account results rather than failing wholesale', async () => {
  const { repA, repB, accountId } = await fixture();
  const others: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const { accountId: id } = await withTransaction((client) =>
      upsertAccount(
        client,
        { canonicalName: `Riverbend ${i}`, website: `https://r${i}.example.com`, phone: `904-555-02${10 + i}` },
        { discoverySource: 'test' },
      ),
    );
    others.push(id);
  }
  await app.inject({ method: 'POST', url: `/api/accounts/${accountId}/claim`, headers: { cookie: repB }, payload: {} });

  const response = await app.inject({
    method: 'POST', url: '/api/accounts/claim-batch', headers: { cookie: repA },
    payload: { accountIds: [accountId, ...others] },
  });
  const body = response.json();
  assert.equal(body.requested, 4);
  assert.equal(body.claimed, 3);
  assert.equal(body.conflicts, 1);
});

test('the health endpoint exposes no data and confirms outbound dialling is off', async () => {
  const response = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.outboundDialEnabled, false);
  assert.equal(Object.keys(body).length, 3, 'health must not become a data endpoint');
});

test('security headers are set on every response', async () => {
  const { repA } = await fixture();
  const response = await app.inject({ method: 'GET', url: '/', headers: { cookie: repA } });
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.match(String(response.headers['x-robots-tag']), /noindex/);
  assert.match(String(response.headers['content-security-policy']), /frame-ancestors 'none'/);
  assert.doesNotMatch(response.body, /DATABASE_URL|SESSION_SECRET|password_hash/i);
});
