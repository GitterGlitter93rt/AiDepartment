# Your AI Department — Sales Team Access MVP Acceptance Pack

**Status:** Implementation acceptance authority  
**Purpose:** Define the first usable internal product that gives YAD salespeople researched prospects to call and email before autonomous Twilio outbound is enabled.  
**Implementation owner:** Claude Code

---

# 1. MVP BUSINESS GOAL

At least two YAD salespeople can independently log in, receive assigned researched prospects, call/email them through approved human workflows, record outcomes, and share one canonical Account history without duplicate outreach.

This milestone is intentionally before autonomous AI prospect calling.

---

# 2. PREREQUISITES

Before this acceptance begins:

- Market Miner first-market proof has trustworthy inventory;
- Account/Contact identity exists in durable store;
- score/tier engine passes fixtures;
- suppression/DNC state is durable;
- research provenance/freshness exists;
- contact endpoints have source/quality state;
- Account leases/ownership exist;
- Human Assist policies are loaded.

---

# 3. TEST COHORT

Use a deliberately approved cohort such as:

- 25–50 Jacksonville/St. Augustine HVAC prospects;
- primarily Tier A/B;
- researched and deduplicated;
- mix of:
  - phone + email;
  - phone only;
  - email only;
  - decision-maker known/unknown;
  - Google advertiser/LSA and non-ad comparison prospects;
  - at least a few simulated/seeded suppression and follow-up states for UI testing.

No autonomous AI cold calls are part of this test.

---

# 4. TEST USERS

Minimum:

- Sales Rep A
- Sales Rep B
- Sales Manager

Optional during testing:

- Research Ops
- Admin

---

# 5. LOGIN / ACCESS

PASS if:

- reps authenticate through approved internal access;
- Rep A sees assigned/claimable authorized prospects;
- Rep B cannot browse/export unauthorized organization-wide data;
- manager sees team queues;
- no credentials/provider secrets appear in client UI/network responses.

---

# 6. QUEUES

Required rep queues:

- Call Now
- Email Now
- Call + Email
- Follow-Up / Callbacks

PASS if each row shows enough information to decide what to work without opening external research tabs.

Required row data:

- company
- market
- vertical
- tier/score
- advertiser/research status
- contact
- phone/email availability
- primary hypothesis/hook
- owner
- last touch
- eligibility.

---

# 7. PROSPECT CARD

For a random sample of at least 10 cohort Accounts, human reviewer verifies:

- identity is correct;
- phone/email source/quality is visible;
- score/tier matches evidence;
- ad evidence is current/appropriately worded;
- CRM/technology is labeled as a signal rather than backend certainty;
- primary hook is evidence-safe;
- `DO NOT CLAIM` warning catches unsupported claims;
- prior history is visible.

Material error rate must meet Market Miner data-quality gate.

---

# 8. CALL PREP SPEED

Give each rep five unseen prospect cards.

PASS if rep can answer within approximately 60 seconds each:

- who should I ask for?
- why is this company worth contacting?
- what is the first question?
- what should I not claim?

The goal is preparation efficiency, not forced script reading.

---

# 9. ACCOUNT CLAIM / LEASE

Test simultaneous access.

Rep A claims Account X.

PASS if:

- Rep A becomes owner/lessee;
- Rep B sees ownership;
- Rep B cannot initiate ordinary cold workflow on X;
- manager can deliberately reassign;
- reassignment is audited.

Zero duplicate hidden ownership.

---

# 10. CALL DISPOSITION

For simulated or approved human activity, verify one-click outcomes:

- No Answer
- Voicemail
- Gatekeeper
- Wrong Contact
- Wrong Number
- Decision-Maker Reached
- No Pain
- Possible Opportunity
- Qualified Opportunity
- Email Requested
- Callback Requested
- Strategy Call Scheduled
- Disqualified
- DNC

PASS if simple disposition normally takes <15 seconds and required follow-up fields appear only when needed.

---

# 11. CALLBACK

Record prospect-requested callback for a precise future time.

PASS if:

- callback is durable;
- appears in Follow-Up / Callback queue;
- outranks new cold prospects at due time;
- retains Account owner/context;
- generic cadence does not collide with it.

---

# 12. DNC

Rep records explicit DNC.

PASS if within the transactional workflow:

- suppression is durable;
- Account/endpoint disappears from actionable cold queues according to policy scope;
- pending generic email/call action is blocked;
- ordinary rep cannot remove suppression;
- audit entry exists.

Any failure here is a hard fail.

---

# 13. WRONG NUMBER / BOUNCE

Test:

- wrong phone number;
- hard-bounced email.

PASS if endpoint becomes invalid without incorrectly disqualifying the entire company, and remaining legitimate channels may continue according to policy.

---

# 14. DIRECT EMAIL

After simulated phone disposition `Email Requested`:

PASS if:

- system drafts concise topic-specific email;
- draft references actual requested subject/context;
- human review is required in Human Assist MVP;
- generic Smartlead sequence is not started automatically;
- action is logged to shared timeline.

---

# 15. SMARTLEAD EXPORT / SYNC

Create an approved email cohort.

PASS if export includes only fields defined by Smartlead/worklist contract and excludes:

- suppressed contacts;
- bounced/opted-out endpoints;
- clients;
- active opportunities;
- conflicting Smartlead campaigns;
- stale unsafe ad personalization.

Then simulate/ingest:

- positive reply;
- unsubscribe;
- bounce;
- correct-person referral.

Verify canonical Account state updates correctly.

---

# 16. SHARED TIMELINE

Rep A logs voicemail.

Smartlead event logs email.

Manager reassigns Account to Rep B.

PASS if Rep B sees both prior touches and does not receive a “brand new prospect” workflow.

---

# 17. RESEARCH CORRECTION

Rep records:

> Prospect says they no longer use ServiceTitan; switched to Housecall Pro.

PASS if:

- original public signal remains historically auditable;
- new ProspectStatement is stored;
- old signal becomes superseded/contradicted where appropriate;
- Call Pack refresh is queued;
- future rep sees corrected state.

---

# 18. MANAGER ASSIGNMENT

Manager creates:

> Rep A — 20 Jacksonville HVAC Tier A/B Google advertisers

> Rep B — 20 St. Augustine HVAC Tier A/B prospects

PASS if:

- cohorts are explicit;
- no Account is accidentally assigned to both;
- rep queue counts are visible;
- high-value unworked/overdue prospects visible to manager;
- manager can reassign with audit.

---

# 19. EXPORT

Rep exports assigned CALL_SHEET.

PASS if:

- only authorized Accounts appear;
- suppressed rows absent;
- fields match machine contract;
- export audit exists;
- Account IDs allow reconciliation;
- editing exported file does not mutate canonical system state.

---

# 20. MOBILE TEST

On phone-sized viewport, rep must be able to:

- open next prospect;
- see company/contact/hook;
- tap/copy phone;
- copy email;
- disposition;
- schedule callback;
- DNC;
- correct contact.

Critical actions cannot require desktop-only UI.

---

# 21. MANAGER METRICS

Minimum MVP manager funnel:

- assigned
- attempted
- conversations
- decision-makers
- possible/qualified opportunities
- meetings
- callbacks due
- DNC
- research corrections
- unworked Tier A/B
- overdue follow-ups.

Do not rank reps only by dial count.

---

# 22. HARD FAILS

MVP cannot be accepted with any unresolved instance of:

- DNC prospect appearing actionable;
- same Account simultaneously cold-owned by two reps;
- active client in generic cold queue;
- active opportunity in generic cold queue;
- positive Smartlead reply followed by uncoordinated generic cold outreach;
- ordinary rep able to unsuppress DNC;
- unrestricted database export by ordinary rep;
- secrets/raw credentials visible to rep;
- unsupported current-ad claim generated from stale evidence;
- disposition/follow-up lost due non-durable state.

---

# 23. DEFINITION OF DONE

Sales Team Access MVP is done when two reps can work real approved researched inventory for a normal workday without needing a side spreadsheet to coordinate ownership, phone/email eligibility, history, callbacks, or suppression.

They may still use Smartlead and their approved phone/email tools as execution channels, but the YAD Prospect Factory is the relationship and prioritization source of truth.

---

# 24. NEXT GATE

After this MVP is proven:

- improve contact/provider enrichment;
- increase campaign/vertical inventory;
- refine Smartlead automation;
- add deeper manager analytics;
- continue Sales Manual/RAG and conversation QA;
- benchmark realtime voice;
- only later connect eligible prospects to controlled Twilio automation under the separate compliance/voice gates.