import { runBenchmark, LATENCY_TARGETS, SYNTHETIC_ONLY_NOTICE } from '../benchmark.ts';

/**
 * Prints the synthetic latency benchmark.
 *
 *   node --experimental-strip-types src/bin/benchmark.ts          JSON
 *   node --experimental-strip-types src/bin/benchmark.ts --table  readable
 *
 * No credential, no network, no call.
 */

const report = await runBenchmark();

if (process.argv.includes('--table')) {
  console.log(SYNTHETIC_ONLY_NOTICE);
  console.log();
  console.log('metric                              samples   p50    p95  target p50/p95  verdict');
  for (const [metric, row] of Object.entries(report.percentiles)) {
    console.log(
      `${metric.padEnd(36)}${String(row.samples).padStart(6)}`
      + `${String(row.p50 ?? '-').padStart(7)}${String(row.p95 ?? '-').padStart(7)}`
      + `${`${row.targetP50}/${row.targetP95}`.padStart(16)}  ${row.verdict}`);
  }
  console.log();
  console.log('scenario                              verdict       notes');
  for (const outcome of report.scenarios) {
    console.log(`${outcome.scenarioId.padEnd(38)}${outcome.verdict.padEnd(14)}`
      + `${outcome.failedChecks.join(', ') || outcome.missing.join(', ') || 'ok'}`);
  }
  console.log();
  console.log(`overall: ${report.verdict}`);
} else {
  console.log(JSON.stringify({ targets: LATENCY_TARGETS, ...report }, null, 2));
}

process.exit(report.verdict === 'FAIL' ? 1 : 0);
