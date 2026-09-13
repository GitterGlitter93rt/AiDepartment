# Your AI Department — Durable Job Queue / Worker Orchestration Specification

**Status:** Architecture authority  
**Purpose:** Define background work for mining, research, refresh, post-call and integrations without duplicate provider spend, lost tasks, or accidental duplicate calls.

---

# 1. PRINCIPLE

Long-running work should not execute inside a user HTTP request.

Examples:

- hundreds/thousands of SERP queries;
- website crawls;
- contact enrichment;
- LLM research synthesis;
- Sales Manual indexing;
- post-call QA;
- external CRM retries.

Use durable jobs with explicit state, retry and idempotency.

---

# 2. JOB TYPES

## Mining

- plan_mining_job
- run_search_task
- collect_provider_task
- resolve_discovery_candidate

## Research

- resolve_account_identity
- research_website
- research_google_advertiser
- research_meta_ads
- enrich_contacts
- refresh_evidence
- synthesize_prospect_profile
- calculate_score
- generate_call_pack

## Campaign

- replenish_inventory
- refresh_ready_prospect
- expire_lease

## Knowledge

- index_sales_manual
- rebuild_changed_chunks

## Outreach/post-call

- finalize_call
- extract_prospect_statements
- qa_review
- sync_crm
- send_outbox_action

No production call initiation job can skip real-time preflight gates.

---

# 3. JOB RECORD

Fields:

- job ID
- job type
- resource IDs
- priority
- payload/reference
- idempotency key
- state
- scheduled at
- available at
- started at
- completed at
- worker ID
- lease expiry
- attempt count
- max attempts
- last error code
- last error summary
- parent job ID
- correlation/request ID.

---

# 4. STATES

- queued
- leased
- running
- waiting_external
- retry_scheduled
- succeeded
- failed_terminal
- canceled
- superseded
- dead_letter

Do not represent everything as `pending/complete`.

---

# 5. IDEMPOTENCY

Every job type defines a natural idempotency key.

Examples:

Paid search task:

`provider + query + location + device + language + requested_time_bucket + campaign/research_context`

Website research:

`account + canonical_domain + research_profile_version + freshness_window`

Score:

`account + scoring_version + evidence_snapshot_hash`

Call Pack:

`account + score_snapshot + profile_version + knowledge_snapshot + campaign_version`

Do not duplicate external spend on worker retry when completed provider result already exists.

---

# 6. LEASES

Worker claims job for bounded lease.

If worker dies:

- lease expires;
- job can be retried;
- idempotency prevents duplicate side effects.

Worker should heartbeat long-running jobs or use appropriate queue semantics.

---

# 7. PRIORITIES

Example priority classes:

1. critical safety/state actions
2. requested callback/current call support
3. ready-prospect refresh before scheduled human work
4. post-call finalization
5. active campaign inventory replenishment
6. normal research
7. low-priority historical refresh/index maintenance.

DNC itself should generally be synchronous transactional action, not delayed as a normal queue job.

---

# 8. PROVIDER ASYNC TASKS

For queue-based external providers:

1. create internal search job;
2. submit provider task;
3. store provider task ID + cost/request metadata;
4. set `waiting_external`;
5. poll/collect or receive callback;
6. store result observation;
7. mark succeeded;
8. fan out candidate resolution jobs.

Do not resubmit merely because result is not ready yet.

---

# 9. FAN-OUT / FAN-IN

Research run may fan out:

- homepage/contact/service/locations
- contact enrichment
- transparency/Meta check.

Then fan-in to:

- evidence normalization
- score/profile
- strategy.

ResearchRun knows which adapters are required vs optional.

Optional adapter failure should not block fan-in indefinitely.

---

# 10. DEPENDENCY GRAPH

Do not implement implicit sleep-based ordering.

Jobs can declare dependencies or orchestration checks:

`discover -> resolve identity -> website/ad research -> evidence -> score -> Call Pack`

A Call Pack job should fail/requeue if required score/evidence snapshot not ready.

---

# 11. RETRIES

Classify errors:

## retryable

- provider 429
- provider 5xx
- timeout
- temporary network
- model overload.

