# YAD SALES CRM — COMPLETE PAGE MOCKUPS & BUILD SPEC

**Status:** Current UI/product authority for the Sales CRM surface  
**Date:** 2026-09-03  
**Surface:** `sales.youraidepartment.ai`  
**Architecture owner:** ChatGPT  
**Implementation owner:** Claude Code on EdgeXpert  
**Business owner:** Michael Chanata

This document defines the complete page architecture, visual mockup intent, page-level data requirements, interaction behavior, empty/loading/error states, and acceptance expectations for the Your AI Department Sales CRM.

It extends, and does not discard, the existing authorities:

- `SALES-TEAM-ACCESS-CURRENT.md`
- `outbound-sales-brain-rep-portal-ui-ux-spec.md`
- `outbound-sales-brain-rep-portal-visual-system.md`
- ownership/RBAC/API/data contracts already in `docs/09-software/`.

If an older portal page list is smaller, this document defines the target complete CRM information architecture. Claude may stage implementation, but should not invent a conflicting page model.

---

# 1. PRODUCT PRINCIPLE

The CRM should feel like a purpose-built YAD sales operating system, not Airtable, Salesforce Classic, a raw admin table, or a developer console.

A rep should be able to answer five questions almost instantly:

1. Where should I prospect?
2. Which businesses are worth my time?
3. Which Accounts am I working?
4. What happened last and what do I do next?
5. Which prospects have turned into real opportunities/meetings?

A manager should additionally be able to answer:

1. Who owns what?
2. Is prospect supply healthy?
3. Are research/contact paths trustworthy?
4. What is converting?
5. Is the AI pilot behaving correctly?

The canonical record is the **Account**. Contacts, endpoints, communications, opportunities, meetings, research, evidence, ownership, DNC and channel history all attach to that shared Account memory.

---

# 2. VISUAL SYSTEM — LOCKED DIRECTION

Use the existing YAD visual system:

- Midnight Navy `#08111F`
- Deep Slate `#111C2E`
- Dark Secondary `#0D1728`
- Electric Blue `#2563EB`
- Electric Blue Hover `#1D4ED8`
- Signal Cyan `#22D3EE`
- Cloud White `#F7F9FC`
- Pure White `#FFFFFF`
- Near Black `#111827`
- Slate Gray `#64748B`
- Dark Muted `#94A3B8`
- Emerald `#10B981`
- Amber `#F59E0B`

Typography:

- headings: Manrope
- body/data: Inter

Composition:

- 232–248px dark left sidebar on desktop
- light Cloud White main workspace
- white cards/tables
- 64px top utility bar where useful
- 14px card radius
- 18px large panel radius
- restrained shadows
- subtle borders
- Electric Blue for primary actions
- blue→cyan gradient only for premium/selected accent surfaces

Desktop design reference viewport: approximately `1440 × 900`.

Do not use a dark theme for every data surface. The CRM should have dark navigation and a bright operational workspace.

---

# 3. GLOBAL APP SHELL

## Desktop

Left sidebar:

**WORK**
- Overview
- Find Prospects
- Markets
- My Prospects
- Follow-Ups
- Replies
- Opportunities
- Meetings

**AI / OPERATIONS** — manager/admin based on RBAC
- Sales AI Pilot
- Mining
- Research Health
- Imports
- Campaigns
- Analytics

**ADMIN**
- Team & Ownership
- Settings

Bottom of sidebar:
- signed-in user
- role
- compact profile menu

Top utility bar:
- global Account search
- quick-add / quick action
- notifications
- current environment/health only where appropriate

Global account search should resolve company, person, phone, email, city and known aliases without exposing raw provider internals.

## Mobile

Prioritize:
- Home
- Find
- My Prospects
- Follow-Ups
- More

Account actions become sticky bottom actions where appropriate.

---

# 4. PAGE INVENTORY

## Authentication

1. Sign In

## Core rep workspace

