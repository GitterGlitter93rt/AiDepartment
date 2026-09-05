import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { coverageFor, discoveryCoverageFor, DISCOVERY_STALE_AFTER_DAYS } from '../src/domain/search.js';
import { clearDiscoveryAdapters, registerDiscoveryAdapter } from '../src/workers/marketMiner.js';
import { resetDatabase } from './helpers.js';

/**
 * "No rows" meant eleven different things.
 * Authority: Issue #3 Phase L, Issue #2 section C.
 *
 * A rep types HVAC and 32095 and sees an empty page. That page was the same page
 * whether nobody had ever searched, a search was running, a search could not run, a
 * provider could not answer, a provider was still working, a search half-worked, a
 * search genuinely found nothing, or a search found only companies we already hold.
 * None of those lead to the same next action.
 */

let app: FastifyInstance;
const PASSWORD = 'find-truth-password';
let sequence = 0;

before(async () => { app = await buildServer(); await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
});

async function seedAccount(name: string): Promise<string> {
  sequence += 1;
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: name,
    website: `https://findtruth${sequence}.invalid`,
    phone: `904-555-${String(8000 + sequence).slice(-4)}`,
    city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'market_miner:dataforseo' }));
  return accountId;
}

/** A finished market_mine job exactly as the worker leaves one. */
async function completedJob(input: {
  outcome: string; reason?: string; providerRows?: number;
  matchedExisting?: number; discoveredNew?: number; ageDays?: number;
  status?: string;
}): Promise<void> {
  await query(
    `insert into jobs (job_type, status, payload, outcome, outcome_reason, progress,
                       completed_at)
     values ('market_mine', $1,
             jsonb_build_object('geography_type','zip_zcta','geography_value','32095'),
             $2, $3,
             jsonb_build_object('providerRows', $4::int, 'matchedExisting', $5::int,
                                'discoveredNew', $6::int),
             now() - ($7 || ' days')::interval)`,
    [
      input.status ?? 'SUCCEEDED', input.outcome, input.reason ?? 'because',
      input.providerRows ?? 0, input.matchedExisting ?? 0, input.discoveredNew ?? 0,
      String(input.ageDays ?? 0),
    ],
  );
}

const ZIP = { type: 'zip_zcta' as const, value: '32095' };

async function coverage() {
  return coverageFor({ geography: ZIP, verticalProfileId: 'hvac' });
}

async function findPage(): Promise<string> {
  await createUser({
    email: `find${++sequence}@test.local`, displayName: 'Finder', role: 'SALES_MANAGER',
    password: PASSWORD });
  const login = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: `find${sequence}@test.local`, password: PASSWORD } });
  const cookie = login.cookies.find((c) => c.name === 'yad_sales_session')!;
  const page = await app.inject({
    method: 'GET', url: '/find?where=32095&vertical=hvac',
    headers: { cookie: `yad_sales_session=${cookie.value}` } });
  assert.equal(page.statusCode, 200);
  return page.body;
}

// ------------------------------------------------- the ten states, told apart --

test('nobody has searched is not the same as nothing is there', async () => {
  await seedAccount('Existing HVAC');
  registerDiscoveryAdapter({
    name: 'ready', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return { status: 'ZERO_RESULTS' as const, businesses: [],
        providerRows: 0, rejectedRows: 0, duplicateRows: 0 };
    },
  });

  const result = await coverage();
  assert.equal(result.discovery!.state, 'NEVER_RUN');

  const page = await findPage();
  assert.match(page, /No external search has been run/);
  assert.match(page, /not the same as what is there/);
});

test('no provider at all reads as blocked, never as an empty market', async () => {
  await seedAccount('Existing HVAC Two');
  const result = await coverage();
  assert.equal(result.discovery!.state, 'BLOCKED');
  assert.equal(result.discoveryAvailable, false);

  const page = await findPage();
  assert.match(page, /New-business search is unavailable/);
  assert.ok(!/no businesses (found )?in 32095/i.test(page),
    'the page told the operator the market was empty');
});

test('existing inventory still shows when discovery is blocked', async () => {
  await seedAccount('Still Visible HVAC');
  const page = await findPage();
  assert.match(page, /Still Visible HVAC/,
    'a blocked provider hid the companies we already hold');
});

test('a provider that could not answer is not a market with nothing in it', async () => {
  await completedJob({ outcome: 'PROVIDER_UNAVAILABLE', reason: 'every provider failed' });
  const result = await coverage();
  assert.equal(result.discovery!.state, 'PROVIDER_UNAVAILABLE');

  const page = await findPage();
  assert.match(page, /could not be completed/);
  assert.match(page, /not known whether this market has businesses/);
});

test('a provider still working is pending, not empty', async () => {
  await completedJob({ outcome: 'PROVIDER_PENDING' });
  assert.equal((await coverage()).discovery!.state, 'PENDING');

  const page = await findPage();
  assert.match(page, /has accepted a search/);
  assert.match(page, /collected rather than run again/);
});

