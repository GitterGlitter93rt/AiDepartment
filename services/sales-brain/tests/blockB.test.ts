import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters, mayBuyNewSearch,
  type DiscoveryAdapter, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { scheduleDueMarkets, DECLINED_RETRY_HOURS, backoffHours } from '../src/workers/marketScheduler.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { recordProviderTask, MAX_TASK_COLLECTIONS } from '../src/miner/providerTasks.js';
import { searchFingerprintPrefix } from '../src/miner/searchPlan.js';
import { discoveryCoverageFor } from '../src/domain/search.js';
import { operationalSnapshot } from '../src/api/operations.js';
import { runConvergence, runPauseInBacklog } from './support/blockBConverge.js';
import { sustainableMarketCount, SWEEP_INTERVAL_MS,
         MAX_MARKETS_IN_FLIGHT, DEFAULT_REFRESH_INTERVAL_HOURS } from '../src/workers/marketScheduler.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Block B, defect B2-1: a market switched off after its refresh was queued.
 *
 * `enabled` was read exactly once, by the scheduler, at the moment a job was
 * created. Nothing downstream ever looked again, so a market an operator paused went
 * on buying searches for as long as its queued run took to reach the front of the
 * worker's queue -- and a run with a plan of N searches submitted all N.
 *
 * The invariant being pinned here is narrow and it cuts both ways. Off means: create
 * no new chargeable provider task. It does not mean abandon a task already paid for,
 * throw away results already returned, lose cost or provenance, treat a PENDING task
 * as cancelled, or report the market as empty. A refusal to spend is not a finding
 * about the market, and the expensive mistake in either direction is the same one:
 * paying twice, or paying once and discarding the answer.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
});

/** Counts what it was actually asked to buy, which is the whole question here. */
interface CountingAdapter extends DiscoveryAdapter {
  submissions: () => number;
  collections: () => number;
}

function countingAdapter(options: {
  businesses?: number;
  /** Return an accepted-but-unanswered task instead of an answer. */
  pending?: boolean;
  /** Run before each submission, to simulate an operator acting mid-flight. */
  beforeSubmit?: () => Promise<void>;
  /** What a collection of a previously accepted task returns. */
  collectResult?: () => DiscoveryResult;
} = {}): CountingAdapter {
  let submissions = 0;
  let collections = 0;
  const adapter: CountingAdapter = {
    name: 'blockb-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    submissions: () => submissions,
    collections: () => collections,
    async discover(): Promise<DiscoveryResult> {
      submissions += 1;
      if (options.beforeSubmit) await options.beforeSubmit();
      if (options.pending) {
        return {
          status: 'PENDING', businesses: [], providerRows: 0, rejectedRows: 0,
          duplicateRows: 0, providerTaskId: `task-${submissions}-${++sequence}`,
        };
      }
      const count = options.businesses ?? 0;
      return {
        status: count > 0 ? 'OK' : 'ZERO_RESULTS',
        businesses: Array.from({ length: count }, (_, index) => ({
          name: `Block B Find ${++sequence}-${index}`, website: null,
          phone: `904-555-${String(6000 + sequence).slice(-4)}`,
        })),
        providerRows: count, rejectedRows: 0, duplicateRows: 0, costUsd: 0.0125,
      };
    },
    async collect(): Promise<DiscoveryResult> {
      collections += 1;
      if (options.collectResult) return options.collectResult();
      return {
        status: 'OK',
        businesses: [{
          name: `Block B Collected ${++sequence}`, website: null,
          phone: `904-555-${String(6500 + sequence).slice(-4)}`,
        }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, costUsd: 0.0125,
      };
    },
  };
  return adapter;
}

async function market(name: string, options: {
  enabled?: boolean; zip?: string; dueAt?: string | null;
} = {}): Promise<string> {
  sequence += 1;
  const { rows } = await query<{ market_id: string }>(
    `insert into saved_markets
       (name, vertical_profile_id, geography_type, geography_definition, mining_mode,
        enabled, next_refresh_at)
     values ($1, 'hvac', 'zip_zcta', jsonb_build_object('value', $2::text),
             'advertiser_first', $3, $4::timestamptz)
     returning market_id`,
    [name, options.zip ?? `3210${sequence % 10}`, options.enabled ?? true,
     options.dueAt === undefined ? null : options.dueAt]);
  return rows[0]!.market_id;
}

async function setEnabled(marketId: string, enabled: boolean): Promise<void> {
  await query('update saved_markets set enabled = $2 where market_id = $1',
    [marketId, enabled]);
}

async function marketRow(marketId: string) {
  const { rows } = await query<Record<string, any>>(
    `select enabled, last_outcome, last_outcome_reason, consecutive_failures,
            next_refresh_at, blocker_reason, last_success_at
       from saved_markets where market_id = $1`, [marketId]);
  return rows[0]!;
}

async function jobsFor(marketId: string) {
  const { rows } = await query<Record<string, any>>(
    `select job_id, status, outcome, outcome_reason, requested_by
       from jobs where market_id = $1 and job_type = 'market_mine'
      order by created_at asc`, [marketId]);
  return rows;
}

async function providerTasks() {
  const { rows } = await query<Record<string, any>>(
    `select provider_task_id, provider, provider_native_id, fingerprint, status,
            cost_usd, poll_attempts, job_id
       from provider_tasks order by submitted_at asc`);
  return rows;
}

/** The scheduler enqueues with no requester; that is what makes a run automatic. */
async function queueScheduledRun(marketId: string): Promise<void> {
  const { rows } = await query<Record<string, any>>(
    `select vertical_profile_id, geography_definition, mining_mode
       from saved_markets where market_id = $1`, [marketId]);
  await enqueueMarketResearch({
    verticalProfileId: rows[0]!.vertical_profile_id,
    geographyType: 'zip_zcta',
    geographyValue: String(rows[0]!.geography_definition.value),
    marketId,
    requestedBy: null as unknown as string,
    miningMode: rows[0]!.mining_mode,
  });
}

// =============================================================================
// B2-1 · the ten-item matrix
// =============================================================================

test('B2-1.1 enabled at enqueue and at execution: the search is submitted', async () => {
  const adapter = countingAdapter({ businesses: 2 });
  registerDiscoveryAdapter(adapter);
  const marketId = await market('B2 Still Enabled');

  await queueScheduledRun(marketId);
  await drainQueue();

  assert.equal(adapter.submissions(), 1, 'an enabled market must still be searched');
  const jobs = await jobsFor(marketId);
  assert.equal(jobs[0]!.outcome, 'COMPLETED');
  const row = await marketRow(marketId);
  assert.equal(row.last_outcome, 'COMPLETED');
  assert.ok(row.last_success_at, 'a completed search did not record a success');
});

test('B2-1.2 disabled between enqueue and lease: zero new provider tasks', async () => {
  const adapter = countingAdapter({ businesses: 2 });
  registerDiscoveryAdapter(adapter);
  const marketId = await market('B2 Disabled Before Lease');

  await queueScheduledRun(marketId);
  // The operator acts while the job is still sitting in the queue.
  await setEnabled(marketId, false);
  await drainQueue();

  assert.equal(adapter.submissions(), 0,
    'a market switched off before the worker reached it was still charged for');
  assert.equal((await providerTasks()).length, 0);
  const jobs = await jobsFor(marketId);
  assert.equal(jobs[0]!.outcome, 'MARKET_DISABLED');
  assert.match(jobs[0]!.outcome_reason, /switched off/);
  assert.match(jobs[0]!.outcome_reason, /nothing was charged/);
});

test('B2-1.3 disabled after the handler starts, before the first submission', async () => {
  // The window the once-at-start check leaves open. The adapter is never reached, so
  // the disable has to be seen by the submission boundary itself.
  const marketId = await market('B2 Disabled Mid-Handler');
  let submissions = 0;
  registerDiscoveryAdapter({
    name: 'blockb-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      submissions += 1;
      return { status: 'ZERO_RESULTS', businesses: [], providerRows: 0,
        rejectedRows: 0, duplicateRows: 0 };
    },
  });

  await queueScheduledRun(marketId);
  // Disabled after the run exists and before the handler runs: the same instant the
  // real race occupies, and the only place a check can still catch it.
  await setEnabled(marketId, false);
  await drainQueue();

  assert.equal(submissions, 0);
  const jobs = await jobsFor(marketId);
  assert.equal(jobs[0]!.outcome, 'MARKET_DISABLED');
});

