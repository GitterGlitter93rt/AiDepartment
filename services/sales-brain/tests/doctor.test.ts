import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query, withTransaction } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { upsertAccount } from '../src/domain/accounts.js';
import { recordHeartbeat, drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  clearDiscoveryAdapters, registerDiscoveryAdapter, refusedDiscovery,
} from '../src/workers/marketMiner.js';
import { enqueueMarketResearch, enqueueAccountResearch } from '../src/workers/enqueue.js';
import { resetBuildIdentity } from '../src/release/identity.js';
import {
  captureDiagnostics, diagnose, diagnoseRun, renderDiagnostics,
} from '../src/release/doctor.js';
import { observationsFor } from './support/observations.js';

/**
 * Where it broke, rather than a wall of numbers.
 * Authority: Issue #3 G.
 *
 * The live canary will fail the first time in a way nobody predicted, and the
 * question in that moment is always the same: is this two builds against one
 * database, a queue nobody is serving, a provider that owes us an answer, a
 * collection that failed, an ingestion that dropped everything, research that never
 * ran, scoring that never ran, or a page reading a projection that has not caught up?
 *
 * Eight different next actions, and the numbers alone do not choose between them.
 * What is tested here is mostly the choosing -- and the refusal to choose when the
 * state does not say.
 */

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => {
  clearDiscoveryAdapters(); delete process.env['BUILD_SHA']; resetBuildIdentity();
  await pool.end();
});
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  resetBuildIdentity();
});

function category(diagnoses: Awaited<ReturnType<typeof diagnoseRun>>, name: string) {
  return diagnoses.find((diagnosis) => diagnosis.category === name);
}

// ---------------------------------------------------------------- the capture ---

test('the report carries no credential and no provider body', async () => {
  process.env['DATAFORSEO_PASSWORD'] = 'doctor-secret-value';
  const state = await captureDiagnostics();
  const rendered = renderDiagnostics(state, diagnose(state));

  for (const secret of ['doctor-secret-value', 'DATAFORSEO_PASSWORD']) {
    assert.ok(!rendered.includes(secret), `the report contains ${secret}`);
    assert.ok(!JSON.stringify(state).includes(secret));
  }
  assert.match(rendered, /No credentials or provider response bodies/);
  delete process.env['DATAFORSEO_PASSWORD'];
});

test('a healthy empty system says so rather than inventing a fault', async () => {
  const state = await captureDiagnostics();
  const diagnoses = diagnose(state);
  assert.deepEqual(diagnoses.map((diagnosis) => diagnosis.category), ['HEALTHY']);
  assert.match(diagnoses[0]!.action, /say what you saw/,
    'a healthy report does not tell the operator what to do when it is still wrong');
});

// -------------------------------------------------------------- the diagnosis ---

test('two builds against one database is named before anything downstream', async () => {
  process.env['BUILD_SHA'] = 'worker-old';
  resetBuildIdentity();
  await recordHeartbeat();
  process.env['BUILD_SHA'] = 'api-new';
  resetBuildIdentity();

  const diagnoses = diagnose(await captureDiagnostics());
  assert.equal(diagnoses[0]!.category, 'BUILD_SKEW',
    'a version skew was reported after its own symptoms');
  assert.match(diagnoses[0]!.finding, /api-new/);
  assert.match(diagnoses[0]!.finding, /worker-old/);
});

test('a queue nobody serves is not reported as a miner fault', async () => {
  // The ordering that matters most. A starved queue also looks like research that
  // never ran, and sending an operator to investigate research when no worker exists
  // sends them to the wrong place entirely.
  const ops = await makeUser(`Doctor Ops ${Date.now()}`, 'RESEARCH_OPS');
  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId });

  const diagnoses = diagnose(await captureDiagnostics());
  const starved = category(diagnoses, 'QUEUE_STARVED')!;
  assert.ok(starved, diagnoses.map((d) => d.category).join(', '));
  assert.match(starved.finding, /none of it has run/,
    'the report does not say that nothing below the line is a miner fault');
  assert.match(starved.action, /stack\.sh start/);
});

