import { query } from '../db/pool.js';
import { enqueueMarketResearch, discoveryFingerprint } from './enqueue.js';
import { availableDiscoveryAdapters } from './marketMiner.js';
import { openProviderTask } from '../miner/providerTasks.js';

/**
 * Saved markets that maintain themselves.
 *
 * The miner ran when somebody pressed a button. The product is inventory that is
 * already there when a rep arrives: markets get re-searched on their own, quietly,
 * without anybody watching.
 *
 * Everything here exists to stop that being expensive or unfair:
 *
 *   - a market with a search already queued or running is never queued again;
 *   - a market with a provider task still owed to us is never re-bought;
 *   - a provider that is failing is backed off, not hammered once a minute;
 *   - a bounded number of markets go per pass, so a reboot with ninety stale
 *     markets does not fire ninety paid searches in the same second;
 *   - the oldest attempt goes first, so no market can starve behind a busier one;
 *   - a disabled market is not scheduled at all.
 */

/** How often a market wants looking at, when it does not say. */
export const DEFAULT_REFRESH_INTERVAL_HOURS = Number(
  process.env['MARKET_REFRESH_INTERVAL_HOURS'] ?? '24');

/**
 * How many markets may be queued in one pass.
 *
 * The number that matters after a reboot: ninety stale markets must not become
 * ninety simultaneous paid searches. They go a few at a time, oldest first, and the
 * queue drains at whatever rate the worker and the provider can sustain.
 */
export const MAX_MARKETS_PER_PASS = Number(process.env['MARKET_SCHEDULER_BATCH'] ?? '5');

/** The ceiling on markets in flight at once, however many are due. */
export const MAX_MARKETS_IN_FLIGHT = Number(process.env['MARKET_SCHEDULER_IN_FLIGHT'] ?? '3');

/** Backoff after consecutive failures, in hours. Capped so it recovers eventually. */
export function backoffHours(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(24, 2 ** Math.min(consecutiveFailures - 1, 5));
}

export type SkipReason =
  | 'ALREADY_RUNNING'
  | 'PROVIDER_TASK_OUTSTANDING'
  | 'IN_FLIGHT_LIMIT'
  | 'BATCH_LIMIT';

export interface SchedulerResult {
  /** Markets enabled and past their next refresh time. */
  due: number;
  queued: number;
  /** Market ids that were due but held back, and why. */
  skipped: { marketId: string; reason: SkipReason }[];
  /** True when no provider is configured, so nothing was scheduled at all. */
  discoveryBlocked: boolean;
}

interface DueMarket {
  market_id: string;
  name: string;
  vertical_profile_id: string | null;
  geography_type: string;
  geography_definition: Record<string, unknown>;
  mining_mode: string;
  consecutive_failures: number;
}

function geographyValueOf(market: DueMarket): string | null {
  const definition = market.geography_definition ?? {};
  const value = definition['value'] ?? definition['zip'] ?? definition['city']
    ?? definition['state'] ?? null;
  return value == null ? null : String(value);
}

/**
 * Queues discovery for the markets that are due.
 *
 * Called on the worker's sweep. Safe to call at any interval and safe to call
 * twice: everything it does is guarded by the same idempotency the manual path uses.
 */