test('a half-searched market says it is part of the market', async () => {
  await completedJob({ outcome: 'PARTIAL', providerRows: 3, discoveredNew: 1 });
  assert.equal((await coverage()).discovery!.state, 'PARTIAL');

  const page = await findPage();
  assert.match(page, /only partly searched/);
});

test('a genuine zero says it is a real answer about the market', async () => {
  await completedJob({ outcome: 'ZERO_RESULTS', providerRows: 0 });
  assert.equal((await coverage()).discovery!.state, 'ZERO_RESULTS');

  const page = await findPage();
  assert.match(page, /returned no usable business/);
  assert.match(page, /real answer about this market, not a failure/);
});

test('finding only companies we already hold is coverage, not emptiness', async () => {
  await seedAccount('Already Held HVAC');
  await completedJob({
    outcome: 'COMPLETED', providerRows: 12, matchedExisting: 12, discoveredNew: 0 });

  const result = await coverage();
  assert.equal(result.discovery!.state, 'MATCHED_EXISTING');
  assert.equal(result.discovery!.providerRows, 12);
  assert.equal(result.discovery!.matchedExisting, 12);
  assert.equal(result.discovery!.discoveredNew, 0);

  const page = await findPage();
  assert.match(page, /found 12 businesses/);
  assert.match(page, /all 12 were ones we already hold/);
  assert.match(page, /covered, not empty/);
});

test('a search that added companies says how many', async () => {
  await seedAccount('Newly Added HVAC');
  await completedJob({
    outcome: 'COMPLETED', providerRows: 9, matchedExisting: 4, discoveredNew: 5 });

  assert.equal((await coverage()).discovery!.state, 'FOUND_NEW');
  const page = await findPage();
  // The template wraps, so the assertion is about the words rather than the spacing.
  assert.match(page, /added\s+5 companies we did not have/);
  assert.match(page, /matched 4 we already held/);
});

test('an old successful search says the market may have moved', async () => {
  await completedJob({
    outcome: 'COMPLETED', providerRows: 5, discoveredNew: 5,
    ageDays: DISCOVERY_STALE_AFTER_DAYS + 1 });

  assert.equal((await coverage()).discovery!.state, 'STALE');
  const page = await findPage();
  assert.match(page, /has not been searched recently/);
});

test('a search in flight outranks whatever the last one concluded', async () => {
  await completedJob({ outcome: 'ZERO_RESULTS' });
  const running = await discoveryCoverageFor({
    geographyValue: '32095', discoveryAvailable: true,
    activeJobId: 'a-job', activeJobScope: 'DISCOVER_NEW' });
  assert.equal(running.state, 'RUNNING', 'the answer is about to change and the page said otherwise');
});

test('a refresh-only job in flight is not a discovery in flight', async () => {
  const refreshing = await discoveryCoverageFor({
    geographyValue: '32095', discoveryAvailable: true,
    activeJobId: 'a-job', activeJobScope: 'REFRESH_EXISTING' });
  assert.notEqual(refreshing.state, 'RUNNING',
    'a job that only re-researches what we hold was reported as a market search');
});

test('the ten states are genuinely distinct, not one sentence in ten hats', async () => {
  const seen = new Set<string>();
  const cases: { setup: () => Promise<void>; expect: string }[] = [
    { setup: async () => {}, expect: 'BLOCKED' },
    { setup: async () => { await completedJob({ outcome: 'PROVIDER_PENDING' }); },
      expect: 'PENDING' },
    { setup: async () => { await completedJob({ outcome: 'PROVIDER_UNAVAILABLE' }); },
      expect: 'PROVIDER_UNAVAILABLE' },
    { setup: async () => { await completedJob({ outcome: 'PARTIAL' }); }, expect: 'PARTIAL' },
    { setup: async () => { await completedJob({ outcome: 'ZERO_RESULTS' }); },
      expect: 'ZERO_RESULTS' },
    { setup: async () => {
      await completedJob({ outcome: 'COMPLETED', providerRows: 3, matchedExisting: 3 }); },
      expect: 'MATCHED_EXISTING' },
    { setup: async () => {
      await completedJob({ outcome: 'COMPLETED', providerRows: 3, discoveredNew: 3 }); },
      expect: 'FOUND_NEW' },
  ];

  for (const scenario of cases) {
    await resetDatabase();
    await syncVerticalProfiles();
    clearDiscoveryAdapters();
    await scenario.setup();
    const result = await coverage();
    assert.equal(result.discovery!.state, scenario.expect);
    seen.add(result.discovery!.state);
  }
  assert.equal(seen.size, cases.length, 'two scenarios collapsed into one state');
});

test('a failed discovery job is not read as a completed empty search', async () => {
  await completedJob({ outcome: 'FAILED', status: 'FAILED', reason: 'handler threw' });
  const result = await coverage();
  assert.equal(result.discovery!.state, 'PROVIDER_UNAVAILABLE');
  assert.notEqual(result.discovery!.state, 'ZERO_RESULTS');
});