test('a draining worker with work waiting is its own finding', async () => {
  const ops = await makeUser(`Doctor Drain ${Date.now()}`, 'RESEARCH_OPS');
  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId });
  await recordHeartbeat();
  await query(`update worker_instances set draining_since = now()`);

  const diagnoses = diagnose(await captureDiagnostics());
  const starved = category(diagnoses, 'QUEUE_STARVED')!;
  assert.match(starved.finding, /draining and taking no new work/);
});

test('a provider that owes us an answer is told apart from one that lost it', async () => {
  await query(
    `insert into provider_tasks (provider, provider_native_id, fingerprint, submitted_at)
     values ('doctor', 'fresh-1', 'fp-1', now() - interval '2 hours')`);
  let diagnoses = diagnose(await captureDiagnostics());
  assert.ok(category(diagnoses, 'PROVIDER_PENDING'),
    'a task the provider has not finished yet was reported as a failure');

  await query(
    `update provider_tasks set submitted_at = now() - interval '3 days'`);
  diagnoses = diagnose(await captureDiagnostics());
  const failed = category(diagnoses, 'COLLECTION_FAILED')!;
  assert.ok(failed, 'a task outstanding for three days was still called pending');
  assert.match(failed.finding, /paid for and never read/);
});

test('research nobody queued is separated from research that failed', async () => {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Doctor Stranded', website: 'https://doctorstranded.invalid',
    phone: '904-555-9601', city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'market_miner:doctor' }));
  await query(
    `update accounts set created_at = now() - interval '2 hours' where account_id = $1`,
    [accountId]);

  const stranded = category(diagnose(await captureDiagnostics()), 'RESEARCH_FAILED')!;
  assert.ok(stranded);
  assert.match(stranded.finding, /never been researched and have nothing queued/);
});

test('a researched company with no score is a scoring fault, and says why it matters', async () => {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Doctor Unscored', website: 'https://doctorunscored.invalid',
    phone: '904-555-9602', city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'market_miner:doctor' }));
  await query(
    `update accounts set last_researched_at = now(),
            research_fresh_until = now() + interval '10 days' where account_id = $1`,
    [accountId]);

  const scoring = category(diagnose(await captureDiagnostics()), 'SCORING_FAILED')!;
  assert.ok(scoring);
  assert.match(scoring.finding, /not ranked, so a rep never sees it/,
    'the finding does not say what an unscored company costs');
});

test('scores from an older ruleset are a stale projection, not a failure', async () => {
  const { accountId } = await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'Doctor Old Policy', website: 'https://doctoroldpolicy.invalid',
    phone: '904-555-9603', city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'market_miner:doctor' }));
  await query(
    `update accounts set manual_tier = 'B', manual_score = 7, score_version = 'ancient'
      where account_id = $1`, [accountId]);

  const diagnoses = diagnose(await captureDiagnostics());
  const stale = category(diagnoses, 'PROJECTION_STALE')!;
  assert.ok(stale);
  assert.match(stale.action, /Nothing needs doing unless/,
    'a self-healing condition was reported as something to act on');
});

// ------------------------------------------------------------------- one run ----

test('a run whose rows went nowhere is an ingestion fault, not a thin market', async () => {
  // The distinction a database-wide count cannot make: a million Accounts and a
  // quiet day look identical in aggregate.
  //
  // The shape is asserted against a stored job rather than manufactured by an
  // adapter, because an adapter can no longer produce it: rows in and identities out
  // are both counted by the orchestrator now, so a row that reaches it is either
  // resolved, rejected or refused promotion, and every one of those is a counter.
  // That is the fix; this is the alarm for the day something breaks it.
  registerDiscoveryAdapter({
    name: 'doctor-quiet', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() { return { status: 'ZERO_RESULTS' as const, observations: [] }; },
  });
  const ops = await makeUser(`Doctor Ingest ${Date.now()}`, 'RESEARCH_OPS');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId, queryBudget: 1 });
  await drainQueue();

  await query(
    `update jobs set progress = progress || $2::jsonb where job_id = $1`,
    [job.jobId, JSON.stringify({
      providerRows: 12, discoveredNew: 0, matchedExisting: 0, excludedByVertical: 0,
      rejectedRows: 0, entitiesRejected: 0, entitiesNeedingReview: 0,
    })]);

  const dropped = category(await diagnoseRun(job.jobId), 'INGESTION_DROPPED')!;
  assert.ok(dropped, 'twelve rows that became nothing were reported as a normal run');
  assert.match(dropped.finding, /went somewhere unaccounted for/);
  assert.match(dropped.action, /rather than a thin market/);
});

