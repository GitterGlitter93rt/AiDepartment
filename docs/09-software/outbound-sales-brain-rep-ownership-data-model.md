# YAD Sales Brain — Rep Ownership / Prospect Inventory Data Model

**Status:** Data architecture authority  
**Implementation owner:** Claude Code  
**Purpose:** Define the durable minimum model needed for reps to search shared inventory, claim Accounts, preserve relationship ownership, and avoid duplicate outreach.

---

# 1. ACCOUNT IS THE OWNERSHIP UNIT

Ownership applies primarily at the canonical `Account` level.

Reason:

A company may have:

- multiple contacts;
- multiple phone numbers;
- multiple locations;
- multiple vertical contexts;
- multiple discovery sources;
- several ad observations.

Those should not permit multiple YAD reps to cold-prospect the same company independently.

Location-specific ownership exceptions may be added later for legitimate multi-branch enterprise cases, but V1 defaults to Account-level ownership.

---

# 2. MINIMUM ACCOUNT FIELDS RELEVANT TO REP ACCESS

Conceptual fields:

- account_id
- canonical_name
- canonical_domain
- relationship_state
- current_owner_user_id nullable
- ownership_state
- ownership_updated_at
- client_flag / lifecycle state
- active_opportunity_id nullable
- suppression_summary
- primary_vertical_profile_id
- primary_market_id nullable
- manual_score
- manual_tier
- advertiser_strength
- research_completeness
- research_fresh_until
- created_at
- updated_at

Do not duplicate contact/phone/email fields directly into Account when normalized Contact/Endpoint records exist, except denormalized read models for performance.

---

# 3. OWNERSHIP STATE

Recommended current-state enum:

- UNCLAIMED
- CLAIMED
- MANAGER_ASSIGNED
- ACTIVE_RELATIONSHIP
- ACTIVE_OPPORTUNITY
- CLIENT
- SUPPRESSED

Ownership state and relationship state are related but not necessarily the same field internally.

Do not try to encode every lifecycle concept into one enum if separate state machines are clearer.

---

# 4. OWNERSHIP HISTORY

Never overwrite ownership without history.

Create an append-only ownership event/audit model with:

- ownership_event_id
- account_id
- event_type
- previous_owner_user_id
- new_owner_user_id
- actor_user_id
- reason
- source/search_context
- occurred_at

Event types:

- CLAIMED
- RELEASED
- MANAGER_ASSIGNED
- REASSIGNED
- OWNERSHIP_PROTECTED
- OWNERSHIP_ENDED

The current Account owner may be stored directly for efficient filtering, but history remains separate.

---

# 5. CONTACT MODEL

Account has one or many Contacts.

Contact fields should include:

- contact_id
- account_id
- full_name
- first_name
- last_name
- title
- role_class
- decision_maker_priority
- source
- source_reference
- confidence
- observed_at
- last_verified_at
- status

Contact identity should not be recreated per campaign.

---

# 6. ENDPOINT MODEL

Phone/email belongs to a Contact or Account endpoint entity.

Fields:

- endpoint_id
- account_id
- contact_id nullable
- type: PHONE / EMAIL
- normalized_value
- display_value
- endpoint_class
- source
- quality/confidence
- verification_state
- last_verified_at
- bounce/wrong-number state
- suppression state if endpoint-specific
- created_at
- updated_at

Endpoint state examples:

- VERIFIED
- PROVIDER_SOURCED
- PUBLIC_WEBSITE
- UNVERIFIED
- WRONG_NUMBER
- HARD_BOUNCE
- SUPPRESSED

Do not delete a wrong endpoint silently; retain history so rediscovery does not reintroduce it as valid without new evidence.

---

# 7. SEARCH CONTEXT

When a rep performs a search, persist enough context to audit bulk claims and understand prospect source.

Fields:

- search_context_id
- user_id
- vertical_profile_id
- geography definition
- mining_mode
- qualification filters
- contact filters
- ownership filters
- sort
- created_at

This does not need to persist forever at full detail if retention policy says otherwise, but claim events should keep a reference/summary of why the Account was surfaced.

---

# 8. SAVED MARKET

A saved market is reusable mining/inventory configuration.

Fields:

- market_id
- name
- vertical_profile_id
- geography_type
- geography_definition
- mining_mode
- target_inventory_depth
- status
- last_mined_at
- last_refresh_at
- next_refresh_at nullable
- saturation_state
- created_by
- created_at
- updated_at

Do not store summary counts as sole truth; they may be cached/derived from Account/research state.

---

# 9. ACCOUNT ↔ MARKET MEMBERSHIP

The same Account may appear in multiple markets/searches.

Use membership/observation mapping rather than duplicating the Account.

Fields:

- account_id
- market_id
- first_seen_at
- last_seen_at
- discovery_source
- current_relevance

This allows ABC Air to appear in both `Jacksonville HVAC` and `32256 Advertisers` while remaining one Account with one owner/history.

