import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters,
  type DiscoveryAdapter, type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import {
  scheduleDueMarkets, recordMarketOutcome, backoffHours,
  MAX_MARKETS_PER_PASS, MAX_MARKETS_IN_FLIGHT, DEFAULT_REFRESH_INTERVAL_HOURS,
} from '../src/workers/marketScheduler.js';
import { recordProviderTask } from '../src/miner/providerTasks.js';
import { planDiscoverySearches } from '../src/miner/searchPlan.js';
import { DECLINED_RETRY_HOURS } from '../src/workers/marketScheduler.js';
import { resetDatabase, makeUser } from './helpers.js';

/**
 * Markets that maintain themselves.
 * Authority: Issue #3 Phase M.
 *
 * The miner ran when somebody pressed a button. The product is inventory that is
 * already there when a rep arrives in the morning. Everything here exists to stop
 * that being expensive or unfair: nothing is searched twice, a provider that is
 * failing is backed off rather than hammered, a reboot does not fire every stale
 * market at once, and no market starves behind a busier one.
 */

let sequence = 0;

before(async () => { await resetDatabase(); await syncVerticalProfiles(); });
after(async () => { await pool.end(); });
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
});

function workingAdapter(options: { businesses?: number } = {}): DiscoveryAdapter {
  return {
    name: 'scheduler-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      const count = options.businesses ?? 0;
      return {
        status: count > 0 ? 'OK' : 'ZERO_RESULTS',
        businesses: Array.from({ length: count }, (_, index) => ({
          name: `Scheduled Find ${++sequence}-${index}`, website: null,
          phone: `904-555-${String(9000 + sequence).slice(-4)}`,
        })),
        providerRows: count, rejectedRows: 0, duplicateRows: 0,
      };
    },
  };
}

async function market(name: string, options: {
  enabled?: boolean; zip?: string; dueAt?: string | null; failures?: number;
} = {}): Promise<string> {
  sequence += 1;
  const { rows } = await query<{ market_id: string }>(
    `insert into saved_markets
       (name, vertical_profile_id, geography_type, geography_definition, mining_mode,
        enabled, next_refresh_at, consecutive_failures)
     values ($1, 'hvac', 'zip_zcta', jsonb_build_object('value', $2::text), 'advertiser_first',
             $3, $4::timestamptz, $5)
     returning market_id`,
    [
      name, options.zip ?? `3209${sequence % 10}`, options.enabled ?? true,
      options.dueAt === undefined ? null : options.dueAt, options.failures ?? 0,
    ],
  );
  return rows[0]!.market_id;
}

async function marketRow(marketId: string) {
  const { rows } = await query<Record<string, any>>(
    `select enabled, last_attempted_at, last_success_at, last_outcome, last_outcome_reason,
            consecutive_failures, next_refresh_at, blocker_reason
       from saved_markets where market_id = $1`, [marketId]);
  return rows[0]!;
}

// ------------------------------------------------------------ what gets queued --

test('a due market is queued, and its next run is set so it does not spin', async () => {
  registerDiscoveryAdapter(workingAdapter());
  const marketId = await market('Due Market');

  const result = await scheduleDueMarkets();
  assert.equal(result.due, 1);
  assert.equal(result.queued, 1);

  const { rows } = await query<{ n: number; market_id: string }>(
    `select count(*)::int as n, min(market_id::text) as market_id from jobs
      where job_type = 'market_mine'`);
  assert.equal(rows[0]!.n, 1);

  const row = await marketRow(marketId);
  assert.ok(row.last_attempted_at, 'the attempt was not recorded');
  assert.ok(row.next_refresh_at > new Date(), 'the market is immediately due again');
});

test('a market with a search already running is not queued again', async () => {
  registerDiscoveryAdapter(workingAdapter());
  const marketId = await market('Busy Market');
  await scheduleDueMarkets();

  // Make it due again without finishing the job.
  await query('update saved_markets set next_refresh_at = now() - interval \'1 hour\'',
    []);
  const second = await scheduleDueMarkets();

  assert.equal(second.queued, 0);
  assert.deepEqual(second.skipped, [{ marketId, reason: 'ALREADY_RUNNING' }]);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.n, 1, 'the same market was searched twice at once');
});

