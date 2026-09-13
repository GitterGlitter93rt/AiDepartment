import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, query } from '../src/db/pool.js';
import { buildServer } from '../src/api/server.js';
import { createUser } from '../src/domain/auth.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters,
  type DiscoveryResult, type DiscoveryQuery,
} from '../src/workers/marketMiner.js';
import { resetDatabase } from './helpers.js';
import { observationsFor } from './support/observations.js';

/**
 * What the operator confirms is what the worker buys.
 *
 * The previous pass proved the plan could not change between the preview and the
 * confirmation. It could still change between the confirmation and the purchase: the
 * route verified a hash, dropped the plan, and handed the worker a vertical, a
 * geography and a budget -- and the worker planned again, minutes or hours later,
 * from a taxonomy that anybody could have edited in between. The hash proved a plan
 * and then guarded nothing.
 *
 * These tests drive the real HTTP route, the real queue and the real worker. The only
 * fake is the provider, and it records exactly what it was asked for.
 */

const PASSWORD = 'confirmed-plan-password';
const ZIP = '32095';

let app: FastifyInstance;
let cookie: string;

/** Every search any provider was actually asked to buy, in order. */
interface ProviderCall {
  provider: string;
  keyword: string;
  locationName: string;
  term: string;
  fingerprint: string;
  purpose: string;
  coverageRole: string;
}
let calls: ProviderCall[] = [];

function recordingAdapter(name = 'dataforseo', mode = 'standard') {
  registerDiscoveryAdapter({
    name, requiresCredential: false, governanceReviewed: true, mode,
    isConfigured: () => true,
    async discover(request: DiscoveryQuery): Promise<DiscoveryResult> {
      calls.push({
        provider: name,
        keyword: request.search?.keyword ?? '',
        locationName: request.search?.locationName ?? '',
        term: request.search?.term ?? '',
        fingerprint: request.search?.fingerprint ?? '',
        purpose: request.search?.purpose ?? '',
        coverageRole: request.search?.coverageRole ?? '',
      });
      return { status: 'OK', observations: [], costUsd: 0.006 };
    },
  });
}

before(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  app = await buildServer();
  await app.ready();
});
after(async () => { clearDiscoveryAdapters(); await app.close(); await pool.end(); });

beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  calls = [];
  await createUser({
    email: 'ops@confirmed.invalid', displayName: 'Confirming Ops',
    role: 'SALES_MANAGER', password: PASSWORD });
  const login = await app.inject({
    method: 'POST', url: '/login',
    payload: { email: 'ops@confirmed.invalid', password: PASSWORD } });
  cookie = `yad_sales_session=${login.cookies.find(
    (item) => item.name === 'yad_sales_session')!.value}`;
});

/** A second operator, for the paths that enqueue without going through the route. */
async function makeOperator(): Promise<{ userId: string }> {
  const { makeUser } = await import('./helpers.js');
  return makeUser(`Plan Operator ${Math.random().toString(36).slice(2, 8)}`, 'SALES_MANAGER');
}

async function preview(body: Record<string, unknown>) {
  const response = await app.inject({
    method: 'POST', url: '/api/mining/plan', headers: { cookie }, payload: body });
  return { status: response.statusCode, body: response.json() as Record<string, any> };
}

async function confirm(planId: string, planHash: string) {
  const response = await app.inject({
    method: 'POST', url: '/api/mining/jobs', headers: { cookie },
    payload: { planId, planHash } });
  return { status: response.statusCode, body: response.json() as Record<string, any> };
}

/**
 * Rewrites a vertical's discovery terms, the way an edit to the profile would.
 *
 * The taxonomy lives under `definition.profile.search_taxonomy`, and writing to
 * `definition.search_taxonomy` instead changes nothing the loader reads -- which is
 * how the first version of the test below passed without testing anything.
 */
async function replaceCoreQueries(vertical: string, queries: string[]): Promise<void> {
  await query(
    `update vertical_profiles
        set definition = jsonb_set(definition, '{profile,search_taxonomy,core_queries}', $2::jsonb)
      where vertical_profile_id = $1`,
    [vertical, JSON.stringify(queries.map((query_, index) => ({
      query: query_, family: 'core', priority: index + 1, intent_weight: 4,
      recommended_for_paid_serp: true, recommended_for_places_gap_fill: true,
    })))]);
}

/** What the preview said would be bought, in the shape the provider records. */
function previewedCalls(plan: Record<string, any>): ProviderCall[] {
  return (plan['searches'] as Record<string, any>[]).map((search) => ({
    provider: plan['provider'] as string,
    keyword: search['keyword'] as string,
    locationName: search['locationName'] as string,
    term: search['term'] as string,
    fingerprint: search['fingerprint'] as string,
    purpose: search['purpose'] as string,
    coverageRole: search['coverageRole'] as string,
  }));
}

// ------------------------------------------------------- the whole contract ----

