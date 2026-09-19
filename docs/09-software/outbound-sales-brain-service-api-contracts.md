# Your AI Department — Prospect Factory / Outbound Sales Brain Service API Contracts

**Status:** Architecture authority  
**Purpose:** Define the internal service boundaries and authenticated APIs Claude should implement without exposing dangerous public dial/research controls or coupling the UI directly to provider SDKs.

---

# 1. PRINCIPLE

UI and realtime models talk to YAD domain APIs.

They do not talk directly to:

- DataForSEO
- SerpApi
- Apollo
- Twilio
- Calendly
- CRM vendor
- raw PostgreSQL.

Provider adapters live server-side.

---

# 2. API GROUPS

- `/api/markets`
- `/api/mining-jobs`
- `/api/accounts`
- `/api/research`
- `/api/campaigns`
- `/api/human-assist`
- `/api/follow-ups`
- `/api/suppressions`
- `/api/compliance`
- `/api/calls`
- `/api/qa`
- `/api/providers`
- `/api/system`

Exact routing/framework can change, but domain operations should remain.

---

# 3. AUTHENTICATION

All internal APIs authenticated except provider webhook endpoints/health endpoints that have separate security.

Authorization enforced server-side by role.

Do not rely on hiding buttons in UI.

---

# 4. REQUEST METADATA

Every mutating request gets:

- authenticated actor
- request/correlation ID
- idempotency key where relevant
- audit context
- optimistic/current version where concurrency matters.

---

# 5. CREATE MINING JOB

`POST /api/mining-jobs`

Input concept:

- vertical profile
- geography selector
- target inventory
- minimum tier
- advertiser-first/only
- query/research policy
- provider budget
- campaign link optional.

Output:

- mining job ID
- normalized territory summary
- estimated/planned initial search count if available
- status `draft/planned`.

Separate `start` action from creation if provider spend would begin.

---

# 6. PLAN MINING JOB

`POST /api/mining-jobs/{id}/plan`

Returns:

- resolved geography/search cells
- Pass 1 query plan
- provider routing
- budget estimate/range
- warnings.

No provider paid tasks required just to inspect plan where possible.

This supports human review before expensive large runs.

---

# 7. START / PAUSE MINING

`POST /api/mining-jobs/{id}/start`

`POST /api/mining-jobs/{id}/pause`

Validate:

- permission
- provider configuration
- budget
- job state.

Pause is durable and worker-visible.

---

# 8. MINING JOB STATUS

`GET /api/mining-jobs/{id}`

Return:

- state
- target/current ready count
- territory
- task counts
- provider spend
- unique advertisers/accounts
- Tier distribution
- saturation/coverage summary
- errors/warnings.

---

# 9. SEARCH CELL / QUERY YIELD

`GET /api/mining-jobs/{id}/coverage`

Return cell/query metrics:

- searched/unsearched/saturated
- tasks
- new advertisers
- duplicates
- Tier B+ yield
- cost
- last searched.

Used by admin UI, not realtime model.

---

# 10. ACCOUNT LIST

`GET /api/accounts`

Filters:

- campaign
- vertical
- geography
- tier/score
- ad status/format
- research completeness
- system signals
- status
- assignment
- contact history.

Pagination required.

Do not return full evidence/transcript blobs in list endpoint.

---

# 11. ACCOUNT DETAIL

`GET /api/accounts/{id}`

Return current read model:

- identity/locations
- current score
- research completeness
- current profile
- Call Pack summary
- contact/history summary
- suppression/current campaign state.

Evidence/history can be separate endpoints.

---

# 12. ACCOUNT EVIDENCE

`GET /api/accounts/{id}/evidence`

Filters:

- claim key
- state
- source
- freshness.

Return provenance, not raw forbidden provider payload.

---

# 13. RESEARCH REFRESH

`POST /api/accounts/{id}/research/refresh`

Input:

- scope: ads/website/contact/full
- reason
- urgency.

Creates durable jobs.

Do not execute long crawl synchronously.

---

# 14. SCORE EXPLAINER

`GET /api/accounts/{id}/score`

Return:

- current score snapshot
- each canonical rule
- points
- evidence IDs
- total/tier
- score version.

Also separately return queue priority/research completeness.

---

# 15. CALL PACK

`GET /api/accounts/{id}/call-pack/current`

Human Assist receives current pack.

Realtime service should retrieve through internal service/auth/session binding, not a public guessable endpoint.

---

# 16. CREATE / MANAGE CAMPAIGN

`POST /api/campaigns`

`GET /api/campaigns/{id}`

`PATCH /api/campaigns/{id}`

`POST /api/campaigns/{id}/pause`

Mode changes to production-sensitive states require elevated permission/audit.

Do not permit arbitrary patch to bypass production gates.

---

# 17. READY INVENTORY

`GET /api/campaigns/{id}/ready-prospects`

Returns ranked, paginated Human Assist/current eligibility list.

Ranking explanation included.

Do not expose suppressed/ineligible records by default except manager filter.

---

# 18. LEASE PROSPECT