test('a market with a provider task still owed is collected, not re-bought', async () => {
  // This test used to assert that such a market is not *queued*, which is not the
  // same thing and was actively harmful: collection happens inside the market_mine
  // job, so a market the scheduler refused to queue never had its paid-for task
  // collected, never reached the abandonment ceiling, and never refreshed again. One
  // PENDING answer retired a saved market for good. A thirty-day rehearsal found it;
  // a single pass cannot, because a single pass is exactly what looks right.
  //
  // The property worth protecting is that the money is not spent twice, and that is
  // enforced where it belongs -- the handler collects before it submits.
  let discovers = 0;
  let collects = 0;
  clearDiscoveryAdapters();
  registerDiscoveryAdapter({
    name: 'scheduler-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() {
      discovers += 1;
      return { status: 'ZERO_RESULTS' as const, businesses: [], providerRows: 0,
        rejectedRows: 0, duplicateRows: 0 };
    },
    async collect(providerTaskId) {
      collects += 1;
      return { status: 'OK' as const,
        businesses: [{ name: 'owed.invalid', website: 'https://owed.invalid', phone: null,
          city: null, state: null, postalCode: null }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, providerTaskId };
    },
  });

  const marketId = await market('Owed Market', { zip: '32095' });
  // A task is owed for one *search*, not for the whole market: a run buys N
  // independent searches and each has its own provider task. Recording this under
  // the job's fingerprint would describe a thing the miner no longer looks for.
  const plan = await planDiscoverySearches({
    verticalProfileId: 'hvac', geographyType: 'zip_zcta', geographyValue: '32095',
    miningMode: 'advertiser_first', count: 1, marketId,
  });
  await recordProviderTask({
    provider: 'scheduler-provider',
    providerNativeId: 'still-working',
    fingerprint: plan.searches[0]!.fingerprint,
  });

  const result = await scheduleDueMarkets();
  assert.equal(result.queued, 1, 'the market was not queued, so nobody will collect its task');
  assert.equal(result.collecting, 1,
    'the operator cannot tell a run that collects a paid search from one that buys a new one');
  assert.deepEqual(result.skipped, []);

  await drainQueue();
  assert.equal(collects, 1, 'the search already paid for was never collected');
  assert.equal(discovers, 0, 'a second search was bought while the provider still owed us one');
});

test('a disabled market is never scheduled', async () => {
  registerDiscoveryAdapter(workingAdapter());
  await market('Disabled Market', { enabled: false });

  const result = await scheduleDueMarkets();
  assert.equal(result.due, 0);
  assert.equal(result.queued, 0);
});

test('a market not yet due is left alone', async () => {
  registerDiscoveryAdapter(workingAdapter());
  await market('Not Due Market', { dueAt: new Date(Date.now() + 86_400_000).toISOString() });

  assert.equal((await scheduleDueMarkets()).due, 0);
});

test('with no provider nothing is scheduled, and every market says why', async () => {
  const marketId = await market('Blocked Market');
  const result = await scheduleDueMarkets();

  assert.equal(result.discoveryBlocked, true);
  assert.equal(result.queued, 0);

  const row = await marketRow(marketId);
  assert.match(row.blocker_reason, /No discovery provider is configured/,
    'a market that looks due and is not moving said nothing about why');
});

// ------------------------------------------------------- fairness and bursting --

