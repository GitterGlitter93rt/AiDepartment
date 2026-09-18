import './setup.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pool, query } from '../src/db/pool.js';
import { resetDatabase, makeUser } from './helpers.js';
import { syncVerticalProfiles } from '../src/domain/verticals.js';
import { drainQueue } from '../src/workers/runner.js';
import '../src/workers/marketMiner.js';
import {
  clearDiscoveryAdapters, registerDiscoveryAdapter, refusedDiscovery,
  type DiscoveryResult,
} from '../src/workers/marketMiner.js';
import { scheduleDueMarkets } from '../src/workers/marketScheduler.js';
import {
  reconcileMissingResearch, scoreResearchedButUnscored, recomputeStaleScores,
} from '../src/workers/researchReconcile.js';
import { spendPosition } from '../src/miner/spend.js';
import { MAX_TASK_COLLECTIONS, PROVIDER_TASK_RETENTION_DAYS } from '../src/miner/providerTasks.js';
import { observationsFor } from './support/observations.js';

/**
 * Thirty days of the system running without anybody watching.
 * Authority: Issue #3 BK — 24/7 shadow rehearsal.
 *
 * Everything else here tests one cycle. This is about what happens by the thirtieth:
 * the failures that need repetition to appear. A market that gets scheduled twice
 * because its refresh window and its retry disagree. Provider tasks that accumulate
 * because nothing ever abandons them. A queue that grows a little faster than it
 * drains. Spend that stays under the ceiling on any given run and crosses it over a
 * day. Accounts that are discovered, never researched, and never queued again --
 * a slow leak of prospects nobody is working.
 *
 * The provider is deterministic and unkind: it succeeds, pends, fails and refuses on
 * a fixed rotation, so every run of this test walks the same thirty days. A soak
 * test that is different every time reports flakes rather than defects.
 */

const DAYS = 30;
const MARKETS = 6;

let cycle = 0;
const collectAttempts = new Map<string, number>();
/** Succeeds, pends, fails, refuses -- in that order, for ever. */
function rotatingProvider(): void {
  registerDiscoveryAdapter({
    name: 'shadow', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request): Promise<DiscoveryResult> {
      cycle += 1;
      switch (cycle % 4) {
        case 1: {
          const id = `${request.geographyValue}-${cycle}`;
          return {
            status: 'OK',
            observations: observationsFor([{
              name: `shadow${id}.example-co`, website: `https://shadow${id}.example-co`,
              phone: null, city: null, state: null, postalCode: null,
              resultType: 'PAID_SEARCH_TEXT', query: 'ac repair', position: 1,
            }]),
            costUsd: 0.006,
          };
        }
        case 2:
          return { ...refusedDiscovery('PENDING', 'accepted, not ready'),
            providerTaskId: `shadow-task-${request.geographyValue}-${cycle}` };
        case 3:
          return refusedDiscovery('OUTAGE', 'the provider did not answer');
        default:
          return { status: 'ZERO_RESULTS', observations: observationsFor([]), reason: 'nothing usable' };
      }
    },
    async collect(providerTaskId): Promise<DiscoveryResult> {
      // Per task rather than per call: a real task takes a few tries and then
      // arrives. Counting globally made whether a given task ever completed depend
      // on how many other markets ran that day, which is not a property worth
      // encoding in a fixture.
      const attempts = (collectAttempts.get(providerTaskId) ?? 0) + 1;
      collectAttempts.set(providerTaskId, attempts);
      if (attempts < 3) {
        return { ...refusedDiscovery('PENDING', 'still not ready'), providerTaskId };
      }
      cycle += 1;
      return {
        status: 'OK',
        observations: observationsFor([{
          name: `collected${providerTaskId}.example-co`,
          website: `https://collected${cycle}.example-co`, phone: null,
          city: null, state: null, postalCode: null, resultType: 'ORGANIC',
        }]),
        providerTaskId,
      };
    },
  });
}

before(async () => { await resetDatabase(); });
after(async () => {
  clearDiscoveryAdapters();
  delete process.env['DISCOVERY_DAILY_BUDGET_USD'];
  await pool.end();
});
beforeEach(async () => {
  await resetDatabase();
  await syncVerticalProfiles();
  clearDiscoveryAdapters();
  cycle = 0;
  collectAttempts.clear();
});

