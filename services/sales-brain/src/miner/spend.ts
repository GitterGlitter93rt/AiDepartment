import { query } from '../db/pool.js';

/**
 * The ceiling that stops a 24/7 miner spending money nobody agreed to.
 *
 * Everything else about provider cost is a control on one call: a per-run query
 * budget, bounded retries, a bounded poll. None of them bound the *day*. A miner
 * that searches correctly, cheaply and continuously can still spend a great deal by
 * morning, and the person who finds out is Michael reading an invoice.
 *
 * Refused before the money is spent, never after: the check is a precondition of
 * the call, not a report about it.
 */

/**
 * Zero means unset, which is treated as no ceiling rather than a ceiling of nothing.
 *
 * Read at call time rather than captured at import. A ceiling frozen at module load
 * is a ceiling that ignores anything set after the process started -- and the same
 * mistake in the other direction would make it untestable.
 */
export function dailyBudgetUsd(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env['DISCOVERY_DAILY_BUDGET_USD'] ?? '0');
}

/**
 * The most a single discovery run is assumed to cost when deciding whether it fits.
 *
 * A worst case rather than an average: the point of a ceiling is to be right on the
 * expensive day, and a provider that returns a bigger result than usual must not be
 * how the ceiling gets crossed.
 */
export function assumedRunCostUsd(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env['DISCOVERY_ASSUMED_RUN_COST_USD'] ?? '0.05');
}

export interface SpendPosition {
  /** What today has cost so far, actual where the provider said, estimated otherwise. */
  spentTodayUsd: number;
  /** How much of today's spend is estimated rather than confirmed by the provider. */
  estimatedPortionUsd: number;
  budgetUsd: number;
  /** True when there is a ceiling and this run would not fit under it. */
  wouldExceed: boolean;
  /** Null when no ceiling is configured. */
  remainingUsd: number | null;
}

/**
 * What has been spent today and whether another run fits.
 *
 * Actual and estimated are summed together but reported apart, because a day whose
 * cost is mostly estimated is a day nobody can hold the provider to.
 */
export async function spendPosition(options: {
  provider?: string; assumedRunCostUsd?: number;
} = {}): Promise<SpendPosition> {
  const { rows } = await query<{ total: string; estimated: string }>(
    `select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd)), 0)::text as total,
            coalesce(sum(case when actual_cost_usd is null
                              then estimated_cost_usd else 0 end), 0)::text as estimated
       from provider_usage
      where ($1::text is null or provider = $1)
        and requested_at >= date_trunc('day', now())`,
    [options.provider ?? null],
  );

  const spentTodayUsd = Number(rows[0]?.total ?? 0);
  const estimatedPortionUsd = Number(rows[0]?.estimated ?? 0);
  const assumed = options.assumedRunCostUsd ?? assumedRunCostUsd();
  const budget = dailyBudgetUsd();

  if (!(budget > 0)) {
    return {
      spentTodayUsd, estimatedPortionUsd, budgetUsd: 0,
      wouldExceed: false, remainingUsd: null,
    };
  }

  return {
    spentTodayUsd,
    estimatedPortionUsd,
    budgetUsd: budget,
    // The worst case for this run has to fit, not the average: the point of a
    // ceiling is to be right on the expensive day.
    wouldExceed: spentTodayUsd + assumed > budget,
    remainingUsd: Math.max(0, budget - spentTodayUsd),
  };
}

/** A sentence for an operator whose market did not get searched because of cost. */
export function budgetRefusalReason(position: SpendPosition): string {
  return `The daily provider budget of $${position.budgetUsd.toFixed(2)} is spent: `
    + `$${position.spentTodayUsd.toFixed(2)} has gone today. No search was made, so `
    + 'nothing has been learned about this market. The budget resets at midnight, or '
    + 'raise DISCOVERY_DAILY_BUDGET_USD.';
}