2. Overview
3. Find Prospects
4. Markets
5. Market Detail
6. My Prospects
7. Account Detail
8. Follow-Ups
9. Replies
10. Opportunities
11. Opportunity Detail
12. Meetings

## AI / manager operations

13. Sales AI Pilot
14. Call Review
15. Team & Ownership
16. Mining & Research Jobs
17. Research Health
18. Imports & Data Sources
19. Campaigns & Outreach
20. Analytics & Reports
21. Settings & Integrations

Contact editing, task editing, evidence detail and ownership history normally use drawers/modals inside Account Detail rather than becoming redundant top-level CRM pages.

---

# 5. PAGE 1 — SIGN IN

**Route:** `/login`  
**Roles:** all

## Visual mockup

Full-height split layout.

Left 45%:
- Midnight Navy background
- YAD logo/mark
- subtle blue/cyan glow
- headline: `Your AI Department Sales Brain`
- supporting line: `Research. Claim. Work. Convert.`

Right 55%:
- centered white login card, max width ~420px
- email
- password
- `Sign In` primary CTA
- small support/security copy

Do not show default framework auth styling.

## States
- invalid credentials inline
- locked/disabled user
- session expired
- loading on submit

## Acceptance
- secure server-side auth
- no role trusted from browser
- successful login lands on role-appropriate Overview

---

# 6. PAGE 2 — OVERVIEW

**Route:** `/`  
**Roles:** rep, manager, admin

## Mockup hierarchy

Header:
- `Good morning, Brent`
- subline: `Here’s what needs your attention today.`
- primary button `Find Prospects`

KPI row, five compact cards:
- My Active Prospects
- New This Week
- Follow-Ups Due
- Positive Replies
- Meetings Booked

Main two-column layout:

Left 65%:
1. **Follow-Ups Due** — time-ordered action list
2. **Recently Claimed** — compact Account rows
3. **Recent Replies** — positive/needs response

Right 35%:
1. **Markets You Work** — 3–5 market cards
2. **This Week** mini chart / activity summary
3. **Quick Actions** — Find Prospects, View My Prospects, Log Follow-Up

Manager variant adds small team metrics but does not turn home into a monitoring wall.

## Interaction
Click Account row -> Account Detail.
Click follow-up -> Account Detail with task context open.

## Empty state
`You don't have active prospects yet.` + `Find Prospects`.

---

# 7. PAGE 3 — FIND PROSPECTS

**Route:** `/find`  
**Roles:** rep, manager, admin

This is the hero workflow.

## Mockup hierarchy

Page title:
`Find Prospects`
Subline:
`Search YAD’s researched inventory or expand a market.`

Large elevated search panel:
- Vertical dropdown
- ZIP / city / market input
- Prospect mode dropdown (`Advertisers First`, `All Qualified`, etc.)
- `Search` primary CTA

Directly below:
filter chips:
- Unclaimed
- Tier A
- Tier B+
- Google Ads
- LSA
- Phone + Email
- Decision Maker Known
- Direct Route
- Researched Today

Right side utility:
- Saved Views
- Advanced Filters

Result summary strip:
`47 researched prospects found` · freshness · inventory coverage note

Operational table columns:
- select
- Company
- Market
- Fit
- Advertising
- Contact Route
- Why It Fits
- Freshness
- Owner
- Action

Sticky bulk bar after selection:
- Claim Selected
- Save View
- manager Assign
- approved outreach action only if eligible

Right quick-view drawer 480–520px:
- identity
- Tier/score
- owner
- best contact path
- why reach out
- primary hypothesis
- suggested first question
- evidence chips
- claim/action
- latest Account activity

## Research More state
If inventory thin/stale:
show non-blocking panel:
`More businesses may be available in 32256.`
Buttons: `Research More`, manager-only `Refresh Market`.

Existing results remain usable while background research runs.

## Hard rules
- no fake percentage progress
- no provider cost leakage
- no duplicate Account creation
- claim server-side/atomic

