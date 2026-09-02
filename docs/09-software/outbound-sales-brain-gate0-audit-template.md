# Your AI Department — Claude Gate 0 Audit Report Template

**Purpose:** Claude completes this before making substantial implementation changes.

---

# 1. AUDIT HEADER

- Date/time:
- EdgeXpert host/environment:
- Repository:
- Branch:
- HEAD SHA:
- Node/package runtime:
- Relevant system services:
- Production/test modes currently configured:

---

# 2. REPOSITORY STATE

Document:

- working tree clean/dirty;
- existing branches relevant to project;
- `phone-agent/` files/modules;
- current package/build configuration;
- any known compile/test failures;
- automatic GitHub Actions state (must remain manual-only unless explicitly changed).

---

# 3. EXISTING PROTOTYPE INVENTORY

For each important `phone-agent/` module:

| Module/File | Current purpose | Keep | Refactor | Replace/Delete | Reason |
|---|---|---|---|---|---|

Do not preserve code merely because it exists.

---

# 4. CURRENT TWILIO / RECEPTIONIST RUNTIME

Document actual implementation:

- Twilio product/features used;
- phone number configuration;
- webhook URLs;
- WebSocket/ConversationRelay/Media Stream path;
- AMD config;
- status callbacks;
- STT;
- TTS/voice;
- LLM/model;
- prompt location;
- tool/action path;
- persistence;
- process manager/container;
- Nginx/reverse proxy;
- TLS.

Do not include secrets in report.

---

# 5. `voice.youraidepartment.ai` DEPLOYMENT

Document:

- DNS/public endpoint status;
- Nginx site config path;
- upstream port/service;
- WebSocket proxy support;
- health endpoint;
- TLS/certificate state;
- firewall ports;
- service restart/deploy process;
- logs;
- current source directory/version.

Do not change production configuration during Gate 0 except a safe read-only diagnostic explicitly required.

---

# 6. LATENCY PATH AUDIT

For the receptionist/voice code identify every potentially blocking step:

`answer -> AMD -> webhook -> WebSocket -> STT -> endpoint -> RAG/tool -> LLM -> TTS -> first audio`

For each:

- implementation/provider;
- synchronous/asynchronous;
- known timeout;
- measured/logged timing available?;
- suspected contribution.

If actual measurement is possible without real prospect calls, record it using allowlisted/internal test setup only.

Explain likely cause of previously observed 3–5 second pauses if evidence supports a diagnosis.

If unknown, say unknown and define measurement needed.

---

# 7. CURRENT PERSISTENCE

Document:

- database engine if any;
- schema/migrations;
- in-memory state;
- suppression storage;
- call history;
- research data;
- credentials/config.

Explicitly flag any production-critical state that disappears on restart.

---

# 8. EXISTING CRM / CALENDAR / EMAIL / SMS INTEGRATIONS

For each:

- provider
- implementation status
- reusable adapter/code
- credentials configured (yes/no only)
- test/sandbox capability
- gaps.

Do not create integrations during audit.

---

# 9. LOCAL DEVELOPMENT WORKFLOW

Propose exact commands for:

- install
- typecheck
- build
- unit tests
- start DB
- migrate
- seed
- start API
- start worker
- run fake Market Miner
- run provider integration test explicitly
- run roleplay tests.

Normal test command must not make paid/external side effects.

---

# 10. DATABASE RECOMMENDATION

Based on actual environment/repo, recommend:

- PostgreSQL deployment choice
- TypeScript DB/query library
- migration framework
- optional pgvector/PostGIS need now/later.

Explain tradeoffs briefly.

Do not choose based on trendiness.

---

# 11. QUEUE RECOMMENDATION

Based on environment, recommend:

- DB-backed job queue vs Redis-backed queue vs existing infrastructure;
- why;
- worker model;
- retry/lease/idempotency approach.

Keep V1 operationally simple while satisfying durability.

---

# 12. PROPOSED MODULE STRUCTURE

Show directory tree for implementation.

Should cleanly separate:

- domain
- DB
- providers
- Market Miner
- research/evidence
- vertical/scoring
- campaign/Human Assist
- compliance
- voice/tools
- analytics/tests.

---

# 13. PROVIDER CONFIGURATION READINESS

For each candidate:

- DataForSEO credentials available? yes/no
- SerpApi? yes/no
- Apollo? yes/no
- Anthropic? yes/no
- Twilio? yes/no
- booking provider? yes/no

Do not expose key values.

Missing credentials are not reason to fake integration; use fake adapter until provided.

---

# 14. SECURITY GAP AUDIT

Check existing prototype/runtime for:

- unauthenticated `/api/dial` or control endpoints;
- missing Twilio signature validation;
- WebSocket authentication gaps;
- secrets in code/files;
- logging phone/transcript unnecessarily;
- DNC in memory only;
- permissive CORS/public routes;
- arbitrary transfer/action inputs.

Rate severity.

---

# 15. ARCHITECTURE CONFLICTS

List any current implementation/environment constraint that materially conflicts with V1 specs.

For each:

- architecture requirement;
- current reality;
- options;
- recommendation;
- whether Michael/product decision is needed.

Do not ask about choices Claude can make technically under the architecture.

---

# 16. REUSABLE CODE SUMMARY

List what should likely survive:

- Twilio transport helper
- webhook validation
- schema/types
- website parser
- etc.

Only if actual inspection supports it.

---

# 17. CODE TO REPLACE / QUARANTINE

List:

- prototype modules that conflict with architecture;
- insecure/incorrect behavior;
- hard-coded assumptions;
- dead code.

Do not delete during Gate 0; recommend Gate/epic where replacement occurs.

---

# 18. IMPLEMENTATION PLAN — GATES 1–7 ONLY

Provide estimated technical sequence/dependencies, not calendar promises.

For each gate:

- modules
- migrations
- tests
- provider needs
- expected deliverable.

Do not plan voice implementation in detail before Market Miner acceptance.

---

# 19. BLOCKERS

Categories:

- missing credential
- missing environment access
- provider terms/pricing review
- current deployment ambiguity
- architecture/product decision
- legal/policy deferred.

Separate true blocker from item that can proceed with fake provider.

---

# 20. GATE 0 PASS STATEMENT

Claude ends report with either:

`GATE 0 PASS — Ready to begin Gate 1.`

or:

`GATE 0 BLOCKED — The following specific issues require resolution before Gate 1: ...`

Do not begin Gate 1 in same operation if a product-level blocker needs Michael's decision.