`POST /api/human-assist/prospects/{accountId}/lease`

Input:

- campaign
- rep.

Output:

- lease ID
- expiry
- Call Pack ID.

Conflict if already actively leased/in-flight.

---

# 19. LOG HUMAN OUTCOME

`POST /api/human-assist/attempts/{attemptId}/outcome`

Strict schema:

- disposition
- notes
- ProspectStatements
- systems
- numbers/source classes
- next step
- research corrections.

DNC disposition triggers/validates durable suppression transaction.

---

# 20. FOLLOW-UP

`POST /api/follow-ups`

`GET /api/follow-ups?owner=&due=`

`PATCH /api/follow-ups/{id}`

Requested callback requires timezone.

---

# 21. SUPPRESSION

`GET /api/suppressions/search`

`POST /api/suppressions`

Removal/deactivation uses separate elevated operation with reason/audit if allowed.

Do not implement generic DELETE suppression endpoint.

---

# 22. COMPLIANCE EVALUATE

Internal service:

`POST /internal/compliance/evaluate`

Input:

- account/contact/phone/campaign
- technology/channel
- purpose
- proposed timestamp.

Output:

- decision
- reason codes
- next eligible time
- recording/transcription flags
- policy version.

Not callable by public unauthenticated client.

---

# 23. CONTROLLED CALL REQUEST

If/when Gate 14 reached:

`POST /internal/calls`

Input:

- account
- contact/phone
- campaign
- Call Pack ID
- requested mode.

Server independently rechecks all gates.

Client cannot pass:

`compliance=true`

as authority.

Output:

- internal call ID
- accepted/denied
- reason.

---

# 24. CALL DETAIL

`GET /api/calls/{id}`

Authorized users only.

Return according to retention/role:

- status/disposition
- Call Pack
- events
- transcript/audio references if permitted
- QA
- actions
- latency metrics.

---

# 25. PROVIDER WEBHOOKS

Examples:

- `/webhooks/twilio/voice`
- `/webhooks/twilio/status`
- `/webhooks/twilio/amd`

These are externally accessible but protected by provider signature validation, method/schema validation and idempotency.

Do not use internal user auth on provider webhook; use provider auth mechanism.

---

# 26. REALTIME WEBSOCKET

Path e.g. `/realtime/twilio/conversation-relay`

Requirements:

- WSS
- Twilio validation/current supported auth
- opaque session binding
- no arbitrary account ID trust
- one session/call mapping
- message schema/rate limits.

---

# 27. PROVIDER USAGE

`GET /api/providers/usage`

Authorized admin/manager.

Filters:

- provider
- campaign
- date
- operation.

Return:

- tasks
- spend
- errors
- cost/new account
- cost/Tier B+ where computable.

---

# 28. SYSTEM FLAGS

`GET /api/system/outbound-state`

Admin-visible:

- global autonomous dial state
- controlled-test state
- kill switch
- suppression service health
- compliance policy version.

Sensitive mutation endpoints require elevated auth and explicit reason.

---

# 29. KILL SWITCH

`POST /api/system/outbound-kill`

Input:

- reason.

Effect:

- durable immediate block on new autonomous calls.

Re-enable is separate privileged endpoint/action, never toggle via generic patch.

---

# 30. IMPORT

`POST /api/imports`

File upload or provider job reference.

Returns ImportBatch.

Long reconciliation happens asynchronously.

`GET /api/imports/{id}` shows counts/errors.

---

# 31. EXPORT

`POST /api/exports`

Input:

- cohort/filter
- field set
- purpose.

Validate role/license/privacy.

Create audited export artifact with expiry where appropriate.

---

# 32. ERRORS

Use stable reason/error codes, not only strings.

Examples:

- `campaign_paused`
- `budget_exceeded`
- `prospect_leased`
- `suppressed`
- `research_stale`
- `invalid_transition`
- `provider_unavailable`
- `permission_denied`
- `policy_denied`.

UI can render meaningful message.

---

# 33. LONG-RUNNING REQUESTS

Create job and return `202 Accepted`/job reference rather than holding connection for:

- market mining
- full research
- imports
- large exports
- knowledge indexing.

---

# 34. PAGINATION / SORTING

Large lists use cursor-based pagination where practical.

Stable sorting:

- queue priority
- score/tier
- created/researched date.

Do not return 100,000 prospects in one JSON response.

---

# 35. API VERSIONING

Internal v1 can use path/header/versioned schemas according to chosen framework.

At minimum:

- schema version fields in snapshots
- backward-compatible migrations or coordinated deployment.

Do not let admin UI and workers silently disagree on Call Pack/scoring schema.

---

# 36. ACCEPTANCE

- unauthenticated internal control calls rejected
- rep cannot change compliance/global dial state
- manager cannot remove DNC through generic CRUD
- long tasks asynchronous
- duplicate start/action requests idempotent
- dangerous call endpoint independently revalidates gates
- provider webhooks validate signatures
- list/detail endpoints do not leak secrets/raw restricted payloads.