---

# 8. PAGE 4 — MARKETS

**Route:** `/markets`  
**Roles:** rep, manager, admin

## Mockup

Header:
`Markets`
Subline:
`Pre-researched prospect pools maintained by the Sales Brain.`

Controls:
- search markets
- vertical filter
- geography filter
- status filter

Card grid, 3 across desktop.

Market card:
- market title
- `Jacksonville / Duval · HVAC`
- ACTIVE / REFRESHING / STALE chip
- 186 researched
- 72 unclaimed
- 41 phone + email
- 38 Tier A
- last refresh `2h ago`
- small inventory-health bar
- primary `Browse Prospects`
- secondary `Research More` if permitted

Manager cards may show target floor/current inventory on expansion, not by default.

---

# 9. PAGE 5 — MARKET DETAIL

**Route:** `/markets/:marketId`  
**Roles:** rep, manager, admin

## Mockup

Top:
- back to Markets
- market name/status
- geography + vertical
- `Browse Available Prospects`
- manager `Research More`

KPI row:
- Total Researched
- Unclaimed Ready
- Tier A/B
- Contactable
- Named Decision Makers
- Freshness

Main split:

Left:
- inventory trend / research freshness chart
- current prospect table

Right:
- `Market Intelligence` panel
  - services observed
  - ad channels
  - notable opportunity patterns
  - current research coverage
- `Research Activity` timeline

Manager-only lower panel:
- target inventory
- floor
- replenishment mode
- last job
- provider health references without secrets

---

# 10. PAGE 6 — MY PROSPECTS

**Route:** `/prospects`  
**Roles:** rep, manager, admin

## Mockup

Header:
`My Prospects`
Subline:
`Your active book of business.`

Segment tabs:
- All Active
- New
- Call Ready
- Email Ready
- Callbacks
- Positive Replies
- Opportunity
- Needs Research

Filter bar:
- Tier
- vertical
- geography
- advertiser strength
- contact route
- last touch
- next action

Default table/card hybrid columns:
- Company
- Stage / status
- Why It Fits
- Best Contact
- Last Touch
- Next Action
- Due
- Opportunity value only when legitimately known

Rows should emphasize **next action**, not merely company metadata.

Quick actions:
- Open
- Call / log call when eligible
- Email when eligible
- Schedule follow-up

No private spreadsheet should be needed.

---

# 11. PAGE 7 — ACCOUNT DETAIL

**Route:** `/accounts/:accountId`  
**Roles:** rep, manager, admin

This is the central CRM record.

## Mockup shell

Top identity bar:
- Company name
- website/domain
- city/state
- vertical
- Tier badge `A · 13`
- Account owner
- relationship stage
- advertiser badges

Primary actions right:
- Call / Log Call
- Email
- Schedule Follow-Up
- Claim / ownership action if eligible
- More

Under identity, two-column layout 68/32.

### Main column

**Why YAD Is Calling**
- concise opportunity summary
- primary hypothesis
- backup hypothesis
- suggested first question
- fact vs hypothesis labels

**Contacts & Contact Paths**
Each contact card:
- name / role
- role confidence
- phone/email endpoint
- direct/main/extension classification
- provenance/quality
- action availability
- `Direct not found — ask for [Name/Role]` when appropriate

**Account Timeline**
Unified chronological timeline:
- research
- claims
- calls
- emails
- Smartlead
- replies
- callbacks
- meetings
- opportunity changes
- DNC/ownership events

**Prospect Statements**
Structured important things the prospect actually said, with source call/date.

**Opportunity / Next Step**
If opportunity exists, show current stage and link to Opportunity Detail.

### Right rail

**Fit & Signals**
- Module 4C score breakdown
- advertiser evidence strength
- research completeness
- contactability

**Contact Permission / Channel Status**
Polished business-language statuses:
- Human Call Allowed
- Email Ready
- AI Voice Eligible / Review / Blocked
- DNC

