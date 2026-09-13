# Your AI Department — Prospect Factory / Outbound Sales Brain Local Development & Test Specification

**Status:** Architecture authority  
**Purpose:** Give Claude a deterministic local workflow on the EdgeXpert so implementation can be developed and validated without automatic GitHub Actions, accidental provider spend, or real prospect contact.

---

# 1. PRINCIPLE

Local development must default to safe, cheap and reproducible.

A developer should be able to run most tests with:

- no Twilio call;
- no paid SERP request;
- no real email/SMS;
- no production CRM write;
- no GitHub Actions.

External integration tests are explicit opt-in commands.

---

# 2. ENVIRONMENTS

## `test`

- fake providers
- disposable database
- no network side effects
- deterministic fixtures.

## `development`

- local database
- fake providers by default
- optional explicitly enabled provider integration
- no real phone dialing.

## `staging`

- deployed/test infrastructure
- controlled API keys
- allowlisted test numbers
- test CRM/calendar destinations where possible
- no production prospect autonomous mode.

## `production`

Separate configuration/secrets and multi-gate controls.

---

# 3. ENVIRONMENT FLAGS

Use explicit flags such as:

- `APP_ENV`
- `OUTBOUND_MODE_MAX`
- `PAID_PROVIDER_CALLS_ENABLED`
- `TWILIO_TEST_CALLS_ENABLED`
- `TEST_PHONE_ALLOWLIST`
- `EMAIL_SEND_ENABLED`
- `SMS_SEND_ENABLED`
- `EXTERNAL_CRM_WRITES_ENABLED`

Names may differ, semantics should not.

Dangerous flags default false outside controlled environment.

---

# 4. MAXIMUM MODE CAP

Environment defines highest possible mode.

Example:

Local:

`OUTBOUND_MODE_MAX=human_assist`

Staging:

`OUTBOUND_MODE_MAX=controlled_test`

Production:

may permit production only after deployment/configuration review.

Database campaign setting cannot exceed environment cap.

This is one of multiple production dial gates.

---

# 5. DATABASE

Local dev should support:

- PostgreSQL container/service
- migration reset for test
- seed fixtures
- isolated test DB
- persistent dev DB when desired.

Tests must never point at production database.

Require safety check on database hostname/name for destructive reset commands.

---

# 6. FAKE PROVIDERS

Required fakes:

- SERP provider
- Places/business discovery
- website fetch/browser
- contact enrichment
- LLM structured research
- manual RAG
- booking
- email
- SMS
- CRM
- Twilio/voice events.

Fakes use stored fixture payloads derived from synthetic/non-sensitive examples or permitted sanitized integration captures.

---

# 7. GOLD FIXTURE DIRECTORIES

Suggested:

`phone-agent/test/fixtures/` or final chosen package path.

Subgroups:

- scoring
- evidence
- verticals
- SERP
- entity-resolution
- websites
- Call Packs
- roleplays
- compliance
- Twilio events
- tools.

Architecture YAML specs can be copied/consumed directly where sensible rather than duplicated.

---

# 8. TEST PYRAMID

## Unit

Fast, no network:

- score
- claim registry
- entity normalizers
- evidence state
- queue ranking
- calculator
- state machine.

## Component

- DB repositories
- workers
- crawler parser on local HTML fixtures
- RAG index/retrieval
- prompt compiler.

## Integration — opt-in

- DataForSEO/SerpApi
- Apollo
- current LLM API
- Twilio test
- calendar/CRM.

## End-to-end staging

Allowlisted test participants only.

---

# 9. NETWORK TEST GUARD

Tests that make external billable requests must require explicit opt-in.

Example:

`RUN_PROVIDER_INTEGRATION_TESTS=true`

and provider-specific credentials.

Normal `npm test` must not spend money.

---

# 10. TWILIO TEST GUARD

Controlled test call requires:

- staging environment
- `TWILIO_TEST_CALLS_ENABLED=true`
- destination in durable/configured allowlist
- explicit command/test case.

Unit/integration tests mock Twilio by default.

---

# 11. EMAIL/SMS TEST GUARD

Use:

- fake provider
- sandbox/test recipient allowlist
- local message sink.

Do not send to imported prospect emails/phones during tests.

---

# 12. LLM TEST STRATEGY