export async function scheduleDueMarkets(options: {
  batchSize?: number;
  now?: Date;
} = {}): Promise<SchedulerResult> {
  const batchSize = options.batchSize ?? MAX_MARKETS_PER_PASS;
  const skipped: { marketId: string; reason: SkipReason }[] = [];

  // Nothing to schedule if nothing can search. Recorded on the markets rather than
  // left as silence, so the page can say why a market that looks due is not moving.
  const adapters = availableDiscoveryAdapters();
  if (adapters.length === 0) {
    await query(
      `update saved_markets
          set blocker_reason = 'No discovery provider is configured, so this market '
                               || 'cannot be searched for new businesses.'
        where enabled and blocker_reason is distinct from
              'No discovery provider is configured, so this market cannot be searched '
              || 'for new businesses.'`);
    const { rows } = await query<{ n: number }>(
      `select count(*)::int as n from saved_markets where enabled`);
    return { due: rows[0]?.n ?? 0, queued: 0, skipped: [], discoveryBlocked: true };
  }

  // How many are already moving. A market in flight is one the worker is spending
  // on, and the ceiling is about spend as much as about load.
  const { rows: inFlightRows } = await query<{ n: number }>(
    `select count(distinct j.market_id)::int as n
       from jobs j
      where j.job_type = 'market_mine'
        and j.status in ('QUEUED','RUNNING')
        and j.market_id is not null`);
  let inFlight = inFlightRows[0]?.n ?? 0;

  const { rows: due } = await query<DueMarket>(
    `select market_id, name, vertical_profile_id, geography_type, geography_definition,
            mining_mode, consecutive_failures
       from saved_markets
      where enabled
        and (next_refresh_at is null or next_refresh_at <= $1)
      -- Oldest attempt first, so a market cannot starve behind a busier one, and a
      -- market never attempted goes before one that has.
      order by last_attempted_at asc nulls first, created_at asc`,
    [options.now ?? new Date()],
  );

  let queued = 0;
  for (const market of due) {
    if (queued >= batchSize) {
      skipped.push({ marketId: market.market_id, reason: 'BATCH_LIMIT' });
      continue;
    }
    if (inFlight >= MAX_MARKETS_IN_FLIGHT) {
      skipped.push({ marketId: market.market_id, reason: 'IN_FLIGHT_LIMIT' });
      continue;
    }

    // A search already queued or running for this market is the same search.
    const { rows: running } = await query<{ n: number }>(
      `select count(*)::int as n from jobs
        where job_type = 'market_mine' and market_id = $1
          and status in ('QUEUED','RUNNING')`,
      [market.market_id]);
    if ((running[0]?.n ?? 0) > 0) {
      skipped.push({ marketId: market.market_id, reason: 'ALREADY_RUNNING' });
      continue;
    }

    // A provider task still owed to us is a search already paid for. Buying another
    // is the most expensive mistake this scheduler could make.
    const fingerprint = discoveryFingerprint({
      marketId: market.market_id,
      verticalProfileId: market.vertical_profile_id,
      geographyType: market.geography_type,
      geographyValue: geographyValueOf(market),
      miningMode: market.mining_mode,
    });
    let outstanding = false;
    for (const adapter of adapters) {
      if (await openProviderTask(adapter.name, fingerprint)) { outstanding = true; break; }
    }
    if (outstanding) {
      skipped.push({ marketId: market.market_id, reason: 'PROVIDER_TASK_OUTSTANDING' });
      continue;
    }

    const result = await enqueueMarketResearch({
      verticalProfileId: market.vertical_profile_id,
      geographyType: market.geography_type,
      geographyValue: geographyValueOf(market),
      marketId: market.market_id,
      requestedBy: null as unknown as string,
      miningMode: market.mining_mode,
    });

    // Marked attempted whether or not a job was created, so a market whose
    // fingerprint collided with a manual search does not spin on the next pass.
    await query(
      `update saved_markets
          set last_attempted_at = now(),
              next_refresh_at = now() + ((coalesce(refresh_interval_hours, $2)
                                          + $3) || ' hours')::interval,
              blocker_reason = null
        where market_id = $1`,
      [market.market_id, DEFAULT_REFRESH_INTERVAL_HOURS,
       backoffHours(market.consecutive_failures)],
    );
    if (result.created) { queued += 1; inFlight += 1; }
  }

  return { due: due.length, queued, skipped, discoveryBlocked: false };
}

/**
 * Records what a finished market job means for its market.
 *
 * Attempted and succeeded are different facts. A market searched every hour and
 * failing every hour has a recent attempt and no coverage, and without this the
 * page could not tell the two apart.
 */
export async function recordMarketOutcome(input: {
  marketId: string;
  outcome: string;
  outcomeReason?: string | null;
}): Promise<void> {
  // A provider that answered resets the backoff, whatever the answer was: an empty
  // market is a working provider.
  const answered = input.outcome === 'COMPLETED' || input.outcome === 'ZERO_RESULTS';
  const pending = input.outcome === 'PROVIDER_PENDING';

  await query(
    `update saved_markets
        set last_outcome = $2,
            last_outcome_reason = $3,
            last_success_at = case when $4 then now() else last_success_at end,
            consecutive_failures = case
              when $4 then 0
              -- A pending task is not a failure. The provider took the work.
              when $5 then consecutive_failures
              else consecutive_failures + 1 end,
            next_refresh_at = case
              when $4 or $5
                then now() + (coalesce(refresh_interval_hours, $6) || ' hours')::interval
              else now() + ((coalesce(refresh_interval_hours, $6)
                             + $7) || ' hours')::interval end,
            blocker_reason = case when $4 or $5 then null else $3 end
      where market_id = $1`,
    [
      input.marketId, input.outcome, input.outcomeReason ?? null, answered, pending,
      DEFAULT_REFRESH_INTERVAL_HOURS,
      // The backoff for the failure that just happened, not the one before it.
      backoffHours(1),
    ],
  );

  if (!answered && !pending) {
    // Grow the backoff from the new failure count, which the update above set.
    await query(
      `update saved_markets
          set next_refresh_at = now() + ((coalesce(refresh_interval_hours, $2)
                                          + least(24, power(2, least(consecutive_failures - 1, 5))))
                                         || ' hours')::interval
        where market_id = $1`,
      [input.marketId, DEFAULT_REFRESH_INTERVAL_HOURS]);
  }
}