**Research Freshness**
- site last checked
- ads last checked
- contact last checked
- `Refresh Research`

**Account Ownership**
- owner
- claimed at
- manager controls if authorized

## Tabs where density requires
- Overview
- Contacts
- Activity
- Research & Evidence
- Opportunity

Do not bury the primary reason for outreach under raw research logs.

---

# 12. PAGE 8 — FOLLOW-UPS

**Route:** `/follow-ups`  
**Roles:** rep, manager, admin

## Mockup

Header:
`Follow-Ups`
Tabs:
- Due Today
- Upcoming
- Overdue
- Completed

Calendar/day strip at top optionally.

Task list grouped by time:
- 9:30 AM — ABC Air — Requested callback
- 11:00 AM — Smith Roofing — Send proposal-follow-up information

Each task card:
- Account
- contact
- task type
- reason/context
- source interaction
- due time/timezone
- quick action
- complete/reschedule

Right side detail drawer opens without leaving page.

Strong red only for truly overdue/critical; normal due tasks use neutral/amber.

---

# 13. PAGE 9 — REPLIES

**Route:** `/replies`  
**Roles:** rep, manager, admin

## Mockup

Inbox-style two-pane layout.

Left 38%:
- reply list
- filters: Needs Response, Positive, Neutral, Negative, Opt-Out, Assigned to Me
- source badges: Smartlead / direct email / website / callback note

Right 62%:
- conversation/thread
- Account context header
- current owner
- last phone activity
- relevant hypothesis
- suggested next step

Primary actions:
- Reply / draft
- Schedule Call
- Create Follow-Up
- Mark No Need
- DNC/opt-out action where applicable

A positive reply pauses conflicting generic cold sequences against same Account.

---

# 14. PAGE 10 — OPPORTUNITIES

**Route:** `/opportunities`  
**Roles:** rep, manager, admin

## Mockup

Header:
`Opportunities`
View toggle:
- Pipeline
- Table

Pipeline columns should use canonical YAD stages, condensed for usability:
- Discovery
- Financial Diagnosis
- Strategy
- Proposal / Decision
- Closed Won

Cold prospects do not belong in opportunity pipeline before meaningful qualification.

Card:
- Company
- contact
- owner
- problem summary
- next step/date
- meeting status
- value only if legitimate

Manager filter bar:
- owner
- stage
- vertical
- source
- age
- meeting status

Drag/drop may be allowed only if backend validates transitions and audit logging.

---

# 15. PAGE 11 — OPPORTUNITY DETAIL

**Route:** `/opportunities/:opportunityId`  
**Roles:** owner, manager, admin

## Mockup

Top:
- company + opportunity title
- stage
- owner
- source
- next meeting
- `Open Account`

Main 70/30 layout.

Main:
1. Problem / desired outcome
2. Confirmed workflow
3. Business-case inputs
4. Unknowns / data still needed
5. Stakeholders
6. Strategy notes
7. Proposal/decision history
8. activity timeline

Right rail:
- next action
- meeting
- decision process
- confidence/risks
- source attribution

The page should clearly distinguish prospect-provided numbers from illustrative/business-case assumptions.

---

# 16. PAGE 12 — MEETINGS

**Route:** `/meetings`  
**Roles:** rep, manager, admin

## Mockup

Header:
`Meetings`
Tabs:
- Upcoming
- Today
- Completed
- No-Show / Needs Reschedule

Calendar/list toggle.

Meeting row/card:
- time/timezone
- Account
- attendee + role
- host
- meeting type
- Cal Video join button when appropriate
- status
- source campaign
- prep-brief readiness

Click -> meeting detail drawer:
- reason booked
- prospect words
- current workflow
- systems/numbers mentioned
- objections
- what not to assume
- suggested questions
- transcript/source links

For Michael-hosted strategy calls, the prep brief should be the dominant content.

