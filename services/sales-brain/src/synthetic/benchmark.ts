import { performance } from 'node:perf_hooks';
import { pool, query } from '../db/pool.js';

/**
 * Query-level benchmark for the read models the CRM actually uses.
 *
 * The point is to find the slow ones, so nothing here is allowed to make a query
 * look faster than it is: no fixture shrinking, no warm-cache-only timing, and the
 * row count is reported so a query cannot "win" by returning nothing.
 *
 * Budgets are for an internal CRM used by a handful of reps on one box, not for a
 * public site. A page that assembles several of these still has to feel immediate,
 * so the budget for one read model is the interactive budget divided by the number
 * of reads its page performs.
 */

export interface Budget {
  /** Green: nobody notices. */
  good: number;
  /** Amber: acceptable for a manager report, not for a rep's main list. */
  acceptable: number;
}

export interface CaseResult {
  id: string;
  page: string;
  budget: Budget;
  runs: number;
  coldMs: number;
  medianMs: number;
  p95Ms: number;
  rows: number;
  verdict: 'GOOD' | 'ACCEPTABLE' | 'SLOW';
  note?: string;
}

export interface BenchmarkReport {
  ranAt: string;
  scale: { accounts: number; endpoints: number; evidence: number; activities: number };
  cases: CaseResult[];
  slowest: CaseResult[];
  counts: Record<CaseResult['verdict'], number>;
  verdict: 'PASS' | 'FAIL';
}

export interface BenchmarkCase {
  id: string;
  page: string;
  budget: Budget;
  /** Returns rows; the harness times it. */
  run: () => Promise<{ rows: number }>;
  note?: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!;
}

export async function runCase(item: BenchmarkCase, runs = 5): Promise<CaseResult> {
  // The first run is reported separately: a rep opening a page they have not opened
  // before pays the cold cost, and hiding it behind a warm median flatters us.
  const first = performance.now();
  const { rows } = await item.run();
  const coldMs = performance.now() - first;

  const timings: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    await item.run();
    timings.push(performance.now() - started);
  }

  const medianMs = median(timings);
  const verdict = medianMs <= item.budget.good ? 'GOOD'
    : medianMs <= item.budget.acceptable ? 'ACCEPTABLE' : 'SLOW';

  return {
    id: item.id, page: item.page, budget: item.budget, runs,
    coldMs: Math.round(coldMs * 10) / 10,
    medianMs: Math.round(medianMs * 10) / 10,
    p95Ms: Math.round(percentile(timings, 0.95) * 10) / 10,
    rows, verdict, ...(item.note ? { note: item.note } : {}),
  };
}

export async function runBenchmark(cases: BenchmarkCase[], runs = 5): Promise<BenchmarkReport> {
  const scale = await query<{ accounts: number; endpoints: number; evidence: number; activities: number }>(
    `select (select count(*)::int from accounts) as accounts,
            (select count(*)::int from contact_endpoints) as endpoints,
            (select count(*)::int from evidence_records) as evidence,
            (select count(*)::int from activities) as activities`);

  const results: CaseResult[] = [];
  for (const item of cases) {
    results.push(await runCase(item, runs));
  }

  const counts = { GOOD: 0, ACCEPTABLE: 0, SLOW: 0 } as Record<CaseResult['verdict'], number>;
  for (const result of results) counts[result.verdict] += 1;

  return {
    ranAt: new Date().toISOString(),
    scale: scale.rows[0]!,
    cases: results,
    slowest: [...results].sort((a, b) => b.medianMs - a.medianMs).slice(0, 10),
    counts,
    verdict: counts.SLOW === 0 ? 'PASS' : 'FAIL',
  };
}

/** EXPLAIN output for one query, for the record rather than for a pass/fail. */
export async function explain(sql: string, values: unknown[] = []): Promise<string> {
  const { rows } = await pool.query<{ 'QUERY PLAN': string }>(
    `explain (analyze, buffers, format text) ${sql}`, values);
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

export function table(report: BenchmarkReport): string {
  const lines = [
    `scale: ${report.scale.accounts} accounts, ${report.scale.endpoints} endpoints, `
      + `${report.scale.evidence} evidence, ${report.scale.activities} activities`,
    '',
    'case                                      page              cold   median    p95    rows  budget  verdict',
  ];
  for (const result of report.cases) {
    lines.push([
      result.id.padEnd(41),
      result.page.padEnd(17),
      String(result.coldMs).padStart(6),
      String(result.medianMs).padStart(8),
      String(result.p95Ms).padStart(6),
      String(result.rows).padStart(7),
      String(result.budget.good).padStart(7),
      result.verdict,
    ].join(' '));
  }
  lines.push('', `verdict: ${report.verdict} `
    + `(${report.counts.GOOD} good, ${report.counts.ACCEPTABLE} acceptable, ${report.counts.SLOW} slow)`);
  return lines.join('\n');
}