test('B2-1.4 several planned searches: the ones not yet submitted are not submitted',
  async () => {
  // The reason the check is per-submission rather than once per handler. The first
  // search is accepted and paid for; the market is switched off while it is in
  // flight; the rest of the plan must stop.
  const marketId = await market('B2 Multi Search');
  let submissions = 0;
  registerDiscoveryAdapter({
    name: 'blockb-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      submissions += 1;
      // The operator disables the market during the first submission.
      if (submissions === 1) await setEnabled(marketId, false);
      return { status: 'OK',
        businesses: [{ name: `Block B Multi ${++sequence}`, website: null,
          phone: `904-555-${String(6800 + sequence).slice(-4)}` }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, costUsd: 0.0125 };
    },
  });

  const { rows } = await query<Record<string, any>>(
    `select geography_definition from saved_markets where market_id = $1`, [marketId]);
  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta',
    geographyValue: String(rows[0]!.geography_definition.value),
    marketId, requestedBy: null as unknown as string,
    miningMode: 'advertiser_first', queryBudget: 4,
  });
  await drainQueue();

  assert.equal(submissions, 1,
    `${submissions} searches were bought; only the one already in flight should have been`);

  // What the first search found is kept: it was paid for.
  const { rows: accounts } = await query<{ n: number }>(
    `select count(*)::int as n from accounts where canonical_name like 'Block B Multi%'`);
  assert.equal(accounts[0]!.n, 1, 'a paid-for result was discarded');
});

test('B2-1.5 a PENDING task is still collected, and keeps its cost and provenance',
  async () => {
  const adapter = countingAdapter({});
  registerDiscoveryAdapter(adapter);
  const marketId = await market('B2 Pending Then Disabled', { zip: '32077' });

  // A previous run bought this search and the provider has not answered yet.
  const fingerprintPrefix = searchFingerprintPrefix({
    marketId, verticalProfileId: 'hvac', geographyType: 'zip_zcta',
    geographyValue: '32077', miningMode: 'advertiser_first',
  });
  const { planDiscoverySearches } = await import('../src/miner/searchPlan.js');
  const plan = await planDiscoverySearches({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32077',
    miningMode: 'advertiser_first', count: 1, marketId });
  await recordProviderTask({
    provider: 'blockb-provider', providerNativeId: 'paid-already-1',
    fingerprint: plan.searches[0]!.fingerprint });
  assert.ok(plan.searches[0]!.fingerprint.startsWith(fingerprintPrefix));

  await queueScheduledRun(marketId);
  await setEnabled(marketId, false);
  await drainQueue();

  // Collected, not abandoned: the money is already spent.
  assert.equal(adapter.collections(), 1,
    'a search already paid for was not collected because the market was paused');
  assert.equal(adapter.submissions(), 0, 'a second search of the same market was bought');

  const tasks = await providerTasks();
  assert.equal(tasks.length, 1, 'a disabled market bought another task');
  assert.equal(tasks[0]!.status, 'COLLECTED');
  assert.equal(Number(tasks[0]!.cost_usd), 0.0125, 'the cost of a paid search was lost');
  assert.equal(tasks[0]!.provider, 'blockb-provider');
  assert.equal(tasks[0]!.provider_native_id, 'paid-already-1',
    'the provider identity of a paid task was lost');

  // And the businesses it returned reached inventory.
  const { rows: accounts } = await query<{ n: number }>(
    `select count(*)::int as n from accounts where canonical_name like 'Block B Collected%'`);
  assert.equal(accounts[0]!.n, 1, 'paid-for evidence was discarded');
});

