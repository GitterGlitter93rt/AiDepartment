import { query } from '../../src/db/pool.js';
import { drainQueue } from '../../src/workers/runner.js';
import {
  registerDiscoveryAdapter, clearDiscoveryAdapters,
  type DiscoveryAdapter, type DiscoveryResult,
} from '../../src/workers/marketMiner.js';
import {
  scheduleDueMarkets, MAX_MARKETS_PER_PASS, MAX_MARKETS_IN_FLIGHT,
} from '../../src/workers/marketScheduler.js';

/**
 * A hundred saved markets, a worker that dies in the middle, and the question an
 * operator actually has: does this converge, and does it buy each search once.
 *
 * Lives in the test tree rather than under `src/` on purpose. It needs a fake
 * provider, and `registrationParity` requires that exactly one place in the product
 * registers a discovery adapter -- the registry the miner reads -- so that which
 * providers exist can never depend on which file happened to be imported. That guard
 * is the whole lesson of M-15: an adapter that was correct in every respect was built
 * in one file, never handed to the registry, and reported "no provider configured"
 * whatever the environment held. A stub provider registering itself from inside the
 * product tree is exactly the hazard it exists to prevent, so the apparatus stays
 * out here where it cannot be imported by the API or the worker.
 *
 * The individual invariants have unit tests. What they cannot show is the shape over
 * time -- a backlog that drains at a bounded rate, a market that never starves, a
 * restart that costs one collection rather than one search, and a total spend equal
 * to the number of markets rather than some multiple of it. A single cycle looks
 * perfectly correct in every one of those cases, which is exactly how the last
 * scheduler defect survived: it took thirty simulated days to see.
 */

export interface PassRecord {
  pass: number;
  due: number;
  queued: number;
  collecting: number;
  skippedBatch: number;
  skippedInFlight: number;
  skippedRunning: number;
  inFlightAfter: number;
  drained: number;
  note: string | null;
}

export interface ConvergenceReport {
  markets: number;
  passes: PassRecord[];
  /** Provider submissions actually made, which is what the money follows. */
  submissions: number;
  /** Markets that ended up refreshed at least once. */
  refreshed: number;
  /** Markets still owed a refresh when the run gave up. */
  stillDue: number;
  /** Markets that were searched more than once: the expensive failure. */
  boughtTwice: { name: string; searches: number }[];
  /** Highest number of markets in flight at any observation. */
  peakInFlight: number;
  restartAtPass: number | null;
  recoveredAfterRestart: number;
  problems: string[];
}

/** Counts submissions per market, so double-buying is a number rather than a vibe. */
function packetAdapter(perMarket: Map<string, number>): DiscoveryAdapter {
  let sequence = 0;
  return {
    name: 'blockb-packet', requiresCredential: false, governanceReviewed: true,
    isConfigured: () => true,
    async discover(request): Promise<DiscoveryResult> {
      const key = String(request.geographyValue ?? 'unknown');
      perMarket.set(key, (perMarket.get(key) ?? 0) + 1);
      sequence += 1;
      return {
        status: 'OK',
        businesses: [{
          name: `Packet Co ${key}-${sequence}`, website: null,
          phone: `904-555-${String(1000 + (sequence % 8999)).slice(-4)}`,
        }],
        providerRows: 1, rejectedRows: 0, duplicateRows: 0, costUsd: 0.0125,
      };
    },
  };
}

async function inFlightNow(): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `select count(distinct market_id)::int as n from jobs
      where job_type = 'market_mine' and status in ('QUEUED','RUNNING')
        and market_id is not null`);
  return rows[0]?.n ?? 0;
}

/**
 * A worker that died holding its work.
 *
 * Recovery here is lease-based: a RUNNING job whose lease has expired is picked up
 * again. So the honest simulation of a crash is to leave the jobs leased and stop --
 * not to delete them, which would be a tidier world than the one that exists.
 */
