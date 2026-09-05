import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { resetDatabase } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  clearDiscoveryAdapters, registerDiscoveryAdapter, refusedDiscovery,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { resetBuildIdentity } from '../src/release/identity.js';
import { recordHeartbeat } from '../src/workers/runner.js';

/**
 * The morning after.
 * Authority: Issue #3 BP.
 *
 * The hero flow already proves a rep can find, claim and work a prospect. This is a
 * different question: Brent arrives at nine, the system has been running all night
 * without him, and the screen has to tell him what actually happened while he slept.
 *
 * Overnight there are only a few possible outcomes for a market, and they look
 * identical if the page is careless: businesses were found and nobody has looked
 * into them yet; the provider took the job and has not answered; the daily budget
 * ran out before the search; there is no provider at all. Every one of those used to
 * render as some version of "0 found", and a rep who reads that concludes the market
 * is empty and stops looking. They are four different sentences and four different
 * next actions -- research them, wait, raise the ceiling, add a credential -- and
 * this test is that each says its own.
 */

let app: FastifyInstance;
const PASSWORD = 'brent-morning-password';

before(async () => { app = await buildServer(); });
after(async () => {
  await app.close(); clearDiscoveryAdapters(); delete process.env['BUILD_SHA'];
  delete process.env['DISCOVERY_DAILY_BUDGET_USD']; resetBuildIdentity(); await pool.end();
});
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  delete process.env['DISCOVERY_DAILY_BUDGET_USD'];
});

async function brent(): Promise<string> {
  await createUser({
    email: 'brent@morning.invalid', displayName: 'Brent', role: 'SALES_REP',
    password: PASSWORD });
  const response = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: 'brent@morning.invalid', password: PASSWORD } });
  const cookie = response.cookies.find((item) => item.name === 'yad_sales_session')!;
  return `yad_sales_session=${cookie.value}`;
}

async function opsUser(): Promise<string> {
  const { userId } = { userId: await createUser({
    email: `ops${Date.now()}${Math.random()}@morning.invalid`, displayName: 'Night Ops',
    role: 'RESEARCH_OPS', password: PASSWORD }) };
  return userId;
}

/** A provider that found real companies overnight. */
function foundCompanies(): void {
  registerDiscoveryAdapter({
    name: 'overnight', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return {
        status: 'OK' as const,
        businesses: [
          { name: 'coastalair.invalid', website: 'https://coastalair.invalid',
            phone: '904-555-0701', city: null, state: null, postalCode: null,
            resultType: 'PAID_SEARCH_TEXT', advertisedService: 'ac repair',
            adHeadline: 'Same-Day AC Repair — 24/7', query: 'ac repair 32095',
            position: 1, landingUrl: 'https://coastalair.invalid/ac',
            observedAt: new Date('2026-09-05T04:12:00Z') },
          { name: 'matanzas.invalid', website: 'https://matanzas.invalid',
            phone: '904-555-0702', city: null, state: null, postalCode: null,
            resultType: 'ORGANIC', query: 'ac repair 32095', position: 4 },
        ],
        providerRows: 2, rejectedRows: 0, duplicateRows: 0, costUsd: 0.006,
      };
    },
  });
}

async function mine(zip: string, requestedBy: string): Promise<void> {
  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: zip,
    marketId: null, requestedBy });
  await drainQueue();
}

async function findPage(cookie: string, zip: string): Promise<string> {
  const response = await app.inject({
    method: 'GET', url: `/find?where=${zip}`, headers: { cookie } });
  assert.equal(response.statusCode, 200, `Find Prospects for ${zip}`);
  return response.body;
}

// ------------------------------------------- the four overnight outcomes --------

test('found overnight, researched by nobody: the page says so and offers research', async () => {
  const ops = await opsUser();
  foundCompanies();
  await mine('32095', ops);
  const cookie = await brent();

  const page = await findPage(cookie, '32095');
  assert.match(page, /none of them researched yet/,
    'a market discovered overnight and never researched did not say so');
  assert.doesNotMatch(page, /aged past its freshness window/,
    'the page told Brent that research had aged when no research has ever run');
  assert.doesNotMatch(page, /Treat advertising signals as historical/,
    'Brent was told to treat as historical the signals we have never looked for');
});

test('the provider has not answered yet: waiting is not an empty market', async () => {
  const ops = await opsUser();
  registerDiscoveryAdapter({
    name: 'slow', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return { ...refusedDiscovery('PENDING', 'accepted, not ready'),
        providerTaskId: 'overnight-task' };
    },
  });
  await mine('32086', ops);
  const cookie = await brent();

  const { rows } = await query<{ outcome: string; outcome_reason: string }>(
    `select outcome, outcome_reason from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.outcome, 'PROVIDER_PENDING');

  const page = await findPage(cookie, '32086');
  assert.doesNotMatch(page, /has no businesses/,
    'a search the provider has not finished was reported as a market with nobody in it');
});

test('the budget ran out before the search: the ceiling is named, not hidden', async () => {
  const ops = await opsUser();
  foundCompanies();
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.01';
  await query(
    `insert into provider_usage (provider, operation, requested_at, completed_at, units,
                                 estimated_cost_usd, actual_cost_usd, status)
     values ('overnight', 'serp.discover', now(), now(), 1, 0, 9.00, 'OK')`);
  await mine('32084', ops);

  const { rows } = await query<{ outcome: string; outcome_reason: string }>(
    `select outcome, outcome_reason from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.outcome, 'DISCOVERY_BLOCKED');
  assert.match(rows[0]!.outcome_reason, /daily provider budget/i);
  assert.match(rows[0]!.outcome_reason, /resets at midnight|DISCOVERY_DAILY_BUDGET_USD/,
    'the refusal does not tell an operator what to do about it');
  assert.doesNotMatch(rows[0]!.outcome_reason, /no businesses/i);
});

