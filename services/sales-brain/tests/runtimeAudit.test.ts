import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pool, query } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { planCanary } from '../src/miner/canary.js';
import { normalizeGeography, classifyGeography } from '../src/miner/geography.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { captureDiagnostics, diagnose, type Diagnostics } from '../src/release/doctor.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * The three defects the live-runtime audit found.
 *
 * All three had the same character: each was invisible in the dry path and only
 * appeared in the live one, so a test of the thing that was printed passed while the
 * thing that ran was wrong.
 */

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => { await resetDatabase(); await syncVerticalProfiles(); });

// =============================================================================
// 1 · the canary queues the plan it printed
// =============================================================================

const CANARY_BASE = {
  vertical: 'roofing', count: 3, maxCostCents: 100,
  live: false, confirmSpendCents: null, causes: [] as string[],
  miningMode: 'advertiser_first',
};

/** What the fixed bin composes: the plan's type, the operator's original text. */
async function enqueueLikeCanary(location: string): Promise<Record<string, unknown>> {
  const plan = await planCanary({ ...CANARY_BASE, location });
  assert.ok(plan.geography, `the plan classified no geography for "${location}"`);
  const operator = await makeUser(`Canary Operator ${location}`, 'ADMIN');
  const job = await enqueueMarketResearch({
    verticalProfileId: CANARY_BASE.vertical,
    geographyType: plan.geography!.type,
    geographyValue: location,
    marketId: null,
    requestedBy: operator.userId,
    miningMode: CANARY_BASE.miningMode,
    queryBudget: plan.searches.length,
  });
  const { rows } = await query<{ payload: Record<string, unknown> }>(
    'select payload from jobs where job_id = $1', [job.jobId]);
  return rows[0]!.payload;
}

test('the dry plan reads 32095 as a ZIP', async () => {
  const plan = await planCanary({ ...CANARY_BASE, location: '32095' });
  assert.equal(plan.geography?.type, 'zip_zcta');
  assert.equal(plan.geography?.value, '32095');
});

test('the queued job keeps the ZIP classification the plan printed', async () => {
  // The defect: the bin passed `geographyType: null`, so the job was queued with
  // geography_type null, the worker could plan no searches, and the run was reported
  // as PROVIDER_UNAVAILABLE about a provider it never asked.
  const payload = await enqueueLikeCanary('32095');
  assert.equal(payload['geography_type'], 'zip_zcta',
    'the live path lost the geography type the plan had already worked out');
  assert.equal(payload['geography_value'], '32095');
  assert.equal(payload['geography_state'], null);
});

test('a city keeps its city type and its state', async () => {
  const payload = await enqueueLikeCanary('Jacksonville, FL');
  assert.equal(payload['geography_type'], 'city');
  assert.equal(payload['geography_value'], 'Jacksonville');
  assert.equal(payload['geography_state'], 'FL',
    'the state was dropped, so the city cannot be located');
  assert.equal(payload['geography_display'], 'Jacksonville, FL');
  // And the plan itself now reports the reading, where it used to report nothing for
  // any city at all.
  const plan = await planCanary({ ...CANARY_BASE, location: 'Jacksonville, FL' });
  assert.equal(plan.geography?.type, 'city');
  assert.equal(plan.geography?.display, 'Jacksonville, FL');
  assert.ok(plan.searches.length > 0,
    'a city planned no searches, which is how this defect looked: only ZIPs worked');
});

test('a state keeps its state type', async () => {
  const payload = await enqueueLikeCanary('Florida');
  assert.equal(payload['geography_type'], 'state');
  assert.equal(payload['geography_value'], 'FL');
});

test('the operator’s original text is what gets re-read, not the stored value',
  async () => {
  // Why the fix passes `options.location` rather than `plan.geography.value`: the
  // value is normalised for storage and a city loses its state, which
  // `normalizeGeography` then correctly refuses as ambiguous. Type plus original text
  // is exactly what `classifyGeography` feeds `normalizeGeography` internally, so
  // this reproduces the plan's reading rather than adding a second one.
  const plan = await planCanary({ ...CANARY_BASE, location: 'Jacksonville, FL' });
  assert.equal(plan.geography!.value, 'Jacksonville');
  const fromStoredValue = normalizeGeography(plan.geography!.type, plan.geography!.value);
  assert.equal(fromStoredValue.ok, false,
    'if this ever succeeds the fix may pass the stored value instead');
  const fromOriginal = normalizeGeography(plan.geography!.type, 'Jacksonville, FL');
  assert.equal(fromOriginal.ok, true);
  assert.equal(fromOriginal.ok && fromOriginal.state, 'FL');
});

test('a malformed location is refused by the plan, before anything is bought',
  async () => {
  const plan = await planCanary({ ...CANARY_BASE, location: 'somewhere nice' });
  assert.equal(plan.wouldRun, false);
  // And no provider was asked and nothing was spent: there is nothing to spend on
  // until a job exists, and the plan refuses before one is created.
  const { rows } = await query<{ n: number }>('select count(*)::int as n from jobs');
  assert.equal(rows[0]!.n, 0, 'a refused plan queued a job anyway');
  const usage = await query<{ n: number }>('select count(*)::int as n from provider_usage');
  assert.equal(usage.rows[0]!.n, 0);
});