test('twelve rows that were all directories is an answer, not an ingestion fault', async () => {
  // The most common honest outcome of entity resolution. Every row is accounted for
  // -- in `discovery_candidates`, with a reason each -- so reporting it as a fault
  // would send an operator to debug a pipeline that did exactly what it should.
  registerDiscoveryAdapter({
    name: 'doctor-directories', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() { return { status: 'ZERO_RESULTS' as const, observations: [] }; },
  });
  const ops = await makeUser(`Doctor Directories ${Date.now()}`, 'RESEARCH_OPS');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId, queryBudget: 1 });
  await drainQueue();

  await query(
    `update jobs set progress = progress || $2::jsonb where job_id = $1`,
    [job.jobId, JSON.stringify({
      providerRows: 12, discoveredNew: 0, matchedExisting: 0, excludedByVertical: 0,
      rejectedRows: 0, entitiesRejected: 11, entitiesNeedingReview: 1,
    })]);

  assert.equal(category(await diagnoseRun(job.jobId), 'INGESTION_DROPPED'), undefined,
    'a run that refused every identity it resolved was called an ingestion fault');
});

test('a run that matched everything it found is coverage, and says so', async () => {
  await withTransaction((client) => upsertAccount(client, {
    canonicalName: 'doctorknown.invalid', website: 'https://doctorknown.invalid',
    phone: null, city: 'St. Augustine', state: 'FL', postalCode: '32095',
    verticalProfileId: 'hvac',
  }, { discoverySource: 'import' }));

  registerDiscoveryAdapter({
    name: 'doctor-known', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      return { status: 'OK' as const,
        observations: observationsFor([{ name: 'doctorknown.invalid', website: 'https://doctorknown.invalid',
          phone: null, city: null, state: null, postalCode: null }]),
        };
    },
  });
  const ops = await makeUser(`Doctor Known ${Date.now()}`, 'RESEARCH_OPS');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId, queryBudget: 1 });
  await drainQueue();

  const healthy = category(await diagnoseRun(job.jobId), 'HEALTHY')!;
  assert.ok(healthy);
  assert.match(healthy.finding, /market being covered, not an empty market/);
});

test('a blocked run repeats the reason it was blocked, with nothing added', async () => {
  const ops = await makeUser(`Doctor Blocked ${Date.now()}`, 'RESEARCH_OPS');
  const job = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    marketId: null, requestedBy: ops.userId, queryBudget: 1 });
  await drainQueue();

  const diagnoses = await diagnoseRun(job.jobId);
  const blocked = diagnoses.find((diagnosis) => /provider/i.test(diagnosis.finding));
  assert.ok(blocked, diagnoses.map((d) => d.finding).join(' | '));
  assert.match(blocked!.action, /credential, a budget, or a vertical/);
});

test('an unknown job id is answered, not guessed at', async () => {
  const diagnoses = await diagnoseRun('00000000-0000-0000-0000-000000000000');
  assert.equal(diagnoses[0]!.category, 'UNEXPLAINED');
  assert.match(diagnoses[0]!.finding, /No job/);
});

test('the doctor only reads', async () => {
  const before = await query<{ n: number }>(
    `select (select count(*) from accounts) + (select count(*) from jobs)
            + (select count(*) from evidence_records) as n`);
  await captureDiagnostics();
  const after = await query<{ n: number }>(
    `select (select count(*) from accounts) + (select count(*) from jobs)
            + (select count(*) from evidence_records) as n`);
  assert.equal(Number(after.rows[0]!.n), Number(before.rows[0]!.n),
    'a diagnostic report changed the thing it was reporting on');
});
