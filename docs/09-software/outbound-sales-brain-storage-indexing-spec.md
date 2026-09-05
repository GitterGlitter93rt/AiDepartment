# Your AI Department — Outbound Sales Brain Storage & Indexing Specification

**Status:** Architecture authority  
**Purpose:** Define the durable persistence model, uniqueness constraints, immutable history, read models and indexes required for a prospect factory that can safely dedupe businesses, preserve evidence, prevent duplicate outreach and support analytics.

---

# 1. DEFAULT STORAGE DIRECTION

Use PostgreSQL as the canonical durable relational store for V1 unless Claude's Gate 0 audit identifies a strong existing equivalent.

Why relational fits:

- Account/Location/Contact relationships;
- immutable observations/evidence;
- campaign/queue state;
- suppression/contact history;
- transactions for critical actions;
- explainable analytics;
- full-text/vector extension options if useful.

Redis or equivalent may be added for ephemeral session/cache/queue acceleration, but must not become the only store for DNC or call history.

---

# 2. DATABASE NAMESPACES / LOGICAL GROUPS

Logical table groups:

## Identity

- accounts
- account_aliases
- locations
- domains
- phone_endpoints
- contacts
- source_identities
- entity_relationships
- merge_events

## Market Miner

- mining_jobs
- territories
- search_cells
- search_tasks
- search_observations
- provider_usage
- research_runs
- evidence_records
- evidence_relations
- prospect_profiles
- prospect_scores
- research_completeness_snapshots
- opportunity_hypotheses
- offer_hypotheses
- call_packs

## Campaign / outreach

- campaigns
- campaign_memberships
- prospect_leases
- compliance_decisions
- contact_attempts
- calls
- call_events
- prospect_statements
- call_outcomes
- follow_up_tasks
- suppressions

## Knowledge / QA

- knowledge_snapshots
- knowledge_chunks/index references
- commercial_truth_snapshots
- qa_reviews
- experiment_assignments

## Operations

- outbox
- job_queue or external queue references
- audit_log
- system_flags
- allowlists

Exact table names may change, but domain separations should remain.

---

# 3. ID STRATEGY

Use stable opaque internal IDs, e.g. UUID/ULID according to implementation preference.

Requirements:

- never use provider ID as primary key;
- provider IDs live in SourceIdentity;
- IDs safe to expose in authenticated internal APIs if needed;
- avoid sequential public IDs when they create unnecessary enumeration risk.

---

# 4. ACCOUNT UNIQUENESS

There is no single universal unique constraint for Account because businesses can share names/domains/phones in complex structures.

Instead:

- unique SourceIdentity per provider/native ID;
- unique normalized domain relationship rules with exceptions;
- unique phone endpoint record per normalized E.164 + role/context where sensible;
- entity resolver creates/links Accounts transactionally.

Do not use `company_name UNIQUE`.

---

# 5. SOURCE IDENTITY UNIQUE CONSTRAINT

Unique:

`(provider, entity_type, provider_native_id)`

This prevents the same provider record creating repeated Accounts on import/search retries.

---

# 6. SEARCH OBSERVATION IMMUTABILITY

SearchObservation is append-only except correction metadata.

Uniqueness/idempotency fingerprint can include:

- provider
- task/request identifier
- result position/native result ID where available
- observed time/window
- query/search cell
- advertiser/source identity.

Do not overwrite a September 2 ad observation because September 9 research is different.

---

# 7. EVIDENCE IMMUTABILITY

EvidenceRecord is an observation-backed claim snapshot.

Do not mutate old claim into a different value.

New information creates:

- new EvidenceRecord;
- relation to old record (`contradicts`, `supersedes`, etc.);
- current read model chooses appropriate current value.

This preserves auditability.

---

# 8. EVIDENCE RELATIONS

Types:

- supports
- contradicts
- supersedes
- corroborates
- derived_from

Example:

Prospect statement Housecall Pro
`contradicts`
old ServiceTitan frontend evidence as current workflow inference.

The original frontend observation remains historically true if it was actually observed.

---

# 9. SCORE SNAPSHOTS

Every score recalculation creates a new ProspectScore snapshot with:

- score version
- evidence IDs
- points/reasons
- total
- tier
- timestamp.

Current Account read model points to latest valid score.

Old Call Pack retains old score snapshot ID.

---

# 10. CALL PACK SNAPSHOT

CallPack immutable after ready/finalized.

If research refresh changes:

- generate new CallPack version;
- campaign membership points to current pack;
- prior attempt remains linked to original pack.

This is essential for QA:

> What did the caller know at the time?

---

# 11. SUPPRESSION CONSTRAINTS

Suppression table supports scopes:

- phone
- contact
- account
- email
- campaign
- global/internal exclusion.

Critical indexes:

- normalized phone
- contact ID
- account ID
- active/effective dates.

Immediate pre-contact query must be fast and reliable.

Do not physically delete suppression history when inactive/reversed; store lifecycle/audit.

---

# 12. CONTACT ATTEMPT UNIQUE/LOCKING

Prevent duplicate simultaneous attempts.

Use:

- prospect lease table and/or advisory/distributed lock;
- unique active-attempt constraint keyed by phone/contact/campaign as appropriate;
- transactional state transition.

Worker crash must release/expire lease without erasing prior attempt record.

---

# 13. OUTBOX

Transactional outbox table fields:

- outbox ID
- aggregate/entity ID
- action type
- destination/provider
- payload/reference
- idempotency key
- state
- attempt count
- next attempt
- provider reference
- last error
- created/updated.

Create outbox record in same DB transaction as canonical state change when external sync must eventually happen.