test('the previewed plan is exactly what the provider is asked for', async () => {
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 3,
  });
  assert.equal(planned.status, 200);
  const plan = planned.body['plan'] as Record<string, any>;
  assert.equal(plan['searches'].length, 3);

  const submitted = await confirm(planned.body['planId'], planned.body['planHash']);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  await drainQueue();

  assert.deepEqual(calls, previewedCalls(plan),
    'the worker bought something other than what was approved');
});

test('a taxonomy change after confirmation does not change what is bought', async () => {
  // The defect this whole round is about. The plan is confirmed, and then the thing
  // the worker used to re-read is edited underneath it.
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2,
  });
  const plan = planned.body['plan'] as Record<string, any>;
  const approved = previewedCalls(plan);

  const submitted = await confirm(planned.body['planId'], planned.body['planHash']);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));

  // Between the confirmation and the worker: somebody edits the vertical's queries.
  await replaceCoreQueries('roofing', ['unapproved term one', 'unapproved term two']);
  // The edit has to be real, or this test proves nothing at all.
  const { searchQueriesFor } = await import('../src/miner/searchTaxonomy.js');
  const nowDefined = (await searchQueriesFor('roofing')).map((entry) => entry.query);
  assert.ok(nowDefined.includes('unapproved term one'),
    'the taxonomy edit did not take effect, so this test would pass either way');

  await drainQueue();

  assert.deepEqual(calls, approved,
    'the worker re-planned and bought terms the operator never saw');
  assert.equal(calls.some((call) => /unapproved/.test(call.keyword)), false);
});

test('the default Find Prospects path previews and executes one identity', async () => {
  // The page sends the inventory search request and names no mining mode. The preview
  // defaulted to `advertisers_first` and the job to `advertiser_first`, so the two
  // described different searches -- the mode is part of every fingerprint.
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
  });
  const plan = planned.body['plan'] as Record<string, any>;
  assert.equal(plan['miningMode'], 'advertiser_first');

  const submitted = await confirm(planned.body['planId'], planned.body['planHash']);
  assert.equal(submitted.status, 200);
  await drainQueue();

  assert.deepEqual(calls.map((call) => call.fingerprint),
    (plan['searches'] as Record<string, any>[]).map((search) => search['fingerprint']),
    'the preview and the execution used different search identities');
});

test('a mining mode this product does not have is refused, not guessed', async () => {
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    miningMode: 'advertisers_first',
  });
  const plan = planned.body['plan'] as Record<string, any>;
  assert.equal(plan['refusalCode'], 'UNKNOWN_MINING_MODE');
  assert.equal(plan['searches'].length, 0);
  assert.equal(plan['chargeableTaskCount'], 0);

  const submitted = await confirm(planned.body['planId'], planned.body['planHash']);
  assert.equal(submitted.status, 400);
  await drainQueue();
  assert.equal(calls.length, 0, 'a misspelled mode bought searches anyway');
});

// ------------------------------------------------------------------ causes ----

test('confirmed causes are executed, and absent causes stay absent', async () => {
  recordingAdapter();
  const withCause = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 12, causes: ['hail'],
  });
  const plan = withCause.body['plan'] as Record<string, any>;
  const stormTerms = (plan['searches'] as Record<string, any>[])
    .filter((search) => /hail|storm/i.test(search['keyword'] as string));
  assert.ok(stormTerms.length > 0,
    'the fixture profile no longer has an event-qualified term to authorise');

  const submitted = await confirm(withCause.body['planId'], withCause.body['planHash']);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  await drainQueue();

  // The causes used to be hashed into the plan and then dropped on the way to the
  // job, so the worker executed a neutral plan instead of the one approved.
  assert.deepEqual(calls, previewedCalls(plan));
  assert.ok(calls.some((call) => /hail|storm/i.test(call.keyword)),
    'the event-qualified terms the operator authorised were not bought');
});

test('with no cause asked for, no storm term appears', async () => {
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 12,
  });
  const plan = planned.body['plan'] as Record<string, any>;
  const submitted = await confirm(planned.body['planId'], planned.body['planHash']);
  assert.equal(submitted.status, 200);
  await drainQueue();

  assert.deepEqual(calls, previewedCalls(plan));
  assert.equal(calls.some((call) => /hail|storm/i.test(call.keyword)), false,
    'a storm campaign ran that nobody asked for');
});

// --------------------------------------------------------------- providers ----

test('a second provider does not double what was approved', async () => {
  // Preview quotes one provider; the worker looped over every registered adapter. Two
  // configured providers meant twice the tasks and twice the spend, disclosed nowhere.
  recordingAdapter('dataforseo');
  recordingAdapter('second-provider');

  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2,
  });
  const plan = planned.body['plan'] as Record<string, any>;
  assert.equal(plan['chargeableTaskCount'], 2);

  const submitted = await confirm(planned.body['planId'], planned.body['planHash']);
  assert.equal(submitted.status, 200);
  await drainQueue();

  assert.equal(calls.length, 2,
    `${calls.length} provider calls were made for a plan that quoted 2`);
  assert.deepEqual([...new Set(calls.map((call) => call.provider))], [plan['provider']]);
});

