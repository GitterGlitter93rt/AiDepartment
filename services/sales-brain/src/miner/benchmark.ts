import { query } from '../db/pool.js';
import type { DiscoveryAdapter, DiscoveryQuery, DiscoveredBusiness } from '../workers/marketMiner.js';

/**
 * First-benchmark harness for a discovery provider.
 * Authority: market-miner-dataforseo-first-hvac-benchmark-plan.md §3, §11, §17.
 *
 * Two ceilings apply and either one stops the run: a task count per phase and a hard
 * dollar ceiling across the whole benchmark. The dollar ceiling is enforced *before*
 * a task is sent, using the worst case for a task, because a ceiling checked after
 * the spend is not a ceiling.
 *
 * Nothing here decides whether the provider is good. It runs the phases, counts what
 * they cost and what they returned, and prints the yield table the decision is made
 * from — no target percentages invented before results exist.
 */

export const BENCHMARK_CEILINGS = {
  phase0SmokeMax: 6,
  phase1City: 12,
  phase2ZctaMax: 80,
  phase3GapMax: 100,
  liveValidationMax: 20,
  absoluteTotalTaskMax: 218,
  maxProviderCostUsd: 2.00,
} as const;

export type BenchmarkPhase = 'phase_0_smoke' | 'phase_1_city' | 'phase_2_zcta'
  | 'phase_3_gap' | 'live_validation';

const PHASE_CEILING: Record<BenchmarkPhase, number> = {
  phase_0_smoke: BENCHMARK_CEILINGS.phase0SmokeMax,
  phase_1_city: BENCHMARK_CEILINGS.phase1City,
  phase_2_zcta: BENCHMARK_CEILINGS.phase2ZctaMax,
  phase_3_gap: BENCHMARK_CEILINGS.phase3GapMax,
  live_validation: BENCHMARK_CEILINGS.liveValidationMax,
};

export type StopReason =
  | 'PHASE_COMPLETE'
  | 'PHASE_TASK_CEILING'
  | 'TOTAL_TASK_CEILING'
  | 'COST_CEILING'
  | 'PROVIDER_NOT_AVAILABLE';

export interface BenchmarkCell {
  phase: BenchmarkPhase;
  query: DiscoveryQuery;
  label: string;
}

export interface BenchmarkResult {
  tasksRun: number;
  tasksSkipped: number;
  costUsd: number;
  stopReason: StopReason;
  /** One row per cell actually run, for the query-yield table (§16). */
  rows: {
    phase: BenchmarkPhase;
    label: string;
    returned: number;
    paidResults: number;
    withDomain: number;
    costUsd: number;
  }[];
}

/**
 * Reads what the provider has actually been charged so far.
 *
 * Taken from recorded usage rather than from a running total in memory, so a
 * benchmark resumed after a crash cannot spend the ceiling twice.
 */
export async function providerSpendUsd(provider = 'dataforseo'): Promise<number> {
  const { rows } = await query<{ total: string | null }>(
    `select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd)), 0)::text as total
       from provider_usage where provider = $1`,
    [provider],
  );
  return Number(rows[0]?.total ?? 0);
}

export interface BenchmarkOptions {
  adapter: DiscoveryAdapter;
  cells: BenchmarkCell[];
  /** Worst case a single task can cost, used to refuse before spending. */
  worstCaseTaskCostUsd?: number;
  maxProviderCostUsd?: number;
  /** Spend already recorded against this provider. */
  spentSoFarUsd?: number;
  /** Observes each cell's cost; defaults to reading recorded usage. */
  costOfLastTaskUsd?: () => Promise<number>;
}