---

# 17. PAGE 13 — SALES AI PILOT

**Route:** `/ai/pilot`  
**Roles:** manager/admin only

## Mockup

Header:
`Sales AI Pilot`
Prominent global state chip:
- OFF
- INTERNAL TEST
- CONTROLLED PILOT

Top right:
- `STOP NEW OUTBOUND CALLS` destructive control

Tabs:
- Candidate Prospects
- Pilot Batch
- Live Calls
- Completed Calls
- Review
- Settings

Candidate table:
- company
- market
- Tier
- advertiser evidence
- target role/person
- contact route
- primary hypothesis
- first question
- freshness
- eligibility
- Add to Pilot

Right preview drawer:
- immutable Call Pack
- opening preview
- facts allowed to state
- hypothesis
- booking config

Live call card:
- company/contact
- duration
- current conversation state
- last prospect intent
- tool status
- latency
- transcript where authorized

Earliest real tests are one call at a time.

---

# 18. PAGE 14 — CALL REVIEW

**Route:** `/calls/:callId`  
**Roles:** manager/admin; rep visibility according to ownership/RBAC

## Mockup

Top:
- Account/contact
- call outcome
- duration
- date
- agent/profile version
- QA score + hard-fail indicator

Main synchronized review area:

Left 60%:
- audio player where permitted
- transcript with speaker separation
- clickable timestamps

Right 40%:
- state timeline
- tool actions/results
- latency metrics
- Call Pack snapshot
- extracted prospect facts
- readiness decision
- disposition

Bottom:
- QA scorecard by category
- root-cause tag
- reviewer notes
- `Keep`, `Retest`, `Needs Script Change`, `Runtime Issue`, etc.

No hidden chain-of-thought is shown.

---

# 19. PAGE 15 — TEAM & OWNERSHIP

**Route:** `/team`  
**Roles:** manager/admin

## Mockup

Header:
`Team & Ownership`

Top team cards:
- rep name
- active prospects
- follow-ups due
- meetings booked
- opportunities
- stale claims

Main table:
- Account
- current owner
- relationship strength
- last activity
- next action
- claimed age
- manager action

Secondary tabs:
- Reassignments
- Territories
- Ownership Audit

Manager can:
- assign
- reassign with reason
- release eligible cold account
- set territory preferences

Never auto-steal callbacks, positive replies, meetings, proposals, opportunities or clients merely because claim is old.

---

# 20. PAGE 16 — MINING & RESEARCH JOBS

**Route:** `/mining`  
**Roles:** manager/admin

## Mockup

Header:
`Mining`
Subline:
`Keep prospect inventory fresh without interrupting reps.`

Top cards:
- Active Jobs
- Queued Markets
- Accounts Added Today
- Accounts Refreshed
- Failed / Needs Review

Job table:
- market
- vertical
- mode
- started
- stage
- accounts found/resolved
- status
- owner/requester

Job detail drawer:
- business-language stages
  - Searching Market
  - Resolving Companies
  - Researching Websites
  - Checking Advertising
  - Resolving Contacts
  - Scoring / Saving
- provider refs only for admin diagnostics
- errors
- retry/cancel if appropriate

Do not expose raw worker queues to ordinary reps.

---

# 21. PAGE 17 — RESEARCH HEALTH

**Route:** `/research-health`  
**Roles:** manager/admin

## Mockup

Header:
`Research Health`

KPI cards:
- Inventory Freshness
- Website Research Success
- Advertiser Evidence Freshness
- Named Decision Maker Resolution
- Direct Route Coverage
- Data Quality Exceptions

Charts:
- freshness distribution
- source success/failure
- contact-quality distribution

Exceptions table:
- stale evidence
- identity conflict
- duplicate candidate
- broken website
- contact disagreement
- provider failure

Click exception -> Account/research detail.

This page diagnoses data quality, not sales performance.

---

