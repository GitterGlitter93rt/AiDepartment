# YAD Sales Brain — Rep Portal UI / UX Specification

**Status:** Product/design authority  
**Implementation owner:** Claude Code  
**Surface:** `sales.youraidepartment.ai` internal web application  
**Goal:** Fast, sleek, high-trust sales workspace for browsing, claiming, researching, calling, emailing, and following up on YAD prospects.

---

# 1. DESIGN PRINCIPLE

This must not feel like Airtable, a raw CRM grid, an admin database, or a developer dashboard.

It should feel like a modern internal sales product designed around three questions:

1. Where do I want to prospect?
2. Which companies are worth my time?
3. Which of these am I personally working?

The experience should be visually clean, mobile-capable, fast, and information-dense without being noisy.

Use the existing YAD brand/design tokens where available. Do not invent a conflicting visual identity. If the marketing-site tokens are not reusable, Claude should identify and document the existing brand primitives before implementing new UI tokens.

---

# 2. PRIMARY NAVIGATION

Desktop left navigation:

- Overview
- Find Prospects
- Markets
- My Prospects
- Follow-Ups
- Replies
- Opportunities

Manager/admin additions:

- Team
- Mining
- Research Health
- Settings

Bottom/mobile navigation should prioritize:

- Home
- Find
- Mine
- Follow-Up
- More

Do not expose implementation concepts such as queue-worker names, provider task IDs, raw SQL status, or prompt internals to ordinary reps.

---

# 3. OVERVIEW SCREEN

Rep home should be useful but not force a queue.

Top greeting/summary:

> Good morning, Brent

Compact KPI cards:

- My Active Prospects
- New This Week
- Follow-Ups Due
- Positive Replies
- Meetings Booked

Primary CTA:

`Find Prospects`

Secondary CTA:

`View My Prospects`

Below that:

## Recently Claimed

Show 4–8 Accounts.

## Follow-Ups Due

Show time-sensitive callbacks/replies first.

## Markets You Work

Saved market cards with availability counts.

The home screen may recommend opportunities but should not make reps feel they have to work a prescribed queue.

---

# 4. FIND PROSPECTS — HERO WORKFLOW

This is the most important screen.

Top section should feel like a search product.

Large unified search/filter row:

- Industry dropdown
- ZIP / city / market search
- Prospect mode
- Search button

Example:

`HVAC` | `32256` | `Google Advertisers First` | `Search`

Immediately below, use filter chips/pills:

- Unclaimed
- Tier A
- Tier B+
- Google Ads
- LSA
- Phone + Email
- Decision Maker Known
- Researched Today

Advanced Filters opens a side panel rather than cluttering the default view.

---

# 5. SEARCH RESULT LAYOUT

Desktop default: refined data table with sticky header.

Optional card view can exist, especially on mobile.

Recommended columns:

- selection checkbox
- Company
- Market
- Fit
- Advertising
- Contact
- Why It Fits
- Freshness
- Owner
- Action

Example row:

`☐ | ABC Air | Jacksonville | A · 13 | Google + LSA | Phone + Email | 24/7 paid emergency demand | Today | Unclaimed | Claim`

## Fit

Use compact badge:

`A · 13`

Hover/tap explains why.

## Advertising

Use badges only from current evidence:

- Google
- LSA
- Meta

No badge if unknown.

## Contact

Use simple status:

- Phone + Email
- Phone
- Email
- Research Needed

## Why It Fits

One sentence maximum.

Example:

> Google advertiser + emergency service + strong phone/estimate funnel.

## Owner

- Unclaimed
- You
- Brent
- Sarah

## Action

- Claim
- View
- Owned by Brent

---

# 6. BULK ACTION BAR

When one or more rows are selected, show a floating/sticky bulk-action bar.

Actions:

- Claim Selected
- Save View
- Export (permission controlled)
- Add to approved email workflow (permission controlled)

Manager:

- Assign to Rep
- Reassign

Do not scatter bulk actions across the page.

Before a large claim, show:

> Claim 25 prospects to yourself?

with a concise ownership warning.

---

# 7. CLAIM INTERACTION

Claim should feel instantaneous.

On success:

- ownership badge changes to `You`;
- Claim button changes to `Open`;
- subtle success toast;
- Account appears in My Prospects.

Do not navigate away after every claim.

For multi-claim:

> 22 claimed. 3 were already claimed by another rep.

Never fail the entire batch because one row changed ownership.

---

# 8. MARKET SEARCH / RESEARCHING STATE

When inventory already exists:

> 47 researched prospects found

show them immediately.

If coverage is incomplete:

show a lightweight informational panel:

> More businesses may be available in 32256.
> Market Miner has not fully refreshed this ZIP today.

Buttons based on permissions:

- Research More
- Refresh Market

When mining starts:

> Researching 32256 HVAC…

Show progress using business language:

- Searching market
- Resolving companies
- Researching websites
- Checking advertiser evidence
- Enriching contacts

Do not show fake percentage precision unless actual work units support it.

New results may stream/appear progressively.

---

# 9. MARKETS SCREEN

Use modern cards, not a spreadsheet.

Each market card:

### Jacksonville HVAC Advertisers
`Jacksonville / Duval · HVAC`

- 186 researched
- 72 unclaimed
- 41 Phone + Email
- 38 Tier A
- refreshed 2h ago

Status chip:

`ACTIVE`

Primary action:

`Browse Prospects`

Secondary:

`Research More` or manager-only controls.

Manager can see additional operational metadata through an expandable detail area.

---

# 10. MY PROSPECTS

This is the salesperson's book of business.

Top tabs/filter pills:

- All
- New
- Not Contacted
- Call + Email
- Callbacks
- Positive Reply
- Opportunity

Sort:

- Highest Priority
- Recently Claimed
- Follow-Up Due
- Tier
- Advertiser Strength
- City

Each Account shows current relationship state clearly.

Do not make reps manually remember whether they emailed or called someone.

---

# 11. ACCOUNT DETAIL EXPERIENCE

Desktop: slide-over drawer for quick inspection with option to open full Account page.

Mobile: full page.

## Sticky header

- company name
- Tier
- market
- owner
- relationship state

Primary actions:

- Call
- Email
- Copy Phone
- Copy Email
- Add Follow-Up
- Disposition

## Section: Contact

Show best contact first.

Example:

**John Smith**  
Owner  
`john@abcair.com` — verified/provider badge  
`904-555-1234` — business line

Alternate Contacts collapsible.

## Section: Why Reach Out

Large simple summary:

> Currently observed advertising emergency AC in Jacksonville. Public site emphasizes 24/7 response, financing, phone intake and estimate requests.

Below:

**Primary hypothesis**  
After-hours paid lead handling / recovery.

## Section: Suggested Approach

**Opening angle**  
Paid emergency demand handling.

**First question**  
“When one of those emergency calls comes in after hours and everybody is tied up, what happens next?”

**Do not claim**
- monthly ad spend
- missed-call percentage
- ServiceTitan follow-up is broken

## Section: Signals

Use clean icon/badge grid:

- Google Ads observed
- LSA observed
- 24/7
- Financing
- 2 locations
- CallRail signal
- ServiceTitan-related signal

Each can open evidence details.

## Section: Timeline

Chronological shared memory.

---

# 12. FOLLOW-UP UX

One-click disposition menu:

- No Answer
- Voicemail
- Gatekeeper
- Decision Maker Reached
- Send Information
- Callback Requested
- Possible Opportunity
- Meeting Scheduled
- Not a Fit
- Wrong Number
- Do Not Contact

If Callback Requested:

inline date/time picker.

If Wrong Number:

mark endpoint bad and optionally request contact research.

If DNC:

red confirmation dialog that makes permanence clear.

Do not bury DNC inside a generic notes box.

---

# 13. REPLIES SCREEN

For Smartlead/direct-email replies synced into YAD.

Tabs:

- Needs Response
- Positive
- Neutral
- Negative
- Unsubscribe

Show:

- Account
- Contact
- Rep owner
- reply excerpt
- original campaign/hook
- received time
- recommended next action

A positive reply should surface prominently on the owner's Overview and Follow-Ups.

---

# 14. MANAGER TEAM SCREEN

Manager sees people, not just aggregate numbers.

Rep cards:

- active claimed prospects
- uncontacted claimed prospects
- follow-ups overdue
- positive replies
- meetings
- qualified opportunities

Manager can click a rep to see their portfolio.

Important management signal:

`37 claimed prospects with no activity > configured threshold`

This identifies hoarding/stale ownership without auto-stealing valid relationships.

---

# 15. VISUAL DESIGN DIRECTION

Target feel:

- premium SaaS;
- restrained;
- high contrast;
- generous spacing;
- soft surfaces;
- subtle borders/shadows;
- consistent rounded corners;
- sharp typography hierarchy;
- minimal decorative effects;
- no giant gradients purely for decoration;
- no dashboard rainbow of unrelated colors.

Use color semantically:

- Tier / status badges;
- warnings;
- success;
- suppression/DNC;
- advertiser signals.

Do not color every card.

Use existing YAD brand accent for primary actions.

---

# 16. RESPONSIVENESS

Desktop/laptop is the primary research/browse experience.

Mobile must support field use:

- Find by ZIP
- browse results
- claim prospect
- open Account
- tap phone
- copy email
- disposition
- callback
- DNC

On mobile, tables become cards/list rows with the same essential hierarchy.

No horizontal-scroll monster table as the only mobile experience.

---

# 17. SPEED TARGETS

Perceived speed matters more than fancy animation.

Target:

- authenticated shell loads quickly;
- inventory search from database should feel near-instant;
- filters should not trigger unnecessary live research;
- claim response should be immediate after database commit;
- Account drawer should use prefetched/basic data where practical;
- background research updates should not block navigation.

Use skeleton states sparingly and accurately.

---

# 18. EMPTY STATES

Do not show blank tables.

Examples:

## No matching inventory

> No researched Tier B+ HVAC advertisers are currently available in 32084.

Options:

- Broaden filters
- Research This Market

## Nothing claimed

> You haven't claimed any prospects yet.

CTA:

`Find Prospects`

## No usable contact

> We have the company, but not a reliable contact endpoint yet.

CTA:

`Request Contact Research`

---

# 19. ACCESSIBILITY / TRUST

- keyboard-accessible table/actions;
- readable contrast;
- clear confirmation for destructive actions;
- no icon-only critical actions without labels/tooltips;
- visible research timestamp;
- visible source/evidence when a rep needs to verify a claim;
- never visually present `unknown` as `no`.

---

# 20. V1 PAGE SET

Claude should prioritize these pages/components first:

1. Login
2. Overview
3. Find Prospects
4. Markets
5. My Prospects
6. Account Drawer/Page
7. Follow-Ups
8. Manager Team / assignment controls

Replies/Opportunities may initially be lighter if time-constrained, but the information architecture should reserve them.

---

# 21. UI ACCEPTANCE TEST

A rep who has never used the system should be able to:

1. log in;
2. search `HVAC + 32256`;
3. understand the first five results without training;
4. filter to unclaimed Tier B+ advertisers;
5. select three;
6. claim them;
7. open one;
8. find the correct phone/email;
9. understand why the company is relevant;
10. see the suggested first question;
11. record a callback;
12. return to My Prospects and see the relationship state.

Target: the basic workflow should require no spreadsheet and no explanation of backend architecture.