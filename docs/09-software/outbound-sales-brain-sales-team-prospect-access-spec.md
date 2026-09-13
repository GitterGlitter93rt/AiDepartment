# Your AI Department — Sales Team Prospect Access Specification

**Status:** Architecture authority  
**Purpose:** Turn the Prospect Factory into a practical internal workspace where YAD salespeople can access researched companies to call and email without creating duplicate outreach, losing suppression state, or reverting to spreadsheets as the source of truth.  
**Implementation owner:** Claude Code

---

# 1. PRODUCT OUTCOME

A YAD salesperson should be able to log in and immediately answer:

> Who should I work right now, how should I contact them, why are they worth contacting, who should I ask for, what do we know, and what happened before?

The rep should NOT need:

- a private spreadsheet;
- ten Google tabs;
- a separate Apollo list;
- a disconnected Smartlead list;
- a Slack message asking who owns the prospect;
- manual cross-checking to see whether somebody already called them.

The Prospect Factory remains canonical.

---

# 2. SALES WORKSPACE HOME

Default rep home contains four primary queues:

## CALL NOW

Prospects with:

- callable business/contact number;
- correct/current campaign eligibility;
- no active suppression;
- no conflicting owner/lease;
- enough research for a useful call;
- current local calling window under approved human-sales policy;
- ranked by Ready Queue rules.

## EMAIL NOW

Prospects with:

- verified/usable business email or licensed contact email;
- email campaign eligibility;
- no email suppression/opt-out;
- approved personalization state;
- no conflicting active Smartlead sequence or human opportunity.

## CALL + EMAIL

Prospects eligible for coordinated multichannel outreach.

The UI must show the channel plan so reps do not independently fire both channels without coordination.

## FOLLOW-UP / CALLBACKS

Existing commitments always outrank new cold prospects.

Includes:

- requested callbacks;
- promised emails;
- warm referrals;
- strategy-call follow-up;
- meeting preparation;
- prospect-requested future timing.

---

# 3. REP-FACING PROSPECT ROW

Fast table/list view:

- rank
- company name
- market/city/state
- vertical
- tier / Module 4C score
- advertiser evidence badge
- research freshness
- decision-maker name/title when verified
- business phone
- email availability
- channel eligibility: CALL / EMAIL / BOTH / REVIEW / SUPPRESSED
- primary hypothesis
- last touch
- current owner
- next action

A rep should be able to scan 25 prospects quickly.

---

# 4. PROSPECT DETAIL CARD

Default card shows only decision-useful information.

## Identity

- canonical company
- website
- location(s)
- vertical/context
- account status

## Contact

- target role
- verified/likely contact name
- business/main phone
- direct/business phone if permitted
- business email if permitted
- source/freshness

## Why YAD cares

- Tier + score reasons
- advertiser strength
- confirmed paid search / LSA / Meta evidence
- advertised service/offer
- high-value workflow signals
- primary opportunity hypothesis
- secondary hypothesis

## What to say

- primary hook
- backup hook
- recommended first question
- concise opener
- `DO NOT CLAIM` warnings

## Existing systems

- CRM/field-service/frontend signals
- call tracking
- booking/forms/chat
- attribution/tracking signals

Signals must remain signals, not backend claims.

## History

- prior emails
- prior calls
- prior field visits
- replies
- callbacks
- meetings
- DNC/opt-out
- research corrections

---

# 5. CONTACT QUALITY BADGES

Every contact method gets an explicit status.

## Phone

- VERIFIED_BUSINESS_MAIN
- VERIFIED_BUSINESS_DIRECT
- PROVIDER_BUSINESS_CONTACT
- UNKNOWN_LINE_TYPE
- INVALID
- SUPPRESSED

## Email

- VERIFIED_BUSINESS_EMAIL
- LICENSED_PROVIDER_EMAIL
- ROLE_INBOX
- UNVERIFIED
- BOUNCED
- OPTED_OUT

Never display an unverified endpoint with the same visual confidence as a verified one.

---

# 6. CHANNEL ELIGIBILITY

Channel eligibility is deterministic.

Possible states:

- CALL_ELIGIBLE
- EMAIL_ELIGIBLE
- CALL_AND_EMAIL_ELIGIBLE
- HUMAN_REVIEW_REQUIRED
- FOLLOW_UP_ONLY
- ACTIVE_OPPORTUNITY
- CLIENT_NO_COLD_OUTREACH
- SUPPRESSED