test('there is no provider at all: the page never implies the market was searched', async () => {
  const ops = await opsUser();
  await mine('32092', ops);
  const cookie = await brent();

  const page = await findPage(cookie, '32092');
  assert.doesNotMatch(page, /New ones will appear as they land/,
    'the page promised results from a search that could not happen');
  const { rows } = await query<{ outcome: string; outcome_reason: string }>(
    `select outcome, outcome_reason from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.outcome, 'DISCOVERY_BLOCKED');
  assert.match(rows[0]!.outcome_reason, /No search provider is configured/);
});

// ------------------------------------------------ what Brent can say on a call --

test('the company found overnight comes with the ad he can quote, and its date', async () => {
  const ops = await opsUser();
  foundCompanies();
  await mine('32095', ops);
  const cookie = await brent();

  const { rows } = await query<{ account_id: string }>(
    `select account_id from accounts where canonical_domain = 'coastalair.invalid'`);
  const response = await app.inject({
    method: 'GET', url: `/accounts/${rows[0]!.account_id}`, headers: { cookie } });
  assert.equal(response.statusCode, 200);

  assert.match(response.body, /How we found them/);
  assert.match(response.body, /Same-Day AC Repair/,
    'the one line Brent can open the call with is not on the page');
  assert.match(response.body, /Paid ad/);
  assert.match(response.body, /Do not claim/,
    'the page does not tell him what he must not say');
  // Seeing an ad is not knowing what it cost. The prohibition has to be on the page,
  // because "I see you're spending on Google" is the exact sentence a rep reaches for
  // when handed an ad headline.
  assert.match(response.body, /Do not state their ad spend/,
    'Brent was shown an ad and not told he cannot talk about what it costs');
});

test('nothing on the page asserts a signal nobody has observed', async () => {
  const ops = await opsUser();
  foundCompanies();
  await mine('32095', ops);
  const cookie = await brent();

  const { rows } = await query<{ account_id: string }>(
    `select account_id from accounts where canonical_domain = 'matanzas.invalid'`);
  const response = await app.inject({
    method: 'GET', url: `/accounts/${rows[0]!.account_id}`, headers: { cookie } });

  // Found by an organic result: we know they exist and that they rank. We have not
  // observed them advertising, and the page must not imply we have.
  assert.match(response.body, /No research evidence recorded yet/,
    'a company nobody has researched showed signals');
  assert.match(response.body, /Organic result/);
  assert.doesNotMatch(response.body, /Paid ad/,
    'an organic result was presented to Brent as an advertiser');
});

// -------------------------------------------------- what the operator sees ------

test('the operations page accounts for the night: work done, money spent, build', async () => {
  const ops = await opsUser();
  process.env['BUILD_SHA'] = 'night01';
  resetBuildIdentity();
  foundCompanies();
  await mine('32095', ops);
  await recordHeartbeat();

  await createUser({
    email: 'nightmanager@morning.invalid', displayName: 'Night Manager',
    role: 'SALES_MANAGER', password: PASSWORD });
  const login = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: 'nightmanager@morning.invalid', password: PASSWORD } });
  const cookie = `yad_sales_session=${login.cookies.find((c) => c.name === 'yad_sales_session')!.value}`;

  const response = await app.inject({
    method: 'GET', url: '/research-health', headers: { cookie } });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /night01/, 'the page does not say which build ran overnight');
});

test('a market Brent refreshes himself does not re-buy a search already paid for', async () => {
  // The overnight run left a task outstanding. His first click of Refresh must
  // collect it rather than submit a second paid search of the same market.
  const ops = await opsUser();
  let submissions = 0;
  let collections = 0;
  registerDiscoveryAdapter({
    name: 'outstanding', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      submissions += 1;
      return { ...refusedDiscovery('PENDING', 'accepted overnight'),
        providerTaskId: 'night-task-1' };
    },
    async collect() {
      collections += 1;
      return { status: 'OK' as const,
        businesses: [{ name: 'morning.invalid', website: 'https://morning.invalid',
          phone: '904-555-0710', city: null, state: null, postalCode: null }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, providerTaskId: 'night-task-1' };
    },
  });

  await mine('32080', ops);
  assert.equal(submissions, 1);

  await mine('32080', ops);
  assert.equal(submissions, 1, 'the same market was bought twice');
  assert.equal(collections, 1, 'the task paid for overnight was never collected');

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from accounts where canonical_domain = 'morning.invalid'`);
  assert.equal(rows[0]!.n, 1);
});