test('B2-1.6 a returned result is ingested rather than discarded', async () => {
  // Same shape as .5 but with the result already in hand: the ingestion half must
  // complete on its own merits, and the task must not be left open.
  const adapter = countingAdapter({
    collectResult: () => ({
      status: 'OK',
      businesses: [
        { name: `Block B Returned A ${++sequence}`, website: null,
          phone: `904-555-${String(7100 + sequence).slice(-4)}` },
        { name: `Block B Returned B ${++sequence}`, website: null,
          phone: `904-555-${String(7200 + sequence).slice(-4)}` },
      ],
      providerRows: 2, rejectedRows: 0, duplicateRows: 0, costUsd: 0.02,
    }),
  });
  registerDiscoveryAdapter(adapter);
  const marketId = await market('B2 Returned Then Disabled', { zip: '32078' });

  const { planDiscoverySearches } = await import('../src/miner/searchPlan.js');
  const plan = await planDiscoverySearches({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32078',
    miningMode: 'advertiser_first', count: 1, marketId });
  await recordProviderTask({
    provider: 'blockb-provider', providerNativeId: 'paid-already-2',
    fingerprint: plan.searches[0]!.fingerprint });

  await queueScheduledRun(marketId);
  await setEnabled(marketId, false);
  await drainQueue();

  const { rows: accounts } = await query<{ n: number }>(
    `select count(*)::int as n from accounts where canonical_name like 'Block B Returned%'`);
  assert.equal(accounts[0]!.n, 2, 'returned businesses were thrown away');

  const tasks = await providerTasks();
  assert.equal(tasks[0]!.status, 'COLLECTED');
  assert.equal(Number(tasks[0]!.cost_usd), 0.02);

  // A run that collected is reported on what it collected, and the refusal to buy
  // more is still said out loud rather than left as a silent status.
  // Reported on what it collected -- it did find businesses, and calling that
  // anything else would hide them -- while still saying the market is paused. Both
  // facts are true at once and an operator reading COMPLETED on a market they
  // switched off needs the second one.
  const jobs = await jobsFor(marketId);
  assert.equal(jobs[0]!.outcome, 'COMPLETED');
  assert.match(jobs[0]!.outcome_reason, /2 new business\(es\) added/,
    'the businesses a paid search returned are not reported');
  assert.match(jobs[0]!.outcome_reason, /switched off for new refreshes/,
    'an operator reading COMPLETED is not told the market is paused');
  assert.match(jobs[0]!.outcome_reason, /1 search\(es\) already paid for were still collected/,
    'the run does not say that what it reported came from a search already paid for');
});

test('B2-1.7 a disabled market is not re-queued by later sweeps', async () => {
  registerDiscoveryAdapter(countingAdapter({ businesses: 1 }));
  const marketId = await market('B2 Stays Disabled', { enabled: false });

  for (let pass = 0; pass < 3; pass += 1) {
    const result = await scheduleDueMarkets();
    assert.equal(result.due, 0, 'a disabled market was counted as due');
    assert.equal(result.queued, 0);
  }
  assert.equal((await jobsFor(marketId)).length, 0, 'a disabled market churned jobs');
});

test('B2-1.8 a re-enabled market becomes due again on the normal rules', async () => {
  const adapter = countingAdapter({ businesses: 1 });
  registerDiscoveryAdapter(adapter);
  const marketId = await market('B2 Re-enabled');

  await queueScheduledRun(marketId);
  await setEnabled(marketId, false);
  await drainQueue();
  assert.equal(adapter.submissions(), 0);

  // Switched off is not backed off: an operator's pause must not leave a penalty
  // waiting for the market when they switch it back on.
  const paused = await marketRow(marketId);
  assert.equal(paused.consecutive_failures, 0,
    'pausing a market recorded a failure against it');

  await setEnabled(marketId, true);
  await query(`update saved_markets set next_refresh_at = now() - interval '1 hour'
                where market_id = $1`, [marketId]);
  const result = await scheduleDueMarkets();
  assert.equal(result.due, 1);
  assert.equal(result.queued, 1, 'a re-enabled market was not picked up again');

  await drainQueue();
  assert.equal(adapter.submissions(), 1, 'a re-enabled market was not searched');

  // One logical run, not two: the earlier refused job did not leave a duplicate.
  const jobs = await jobsFor(marketId);
  assert.equal(jobs.filter((job) => job.status === 'QUEUED' || job.status === 'RUNNING').length, 0,
    'a duplicate active run survived');
});

test('B2-1.9 concurrent scheduler passes still produce one run per market', async () => {
  registerDiscoveryAdapter(countingAdapter({ businesses: 1 }));
  const marketId = await market('B2 Concurrent');

  // Genuinely concurrent, not sequential: the uniqueness has to come from the
  // database, because two passes can both read "nothing running" before either
  // writes.
  const passes = await Promise.all([
    scheduleDueMarkets(), scheduleDueMarkets(), scheduleDueMarkets(),
  ]);
  const queued = passes.reduce((total, pass) => total + pass.queued, 0);
  const jobs = await jobsFor(marketId);
  assert.equal(jobs.length, 1,
    `${jobs.length} jobs were created for one market by concurrent passes`);
  assert.ok(queued <= 1, `${queued} passes each believed they had queued the market`);
});

test('B2-1.10 a disabled market is never reported as a market with nothing in it',
  async () => {
  registerDiscoveryAdapter(countingAdapter({ businesses: 1 }));
  const marketId = await market('B2 Not Zero Results', { zip: '32079' });

  await queueScheduledRun(marketId);
  await setEnabled(marketId, false);
  await drainQueue();

  const jobs = await jobsFor(marketId);
  assert.notEqual(jobs[0]!.outcome, 'ZERO_RESULTS',
    'a refusal to spend was reported as a finding about the market');
  assert.notEqual(jobs[0]!.outcome, 'COMPLETED');
  assert.notEqual(jobs[0]!.outcome, 'FAILED');
  assert.notEqual(jobs[0]!.outcome, 'PROVIDER_UNAVAILABLE');
  assert.equal(jobs[0]!.outcome, 'MARKET_DISABLED');

  // The market row agrees, and does not carry a failure.
  const row = await marketRow(marketId);
  assert.equal(row.last_outcome, 'MARKET_DISABLED');
  assert.equal(row.consecutive_failures, 0);
  assert.ok(row.blocker_reason, 'an operator is not told why nothing is happening');

  // And the surface a rep reads does not call it an empty market either. This is
  // where it used to become ZERO_RESULTS: the state switch had no case for it and
  // the fall-through reads "no provider rows" as "nothing is there".
  const coverage = await discoveryCoverageFor({
    geographyValue: '32079', discoveryAvailable: true,
    activeJobId: null, activeJobScope: null,
  });
  assert.equal(coverage.state, 'MARKET_DISABLED',
    `a paused market reported itself to a rep as ${coverage.state}`);
});

// =============================================================================
// B2-1 · scheduled versus manual, per the contract that exists
// =============================================================================

/**
 * Nothing in the product writes `saved_markets.enabled`. There is no toggle, no
 * endpoint and no migration that sets it; the column defaults true and exactly two
 * places read it -- the scheduler, whose own documentation says "a disabled market is
 * not scheduled at all", and the operations page, which words it as "nothing is being
 * maintained on its own".
 *
 * So the contract that exists is about unattended self-maintenance, and that is the
 * reading taken here: a person who explicitly asks for a search of a paused market
 * gets it. Extending the flag to prohibit a human's own deliberate request would be
 * inventing a policy the product has never had, on a column no operator can yet set.
 * Pinned so that when a toggle is built, this decision is visible rather than
 * discovered.
 */