test('a plan whose provider is gone buys nothing from anybody else', async () => {
  recordingAdapter('dataforseo');
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2,
  });
  const submitted = await confirm(planned.body['planId'], planned.body['planHash']);
  assert.equal(submitted.status, 200);

  // The approved provider is replaced by a different one before the worker runs.
  clearDiscoveryAdapters();
  recordingAdapter('a-completely-different-provider');
  await drainQueue();

  assert.equal(calls.length, 0, 'a provider nobody approved executed the plan');
  const { rows } = await query<{ outcome: string; outcome_reason: string }>(
    `select outcome, outcome_reason from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.outcome, 'DISCOVERY_BLOCKED');
  assert.match(rows[0]!.outcome_reason, /not\s+configured now/);
});

test('a paid preview with no provider at all refuses rather than quoting', async () => {
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 3,
  });
  const plan = planned.body['plan'] as Record<string, any>;
  assert.equal(plan['refusalCode'], 'NO_PROVIDER');
  assert.equal(plan['searches'].length, 0);
  assert.equal(plan['estimatedCostUsd'], 0);

  const submitted = await confirm(planned.body['planId'], planned.body['planHash']);
  assert.equal(submitted.status, 400, 'a plan nothing could execute was confirmable');
});

// ----------------------------------------------------- plan linkage is proof ----

test('a job whose confirmed plan was tampered with buys nothing', async () => {
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2,
  });
  const submitted = await confirm(planned.body['planId'], planned.body['planHash']);
  assert.equal(submitted.status, 200);

  // The stored plan is edited after the job was queued against it.
  await query(
    `update search_plan_previews
        set plan = jsonb_set(plan, '{plan,searches,0,keyword}', '"a term nobody approved"')
      where plan_id = $1`, [planned.body['planId']]);
  await drainQueue();

  assert.equal(calls.length, 0, 'an edited plan executed');
  const { rows } = await query<{ outcome: string; outcome_reason: string }>(
    `select outcome, outcome_reason from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.outcome, 'DISCOVERY_BLOCKED');
  assert.match(rows[0]!.outcome_reason, /no longer matches what was approved/);
});

test('a job whose confirmed plan has vanished buys nothing', async () => {
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2,
  });
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);
  await query('delete from search_plan_previews where plan_id = $1', [planned.body['planId']]);
  await drainQueue();

  assert.equal(calls.length, 0, 'a job executed a plan that no longer exists');
});

// ------------------------------------------------------------- idempotency ----

test('an active run of a different plan is refused rather than joined', async () => {
  // The old key was market + mode, so a one-search confirmation could join a queued
  // five-search job and be charged for five -- or approve five and silently join a
  // one-search run. Joining an unattended job also stamped it with a requester, which
  // changes whether a paused market may buy.
  recordingAdapter();
  const five = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 5 });
  assert.equal((await confirm(five.body['planId'], five.body['planHash'])).status, 200);

  const one = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 1 });
  const second = await confirm(one.body['planId'], one.body['planHash']);
  assert.equal(second.status, 409,
    'a one-search confirmation was accepted while a five-search run was in flight');
  assert.equal(second.body['code'], 'ACTIVE_RUN_DIFFERS');

  await drainQueue();
  assert.equal(calls.length, 5, 'the run that executed was not the one confirmed');
});

test('confirming the same plan twice does not buy it twice', async () => {
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2 });
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);

  // A second click on the same reviewed plan. The plan is consumed, so it is refused
  // outright -- and even if it were not, the job key is the plan, so it could only
  // ever join the job it already created.
  const again = await confirm(planned.body['planId'], planned.body['planHash']);
  assert.equal(again.status, 400);
  assert.equal(again.body['code'], 'ALREADY_USED');

  await drainQueue();
  assert.equal(calls.length, 2, 'one confirmation bought four searches');
});

test('an unattended saved-market run is not absorbed by a human confirmation', async () => {
  recordingAdapter();
  const { enqueueMarketResearch } = await import('../src/workers/enqueue.js');
  const scheduled = await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: ZIP,
    marketId: null, requestedBy: null as unknown as string, queryBudget: 3 });

  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 1 });
  const submitted = await confirm(planned.body['planId'], planned.body['planHash']);
  assert.equal(submitted.status, 409, 'a confirmation joined an unattended run');

  const { rows } = await query<{ requested_by: string | null }>(
    'select requested_by from jobs where job_id = $1', [scheduled.jobId]);
  assert.equal(rows[0]!.requested_by, null,
    'confirming a plan stamped a requester onto an unattended job');
});

// -------------------------------------------------------------- task reuse ----

