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
import { scheduleDueMarkets, DECLINED_RETRY_HOURS } from '../src/workers/marketScheduler.js';
import { enqueueMarketResearch } from '../src/workers/enqueue.js';
import { recordProviderTask } from '../src/miner/providerTasks.js';
import { searchFingerprintPrefix } from '../src/miner/searchPlan.js';
import { discoveryCoverageFor } from '../src/domain/search.js';
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