async function seedMarkets(ownerId: string): Promise<void> {
  for (let index = 0; index < MARKETS; index += 1) {
    await query(
      `insert into saved_markets (name, vertical_profile_id, geography_type,
                                  geography_definition, created_by, next_refresh_at)
       values ($1, 'hvac', 'zip_zcta', $2::jsonb, $3, now() - interval '1 hour')`,
      [`Shadow Market ${index}`, JSON.stringify({ value: `3200${index}` }), ownerId]);
  }
}

/** One simulated day: schedule, run the queue, then the sweeps the worker runs. */
async function runDay(): Promise<void> {
  await scheduleDueMarkets();
  await drainQueue();
  await reconcileMissingResearch();
  await scoreResearchedButUnscored();
  await recomputeStaleScores();
  await drainQueue();
  // Time passes: every market becomes due again.
  await query(`update saved_markets set next_refresh_at = now() - interval '1 minute'`);
}

test('thirty days of scheduling never queues a market twice at once', async () => {
  const owner = await makeUser('Shadow Owner', 'RESEARCH_OPS');
  await seedMarkets(owner.userId);
  rotatingProvider();

  let worstConcurrent = 0;
  for (let day = 0; day < DAYS; day += 1) {
    await scheduleDueMarkets();
    const { rows } = await query<{ market_id: string; n: number }>(
      `select market_id, count(*)::int as n from jobs
        where job_type = 'market_mine' and status in ('QUEUED','RUNNING')
          and market_id is not null
        group by market_id having count(*) > 1`);
    assert.deepEqual(rows, [],
      `day ${day}: a market was queued twice at the same time, so it would be `
      + 'searched twice and billed twice');

    const inFlight = await query<{ n: number }>(
      `select count(*)::int as n from jobs
        where job_type = 'market_mine' and status in ('QUEUED','RUNNING')`);
    worstConcurrent = Math.max(worstConcurrent, inFlight.rows[0]!.n);
    await drainQueue();
    await query(`update saved_markets set next_refresh_at = now() - interval '1 minute'`);
  }
  assert.ok(worstConcurrent <= MARKETS,
    `${worstConcurrent} mining jobs were in flight for ${MARKETS} markets`);
});