test('a search already paid for is collected, not bought again', async () => {
  recordingAdapter();
  const first = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2 });
  const plan = first.body['plan'] as Record<string, any>;

  const { recordProviderTask } = await import('../src/miner/providerTasks.js');
  await recordProviderTask({
    provider: plan['provider'], providerNativeId: 'outstanding-1',
    fingerprint: plan['searches'][0]['fingerprint'], jobId: null, request: {} });

  const second = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2 });
  const reused = second.body['plan'] as Record<string, any>;
  assert.equal(reused['searches'][0]['executionDisposition'], 'COLLECT_EXISTING');
  assert.equal(reused['chargeableTaskCount'], 1,
    'a search we have already paid for was quoted for again');
  assert.ok(reused['estimatedCostUsd'] < plan['estimatedCostUsd']);
});

// ------------------------------------------------------- the unattended path ----

test('an unattended run still plans server-side', async () => {
  // The immutable-plan rule is about human purchases. A scheduled refresh has no
  // preview and must keep working exactly as it did.
  recordingAdapter();
  const { enqueueMarketResearch } = await import('../src/workers/enqueue.js');
  await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: ZIP,
    marketId: null, requestedBy: null as unknown as string, queryBudget: 2 });
  await drainQueue();

  assert.equal(calls.length, 2, 'a scheduled market refresh stopped searching');
  assert.ok(calls.every((call) => call.keyword.includes(ZIP)));
});

test('the observations of a confirmed run are still resolved and recorded', async () => {
  // The plan decides what is bought. Everything after the provider answers is
  // unchanged, and this proves the confirmed path did not bypass it.
  registerDiscoveryAdapter({
    name: 'dataforseo', requiresCredential: false, governanceReviewed: true,
    mode: 'standard', isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return {
        status: 'OK', costUsd: 0.006,
        observations: observationsFor([
          { name: 'Confirmed Path Roofing', website: 'https://confirmedpath.invalid',
            phone: '904-555-3301' },
        ]),
      };
    },
  });
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 1 });
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);
  await drainQueue();

  const { rows } = await query<{ canonical_name: string; entity_status: string }>(
    `select canonical_name, entity_status from accounts`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.canonical_name, 'Confirmed Path Roofing');
  assert.equal(rows[0]!.entity_status, 'verified');

  const observed = await query<{ n: number }>(
    'select count(*)::int as n from search_observations');
  assert.ok(observed.rows[0]!.n > 0, 'a confirmed run recorded no observations');
});

test('two confirmations of one plan racing produce one job, not two', async () => {
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2 });

  // Both requests in flight at once, which is what a double-click actually is.
  const [first, second] = await Promise.all([
    confirm(planned.body['planId'], planned.body['planHash']),
    confirm(planned.body['planId'], planned.body['planHash']),
  ]);
  assert.equal([first.status, second.status].filter((status) => status === 200).length, 1,
    'a double-click confirmed the same plan twice');

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.n, 1, 'one reviewed plan queued two runs');

  await drainQueue();
  assert.equal(calls.length, 2, 'one confirmation bought four searches');
});

test('the confirmed plan says what to buy; the daily ceiling still says whether',
  async () => {
  // The plan is the execution authority over *which* searches run. It is not an
  // override of the spend controls: a confirmed run that would cross today's ceiling
  // is refused at the point of submission, exactly like any other.
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 3 });
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);

  // A ceiling small enough that one task at the assumed cost does not fit. Zero is
  // not a ceiling of nothing -- it is how this product spells "no ceiling at all".
  const previous = process.env['DISCOVERY_DAILY_BUDGET_USD'];
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.0001';
  try {
    await drainQueue();
  } finally {
    if (previous === undefined) delete process.env['DISCOVERY_DAILY_BUDGET_USD'];
    else process.env['DISCOVERY_DAILY_BUDGET_USD'] = previous;
  }

  assert.equal(calls.length, 0,
    'a confirmed plan bought searches the daily ceiling had refused');
  const { rows } = await query<{ outcome: string }>(
    `select outcome from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.outcome, 'DISCOVERY_BLOCKED');
});

test('two different confirmed plans are two jobs, never one', async () => {
  // The identity of a confirmed run, tested where it lives.
  //
  // `confirmPaidPlan` refuses a second confirmation while a materially different run
  // is in flight, so the route never reaches this -- which is the point of having it,
  // and also why a mutation test that goes through the route cannot see it. The
  // conflict check and the enqueue are not one transaction, so the key is what decides
  // what happens if two confirmations ever do arrive together: under the old key,
  // identified by market and mode alone, the second would join the first and execute a
  // plan nobody approved while being reported as accepted.
  const { enqueueMarketResearch } = await import('../src/workers/enqueue.js');
  const shared = {
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: ZIP,
    marketId: null, requestedBy: (await makeOperator()).userId,
  };

  const five = await enqueueMarketResearch({
    ...shared, queryBudget: 5,
    confirmedPlan: { planId: '11111111-1111-1111-1111-111111111111', planHash: 'hash-five' },
  });
  const one = await enqueueMarketResearch({
    ...shared, queryBudget: 1,
    confirmedPlan: { planId: '22222222-2222-2222-2222-222222222222', planHash: 'hash-one' },
  });

  assert.notEqual(one.jobId, five.jobId,
    'a one-search confirmation was absorbed by a five-search run');
  assert.equal(one.created, true);

  // And the same plan twice is still one job.
  const again = await enqueueMarketResearch({
    ...shared, queryBudget: 5,
    confirmedPlan: { planId: '11111111-1111-1111-1111-111111111111', planHash: 'hash-five' },
  });
  assert.equal(again.jobId, five.jobId, 'one approved plan queued two runs');
  assert.equal(again.created, false);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.n, 2);
});

// ------------------------------------------------------------ provider mode ----

test('a provider that changed mode since confirmation buys nothing', async () => {
  // Standard and Live are different endpoints, different lifecycles and different
  // prices. Matching the adapter by name alone meant a plan confirmed against
  // Standard could execute against Live after a restart -- the same provider, and a
  // different purchase.
  recordingAdapter('dataforseo', 'standard');
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2 });
  assert.equal((planned.body['plan'] as Record<string, any>)['providerMode'], 'standard');
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);

  clearDiscoveryAdapters();
  recordingAdapter('dataforseo', 'live');
  await drainQueue();

  assert.equal(calls.length, 0, 'a plan confirmed for standard mode executed against live');
  const { rows } = await query<{ outcome: string; outcome_reason: string }>(
    `select outcome, outcome_reason from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.outcome, 'DISCOVERY_BLOCKED');
  assert.match(rows[0]!.outcome_reason, /different purchases/);
});

