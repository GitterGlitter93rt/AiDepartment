/**
 * Background research worker.
 *
 * Runs in its own process against the same database as the API. Heavy crawling and
 * enrichment belong here and must never share a runtime with the realtime voice
 * path (CLAUDE-CURRENT-TASK.md §8).
 */
import { config, numeric } from '../config.js';
import { closePool } from '../db/pool.js';
import { runWorker, stopWorker } from '../workers/runner.js';
import '../workers/contactResearch.js';   // registers contact_research / account_research
import '../workers/marketMiner.js';       // registers market_mine / zip_research
import '../workers/websiteRecovery.js';  // registers website_recovery
import '../workers/domainResolution.js'; // registers domain_resolution
import '../workers/alternativeSourceResearch.js'; // registers alternative_source_research

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
const { SWEEP_INTERVAL_MS } = await import('../workers/marketScheduler.js');
const { expireStaleEvidence, refreshAccountFreshness } = await import('../workers/marketMiner.js');
const { reconcilePendingBookings } = await import('../booking/webhooks.js');
const { sweepWebsiteRecovery } = await import('../workers/websiteRecovery.js');
const { reconcileMissingResearch, recomputeStaleScores, scoreUnscoredResearched } =
  await import('../workers/researchReconcile.js');
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

    // Researched and never scored, which is what a scoring fault leaves behind.
    // Scoring runs after the research transaction commits on purpose, so this gap is
    // the ordinary outcome of that fault rather than an exotic one -- and until this
    // ran, the doctor promised a back-fill that nothing performed.
    const backfilled = await scoreUnscoredResearched();
    if (backfilled.scored > 0) {
      console.log(`[worker] scored ${backfilled.scored} of ${backfilled.unscored} `
        + 'researched account(s) that had no tier');
    }

    // Saved markets that are due. Bounded per pass, so a reboot with ninety stale
    // markets does not become ninety paid searches in the same second.
    const scheduled = await scheduleDueMarkets();
    if (scheduled.queued > 0) {
      console.log(`[worker] scheduled ${scheduled.queued} of ${scheduled.due} due market(s)`);
    }

    // Recovery campaigns that should be running and are not: Accounts newly sitting in
    // a recoverable state, and active campaigns whose next attempt came due while
    // nothing was serving it. The second is what a crash between scheduling the next
    // attempt and committing leaves behind, and without it a campaign stalls silently.
    const recovery = await sweepWebsiteRecovery();
    if (recovery.opened > 0 || recovery.requeued > 0) {
      console.log(`[worker] website recovery: opened ${recovery.opened} campaign(s), `
        + `re-queued ${recovery.requeued} due attempt(s)`);
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

/**
 * Paid provider work that outlived the run which bought it.
 *
 * On its own timer, not folded into the freshness sweep above, because the two answer
 * different questions on different clocks: that one asks which saved markets are due,
 * this one asks what the provider still owes us. Tying them together would have made
 * collection depend on there being a saved market at all, which is the defect this
 * exists to close.
 */
const { SWEEP_INTERVAL_MS: TASK_SWEEP_MS, sweepProviderTasks } =
  await import('../workers/providerTaskSweeper.js');
const taskSweep = setInterval(async () => {
  try {
    const swept = await sweepProviderTasks();
    if (swept.queuedFromReady > 0 || swept.queuedFromFallback > 0 || swept.abandoned > 0) {
      console.log(`[worker] provider tasks: ${swept.pending} outstanding, `
        + `${swept.queuedFromReady} ready, ${swept.queuedFromFallback} rechecked, `
        + `${swept.abandoned} past retention`);
    }
    if (swept.readyUnavailable && swept.pending > 0) {
      console.log('[worker] provider ready list unavailable; outstanding tasks left pending');
    }
  } catch (error) {
    console.error('[worker] provider task sweep failed', error);
  }
}, TASK_SWEEP_MS);
taskSweep.unref();

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