async function simulateWorkerDeath(): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `with taken as (
       update jobs set status = 'RUNNING', leased_until = now() - interval '10 minutes',
                       attempts = attempts
        where job_type = 'market_mine' and status = 'QUEUED'
        returning job_id)
     select count(*)::int as n from taken`);
  return rows[0]?.n ?? 0;
}

export async function runConvergence(options: {
  markets?: number;
  restartAtPass?: number | null;
  maxPasses?: number;
} = {}): Promise<ConvergenceReport> {
  const marketCount = options.markets ?? 100;
  const restartAtPass = options.restartAtPass ?? 4;
  const maxPasses = options.maxPasses ?? 200;

  clearDiscoveryAdapters();
  const perMarket = new Map<string, number>();
  registerDiscoveryAdapter(packetAdapter(perMarket));

  // Every market overdue at the same instant: the reboot case, which is the one that
  // turns a bounded scheduler into a hundred simultaneous paid searches.
  const zips: string[] = [];
  for (let index = 0; index < marketCount; index += 1) {
    const zip = String(30000 + index);
    zips.push(zip);
    await query(
      `insert into saved_markets
         (name, vertical_profile_id, geography_type, geography_definition, mining_mode,
          enabled, next_refresh_at, created_at)
       values ($1, 'hvac', 'zip_zcta', jsonb_build_object('value', $2::text),
               'advertiser_first', true, now() - interval '2 days',
               now() - ($3::text || ' minutes')::interval)`,
      [`Packet Market ${index + 1}`, zip, String(marketCount - index)]);
  }

  const passes: PassRecord[] = [];
  let peakInFlight = 0;
  let recoveredAfterRestart = 0;
  let restarted = false;

  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const result = await scheduleDueMarkets();
    const inFlight = await inFlightNow();
    peakInFlight = Math.max(peakInFlight, inFlight);

    let note: string | null = null;
    let drained = 0;

    if (!restarted && restartAtPass !== null && pass === restartAtPass) {
      // The worker takes the queue and dies before finishing any of it.
      const held = await simulateWorkerDeath();
      note = `worker died holding ${held} leased job(s)`;
      restarted = true;
      // The next pass is the restart: nothing is drained on this one.
    } else {
      drained = await drainQueue();
      if (restarted && recoveredAfterRestart === 0 && drained > 0) {
        recoveredAfterRestart = drained;
        note = `restarted: ${drained} job(s) recovered from the expired leases`;
      }
    }

    passes.push({
      pass, due: result.due, queued: result.queued, collecting: result.collecting,
      skippedBatch: result.skipped.filter((s) => s.reason === 'BATCH_LIMIT').length,
      skippedInFlight: result.skipped.filter((s) => s.reason === 'IN_FLIGHT_LIMIT').length,
      skippedRunning: result.skipped.filter((s) => s.reason === 'ALREADY_RUNNING').length,
      inFlightAfter: inFlight, drained, note,
    });

    if (result.due === 0 && (await inFlightNow()) === 0) break;
  }

  const { rows: refreshedRows } = await query<{ n: number }>(
    `select count(*)::int as n from saved_markets where last_refresh_at is not null`);
  const { rows: dueRows } = await query<{ n: number }>(
    `select count(*)::int as n from saved_markets
      where enabled and (next_refresh_at is null or next_refresh_at <= now())`);

  const submissions = [...perMarket.values()].reduce((total, n) => total + n, 0);
  const boughtTwice = zips
    .map((zip, index) => ({ name: `Packet Market ${index + 1}`,
                            searches: perMarket.get(zip) ?? 0 }))
    .filter((entry) => entry.searches > 1);

  const problems: string[] = [];
  if (refreshedRows[0]!.n !== marketCount) {
    problems.push(`${marketCount - refreshedRows[0]!.n} market(s) never refreshed: the `
      + 'backlog did not converge');
  }
  if (boughtTwice.length > 0) {
    problems.push(`${boughtTwice.length} market(s) were searched more than once, which `
      + 'is money spent twice for one answer');
  }
  if (submissions !== marketCount) {
    problems.push(`${submissions} searches were bought for ${marketCount} markets`);
  }
  if (peakInFlight > MAX_MARKETS_IN_FLIGHT) {
    problems.push(`${peakInFlight} markets were in flight at once, over the ceiling of `
      + `${MAX_MARKETS_IN_FLIGHT}`);
  }
  for (const record of passes) {
    if (record.queued > MAX_MARKETS_PER_PASS) {
      problems.push(`pass ${record.pass} queued ${record.queued}, over the batch limit `
        + `of ${MAX_MARKETS_PER_PASS}`);
    }
  }
  if (restartAtPass !== null && recoveredAfterRestart === 0) {
    problems.push('the simulated restart recovered nothing, so the crash was not '
      + 'actually exercised');
  }

  return {
    markets: marketCount, passes, submissions,
    refreshed: refreshedRows[0]!.n, stillDue: dueRows[0]!.n,
    boughtTwice, peakInFlight,
    restartAtPass: restartAtPass, recoveredAfterRestart, problems,
  };
}