test('an unchanged provider mode executes normally', async () => {
  recordingAdapter('dataforseo', 'standard');
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2 });
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);

  // Re-registered identically, as a restart would.
  clearDiscoveryAdapters();
  recordingAdapter('dataforseo', 'standard');
  await drainQueue();

  assert.equal(calls.length, 2, 'an unchanged provider mode refused to execute');
});

// ------------------------------------------- a collect may never become a buy ----

/** Puts an outstanding task in front of the next preview of this market. */
async function outstandingTaskFor(
  fingerprint: string, nativeId = 'owed-1', provider = 'dataforseo',
): Promise<{ providerTaskId: string }> {
  const { recordProviderTask } = await import('../src/miner/providerTasks.js');
  await recordProviderTask({
    provider, providerNativeId: nativeId, fingerprint, jobId: null, request: {} });
  const { rows } = await query<{ provider_task_id: string }>(
    `select provider_task_id from provider_tasks
      where provider = $1 and provider_native_id = $2 limit 1`, [provider, nativeId]);
  return { providerTaskId: rows[0]!.provider_task_id };
}

/** A plan whose first search is authorised as a collection, not a purchase. */
async function planWithACollect() {
  const first = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2 });
  const fingerprint = (first.body['plan'] as Record<string, any>)['searches'][0]['fingerprint'];
  await outstandingTaskFor(fingerprint);

  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2 });
  const plan = planned.body['plan'] as Record<string, any>;
  assert.equal(plan['searches'][0]['executionDisposition'], 'COLLECT_EXISTING');
  assert.equal(plan['chargeableTaskCount'], 1, 'the fixture no longer quotes a collection');
  return { planned, plan };
}

test('A. a collect whose task was collected first buys no replacement', async () => {
  recordingAdapter();
  const { planned, plan } = await planWithACollect();
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);

  // Something else collects the task between the confirmation and this run.
  await query(
    `update provider_tasks set status = 'COLLECTED' where provider_task_id = $1`,
    [plan['searches'][0]['approvedProviderTaskId']]);
  await drainQueue();

  // Exactly one call: the second search, which was approved as a purchase. The
  // collection that had already happened bought nothing.
  assert.equal(calls.length, 1,
    'a search approved as a collection turned into a new paid search');
  assert.equal(calls[0]!.fingerprint, plan['searches'][1]['fingerprint']);

  // And it is reported as finished work rather than as a problem. The distinction
  // matters to whoever reads the run: an approval that was already satisfied needs
  // nobody's attention, and one that died needs a new plan.
  const { rows } = await query<{ outcome: string; progress: Record<string, any> }>(
    `select outcome, progress from jobs where job_type = 'market_mine'`);
  const perSearch = rows[0]!.progress['perSearch'] as Record<string, any>[];
  const fulfilled = perSearch.find(
    (search) => search['fingerprint'] === plan['searches'][0]['fingerprint']);
  assert.equal(fulfilled?.['status'], 'ALREADY_FULFILLED',
    'an approval that had already been satisfied was reported as a failure');
  assert.match(String(fulfilled!['reason']), /already been collected/);
  assert.notEqual(rows[0]!.outcome, 'DISCOVERY_BLOCKED',
    'a run that did exactly what it was approved to do was reported as blocked');
});