The rep cannot override a hard suppression through the ordinary UI.

---

# 7. OWNERSHIP / CLAIMING

When a rep starts working an Account:

- create lease/ownership record;
- show owner to other reps;
- prevent simultaneous cold outreach;
- lease expires or transfers according to policy;
- requested callback/follow-up creates durable ownership until resolved/reassigned.

Manager may deliberately transfer ownership.

One Account can have multiple contacts, but the Account cannot secretly be cold-worked by several reps in parallel.

---

# 8. QUICK FILTERS

Rep filters:

- assigned to me
- Tier A
- Tier B+
- Google advertisers
- LSA advertisers
- Google + Meta
- current ad evidence
- fresh research
- decision-maker found
- phone available
- email available
- both channels available
- no prior contact
- callback due
- email requested
- market
- vertical
- campaign

Manager filters additionally:

- unassigned
- owner
- stale follow-ups
- no activity X days
- high-score unworked
- research review blocked
- Smartlead active
- missed SLA.

---

# 9. CALL WORKFLOW

Rep selects `Call`.

System:

1. rechecks Account suppression/contact state;
2. rechecks lease;
3. opens compact Call Prep;
4. shows number + source/quality;
5. shows exact first question/hook;
6. logs attempt start when confirmed;
7. after call requires quick disposition.

Initial implementation may simply display/copy number or use approved human click-to-call later.

Human Assist does not depend on autonomous AI calling.

---

# 10. EMAIL WORKFLOW

There are two email paths.

## Direct Human Email

Used when rep has a specific conversation/context.

System generates topic-specific draft from:

- Account research;
- actual conversation;
- requested content;
- current Commercial Truth;
- approved Sales Manual guidance.

Human reviews/sends.

## Smartlead Campaign

Used for approved cold-email sequences.

The Prospect Factory exports only eligible contacts according to Smartlead Sync Spec.

Rep sees:

- Smartlead campaign
- sequence state
- last email
- reply state
- next scheduled touch where available.

Rep should not manually start a conflicting email sequence.

---

# 11. EMAIL PERSONALIZATION VIEW

For cold email, show:

- verified first name or blank
- company
- current advertised service/offer when fresh
- market
- primary hypothesis
- evidence-safe personalized line
- hook family
- CTA variant
- personalization freshness

Example:

> Saw ABC Air is currently showing for emergency AC searches around Jacksonville. Curious what happens when one of those inquiries hits after hours or nobody reaches them on the first attempt.

Forbidden personalization:

> Saw you spend $25k/month on Google and lose 30% of your calls.

unless prospect/company-verified data actually supports it.

---

# 12. QUICK ACTIONS

Rep can:

- Claim Account
- Release Account
- Call
- Draft Email
- Add to approved Smartlead cohort
- Log Call
- Log Email
- Record Gatekeeper Referral
- Correct Contact
- Correct Research
- Request Research Refresh
- Schedule Callback
- Create Follow-Up
- Book Strategy Call
- Mark No Pain
- Disqualify
- DNC / Opt-Out

Manager can additionally:

- assign/reassign
- bulk assign cohort
- create rep queue
- approve export
- resolve selected review items
- pause campaign.

---

# 13. ONE SHARED TIMELINE

Account timeline merges:

- Market Miner discoveries
- research refreshes
- call attempts
- human notes
- Smartlead sends/replies
- direct email
- field visits
- assessment completion
- booking
- strategy meetings
- proposals
- DNC/opt-outs

A rep never has to ask:

> Did anybody already talk to these guys?

---

# 14. EXPORTS FOR REPS

Exports are a convenience/offline feature, not source of truth.

Allowed rep export templates may include:

## CALL SHEET

- company
- contact name/title
- phone
- city/state
- tier
- primary hook
- first question
- last outcome
- Account ID

## EMAIL SHEET

- first name
- last name if verified
- email
- company
- title
- city/state
- vertical
- personalized line
- hook
- Account ID

## COMBINED WORKLIST

Contains both endpoints and channel eligibility.

Export is audited.

DNC/suppressed rows must never appear in ordinary actionable exports.

---

# 15. SMARTLEAD-READY EXPORT

Minimum columns:

- account_id
- contact_id
- first_name
- last_name optional
- email
- company_name
- title
- city
- state
- vertical
- yad_tier
- yad_score
- advertiser_signal
- advertised_service
- primary_hook
- personalized_line
- campaign_id
- source
- rep_owner