test('a rejected geography names what was actually rejected', async () => {
  // The message interpolated the *type*, so a missing type produced `"that" is not a
  // geography this system searches` -- naming neither the absent type nor the
  // perfectly good ZIP, and sending everybody to look at the ZIP.
  const noType = normalizeGeography(null, '32095');
  assert.equal(noType.ok, false);
  assert.ok(!noType.ok && noType.message.includes('32095'),
    `the message does not name the input: ${!noType.ok ? noType.message : ''}`);
  assert.ok(!noType.ok && /no geography type/.test(noType.message));
  assert.ok(!noType.ok && !/"that"/.test(noType.message), 'still says "that"');

  const badType = normalizeGeography('county', '32095');
  assert.ok(!badType.ok && badType.message.includes('county'));
  assert.ok(!badType.ok && badType.message.includes('32095'));
});

test('the canary source passes the plan’s type, not null', async () => {
  // The behaviour above is composed in a bin with top-level await that cannot be
  // imported, so the composition itself is asserted here. This is the line that was
  // wrong.
  const source = readFileSync(new URL('../src/bin/miner-canary.ts', import.meta.url), 'utf8');
  const call = source.slice(source.indexOf('const job = await enqueueMarketResearch('));
  assert.ok(!/geographyType:\s*null/.test(call),
    'miner-canary.ts still enqueues with geographyType: null');
  assert.ok(/geographyType:\s*plan\.geography\.type/.test(call),
    'miner-canary.ts does not carry the plan’s own classification');
  assert.ok(/geographyValue:\s*options\.location/.test(call),
    'miner-canary.ts should re-read the operator’s original text');
});

// =============================================================================
// 2 · the doctor counts only workers that are actually running
// =============================================================================

async function insertWorker(input: {
  id: string; sha: string; online: boolean;
}): Promise<void> {
  await query(
    `insert into worker_instances
       (worker_id, hostname, pid, build_sha, started_at, stopped_at, last_heartbeat_at)
     values ($1, 'audit-host', 1, $2, now() - interval '1 hour',
             case when $3 then null else now() - interval '30 minutes' end,
             case when $3 then now() else now() - interval '30 minutes' end)`,
    [input.id, input.sha, input.online]);
}

test('historical workers are not reported as the builds now serving', async () => {
  // The builds column was the only one in that query with no filter, so a box that
  // had been restarted three times reported three builds for ever.
  await insertWorker({ id: 'hist-a', sha: 'aaaaaaa', online: false });
  await insertWorker({ id: 'hist-b', sha: 'bbbbbbb', online: false });
  await insertWorker({ id: 'live-c', sha: 'ccccccc', online: true });

  const state = await captureDiagnostics();
  assert.deepEqual(state.build.workers, ['ccccccc'],
    `the doctor still reads stopped workers: ${state.build.workers.join(', ')}`);
  assert.equal(state.workers.online, 1);
  assert.equal(state.workers.known, 3, 'the known count should still see all of them');
});

test('one online worker on the API’s build is not build skew', async () => {
  await insertWorker({ id: 'hist-a', sha: 'aaaaaaa', online: false });
  await insertWorker({ id: 'hist-b', sha: 'bbbbbbb', online: false });
  await insertWorker({ id: 'live-c', sha: 'ccccccc', online: true });

  const state = await captureDiagnostics();
  const skew = diagnose({ ...state,
    build: { ...state.build, api: 'ccccccc', migrationsExpected: 1 },
    schema: { ...state.schema, pending: [], changed: [] },
  }).filter((d) => d.category === 'BUILD_SKEW');
  assert.deepEqual(skew, [],
    `BUILD_SKEW was reported for stopped workers: ${skew.map((d) => d.finding).join(' | ')}`);
});

test('a second online worker on a different build is build skew', async () => {
  // The other half: the check has to still fire for the thing it is for.
  await insertWorker({ id: 'hist-a', sha: 'aaaaaaa', online: false });
  await insertWorker({ id: 'live-c', sha: 'ccccccc', online: true });
  await insertWorker({ id: 'live-d', sha: 'ddddddd', online: true });

  const state = await captureDiagnostics();
  assert.deepEqual(state.build.workers.sort(), ['ccccccc', 'ddddddd']);
  const skew = diagnose({ ...state,
    build: { ...state.build, api: 'ccccccc', migrationsExpected: 1 },
    schema: { ...state.schema, pending: [], changed: [] },
  }).filter((d) => d.category === 'BUILD_SKEW');
  assert.equal(skew.length, 1, 'a genuinely mismatched online worker was not reported');
  assert.match(skew[0]!.finding, /ddddddd/);
});

test('no online worker reports no builds rather than the last one that ran', async () => {
  await insertWorker({ id: 'hist-a', sha: 'aaaaaaa', online: false });
  const state = await captureDiagnostics();
  assert.deepEqual(state.build.workers, [],
    'a stopped worker is still being named as a build in service');
  const skew = diagnose({ ...state,
    build: { ...state.build, api: 'ccccccc', migrationsExpected: 1 },
    schema: { ...state.schema, pending: [], changed: [] },
  }).filter((d) => d.category === 'BUILD_SKEW');
  assert.deepEqual(skew, [], 'an offline worker produced a build-skew warning');
});

void (null as unknown as Diagnostics);
