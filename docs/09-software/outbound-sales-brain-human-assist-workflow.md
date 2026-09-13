# Your AI Department — Human Assist Sales Operating Workflow

**Status:** Architecture / operating specification  
**Purpose:** Define how Brent or another YAD salesperson uses the Prospect Factory before autonomous voice exists.

---

# 1. WHY HUMAN ASSIST IS A CORE PRODUCT

Market Miner should create immediate value by replacing this manual sequence:

1. find company;
2. Google company;
3. inspect ads;
4. inspect website;
5. guess what to say;
6. call;
7. write notes manually.

with:

> Open ranked queue -> understand why prospect matters -> call with one relevant hook -> log structured outcome -> next prospect.

Human Assist also creates real labeled data for later AI-call optimization.

---

# 2. REP DAILY HOME

Rep sees:

- assigned prospects today;
- requested callbacks due;
- follow-ups due;
- new Tier A prospects;
- new Tier B prospects;
- meetings today;
- unresolved tasks.

Do not lead the rep dashboard with vanity metrics such as total database size.

---

# 3. DAILY PRIORITY ORDER

Recommended:

1. prospect-requested callbacks at promised time;
2. scheduled follow-ups/meetings;
3. fresh Tier A uncontacted prospects;
4. Tier B uncontacted;
5. policy-eligible retry attempts;
6. lower-priority/research-thin only when explicitly assigned.

Never let new cold prospects bury a promised callback.

---

# 4. PROSPECT CARD — 20 SECOND VIEW

Show:

- company
- contact/target role
- city
- tier/score
- primary reason ranked
- confirmed Google/Meta/LSA signal
- advertised service
- primary hook
- backup hook
- first question
- key “do not claim” warning
- last attempt/outcome

A rep should not need to open ten tabs before dialing.

---

# 5. DEEP VIEW

Optional expansion:

- score components
- evidence/source links
- website/CTA map
- CRM/system signals
- locations
- decision-maker research
- offer hypotheses
- Sales Manual objection shortcuts
- previous calls/notes
- current follow-up.

---

# 6. BEFORE CALL

Rep checks:

- company identity
- primary hook
- important unknowns
- prior history
- DNC/suppression indicator

System leases prospect to rep during active work.

Human calling procedures/compliance follow approved company policy.

---

# 7. CALL BUTTON

Potential V1 options:

- display number for rep's normal phone;
- click-to-call through approved human calling system later;
- log start/end manually initially.

Do not require autonomous Twilio to make Human Assist useful.

---

# 8. OPENER DISPLAY

Show recommended opener, but rep should not be forced to read verbatim.

Highlight factual words sourced from research.

Example:

**Fresh fact:** Google sponsored emergency AC + 24/7.

Recommended:

> Hey, this is Brent with Your AI Department. This is a cold call, so I'll be brief. I noticed you guys are advertising around emergency AC in Jacksonville. When one of those calls comes in after hours and everyone's tied up, what happens next?

Do-not-say:

> You guys are spending a fortune on Google and losing calls.

---

# 9. LIVE NOTE CAPTURE

Rep can quickly tap/select:

- decision-maker reached
- system named
- problem category
- estimate/volume provided
- objection
- next step.

Free-form notes remain available.

Do not make rep fill 20 fields while talking.

Post-call structured workflow can finish details.

---

# 10. QUICK OUTCOME BUTTONS

- No Answer
- Voicemail
- Gatekeeper
- Wrong Contact
- Wrong Number
- No Pain
- Possible Opportunity
- Qualified Opportunity
- Email Requested
- Follow-Up Requested
- Strategy Call Scheduled
- Disqualified
- Do Not Contact

DNC is intentionally obvious.

---

# 11. GATEKEEPER FLOW

If gatekeeper identifies stakeholder:

Rep can create/update contact:

- name
- role
- extension/direct line
- best time
- email if supplied.

Outcome:

`gatekeeper_decision_maker_identified`

This is a productive call even without speaking to owner.

---

# 12. PROSPECT CORRECTION

If prospect says research is wrong:

Rep can tap:

`Correct Research`

Examples:

- wrong owner
- CRM changed
- location closed
- offer ended
- no longer 24/7
- ad no longer active.

System preserves old evidence and queues targeted refresh.

---

# 13. NUMBER ENTRY

When prospect gives business inputs:

UI asks source label automatically:

- prospect verified
- prospect estimate

Examples:

`~1,200 calls/month — prospect estimate`

`42 unsold replacement estimates — prospect verified from dashboard` if they state they are looking at current system.

Do not strip uncertainty.

---

# 14. BUSINESS-CASE ASSIST

Rep may open calculator when real pain/numbers exist.

Calculator shows:

- inputs/source
- missing data
- exposure
- illustrative scenario separately.

Do not put giant red “YOU'RE LOSING $X” banner on uncertain scenario.

---

# 15. OBJECTION SHORTCUTS

Buttons/search:

- Has CRM
- Has Receptionist
- Has Answering Service
- Has Marketing Agency
- Uses ChatGPT
- Has IT Company
- Customers Want Humans
- Send Email
- Price
- ROI Guarantee
- Integration
- Too Busy

Click opens concise Sales Manual guidance, not canned manipulative rebuttal.

---

# 16. EMAIL REQUEST

Rep chooses/requested topic.

System drafts concise email based on call.

Rep can review/send through approved email workflow.

Do not auto-send giant marketing deck by default.

---

# 17. STRATEGY CALL

If qualified:

- open current Calendly/booking flow or integrated availability;
- book while prospect is engaged where possible;
- record provider confirmation;
- set CRM outcome/stage.

If booking fails:

- capture preferred time;
- create follow-up;
- do not mark scheduled.

---

# 18. FOLLOW-UP

Rep selects:

- date/time
- owner
- reason
- channel
- context.

Requested callback has priority over generic cadence.

---

# 19. DNC

One click:

- choose scope if needed (number/contact/account depending request)
- save durable suppression
- no follow-up sales task
- audit source/rep/time.

Do not require manager approval to honor DNC.

Removing suppression, if ever allowed by policy, is separate privileged action.

---

# 20. POST-CALL SUMMARY

System/rep sees:

- disposition
- problem
- exact material wording
- systems
- numbers/source
- decision-maker
- objection
- next step
- research corrections.

Rep reviews quickly before moving on.

---

# 21. REP LEARNING

After enough calls, show useful coaching:

- strongest hook families for rep
- qualified conversation rate
- meeting rate
- CRM-note quality
- missed follow-up tasks
- common objections.

Do not gamify only dial volume.

---

# 22. MANAGER ASSIGNMENT

Manager can assign:

- market
- vertical
- prospect batch
- daily prospect count
- follow-up responsibility.

System prevents overlapping active leases/assignments across reps unless deliberate.

---

# 23. FIELD SALES EXTENSION

Same Prospect Factory can later support in-person routes.

For a geographic cluster:

- Tier A/B businesses
- address/map
- public signal
- in-person hook
- prior contact history.

Do not build separate lead database for field sales.

---

# 24. FEEDBACK TO MARKET MINER

Rep dispositions improve research system:

- wrong category -> classification feedback
- wrong decision-maker -> contact feedback
- research wrong -> evidence feedback
- no pain despite high score -> fit calibration data
- strong meeting -> source/hook outcome.

But no automatic canonical score rewrite in V1.

---

# 25. FIRST HUMAN ASSIST ACCEPTANCE

Brent should be able to work a test/approved list and answer:

- Why am I calling this company?
- What do we know?
- What is unknown?
- What should I ask first?
- What should I not claim?
- What happened last time?
- What do I need to do next?

If he still needs to manually research every business from scratch, Market Miner/Human Assist is not done.