test('a reboot with many stale markets does not fire them all at once', async () => {
  registerDiscoveryAdapter(workingAdapter());
  for (let index = 0; index < 20; index += 1) {
    await market(`Stale Market ${index}`);
  }

  const result = await scheduleDueMarkets();
  assert.equal(result.due, 20);
  assert.ok(result.queued <= MAX_MARKETS_PER_PASS,
    `${result.queued} markets were queued in one pass`);
  assert.ok(result.queued <= MAX_MARKETS_IN_FLIGHT,
    'more markets are in flight than the ceiling allows');

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'market_mine'`);
  assert.ok(rows[0]!.n <= MAX_MARKETS_PER_PASS);
});

test('the oldest attempt goes first, so no market starves', async () => {
  registerDiscoveryAdapter(workingAdapter());
  const older = await market('Older Market');
  const newer = await market('Newer Market');
  await query(
    `update saved_markets set last_attempted_at = now() - interval '10 days'
      where market_id = $1`, [older]);
  await query(
    `update saved_markets set last_attempted_at = now() - interval '1 hour'
      where market_id = $1`, [newer]);

  await scheduleDueMarkets({ batchSize: 1 });

  const { rows } = await query<{ market_id: string }>(
    `select market_id from jobs where job_type = 'market_mine'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.market_id, older,
    'a market waiting ten days lost to one searched an hour ago');
});

