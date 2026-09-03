# YAD Sales Brain — Rep Portal API Contract v1

**Status:** Backend/API architecture authority  
**Implementation owner:** Claude Code  
**Purpose:** Make inventory browsing, ZIP search, claiming, ownership, follow-up, and market research deterministic and server-authoritative.

---

# 1. API PRINCIPLES

- Authentication required for every sales-data endpoint.
- RBAC enforced server-side.
- Account ownership enforced server-side.
- DNC/suppression enforced server-side.
- Search reads canonical durable inventory first.
- Live/background mining is a separate command from inventory search.
- Claim/release/reassign commands are audited.
- API responses distinguish UNKNOWN from false/no.
- UI does not call provider APIs directly.
- Provider credentials never cross to browser.

Endpoint names below are conceptual; Claude may use REST/RPC conventions appropriate to the final stack while preserving behavior.

---

# 2. AUTH / SESSION

## GET /api/me

Returns:

- user_id
- name
- role
- permissions
- active_claim_count
- optional active_claim_target

Never return secrets/provider configuration.

---

# 3. SEARCH INVENTORY

## POST /api/prospects/search

Request example:

```json
{
  "vertical_profile_id": "hvac",
  "geography": {"type": "zip_zcta", "value": "32256"},
  "mining_mode": "advertiser_first",
  "minimum_tier": "B",
  "ownership": "UNCLAIMED",
  "contactability": ["phone_available"],
  "page": 1,
  "page_size": 50,
  "sort": "recommended_priority"
}
```

Response:

- search_context_id
- normalized_filters
- results
- total_matching
- coverage_summary
- research_freshness_summary
- may_research_more
- active_research_job_id if applicable

Each result should include only summary fields needed for the table; full evidence comes from Account detail endpoint.

Search must not block while a new mining job executes.

---

# 4. SEARCH COVERAGE

Coverage summary should expose business-safe state such as:

- FRESH
- PARTIAL
- STALE
- NOT_YET_MINED
- REFRESHING

Optional fields:

- researched_count
- unclaimed_count
- last_mined_at
- last_refresh_at
- active_job_state

Do not claim `complete market coverage` unless the Market Miner coverage model supports that statement.

---

# 5. START / REFRESH MARKET RESEARCH

## POST /api/mining/jobs

Authorized roles only according to policy.

Inputs:

- search_context_id or explicit campaign definition
- vertical
- geography
- mining_mode
- requested_depth/target inventory

Returns immediately:

- job_id
- state: QUEUED/RUNNING
- current available inventory count

Idempotency required so repeated button clicks do not launch uncontrolled duplicate vendor spend.

---

# 6. MARKET LIST

## GET /api/markets

Returns saved markets visible to the user.

Summary fields:

- market_id
- name
- geography
- vertical
- mining_mode
- status
- researched_count
- unclaimed_count
- claimed_count
- tier_a_count
- tier_b_count
- phone_email_count
- advertiser_count
- last_mined_at
- freshness

---

# 7. ACCOUNT DETAIL

## GET /api/accounts/{account_id}

Server must verify user may view Account.

Return grouped object:

- identity
- locations
- owner
- relationship state
- manual score/tier
- advertiser evidence summary
- research completeness
- best contacts
- primary hypothesis
- hooks/questions
- do-not-claim warnings
- technology/CTA signals
- evidence summaries/source references
- current channel eligibility
- timeline
- follow-up state

Do not return internal provider secrets/raw credentials.

---

# 8. CLAIM ONE ACCOUNT

## POST /api/accounts/{account_id}/claim

Request:

```json
{
  "expected_state": "UNCLAIMED",
  "search_context_id": "..."
}
```

Transaction semantics:

1. lock/check Account ownership row;
2. verify user permission;
3. verify not suppressed/DNC;
4. verify not client/active conflicting relationship;
5. verify current ownership is still claimable;
6. verify configurable active-claim rule;
7. assign owner;
8. write ownership audit event;
9. commit;
10. return new state.

If conflict:

HTTP/status convention may vary, but response must say:

- ALREADY_CLAIMED
- CLAIMED_BY_SELF
- SUPPRESSED
- CLIENT
- ACTIVE_OPPORTUNITY
- CLAIM_LIMIT
- PERMISSION_DENIED

---

# 9. BULK CLAIM

## POST /api/accounts/claim-batch

Request:

- account_ids
- search_context_id

Important:

Each Account claim is atomic independently.

One conflict does not roll back successful claims of unrelated Accounts.

Response example:

- requested: 25
- claimed: 22
- conflicts: 3
- per_account_results

This enables UI message:

> 22 claimed. 3 were already owned.

---

# 10. RELEASE

## POST /api/accounts/{account_id}/release

Allowed only under ownership/RBAC rules.

Reject if protected active relationship state exists unless manager policy explicitly handles it.

Audit:

- actor
- previous owner
- reason
- timestamp

---

# 11. MANAGER REASSIGN

## POST /api/accounts/{account_id}/reassign

Manager only.

Request:

- new_owner_user_id
- reason

Must be audited.

Do not erase prior owner history.

---

# 12. MY PROSPECTS

## POST /api/my-prospects/search

Same filtering/sorting principles as inventory search, but owner fixed to current user unless manager viewing another rep.

Useful filters:

- NOT_CONTACTED
- CALL_READY
- EMAIL_READY
- CALL_AND_EMAIL
- CALLBACK_DUE
- POSITIVE_REPLY
- OPPORTUNITY

---

# 13. DISPOSITION

## POST /api/accounts/{account_id}/activities/disposition

Request types:

- NO_ANSWER
- VOICEMAIL
- GATEKEEPER
- DECISION_MAKER_REACHED
- SEND_INFORMATION
- CALLBACK_REQUESTED
- POSSIBLE_OPPORTUNITY
- MEETING_SCHEDULED
- NOT_A_FIT
- WRONG_NUMBER
- DO_NOT_CONTACT

Common fields:

- contact_id if applicable
- notes
- occurred_at
- channel

Type-specific fields required where necessary.

Server verifies current owner/permission before accepting sales activity.

---

# 14. CALLBACK

For `CALLBACK_REQUESTED`, persist:

- due_at
- destination timezone
- contact/account
- requested_by_prospect flag
- notes/context
- owner

A requested callback is a protected relationship state for ownership-release logic.

---

# 15. DNC

DNC endpoint/action must be fast and durable.

On DNC:

- create suppression record;
- stop cold channel eligibility;
- remove from unclaimed/claimable inventory;
- update relationship state;
- write audit/timeline event.

Ordinary reps may add DNC.

Ordinary reps may not remove DNC.

---

# 16. WRONG NUMBER / BAD ENDPOINT

Wrong-number disposition should attach to the specific endpoint, not automatically invalidate the whole company.

Persist:

- endpoint_id
- bad/wrong state
- observed_at
- actor
- notes

Then optionally enqueue contact re-enrichment.

---

# 17. REQUEST CONTACT RESEARCH

## POST /api/accounts/{account_id}/contact-research

Creates idempotent background job.

Use when Account is attractive but lacks sufficient phone/email/POC data.

Do not block rep page.

---

# 18. TIMELINE

Every meaningful state change produces an immutable/auditable timeline event such as:

- DISCOVERED
- RESEARCHED
- SCORE_CHANGED
- CONTACT_ENRICHED
- CLAIMED
- RELEASED
- REASSIGNED
- CALL_ATTEMPT
- EMAIL_SENT
- EMAIL_REPLY
- CALLBACK_CREATED
- MEETING_BOOKED
- DNC
- WRONG_ENDPOINT
- OPPORTUNITY_CREATED

Do not build relationship truth from free-form notes alone.

---

# 19. OPTIMISTIC UI

UI may provide optimistic feedback only when rollback is handled cleanly.

For Claim, server commit is authoritative.

If frontend displays `You` before server confirms and claim loses race, it must immediately revert and show actual owner.

Never let optimistic UI create phantom ownership.

---

# 20. PAGINATION / SORTING

Search endpoints should support scalable pagination/cursoring.

Do not load 50,000 Accounts into browser and filter client-side.

Sorting fields should be explicitly whitelisted.

Examples:

- recommended_priority
- manual_score
- advertiser_strength
- research_freshness
- claimed_at
- follow_up_due
- company_name

---

# 21. SECURITY

Server must reject:

- unauthorized account access;
- claiming another user's owned Account;
- ordinary-rep reassignment;
- DNC removal;
- arbitrary export escalation;
- unvalidated sort/query injection;
- direct provider-key requests.

Audit privileged actions.

---

# 22. CORE CONCURRENCY TEST

Given Account A is UNCLAIMED.

Rep 1 and Rep 2 issue Claim concurrently.

Expected:

- one transaction commits owner;
- second sees conflict/current owner;
- database contains one current owner;
- both receive accurate API response;
- audit history records one successful claim only.

This test is mandatory before two-rep rollout.