# 22. PAGE 18 — IMPORTS & DATA SOURCES

**Route:** `/imports`  
**Roles:** manager/admin

## Mockup

Header:
`Imports & Data Sources`

Primary CTA:
`Import Prospects`

Source cards:
- CSV Upload
- Airtable Export
- Apollo Export
- Prior YAD List
- Other Approved Import

Import wizard:
1. Upload
2. Map columns
3. Preview normalization
4. Dedupe/identity results
5. Suppression/ownership conflicts
6. Confirm import
7. Results

Import history table:
- source
- file/name
- rows
- Accounts created
- Accounts merged
- blocked/suppressed
- imported by
- date

No import ever automatically begins outreach.

---

# 23. PAGE 19 — CAMPAIGNS & OUTREACH

**Route:** `/campaigns`  
**Roles:** manager/admin; rep read access where useful

## Mockup

Header:
`Campaigns`

Campaign cards/table:
- name
- audience/market
- channel
- status
- owner
- Accounts
- sent/attempted
- connected/replied
- meetings
- suppression/negative signal summary

Campaign Detail drawer/page section:
- audience definition
- source inventory
- channel coordination
- content/template version
- cadence configuration reference
- outcomes

Smartlead is shown as an execution provider, not the CRM.

Cross-channel relationship state always wins over a campaign trying to treat someone as new.

---

# 24. PAGE 20 — ANALYTICS & REPORTS

**Route:** `/analytics`  
**Roles:** manager/admin; scoped rep analytics

## Mockup

Header:
`Analytics`

Top filters:
- date range
- rep
- market
- vertical
- source
- channel

Core KPI cards:
- researched Accounts
- claimed Accounts
- decision-makers reached
- meaningful conversations
- qualified opportunities
- meetings booked
- attended qualified meetings
- DNC/negative rate

Funnel:
`Researched -> Contactable -> Attempted -> Connected -> Qualified -> Booked -> Attended -> Opportunity`

Charts:
- by market
- by vertical
- by hook/hypothesis
- by rep
- by channel
- by AI agent/script version for pilot

Never optimize raw dial count or booked count without meeting quality/attendance context.

---

# 25. PAGE 21 — SETTINGS & INTEGRATIONS

**Route:** `/settings`  
**Roles:** admin; some manager subsections

## Mockup

Left settings subnav:
- Organization
- Users & Roles
- Calendar / Cal.com
- Email / Smartlead
- Twilio / Voice
- Research Providers
- CRM / Data
- Notifications
- Security
- Feature Modes

Main panel uses cards/forms, not developer env-variable dump.

Examples:

### Calendar
- Cal.com connection status
- event type
- Michael calendar target
- Cal Video status
- test availability button

### Voice
- Demo Runtime status
- Production Inbound status
- Production Outbound status
- selected inbound mode
- global outbound state

### Research
- provider adapters enabled
- health
- budget/usage controls where authorized

Secrets are never displayed after entry except masked metadata.

Settings writes require server-side RBAC and audit logging.

---

# 26. SHARED COMPONENT LIBRARY CLAUDE SHOULD BUILD

Claude should implement reusable components rather than bespoke markup per page.

Recommended primitives:

- `AppShell`
- `SidebarNav`
- `TopUtilityBar`
- `PageHeader`
- `KpiCard`
- `StatusPill`
- `TierBadge`
- `AdEvidenceBadge`
- `ContactRouteBadge`
- `ChannelStatusBadge`
- `AccountRow`
- `ProspectTable`
- `FilterBar`
- `FilterChip`
- `SearchHero`
- `AccountQuickDrawer`
- `Timeline`
- `ActivityEvent`
- `ContactCard`
- `EvidenceFact`
- `HypothesisCard`
- `TaskCard`
- `ReplyThread`
- `OpportunityCard`
- `MeetingCard`
- `PrepBriefPanel`
- `CallTranscript`
- `QaScorePanel`
- `EmptyState`
- `LoadingSkeleton`
- `ErrorState`
- `ConfirmDialog`
- `Toast`

