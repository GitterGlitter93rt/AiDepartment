# Your AI Department — Human Assist Daily Brief Specification

**Status:** Architecture authority  
**Purpose:** Turn the Prospect Factory into an immediately usable daily sales workflow for Brent and future reps before autonomous prospect calling exists.  
**Implementation owner:** Claude Code

---

# 1. DAILY PRODUCT

Every rep should be able to open one view and answer:

> Who do I call today, in what order, why is each company worth my time, who should I ask for, and what is the first useful question?

The Daily Brief is not a raw lead export.

---

# 2. DAILY BRIEF INPUTS

- rep identity
- assigned campaigns/territories
- requested callbacks due
- follow-ups due
- ready cold prospects
- rep/account leases
- meeting calendar if connected
- suppression/DNC
- research freshness
- campaign priorities
- daily capacity target

---

# 3. DAILY SECTIONS

## A. Commitments First

- requested callbacks
- promised follow-ups
- scheduled human follow-up tasks
- warm gatekeeper referrals

## B. Best New Prospects

Ranked fresh cold prospects from ready-queue comparator.

## C. Needs Light Research Review

Potentially valuable prospects blocked by:

- stale ad evidence
- ambiguous identity
- decision-maker conflict
- missing website

## D. Meetings Today

If calendar integration exists.

## E. End-of-Day Follow-Up

Tasks created from today's activity.

---

# 4. PROSPECT CARD

Minimum rep-facing card:

- rank
- company
- city/market
- vertical/context
- YAD tier + score
- advertiser evidence strength
- research completeness/freshness
- primary target role/name if known
- phone/main contact path
- primary hypothesis
- `why this is relevant`
- primary first question
- backup question
- current systems/signals
- prior relationship state
- do-not-claim warnings
- evidence/source links
- last contact
- required next action

Do not overload the default card with crawler detail.

---

# 5. EXPANDABLE RESEARCH

Rep may expand:

- Google ad observations
- landing-page/service evidence
- website signals
- CRM/technology clues
- leadership/contact sources
- score breakdown
- vertical playbook notes
- historical research changes

Every fact should show provenance.

---

# 6. ONE-CLICK DISPOSITIONS

After call:

- no answer
- voicemail
- gatekeeper
- wrong person
- decision-maker reached
- no pain
- possible opportunity
- qualified opportunity
- email requested
- callback requested
- meeting scheduled
- disqualified
- DNC
- wrong number

Each triggers required fields rather than freeform notes only.

---

# 7. STRUCTURED NOTES

If meaningful conversation, rep captures:

- current workflow
- pain/problem in prospect's words
- systems named
- volume/economic inputs with source class
- objection
- who owns problem
- timing
- next step
- callback/meeting date
- research corrections

AI may assist summarization after transcript/notes, but structured fields remain authoritative.

---

# 8. RESEARCH CORRECTION BUTTONS

Rep should quickly flag:

- wrong ad assumption
- wrong contact
- wrong CRM/system
- website stale
- business closed
- service no longer offered
- wrong vertical
- duplicate Account

Corrections feed prospect memory and learning engine.

---

# 9. WHY-RANKED EXPLANATION

Show plain-language reason:

> **#3 because:** Tier A 13, current LSA + replacement ads, complete research, confirmed sales manager, no prior contact.

or:

> **#1 because:** They explicitly asked for a callback at 10:00 AM today.

This teaches reps how the system thinks and makes ranking auditable.

---

# 10. CALL PREP MODE

When rep clicks `Call`:

Show a compact prep view:

- who to ask for
- 3 confirmed facts max
- primary hypothesis
- opener
- first 3 questions
- common objections
- current CRM/system signal
- prohibited claims
- desired next step

Rep should not need to read a 20-page dossier.

---

# 11. GATEKEEPER MODE

If gatekeeper answers, quick script changes to:

- explain role/process being sought
- ask who owns it
- capture correct person/title
- capture best contact/time if volunteered

Do not show an aggressive owner-only script.

---

# 12. LIVE CORRECTION

If prospect says:

> “We don't use ServiceTitan anymore.”

rep can flag/update quickly.

System creates structured ProspectStatement and marks prior signal historical/superseded where appropriate.

---

# 13. FOLLOW-UP GENERATION

When disposition requires follow-up:

- create task
- owner
- date/time/timezone
- channel
- reason
- relevant notes
- prior promise

Requested callback beats default cadence.

---

# 14. EMAIL REQUEST

If prospect asks for email:

Daily Brief should generate a short draft based on actual topic discussed.

Do not send generic encyclopedia brochure by default.

Human approves/sends in Human Assist mode.

---

# 15. DAILY CAPACITY

Manager config:

- target new prospects/day
- target callbacks/day
- max active follow-ups
- vertical/campaign assignment

System should not dump 500 cards on a rep and call that prioritization.

---

# 16. END-OF-DAY SUMMARY

Per rep:

- calls attempted
- conversations
- decision-makers
- qualified
- meetings
- callbacks created
- DNC
- research corrections
- top objections
- queue remaining
- follow-ups overdue

Use Sales Manual management denominators.

---

# 17. MANAGER VIEW

Manager can inspect:

- leases/in-flight Accounts
- rep queue size
- follow-up aging
- conversion by rep/campaign/hook
- skipped prospects
- research correction rate
- note completeness
- DNC handling

Do not rank reps purely by dial count.

---

# 18. REP FEEDBACK TO BRAIN

Optional structured ratings:

- research useful yes/no
- hook relevant yes/no
- contact target correct yes/no
- missing context category

These feed learning proposals, not automatic prompt mutation.

---

# 19. FIRST HUMAN ASSIST MVP

Must support:

1. login/internal access
2. ranked queue
3. prospect card
4. evidence/score view
5. call-prep compact view
6. account lease
7. disposition
8. structured notes
9. requested callback
10. DNC
11. research correction
12. simple manager funnel

Advanced analytics can wait.

---

# 20. SUCCESS TEST

Give Brent 25 Jacksonville HVAC prospects.

He should be able to:

- understand why each is ranked;
- prep in under ~60 seconds for a cold call;
- know exactly what not to claim;
- capture disposition in seconds;
- never call an Account already being worked by another rep;
- have requested callbacks appear automatically at the correct time.

The product should materially reduce manual Google research while improving relevance.

---

# 21. CORE RULE

Human Assist should make a good salesperson more prepared and consistent, not turn them into a script-reading operator staring at an AI wall of text.
