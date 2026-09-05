# Your AI Department — Sales Team Access UI Wireframe Specification

**Status:** Product/UI architecture authority  
**Purpose:** Define a fast mobile/desktop internal interface for reps to work researched call/email prospects without exposing backend complexity.  
**Implementation owner:** Claude Code

---

# 1. DESIGN PRINCIPLE

The interface should feel like a prioritized sales workbench, not an analytics dashboard.

Default screen answers:

> What should I do next?

Research detail is expandable.

---

# 2. REP HOME — DESKTOP

Top bar:

- YAD Sales
- current rep
- campaign/territory selector
- search Account
- notifications/tasks

Primary counters:

- Callbacks Due
- Follow-Ups Due
- Call Now
- Email Now
- Meetings Today

Main tabs:

1. **My Day**
2. **Call**
3. **Email**
4. **Both**
5. **Follow-Up**
6. **Accounts**

Do not make rep enter a separate CRM module simply to see history.

---

# 3. MY DAY

Order:

## Due commitments

- requested callback
- promised email
- scheduled follow-up
- warm referral

## Best new prospects

Top ranked fresh prospects.

## Meetings

Today's/next meetings if connected.

## Needs attention

- bounced email
- wrong number needing enrichment
- research correction waiting
- stale personalization

---

# 4. TABLE ROW

Compact columns:

- rank/priority icon
- company
- contact / target role
- city
- Tier
- Ads badge
- Call badge
- Email badge
- primary hook
- last touch
- owner
- action button

Example:

`#1 | Cool Air Pros | Sarah — Ops Mgr | Jacksonville | A 13 | Google+LSA | CALL | EMAIL | After-hours leads | New | Brent | OPEN`

Badges should convey state without requiring text paragraphs.

---

# 5. PROSPECT DRAWER / CARD

Click row opens side drawer on desktop / full card on mobile.

## Header

- company
- website
- city/state
- vertical
- owner
- relationship status

## Contact block

- target role
- contact name/title
- phone + quality badge
- email + quality badge
- alternate contact path if available

Actions:

- CALL
- DRAFT EMAIL
- COPY
- CLAIM/RELEASE

## Why this is ranked

One short explanation:

> Tier A (13). Current Google + LSA evidence for emergency AC; 24/7; two locations; CallRail + ServiceTitan booking signal; no prior YAD contact.

## Primary angle

**Hypothesis:** Paid/after-hours lead handling may be worth investigating.

**Ask first:** “When one of those emergency calls comes in after hours and everybody's tied up, what happens next?”

**Backup:** Estimate follow-up.

## Do not claim

- ad spend unknown
- missed-call rate unknown
- ServiceTitan backend workflow unknown

---

# 6. RESEARCH TAB

Expandable sections:

- Google/Search Ad Observations
- Local Services Ads
- Meta evidence
- Landing page / offer
- Website lead flow
- Forms/chat/booking
- Tracking/analytics signals
- CRM/field-service signals
- Locations/hours
- Decision-maker research
- score breakdown

Each meaningful fact shows:

- source
- observed date
- confidence/freshness

---

# 7. TIMELINE TAB

Unified chronological timeline:

- discovered
- research refreshed
- assigned
- Smartlead send
- phone attempt
- voicemail
- reply
- callback
- meeting
- correction
- DNC
- opportunity stage

Use clear channel icons.

Do not split history across different screens.

---

# 8. CALL PREP MODE

Full-screen distraction-light mode.

Top:

**Cool Air Pros — Jacksonville**

**Ask for:** Sarah / Operations Manager

**Why now:** Current emergency AC advertising + 24/7 + strong phone funnel.

Then:

### 3 confirmed facts

1. Emergency AC ad observed yesterday.
2. Site advertises 24/7 service.
3. Site has ServiceTitan booking signal.

### Primary opener

Short script.

### First three questions

1. first workflow question
2. follow-up question
3. measurement/CRM question

### Do not claim

Three concise warnings.

Bottom sticky actions:

- Call / Copy Number
- No Answer
- Voicemail
- Gatekeeper
- Conversation
- DNC

---

# 9. POST-CALL QUICK DISPOSITION

For simple outcome, use one tap and optional note.

For meaningful conversation, expand structured form:

- who spoke
- role
- pain in prospect words
- current system
- numeric inputs + source
- objection
- timing
- next step
- callback/meeting
- research correction

Voice-to-note may be added later, but final structured fields remain editable/visible.

---

# 10. EMAIL MODE

Show:

- to
- verified name/title
- subject
- short draft
- personalization source
- hook
- freshness

Actions:

- Copy Draft
- Send through approved direct-email integration later
- Add to approved Smartlead cohort

Warning if:

- personalization stale
- email unverified
- another sequence active
- Account has recent phone engagement
- opportunity/client state blocks generic cold email.

---

# 11. MANAGER HOME

Cards:

- due callbacks team-wide
- unworked Tier A/B
- assigned today
- conversations
- qualified opportunities
- meetings
- overdue follow-ups
- DNC
- research corrections

Team table:

- rep
- assigned
- worked
- conversations
- decision-makers
- qualified
- meetings
- callbacks overdue

Do not use raw dial volume as primary leaderboard.

---

# 12. MANAGER ASSIGNMENT BUILDER

Filters:

- market
- vertical
- campaign
- Tier
- advertiser type
- contact availability
- channel eligibility
- no prior contact
- research freshness

Manager chooses:

- rep
- quantity
- call/email/both
- expiration/review date

System previews duplicates/conflicts/suppressed exclusions before saving.

---

# 13. MOBILE REP HOME

Bottom navigation:

- Today
- Call
- Email
- Follow-Up
- Search

Top card shows next due commitment.

Swipe/Next moves through ranked list.

Primary prospect card keeps visible:

- company
- contact
- phone/email
- why ranked
- first question
- Call / Email
- disposition.

Do not require horizontal scrolling tables on phone.

---

# 14. MOBILE CALL FLOW

`Open Next`
-> `See 20-second prep`
-> `Tap number`
-> `Return to app`
-> `Tap disposition`
-> `Add next action`
-> `Next prospect`.

If mobile OS/browser cannot reliably return call result automatically, rep manually dispositions. Do not infer call outcome without evidence.

---

# 15. VISUAL PRIORITY

Strong visual priority for:

1. callback/follow-up due
2. DNC/suppression warnings
3. Account ownership
4. phone/email eligibility
5. first question
6. relationship history
7. score/advertiser context

Less visual priority for:

- raw crawler diagnostics
- provider IDs
- technical JSON
- full Sales Manual excerpts.

---

# 16. EMPTY STATES

Do not show confusing blank screens.

Examples:

**No Call Prospects**
> Your assigned call queue is clear. You have 4 email prospects and 2 callbacks due tomorrow.

**Research Running**
> 37 new HVAC prospects are being researched. Existing ready prospects remain available.

**No Decision-Maker Found**
> Ask for the Operations Manager or person responsible for inbound lead handling.

Unknown is usable when presented correctly.

---

# 17. ERRORS

If action fails:

- do not claim success;
- preserve rep-entered notes locally/server-side safely as designed;
- show explicit retry;
- booking/email/SMS result follows tool-success contract.

DNC write failure is critical and must fail closed for further cold action.

---

# 18. FIRST UI ACCEPTANCE

With 25 seeded/researched Accounts:

- Rep can find next call in <=2 interactions from home;
- prospect card loads useful prep immediately;
- Call Prep understandable in <60 sec;
- simple disposition <15 sec;
- callback <20 sec;
- DNC <10 sec;
- rep can tell verified vs uncertain contact info;
- manager can assign 10 prospects to Rep A and 10 to Rep B without overlap;
- UI is usable on modern phone viewport.

---

# 19. CORE RULE

The rep interface should hide machine complexity while exposing machine reasoning. The salesperson needs the **next action, context, truth boundaries, and shared memory** — not the internals of the crawler.