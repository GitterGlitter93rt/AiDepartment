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

// Discovery providers. Registered in both processes so the API answers "can this
// system find a new business" the same way the worker would; registering an
// unconfigured adapter changes nothing, because availability is decided by the
// credential and the governance review rather than by the import.
const { registerConfiguredDiscoveryAdapters } = await import('../miner/registry.js');
const availableProviders = registerConfiguredDiscoveryAdapters();

const adapters = availableProviders.map((name) => ({ name }));
console.log(
  `[worker] contact enrichment mode: ${config.contactEnrichmentMode}; ` +
  `paid provider: ${config.apolloApiKey ? 'configured' : 'not configured'}; ` +
  `discovery adapters: ${adapters.length ? adapters.map((a) => a.name).join(', ') : 'none (refresh only)'}`,
);

// A periodic sweep so a Saved Market does not drift stale while nobody is looking.
const SWEEP_INTERVAL_MS = Number(process.env.REFRESH_SWEEP_INTERVAL_MS ?? 15 * 60_000);
const { expireStaleEvidence, refreshAccountFreshness } = await import('../workers/marketMiner.js');
const { reconcilePendingBookings } = await import('../booking/webhooks.js');
const { reconcileMissingResearch, recomputeStaleScores } = await import('../workers/researchReconcile.js');
const { scheduleDueMarkets } = await import('../workers/marketScheduler.js');
const sweep = setInterval(async () => {
  try {
    const expired = await expireStaleEvidence();
    await refreshAccountFreshness();
    if (expired > 0) console.log(`[worker] marked ${expired} evidence records stale`);

    // Discovered Accounts that never reached research. A worker that died between
    // creating them and queuing their research leaves companies nothing will ever
    // look at again; this is what notices.
    const stranded = await reconcileMissingResearch();
    if (stranded.queued > 0) {
      console.log(`[worker] queued research for ${stranded.queued} stranded account(s)`);
    }

    // Scores produced under a ruleset we no longer run. A policy change makes every
    // existing score historical, and a rep comparing two prospects would otherwise
    // be comparing two different policies.
    const rescored = await recomputeStaleScores();
    if (rescored.recomputed > 0) {
      console.log(`[worker] recomputed ${rescored.recomputed} of ${rescored.stale} `
        + 'score(s) under the current policy');
    }

    // Saved markets that are due. Bounded per pass, so a reboot with ninety stale
    // markets does not become ninety paid searches in the same second.
    const scheduled = await scheduleDueMarkets();
    if (scheduled.queued > 0) {
      console.log(`[worker] scheduled ${scheduled.queued} of ${scheduled.due} due market(s)`);
    }

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