test('B2-1 the flag governs unattended refreshes, not a person asking directly',
  async () => {
  const adapter = countingAdapter({ businesses: 1 });
  registerDiscoveryAdapter(adapter);
  const marketId = await market('B2 Manual Against Disabled', { enabled: false });
  const operator = await makeUser('B2 Operator', 'SALES_MANAGER');

  const { rows } = await query<Record<string, any>>(
    `select geography_definition from saved_markets where market_id = $1`, [marketId]);
  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta',
    geographyValue: String(rows[0]!.geography_definition.value),
    marketId, requestedBy: operator.userId, miningMode: 'advertiser_first',
  });
  await drainQueue();

  assert.equal(adapter.submissions(), 1,
    'a person who explicitly asked for this search did not get it');
  const jobs = await jobsFor(marketId);
  assert.equal(jobs[0]!.requested_by, operator.userId);
  assert.notEqual(jobs[0]!.outcome, 'MARKET_DISABLED');
});

test('B2-1 the gate is a decision about one submission, and reads current state',
  async () => {
  // Directly, because the boundary matters more than any one path through it.
  const marketId = await market('B2 Gate Unit');
  const operator = await makeUser('B2 Gate Operator', 'SALES_MANAGER');

  assert.equal((await mayBuyNewSearch({ market_id: marketId, requested_by: null })).allowed,
    true);
  await setEnabled(marketId, false);
  const refused = await mayBuyNewSearch({ market_id: marketId, requested_by: null });
  assert.equal(refused.allowed, false, 'the gate cached a stale enabled state');
  assert.ok(!refused.allowed && /switched off/.test(refused.reason));

  // Re-read each time, so a market switched back on mid-run is buyable again.
  await setEnabled(marketId, true);
  assert.equal((await mayBuyNewSearch({ market_id: marketId, requested_by: null })).allowed,
    true);

  // A person asking is not governed by the schedule flag.
  await setEnabled(marketId, false);
  assert.equal(
    (await mayBuyNewSearch({ market_id: marketId, requested_by: operator.userId })).allowed,
    true);

  // No saved market behind the run: there is no flag to consult.
  assert.equal((await mayBuyNewSearch({ market_id: null, requested_by: null })).allowed,
    true);

  // A market deleted underneath a queued run is not one to buy searches of.
  await query('delete from saved_markets where market_id = $1', [marketId]);
  const gone = await mayBuyNewSearch({ market_id: marketId, requested_by: null });
  assert.equal(gone.allowed, false);
  assert.ok(!gone.allowed && /no longer exists/.test(gone.reason));
});

test('B2-1 a paused market comes back promptly rather than being backed off', async () => {
  registerDiscoveryAdapter(countingAdapter({ businesses: 1 }));
  const marketId = await market('B2 Retry Window');

  await queueScheduledRun(marketId);
  await setEnabled(marketId, false);
  await drainQueue();

  const row = await marketRow(marketId);
  const hours = (new Date(row.next_refresh_at).getTime() - Date.now()) / 3_600_000;
  // The declined-retry window, not an exponential failure backoff.
  assert.ok(hours > DECLINED_RETRY_HOURS - 1 && hours < DECLINED_RETRY_HOURS + 1,
    `a paused market was re-dued in ${hours.toFixed(1)}h, not the declined window`);
});

// =============================================================================
// B2-2 · a manual request and a scheduled pass are one job, and who asked survives
// =============================================================================

/**
 * `discoveryFingerprint` deliberately omits the requester: a market is a market
 * however the request arrived, and a person clicking search on a market the
 * scheduler has already queued should join that run rather than buy the same search
 * twice. Joining is right. Losing who asked is not.
 *
 * This was harmless while both paths ran identically. B2-1 made it consequential: the
 * handler now asks whether a *person* wanted this work before it will buy a search of
 * a paused market, so the answer depended on which request happened to arrive first
 * -- the same two clicks in the other order would spend money or not.
 */
test('B2-2 a person joining an automatic run is recorded as having asked', async () => {
  const adapter = countingAdapter({ businesses: 1 });
  registerDiscoveryAdapter(adapter);
  const marketId = await market('B2 Collision Scheduled First');
  const operator = await makeUser('B2 Collision Operator', 'SALES_MANAGER');

  // The scheduler gets there first.
  const scheduled = await scheduleDueMarkets();
  assert.equal(scheduled.queued, 1);
  const before = await jobsFor(marketId);
  assert.equal(before.length, 1);
  assert.equal(before[0]!.requested_by, null, 'a scheduled run should have no requester');

  // Then a person asks for the same market.
  const { rows } = await query<Record<string, any>>(
    `select geography_definition from saved_markets where market_id = $1`, [marketId]);
  const manual = await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta',
    geographyValue: String(rows[0]!.geography_definition.value),
    marketId, requestedBy: operator.userId, miningMode: 'advertiser_first',
  });
  // Joined, not duplicated.
  assert.equal(manual.created, false);
  assert.equal(manual.jobId, before[0]!.job_id);
  const after = await jobsFor(marketId);
  assert.equal(after.length, 1, 'the same market was queued twice');
  assert.equal(after[0]!.requested_by, operator.userId,
    'a person asked for this run and the job does not say so');
});

test('B2-2 joining never overwrites the person who asked first', async () => {
  registerDiscoveryAdapter(countingAdapter({ businesses: 1 }));
  const marketId = await market('B2 Collision Manual First');
  const first = await makeUser('B2 First Asker', 'SALES_MANAGER');
  const second = await makeUser('B2 Second Asker', 'SALES_MANAGER');
  const { rows } = await query<Record<string, any>>(
    `select geography_definition from saved_markets where market_id = $1`, [marketId]);
  const zip = String(rows[0]!.geography_definition.value);

  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: zip,
    marketId, requestedBy: first.userId, miningMode: 'advertiser_first' });
  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: zip,
    marketId, requestedBy: second.userId, miningMode: 'advertiser_first' });

  const jobs = await jobsFor(marketId);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.requested_by, first.userId,
    'the second asker took credit for the first asker’s run');
});

