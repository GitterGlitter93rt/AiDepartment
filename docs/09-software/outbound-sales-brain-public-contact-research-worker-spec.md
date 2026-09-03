# YAD Outbound Sales Brain — Public Contact Research Worker Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Implementation owner:** Claude Code  
**Runtime:** EdgeXpert background worker

---

# 1. PURPOSE

Define the actual background-worker behavior that turns a qualified Account into a resolved target person/role and truthful business contact path without requiring Apollo.

The worker is asynchronous and separate from the rep browser request.

---

# 2. JOB TYPE

Canonical job:

`CONTACT_RESEARCH`

Inputs:

- `account_id`
- `campaign_id` optional
- `vertical_profile_id`
- `primary_hypothesis_id` optional
- `requested_depth`
- `contact_enrichment_mode`
- `target_role_overrides[]` optional
- `budget`
- `requested_by`
- `idempotency_key`

Suggested depths:

- `BASIC_PUBLIC`
- `STANDARD_PUBLIC`
- `DEEP_PUBLIC`
- `PUBLIC_THEN_PAID`

Default:

`STANDARD_PUBLIC + PUBLIC_ONLY`.

---

# 3. WORKER PIPELINE

```text
load canonical Account
-> suppression/readiness precheck
-> determine target roles
-> load existing Contact/Evidence/Endpoint state
-> freshness check
-> first-party people extraction
-> public entity relationship research
-> public license/professional research where applicable
-> bounded role-search discovery
-> public endpoint discovery
-> observation normalization
-> person/entity reconciliation
-> role ranking
-> endpoint-person relationship classification
-> resolution status
-> write Contact/Endpoint/Evidence
-> refresh Account read model
-> notify requesting rep if useful state changed
```

A partial adapter failure must not destroy already valid results.

---

# 4. PRECHECK

Before network research:

- Account must exist;
- do not create duplicate Account;
- load current suppression state;
- load existing fresh contact evidence;
- avoid rerunning if existing resolution already satisfies requested depth and is fresh;
- if Account is DNC, contact research may still be allowed for internal data hygiene only if policy permits, but results must never re-enter cold outreach eligibility automatically.

---

# 5. TARGET ROLE GENERATION

Inputs:

- vertical profile
- primary opportunity hypothesis
- company size/location clues
- prior contact history
- rep/gatekeeper corrections.

Output:

`TargetRolePlan[]`

Each entry:

- normalized role
- priority
- reason
- account/location scope
- fallback roles.

No person search begins until a role plan exists.

---

# 6. FIRST-PARTY ADAPTER

Fetch a bounded set of useful pages from the canonical domain:

Priority patterns:

- `/about`
- `/team`
- `/leadership`
- `/staff`
- `/contact`
- `/locations`
- likely location/team pages
- public PDFs linked from these pages.

Use existing website crawler security controls:

- SSRF block
- private IP block
- redirect validation
- robots/terms policy
- response limits
- content-type limits
- prompt-injection isolation.

Extract observations, not final truth.

Example observation:

```text
person_name = Sarah Jones
raw_title = Director of Operations
source = company team page
observed_at = ...
```

---

# 7. PUBLIC ENTITY ADAPTER INTERFACE

Do not hard-code one state's HTML into core domain code.

Interface:

```text
PublicEntityAdapter
- supports(jurisdiction)
- searchAccount(account)
- getEntity(entityReference)
- normalizeRelationships(raw)
```

Normalized relationship types include:

- member
- manager
- officer
- president
- registered_agent
- dba
- other.

`registered_agent` has zero default operational routing weight.

Adapter activation requires source-governance review.

---

# 8. PUBLIC LICENSE ADAPTER INTERFACE

```text
PublicLicenseAdapter
- supports(vertical, jurisdiction)
- searchAccount(account)
- normalizePersonRelationships(raw)
```

Normalized relationships include:

- license_holder
- qualifier
- responsible_professional
- facility_leadership
- other.

These observations support identity/currentness but do not automatically select the sales stakeholder.

---

# 9. SEARCH DISCOVERY ADAPTER

Use an approved search provider/API rather than uncontrolled browser scraping.

Inputs:

- canonical Account name
- DBA names
- domain
- city/state
- target roles.

Generate bounded queries from the public decision-maker spec.

Results are discovery pointers.

The worker should prefer fetching the underlying public source where appropriate instead of treating a search snippet as final truth.

Stop conditions:

- high-confidence target + adequate contact route found;
- query budget exhausted;
- repeated/no-new evidence threshold;
- provider failure/circuit breaker.

---

# 10. ENDPOINT DISCOVERY

Collect candidate endpoints only from approved business sources.

Phone observations must capture:

- raw number
- normalized E.164 if possible
- explicit label/context
- page/source
- named-person association if explicitly stated
- location association
- timestamp.

Email observations must capture:

- address
- page/source
- named-person association if explicit
- role/general semantics
- timestamp.