export async function runBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const ceiling = options.maxProviderCostUsd ?? BENCHMARK_CEILINGS.maxProviderCostUsd;
  const worstCase = options.worstCaseTaskCostUsd ?? 0.05;

  const result: BenchmarkResult = {
    tasksRun: 0, tasksSkipped: 0,
    costUsd: options.spentSoFarUsd ?? await providerSpendUsd(),
    stopReason: 'PHASE_COMPLETE', rows: [],
  };
  const startingSpend = result.costUsd;

  if (!options.adapter.isConfigured()) {
    result.stopReason = 'PROVIDER_NOT_AVAILABLE';
    result.tasksSkipped = options.cells.length;
    return result;
  }

  const perPhase = new Map<BenchmarkPhase, number>();

  for (const [index, cell] of options.cells.entries()) {
    const phaseCount = perPhase.get(cell.phase) ?? 0;

    if (phaseCount >= PHASE_CEILING[cell.phase]) {
      result.stopReason = 'PHASE_TASK_CEILING';
      result.tasksSkipped += 1;
      continue;
    }
    if (result.tasksRun >= BENCHMARK_CEILINGS.absoluteTotalTaskMax) {
      result.stopReason = 'TOTAL_TASK_CEILING';
      result.tasksSkipped = options.cells.length - index;
      break;
    }
    // Refused before the spend, not after: the worst case for this task has to fit
    // under the ceiling or the task does not go.
    if (result.costUsd + worstCase > ceiling) {
      result.stopReason = 'COST_CEILING';
      result.tasksSkipped = options.cells.length - index;
      break;
    }

    const before = result.costUsd;
    let found: DiscoveredBusiness[] = [];
    try {
      // The adapter reports why it came back with what it did; the benchmark cares
      // only about yield, so a status other than OK simply contributes no rows.
      found = (await options.adapter.discover(cell.query)).businesses;
    } catch {
      // A failed task still costs, and still counts against both ceilings.
      found = [];
    }
    result.tasksRun += 1;
    perPhase.set(cell.phase, phaseCount + 1);

    result.costUsd = options.costOfLastTaskUsd
      ? before + await options.costOfLastTaskUsd()
      : await providerSpendUsd();

    result.rows.push({
      phase: cell.phase,
      label: cell.label,
      returned: found.length,
      paidResults: found.filter((row) => String(row.resultType ?? '').startsWith('PAID')
        || row.resultType === 'LOCAL_SERVICES_AD').length,
      withDomain: found.filter((row) => Boolean(row.website)).length,
      costUsd: Number((result.costUsd - before).toFixed(6)),
    });
  }

  // The report is about the benchmark's own spend, not the provider's lifetime.
  result.costUsd = Number((result.costUsd - startingSpend).toFixed(6));
  return result;
}

/**
 * The query-yield table (§16). Plain counts, no rates invented from a handful of
 * observations, and no verdict — the decision is a person's.
 */
export function yieldTable(result: BenchmarkResult): string {
  const header = 'phase | cell | returned | paid | with domain | cost usd';
  const rows = result.rows.map((row) =>
    `${row.phase} | ${row.label} | ${row.returned} | ${row.paidResults} | `
    + `${row.withDomain} | ${row.costUsd.toFixed(4)}`);
  const totals = `TOTAL | ${result.tasksRun} task(s) | `
    + `${result.rows.reduce((sum, row) => sum + row.returned, 0)} | `
    + `${result.rows.reduce((sum, row) => sum + row.paidResults, 0)} | `
    + `${result.rows.reduce((sum, row) => sum + row.withDomain, 0)} | `
    + `${result.costUsd.toFixed(4)}`;
  return [header, ...rows, totals, `stopped: ${result.stopReason}`].join('\n');
}

/** The Jacksonville / St. Augustine HVAC cells the first benchmark runs (§4-§9). */
export function firstHvacBenchmarkCells(): BenchmarkCell[] {
  const cities = ['Jacksonville, Florida', 'St. Augustine, Florida'];
  const services = ['emergency ac repair', 'ac repair', 'hvac repair', 'air conditioning repair',
                    'ac replacement', 'hvac company'];
  const cells: BenchmarkCell[] = [];

  // Phase 0 — the smallest number of tasks that proves the adapter works end to end.
  for (const city of cities) {
    for (const service of services.slice(0, 3)) {
      cells.push({
        phase: 'phase_0_smoke', label: `${service} — ${city}`,
        query: {
          verticalProfileId: 'hvac', geographyType: 'city', geographyValue: city,
          miningMode: service, queryBudget: 1,
        },
      });
    }
  }
  // Phase 1 — the rest of the city-level matrix.
  for (const city of cities) {
    for (const service of services.slice(3)) {
      cells.push({
        phase: 'phase_1_city', label: `${service} — ${city}`,
        query: {
          verticalProfileId: 'hvac', geographyType: 'city', geographyValue: city,
          miningMode: service, queryBudget: 1,
        },
      });
    }
  }
  return cells;
}
