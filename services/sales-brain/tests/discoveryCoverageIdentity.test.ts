import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { coverageFor } from '../src/domain/search.js';
import { clearDiscoveryAdapters, registerDiscoveryAdapter } from '../src/workers/marketMiner.js';
import { resetDatabase } from './helpers.js';
import { observationsFor } from './support/observations.js';

/**
 * A market is a vertical and a place, and PENDING is a claim about now.
 *
 * Found on the live page during the controlled canary. Find Prospects, asked for
 * Plumbing in 32095, said: "The search provider has accepted a search of 32095 and
 * has not answered yet. It will be collected rather than run again." Authoritative
 * production state at that moment was nothing of the kind -- no PENDING provider
 * task, no active market_mine job, no saved market enabled, no DataForSEO task, no
 * paid search that day. The five pre-P0 tasks had been deliberately abandoned.
 *
 * Two independent defects, both in the read model:
 *
 * 1. `discoveryCoverageFor` selected the newest completed market_mine job by
 *    `payload->>'geography_value'` alone, so any vertical's search of a ZIP answered
 *    for every vertical in that ZIP.
 *
 * 2. `outcome = 'PROVIDER_PENDING'` was read as "a provider owes us results". It is
 *    a record of how a run ended, written once and never revised, so it outlived its
 *    own provider task being collected, failed or abandoned.
 *
 * Neither is visible from the job row, which was correct about its own run the whole
 * time. The sentence was wrong, not the history -- so the history stays and the read
 * model is what changed.
 */

let app: FastifyInstance;
const PASSWORD = 'discovery-identity-password';
let sequence = 0;

before(async () => { app = await buildServer(); await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await app.close(); await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
});

/** A market_mine job as `enqueueMarketResearch` leaves one: vertical, place, mode. */
async function minedJob(input: {
  vertical: string;
  outcome: string;
  geographyValue?: string;
  geographyType?: string;
  miningMode?: string;
  status?: string;
  ageDays?: number;
  providerRows?: number;
  matchedExisting?: number;
  discoveredNew?: number;
}): Promise<string> {
  const { rows } = await query<{ job_id: string }>(
    `insert into jobs (job_type, status, payload, outcome, outcome_reason, progress,
                       completed_at)
     values ('market_mine', $1,
             jsonb_build_object('vertical_profile_id', $2::text,
                                'geography_type', $3::text,
                                'geography_value', $4::text,
                                'mining_mode', $5::text),
             $6, 'recorded by the fixture',
             jsonb_build_object('providerRows', $7::int, 'matchedExisting', $8::int,
                                'discoveredNew', $9::int),
             now() - ($10 || ' days')::interval)
     returning job_id`,
    [
      input.status ?? 'SUCCEEDED', input.vertical, input.geographyType ?? 'zip_zcta',
      input.geographyValue ?? '32095', input.miningMode ?? 'advertiser_first',
      input.outcome, input.providerRows ?? 0, input.matchedExisting ?? 0,
      input.discoveredNew ?? 0, String(input.ageDays ?? 0),
    ],
  );
  return rows[0]!.job_id;
}

/** A market_mine job that is still in flight. */
async function runningJob(vertical: string, geographyValue = '32095'): Promise<string> {
  const { rows } = await query<{ job_id: string }>(
    `insert into jobs (job_type, status, payload)
     values ('market_mine', 'RUNNING',
             jsonb_build_object('vertical_profile_id', $1::text,
                                'geography_type', 'zip_zcta',
                                'geography_value', $2::text))
     returning job_id`,
    [vertical, geographyValue],
  );
  return rows[0]!.job_id;
}

/**
 * A provider task in a given state.
 *
 * `jobId` may be null on purpose: a task recorded without one is still outstanding
 * work, and the read model has to find it by fingerprint instead.
 */