test('the queue drains as fast as it fills, over thirty days', async () => {
  const owner = await makeUser('Shadow Drain', 'RESEARCH_OPS');
  await seedMarkets(owner.userId);
  rotatingProvider();

  for (let day = 0; day < DAYS; day += 1) await runDay();

  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from jobs where status in ('QUEUED','RUNNING')`);
  assert.equal(rows[0]!.n, 0,
    'after thirty days the queue still has work in it, so it fills faster than it drains');

  const failed = await query<{ n: number }>(
    `select count(*)::int as n from jobs where status = 'FAILED'`);
  assert.equal(failed.rows[0]!.n, 0,
    'a provider outage was turned into a failed job rather than an outcome');
});

test('no provider task is left outstanding for ever', async () => {
  const owner = await makeUser('Shadow Tasks', 'RESEARCH_OPS');
  await seedMarkets(owner.userId);
  rotatingProvider();

  for (let day = 0; day < DAYS; day += 1) await runDay();

  // Every task we paid for must end somewhere: collected, failed, or given up on
  // with a reason. One that is neither is a search bought and never read.
  const { rows } = await query<{ status: string; n: number }>(
    `select status, count(*)::int as n from provider_tasks group by status order by status`);
  const total = rows.reduce((sum, row) => sum + row.n, 0);
  assert.ok(total > 0, 'thirty days produced no provider tasks, so this proves nothing');

  const terminal = rows.filter((row) => row.status !== 'PENDING')
    .reduce((sum, row) => sum + row.n, 0);
  assert.ok(terminal > 0,
    `all ${total} tasks are still outstanding after thirty days: nothing collects them`);

  /**
   * The invariant that matters more than any count: nothing stays owed for ever.
   *
   * This used to assert that no open task had been asked for more times than a fixed
   * ceiling -- which is now exactly the wrong question. Being asked again is not harm;
   * a Standard task can legitimately be polled far past any count while the provider
   * works, and in production four of seven took about fifteen minutes. What would be
   * wrong is a task still outstanding after its result has stopped being retrievable,
   * because then it is neither recoverable nor closed.
   */
  const stuck = await query<{ n: number }>(
    `select count(*)::int as n from provider_tasks
      where status = 'PENDING'
        and submitted_at < now() - ($1 || ' days')::interval`,
    [String(PROVIDER_TASK_RETENTION_DAYS)]);
  assert.equal(stuck.rows[0]!.n, 0,
    'a task is still open although its result can no longer be fetched');
});

test('a market whose provider went quiet is not retired for ever', async () => {
  // Found by the thirty-day rehearsal and invisible in a single cycle. The scheduler
  // used to skip any market with an outstanding provider task, on the reasonable
  // ground that buying the same search twice is expensive. But collection happens
  // inside the market_mine job -- so refusing to queue one meant the task was never
  // collected, never abandoned, and the market never refreshed again. One PENDING
  // answer retired a saved market permanently and threw away the search we paid for.
  const owner = await makeUser('Shadow Quiet', 'RESEARCH_OPS');
  // One market, so it is due every pass and the collection ceiling is actually
  // reached. With six of them the scheduler's in-flight limit spreads the attempts
  // out and twenty-two days is not twenty-two attempts.
  await query(
    `insert into saved_markets (name, vertical_profile_id, geography_type,
                                geography_definition, created_by, next_refresh_at)
     values ('Quiet Market', 'hvac', 'zip_zcta', '{"value":"32050"}'::jsonb, $1,
             now() - interval '1 hour')`, [owner.userId]);
  clearDiscoveryAdapters();

  let submissions = 0;
  let collections = 0;
  registerDiscoveryAdapter({
    name: 'quiet', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request) {
      submissions += 1;
      return { ...refusedDiscovery('PENDING', 'accepted, not ready'),
        providerTaskId: `quiet-${request.geographyValue}` };
    },
    async collect(providerTaskId) {
      collections += 1;
      return { ...refusedDiscovery('PENDING', 'still not ready'), providerTaskId };
    },
  });

  // Long enough to cross the old poll-count ceiling several times, so the fact that
  // it no longer ends anything is exercised rather than assumed.
  const days = MAX_TASK_COLLECTIONS + 5;
  for (let day = 0; day < days; day += 1) {
    await scheduleDueMarkets();
    await drainQueue();
    await query(`update saved_markets set next_refresh_at = now() - interval '1 minute'`);
  }

  assert.ok(collections > 0,
    `a task the provider owed us was never collected once in ${days} days`);

  /**
   * One purchase, however long the provider takes.
   *
   * The original defect was the opposite of waste: a market with an outstanding task
   * was skipped entirely, so the task was never collected, never closed, and the
   * market never refreshed again -- one PENDING answer retired it permanently. The
   * market must keep being visited.
   *
   * What it must *not* do is buy again while the answer is still owed. That invariant
   * is now stronger than it was: this used to expect two purchases over these days,
   * because the poll-count ceiling gave up on a perfectly healthy task and the next
   * pass bought a replacement. Not abandoning it means not re-buying it, so the
   * correct number here is one.
   */
  assert.equal(submissions, 1,
    `${submissions} searches were bought over ${days} days for one market`);
  const { rows: owed } = await query<{ n: number }>(
    `select count(*)::int as n from provider_tasks where status = 'PENDING'`);
  assert.equal(owed[0]!.n, 1, 'a task the provider still owes us was given up on');

  // And the market is still being visited rather than retired: the scheduler keeps
  // queueing runs for it, which is what collection depends on.
  assert.ok(collections >= days - 1,
    'the market stopped being visited while a task was still outstanding');

  // A result that can no longer be fetched is the one thing that ends it. Then the
  // market is searchable again, and the replacement purchase is recovery rather than
  // waste.
  await query(`update provider_tasks set submitted_at = now() - interval '31 days'`);
  await query(`update saved_markets set next_refresh_at = now() - interval '1 minute'`);
  await scheduleDueMarkets();
  await drainQueue();

  const { rows } = await query<{ status: string; error_code: string | null; n: number }>(
    `select status, min(error_code) as error_code, count(*)::int as n
       from provider_tasks group by status`);
  const abandoned = rows.find((row) => row.status === 'ABANDONED');
  assert.ok(abandoned && abandoned.n > 0,
    `a task whose result expired is still being polled after ${days} days`);
  assert.equal(abandoned!.error_code, 'RESULT_RETENTION_EXPIRED');

  // Giving up and buying again are two different runs: the pass above took the
  // collection branch and closed the row; only a pass that finds nothing outstanding
  // buys. A run that failed to collect must never spend in the same breath.
  await query(`update saved_markets set next_refresh_at = now() - interval '1 minute'`);
  await scheduleDueMarkets();
  await drainQueue();
  assert.equal(submissions, 2,
    'after the expired task was given up on the market was never searched again');
});

test('every discovered company ends up researched or queued for it', async () => {
  const owner = await makeUser('Shadow Research', 'RESEARCH_OPS');
  await seedMarkets(owner.userId);
  rotatingProvider();

  for (let day = 0; day < DAYS; day += 1) await runDay();

  // The leak this guards: a company found on day three, never researched, never
  // queued again. It sits in inventory as a name and a URL for ever, and nothing on
  // any page is wrong -- there is simply one fewer prospect than there should be.
  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from accounts a
      where a.last_researched_at is null
        and a.merged_into_account_id is null
        and not exists (select 1 from jobs j
                         where j.account_id = a.account_id
                           and j.job_type in ('account_research','contact_research'))`);
  assert.equal(rows[0]!.n, 0,
    `${rows[0]!.n} companies were discovered and then forgotten: no research, nothing queued`);
});

