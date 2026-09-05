import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { claimAccount } from '../src/domain/ownership.js';
import { createOpportunity } from '../src/domain/opportunities.js';
import { resetDatabase } from './helpers.js';

/**
 * Reading is an authorization decision too.
 * Authority: Issue #2 section B.
 *
 * The mutation matrix in authorization.test.ts proved no one can *change* what they
 * should not. It said nothing about reading, and reading is where the leaks were: a
 * meetings list that hid other reps' meetings alongside a meeting page that showed
 * any of them to anyone holding the id; an opportunity list scoped to the owner and
 * a detail page that was not; a prep brief -- the prospect's own words -- readable by
 * every signed-in account.
 *
 * The last test in the file walks the source for GET routes, so a page added without
 * a declared expectation fails here rather than shipping unguarded.
 */

let app: FastifyInstance;
const PASSWORD = 'read-authorization-password';

before(async () => { app = await buildServer(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => { await resetDatabase(); });

type MinimumRole = 'any_authenticated' | 'ops' | 'manager' | 'public';

interface ReadRoute {
  path: string;
  minimum: MinimumRole;
}

/**
 * Every GET route, with the least privilege that may reach it.
 *
 * `ops` means a manager, an administrator, or research operations. `manager` means a
 * manager or an administrator and excludes research operations.
 */
const READ_ROUTES: ReadRoute[] = [
  { path: '/', minimum: 'any_authenticated' },
  { path: '/find', minimum: 'any_authenticated' },
  { path: '/markets', minimum: 'any_authenticated' },
  { path: '/markets/:id', minimum: 'any_authenticated' },
  { path: '/my-prospects', minimum: 'public' },
  { path: '/prospects', minimum: 'any_authenticated' },
  { path: '/follow-ups', minimum: 'any_authenticated' },
  { path: '/accounts/:id', minimum: 'any_authenticated' },
  { path: '/accounts/:id/panel', minimum: 'any_authenticated' },
  { path: '/replies', minimum: 'any_authenticated' },
  { path: '/opportunities', minimum: 'any_authenticated' },
  { path: '/opportunities/:id', minimum: 'any_authenticated' },
  { path: '/meetings', minimum: 'any_authenticated' },
  { path: '/meetings/:id', minimum: 'any_authenticated' },
  { path: '/search', minimum: 'any_authenticated' },
  { path: '/api/me', minimum: 'any_authenticated' },
  { path: '/api/accounts/:id', minimum: 'any_authenticated' },
  { path: '/api/markets', minimum: 'any_authenticated' },
  { path: '/api/coverage', minimum: 'any_authenticated' },
  { path: '/api/booking/availability', minimum: 'any_authenticated' },
  { path: '/api/bookings/:id/brief', minimum: 'any_authenticated' },

  // Operations: managers, administrators and research operations.
  { path: '/mining', minimum: 'ops' },
  { path: '/research-health', minimum: 'ops' },
  { path: '/imports', minimum: 'ops' },
  { path: '/imports/:id', minimum: 'ops' },

  // Managers and administrators only. A rep never sees the team's book, the
  // outbound control plane, call recordings, the audit trail or the analytics.
  { path: '/team', minimum: 'manager' },
  { path: '/team/:id', minimum: 'manager' },
  { path: '/ai/pilot', minimum: 'manager' },
  { path: '/calls', minimum: 'manager' },
  { path: '/calls/:id', minimum: 'manager' },
  { path: '/campaigns', minimum: 'manager' },
  { path: '/campaigns/:id', minimum: 'manager' },
  { path: '/audit', minimum: 'manager' },
  { path: '/analytics', minimum: 'manager' },
  { path: '/settings', minimum: 'manager' },
];

const ANY_UUID = '00000000-0000-0000-0000-000000000000';

interface Fixture {
  rep: string; otherRep: string; ops: string; manager: string;
  repUserId: string; otherRepUserId: string;
  accountId: string;
}

async function signIn(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/login', payload: { email, password: PASSWORD } });
  const cookie = response.cookies.find((c) => c.name === 'yad_sales_session');
  assert.ok(cookie, `sign-in for ${email}`);
  return `yad_sales_session=${cookie!.value}`;
}

async function fixture(): Promise<Fixture> {
  const repUserId = await createUser({
    email: 'brent@test.local', displayName: 'Brent', role: 'SALES_REP', password: PASSWORD });
  const otherRepUserId = await createUser({
    email: 'dana@test.local', displayName: 'Dana', role: 'SALES_REP', password: PASSWORD });
  await createUser({
    email: 'ops@test.local', displayName: 'Ops', role: 'RESEARCH_OPS', password: PASSWORD });
  await createUser({
    email: 'boss@test.local', displayName: 'Boss', role: 'SALES_MANAGER', password: PASSWORD });

  const { accountId } = await withTransaction((client) =>
    upsertAccount(client, {
      canonicalName: 'Read Authorization Co',
      website: 'https://readauth.example.com',
      phone: '904-555-0181', city: 'Jacksonville', state: 'FL', postalCode: '32256',
    }, { discoverySource: 'test' }));

  return {
    rep: await signIn('brent@test.local'),
    otherRep: await signIn('dana@test.local'),
    ops: await signIn('ops@test.local'),
    manager: await signIn('boss@test.local'),
    repUserId, otherRepUserId, accountId,
  };
}

/** A refusal is any of: redirect to sign-in, 401, or 403. */
function refused(statusCode: number, location: string | undefined): boolean {
  if (statusCode === 401 || statusCode === 403) return true;
  if (statusCode === 302 && location === '/login') return true;
  return false;
}

function urlFor(route: ReadRoute, accountId: string): string {
  return route.path.replace(':id', route.path.startsWith('/accounts') ? accountId : ANY_UUID);
}

test('no page serves a caller with no session', async () => {
  const f = await fixture();
  const served: string[] = [];

  for (const route of READ_ROUTES) {
    if (route.minimum === 'public') continue;
    const url = urlFor(route, f.accountId);
    const response = await app.inject({ method: 'GET', url });
    if (!refused(response.statusCode, response.headers.location as string | undefined)) {
      served.push(`${url} -> ${response.statusCode}`);
    }
  }

  assert.deepEqual(served, [], 'these pages served an anonymous visitor');
});

test('a rep cannot read a manager page, whatever the URL says', async () => {
  const f = await fixture();
  const served: string[] = [];

  for (const route of READ_ROUTES.filter((r) => r.minimum === 'manager' || r.minimum === 'ops')) {
    const url = urlFor(route, f.accountId);
    const response = await app.inject({ method: 'GET', url, headers: { cookie: f.rep } });
    if (!refused(response.statusCode, response.headers.location as string | undefined)) {
      served.push(`${url} -> ${response.statusCode}`);
    }
  }

  assert.deepEqual(served, [], 'these pages served a rep who should not reach them');
});

test('research operations reaches the mining pages and not the sales control plane', async () => {
  const f = await fixture();
  const wrong: string[] = [];

  for (const route of READ_ROUTES.filter((r) => r.minimum === 'ops' || r.minimum === 'manager')) {
    const url = urlFor(route, f.accountId);
    const response = await app.inject({ method: 'GET', url, headers: { cookie: f.ops } });
    const wasRefused = refused(response.statusCode, response.headers.location as string | undefined);
    if (route.minimum === 'ops' && wasRefused) wrong.push(`${url} refused research ops`);
    if (route.minimum === 'manager' && !wasRefused) wrong.push(`${url} served research ops`);
  }

  assert.deepEqual(wrong, []);
});

test('the read table covers every GET route in the service', async () => {
  const { readFileSync } = await import('node:fs');
  const declared = new Set(READ_ROUTES.map((route) => route.path));

  const found = new Set<string>();
  for (const file of ['src/api/portal.ts', 'src/api/routes.ts']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(
      /app\.get(?:<[\s\S]{0,400}?>)?\(\s*\n?\s*'([^']+)'/g)) {
      found.add(match[1]!.replace(/:[A-Za-z]+/g, ':id'));
    }
  }

  const uncovered = [...found].filter((route) => !declared.has(route)).sort();
  assert.deepEqual(uncovered, [],
    'a page exists with no read-authorization expectation declared for it');
});

// --------------------------------------------------------- cross-rep leakage --

async function bookingFor(ownerUserId: string, accountId: string): Promise<string> {
  const { rows } = await pool.query<{ booking_id: string }>(
    `insert into meeting_bookings (account_id, owner_user_id, calendar_upn, requested_start,
                                   requested_end, status, meeting_type, source_channel,
                                   idempotency_key, provider_event_id, confirmed_at)
     values ($1,$2,'mike@yad.test', now() + interval '2 days', now() + interval '2 days 30 minutes',
             'CONFIRMED','strategy_call','portal', $3, 'provider-event-' || $3, now())
     returning booking_id`,
    [accountId, ownerUserId, `read-auth-${Date.now()}-${Math.random()}`],
  );
  return rows[0]!.booking_id;
}

test('a meeting page does not open another rep\'s meeting', async () => {
  const f = await fixture();
  const bookingId = await bookingFor(f.otherRepUserId, f.accountId);

  const mine = await app.inject({
    method: 'GET', url: `/meetings/${bookingId}`, headers: { cookie: f.otherRep } });
  assert.equal(mine.statusCode, 200, 'the owner can open their own meeting');

  const theirs = await app.inject({
    method: 'GET', url: `/meetings/${bookingId}`, headers: { cookie: f.rep } });
  assert.equal(theirs.statusCode, 404, 'another rep is told it does not exist');

  const boss = await app.inject({
    method: 'GET', url: `/meetings/${bookingId}`, headers: { cookie: f.manager } });
  assert.equal(boss.statusCode, 200, 'a manager sees the team\'s meetings');
});

test('the meetings list and the meeting page answer the same question', async () => {
  const f = await fixture();
  const bookingId = await bookingFor(f.otherRepUserId, f.accountId);

  const list = await app.inject({
    method: 'GET', url: '/meetings', headers: { cookie: f.rep } });
  assert.equal(list.statusCode, 200);
  assert.ok(!list.body.includes(bookingId),
    'the list already hid this meeting from the other rep');

  const detail = await app.inject({
    method: 'GET', url: `/meetings/${bookingId}`, headers: { cookie: f.rep } });
  assert.equal(detail.statusCode, 404,
    'so the page reached by guessing the URL must hide it too');
});

test('a prep brief is not readable by every signed-in account', async () => {
  const f = await fixture();
  const bookingId = await bookingFor(f.otherRepUserId, f.accountId);

  const theirs = await app.inject({
    method: 'GET', url: `/api/bookings/${bookingId}/brief`, headers: { cookie: f.rep } });
  assert.equal(theirs.statusCode, 404);
  assert.ok(!theirs.body.includes('Read Authorization Co'),
    'the refusal leaked the company name');

  const owner = await app.inject({
    method: 'GET', url: `/api/bookings/${bookingId}/brief`, headers: { cookie: f.otherRep } });
  assert.equal(owner.statusCode, 200, 'the owner still gets their brief');
});

test('a rep cannot cancel or move another rep\'s meeting', async () => {
  const f = await fixture();
  const bookingId = await bookingFor(f.otherRepUserId, f.accountId);

  const cancel = await app.inject({
    method: 'POST', url: `/api/bookings/${bookingId}/cancel`, headers: { cookie: f.rep },
    payload: { reason: 'I decided it should not happen' } });
  assert.equal(cancel.statusCode, 403);

  const reschedule = await app.inject({
    method: 'POST', url: `/api/bookings/${bookingId}/reschedule`, headers: { cookie: f.rep },
    payload: {
      start: new Date(Date.now() + 86_400_000).toISOString(),
      end: new Date(Date.now() + 86_400_000 + 1_800_000).toISOString(),
      reason: 'Moving somebody else\'s call',
    } });
  assert.equal(reschedule.statusCode, 403);

  const { rows } = await pool.query<{ status: string }>(
    'select status from meeting_bookings where booking_id = $1', [bookingId]);
  assert.equal(rows[0]!.status, 'CONFIRMED', 'the meeting is untouched');
});

test('an opportunity page does not open another rep\'s deal', async () => {
  const f = await fixture();
  const owner = { userId: f.otherRepUserId, role: 'SALES_REP' as const };
  await claimAccount(f.accountId, { ...owner, activeClaimTarget: null }, null);
  await pool.query(
    `insert into prospect_statements (account_id, statement_text, category, source_class)
     values ($1, 'We are turning away work because nobody answers the phone at night',
             'PROBLEM', 'prospect_verified')`,
    [f.accountId]);
  const created = await createOpportunity({
    accountId: f.accountId,
    problemSummary: 'They are turning away after-hours calls because nobody answers the phone',
    sourceChannel: 'portal',
  }, owner);
  assert.ok(created.ok, created.message);

  const theirs = await app.inject({
    method: 'GET', url: `/opportunities/${created.opportunityId}`, headers: { cookie: f.rep } });
  assert.equal(theirs.statusCode, 404);
  assert.ok(!theirs.body.includes('turning away'),
    'the prospect\'s own words leaked to a rep who does not own the deal');

  const mine = await app.inject({
    method: 'GET', url: `/opportunities/${created.opportunityId}`, headers: { cookie: f.otherRep } });
  assert.equal(mine.statusCode, 200);

  const boss = await app.inject({
    method: 'GET', url: `/opportunities/${created.opportunityId}`, headers: { cookie: f.manager } });
  assert.equal(boss.statusCode, 200, 'a manager still sees the pipeline');
});
