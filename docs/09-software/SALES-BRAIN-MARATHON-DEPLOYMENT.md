# Sales Brain — deploying the offline marathon work

**Status:** code complete and green on `feature/outbound-sales-brain`; **not deployed**.
The runtime is deliberately still serving `5375d39`.

This document exists because the marathon left the repository in a state that is safe
only as long as nobody deploys it casually. Two migrations are on disk and unapplied
in production, and one of them is load-bearing for code that is already merged.

---

## The trap, stated first

`feature/outbound-sales-brain` contains a build that can write the job outcome
`MARKET_DISABLED`. The check constraint that permits it is **migration 050**, which is
**not applied to `yad_sales`**.

If this build is deployed without applying 050, the first time an operator pauses a
saved market the run will do its work, fail to record its outcome, and be retried.

That failure is now honest rather than destructive — see `completeJob` in
`src/workers/runner.js`, which degrades to `COMPLETED` with an explanation naming the
unapplied migration instead of marking successful work as failed and repeating it —
but it is still a wrong outcome on the operations page, and it is avoidable.

**Apply the migrations before starting the new build.**

---

## Deployment order

Migrations first, then the build. Never a restart that migrates as a side effect: see
`SALES-BRAIN-RUNTIME.md` — schema deployment is explicit.

```
# 1. Confirm what production is missing.
node dist/bin/doctor.js          # or npm run doctor
#    expect: 48 applied, pending [049_lead_response_probe.sql,
#            050_market_disabled_outcome.sql]

# 2. Back up. The backup timer covers this, but take a fresh one anyway.

# 3. Apply, explicitly.
node dist/bin/migrate.js

# 4. Rebuild and restart, in that order.
npm run build
systemctl --user restart yad-sales-api yad-sales-worker
```

### What each migration does

| Migration | Effect | Risk |
| --- | --- | --- |
| `049_lead_response_probe.sql` | Creates the five Speed-to-Lead probe tables and adds `PROBE_AUDIT` to the suppressions constraint. | Additive. No existing table is altered destructively. The probe subsystem stays inert: `PROBE_SUBMISSION_ENABLED` is unset and no Twilio number exists. |
| `050_market_disabled_outcome.sql` | Extends `jobs_outcome_check` with `MARKET_DISABLED`. | Additive to a permitted-values list. Verified against production data: every existing `jobs.outcome` row satisfies the new constraint, so it cannot fail on apply. |

---

## Behaviour that changes on deployment

Read this before deploying, because three of these are visible to an operator on the
first day and one of them costs money if it is misread as a fault.

**Pausing a saved market now stops the buying and not the collecting.** A market
switched off after its refresh was queued will no longer submit new provider searches,
and will still collect any search already paid for. It reports `MARKET_DISABLED`, does
not accrue failure backoff, and is not counted against scheduler health. This is the
intended behaviour and it is new.

**The daily spend ceiling is enforced per provider call rather than per run.** A run
that plans several searches now stops when the next one would cross the ceiling,
where before it checked once and could overshoot several times over. Expect fewer
searches per run near the ceiling. That is the ceiling working.

**Saved-market health can now say ATTENTION for a reason it never used to.** A market
overdue by more than one full refresh interval is reported as overdue. On a system
with a backlog this will light up immediately, and it is telling the truth: at the
default limits this configuration sustains roughly **288 markets a day**
(`sustainableMarketCount()`), and a hundred overdue markets take about nine hours of
wall clock to drain.

**Background jobs can no longer be starved indefinitely by higher-priority work.** A
job eligible for longer than `JOB_STARVATION_AFTER_MS` (default one hour) is served
ahead of newer higher-priority work. A rep's research still overtakes a market
refresh; it just cannot do so for ever.

**Scores under an older policy are excluded from tier filters rather than silently
compared.** `SCORE_VERSION` is now `module-4c-v3`. Existing scores in production were
written under the previous policy and will be recomputed by the worker sweep
(`recomputeStaleScores`). Until a given Account is recomputed it is reported as
awaiting recompute — distinctly from never having been scored — on both the find page
and the operations page. Nothing is lost and no research is re-run.

---

## What is still switched off, and stays off

None of these was enabled during the marathon and none is enabled by deploying it.

- `DATAFORSEO_ENABLED`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` — absent
- `DATAFORSEO_GOVERNANCE_REVIEWED` — absent; gates discovery independently of the credential
- `PROBE_SUBMISSION_ENABLED` — absent; no Twilio number has been purchased
- `DISCOVERY_DAILY_BUDGET_USD` — unset, which means **no ceiling**. Set it before
  enabling any provider: the enforcement fixed in this work has nothing to enforce
  until it exists.
- outbound dialling — off, and the operations page reports it as the most important
  line on the page

The live canary rehearsal is documented in the Block F checkpoint on Issue #3. It was
run offline, refused on every gate, and submitted nothing.

---

## Rollback

The work is additive and behind no feature flag, so rollback is a redeploy of the
previous build. The two migrations do not need reverting: `049` creates tables the old
build ignores, and `050` widens a constraint the old build never writes to.

The frozen runtime worktree at `~/YAD-Sales-Brain` is still on `5375d39` with a clean
tree, and `deploy/assert-runtime.sh --built` passes there. That is the rollback target.

**Known limitation of that guard, unchanged by this work:** it reports the git SHA of
the checkout, not what `dist` was compiled from. A rebuilt `dist` over uncommitted
source will still be reported as "at `<sha>`, built". Verify the tree is clean before
trusting it.