test('a market never attempted goes before one that has', async () => {
  registerDiscoveryAdapter(workingAdapter());
  const attempted = await market('Attempted Market');
  await query(
    `update saved_markets set last_attempted_at = now() - interval '1 day'
      where market_id = $1`, [attempted]);
  const never = await market('Never Attempted Market');

  await scheduleDueMarkets({ batchSize: 1 });
  const { rows } = await query<{ market_id: string }>(
    `select market_id from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.market_id, never);
});

test('the in-flight ceiling holds even when the batch would allow more', async () => {
  registerDiscoveryAdapter(workingAdapter());
  for (let index = 0; index < 8; index += 1) await market(`Ceiling Market ${index}`);

  const result = await scheduleDueMarkets({ batchSize: 100 });
  assert.ok(result.queued <= MAX_MARKETS_IN_FLIGHT);
  assert.ok(result.skipped.some((entry) => entry.reason === 'IN_FLIGHT_LIMIT'));
});

// ------------------------------------------------------------------- backoff --

test('backoff grows with consecutive failures and is capped', () => {
  assert.equal(backoffHours(0), 0);
  assert.equal(backoffHours(1), 1);
  assert.equal(backoffHours(2), 2);
  assert.equal(backoffHours(3), 4);
  assert.equal(backoffHours(10), 24, 'a market that fails all night must recover eventually');
});

test('a provider that answers resets the backoff, whatever the answer was', async () => {
  const marketId = await market('Recovering Market', { failures: 4 });

  // An empty market is a working provider.
  await recordMarketOutcome({ marketId, outcome: 'ZERO_RESULTS', outcomeReason: 'nothing there' });
  const row = await marketRow(marketId);
  assert.equal(row.consecutive_failures, 0);
  assert.ok(row.last_success_at, 'a real answer was not recorded as a success');
  assert.equal(row.blocker_reason, null);
});

test('a provider that could not answer is backed off, not hammered', async () => {
  const marketId = await market('Failing Market');

  await recordMarketOutcome({
    marketId, outcome: 'PROVIDER_UNAVAILABLE', outcomeReason: 'nobody answered' });
  const first = await marketRow(marketId);
  assert.equal(first.consecutive_failures, 1);
  assert.equal(first.last_success_at, null,
    'a failure was recorded as a successful search');
  assert.match(first.blocker_reason, /nobody answered/);

  await recordMarketOutcome({
    marketId, outcome: 'PROVIDER_UNAVAILABLE', outcomeReason: 'nobody answered' });
  const second = await marketRow(marketId);
  assert.equal(second.consecutive_failures, 2);
  assert.ok(second.next_refresh_at > first.next_refresh_at,
    'the second failure did not wait longer than the first');
});

test('a pending provider task is not counted as a failure', async () => {
  const marketId = await market('Pending Market', { failures: 2 });
  await recordMarketOutcome({
    marketId, outcome: 'PROVIDER_PENDING', outcomeReason: 'still working' });

  const row = await marketRow(marketId);
  assert.equal(row.consecutive_failures, 2, 'the provider took the work; that is not a failure');
  assert.equal(row.blocker_reason, null);
});

test('attempted and succeeded stay different facts', async () => {
  registerDiscoveryAdapter({
    name: 'scheduler-provider', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(): Promise<DiscoveryResult> {
      return {
        status: 'OUTAGE', businesses: [], providerRows: 0, rejectedRows: 0, duplicateRows: 0,
        reason: 'the provider is down',
      };
    },
  });
  const marketId = await market('Attempted Not Succeeded');

  await scheduleDueMarkets();
  await drainQueue(5);

  const row = await marketRow(marketId);
  assert.ok(row.last_attempted_at, 'the attempt was not recorded');
  assert.equal(row.last_success_at, null,
    'a market searched every hour and failing every hour looked covered');
  assert.equal(row.last_outcome, 'PROVIDER_UNAVAILABLE');
  assert.equal(row.consecutive_failures, 1);
});

test('a successful run through the worker records the market as covered', async () => {
  registerDiscoveryAdapter(workingAdapter({ businesses: 2 }));
  const marketId = await market('Covered Market');

  await scheduleDueMarkets();
  await drainQueue(10);

  const row = await marketRow(marketId);
  assert.equal(row.last_outcome, 'COMPLETED');
  assert.ok(row.last_success_at);
  assert.equal(row.consecutive_failures, 0);
  assert.equal(row.blocker_reason, null);
});

// -------------------------------------------------------------------- at scale --

test('a hundred markets schedule fairly and the queue stays bounded', async () => {
  registerDiscoveryAdapter(workingAdapter());
  const ids: string[] = [];
  for (let index = 0; index < 100; index += 1) {
    ids.push(await market(`Scale Market ${index}`));
  }

  const started = Date.now();
  const first = await scheduleDueMarkets();
  assert.equal(first.due, 100);
  assert.ok(first.queued <= MAX_MARKETS_PER_PASS);

  // Drain and go again: over several passes every market gets a turn, and no pass
  // ever queues more than the ceiling.
  const scheduled = new Set<string>();
  for (let pass = 0; pass < 12; pass += 1) {
    const { rows } = await query<{ market_id: string }>(
      `select distinct market_id from jobs where job_type = 'market_mine'`);
    for (const row of rows) scheduled.add(row.market_id);
    await drainQueue(50);
    const result = await scheduleDueMarkets();
    assert.ok(result.queued <= MAX_MARKETS_PER_PASS, `pass ${pass} queued ${result.queued}`);
  }

  const { rows } = await query<{ market_id: string }>(
    `select distinct market_id from jobs where job_type = 'market_mine'`);
  for (const row of rows) scheduled.add(row.market_id);

  assert.ok(scheduled.size >= 12,
    `only ${scheduled.size} of 100 markets got a turn in twelve passes`);
  assert.ok(Date.now() - started < 120_000, 'scheduling a hundred markets was too slow');
});

test('scheduling twice in a row queues nothing the second time', async () => {
  registerDiscoveryAdapter(workingAdapter());
  await market('Idempotent Market');

  const first = await scheduleDueMarkets();
  const second = await scheduleDueMarkets();
  assert.equal(first.queued, 1);
  assert.equal(second.queued, 0);

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where job_type = 'market_mine'`);
  assert.equal(rows[0]!.n, 1);
});

// ------------------------------------------- our ceiling is not their failure ----

