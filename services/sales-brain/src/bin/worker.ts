/**
 * Background research worker.
 *
 * Runs in its own process against the same database as the API. Heavy crawling and
 * enrichment belong here and must never share a runtime with the realtime voice
 * path (CLAUDE-CURRENT-TASK.md §8).
 */
import { config } from '../config.js';
import { closePool } from '../db/pool.js';
import { runWorker, stopWorker } from '../workers/runner.js';
import '../workers/contactResearch.js';   // registers its handlers

console.log(
  `[worker] contact enrichment mode: ${config.contactEnrichmentMode}; ` +
  `paid provider: ${config.apolloApiKey ? 'configured' : 'not configured'}`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} received, finishing current job then stopping`);
    stopWorker();
    setTimeout(async () => { await closePool(); process.exit(0); }, 2000);
  });
}

await runWorker();
await closePool();