/**
 * A market paused in the middle of a backlog, and switched back on.
 *
 * Included in the packet rather than left to the unit tests because the number an
 * operator wants is the spend: pausing a market has to remove it from the bill while
 * it is off, and returning it has to cost exactly one search, not a backlog's worth.
 */
export async function runPauseInBacklog(): Promise<{
  submissionsWhilePaused: number;
  submissionsAfterResume: number;
  churnedJobs: number;
  outcome: string | null;
  problems: string[];
}> {
  clearDiscoveryAdapters();
  const perMarket = new Map<string, number>();
  registerDiscoveryAdapter(packetAdapter(perMarket));

  const { rows } = await query<{ market_id: string }>(
    `insert into saved_markets
       (name, vertical_profile_id, geography_type, geography_definition, mining_mode,
        enabled, next_refresh_at)
     values ('Packet Paused Market', 'hvac', 'zip_zcta',
             jsonb_build_object('value', '39999'::text), 'advertiser_first', true,
             now() - interval '2 days')
     returning market_id`);
  const marketId = rows[0]!.market_id;

  // Queued while enabled, paused before the worker gets to it.
  await scheduleDueMarkets();
  await query('update saved_markets set enabled = false where market_id = $1', [marketId]);
  await drainQueue();
  const submissionsWhilePaused = perMarket.get('39999') ?? 0;

  // Sweeps while paused must not churn jobs.
  const before = await query<{ n: number }>(
    `select count(*)::int as n from jobs where market_id = $1`, [marketId]);
  for (let pass = 0; pass < 3; pass += 1) await scheduleDueMarkets();
  const after = await query<{ n: number }>(
    `select count(*)::int as n from jobs where market_id = $1`, [marketId]);

  const { rows: outcomeRows } = await query<{ last_outcome: string | null }>(
    `select last_outcome from saved_markets where market_id = $1`, [marketId]);

  // Switched back on, it costs exactly one search.
  await query(
    `update saved_markets set enabled = true, next_refresh_at = now() - interval '1 hour'
      where market_id = $1`, [marketId]);
  await scheduleDueMarkets();
  await drainQueue();
  const submissionsAfterResume = (perMarket.get('39999') ?? 0) - submissionsWhilePaused;

  const problems: string[] = [];
  if (submissionsWhilePaused !== 0) {
    problems.push(`a paused market bought ${submissionsWhilePaused} search(es)`);
  }
  if (after.rows[0]!.n !== before.rows[0]!.n) {
    problems.push(`${after.rows[0]!.n - before.rows[0]!.n} job(s) were churned for a `
      + 'market that is switched off');
  }
  if (submissionsAfterResume !== 1) {
    problems.push(`resuming cost ${submissionsAfterResume} search(es), not one`);
  }
  if (outcomeRows[0]!.last_outcome === 'ZERO_RESULTS') {
    problems.push('a paused market reported itself as a market with nothing in it');
  }

  return {
    submissionsWhilePaused, submissionsAfterResume,
    churnedJobs: after.rows[0]!.n - before.rows[0]!.n,
    outcome: outcomeRows[0]!.last_outcome, problems,
  };
}
