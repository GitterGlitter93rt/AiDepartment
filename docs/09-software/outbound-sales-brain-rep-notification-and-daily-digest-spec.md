# YAD Sales Brain — Rep Notifications & Daily Digest Specification

**Status:** Product/architecture authority  
**Implementation owner:** Claude Code  
**Purpose:** Surface time-sensitive sales work without turning the portal into a noisy notification machine.

---

# 1. PRINCIPLE

Notifications exist to prevent missed commitments and surface genuinely useful changes.

Do not notify a rep every time a crawler refreshes a website or a provider returns a result.

---

# 2. PRIORITY LEVELS

## P1 — Immediate

Examples:

- positive prospect reply requiring response
- requested callback due now/soon
- warm inbound callback from previously contacted prospect
- meeting reschedule/cancellation requiring action
- manager handoff requiring acknowledgment

## P2 — Same day

Examples:

- callback due later today
- contact research completed on a claimed Account
- manager assigned/reassigned Account
- Smartlead reply classified as interested/needs response

## P3 — Digest only

Examples:

- new inventory available in a saved market
- research refreshed
- newly found decision maker on unclaimed inventory
- market replenishment complete

Provider/debug events are not rep notifications.

---

# 3. IN-APP NOTIFICATION CENTER

Top-bar bell with unread count.

Each item should show:

- Account/company
- event
- time
- next action
- owner

Example:

> ABC Air replied: “Sure, call me tomorrow morning.”  
> Create/confirm callback

Actions should deep-link directly to Account or Follow-Up.

---

# 4. DAILY DIGEST

At the start of a rep's working day, generate a concise dashboard digest:

- callbacks due today
- positive replies awaiting action
- new manager assignments
- claimed Accounts with no first touch
- saved markets with fresh unclaimed inventory
- meetings today

Do not include vanity metrics unless useful.

Example:

**Today**
- 3 callbacks
- 2 positive replies
- 7 claimed prospects not contacted
- 26 new Tier A/B prospects in Jacksonville HVAC
- 1 strategy meeting

---

# 5. MARKET AVAILABILITY ALERTS

Optional rep subscription to Saved Market alerts.

Examples:

> 18 new Tier A/B HVAC advertisers researched in 32256.

> 11 new Roofing prospects with phone + email available in St. Johns.

Frequency should be configurable/digest-first.

Do not alert on every single prospect discovery.

---

# 6. CLAIM CONFLICT / OWNERSHIP

No push notification needed for normal claim conflict.

Inline UI should state:

> Just claimed by Brent.

Manager reassignment of an Account with an active relationship should produce P2 notification to old/new owner as appropriate.

---

# 7. FOLLOW-UP ESCALATION

Requested prospect commitments outrank generic cold activity.

Example:

- callback due in 15 minutes: P1
- callback missed by 30 minutes: P1 overdue
- generic claimed Account untouched for 2 days: P3/digest/manager signal

Do not spam reps repeatedly every few minutes.

---

# 8. EMAIL / SMS / PUSH CHANNELS

V1 can begin with in-app notification + daily digest.

Optional later channels:

- email
- mobile push/PWA
- Slack if approved
- SMS only for very high-value/time-sensitive internal alerts if justified

Channel choice must not expose prospect sensitive information unnecessarily.

---

# 9. DND / WORKING HOURS

Rep can configure working hours/timezone for non-critical notifications.

P1 events should still respect reasonable internal notification policy.

No generic market-inventory alert at 3 a.m.

---

# 10. HARD FAILS

Implementation fails if:

- reps receive crawler/provider noise;
- positive reply can sit unseen without surfacing;
- requested callback is treated like generic queue work;
- notification count includes already resolved events;
- one event generates duplicate notifications across retries;
- notification links open wrong Account due to stale IDs.

---

# 11. ACCEPTANCE EXAMPLE

Brent owns ABC Air.

Smartlead sync receives:

> “Yeah give me a call tomorrow around 10.”

System should:

1. attach reply to ABC Air Account;
2. classify as engaged/positive pending review;
3. surface a P1/P2 notification;
4. create/offer callback workflow;
5. stop contradictory generic cold outreach;
6. include it in next daily digest until resolved.