# CLAUDE CODE — YAD SALES CRM UI CURRENT

**Status:** Current implementation authority for complete CRM page build  
**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Implementation owner:** Claude Code on EdgeXpert  
**Architecture owner:** ChatGPT

This file exists so Michael does not have to paste page-by-page UI prompts into Claude.

Before beginning or resuming the CRM UI gate:

1. inspect/preserve legitimate local work;
2. fetch latest `origin/feature/outbound-sales-brain`;
3. reconcile safely;
4. do not merge `main`;
5. do not force-push over remote architecture commits.

---

# 1. READ FIRST

Read in this order:

1. `docs/09-software/YAD-SALES-CRM-UI-MOCKUPS-CURRENT.md`
2. `docs/09-software/yad-sales-crm-page-manifest.v1.yaml`
3. `docs/09-software/outbound-sales-brain-rep-portal-visual-system.md`
4. `docs/09-software/outbound-sales-brain-rep-portal-ui-ux-spec.md`
5. `docs/09-software/SALES-TEAM-ACCESS-CURRENT.md`
6. page-specific API/RBAC/ownership/data specs referenced by those documents.

If an older page list is smaller, the complete CRM page inventory in `YAD-SALES-CRM-UI-MOCKUPS-CURRENT.md` is the target information architecture.

Do not throw away already-working portal implementation. Reconcile/refactor it into this design system.

---

# 2. DESIGN TARGET

The application should look like a premium YAD SaaS product:

- dark Midnight Navy left navigation;
- bright Cloud White operational workspace;
- white cards/tables;
- Manrope headings;
- Inter body/data;
- Electric Blue primary actions;
- Signal Cyan accents sparingly;
- clean dense tables without spreadsheet grid clutter;
- premium drawers, cards and status pills;
- excellent desktop experience;
- excellent mobile Account/follow-up workflow.

Do not ship generic Bootstrap/admin-template styling.

Do not make every surface dark.

---

# 3. COMPLETE PAGE SET

Target pages:

1. Sign In
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
13. Sales AI Pilot
14. Call Review
15. Team & Ownership
16. Mining & Research Jobs
17. Research Health
18. Imports & Data Sources
19. Campaigns & Outreach
20. Analytics & Reports
21. Settings & Integrations

Do not create redundant top-level Contact/Task/Evidence pages unless real implementation constraints justify them; those concepts normally live within the canonical Account workspace or drawers.

---

# 4. IMPLEMENTATION WAVES

## Wave A — rep core first

- App shell/navigation
- Sign In
- Overview
- Find Prospects
- My Prospects
- Account Detail
- Follow-Ups

This wave must become genuinely usable before spending large effort on manager analytics.

## Wave B — relationship workflow

- Markets
- Market Detail
- Replies
- Opportunities
- Opportunity Detail
- Meetings

## Wave C — manager / AI operations

- Team & Ownership
- Sales AI Pilot
- Call Review
- Mining
- Research Health
- Imports

## Wave D — orchestration / admin

- Campaigns
- Analytics
- Settings

Continue through waves unless blocked by a real dependency requiring Michael.

---

# 5. BUILD SHARED COMPONENTS

Build reusable primitives before duplicating UI:

- AppShell
- SidebarNav
- TopUtilityBar
- PageHeader
- KpiCard
- StatusPill
- TierBadge
- AdEvidenceBadge
- ContactRouteBadge
- ChannelStatusBadge
- SearchHero
- FilterBar / FilterChip
- ProspectTable
- AccountQuickDrawer
- Timeline / ActivityEvent
- ContactCard
- EvidenceFact
- HypothesisCard
- TaskCard
- ReplyThread
- OpportunityCard
- MeetingCard
- PrepBriefPanel
- CallTranscript
- QaScorePanel
- EmptyState
- LoadingSkeleton
- ErrorState
- ConfirmDialog
- Toast

Prefer a coherent component library over one-off page markup.

---

# 6. SERVER-AUTHORITY RULE

The frontend is never allowed to become the authority for:

- RBAC;
- Account ownership;
- claim success;
- DNC/suppression;
- phone/email eligibility;
- AI-voice eligibility;
- opportunity stage transition;
- booking confirmation;
- manager reassignment.

If the UI shows a button, backend must still independently verify the action.

---

# 7. PAGE COMPLETION REQUIREMENT

Do not report a page complete because static HTML renders.

For each page verify:

- route;
- server-side RBAC;
- real/canonical data path;
- loading state;
- empty state;
- error state;
- desktop layout;
- responsive behavior;
- primary actions;
- audit behavior for sensitive changes;
- direct API bypass cannot defeat permissions;
- no secret/provider internals leak;
- no unsupported fact/status presented as truth;
- no runtime/console errors.

Screenshots are strongly preferred for visual review after each wave.

---

# 8. HERO ACCEPTANCE FLOW

Rep must be able to complete:

`Overview`
-> `Find Prospects`
-> `HVAC + 32256 + Advertisers First + Tier B+ + Unclaimed`
-> inspect result
-> `Claim to Me`
-> see Account in `My Prospects`
-> open `Account Detail`
-> understand why to call + who to ask for
-> log disposition/follow-up
-> see callback in `Follow-Ups`
-> see positive response in `Replies`
-> convert meaningful problem into `Opportunity`
-> see confirmed strategy call in `Meetings`.

Manager must be able to:

- see/reassign ownership;
- inspect Market Miner/research health;
- import prospect sources;
- operate Sales AI Pilot separately;
- review a call;
- view funnel analytics;
- manage integrations without exposing secrets.

---

# 9. DO NOT DO

- do not merge main;
- do not re-enable automatic GitHub Actions;
- do not commit secrets;
- do not rebuild the CRM as a raw admin grid;
- do not create separate databases per page;
- do not create a separate contact truth layer in frontend state;
- do not label main line as direct person phone;
- do not label stale evidence as current;
- do not infer opportunity from positive sentiment;
- do not claim bookings before provider confirmation;
- do not weaken ownership/DNC/channel rules to make the UI easier.

---

# 10. REPORTING

After each wave report:

1. routes/pages completed;
2. shared components created/refactored;
3. API/data connections;
4. RBAC checks;
5. responsive checks;
6. screenshots/manual verification;
7. test results;
8. blockers;
9. exact next wave.

**Core rule:** build a beautiful CRM around the canonical Account and real sales workflow, not a collection of pretty disconnected pages.