test('B. a collect whose task failed buys no replacement, and says so', async () => {
  recordingAdapter();
  const { planned, plan } = await planWithACollect();
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);

  await query(
    `update provider_tasks set status = 'FAILED' where provider_task_id = $1`,
    [plan['searches'][0]['approvedProviderTaskId']]);
  await drainQueue();

  assert.equal(calls.length, 1, 'a dead task was replaced with a new paid search');
  const { rows } = await query<{ progress: Record<string, any> }>(
    `select progress from jobs where job_type = 'market_mine'`);
  const perSearch = rows[0]!.progress['perSearch'] as Record<string, any>[];
  const unfulfilled = perSearch.find((row) => row['status'] === 'PLAN_UNFULFILLABLE');
  assert.ok(unfulfilled, 'the run does not report the search it could not fulfil');
  assert.match(String(unfulfilled!['reason']), /can no longer be collected/);
});

test('C. a buy may become a collect when an equivalent task appears', async () => {
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2 });
  const plan = planned.body['plan'] as Record<string, any>;
  assert.equal(plan['chargeableTaskCount'], 2);
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);

  // A task for one of the approved searches turns up after the confirmation. The run
  // may collect it instead of buying, because that only spends less.
  await outstandingTaskFor(plan['searches'][0]['fingerprint'], 'appeared-later');
  await drainQueue();

  const chargeable = await query<{ n: number }>(
    `select count(*)::int as n from provider_tasks where submitted_at > now() - interval '1 hour'`);
  assert.ok(chargeable.rows[0]!.n <= plan['chargeableTaskCount'] + 1,
    'more tasks exist than the plan authorised');
  assert.ok(calls.length <= 2);
});

test('D. no state transition makes the run buy more than was approved', async () => {
  recordingAdapter();
  const { planned, plan } = await planWithACollect();
  const approvedMaximum = plan['chargeableTaskCount'] as number;
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);

  // The collection is closed, which is the transition that used to release a purchase.
  await query(
    `update provider_tasks set status = 'ABANDONED' where provider_task_id = $1`,
    [plan['searches'][0]['approvedProviderTaskId']]);
  await drainQueue();

  const { rows } = await query<{ progress: Record<string, any> }>(
    `select progress from jobs where job_type = 'market_mine'`);
  const perSearch = rows[0]!.progress['perSearch'] as Record<string, any>[];
  // What a purchase looks like from the outside: a provider was actually asked.
  const bought = perSearch.filter((row) =>
    row['status'] !== 'PLAN_UNFULFILLABLE' && row['status'] !== 'ALREADY_FULFILLED').length;
  assert.ok(bought <= approvedMaximum,
    `${bought} searches were bought against an approved maximum of ${approvedMaximum}`);
  assert.equal(calls.length, approvedMaximum);
});

// ----------------------------------------------------- authority of the plan ----

test('a preview nobody confirmed cannot be executed by referencing its id', async () => {
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2 });

  // Never confirmed. A caller that can enqueue reaches for the plan directly, which
  // is the shape of an internal mistake rather than an attack: knowing an id is not
  // the same as somebody having agreed to the purchase.
  const { enqueueMarketResearch } = await import('../src/workers/enqueue.js');
  await enqueueMarketResearch({
    verticalProfileId: 'roofing', geographyType: 'zip_zcta', geographyValue: ZIP,
    marketId: null, requestedBy: (await makeOperator()).userId, queryBudget: 2,
    confirmedPlan: {
      planId: planned.body['planId'], planHash: planned.body['planHash'] },
  });
  await drainQueue();

  assert.equal(calls.length, 0, 'an unconfirmed preview executed');
  const { rows } = await query<{ outcome_reason: string }>(
    `select outcome_reason from jobs where job_type = 'market_mine'`);
  assert.match(rows[0]!.outcome_reason, /nobody confirmed/);
});

// -------------------------------------------- the hash binds the execution intent --

test('1. editing the approved task id without the hash is detected', async () => {
  recordingAdapter();
  const { planned, plan } = await planWithACollect();
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);

  // The stored plan is repointed at a different task, leaving the hash column alone.
  // Before the intent was hashed, the worker's verification passed on this.
  await query(
    `update search_plan_previews
        set plan = jsonb_set(plan, '{plan,searches,0,approvedProviderTaskId}',
              to_jsonb('00000000-0000-0000-0000-0000000000ff'::text))
      where plan_id = $1`, [planned.body['planId']]);
  void plan;
  await drainQueue();

  assert.equal(calls.length, 0, 'a repointed plan executed');
  const { rows } = await query<{ outcome_reason: string }>(
    `select outcome_reason from jobs where job_type = 'market_mine'`);
  assert.match(rows[0]!.outcome_reason, /no longer matches what was approved/);
});

