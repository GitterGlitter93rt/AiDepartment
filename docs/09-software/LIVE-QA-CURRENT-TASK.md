# LIVE QA CURRENT TASK — Sales Portal / Prospect Factory

**Authority:** GitHub Issue #2 — `[P0 LIVE QA] Sales Portal bug hunt, mining truthfulness, and EdgeXpert operator hardening`

**User direction:** Michael is actively using the Sales Portal locally on the EdgeXpert. Treat every observed mismatch between operator expectation and runtime truth as a defect or explicit product limitation that must be made visible. The next engineering priority is to find and fix reproducible bugs, not just add features.

## Start here

1. `git fetch origin`
2. Reconcile safely with `origin/feature/outbound-sales-brain` using fast-forward/rebase-safe workflow; do not force-push.
3. Read Issue #2 in full.
4. Preserve `docs/09-software/YAD-VOICE-INBOUND-OUTBOUND-ROUTING-AUTHORITY.md` as authority for future voice work.
5. If you have uncommitted inbound/callback work, finish a coherent safe checkpoint first, test it, commit it, then switch to Issue #2.
6. After that, Issue #2 is P0 until the live-test defects and QA matrices have been exercised.

## Live facts already observed

The local portal is currently running from pinned SHA `527c2c0a2b21dcea90ffa2eea5dad6851bbf2b6c` against an isolated PostgreSQL test database with synthetic/demo records.

Observed from the actual browser/operator session:

- Search for ZIP `32095` displayed `Researching 32095 now`.
- Worker initially was not running; job stayed queued while Research Health could still look mostly green.
- After manually starting `npm run worker`, market/research jobs processed.
- Mining page then showed `Succeeded` market searches for `32095` with `0 found - 0 refreshed`.
- The current `marketMiner.ts` has no registered discovery adapter by default, so no brand-new external businesses can actually be found in that state.
- Mining page showed `Accounts added today: 59`; those 59 were synthetic/demo seeded Accounts, not Market Miner discoveries.
- Mining page showed `Accounts refreshed: 58`; provenance must be audited because seeded `last_researched_at` state may inflate this metric.
- Local npm audit reports a high-severity `@fastify/static` advisory. Do not use `npm audit fix --force`; resolve intentionally with compatibility/security regression tests before Cloudflare exposure.
- The portal has excessive whitespace / tiny information density on a wide monitor; UX changes should improve operator comprehension, not just appearance.

## Required engineering behavior

- Do not treat `0 found` as a successful external discovery when no discovery provider ran.
- Distinguish `DISCOVER_NEW` from `REFRESH_EXISTING` in job state, operator UI, empty states, and analytics.
- Make worker liveness explicit through heartbeat/instance state.
- Make KPI provenance explicit; seed/import/manual creation must not count as miner discovery.
- Build permanent supervised startup for API + worker; do not spawn a worker per click.
- Finish/test the actual external discovery adapter path behind safe provider configuration.
- Resolve the static-file security advisory before Cloudflare publication.
- Run the full role/route/state/restart/concurrency/security/performance matrices in Issue #2.
- Every reproducible bug gets a regression test before or with the fix.
- After each coherent checkpoint, push and comment on Issue #2 with exact SHA, bugs found, root causes, tests, and remaining blockers.

## Safety boundary

Do not:

- deploy;
- access the voice VPS;
- change production Twilio;
- place real prospect calls;
- send real email/SMS;
- arm autonomous dialing;
- merge `main`;
- dispatch GitHub Actions;
- weaken DNC/suppression;
- use real prospect data in destructive tests.

The portal/Prospect Factory may be exercised with deterministic synthetic fixtures and provider mocks. Real provider credentials remain external.

## Definition of progress

The objective is not a cosmetic "green test suite." The objective is that a real operator can trust what every page says.

A page or metric is wrong if it reports technical success while the business operation the user asked for never happened.

Examples:

- `Succeeded` while discovery was blocked -> wrong/misleading.
- `Accounts added today` counting demo seed as miner output -> wrong/misleading.
- `Worker healthy` inferred only from `0 stranded` while no worker exists -> wrong/misleading.
- `0 found` when the provider was never queried -> not equivalent to a genuine zero-result search.

Fix the semantics, not just the labels.