Do not send internal notes, transcripts, financial diagnosis, or source payloads to Smartlead.

---

# 16. LIST ASSIGNMENT MODE

Manager may create a work package such as:

> Brent — 50 Jacksonville HVAC Tier A/B advertisers

> Rep 2 — 75 St. Augustine roofing advertisers

> Rep 3 — 100 law-firm contacts for approved email cohort

Assignment stores:

- cohort definition
- rep
- created by
- count
- expiration/review date
- campaign
- channel(s)
- priority.

If an Account later becomes DNC/client/active opportunity, it disappears from cold work automatically.

---

# 17. TEAM ACCESS ROLES

Initial roles:

## SALES_REP

Can:

- view assigned/available approved prospect data;
- claim prospects;
- work call/email queues;
- log outcomes;
- create follow-up;
- submit research corrections.

Cannot:

- change canonical scoring rules;
- edit Commercial Truth;
- unsuppress DNC;
- mass export unrestricted database;
- enable autonomous calling.

## SALES_MANAGER

Adds:

- assign/reassign prospects;
- view team queues;
- approve selected exports;
- campaign performance;
- follow-up aging;
- sales QA/coaching.

## RESEARCH_OPS

Can:

- review identity/contact/evidence issues;
- trigger refresh;
- resolve classification ambiguity;
- not alter sales/compliance truth outside authority.

## ADMIN

Full internal administration subject to privileged-action audit.

---

# 18. ACCESS BOUNDARIES

The rep workspace should not expose:

- API keys
- provider raw payloads unless required for research review
- private model prompts
- credentials
- unnecessary transcript/audio data
- other reps' private/internal commentary unrelated to sales execution
- restricted source fields that cannot be redistributed under provider license.

---

# 19. MOBILE-FIRST REQUIREMENT

Sales reps will use phones/laptops.

Critical mobile actions must be easy:

- see next prospect
- tap phone number
- copy email
- see hook
- disposition
- callback
- DNC
- contact correction.

Do not make the rep pinch/zoom a desktop analytics dashboard in a parking lot.

---

# 20. SPEED TARGETS

Rep workflow goals:

- daily home loads quickly enough to be practical;
- next prospect card opens without multi-second research job;
- call prep should usually be understandable in <60 seconds;
- disposition should usually take <15 seconds for simple outcomes;
- callback creation <20 seconds;
- DNC <10 seconds.

Research happens before the rep opens the card whenever possible.

---

# 21. REP DAILY OPERATING LOOP

`Open Daily Home`
-> `Complete promised callbacks/follow-ups`
-> `Work ranked Call/Email queue`
-> `Claim Account`
-> `Review 20-second card`
-> `Contact`
-> `Disposition`
-> `Next action`
-> `Next prospect`.

The system does the research/coordination work around the rep.

---

# 22. NEAR-TERM IMPLEMENTATION PRIORITY

Because YAD wants salespeople using the Prospect Factory before autonomous voice is ready, Claude should treat this as a high-priority Human Assist milestone after the Market Miner produces trustworthy inventory.

Minimum usable team product:

1. authenticated rep login;
2. manager-created assignments;
3. Call Now / Email Now / Both / Follow-Up queues;
4. prospect detail + evidence;
5. phone/email endpoint quality;
6. ownership/lease;
7. call disposition;
8. direct email draft/copy;
9. Smartlead export/sync path;
10. callback/follow-up;
11. DNC/opt-out;
12. shared Account timeline;
13. simple manager view.

Do not wait for Twilio autonomous outbound to deliver this milestone.

---

# 23. FIRST REAL TEAM ACCEPTANCE

Using an approved non-autonomous prospect cohort, give at least two YAD reps access simultaneously.

Pass when:

- both see their assigned prospects;
- they cannot unknowingly work the same Account simultaneously;
- Call list contains usable business/contact phone endpoints;
- Email list contains eligible email endpoints;
- suppressed Accounts are absent from actionable lists;
- each rep understands why the prospect is ranked;
- each sees the same Account history;
- one rep's disposition/update becomes visible to the other;
- requested callback appears automatically;
- Smartlead reply updates canonical Account state;
- manager can see workload and outcomes;
- exports remain auditable;
- no autonomous Twilio prospect call occurs.

---

# 24. CORE RULE

YAD's reps should receive a **researched work queue**, not a pile of leads.

The Prospect Factory decides what deserves attention; Human Assist gives the team enough context and controls to work it intelligently across phone and email.