async function providerTask(input: {
  jobId: string | null;
  status: string;
  vertical?: string;
  geographyValue?: string;
  miningMode?: string;
  term?: string;
  errorCode?: string | null;
}): Promise<void> {
  sequence += 1;
  const fingerprint = [
    'search', '', input.vertical ?? 'plumbing',
    `zip_zcta:${input.geographyValue ?? '32095'}`,
    input.miningMode ?? 'advertiser_first', input.term ?? 'drain cleaning',
  ].join(':');
  await query(
    `insert into provider_tasks (provider, provider_native_id, job_id, fingerprint,
                                 status, error_code)
     values ('dataforseo', $1, $2, $3, $4, $5)`,
    [`native-task-${sequence}`, input.jobId, fingerprint, input.status,
      input.errorCode ?? null],
  );
}

/** Enough of a provider for the page to believe discovery is possible at all. */
function providerConfigured(): void {
  registerDiscoveryAdapter({
    name: 'fake-discovery', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return { status: 'ZERO_RESULTS' as const, observations: observationsFor([]) };
    },
  });
}

async function discoveryFor(
  verticalProfileId: string | null, geographyValue = '32095',
  geographyType: 'zip_zcta' | 'city' = 'zip_zcta',
) {
  const coverage = await coverageFor({
    geography: { type: geographyType, value: geographyValue }, verticalProfileId });
  return coverage.discovery!;
}

async function findPage(vertical: string, where = '32095'): Promise<string> {
  sequence += 1;
  const email = `identity${sequence}@test.local`;
  await createUser({
    email, displayName: 'Identity Rep', role: 'SALES_MANAGER', password: PASSWORD });
  const login = await app.inject({
    method: 'POST', url: '/login', payload: { email, password: PASSWORD } });
  const cookie = login.cookies.find((c) => c.name === 'yad_sales_session')!;
  const page = await app.inject({
    method: 'GET', url: `/find?where=${where}&vertical=${vertical}`,
    headers: { cookie: `yad_sales_session=${cookie.value}` } });
  assert.equal(page.statusCode, 200);
  return page.body;
}

const PENDING_SENTENCE = /will be collected rather than run again/;

// ------------------------------------------- a ZIP is not a market on its own --

test('a Roofing search of a ZIP is not news about Plumbing in it', async () => {
  providerConfigured();
  const roofing = await minedJob({ vertical: 'roofing', outcome: 'PROVIDER_PENDING' });
  await providerTask({ jobId: roofing, status: 'PENDING', vertical: 'roofing' });

  assert.equal((await discoveryFor('plumbing')).state, 'NEVER_RUN',
    'a market nobody has searched borrowed another vertical’s pending search');
  assert.equal((await discoveryFor('roofing')).state, 'PENDING',
    'the vertical that is genuinely waiting stopped being reported as waiting');
});

test('each vertical in one ZIP keeps its own answer', async () => {
  providerConfigured();
  await minedJob({ vertical: 'plumbing', outcome: 'ZERO_RESULTS' });
  await minedJob({
    vertical: 'roofing', outcome: 'COMPLETED', providerRows: 9, discoveredNew: 3 });

  assert.equal((await discoveryFor('plumbing')).state, 'ZERO_RESULTS');
  assert.equal((await discoveryFor('roofing')).state, 'FOUND_NEW');
});

test('the newest job in a ZIP does not overwrite the other vertical’s history',
  async () => {
    providerConfigured();
    // Roofing ran last, so geography-only selection would hand its answer to both.
    await minedJob({ vertical: 'plumbing', outcome: 'ZERO_RESULTS', ageDays: 2 });
    await minedJob({
      vertical: 'roofing', outcome: 'COMPLETED', providerRows: 9, discoveredNew: 3,
      ageDays: 0 });

    const plumbing = await discoveryFor('plumbing');
    assert.equal(plumbing.state, 'ZERO_RESULTS');
    assert.equal(plumbing.discoveredNew, 0,
      'one vertical’s discovered companies were counted as another’s');
  });