Most schema/behavior tests use deterministic mocked model output.

Separate live-model evaluation suite tests:

- Call Pack generation
- roleplay
- QA
- ambiguous research synthesis.

Pin/log model/version and test date.

Do not make core unit suite nondeterministic due live LLM.

---

# 13. CRAWLER TESTS

Use local fixture websites/HTML with known patterns:

- 24/7
- ServiceTitan widget
- Meta Pixel
- Google Ads tag
- CallRail
- multiple locations
- service areas only
- financing
- JavaScript-rendered CTA.

Assert no form POST is sent.

---

# 14. DATABASE TESTS

Required:

- migration from empty
- unique SourceIdentity
- immutable evidence history
- score snapshot
- DNC transaction
- outbox
- lease expiry
- merge/unmerge
- provider usage rollup.

Test process restart against persisted data.

---

# 15. JOB TESTS

Simulate:

- worker dies after provider task submitted
- retry
- provider task pending
- duplicate job
- campaign pause
- budget exhausted
- job superseded.

Assert no duplicate external action.

---

# 16. PROMPT SNAPSHOT TESTS

Compiler test outputs a normalized prompt/context representation.

Assert:

- current commercial truth included
- prohibited claims
- stale fact suppressed
- tool availability correct
- no entire manual dumped into context.

Do not rely on exact whitespace as primary correctness test.

---

# 17. RAG TESTS

Build local index from current Sales Manual.

Gold query suite runs locally.

Fail if:

- relevant chunk absent top 3 beyond allowed threshold
- stale commercial truth presented as authority
- evidence statistic separated from limitation.

---

# 18. ROLEPLAY TESTS

Text roleplay can run:

- deterministic scripted prospect
- model-based prospect simulator separately.

Critical invariants from YAML are machine assertions regardless of simulator style.

Example:

If prospect turn contains explicit DNC, state/tool outcome is deterministic.

---

# 19. LOCAL OBSERVABILITY

Dev should show:

- structured logs
- job state
- provider fake calls
- DB query/error
- prompt/model trace with sensitive values redacted.

Do not require production monitoring account to debug local tests.

---

# 20. TEST DATA

Use synthetic company/contact data by default.

Real public business websites may be used in explicitly marked research integration tests, but no contact or fake lead submission.

Avoid storing unnecessary real personal contact data in fixture repo.

---

# 21. REPRODUCIBLE COMMANDS

Claude must document actual commands after choosing project stack.

Expected categories:

- install
- start DB
- migrate
- seed
- unit test
- component test
- typecheck
- build
- start API
- start worker
- run Market Miner fixture
- run provider integration benchmark
- run text roleplay
- run controlled voice test.

One README should contain the exact final commands.

---

# 22. NO AUTOMATIC GITHUB ACTIONS

Current project requirement:

- `.github/workflows/phone-agent-ci.yml` remains manual-only.

Claude runs checks locally before commits.

A future CI change requires Michael's explicit approval.

Do not create another automatic workflow under a different name to bypass this requirement.

---

# 23. PRE-COMMIT CHECKPOINT

Before coherent implementation commit:

- relevant tests pass
- typecheck/build pass
- migration state clean
- no secrets
- no accidental external-send flag
- no production dial enablement.

Do not create a commit per tiny edit merely to test in GitHub.

---

# 24. INTEGRATION TEST COST REPORT

Provider integration tests should print/store:

- requests
- estimated cost
- actual provider task IDs
- target market/test purpose.

Use tiny bounded samples.

---

# 25. FAILURE REPRODUCTION

Every production/controlled incident should get a local regression fixture if practical.

Examples:

- duplicate advertiser parsing bug
- DNC race
- stale ad opener
- booking false success
- 4-second RAG stall.

---

# 26. GATE REPORT

At each implementation gate, Claude reports:

- exact local commands run
- test counts/pass/fail
- provider integration calls/cost if any
- screenshots/output where useful
- unresolved warning.

“Looks good” is not enough.

---

# 27. ACCEPTANCE

Before Gate 1 implementation advances:

- local DB/test workflow works
- normal test suite makes no external calls
- provider tests explicitly opt-in
- Twilio test cannot dial arbitrary number
- automatic GitHub Actions remain off
- Claude can run typecheck/build/tests entirely on EdgeXpert.
