# Your AI Department — Prospect Memory & Relationship State

**Status:** Architecture authority  
**Purpose:** Make the system remember what YAD has learned about a business across research runs, vertical campaigns, calls, follow-ups, corrections, and future reactivation without confusing stale history with current fact.  
**Implementation owner:** Claude Code

---

# 1. WHY PROSPECT MEMORY MATTERS

Without durable memory, the system will:

- re-research the same company from zero;
- call the same business as though it is new;
- forget a requested callback;
- forget a DNC;
- repeat a question already answered;
- forget the CRM a prospect said they use;
- reuse a public claim after the prospect corrected it;
- fail to recognize the same company in another vertical campaign.

Prospect memory is therefore a core system, not a transcript feature.

---

# 2. MEMORY LAYERS

Keep separate:

## A. Identity Memory

Stable Account/Location/Domain/Phone relationships.

## B. Evidence Memory

Public-source observations with freshness/lifecycle.

## C. Prospect Statement Memory

What a person at the business explicitly told YAD.

## D. Relationship Memory

Attempts, conversations, meetings, owners, callbacks, outcomes.

## E. Policy Memory

Suppression/DNC/contact restrictions.

## F. Strategy Memory

Historical Call Packs, hooks, score snapshots and outcomes.

No layer should overwrite another silently.

---

# 3. PROSPECT STATEMENT OBJECT

`ProspectStatement`

- statement_id
- account_id
- contact_id optional
- call/conversation id
- exact_or_close_quote optional
- normalized_claim_key
- normalized_value
- source_type: prospect_verified | prospect_estimate | gatekeeper | rep_observation
- confidence
- observed_at
- valid_for_scope
- contradicts_evidence_ids[]
- supersedes_statement_ids[]
- sensitivity classification
- retention policy

Examples:

- “We use ServiceTitan.”
- “Our office closes at 6 but answering service picks up after.”
- “We get about 300 calls a week.”
- “Sarah left last month; Jake handles marketing now.”
- “Call me Friday afternoon.”

---

# 4. PUBLIC EVIDENCE VS PROSPECT STATEMENT

If public website shows 24/7 but prospect says:

> “We don't actually have staff answering 24/7; it's an answering service.”

Then:

- public evidence remains historically true: website advertises 24/7;
- prospect statement adds operational clarification;
- future Call Pack should not imply internal 24/7 staffing;
- research correction metric records the distinction.

Do not erase the website evidence.

---

# 5. CONTRADICTION RESOLUTION

Use explicit precedence by claim type.

For internal workflow facts:

1. recent prospect-verified statement
2. system-verified internal/connected data if legitimately available
3. current first-party public evidence
4. licensed/provider data
5. inferred hypothesis

For public marketing claims:

Current first-party public evidence remains authoritative about what the company publicly says, even if prospect explains nuance.

Store both.

---

# 6. REQUESTED CALLBACK MEMORY

A callback request must create durable relationship state:

- requested date/time/daypart
- timezone
- preferred contact
- reason
- who requested
- prior conversation summary
- owner
- policy/cadence override

Generic cadence cannot overwrite a requested callback.

---

# 7. MEETING MEMORY

If a strategy meeting is booked:

- stop cold-outreach cadence;
- preserve booking provider ID;
- meeting date/time;
- attendees;
- booking status;
- source Call Pack/campaign;
- pre-meeting notes;
- outcome after meeting.

If meeting cancels, follow explicit follow-up policy; do not treat Account as untouched cold lead.

---

# 8. CROSS-VERTICAL MEMORY

Same Account discovered in Roofing after prior General Contractor or another campaign:

- reuse Account;
- reuse contact history;
- preserve DNC;
- preserve known CRM/system statements;
- create new vertical assignment/Call Pack only where relevant;
- do not repeat introductory outreach as though YAD has never spoken to them.

---

# 9. MEMORY FOR KNOWN SYSTEMS

Store system knowledge with source:

- public frontend signal
- prospect confirmed
- technical integration verified
- historical only

Example:

`ServiceTitan frontend signal` is weaker than `prospect confirmed ServiceTitan`.

If later prospect says migrated to Housecall Pro:

- ServiceTitan becomes historical/superseded;
- Housecall Pro current prospect-verified;
- old Call Packs remain reproducible.

---

# 10. MEMORY FOR ECONOMIC INPUTS

Economic values are time-sensitive and source-sensitive.

Store:

- amount/value
- unit
- time period
- source
- estimate vs verified
- observed_at
- applicable vertical/service

Do not reuse a 2026 “average RO around $5,000” statement indefinitely in 2028 without refresh.

---

# 11. MEMORY SUMMARIZATION

The live model should not receive the entire relationship history.

Create compact `RelationshipBrief`:

- last meaningful contact
- current relationship stage
- requested next action
- key prospect-verified facts
- known systems
- prior objections
- prior hooks used
- unresolved questions
- DNC/suppression status
- upcoming meeting/callback

Generated from structured records, not only LLM transcript summary.

---

# 12. REPEAT-CONVERSATION RULE

Before a new call, the agent should know:

- have we spoken before?
- who did we speak with?
- what did they tell us?
- what did we promise to send/do?
- why are we calling now?

If yes, opener changes accordingly.

Never use a cold-call opener after a meaningful prior conversation unless context truly requires it.

---

# 13. FORGETTING / EXPIRATION

Some memory should expire or downgrade:

- contact titles
- ad status
- exact volumes
- staffing counts
- offers
- system configuration

Some should be durable:

- historical calls
- DNC/audit records according to policy
- Account identity changes
- booked meeting history
- closed-lost reason
- research corrections

Retention policy governs actual storage duration.

---

# 14. SENSITIVE DATA MINIMIZATION

Do not store unnecessary sensitive facts disclosed casually.

For law/medical/high-risk verticals:

- avoid storing substantive personal client/patient/case details in prospecting memory;
- summarize only business-process relevance;
- apply retention/access policy.

The sales brain needs to know `intake confidentiality concern`, not confidential details of a specific client matter.

---

# 15. MEMORY WRITE AUTHORITY

Not every LLM sentence becomes durable truth.

Structured memory writes should be generated/validated through schema and source label.

Examples:

- prospect says “we use HubSpot” -> create prospect statement;
- model infers “they probably have weak follow-up” -> remains hypothesis, not memory fact;
- rep selects “wrong person, Sarah left” -> contact correction.

---

# 16. MEMORY AUDIT

Admin should see:

- current facts
- source/provenance
- historical values
- corrections
- superseded data
- relationship timeline
- why current Call Pack believes each thing.

---

# 17. ACCEPTANCE TESTS

1. Prospect corrects CRM -> future strategy uses corrected CRM.
2. Prospect requests Friday callback -> no generic Tuesday retry.
3. Same Account appears in Plumbing campaign -> history retained.
4. Named contact leaves -> historical conversation remains tied to old contact; new target created.
5. Website still says 24/7 but prospect clarifies answering service -> both stored, caller language adjusted.
6. Old ad expires -> evidence history remains but current claim blocked.
7. DNC Account rediscovered six months later -> suppression remains.
8. Meeting booked -> cold queue removes Account.
9. No-sale because strong workflow -> future reactivation recognizes prior conclusion instead of repeating same pitch immediately.
10. Prospect volume estimate ages beyond configured TTL -> marked stale, not silently reused.

---

# 18. CORE RULE

The Sales Brain should remember the relationship, but every remembered fact must retain who/what said it, when it was learned, and whether it is still current. Memory is provenance, not mythology.
