# YAD Sales Brain — Ownership Lifecycle & Claim Governance

**Status:** Product/architecture authority  
**Implementation owner:** Claude Code  
**Purpose:** Let reps self-select prospects without duplicate ownership, hoarding, or relationship loss.

---

# 1. CORE RULE

One canonical Account may have one active cold-sales owner at a time unless an explicit manager/team-sharing rule applies.

Ownership is durable relationship state, not a UI checkbox.

---

# 2. OWNERSHIP STATES

Suggested states:

- `UNCLAIMED`
- `CLAIMED_ACTIVE`
- `CALLBACK_ACTIVE`
- `POSITIVE_REPLY_ACTIVE`
- `OPPORTUNITY_ACTIVE`
- `MANAGER_HELD`
- `RELEASE_PENDING`
- `RELEASED`
- `SUPPRESSED`
- `CLIENT`

Ownership and lifecycle state are related but not identical. For example, an Account can be `OPPORTUNITY_ACTIVE` and still be owned by Brent.

---

# 3. CLAIM TO ME

Rep may claim an Account when:

- Account is unclaimed;
- Account is not globally/team suppressed;
- Account is not a client;
- Account is not an active opportunity owned by somebody else;
- Account does not have an active requested callback owned by somebody else;
- rep has access to that market/account.

Claim must be atomic in the database.

If two reps click Claim simultaneously, exactly one wins.

Response to loser:

> This prospect was just claimed by Brent.

Do not create two owner rows and reconcile later.

---

# 4. BULK CLAIM

Bulk claim is best-effort per Account.

Example:

Rep selects 25.

Result:

- 22 claimed successfully;
- 2 were already claimed;
- 1 became ineligible due to suppression.

The entire operation must not fail because one Account changed state.

Every result should be auditable.

---

# 5. CLAIM LIMITS

The system may support configurable active-claim limits to prevent hoarding.

Do not hard-code a universal limit in architecture.

Potential controls:

- max active cold claims per rep;
- max new claims per day;
- manager override;
- no limit for callbacks/opportunities already in relationship.

If limits are enabled, the UI should explain why Claim is unavailable.

---

# 6. ACTIVITY / STALENESS

Track meaningful ownership activity:

- call attempt;
- email sent;
- reply;
- callback scheduled;
- meeting booked;
- note/correction tied to real interaction;
- opportunity movement.

Merely opening the Account does not reset inactivity indefinitely.

Managers should see claimed prospects with no meaningful activity beyond a configurable threshold.

The system should not auto-steal relationships with positive replies, callbacks, meetings, or opportunities.

---

# 7. RELEASE

A rep may release a cold Account they no longer intend to work if:

- no active callback;
- no positive reply requiring response;
- no active opportunity;
- no manager hold;
- no pending scheduled action.

Release returns the Account to shared inventory while preserving all history.

Releasing must never delete:

- notes;
- prior calls/emails;
- objections;
- contact corrections;
- DNC/suppression;
- research;
- prior ownership history.

---

# 8. MANAGER REASSIGNMENT

Manager can reassign when appropriate.

Reassignment should require reason/category such as:

- rep unavailable;
- territory change;
- stale cold claim;
- specialist handoff;
- requested contact preference;
- workload balancing;
- employment/team change.

Every reassignment is an audit event.

If there is an active relationship, system should make the context visible to the new owner.

---

# 9. TEAM / TERRITORY SCOPE

Ownership is separate from visibility.

A rep can see an Account they do not own if permissions allow, but cannot contact it as generic cold outreach when another rep owns it.

Possible UI states:

- `Unclaimed — Claim`
- `You own this`
- `Owned by Brent`
- `Active opportunity — Sarah`
- `Suppressed`

Do not hide ownership and let reps discover conflicts manually.

---

# 10. CALLBACK PRIORITY

Requested callback creates stronger ownership protection than a cold claim.

Example:

Prospect says:

> Call me Thursday at 2.

System records:

- owner;
- exact requested time/timezone;
- context;
- channel;
- source conversation.

That Account must not appear as available/unclaimed merely because another mining job rediscovers it.

---

# 11. POSITIVE EMAIL REPLY

Positive/engaged reply should lock relationship ownership for follow-up.

If Smartlead produces:

> Sure, give me a call tomorrow.

then generic cold calling/email by another rep should be blocked.

The owner sees the reply as a priority action.

---

# 12. DNC / SUPPRESSION

DNC overrides ownership.

A rep can add DNC immediately.

A normal sales rep cannot remove it.

When DNC is recorded:

- Account/endpoint is removed from actionable cold lists per suppression scope;
- scheduled generic outreach is canceled where applicable;
- owner history remains for audit;
- future rediscovery does not reset suppression.

---

# 13. AUDIT EVENTS

Minimum events:

- CLAIMED
- CLAIM_FAILED_CONFLICT
- BULK_CLAIM_PARTIAL
- RELEASED
- REASSIGNED
- MANAGER_HOLD_ADDED
- MANAGER_HOLD_REMOVED
- CALLBACK_CREATED
- POSITIVE_REPLY_OWNERSHIP_LOCK
- SUPPRESSED
- UNSUPPRESSION_APPROVED

Store actor, Account, timestamp, previous owner/state, new owner/state, reason.

---

# 14. HARD FAILS

Implementation fails if:

- two reps can simultaneously cold-own same Account;
- changing vertical/campaign creates new ownership;
- CSV/Apollo/Google rediscovery resets ownership;
- release deletes relationship history;
- inactive automation steals active callback/opportunity relationships;
- rep can remove DNC;
- claim conflicts are resolved only in frontend code;
- ownership disappears on server restart.

---

# 15. ACCEPTANCE SCENARIO

1. Brent and Sarah both view ABC Air as unclaimed.
2. Both click Claim within the same second.
3. Brent's atomic claim commits first.
4. Sarah receives `Owned by Brent`.
5. Brent calls, receives callback request for Friday.
6. Account becomes callback-active and is protected.
7. A new Apollo import finds ABC Air again.
8. The same Account remains Brent-owned with Friday callback.
9. No duplicate cold lead is created.