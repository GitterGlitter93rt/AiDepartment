import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { resetDatabase, markEntityVerified } from './helpers.js';

/**
 * What a real rep's session can actually do, proved at the HTTP boundary.
 *
 * Release 2 exists to make the portal trustworthy for one named person -- a
 * SALES_REP -- and a rep's limits cannot be a matter of which buttons the page
 * happens to render. A hidden button is a decision about markup; a permission is a
 * decision about the request. Only the second one survives somebody typing the URL,
 * replaying a form, or keeping a tab open after a role change.
 *
 * The line that matters most here is spending: a rep browses markets, and a rep does
 * not buy provider searches. `request_market_refresh` is deliberately absent from
 * REP_PERMISSIONS, and these assert the server enforces that rather than the page.
 */

let app: FastifyInstance;
const PASSWORD = 'rep-permissions-password-not-a-secret';
let rep: string;
let manager: string;
let accountId: string;

before(async () => { app = await buildServer(); await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await app.close(); await pool.end(); });

async function signIn(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST', url: '/login', payload: { email, password: PASSWORD } });
  const cookie = response.cookies.find((c) => c.name === 'yad_sales_session');
  assert.ok(cookie, `sign-in for ${email} failed`);
  return `yad_sales_session=${cookie!.value}`;
}

beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  await createUser({
    email: 'cameron@test.local', displayName: 'Cameron', role: 'SALES_REP', password: PASSWORD });
  await createUser({
    email: 'boss@test.local', displayName: 'Boss', role: 'SALES_MANAGER', password: PASSWORD });
  rep = await signIn('cameron@test.local');
  manager = await signIn('boss@test.local');

  const created = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Southern Air', website: 'https://southernair.example',
    phone: '407-555-0150', city: 'Orlando', state: 'FL', postalCode: '32801',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'market_miner:dataforseo' }));
  accountId = created.accountId;
  await markEntityVerified(accountId);
});

const PLAN_BODY = {
  verticalProfileId: 'hvac',
  geography: { type: 'zip_zcta', value: '32095', state: null },
  miningMode: 'advertiser_first',
};

test('a rep can browse markets', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/markets', headers: { cookie: rep } });
  assert.equal(response.statusCode, 200, 'a rep was refused the markets they work from');
});

test('a rep can open the Markets page', async () => {
  const response = await app.inject({ method: 'GET', url: '/markets', headers: { cookie: rep } });
  assert.equal(response.statusCode, 200);
});

test('a rep can search the inventory', async () => {
  const response = await app.inject({
    method: 'POST', url: '/api/prospects/search', headers: { cookie: rep },
    payload: { text: 'Southern' } });
  assert.equal(response.statusCode, 200, 'a rep could not search inventory');
});

test('a rep cannot price a paid provider search', async () => {
  // The refusal has to come from the server, whatever the page rendered.
  const response = await app.inject({
    method: 'POST', url: '/api/mining/plan', headers: { cookie: rep }, payload: PLAN_BODY });
  assert.equal(response.statusCode, 403,
    `a rep reached the paid planning endpoint (${response.statusCode})`);
});

test('a rep cannot submit paid provider searches', async () => {
  const response = await app.inject({
    method: 'POST', url: '/api/mining/jobs', headers: { cookie: rep },
    payload: { planId: '00000000-0000-4000-8000-000000000000', planHash: 'x' } });
  assert.equal(response.statusCode, 403,
    `a rep reached the paid submission endpoint (${response.statusCode})`);
});

test('the refusal is not a validation accident', async () => {
  // A malformed body would also be rejected, with 400. The rep must be stopped for
  // being a rep, before the body is ever considered -- otherwise the day somebody
  // sends a well-formed body, they are through.
  const bad = await app.inject({
    method: 'POST', url: '/api/mining/jobs', headers: { cookie: rep }, payload: {} });
  assert.equal(bad.statusCode, 403,
    'an empty body from a rep was answered as a bad request rather than a refusal');

  // And the same endpoint does admit somebody who is allowed to spend, so the test
  // above is not passing because the route is simply broken for everyone.
  const allowed = await app.inject({
    method: 'POST', url: '/api/mining/plan', headers: { cookie: manager }, payload: PLAN_BODY });
  assert.notEqual(allowed.statusCode, 403,
    'a manager was refused the planning endpoint, so the rep refusal proves nothing');
});

test('no session reaches nothing at all', async () => {
  const markets = await app.inject({ method: 'GET', url: '/api/markets' });
  assert.notEqual(markets.statusCode, 200, '/api/markets answered an unauthenticated request');
  const search = await app.inject({
    method: 'POST', url: '/api/prospects/search', payload: { text: 'Southern' } });
  assert.notEqual(search.statusCode, 200, 'search answered an unauthenticated request');
  const spend = await app.inject({ method: 'POST', url: '/api/mining/plan', payload: PLAN_BODY });
  assert.notEqual(spend.statusCode, 200, 'an unauthenticated request reached paid planning');
});

test('a rep spending nothing leaves no provider spend behind', async () => {
  await app.inject({
    method: 'POST', url: '/api/mining/plan', headers: { cookie: rep }, payload: PLAN_BODY });
  await app.inject({
    method: 'POST', url: '/api/mining/jobs', headers: { cookie: rep },
    payload: { planId: '00000000-0000-4000-8000-000000000000', planHash: 'x' } });

  // The refusal is only worth something if nothing was written on the way to it.
  const { rows: jobs } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'market_mine'`);
  assert.equal(jobs[0]!.n, 0, 'a refused rep still queued a paid market search');
  const { rows: tasks } = await query<{ n: number }>(
    'select count(*)::int as n from provider_tasks');
  assert.equal(tasks[0]!.n, 0, 'a refused rep still created a provider task');
});