test('B2-2 a scheduled pass joining a person’s run does not become automatic',
  async () => {
  // The other direction. A scheduler pass folding into a human's queued run must not
  // strip the human's authorization off it -- that would turn a request somebody made
  // into an unattended refresh, and against a paused market it would then be refused.
  const adapter = countingAdapter({ businesses: 1 });
  registerDiscoveryAdapter(adapter);
  const marketId = await market('B2 Collision Human First');
  const operator = await makeUser('B2 Human First', 'SALES_MANAGER');
  const { rows } = await query<Record<string, any>>(
    `select geography_definition from saved_markets where market_id = $1`, [marketId]);

  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta',
    geographyValue: String(rows[0]!.geography_definition.value),
    marketId, requestedBy: operator.userId, miningMode: 'advertiser_first' });

  // The scheduler comes along and finds the market already queued.
  const pass = await scheduleDueMarkets();
  assert.equal(pass.queued, 0, 'the scheduler queued a second run for one market');

  const jobs = await jobsFor(marketId);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.requested_by, operator.userId,
    'a scheduler pass stripped the requester off a run a person asked for');
});

// =============================================================================
// B2-3 · what to buy is snapshotted at enqueue; whether to buy is current
// =============================================================================

/**
 * Two questions that look alike and must not be answered the same way.
 *
 * The handler reads its vertical and geography from the job payload, not from
 * `saved_markets`. That is deliberate and load-bearing: the provider-task
 * fingerprint an outstanding search is matched on was built from that snapshot, so a
 * handler that re-read an edited market would compute a different fingerprint, fail
 * to find the task it had already paid for, and buy the search again. The most
 * expensive bug available in this file, reachable by a change that would look like
 * an improvement.
 *
 * `enabled` is the opposite. It is not a description of what to search, it is a
 * standing instruction about whether to spend, and the whole point of B2-1 is that it
 * is read at the moment of spending. Pinned together so the distinction is on the
 * record rather than inferred.
 */
test('B2-3 editing a market mid-flight does not change what the queued run searches',
  async () => {
  let searchedZip: string | null = null;
  registerDiscoveryAdapter({
    name: 'blockb-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request): Promise<DiscoveryResult> {
      searchedZip = request.geographyValue ?? null;
      return { status: 'ZERO_RESULTS', businesses: [], providerRows: 0,
        rejectedRows: 0, duplicateRows: 0 };
    },
  });
  const marketId = await market('B2 Snapshot', { zip: '32081' });

  await queueScheduledRun(marketId);
  // The operator repoints the market after the run is queued.
  await query(
    `update saved_markets
        set geography_definition = jsonb_build_object('value', '32082'::text),
            vertical_profile_id = 'plumbing'
      where market_id = $1`, [marketId]);
  await drainQueue();

  assert.equal(searchedZip, '32081',
    'the queued run followed an edit made after it was queued, so its fingerprint no '
    + 'longer matches the task it may already have paid for');
});

test('B2-3 whether to buy is read at the moment of buying, not snapshotted', async () => {
  // Same fixture shape, opposite expectation: this one must see the change.
  const adapter = countingAdapter({ businesses: 1 });
  registerDiscoveryAdapter(adapter);
  const marketId = await market('B2 Snapshot Enabled', { zip: '32083' });

  await queueScheduledRun(marketId);
  await setEnabled(marketId, false);
  await drainQueue();

  assert.equal(adapter.submissions(), 0,
    'the enabled flag was snapshotted at enqueue along with the search definition');
});

// =============================================================================
// B2-4 · four freshness facts that must not collapse into one
// =============================================================================

test('B2-4 attempted, succeeded, refreshed and mined stay four separate facts',
  async () => {
  // A market searched every hour and failing every hour has a recent attempt and no
  // coverage. A market searched successfully that found only companies we already
  // hold has coverage and no new inventory. Collapsing any pair of these makes the
  // page unable to tell an operator which is happening.
  registerDiscoveryAdapter(countingAdapter({ businesses: 0 }));
  const marketId = await market('B2 Freshness Zero', { zip: '32085' });
  await queueScheduledRun(marketId);
  await drainQueue();

  const { rows } = await query<Record<string, any>>(
    `select last_attempted_at, last_success_at, last_refresh_at, last_mined_at,
            last_outcome
       from saved_markets where market_id = $1`, [marketId]);
  const row = rows[0]!;
  // The provider answered, so it succeeded -- an empty market is a working provider.
  assert.equal(row.last_outcome, 'ZERO_RESULTS');
  assert.ok(row.last_success_at, 'a provider that answered was not recorded as success');
  assert.ok(row.last_refresh_at, 'the run did not record a refresh');
  // But nothing was mined: no new company entered inventory.
  assert.equal(row.last_mined_at, null,
    'a search that added nothing recorded a mining date, so "last mined" now means '
    + '"last searched" and an operator cannot tell coverage from growth');
});

test('B2-4 a market that fails has an attempt and no success', async () => {
  registerDiscoveryAdapter({
    name: 'blockb-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return { status: 'OUTAGE', businesses: [], providerRows: 0, rejectedRows: 0,
        duplicateRows: 0, reason: 'the provider is down' };
    },
  });
  const marketId = await market('B2 Freshness Failing', { zip: '32086' });
  // Through the scheduler, because `last_attempted_at` is the scheduler's own
  // fairness cursor -- the thing `order by last_attempted_at asc nulls first` reads
  // so no market starves behind a busier one. It is written where the turn is taken
  // and it is deliberately not an operator-facing "last tried": nothing displays it,
  // and a manual search does not move it, which is right, because a person searching
  // by hand should not cost the market its place in the queue.
  await scheduleDueMarkets();
  await drainQueue();

  const { rows } = await query<Record<string, any>>(
    `select last_attempted_at, last_success_at, last_refresh_at, last_outcome,
            consecutive_failures
       from saved_markets where market_id = $1`, [marketId]);
  assert.ok(rows[0]!.last_attempted_at, 'the scheduler took a turn and did not record it');
  assert.ok(rows[0]!.last_refresh_at, 'a run that executed recorded no refresh');
  assert.equal(rows[0]!.last_success_at, null,
    'a provider outage was recorded as a successful search');
  assert.equal(rows[0]!.last_outcome, 'PROVIDER_UNAVAILABLE');
  assert.equal(rows[0]!.consecutive_failures, 1);
});