---

# 10. ACTIVITY / TIMELINE

Use structured activity records.

Fields:

- activity_id
- account_id
- contact_id nullable
- owner_user_id / actor_user_id
- type
- channel
- occurred_at
- structured_payload
- notes nullable
- source_system

Activity types include:

- CALL_ATTEMPT
- VOICEMAIL
- EMAIL_SENT
- EMAIL_REPLY
- FIELD_VISIT
- CALLBACK_REQUESTED
- MEETING_SCHEDULED
- DNC
- WRONG_NUMBER
- NOTE
- OPPORTUNITY_CREATED

Free-form notes supplement structured state; they do not replace it.

---

# 11. FOLLOW-UP / CALLBACK

A follow-up must be durable and queryable.

Fields:

- followup_id
- account_id
- contact_id nullable
- owner_user_id
- followup_type
- due_at
- timezone
- status
- created_from_activity_id nullable
- prospect_requested boolean
- context/notes
- completed_at nullable

Status:

- OPEN
- COMPLETED
- CANCELLED

Requested callbacks should block generic re-claim/release behavior while active.

---

# 12. SUPPRESSION

Suppression must exist independently of ownership.

Fields:

- suppression_id
- scope: ACCOUNT / CONTACT / ENDPOINT
- account_id
- contact_id nullable
- endpoint_id nullable
- suppression_type
- source
- actor_user_id/system
- reason
- created_at
- active

Types may include:

- DNC
- EMAIL_UNSUBSCRIBE
- LEGAL/POLICY
- CLIENT_NO_COLD_OUTREACH
- OTHER_APPROVED

A new discovery source must never reset suppression.

---

# 13. RELATIONSHIP PROTECTION

Ownership rules must consult relationship data before releasing/reassigning.

Protected examples:

- positive email reply;
- requested callback;
- booked meeting;
- active qualified opportunity;
- proposal;
- client.

A rep inactivity timer must not blindly auto-release these Accounts.

---

# 14. CLAIM TRANSACTION

Claim should behave conceptually as:

1. begin transaction;
2. select/lock Account ownership state;
3. check current owner;
4. check suppression/lifecycle;
5. check user authorization/claim policy;
6. update Account current owner/state iff still claimable;
7. append ownership event;
8. append timeline event if desired;
9. commit.

Database constraints/locking strategy should guarantee one current cold owner.

Do not rely only on `SELECT then UPDATE` without concurrency protection.

---

# 15. BULK CLAIM

Bulk claim must not place one enormous lock over unrelated Accounts.

Process each Account safely and return per-Account results.

The implementation may optimize batching later, but semantics remain:

- 22 successes remain successes;
- 3 concurrent conflicts return conflicts;
- no duplicate owners.

---

# 16. READ MODEL / PERFORMANCE

The prospect search table should not require expensive joins/calculations across every evidence record on every keystroke.

Claude may create materialized/denormalized read models such as `prospect_inventory_view` containing:

- Account summary
- best contact summary
- current score/tier
- advertiser summary
- current owner
- contactability
- research freshness
- why-this-prospect summary

This read model is a cache/projection, not canonical truth.

Writes continue through canonical entities/state machines.

---

# 17. INDEXING EXPECTATIONS

Plan indexes for common filters:

- current_owner_user_id
- ownership_state
- relationship/lifecycle state
- manual_tier / score
- primary_vertical_profile_id
- geography/location membership
- market membership
- research freshness
- advertiser signal
- contactability
- follow-up due_at

Claude should benchmark actual queries before over-indexing.

---

# 18. MULTI-VERTICAL ACCOUNT

One Account may have several BusinessContexts/vertical profiles.

The search result uses the campaign/search context to determine which profile/hypothesis is displayed.

Ownership remains Account-global by default.

A rep must not claim the same company again through Plumbing after another rep already claimed it through HVAC.

---

# 19. MULTI-LOCATION ACCOUNT

V1:

- one Account-level cold owner;
- multiple Location records;
- location-specific evidence/search membership.

Later, explicit enterprise/location ownership may be added only if real sales operations require separate reps for separate branches.

Avoid premature complexity.

---

# 20. ACCEPTANCE DATA TESTS

Required before rollout:

## Duplicate discovery

Same business arrives via Google advertiser observation and imported CSV.

Expected: one Account, same owner/history.

## Concurrent claim

Two reps claim same Account.

Expected: one owner.

## DNC rediscovery

Suppressed business rediscovered from a new ZIP query.

Expected: same Account remains suppressed and not claimable.

## Cross-vertical rediscovery

Claimed HVAC company also appears in Plumbing campaign.

Expected: same owner, not fresh unclaimed lead.

## Restart

Process/database application restarts.

Expected: ownership, callbacks, DNC and timeline remain intact.

## Wrong phone

Rep marks phone wrong; later company is rediscovered.

Expected: wrong endpoint remains invalid unless newly verified evidence supersedes it.