---

# 14. AUDIT LOG

Append-only administrative/security audit.

Fields:

- actor type/user/service
- actor ID
- action
- resource type/ID
- old/new or change summary
- reason
- request ID
- timestamp.

Sensitive payloads redacted.

---

# 15. CURRENT READ MODELS

Do not force every UI query to traverse full history.

Maintain current derived/read fields/tables/views for:

- current Account profile
- current verified website/phone
- current score/tier
- current research completeness
- current Call Pack
- current campaign status
- current suppression status
- current opportunity/stage.

History remains in immutable tables.

---

# 16. INDEXES — IDENTITY

Likely indexes:

- normalized domain
- normalized phone
- company normalized name + geography
- address components
- provider/source native ID
- location coordinates/geospatial index if extension used.

Entity resolution often queries combinations, so benchmark actual query plans.

---

# 17. INDEXES — MINER

- campaign/mining job status
- search task status/priority
- search cell + query family + last searched
- SearchObservation account/provider/observed_at
- EvidenceRecord account/claim_key/state/observed_at
- score tier/total/current
- research completeness/current
- Call Pack current/ready.

---

# 18. INDEXES — OUTREACH

- phone/contact/account suppression
- attempt campaign/phone/date
- follow-up due date/status/owner
- call provider SID
- call/account/date
- outcome/disposition/date
- requested callback timestamp.

---

# 19. FULL-TEXT / SEARCH

Admin search should support:

- company name
- domain
- phone
- contact
- city
- notes/problem text.

Use PostgreSQL full-text/trigram where useful.

Do not put Elasticsearch into V1 unless actual scale/query requirements justify another system.

---

# 20. VECTOR STORAGE

Sales Manual RAG may use:

- PostgreSQL pgvector
- dedicated vector store
- local vector index

depending Gate 0 environment/performance.

Selection criteria:

- low latency
- simple operations
- versioned snapshots
- metadata filtering.

Do not add a vector database merely because the system uses AI.

---

# 21. GEOSPATIAL

PostGIS can be useful for:

- radius territories
- search cell intersections
- distance sorting
- coverage maps.

If used, keep canonical Census/reference IDs alongside geometry.

If not used initially, store lat/lng and add later without changing business semantics.

---

# 22. JSONB USE

JSONB appropriate for:

- provider-specific extra metadata
- typed snapshot payloads
- experiment config
- raw-ish permitted observation fields.

Do not store core relational identity only inside giant JSON blobs.

Important queryable fields get columns/indexes.

---

# 23. ENUMS / LOOKUP TABLES

Avoid database enum migrations for every evolving business label if it harms agility.

Use application-validated text/check/lookup tables for:

- dispositions
- claim keys
- evidence states
- provider types
- task states

according to migration strategy.

Critical state values still validated strictly.

---

# 24. SOFT DELETE

Core history objects should usually use status/archived timestamps rather than destructive delete.

Exceptions:

- privacy/retention deletion of media/personal data where policy requires actual deletion;
- provider raw payload expiry.

Do not soft-delete when policy requires erasure.

---

# 25. MEDIA STORAGE

Audio/transcript blobs do not need to live directly in relational DB.

Store:

- object-storage reference
- encryption/access metadata
- retention expiry
- checksum
- call ID.

Transcript segments may be DB rows if search/QA requires, subject to retention policy.

---

# 26. MIGRATIONS

Use version-controlled migration tool.

Requirements:

- forward migration test
- rollback/restore plan
- no destructive production migration without backup/review
- indexes created with operational impact considered.

Claude chooses library compatible with actual TypeScript stack after Gate 0.

---

# 27. TRANSACTION BOUNDARIES

Critical examples:

## DNC

- suppression insert + audit in transaction
- commit before tool returns confirmed.

## Booking outcome

- provider success first/idempotent confirmation
- canonical meeting/task/stage state transaction
- outbox external CRM if needed.

## Entity merge

- merge mapping/current entity references transaction
- merge event/audit recorded.

---

# 28. ANALYTICS

V1 analytics can query operational DB/read views with careful indexes.

At larger scale, replicate/export to analytics warehouse.

Do not prematurely introduce a warehouse before event/data semantics are stable.

---

# 29. DATA RETENTION JOBS

Scheduled jobs:

- expire/delete raw provider payloads per terms
- mark evidence stale based on TTL
- delete media/transcript at policy expiry
- prune ephemeral sessions
- never delete durable DNC merely due ordinary media retention.

---

# 30. BACKUP / RESTORE TEST

At minimum test restore for:

- Accounts
- suppression
- contact attempts/calls
- campaigns
- evidence/scores.

A backup is not considered operational until restore procedure is exercised.

---

# 31. FIRST SCALE ASSUMPTION

Design comfortably for:

- hundreds of thousands of Accounts/observations
- millions of search/evidence/call events over time

without building distributed-database complexity prematurely.

PostgreSQL can handle this with sane schema/indexes/partitioning if needed.

Measure before sharding.

---

# 32. POSSIBLE PARTITIONING LATER

High-volume append tables may eventually partition by time:

- search observations
- call events
- provider usage
- audit/events.

Not required for initial implementation unless volume/testing demonstrates need.

---

# 33. ACCEPTANCE

Before Gate 7 Market Miner acceptance:

- restart does not lose accounts/evidence/scores
- duplicate provider tasks do not duplicate canonical entities
- stale evidence update preserves history
- merge/unmerge works
- suppression survives restart
- provider cost records queryable by campaign
- ready-inventory query performs adequately
- backup exists and restore process documented.