test('B2-4 a manual search does not move the scheduler’s fairness cursor', async () => {
  // The other half of what that column means. If a manual search moved it, a rep
  // searching a market by hand would send it to the back of the automatic queue.
  registerDiscoveryAdapter(countingAdapter({ businesses: 1 }));
  const marketId = await market('B2 Fairness Cursor', { zip: '32091' });
  const operator = await makeUser('B2 Cursor Operator', 'SALES_MANAGER');

  await enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32091',
    marketId, requestedBy: operator.userId, miningMode: 'advertiser_first' });
  await drainQueue();

  const { rows } = await query<Record<string, any>>(
    `select last_attempted_at, last_refresh_at from saved_markets where market_id = $1`,
    [marketId]);
  assert.equal(rows[0]!.last_attempted_at, null,
    'a manual search cost the market its place in the scheduler queue');
  assert.ok(rows[0]!.last_refresh_at,
    'a manual search that ran did not record that the market was refreshed');
});

// =============================================================================
// B2-5 · scheduler health truth
// =============================================================================

/**
 * The comment above this check has always said that a market which is "enabled, due
 * and not moving" is the difference between inventory that maintains itself and a
 * page that looks busy. Nothing computed it. A market with no failures and no
 * blocker read OK however long it had been sitting there, so a worker that stopped
 * sweeping, a backlog that never drains, and an in-flight ceiling nothing clears all
 * presented as "scheduled and none is failing".
 *
 * Overdue is judged against the market's own cadence -- more than one full refresh
 * interval past due, so it has missed a whole cycle -- rather than a constant
 * invented for the check. Being merely due is normal and stays silent.
 */
test('B2-5 a market that has missed a whole cycle is not reported as healthy',
  async () => {
  await market('B2 Health Overdue', { zip: '32087',
    dueAt: new Date(Date.now() - 40 * 3_600_000).toISOString() });

  const snapshot = await operationalSnapshot();
  const markets = snapshot.checks.find((check) => check.id === 'markets');
  assert.ok(markets, 'the markets health check is missing');
  assert.equal(markets!.state, 'ATTENTION',
    'a market 40h past a 24h refresh interval was reported as healthy');
  assert.match(String(markets!.detail), /overdue/i);
  assert.match(String(markets!.detail), /1 market/);
});

test('B2-5 a market merely due is not called overdue', async () => {
  // Due and waiting for the next sweep is the normal state of a healthy market. If
  // this warned, the check would warn constantly and stop being read.
  await market('B2 Health Just Due', { zip: '32088',
    dueAt: new Date(Date.now() - 60_000).toISOString() });

  const snapshot = await operationalSnapshot();
  const markets = snapshot.checks.find((check) => check.id === 'markets');
  assert.equal(markets!.state, 'OK',
    'a market one minute past due was reported as a problem');
  assert.doesNotMatch(String(markets!.detail), /overdue/i);
});

test('B2-5 an overdue market already carrying a blocker is not counted twice',
  async () => {
  const marketId = await market('B2 Health Blocked', { zip: '32089',
    dueAt: new Date(Date.now() - 40 * 3_600_000).toISOString() });
  await query(
    `update saved_markets set blocker_reason = 'No discovery provider is configured.'
      where market_id = $1`, [marketId]);

  const snapshot = await operationalSnapshot();
  const markets = snapshot.checks.find((check) => check.id === 'markets');
  // Every enabled market is blocked, and that is the sentence it should get -- with
  // its reason -- rather than the overdue one saying the same thing differently.
  assert.equal(markets!.state, 'BLOCKED');
  assert.match(String(markets!.detail), /blocked/i);
});

test('B2-5 a paused market is not counted against scheduler health', async () => {
  // An operator's own decision must not read as the system failing to keep up.
  await market('B2 Health Paused', { enabled: false, zip: '32090',
    dueAt: new Date(Date.now() - 40 * 3_600_000).toISOString() });

  const snapshot = await operationalSnapshot();
  const markets = snapshot.checks.find((check) => check.id === 'markets');
  assert.equal(markets!.state, 'UNKNOWN',
    'a paused market was counted as an enabled one');
  assert.match(String(markets!.detail), /none configured|no saved market/i);
});

// =============================================================================
// B2-6 · the backlog drains, the restart costs nothing, and the bill is right
// =============================================================================

/**
 * The shape over time, which no single-cycle test can show.
 *
 * The last scheduler defect of this kind took thirty simulated days to see, because
 * one cycle looked perfectly correct: a market with an outstanding provider task was
 * skipped, so the task was never collected, and the market quietly retired. What
 * makes that class of bug visible is running the thing until it either converges or
 * does not.
 *
 * A smaller market count than the operator packet uses, because the invariants are
 * the same at twenty as at a hundred and the suite has to finish.
 */
test('B2-6 a backlog drains, converges, and buys each search exactly once', async () => {
  const report = await runConvergence({ markets: 20, restartAtPass: 3 });

  assert.deepEqual(report.problems, [],
    `the packet's own checks failed:\n  ${report.problems.join('\n  ')}`);
  assert.equal(report.refreshed, 20, 'the backlog did not converge');
  assert.equal(report.stillDue, 0);
  assert.equal(report.submissions, 20,
    'the number of searches bought is not the number of markets');
  assert.deepEqual(report.boughtTwice, [], 'a market was searched more than once');
  assert.ok(report.peakInFlight <= MAX_MARKETS_IN_FLIGHT,
    `${report.peakInFlight} markets were in flight, over the ceiling`);

  // A reboot with every market overdue must not fire them all at once. The first
  // pass is the one that would have done it.
  assert.ok(report.passes[0]!.due >= 20, 'the fixture did not actually create a backlog');
  assert.ok(report.passes[0]!.queued <= MAX_MARKETS_IN_FLIGHT,
    `the first pass queued ${report.passes[0]!.queued} of ${report.passes[0]!.due} due`);

  // And the restart was real: jobs were re-leased rather than lost.
  assert.ok(report.recoveredAfterRestart > 0,
    'the simulated crash recovered nothing, so it proved nothing');
});

test('B2-6 a market paused mid-backlog leaves the bill and comes back for one search',
  async () => {
  const result = await runPauseInBacklog();
  assert.deepEqual(result.problems, []);
  assert.equal(result.submissionsWhilePaused, 0, 'a paused market was charged for');
  assert.equal(result.churnedJobs, 0, 'a paused market churned jobs');
  assert.equal(result.submissionsAfterResume, 1,
    'resuming a market cost more than the one search it was owed');
  assert.equal(result.outcome, 'MARKET_DISABLED');
});

/**
 * Bounding throughput has an arithmetic consequence that was never written down: the
 * system can refresh a fixed number of markets a day, and past that the backlog grows
 * faster than it drains. Every market still gets a fair turn -- nothing starves -- but
 * "due" stops meaning "about to be searched".
 *
 * Pinned so the number moves only when somebody changes a limit on purpose, and so
 * the three settings that produce it cannot drift apart silently.
 */