test('2. editing the execution disposition without the hash is detected', async () => {
  recordingAdapter();
  const { planned } = await planWithACollect();
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);

  // "collect this" quietly becomes "buy this".
  await query(
    `update search_plan_previews
        set plan = jsonb_set(plan, '{plan,searches,0,executionDisposition}',
              to_jsonb('BUY_NEW'::text))
      where plan_id = $1`, [planned.body['planId']]);
  await drainQueue();

  assert.equal(calls.length, 0, 'a collection rewritten as a purchase executed');
  const { rows } = await query<{ outcome_reason: string }>(
    `select outcome_reason from jobs where job_type = 'market_mine'`);
  assert.match(rows[0]!.outcome_reason, /no longer matches what was approved/);
});

test('3. an approved task belonging to another search is refused', async () => {
  recordingAdapter();
  const { planned, plan } = await planWithACollect();

  // A task that really exists, for a different search of the same market.
  const other = await outstandingTaskFor('search:some-other-question', 'other-search');
  await query(
    `update search_plan_previews
        set plan = jsonb_set(plan, '{plan,searches,0,approvedProviderTaskId}', to_jsonb($2::text)),
            plan_hash = $3
      where plan_id = $1`,
    [planned.body['planId'], other.providerTaskId, 'unused']);

  // Re-hash the edited plan so the worker's hash check passes and the *task* check is
  // what has to catch this. Otherwise this test would prove the previous one again.
  const { planHash } = await import('../src/miner/planPreview.js');
  const { rows: stored } = await query<{ plan: { plan: any } }>(
    'select plan from search_plan_previews where plan_id = $1', [planned.body['planId']]);
  const rehashed = planHash(stored[0]!.plan.plan);
  await query('update search_plan_previews set plan_hash = $2 where plan_id = $1',
    [planned.body['planId'], rehashed]);

  const { enqueueConfirmedMarketResearch } = await import('../src/workers/enqueue.js');
  const queued = await enqueueConfirmedMarketResearch({
    verticalProfileId: plan['verticalProfileId'], geographyType: plan['geographyType'],
    geographyValue: plan['geographyValue'], marketId: plan['marketId'],
    requestedBy: (await makeOperator()).userId, queryBudget: plan['searches'].length,
    confirmedPlan: { planId: planned.body['planId'], planHash: rehashed },
  });
  assert.equal(queued.ok, true);
  await drainQueue();

  // One call: the second search, which was approved as a purchase. The collection
  // named a task belonging to a different question and was refused rather than
  // collecting it or buying a replacement.
  assert.equal(calls.length, 1, 'a task for another search was collected or replaced');
  const { rows } = await query<{ progress: Record<string, any> }>(
    `select progress from jobs where job_type = 'market_mine'`);
  const perSearch = rows[0]!.progress['perSearch'] as Record<string, any>[];
  assert.ok(perSearch.some((row) => row['status'] === 'PLAN_UNFULFILLABLE'));
  // And the unrelated task was left alone.
  const untouched = await query<{ status: string }>(
    'select status from provider_tasks where provider_task_id = $1', [other.providerTaskId]);
  assert.equal(untouched.rows[0]!.status, 'PENDING');
});

test('4. an approved task belonging to another provider is refused', async () => {
  recordingAdapter();
  const { planned, plan } = await planWithACollect();

  // Same fingerprint, different provider.
  const foreign = await outstandingTaskFor(
    plan['searches'][0]['fingerprint'], 'foreign-1', 'some-other-provider');

  await query(
    `update search_plan_previews
        set plan = jsonb_set(plan, '{plan,searches,0,approvedProviderTaskId}', to_jsonb($2::text))
      where plan_id = $1`, [planned.body['planId'], foreign.providerTaskId]);
  const { planHash } = await import('../src/miner/planPreview.js');
  const { rows: stored } = await query<{ plan: { plan: any } }>(
    'select plan from search_plan_previews where plan_id = $1', [planned.body['planId']]);
  const rehashed = planHash(stored[0]!.plan.plan);
  await query('update search_plan_previews set plan_hash = $2 where plan_id = $1',
    [planned.body['planId'], rehashed]);

  const { enqueueConfirmedMarketResearch } = await import('../src/workers/enqueue.js');
  assert.equal((await enqueueConfirmedMarketResearch({
    verticalProfileId: plan['verticalProfileId'], geographyType: plan['geographyType'],
    geographyValue: plan['geographyValue'], marketId: plan['marketId'],
    requestedBy: (await makeOperator()).userId, queryBudget: plan['searches'].length,
    confirmedPlan: { planId: planned.body['planId'], planHash: rehashed },
  })).ok, true);
  await drainQueue();

  assert.equal(calls.length, 1, "another provider's task was collected");
  const untouched = await query<{ status: string }>(
    'select status from provider_tasks where provider_task_id = $1', [foreign.providerTaskId]);
  assert.equal(untouched.rows[0]!.status, 'PENDING');
});

// ------------------------------------------------- a consumed plan is not replayable --