test('a vertical’s answer in one ZIP says nothing about the next ZIP', async () => {
  providerConfigured();
  await minedJob({
    vertical: 'plumbing', outcome: 'COMPLETED', providerRows: 9, discoveredNew: 3 });

  assert.equal((await discoveryFor('plumbing')).state, 'FOUND_NEW');
  assert.equal((await discoveryFor('plumbing', '32256')).state, 'NEVER_RUN',
    'a ZIP nobody has searched inherited a neighbour’s coverage');
});

test('geography type is part of the identity, not just the value', async () => {
  providerConfigured();
  // Same vertical, same string, different kind of place. Matching on the value alone
  // would let one answer for the other.
  await minedJob({
    vertical: 'plumbing', geographyType: 'city', geographyValue: '32095',
    outcome: 'COMPLETED', providerRows: 9, discoveredNew: 3 });

  assert.equal((await discoveryFor('plumbing', '32095', 'zip_zcta')).state, 'NEVER_RUN',
    'a city search supplied the coverage state for a ZIP search');
  assert.equal((await discoveryFor('plumbing', '32095', 'city')).state, 'FOUND_NEW',
    'the search that did happen stopped being visible to the market it was for');
});

test('a legacy run that predates geography_type still counts for its market', async () => {
  providerConfigured();
  // The oldest market_mine runs in production carry no `geography_type` in their
  // payload at all. The place is still pinned exactly by `geography_value`, so
  // excluding them would buy no precision and would report a market that has been
  // searched as one that never has.
  await query(
    `insert into jobs (job_type, status, payload, outcome, outcome_reason, progress,
                       completed_at)
     values ('market_mine', 'SUCCEEDED',
             jsonb_build_object('vertical_profile_id','roofing',
                                'geography_value','32095'),
             'COMPLETED', 'a run from before the payload carried a type',
             jsonb_build_object('providerRows', 9, 'matchedExisting', 0,
                                'discoveredNew', 3),
             now())`);

  assert.equal((await discoveryFor('roofing')).state, 'FOUND_NEW',
    'a real search disappeared because its payload predates a field');
  assert.equal((await discoveryFor('plumbing')).state, 'NEVER_RUN',
    'tolerating a missing type let the run answer for another vertical');
});

// ------------------------------- PENDING means something is actually outstanding --

test('a historical PROVIDER_PENDING run with its task still open is pending', async () => {
  providerConfigured();
  const job = await minedJob({ vertical: 'plumbing', outcome: 'PROVIDER_PENDING' });
  await providerTask({ jobId: job, status: 'PENDING' });

  assert.equal((await discoveryFor('plumbing')).state, 'PENDING',
    'a search the provider genuinely owes us was reported as finished');
});

test('a task outstanding under its fingerprint alone is still outstanding', async () => {
  providerConfigured();
  // `provider_tasks.job_id` is nullable -- `on delete set null`, and a task can be
  // recorded without one. Losing the link must not lose the fact that a paid search
  // is still owed, or the next click buys the market again.
  await minedJob({ vertical: 'plumbing', outcome: 'PROVIDER_PENDING' });
  await providerTask({ jobId: null, status: 'PENDING' });

  assert.equal((await discoveryFor('plumbing')).state, 'PENDING',
    'an outstanding task with no job link was treated as no task at all');
});

for (const settled of ['COLLECTED', 'ABANDONED', 'FAILED']) {
  test(`a historical PROVIDER_PENDING run whose task is ${settled} is not pending`,
    async () => {
      providerConfigured();
      const job = await minedJob({ vertical: 'plumbing', outcome: 'PROVIDER_PENDING' });
      await providerTask({ jobId: job, status: settled });

      const discovery = await discoveryFor('plumbing');
      assert.notEqual(discovery.state, 'PENDING',
        `a ${settled} task was still reported as a search the provider owes us`);
      assert.equal(discovery.state, 'PROVIDER_UNAVAILABLE');
    });
}

test('a historical PROVIDER_PENDING run with no task at all is not pending', async () => {
  providerConfigured();
  await minedJob({ vertical: 'plumbing', outcome: 'PROVIDER_PENDING' });

  const discovery = await discoveryFor('plumbing');
  assert.notEqual(discovery.state, 'PENDING');
  assert.equal(discovery.state, 'PROVIDER_UNAVAILABLE');
});