## non-retryable

- invalid credential/config
- malformed request
- unsupported geography
- domain definitively invalid
- schema validation repeatedly invalid.

Use exponential backoff/jitter and provider Retry-After where available.

---

# 12. DEAD LETTER

After max attempts:

- mark dead_letter/terminal
- alert according severity
- preserve error history
- allow authorized retry after cause fixed.

Do not silently drop research jobs.

---

# 13. BUDGET PRECHECK

Before paid external job submission:

- campaign/global provider budget available
- provider task cap available
- resource still relevant/not duplicate
- campaign not paused.

Budget check should happen again at actual submission time, not only when job originally queued.

---

# 14. CAMPAIGN PAUSE

If campaign paused:

- stop scheduling new mining tasks
- queued not-yet-paid provider tasks can be canceled/superseded
- already-paid external tasks may be collected so spend/result is not lost
- research can finish according config without entering outreach queue.

---

# 15. KILL SWITCH AND CALL JOBS

Any future autonomous call job must recheck global kill switch immediately before Twilio call request.

Queued authorization from 10 minutes ago is insufficient.

If kill switch on:

- job canceled/not eligible
- no provider call.

---

# 16. STALE JOBS

A research job can become obsolete because:

- account merged
- campaign ended
- newer research run supersedes
- domain corrected
- prospect suppressed
- Call Pack already refreshed.

Before expensive execution, verify job still current.

Mark superseded rather than run needlessly.

---

# 17. CONCURRENCY

Global + provider + domain limits.

Examples:

- max SERP submissions/sec
- max website crawls concurrently
- max per-domain crawler concurrency
- max LLM calls
- max contact-provider requests
- max post-call jobs.

Do not let one national campaign starve all other work.

Use campaign fair-share/priority.

---

# 18. DOMAIN CRAWL POLITENESS

Crawler queue enforces:

- per-domain rate
- robots/policy
- retry delay
- max pages.

Parallel workers cannot independently hammer same prospect website.

---

# 19. JOB COST ATTRIBUTION

Every paid/LLM/provider job attributes usage to:

- Account
- ResearchRun
- MiningJob/Campaign
- provider
- operation.

Retries should distinguish billed vs non-billed requests where provider reports.

---

# 20. OBSERVABILITY

Metrics:

- queue depth by type
- oldest job age
- processing rate
- success/failure/retry
- dead letters
- worker utilization
- provider waiting time
- cost queued/submitted/completed.

Admin should surface meaningful delays:

> 412 Google SERP tasks waiting for provider completion

not generic “queue busy.”

---

# 21. WORKER SHUTDOWN

Graceful deploy/restart:

- stop taking new jobs
- finish or release current leases
- persist provider task IDs/results
- no lost in-memory-only progress.

---

# 22. LOCAL DEVELOPMENT

Claude should be able to run workers locally with:

- small concurrency
- fake provider adapters
- deterministic fixture data
- no real provider spend for most unit tests.

Integration provider tests explicitly enabled.

---

# 23. FAKE PROVIDERS

Build fakes for:

- paid SERP
- website fetch
- contact provider
- booking
- CRM
- Twilio.

Fixtures can test orchestration without external cost/actions.

---

# 24. RESEARCH RUN COMPLETION

A ResearchRun can be:

- complete
- partial
- failed.

Complete/partial rules defined by campaign/research profile.

Do not wait forever for optional Meta adapter if Google+website are sufficient.

---

# 25. FIRST MARKET LOAD TEST

Before 100-prospect acceptance:

Run controlled synthetic/low-cost batch proving:

- hundreds of search/research jobs complete
- duplicate retries do not duplicate accounts/spend materially
- worker restart recovers
- campaign pause works
- budget cap works
- dead-letter visibility works.

---

# 26. ACCEPTANCE

- no job lost on worker restart
- retryable errors retry with backoff
- permanent errors stop
- provider async task not accidentally resubmitted
- paid jobs respect budget at execution time
- stale/superseded jobs skipped
- DNC remains synchronous/durable
- autonomous call jobs recheck all gates immediately before Twilio.
