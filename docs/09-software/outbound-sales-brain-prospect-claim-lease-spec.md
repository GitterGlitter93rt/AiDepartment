# Your AI Department — Prospect Claim, Lease, Assignment & Relationship Ownership Specification

**Status:** Architecture authority  
**Purpose:** Prevent duplicate outreach, rep collisions, orphaned follow-ups, and conflicting Smartlead/human activity while allowing a shared Prospect Factory to serve multiple salespeople.  
**Implementation owner:** Claude Code

---

# 1. CORE PRINCIPLE

A prospect may exist once in the canonical YAD Account graph while several systems want to act on it.

The system must distinguish four concepts:

1. **Pool eligibility** — the Account is eligible to appear in a sales work queue.
2. **Assignment** — a manager/team has designated who should generally work it.
3. **Work lease** — one rep has temporarily claimed the Account for active work.
4. **Relationship ownership** — a durable owner exists because a real relationship, callback, meeting, or opportunity has formed.

These are not interchangeable.

---

# 2. WHY ACCOUNT-LEVEL COORDINATION IS THE DEFAULT

Cold outreach normally leases at the **Account level**, not merely the contact level.

Reason:

If Brent is speaking to the office manager at ABC HVAC while another rep emails the owner as though YAD has never contacted the company, the company experiences duplicate/conflicting outreach even though two different Contacts were used.

Therefore:

> One cold Account -> one active human work lease by default.

Contact-level parallelism may be allowed only when deliberately configured or manager-authorized.

---

# 3. STATE MODEL

Recommended Account work-coordination states:

- `UNASSIGNED`
- `ASSIGNED_AVAILABLE`
- `LEASED_ACTIVE`
- `FOLLOWUP_COMMITTED`
- `RELATIONSHIP_OWNED`
- `OPPORTUNITY_ACTIVE`
- `CUSTOMER_OR_CLIENT`
- `DISQUALIFIED`
- `SUPPRESSED`

These states do not replace canonical opportunity/lifecycle states. They are the sales-work coordination projection.

---

# 4. ASSIGNMENT

Assignment fields:

- `assignment_id`
- `account_id`
- `assigned_team_id`
- `assigned_rep_id` optional
- `campaign_id` optional
- `territory_id` optional
- `assigned_by`
- `assigned_at`
- `assignment_reason`
- `status`
- `expires_at` optional

Assignment means:

> this rep/team is the intended worker.

It does **not** itself mean the rep is currently touching the Account.

---

# 5. WORK LEASE

A work lease is a temporary mutex around active cold work.

Fields:

- `lease_id`
- `account_id`
- `rep_id`
- `claimed_at`
- `last_heartbeat_at`
- `expires_at`
- `lease_purpose`
- `campaign_id`
- `channel_intent`
- `status`
- `released_at` optional
- `release_reason` optional

Suggested purposes:

- `CALL_PREP`
- `HUMAN_CALL`
- `EMAIL_PREP`
- `MANUAL_EMAIL`
- `RESEARCH_REVIEW`
- `FIELD_VISIT_PREP`

A Smartlead sequence is coordinated through cross-channel state rather than masquerading as a rep browser lease.

---

# 6. CLAIM OPERATION

When a rep presses `Claim`, `Call`, `Work Prospect`, or equivalent:

1. re-check Account identity;
2. re-check suppression;
3. re-check active opportunity/customer state;
4. re-check relationship owner;
5. re-check existing lease;
6. acquire Account lease atomically;
7. return current work card;
8. begin heartbeat while active.

If another lease exists:

- do not silently steal it;
- show who/what owns it when permissions allow;
- manager may explicitly reassign according to RBAC.

---

# 7. ATOMICITY REQUIREMENT

Two reps clicking the same Account at nearly the same instant must not both receive a successful lease.

Expected:

- one transaction wins;
- the other receives `ACCOUNT_ALREADY_LEASED` plus safe context.

Database uniqueness/locking must enforce this; UI optimism alone is insufficient.

---

# 8. LEASE HEARTBEAT

While the rep is actively working the Account, client/server should renew the lease periodically.

Exact timing is configuration, not business truth.

The implementation must tolerate:

- browser refresh;
- temporary network interruption;
- phone lock/sleep;
- app crash;
- duplicate heartbeat.

Heartbeat writes are idempotent.

---

# 9. LEASE EXPIRY

Cold work lease may expire after inactivity.

Important distinction:

- temporary cold-work lease may expire;
- a promised callback, positive reply, booked meeting, or active opportunity must **not** disappear merely because the browser went idle.

Therefore lease expiration never deletes relationship commitments.

On expired cold lease:

- Account may return to eligible pool according to assignment/cadence rules;
- previous prep/action history remains visible.

---

# 10. MANUAL RELEASE

Rep can release cold prospect with reason:

- `NOT_WORKING_NOW`
- `RESEARCH_NEEDED`
- `WRONG_VERTICAL`
- `WRONG_CONTACT`
- `DUPLICATE_ACCOUNT`
- `MANAGER_REASSIGN`
- `OTHER_REVIEW`

Release does not erase history.

If a meaningful commitment exists, simple release should not orphan it; relationship owner/follow-up owner must be resolved first.

---

# 11. RELATIONSHIP OWNERSHIP

Convert from temporary cold lease into durable relationship ownership when any approved event creates a meaningful relationship, including:

- prospect requests callback;
- meaningful two-way email reply;
- decision-maker asks for information with continued engagement;
- strategy call/meeting booked;
- qualified opportunity created;
- explicit warm referral to another stakeholder inside same Account;
- manager manually establishes owner.

Fields:

- `relationship_owner_rep_id`
- `ownership_started_at`
- `ownership_reason`
- `ownership_source_event_id`
- `ownership_status`

Relationship owner can survive campaign boundaries.

---

# 12. REQUESTED CALLBACK

Requested callback is a commitment, not a cold cadence step.

On callback request:

- create durable follow-up task;
- assign owner;
- retain prospect context;
- remove Account from generic unowned cold pool;
- surface at promised local time;
- do not let another rep cold-call first merely because temporary lease expired.

---

# 13. SMARTLEAD COORDINATION

Before exporting or continuing a Smartlead cold sequence, coordinator checks:

- active human lease;
- relationship ownership;
- positive/question reply;
- scheduled callback;
- active opportunity;
- meeting booked;
- suppression.

Examples:

- rep merely viewing Account for 30 seconds -> configurable; do not necessarily stop email forever;
- rep begins active call workflow -> suppress conflicting new cold send during active work window;
- prospect positively replies -> stop/pause generic cold sequence and establish human relationship handling;
- scheduled callback -> no generic email that contradicts the conversation.

---

# 14. DIRECT MANUAL EMAIL

When rep sends or prepares a manual email from Human Assist:

- acquire/validate lease;
- log message intent;
- coordinate with Smartlead;
- prevent duplicate same-day conflicting cold message according to campaign policy.

Email send success must be confirmed by actual provider response if provider integration is used.

---

# 15. MULTIPLE CONTACTS INSIDE ONE ACCOUNT

By default, Account lease covers all cold Contacts.

Manager-authorized exceptions may allow parallel Contacts when:

- distinct business units genuinely require it;
- relationship context is shared;
- scripts acknowledge known relationship;
- cross-channel coordinator prevents contradictory outreach.

This should be rare in V1.

---

# 16. MULTI-LOCATION COMPANIES

Entity resolution determines whether locations are:

- one Account with Locations;
- separate franchise/operator Accounts;
- uncertain and human-review required.

Lease scope follows canonical Account identity.

Do not accidentally lock an entire unrelated franchise network because company names resemble one another.

---

# 17. MANAGER REASSIGNMENT

Manager may reassign with audit trail.

Required:

- current owner/lease shown;
- reason required for forced takeover;
- pending callback/meeting transferred explicitly;
- old owner notified in-product where useful;
- no silent deletion of tasks.

Forced reassignment during an active call should be blocked or require privileged override.

---

# 18. REP TERMINATION / INACTIVITY / PTO

Manager/admin workflow should find:

- active leases;
- callbacks;
- meetings;
- opportunities;
- owned accounts;
- overdue tasks.

Temporary leases can be released.

Durable relationship commitments must be reassigned deliberately.

---

# 19. QUEUE VISIBILITY

A rep's queue should not show cold Accounts actively leased/owned by another rep unless manager/shared visibility policy permits read-only display.

A manager may see:

- assigned
- leased
- owner
- last activity
- next commitment
- lease age
- stuck/expired state.

---

# 20. AUDIT EVENTS

Record:

- assignment created/changed;
- lease claimed;
- heartbeat/renewal summary;
- lease released/expired;
- force takeover;
- relationship owner created/changed;
- callback ownership transferred;
- Smartlead conflict blocked;
- duplicate claim blocked.

Do not create noisy audit events for every UI render.

---

# 21. FAILURE MODES

## Browser abandoned

Lease eventually expires if no durable relationship event exists.

## Rep starts call then app crashes

Keep short protected lease window; store call-start event if known; reconcile provider/manual outcome later.

## Database unavailable

Do not grant optimistic duplicate lease.

## Smartlead webhook delayed

Use idempotent event ingestion and conservative relationship checks before new cold action.

## Duplicate event

No duplicate ownership/task creation.

---

# 22. API BEHAVIOR

Suggested service operations:

- `claim_account_for_work`
- `renew_work_lease`
- `release_work_lease`
- `get_work_lease`
- `assign_account`
- `reassign_account`
- `establish_relationship_owner`
- `transfer_relationship_owner`
- `resolve_cross_channel_conflict`

Every write requires authenticated actor + RBAC.

---

# 23. ACCEPTANCE TESTS

1. Brent and Rep B claim same Account simultaneously -> exactly one succeeds.
2. Brent closes browser before any outreach -> lease expires; Account can return to pool.
3. Brent gets requested callback then closes browser -> callback remains Brent-owned and does not return to generic cold pool.
4. Smartlead positive reply arrives while Rep B tries to claim -> reply establishes relationship handling; cold claim is blocked/re-routed.
5. Manager force-reassigns callback -> task/context transfer; audit retained.
6. Hard bounce email while phone remains usable -> Account lease/phone workflow remains valid.
7. DNC during leased call -> suppression overrides lease; no later cold requeue.
8. Same Account rediscovered under plumbing campaign -> existing relationship owner/history remain.
9. Duplicate webhook -> one relationship transition.
10. Expired lease never deletes notes, evidence, disposition, callback, or opportunity.

---

# 24. CORE RULE

A Prospect Factory becomes dangerous and annoying if multiple reps can unknowingly attack the same company. Temporary work needs a lease; real relationships need durable ownership; suppression and commitments outrank both.