test('B2-6 the sustainable market count is the arithmetic of the three limits',
  async () => {
  const sweepsPerDay = (DEFAULT_REFRESH_INTERVAL_HOURS * 3_600_000) / SWEEP_INTERVAL_MS;
  assert.equal(sustainableMarketCount(),
    Math.floor(sweepsPerDay * MAX_MARKETS_IN_FLIGHT));
  // At the defaults: 3 markets per 15-minute sweep, 96 sweeps a day.
  assert.equal(sustainableMarketCount(), 288);
  // A market asking to be looked at more often is judged on its own cadence.
  assert.equal(sustainableMarketCount(1), 12);
});

// =============================================================================
// B2-7 · a market that always fails must not take the scheduler with it
// =============================================================================

/**
 * The job-level version of this is proven: a poison job does not stop the queue
 * behind it. The scheduler-level version is a different question, because the
 * scheduler chooses *which* markets get the batch, and a market that fails
 * instantly comes back around faster than one that does real work.
 *
 * Two ways it could go wrong and neither would look like an error: the poison market
 * consumes a slot every pass and the healthy ones are served late, or it is retried
 * so hard that its own backoff never takes effect.
 */
test('B2-7 a market that always fails does not starve the healthy ones', async () => {
  const perZip = new Map<string, number>();
  registerDiscoveryAdapter({
    name: 'blockb-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request): Promise<DiscoveryResult> {
      const zip = String(request.geographyValue ?? '');
      perZip.set(zip, (perZip.get(zip) ?? 0) + 1);
      if (zip === '32900') {
        return { status: 'OUTAGE', businesses: [], providerRows: 0, rejectedRows: 0,
          duplicateRows: 0, reason: 'this market always fails' };
      }
      return { status: 'OK',
        businesses: [{ name: `Poison Neighbour ${++sequence}`, website: null,
          phone: `904-555-${String(4000 + sequence).slice(-4)}` }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, costUsd: 0.0125 };
    },
  });

  // The poison market is the oldest, so fairness ordering hands it the first slot.
  const poison = await market('B2 Poison', { zip: '32900',
    dueAt: new Date(Date.now() - 72 * 3_600_000).toISOString() });
  const healthy: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    healthy.push(await market(`B2 Poison Neighbour ${index}`, { zip: `329${10 + index}`,
      dueAt: new Date(Date.now() - 48 * 3_600_000).toISOString() }));
  }

  for (let pass = 0; pass < 6; pass += 1) {
    await scheduleDueMarkets();
    await drainQueue();
  }

  // Every healthy market was served.
  const { rows } = await query<{ market_id: string; last_success_at: Date | null }>(
    `select market_id, last_success_at from saved_markets`);
  const byId = new Map(rows.map((row) => [row.market_id, row.last_success_at]));
  for (const marketId of healthy) {
    assert.ok(byId.get(marketId),
      'a healthy market was never served while a failing one held the scheduler');
  }
  assert.equal(byId.get(poison), null, 'the poison market should not have succeeded');

  // And it did not get a disproportionate share of the spend: its own backoff pushes
  // it out, so it is tried a handful of times rather than every pass.
  const poisonAttempts = perZip.get('32900') ?? 0;
  assert.ok(poisonAttempts >= 1, 'the poison market was never actually tried');
  assert.ok(poisonAttempts <= 3,
    `the failing market was searched ${poisonAttempts} times in 6 passes, so its `
    + 'backoff is not holding and it is spending money on every sweep');

  // Its backoff grew rather than staying flat.
  const { rows: poisonRow } = await query<{ consecutive_failures: number }>(
    `select consecutive_failures from saved_markets where market_id = $1`, [poison]);
  assert.ok(poisonRow[0]!.consecutive_failures >= 1);
  assert.ok(backoffHours(poisonRow[0]!.consecutive_failures) >= 1);
});

// =============================================================================
// B2-8 · a provider that flaps
// =============================================================================

test('B2-8 alternating failure and success does not accumulate backoff', async () => {
  // A provider that fails, works, fails, works. Each success has to clear the debt
  // completely: if any of it survives, a market on a flaky provider drifts further
  // out of date every cycle while every individual pass looks correct.
  let call = 0;
  registerDiscoveryAdapter({
    name: 'blockb-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      call += 1;
      if (call % 2 === 1) {
        return { status: 'OUTAGE', businesses: [], providerRows: 0, rejectedRows: 0,
          duplicateRows: 0, reason: 'flapping' };
      }
      return { status: 'ZERO_RESULTS', businesses: [], providerRows: 0,
        rejectedRows: 0, duplicateRows: 0 };
    },
  });
  const marketId = await market('B2 Flapping', { zip: '32901' });

  const failureCounts: number[] = [];
  for (let cycle = 0; cycle < 4; cycle += 1) {
    await query(`update saved_markets set next_refresh_at = now() - interval '1 minute'
                  where market_id = $1`, [marketId]);
    await scheduleDueMarkets();
    await drainQueue();
    const { rows } = await query<{ consecutive_failures: number }>(
      `select consecutive_failures from saved_markets where market_id = $1`, [marketId]);
    failureCounts.push(rows[0]!.consecutive_failures);
  }

  // fail, succeed, fail, succeed -> 1, 0, 1, 0. Never 1, 0, 2, 0.
  assert.deepEqual(failureCounts, [1, 0, 1, 0],
    `backoff accumulated across a flap: ${failureCounts.join(', ')}`);
});

// =============================================================================
// B2-9 · a paid task survives however many restarts it takes
// =============================================================================

