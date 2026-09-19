# CLAUDE CODE — CRM UI LATEST ADDENDUM

**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Purpose:** Reconcile the newest CRM UI architecture added while Claude implementation is already in progress.

This supplements:

- `CLAUDE-CRM-UI-CURRENT.md`
- `YAD-SALES-CRM-UI-MOCKUPS-CURRENT.md`
- `yad-sales-crm-page-manifest.v1.yaml`

Do not discard legitimate working implementation. Preserve/commit local work, fetch latest remote feature branch, then reconcile these contracts into the next correct UI gate.

---

# 1. NEW REQUIRED FILES

Read before the next CRM UI pass:

1. `yad-sales-crm-component-contract.v1.yaml`
2. `yad-sales-crm-page-acceptance-matrix.v1.yaml`
3. `YAD-SALES-CRM-UI-DATA-ACTION-CONTRACT.md`

---

# 2. IMPLEMENTATION EXPECTATION

Do not build 21 pages as 21 unrelated templates.

Build/refactor shared primitives first, especially:

- AppShell
- SidebarNav
- PageHeader
- KPI/status/tier/contact-route badges
- SearchHero + FilterBar
- ProspectTable
- AccountQuickDrawer
- Account Timeline
- ContactCard
- Hypothesis/Evidence cards
- TaskCard
- ReplyThread
- OpportunityCard
- MeetingCard / PrepBrief
- common loading/empty/error/dialog/toast states

Then compose pages from these shared primitives.

---

# 3. READ MODELS

Use purpose-built server read models/projections around canonical Account truth.

Do not let individual pages independently derive ownership, channel status, endpoint directness, opportunity qualification, booking state or DNC.

Core read models are documented in `YAD-SALES-CRM-UI-DATA-ACTION-CONTRACT.md`.

---

# 4. ACTIONS

Sensitive actions remain server-authoritative.

Examples:

- claim/release/reassign
- DNC/opt-out
- phone/email eligibility
- opportunity transition
- booking
- AI pilot preflight/start/stop
- imports
- integration/mode settings

UI capabilities may hide/disable buttons, but backend independently validates every action.

---

# 5. PAGE COMPLETION

Use `yad-sales-crm-page-acceptance-matrix.v1.yaml`.

A page is not done until its route, RBAC, canonical read model, loading, empty, error, desktop/responsive layout and primary actions have been exercised.

For sensitive pages, direct API bypass tests must also prove the browser cannot defeat permissions.

---

# 6. SCREENSHOT / VISUAL REVIEW

After each wave capture desktop screenshots at a consistent viewport and at least one representative mobile rep workflow.

Compare for:

- shared spacing/radius/typography
- sidebar consistency
- primary action hierarchy
- table density
- status semantics
- drawer behavior
- empty/loading/error state quality

Do not mark the wave visually complete if every page uses slightly different cards/tables/buttons.

---

# 7. BUILD ORDER REMAINS

Wave A:
- shell/login
- overview
- find
- my prospects
- account detail
- follow-ups

Wave B:
- markets/detail
- replies
- opportunities/detail
- meetings

Wave C:
- team
- AI pilot/call review
- mining/research health/imports

Wave D:
- campaigns
- analytics
- settings

Existing working routes may be refactored into this order rather than rewritten from scratch.

---

# 8. HERO PROOF

The first strong UX proof remains:

`rep login -> Find Prospects -> HVAC + 32256 + Advertisers First + Tier B+ + Unclaimed -> inspect -> Claim to Me -> My Prospects -> Account Detail -> follow-up -> Follow-Ups`.

The broader relationship proof then adds:

`positive reply -> Replies -> meaningful qualification -> Opportunity -> confirmed Cal.com strategy call -> Meetings`.

Manager proof adds:

`Team/ownership + Market/Research Health + Imports + Sales AI Pilot + Call Review + Analytics + Settings`.

---

# 9. CORE RULE

**Build one coherent YAD sales operating system around canonical Account truth. Pages are views into that system, not separate mini-apps.**