test('a budget we declined to spend is not recorded as the market failing', async () => {
  // DISCOVERY_BLOCKED counted as a failure, so a day when the daily budget ran out
  // incremented consecutive_failures on every market that came up and pushed each
  // one's next turn out by an exponential backoff. Five quiet days and a healthy
  // market was deprioritised by a day plus its interval -- and the markets we had
  // refused were then the least likely to be due when the money came back.
  const marketId = await market('Declined Market', { zip: '32095' });

  await recordMarketOutcome({
    marketId, outcome: 'DISCOVERY_BLOCKED',
    outcomeReason: 'The daily provider budget of $5.00 is spent.',
  });

  const { rows } = await query<{
    consecutive_failures: number; next_refresh_at: Date; blocker_reason: string | null;
  }>(`select consecutive_failures, next_refresh_at, blocker_reason
        from saved_markets where market_id = $1`, [marketId]);

  assert.equal(rows[0]!.consecutive_failures, 0,
    'a search we chose not to make was counted against the market');
  // Back soon rather than backed off.
  const hoursAway = (rows[0]!.next_refresh_at.getTime() - Date.now()) / 3_600_000;
  assert.ok(hoursAway > 0 && hoursAway <= DECLINED_RETRY_HOURS + 0.5,
    `the market comes back in ${hoursAway.toFixed(1)}h, which is a backoff rather than a retry`);
  // And the operator is still told why nothing happened.
  assert.match(rows[0]!.blocker_reason!, /budget/i,
    'the market says nothing about why it was not searched');
});

test('repeated budget refusals never compound into a backoff', async () => {
  const marketId = await market('Repeatedly Declined', { zip: '32084' });
  for (let day = 0; day < 6; day += 1) {
    await recordMarketOutcome({
      marketId, outcome: 'DISCOVERY_BLOCKED',
      outcomeReason: 'No search provider is configured.',
    });
  }

  const { rows } = await query<{ consecutive_failures: number; next_refresh_at: Date }>(
    'select consecutive_failures, next_refresh_at from saved_markets where market_id = $1',
    [marketId]);
  assert.equal(rows[0]!.consecutive_failures, 0,
    'six days of us not spending money made the market look six times broken');
  const hoursAway = (rows[0]!.next_refresh_at.getTime() - Date.now()) / 3_600_000;
  assert.ok(hoursAway <= DECLINED_RETRY_HOURS + 0.5,
    `after six refusals the market is ${hoursAway.toFixed(1)}h away`);
});

test('a market that genuinely fails is still backed off', async () => {
  // The distinction has to cut both ways, or a dead provider is retried for ever.
  const marketId = await market('Really Failing', { zip: '32086' });
  await recordMarketOutcome({
    marketId, outcome: 'PROVIDER_UNAVAILABLE', outcomeReason: 'No provider answered.' });
  await recordMarketOutcome({
    marketId, outcome: 'PROVIDER_UNAVAILABLE', outcomeReason: 'No provider answered.' });

  const { rows } = await query<{ consecutive_failures: number; next_refresh_at: Date }>(
    'select consecutive_failures, next_refresh_at from saved_markets where market_id = $1',
    [marketId]);
  assert.equal(rows[0]!.consecutive_failures, 2,
    'a provider that could not answer twice was not counted as failing');
  const hoursAway = (rows[0]!.next_refresh_at.getTime() - Date.now()) / 3_600_000;
  assert.ok(hoursAway > DECLINED_RETRY_HOURS,
    'a genuinely failing market was retried as though we had merely declined');
});

test('every market gets a turn when the budget only covers some of them', async () => {
  // Fairness under scarcity. The scheduler marks a market attempted when it queues
  // it, so a refused market still moves to the back of the rotation -- otherwise the
  // same few markets would absorb every refusal and the rest would never be tried.
  const ids: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    ids.push(await market(`Rotation ${index}`, { zip: `3209${index}` }));
  }
  registerDiscoveryAdapter(workingAdapter());

  const seen = new Set<string>();
  for (let pass = 0; pass < 4; pass += 1) {
    const result = await scheduleDueMarkets({ batchSize: 1 });
    const { rows } = await query<{ market_id: string }>(
      `select market_id from jobs where job_type = 'market_mine'
        and status = 'QUEUED' and market_id is not null`);
    for (const row of rows) seen.add(row.market_id);
    await drainQueue();
    // Every market becomes due again, as a fresh day would make them.
    await query(`update saved_markets set next_refresh_at = now() - interval '1 minute'`);
    assert.ok(result.queued <= 1);
  }

  assert.equal(seen.size, 4,
    `only ${seen.size} of 4 markets were ever scheduled: the rotation starves the rest`);
});