test('A. a completed run cannot be replayed with the same plan', async () => {
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2 });
  const plan = planned.body['plan'] as Record<string, any>;
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);
  await drainQueue();
  assert.equal(calls.length, 2);
  calls = [];

  // The original job is finished, so job idempotency no longer collapses anything --
  // which is deliberate, and is exactly what made a second job carrying the same
  // plan reference executable.
  const { enqueueConfirmedMarketResearch } = await import('../src/workers/enqueue.js');
  const replay = await enqueueConfirmedMarketResearch({
    verticalProfileId: plan['verticalProfileId'], geographyType: plan['geographyType'],
    geographyValue: plan['geographyValue'], marketId: plan['marketId'],
    requestedBy: (await makeOperator()).userId, queryBudget: plan['searches'].length,
    confirmedPlan: { planId: planned.body['planId'], planHash: planned.body['planHash'] },
  });
  assert.equal(replay.ok, false, 'a consumed plan was claimed a second time');
  assert.equal(replay.ok ? '' : replay.code, 'ALREADY_USED');
  await drainQueue();
  assert.equal(calls.length, 0, 'a confirmed purchase was executed twice');
});

test('B. a job pointed at a plan bound to another job buys nothing', async () => {
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2 });
  const plan = planned.body['plan'] as Record<string, any>;
  assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);
  await drainQueue();
  calls = [];

  // A second job is inserted directly, carrying the same plan reference. The claim
  // above is bypassed entirely, which is the shape of an internal mistake.
  await query(
    `insert into jobs (job_type, idempotency_key, payload, requested_by, priority)
     values ('market_mine', $1, $2::jsonb, null, 80)`,
    [`market_mine:replay:${Date.now()}`, JSON.stringify({
      vertical_profile_id: plan['verticalProfileId'],
      geography_type: plan['geographyType'], geography_value: plan['geographyValue'],
      mining_mode: plan['miningMode'], market_id: null,
      query_budget: plan['searches'].length,
      confirmed_plan_id: planned.body['planId'],
      confirmed_plan_hash: planned.body['planHash'],
    })]);
  await drainQueue();

  assert.equal(calls.length, 0, 'a job executed a plan bound to a different job');
  const { rows } = await query<{ outcome: string; outcome_reason: string }>(
    `select outcome, outcome_reason from jobs
      where job_type = 'market_mine' order by created_at desc limit 1`);
  assert.equal(rows[0]!.outcome, 'DISCOVERY_BLOCKED');
  assert.match(rows[0]!.outcome_reason, /authorised a different job/);
});

test('C. the ordinary browser path still works end to end', async () => {
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 3 });
  const submitted = await confirm(planned.body['planId'], planned.body['planHash']);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  assert.equal(submitted.body['created'], true);
  await drainQueue();

  assert.deepEqual(calls, previewedCalls(planned.body['plan'] as Record<string, any>));

  // And the plan records which run it became.
  const { rows } = await query<{ consumed_job_id: string | null }>(
    'select consumed_job_id from search_plan_previews where plan_id = $1',
    [planned.body['planId']]);
  assert.equal(rows[0]!.consumed_job_id, submitted.body['jobId']);
});

test('D. a job is never visible before its plan is bound to it', async () => {
  // The binding is written in the transaction that creates the job, so there is no
  // moment where a worker could see an executable confirmed job whose plan still
  // points at nothing. Asserted as the invariant rather than by racing a worker:
  // every queued confirmed job has a plan bound to exactly it.
  recordingAdapter();
  for (let index = 0; index < 3; index += 1) {
    const planned = await preview({
      verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
      queryBudget: 1 + index });
    assert.equal((await confirm(planned.body['planId'], planned.body['planHash'])).status, 200);
    // Drained between confirmations: a second confirmation while the first run is
    // still queued is refused as a conflicting active run, which is a different rule
    // and is tested on its own above.
    await drainQueue();
  }

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs j
      where j.job_type = 'market_mine'
        and j.payload->>'confirmed_plan_id' is not null
        and not exists (
          select 1 from search_plan_previews p
           where p.plan_id = (j.payload->>'confirmed_plan_id')::uuid
             and p.consumed_at is not null
             and p.consumed_job_id = j.job_id)`);
  assert.equal(rows[0]!.n, 0, 'a confirmed job exists whose plan is not bound to it');
});

test('E. a double-click still authorises exactly one job', async () => {
  recordingAdapter();
  const planned = await preview({
    verticalProfileId: 'roofing', geography: { type: 'zip_zcta', value: ZIP },
    queryBudget: 2 });
  const [first, second] = await Promise.all([
    confirm(planned.body['planId'], planned.body['planHash']),
    confirm(planned.body['planId'], planned.body['planHash']),
  ]);
  assert.equal([first.status, second.status].filter((status) => status === 200).length, 1,
    'a double-click authorised two runs');

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.n, 1);
  await drainQueue();
  assert.equal(calls.length, 2);
});
