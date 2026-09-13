# YAD Sales Brain — Manager Territory & Team Controls

**Status:** Product/architecture authority  
**Implementation owner:** Claude Code  
**Purpose:** Give sales managers control over who can work which markets without turning the rep portal into a rigid assignment queue.

---

# 1. DESIGN GOAL

Reps should have autonomy to search and claim prospects, while managers retain visibility and guardrails.

Managers should control access and accountability, not micromanage every individual lead.

---

# 2. TERRITORY OBJECT

A Territory is an access/management object that may contain:

- country
- state
- county
- city/place
- ZIP/ZCTA set
- radius/polygon/saved market references
- allowed verticals
- team
- effective start/end
- exclusivity mode

Territory does not duplicate Accounts. It determines who may browse/claim/contact them.

---

# 3. TERRITORY MODES

Suggested modes:

## OPEN_SHARED

Any authorized rep may browse and claim unclaimed Accounts.

## TEAM_SHARED

Only members of assigned team may claim.

## REP_EXCLUSIVE

Only one rep can claim new cold Accounts in the territory.

## MANAGER_ASSIGN_ONLY

Reps can view but manager controls assignment.

## RESEARCH_ONLY

Inventory can be researched but not claimed/contacted.

Use per-market configuration; do not hard-code one company-wide mode.

---

# 4. MANAGER DASHBOARD

Manager should see:

- reps and teams
- active territories
- Saved Markets
- unclaimed inventory
- claimed inventory
- inactive/stale claims
- callbacks overdue
- positive replies needing response
- meetings booked
- qualified opportunities
- DNC/suppression trends
- provider/research health summary

Keep operational sales metrics separate from provider/debug detail.

---

# 5. REP PORTFOLIO VIEW

Manager clicks a rep and sees:

- territories accessible
- active claimed Accounts
- claims with no activity
- callbacks due/overdue
- replies awaiting response
- opportunities
- meetings
- recent dispositions

Manager can filter by market, vertical, stage, date.

---

# 6. BULK ASSIGNMENT

Managers may select Accounts and assign to a rep.

Assignment must obey:

- suppression
- client/active-opportunity conflicts
- current ownership
- territory access

Conflict behavior must be explicit.

Never silently override an active relationship.

---

# 7. TERRITORY CHANGES

When territory changes:

- existing active relationships remain with owner unless manager explicitly reassigns;
- new unclaimed inventory follows new territory rules;
- DNC/suppression is unaffected;
- callbacks/opportunities do not vanish.

A territory change is not a reason to reset Account history.

---

# 8. SAVED MARKET OWNERSHIP

Saved Markets can be associated with:

- company-wide
- team
- one rep

Example:

`Jacksonville HVAC Advertisers` — team shared

`St Augustine No-Website Businesses` — Brent personal saved view

Personal saved view cannot weaken global filters such as suppression.

---

# 9. MANAGER INTERVENTION SIGNALS

Surface exceptions such as:

- high number of claimed Accounts with no activity
- overdue requested callbacks
- positive replies unanswered
- repeated contact endpoint corrections
- unusually high DNC rate by campaign/source
- prospects stuck in same stage beyond threshold

These are management signals, not automatic punishments or AI conclusions.

---

# 10. EXPORT CONTROL

Managers/admin may have broader export rights than reps.

Every export should record:

- actor
- filters
- number of rows
- fields included
- timestamp
- purpose/campaign if applicable

Do not allow unrestricted anonymous export of master database.

---

# 11. ACCESS CONTROL

At minimum:

- SALES_REP
- SALES_MANAGER
- RESEARCH_OPS
- ADMIN

Managers can assign/reassign within scope.

Research Ops may run/refresh mining but should not necessarily control sales ownership.

Admin controls global settings and access.

No sales role can enable autonomous AI outbound.

---

# 12. ACCEPTANCE EXAMPLE

Team Florida Service Sales has access to:

- Duval
- St Johns
- Clay
- HVAC
- Plumbing
- Roofing

Brent searches 32256 HVAC and claims 15 Accounts.

Sarah sees those 15 as `Owned by Brent` and can claim other unclaimed Accounts.

Manager can inspect Brent's portfolio and reassign one stale cold Account, but a Friday callback remains protected unless explicitly handed off.