test('a daily ceiling holds across a day of runs, not only within one', async () => {
  const owner = await makeUser('Shadow Spend', 'RESEARCH_OPS');
  await seedMarkets(owner.userId);
  rotatingProvider();
  // Enough for a few runs and not for thirty days of them.
  process.env['DISCOVERY_DAILY_BUDGET_USD'] = '0.05';

  for (let day = 0; day < DAYS; day += 1) await runDay();

  const spend = await spendPosition();
  assert.ok(spend.spentTodayUsd <= 0.05 + 0.006,
    `a ceiling of $0.05 was crossed: $${spend.spentTodayUsd.toFixed(3)} spent. Every run `
    + 'fit under it on its own and together they did not.');

  const blocked = await query<{ n: number }>(
    `select count(*)::int as n from jobs where outcome = 'DISCOVERY_BLOCKED'`);
  assert.ok(blocked.rows[0]!.n > 0, 'the ceiling never actually refused anything');
});

test('thirty days of the same markets do not multiply the same company', async () => {
  const owner = await makeUser('Shadow Dedupe', 'RESEARCH_OPS');
  await seedMarkets(owner.userId);
  rotatingProvider();

  for (let day = 0; day < DAYS; day += 1) await runDay();

  const { rows } = await query<{ canonical_domain: string; n: number }>(
    `select canonical_domain, count(*)::int as n from accounts
      where canonical_domain is not null and merged_into_account_id is null
      group by canonical_domain having count(*) > 1`);
  assert.deepEqual(rows, [],
    'the same company exists twice after thirty days of re-searching its market');
});

test('a market that keeps failing is backed off, not retried for ever', async () => {
  const owner = await makeUser('Shadow Backoff', 'RESEARCH_OPS');
  await seedMarkets(owner.userId);
  clearDiscoveryAdapters();
  registerDiscoveryAdapter({
    name: 'always-down', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover() { return refusedDiscovery('OUTAGE', 'down again'); },
  });

  for (let day = 0; day < 10; day += 1) {
    await scheduleDueMarkets();
    await drainQueue();
    // Time passes, but nothing resets the market's own backoff.
  }

  const { rows } = await query<{ name: string; consecutive_failures: number;
    next_refresh_at: Date | null; blocker_reason: string | null }>(
    'select name, consecutive_failures, next_refresh_at, blocker_reason from saved_markets');
  const stubborn = rows.filter((row) => row.consecutive_failures > 0);
  assert.ok(stubborn.length > 0, 'ten days of outages left no record on any market');
  for (const market of stubborn) {
    assert.ok(market.next_refresh_at && market.next_refresh_at > new Date(),
      `${market.name} is due again immediately after failing ${market.consecutive_failures} `
      + 'times, so a dead provider is retried in a tight loop all night');
  }
});