All components must consume server-authoritative data and permissions.

---

# 27. LOADING / EMPTY / ERROR BEHAVIOR

Every page must define all three.

## Loading
Use structural skeletons matching final layout. Avoid generic full-page spinner for ordinary data load.

## Empty
Explain what the state means and offer the next sensible action.

Examples:
- no prospects -> `Find Prospects`
- no follow-ups -> `You're caught up.`
- no opportunities -> `Qualified opportunities will appear after meaningful discovery.`

## Error
Show business-readable error plus retry. Do not expose stack traces/provider secrets.

Example:
`We couldn't refresh this market. Existing researched prospects are still available.`

---

# 28. RESPONSIVE PRIORITY

Desktop is primary for manager/research-heavy surfaces.

Mobile must be excellent for reps working Accounts.

Mobile priorities:
- Account identity
- best phone/email
- reason to call
- suggested first question
- activity history
- follow-up
- disposition
- claim/ownership

Manager Mining/Research Health/Analytics can become simplified responsive views rather than full desktop-equivalent density.

---

# 29. ACCESSIBILITY / PRODUCT QUALITY

- keyboard reachable controls
- visible focus states
- labels not color-only
- usable contrast
- touch targets approximately 44px where mobile
- table headers semantically correct
- confirmation for destructive/ownership-changing actions
- no important state conveyed only through hover

---

# 30. DATA / PERMISSION RULE

The UI never invents sales truth.

Examples:
- unknown decision-maker stays unknown
- `PUBLIC_OBSERVED_UNVERIFIED` is not rendered as `Verified`
- main business line is not rendered as direct owner mobile
- stale ad evidence is visibly stale
- claim ownership does not imply contact permission
- meeting does not show confirmed until booking provider confirms
- opportunity does not appear merely because prospect was polite

RBAC, ownership, suppression and channel eligibility are server enforced.

---

# 31. BUILD ORDER

Claude should build in this order unless actual implementation dependencies require a small change:

**Wave A — app shell + rep core**
1. Sign In
2. Overview
3. Find Prospects
4. My Prospects
5. Account Detail
6. Follow-Ups

**Wave B — market + relationship workflow**
7. Markets
8. Market Detail
9. Replies
10. Opportunities
11. Opportunity Detail
12. Meetings

**Wave C — manager / AI operations**
13. Team & Ownership
14. Sales AI Pilot
15. Call Review
16. Mining
17. Research Health
18. Imports

**Wave D — orchestration / management**
19. Campaigns
20. Analytics
21. Settings

Do not wait for every manager page before making the rep core usable.

---

# 32. PAGE ACCEPTANCE STANDARD

A page is not complete because it renders.

For each page Claude must verify:

- route and RBAC
- server-authoritative data source
- loading state
- empty state
- error state
- desktop layout
- responsive behavior
- primary actions work
- forbidden action cannot be called through direct API bypass
- audit event for sensitive changes
- no secrets/unsupported claims leak
- visual consistency with YAD tokens
- no console/runtime errors

---

# 33. CORE EXPERIENCE TEST

Brent logs in and can complete this without outside tools:

`Overview`
-> `Find Prospects`
-> search `HVAC + 32256 + Advertisers First + Tier B+ + Unclaimed`
-> inspect result
-> `Claim to Me`
-> Account appears in `My Prospects`
-> open `Account Detail`
-> understand why to call and who to ask for
-> log call/disposition or follow-up
-> callback appears in `Follow-Ups`
-> positive reply appears in `Replies`
-> meaningful problem can become `Opportunity`
-> booked strategy call appears in `Meetings`.

Manager can simultaneously:

- see ownership in Team
- inspect market/research health
- operate the Sales AI Pilot separately
- review a call
- view funnel analytics
- manage integrations without exposing secrets.

That is the target CRM.