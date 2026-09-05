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
import '../workers/contactResearch.js';   // registers contact_research / account_research
import '../workers/marketMiner.js';       // registers market_mine / zip_research

const { availableDiscoveryAdapters } = await import('../workers/marketMiner.js');
const adapters = availableDiscoveryAdapters();
console.log(
  `[worker] contact enrichment mode: ${config.contactEnrichmentMode}; ` +
  `paid provider: ${config.apolloApiKey ? 'configured' : 'not configured'}; ` +
  `discovery adapters: ${adapters.length ? adapters.map((a) => a.name).join(', ') : 'none (refresh only)'}`,
);

// A periodic sweep so a Saved Market does not drift stale while nobody is looking.
const SWEEP_INTERVAL_MS = Number(process.env.REFRESH_SWEEP_INTERVAL_MS ?? 15 * 60_000);
const { expireStaleEvidence, refreshAccountFreshness } = await import('../workers/marketMiner.js');
const { reconcilePendingBookings } = await import('../booking/webhooks.js');
const sweep = setInterval(async () => {
  try {
    const expired = await expireStaleEvidence();
    await refreshAccountFreshness();
    if (expired > 0) console.log(`[worker] marked ${expired} evidence records stale`);

    // A booking the provider never confirmed must stop looking upcoming.
    const bookings = await reconcilePendingBookings();
    if (bookings.failed > 0) {
      console.log(`[worker] closed ${bookings.failed} bookings the provider never confirmed`);
    }
  } catch (error) {
    console.error('[worker] freshness sweep failed', error);
  }
}, SWEEP_INTERVAL_MS);
sweep.unref();

const { recordWorkerStopped } = await import('../workers/runner.js');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} received, finishing current job then stopping`);
    stopWorker();
    // Say so before the process goes.
    //
    // The loop's own finally does this, but a worker inside a long job never reaches
    // it before the two-second deadline below, so a deliberate restart looked like an
    // outage on the operations panel for the next forty-five seconds -- exactly the
    // false alarm the heartbeat exists to avoid.
    setTimeout(async () => {
      await recordWorkerStopped().catch(() => { /* the process is going anyway */ });
      await closePool();
      process.exit(0);
    }, 2000);
  });
}

await runWorker();
await closePool();