test('B2-9 an outstanding task is collected across repeated scheduler restarts',
  async () => {
  // Durability within one process is proven. This is the same task surviving several
  // scheduler passes, each standing in for a restart, because that is what a worker
  // that keeps crashing actually looks like -- and the failure mode is silent: the
  // money is gone, the answer is sitting at the provider, and nobody goes back for it.
  let collections = 0;
  let submissions = 0;
  registerDiscoveryAdapter({
    name: 'blockb-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      submissions += 1;
      return { status: 'PENDING', businesses: [], providerRows: 0, rejectedRows: 0,
        duplicateRows: 0, providerTaskId: `restart-task-${submissions}` };
    },
    async collect(): Promise<DiscoveryResult> {
      collections += 1;
      // Not ready for the first two restarts, then it answers.
      if (collections < 3) {
        return { status: 'PENDING', businesses: [], providerRows: 0, rejectedRows: 0,
          duplicateRows: 0 };
      }
      return { status: 'OK',
        businesses: [{ name: `Restart Survivor ${++sequence}`, website: null,
          phone: `904-555-${String(4500 + sequence).slice(-4)}` }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, costUsd: 0.0125 };
    },
  });
  const marketId = await market('B2 Restart Recovery', { zip: '32902' });

  // First pass buys the search and the provider takes it.
  await scheduleDueMarkets();
  await drainQueue();
  assert.equal(submissions, 1);
  const { rows: pendingRow } = await query<{ n: number }>(
    `select count(*)::int as n from provider_tasks where status = 'PENDING'`);
  assert.equal(pendingRow[0]!.n, 1, 'the accepted task was not remembered');

  // Three more passes, each one a restart: due again, collected again, never re-bought.
  for (let restart = 0; restart < 3; restart += 1) {
    await query(`update saved_markets set next_refresh_at = now() - interval '1 minute'
                  where market_id = $1`, [marketId]);
    const pass = await scheduleDueMarkets();
    assert.equal(pass.collecting, 1,
      'the scheduler did not report that this run exists to collect rather than to buy');
    await drainQueue();
  }

  assert.equal(submissions, 1,
    `${submissions} searches were bought for one market across restarts`);
  assert.equal(collections, 3, 'the outstanding task was not collected each time');

  // The answer reached inventory and the task is closed with its cost.
  const { rows: accounts } = await query<{ n: number }>(
    `select count(*)::int as n from accounts where canonical_name like 'Restart Survivor%'`);
  assert.equal(accounts[0]!.n, 1, 'a search paid for and delivered was never ingested');
  const { rows: tasks } = await query<{ status: string; cost_usd: string | null }>(
    `select status, cost_usd from provider_tasks`);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]!.status, 'COLLECTED');
  assert.equal(Number(tasks[0]!.cost_usd), 0.0125);
});

test('B2-9 a task the provider never delivers is given up on, and the market moves on',
  async () => {
  // The other end of the same rope. Polling for ever is not durability, it is a
  // market that can never be refreshed again -- and the operator has to be able to
  // see that a search was paid for and never arrived.
  let submissions = 0;
  registerDiscoveryAdapter({
    name: 'blockb-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      submissions += 1;
      return { status: 'PENDING', businesses: [], providerRows: 0, rejectedRows: 0,
        duplicateRows: 0, providerTaskId: `never-delivered-${submissions}` };
    },
    async collect(): Promise<DiscoveryResult> {
      return { status: 'PENDING', businesses: [], providerRows: 0, rejectedRows: 0,
        duplicateRows: 0 };
    },
  });
  const marketId = await market('B2 Never Delivered', { zip: '32903' });

  await scheduleDueMarkets();
  await drainQueue();

  // Enough restarts to exhaust the collection bound.
  for (let restart = 0; restart < MAX_TASK_COLLECTIONS + 1; restart += 1) {
    await query(`update saved_markets set next_refresh_at = now() - interval '1 minute'
                  where market_id = $1`, [marketId]);
    await scheduleDueMarkets();
    await drainQueue();
  }

  const { rows: abandoned } = await query<{ n: number; error_code: string | null }>(
    `select count(*)::int as n, min(error_code) as error_code from provider_tasks
      where status = 'ABANDONED'`);
  assert.equal(abandoned[0]!.n, 1,
    'a task the provider never delivered is still being polled');
  assert.equal(abandoned[0]!.error_code, 'NEVER_DELIVERED');

  // And the market is searchable again rather than permanently owed, which is the
  // shape of the defect that retired a saved market for thirty simulated days: one
  // PENDING answer that was never collected and never given up on.
  //
  // Note what is *not* claimed here. Once the dead task is abandoned the next run
  // buys a fresh search, so the market is legitimately owed a task again and
  // `collecting` is 1 -- correctly. My first version of this test asserted 0 and was
  // wrong: "nothing outstanding" and "not stuck on a task that will never arrive"
  // are different statements, and only the second one is the invariant.
  assert.ok(submissions >= 2,
    'after giving up on the undelivered task the market was never searched again');
  const { rows: fresh } = await query<{ n: number }>(
    `select count(*)::int as n from provider_tasks
      where status = 'PENDING' and provider_native_id <> 'never-delivered-1'`);
  assert.equal(fresh[0]!.n, 1,
    'the market bought a new search, so exactly one new task should be outstanding');
});

test('B2-2 an automatic pass joining an automatic run writes nothing', async () => {
  // Found in the Block I review of my own work. The provenance write is only correct
  // when there is a requester to record: with none it is a guaranteed no-op that
  // still takes a row lock on the commonest path in the system -- the scheduler
  // joining its own queued runs -- and it newly exposed the join to the foreign key
  // on `requested_by`, which the select it replaced could not fail on.
  registerDiscoveryAdapter(countingAdapter({ businesses: 1 }));
  const marketId = await market('B2 Automatic Join');

  const first = await scheduleDueMarkets();
  assert.equal(first.queued, 1);
  const before = await jobsFor(marketId);

  // A second automatic pass finds it already queued.
  const second = await scheduleDueMarkets();
  assert.equal(second.queued, 0);

  const after = await jobsFor(marketId);
  assert.equal(after.length, 1);
  assert.equal(after[0]!.job_id, before[0]!.job_id);
  assert.equal(after[0]!.requested_by, null,
    'an automatic pass invented a requester for a run nobody asked for');
});

test('B2-2 a requester that does not exist is refused rather than half-written',
  async () => {
  // The foreign key is the point: `jobs.requested_by` references `users`, so a
  // fabricated id cannot be recorded. It must fail, and it must not leave the run
  // changed -- the same answer the create path gives.
  registerDiscoveryAdapter(countingAdapter({ businesses: 1 }));
  const marketId = await market('B2 Ghost Requester');
  const { rows } = await query<Record<string, any>>(
    `select geography_definition from saved_markets where market_id = $1`, [marketId]);
  const zip = String(rows[0]!.geography_definition.value);

  await scheduleDueMarkets();
  const before = await jobsFor(marketId);
  assert.equal(before[0]!.requested_by, null);

  await assert.rejects(() => enqueueMarketResearch({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: zip,
    marketId, requestedBy: '00000000-0000-4000-8000-000000000000',
    miningMode: 'advertiser_first',
  }));

  const after = await jobsFor(marketId);
  assert.equal(after.length, 1, 'the refused join created a second run');
  assert.equal(after[0]!.requested_by, null,
    'a requester that does not exist was partially recorded');
});