test('somebody else’s open task does not keep this market pending', async () => {
  providerConfigured();
  const job = await minedJob({ vertical: 'plumbing', outcome: 'PROVIDER_PENDING' });
  await providerTask({ jobId: job, status: 'ABANDONED' });
  // Open, real, and about a different market entirely.
  await providerTask({
    jobId: null, status: 'PENDING', vertical: 'roofing', geographyValue: '32256' });

  assert.notEqual((await discoveryFor('plumbing')).state, 'PENDING',
    'an open task somewhere in the table was read as an open task for this market');
});

test('the historical run stays on the record either way', async () => {
  providerConfigured();
  const job = await minedJob({
    vertical: 'plumbing', outcome: 'PROVIDER_PENDING', ageDays: 3 });
  await providerTask({ jobId: job, status: 'ABANDONED' });

  const discovery = await discoveryFor('plumbing');
  assert.ok(discovery.lastRunAt, 'the run that happened was erased from coverage');
  assert.ok(discovery.reason, 'the job’s own account of itself was dropped');

  const { rows } = await query<{ outcome: string }>(
    'select outcome from jobs where job_id = $1', [job]);
  assert.equal(rows[0]!.outcome, 'PROVIDER_PENDING',
    'the read-model fix rewrote history instead of reading it correctly');
});

// --------------------------------------------------- work in flight, truthfully --

test('one real active market_mine job reads as running for its own vertical', async () => {
  providerConfigured();
  await runningJob('plumbing');

  const coverage = await coverageFor({
    geography: { type: 'zip_zcta', value: '32095' }, verticalProfileId: 'plumbing' });
  assert.equal(coverage.state, 'REFRESHING');
  assert.equal(coverage.activeJobScope, 'DISCOVER_NEW');
  assert.equal(coverage.discovery!.state, 'RUNNING');
});

test('a search running for one vertical is not running for another', async () => {
  providerConfigured();
  await runningJob('roofing');

  const coverage = await coverageFor({
    geography: { type: 'zip_zcta', value: '32095' }, verticalProfileId: 'plumbing' });
  assert.notEqual(coverage.state, 'REFRESHING',
    'a rep was told their market was being searched by somebody else’s job');
  assert.notEqual(coverage.discovery!.state, 'RUNNING');
});

// ------------------------------------------- what the page says, which is the bug --

test('the production case: Plumbing 32095 stops claiming a provider owes us results',
  async () => {
    providerConfigured();
    // Exactly the row the canary found: a pre-P0 drain-cleaning run that ended
    // PROVIDER_PENDING, whose task was deliberately abandoned during remediation.
    const job = await minedJob({
      vertical: 'plumbing', outcome: 'PROVIDER_PENDING', ageDays: 6 });
    await providerTask({
      jobId: job, status: 'ABANDONED',
      errorCode: 'SUPERSEDED_BY_P0_MINER_REMEDIATION' });

    const discovery = await discoveryFor('plumbing');
    assert.notEqual(discovery.state, 'PENDING');

    const page = await findPage('plumbing');
    assert.doesNotMatch(page, PENDING_SENTENCE,
      'the page still promised a provider result nobody is waiting for');
    assert.match(page, /Research this market/,
      'a market with no outstanding work stopped offering to research it');
  });

test('a market genuinely awaiting a provider does not also offer to buy a search',
  async () => {
    providerConfigured();
    const job = await minedJob({ vertical: 'plumbing', outcome: 'PROVIDER_PENDING' });
    await providerTask({ jobId: job, status: 'PENDING' });

    const page = await findPage('plumbing');
    assert.match(page, PENDING_SENTENCE,
      'a search the provider owes us stopped being reported to the rep');
    assert.doesNotMatch(page, /Research this market/,
      'the page offered to buy a search of a market already waiting on one');
  });
