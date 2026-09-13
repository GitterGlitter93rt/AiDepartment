# Your AI Department — Outbound Sales Brain Security & Operations Specification

**Status:** Architecture authority  
**Purpose:** Define production-security, durability, observability, data-retention, and failure-handling requirements for Market Miner, human-assist, and future realtime calling.

---

# 1. SECURITY PRINCIPLE

The system will eventually contain:

- prospect/business contact data;
- call outcomes;
- potentially transcripts/audio;
- suppression/DNC records;
- provider credentials;
- Twilio credentials;
- CRM/calendar/email credentials;
- internal Sales Manual knowledge;
- campaign controls capable of initiating outreach.

Therefore:

- public unauthenticated control APIs are not acceptable;
- suppression cannot live only in process memory;
- secrets cannot live in GitHub;
- production dial enablement needs multiple independent gates.

---

# 2. SERVICE BOUNDARIES

Recommended logical services:

1. Control/API service
2. Research worker(s)
3. Website crawl worker(s)
4. Knowledge indexer/search service
5. Strategy/Call Pack worker
6. Compliance service/module
7. Realtime voice gateway
8. Action/tool service
9. Post-call/QA worker
10. Admin web UI
11. PostgreSQL
12. Queue/session store if required

They may begin in one deployable monolith for V1 if clean module boundaries exist, but security/data contracts should assume separation is possible.

---

# 3. AUTHENTICATION

Internal/admin endpoints require authenticated user/service identity.

## Human users

Use secure identity/session provider with:

- strong passwords or SSO;
- MFA where supported, especially admins;
- secure cookies/tokens;
- session expiration;
- CSRF protection where applicable.

## Service-to-service

Use:

- private network/service auth;
- signed tokens/mTLS/API credentials according to deployment environment;
- rotated credentials;
- least privilege.

Do not pass master provider credentials between services unnecessarily.

---

# 4. AUTHORIZATION

Role-based permissions from admin spec.

Sensitive actions:

- enable production mode;
- change compliance policy;
- change provider budget;
- remove suppression;
- global kill switch release;
- export prospect data;
- access retained audio/transcript;
- manage credentials.

Require elevated role and audit.

---

# 5. PRODUCTION DIAL ENABLEMENT

Require all:

1. environment/build permits production outbound;
2. database global dial flag enabled;
3. campaign status production-active;
4. campaign operating mode autonomous-outbound;
5. compliance decision allow-autonomous and current;
6. no suppression;
7. Call Pack current;
8. contact attempt lock acquired;
9. global kill switch clear;
10. provider health acceptable.

No single environment variable should be enough to unleash production dialing.

---

# 6. GLOBAL KILL SWITCH

Requirements:

- durable state;
- checked immediately before call initiation;
- admin-visible;
- fast propagation;
- audit log;
- reason required;
- active calls handled according to safe termination policy.

Kill switch should block new autonomous calls even if a worker has queued jobs.

---

# 7. SECRETS

Secrets include:

- Twilio SID/token/API keys;
- model provider keys;
- DataForSEO/SerpApi credentials;
- Apollo credentials;
- database credentials;
- email/SMS credentials;
- CRM/calendar credentials.

Rules:

- no secrets committed to repo;
- `.env.example` contains names only;
- production secret manager/environment injection;
- rotation procedure;
- scope keys to least privilege where provider supports it;
- redact from logs/errors.

---

# 8. PROVIDER WEBHOOK VALIDATION

Validate signatures for:

- Twilio voice HTTP callbacks;
- Twilio websocket/upgrade handshake according to current supported method;
- other providers that support signed webhooks.

Reject unauthenticated/invalid callback before changing call/CRM state.

Do not rely on source IP alone unless provider officially requires/supports it.

---

# 9. INTERNAL API IDEMPOTENCY

Actions that can duplicate harm need idempotency keys:

- dial attempt;
- booking;
- SMS;
- email;
- CRM activity;
- suppression write;
- merge operation.

Example key:

`campaign_id + account_id + attempt_sequence + action_type`

Retry should return prior result where safe rather than execute twice.

---

# 10. DATABASE DURABILITY

PostgreSQL or equivalent durable relational database should be canonical for:

- Accounts/contacts;
- evidence;
- scores;
- Call Packs;
- campaigns;
- suppressions;
- attempts/calls;
- outcomes;
- tasks;
- audit records.

In-memory stores may cache session state but cannot be source of truth for DNC/call history.

---

# 11. QUEUE DURABILITY

Research/call/post-call jobs need:

- durable queue or recoverable database job table;
- status;
- attempt count;
- lock/lease;
- retry schedule;
- dead-letter state;
- idempotency.

Worker crash should not duplicate calls or lose DNC.

---

# 12. DISTRIBUTED LOCK / LEASE

Before contact attempt:

Acquire account/contact/phone attempt lease.

Purpose:

- prevent two workers calling same number;
- prevent human and AI simultaneous outreach;
- handle multiple campaigns finding same account.

Lease expires safely if worker crashes, but completed attempt remains durable.

---

# 13. LOGGING REDACTION

Default logs should avoid:

- auth tokens;
- full provider request headers;
- full transcript text;
- full personal emails/phones when unnecessary;
- payment data;
- secret URLs.

Use internal IDs and partially redacted numbers for operational logs.

Sensitive detail belongs in access-controlled database/UI, not console logs.

---

# 14. TRANSCRIPT / AUDIO RETENTION

Define policy classes:

- no_media_retention;
- transcript_only;
- audio_and_transcript;
- temporary_QA_retention;
- legally_required_restricted_retention if applicable.

Per campaign/jurisdiction store:

- retention class;
- expiry/delete date;
- access roles;
- legal/policy basis.

Deletion job should actually remove/expire provider-side copies where controllable and required.

---

# 15. DATA MINIMIZATION

Store what sales/operations needs.

Avoid collecting unnecessary personal/sensitive data.

Market Miner focuses on business identity, publicly relevant business roles, workflows, and contactability.

Do not enrich prospects with unrelated sensitive personal attributes.

---

# 16. BACKUPS

Critical backup targets:

- database;
- suppression records;
- campaign/config/policy records;
- audit logs;
- knowledge-source repo remains Git-backed.

Test restore, not merely backup creation.

Recovery objective should prioritize:

1. suppression integrity;
2. contact/call history;
3. campaign state;
4. research/evidence.

---

# 17. FAILURE CLASSIFICATION

## Transient

- provider timeout;
- HTTP 5xx;
- rate limit;
- temporary DNS;
- model overload.

May retry with backoff/idempotency.

## Permanent/input

- invalid phone;
- domain not found;
- provider rejects credentials;
- unsupported country;
- malformed data.

Needs correction/review, not endless retry.

## Critical safety

- suppression DB unavailable;
- compliance service unavailable for autonomous call;
- global dial-state database unavailable;
- auth bypass detected.

Fail closed.

---

# 18. RETRY POLICY

Use exponential/backoff/jitter according to provider constraints.

Set maximum attempts.

Never automatically retry:

- ambiguous booking create where success may have occurred;
- SMS/email send without idempotency/provider status;
- call initiation after provider returns ambiguous state until provider ID/status checked.

---

# 19. RATE LIMITS

Enforce locally even if provider also limits:

- SERP API tasks/sec/day;
- website crawler concurrency/domain;
- model concurrency;
- Twilio call concurrency;
- SMS/email throughput;
- CRM write throughput.

Campaign-level limits must sit below global limits.

---

# 20. PROVIDER DEGRADATION

If DataForSEO unavailable:

- pause/route discovery to configured fallback if budget permits;
- no false “not advertising.”

If Apollo unavailable:

- continue company research;
- contact remains unknown.

If model provider unavailable:

- research may wait;
- realtime gateway uses approved fallback or safely ends/does not initiate new calls.

If CRM unavailable:

- internal DB/outbox preserves outcome.

If suppression unavailable:

- autonomous new calls blocked.

---

# 21. OBSERVABILITY

Metrics:

- request rate/errors/latency by service;
- queue depth/age;
- job failure/retry/dead letter;
- provider errors/rate limits;
- database connections/errors;
- research throughput;
- call initiation/answer/disconnect;
- STT/LLM/TTS latency;
- DNC write latency;
- booking/CRM action reliability.

Logs + metrics + traces should correlate via:

- request ID;
- research run ID;
- account ID;
- call ID.

---

# 22. INITIAL SLO TARGETS

Architecture targets, tune after baseline.

## Control API

- p95 normal read/write <500 ms excluding external long tasks.

## Suppression check/write

- high availability;
- p95 local DB operation <200 ms target;
- failures block autonomous call.

## Research queue

- normal queued research starts within configured minutes depending campaign priority;
- not realtime-critical.

## Realtime voice

Use dedicated voice policy latency SLOs.

## Post-call outcome

- structured outcome available within ~60 seconds target after call end under normal conditions.

---

# 23. ALERTS

Critical alerts:

- autonomous dial unexpectedly enabled/disabled;
- kill switch activated;
- suppression service failure;
- compliance engine errors;
- call volume exceeds campaign cap;
- provider spend exceeds threshold;
- hard-fail QA spike;
- unsupported-claim spike;
- realtime p95 latency degradation;
- database/queue outage.

Avoid emailing Michael for every development compile/test failure. Development CI should remain manual unless explicitly changed.

Operational production alerts should route through a deliberate alert channel with severity and deduplication.

---

# 24. ENVIRONMENTS

Separate:

- local development;
- automated test;
- staging/controlled voice test;
- production.

Staging/test:

- provider sandbox/test credentials where possible;
- allowlisted phone numbers;
- production customer/contact data minimized;
- autonomous production mode impossible.

---

# 25. DEPLOYMENT

`voice.youraidepartment.ai` may host realtime voice/control components according to final deployment plan.

Requirements:

- TLS;
- websocket proxy support;
- health checks;
- restart policy;
- secret injection;
- log rotation;
- firewall/minimal exposed ports;
- process/container isolation;
- versioned deployment artifacts;
- rollback.

Claude must inspect current server/deployment before changing it.

---

# 26. RELEASE GATES

A version cannot move to controlled voice test unless:

- data/schema migrations tested;
- scoring/RAG fixtures pass;
- roleplay text suite passes critical tests;
- no secrets in diff;
- authenticated control API;
- DNC durability test passes.

Cannot move to real prospect pilot unless additionally:

- compliance policy approved;
- controlled audio suite passes;
- kill switch tested;
- monitoring active;
- call QA review process ready.

---

# 27. DEVELOPMENT WORKFLOW

Current project rule:

- do not enable automatic GitHub Actions on every push without explicit approval;
- Claude runs local tests on EdgeXpert;
- commit only after coherent local checkpoint;
- use feature branch/PR;
- no merge to main without explicit review/request.

This avoids development-notification spam and keeps testing where the implementation environment actually exists.