Do not create `DIRECT_CONFIRMED` simply because the same page contains a person's name and a company phone elsewhere.

Explicit semantic association is required.

---

# 11. RECONCILIATION

Candidate people are clustered by:

- normalized name
- account/domain relationship
- role/title compatibility
- location/scope
- source evidence.

Do not merge common names without sufficient evidence.

Resolve:

- current employer relationship
- raw/current title
- normalized role
- scope
- evidence conflicts
- historical relationships.

Never delete conflicting observations; create current conclusion and preserve history.

---

# 12. ROLE RANKING

Rank people against `TargetRolePlan` using deterministic factors:

- hypothesis ownership
- currentness
- employer confidence
- scope match
- authority
- endpoint availability
- prior gatekeeper/prospect confirmation.

Endpoint availability is a tie-breaker/operational factor, not the primary meaning of role relevance.

Do not choose the wrong stakeholder solely because they have a cell number.

---

# 13. RESOLUTION OUTPUT

Possible output:

```text
ContactResolution
- account_id
- primary_contact_id optional
- primary_target_role
- alternate_contact_ids[]
- best_phone_endpoint_id optional
- best_email_endpoint_id optional
- call_route_text
- resolution_status
- public_research_completeness
- evidence_ids[]
- unresolved_questions[]
- optional_paid_enrichment_recommended
- resolved_at
- refresh_due_at
```

Status values use the public decision-maker spec.

---

# 14. WRITE SEMANTICS

Writes must be transactional/idempotent where practical.

On rerun:

- update evidence freshness;
- preserve old evidence;
- reuse canonical Contact where identity matches;
- create new endpoint when value/source meaning differs;
- invalidate wrong-number/hard-bounce endpoints without deleting history;
- never remove DNC/suppression;
- never overwrite prospect-confirmed correction with stale public/provider record.

---

# 15. ON-DEMAND REP REQUEST

Rep action:

`Research Contact`

Server behavior:

1. authorize Account access;
2. check if equivalent job already pending/running;
3. return existing resolution immediately;
4. enqueue one idempotent job;
5. UI shows status;
6. worker updates same Account;
7. rep receives in-app completion alert only if useful state changed.

Do not spawn duplicate jobs from repeated taps.

---

# 16. SAVED MARKET BATCH MODE

EdgeXpert may schedule contact research for unclaimed high-value inventory.

Example:

- Saved Market: Jacksonville HVAC Advertisers
- Account becomes Tier A/B
- public contact state = not researched/stale
- inventory floor needs call-ready supply

Then worker may enqueue `STANDARD_PUBLIC` resolution within market budget.

Do not deep-research every Tier C/D business merely to populate names.

---

# 17. PAID FALLBACK GATE

If mode permits paid enrichment, public worker completes first and produces:

- current named target state
- direct endpoint gaps
- Account value/Tier
- likely incremental value.

Only then a separate paid-provider adapter may run.

Paid fallback decision inputs:

- Tier / opportunity value
- current route quality
- direct endpoint gap
- provider budget
- historical provider lift in that market/vertical.

No provider call if `PUBLIC_ONLY`.

---

# 18. OBSERVABILITY

Track per job:

- duration
- adapter calls
- pages fetched
- search queries
- cost
- people observations
- people resolved
- endpoints found
- named target found
- direct endpoint found
- company-route fallback
- conflicts
- errors
- source blocks
- paid fallback invoked yes/no.

Do not log secrets or unnecessary personal content.

---

# 19. SOURCE HEALTH

Each adapter exposes health:

- healthy
- degraded
- disabled
- blocked_by_terms_review
- rate_limited
- auth_required
- error.

If one source is unavailable:

- continue other stages;
- reduce completeness appropriately;
- never convert source failure into `person does not exist`.

---

# 20. SECURITY

Research worker must have:

- outbound allow/deny controls where appropriate
- SSRF protection
- request timeouts
- response-size limits
- concurrency limits
- no shell/GitHub/communication tools exposed to untrusted webpage content
- secret isolation
- sanitized logs.

Webpage text is untrusted evidence, never executable instruction.

---

# 21. ACCEPTANCE TEST

Using synthetic fixture Accounts, prove:

- named person from first-party + public record reconciles correctly;
- registered agent excluded as decision-maker;
- explicit direct business number becomes direct confirmed;
- main company line stays company route;
- no person results in role route;
- stale person conflict does not override fresh evidence;
- duplicate clicks create one job;
- rerun preserves suppression/history;
- source failure produces partial result, not invented negative;
- `PUBLIC_ONLY` makes zero paid-provider calls.

Then run a controlled manual review on a small real research-only sample before scaling.

---

# 22. CORE RULE

**The worker's job is not to fill every field. Its job is to produce the strongest current, auditable business contact route that public evidence supports, while preserving uncertainty and keeping paid people-data optional.**
