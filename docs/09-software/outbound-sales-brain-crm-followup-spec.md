# Your AI Department — Outbound CRM, Outcome & Follow-Up Specification

**Status:** Architecture authority  
**Purpose:** Define how every mined prospect and outreach attempt becomes durable CRM-quality state rather than disappearing into transcripts, spreadsheets, or model memory.

---

# 1. PRINCIPLE

Every outbound attempt ends with a structured outcome.

The system must answer:

- who was contacted;
- what happened;
- what the prospect actually said;
- what business problem was discussed;
- what numbers were provided and by whom;
- what system they use;
- who the decision-maker is;
- what objection occurred;
- what happens next;
- who owns the next action;
- when it is due.

A transcript alone is not a CRM.

---

# 2. CANONICAL SALES STAGES

Use the Sales Manual Module 40 working stages unless later CRM architecture intentionally revises labels.

1. `target_prospect`
2. `contacted`
3. `discovery_qualification`
4. `financial_diagnosis_business_case`
5. `strategy_solution_definition`
6. `proposal_decision`
7. `closed_won`
8. `closed_lost_disqualified`
9. `delivery_handoff`

Stage names in an external CRM may differ; maintain canonical internal mapping.

---

# 3. STAGE ADVANCEMENT RULE

Do not advance because the AI “feels positive.”

## target -> contacted

Requires credible two-way contact or confirmed routing to correct stakeholder depending on company CRM policy.

## contacted -> discovery

Requires meaningful business-process conversation and identified problem/hypothesis worth evaluating.

## discovery -> financial diagnosis

Requires defensible inputs or an explicit plan to obtain missing data, plus meaningful business consequence.

## financial diagnosis -> strategy

Requires a sufficiently defined problem and feasible direction worth solution definition.

## strategy -> proposal

Requires scope/stakeholder/decision process and current approved commercial process.

AI cold caller should rarely jump directly to proposal stage.

---

# 4. CALL DISPOSITION TAXONOMY

Minimum:

- `no_answer`
- `voicemail`
- `gatekeeper_decision_maker_identified`
- `gatekeeper_no_access`
- `wrong_contact`
- `wrong_number`
- `spoke_no_pain`
- `spoke_possible_opportunity`
- `spoke_qualified_opportunity`
- `follow_up_requested`
- `email_requested`
- `strategy_call_scheduled`
- `transferred`
- `disqualified`
- `do_not_contact`
- `technical_failure`

One primary disposition plus secondary reason codes when needed.

---

# 5. DISQUALIFICATION REASONS

Aligned to Sales Manual:

- no_meaningful_pain
- economics_too_small
- no_urgency
- budget_timing
- no_decision_access
- existing_system_sufficient
- built_internally
- technical_infeasibility
- security_compliance_constraint
- no_response_after_policy_limit
- not_yad_fit
- unsafe_scope_requested
- guarantee_required
- do_not_contact
- wrong_business_category

Do not mark “no response” after one missed call.

---

# 6. REQUIRED CALL NOTES

Structured fields:

## Problem

- primary problem discussed;
- exact prospect wording where material;
- confirmed vs suspected.

## Current workflow

- trigger;
- system;
- owner;
- action;
- handoff;
- outcome;
- measurement.

## Numbers

Every number includes:

- value;
- unit;
- source class;
- confidence;
- time period.

Source classes:

- prospect_verified
- prospect_estimate
- system_verified
- public_source
- external_benchmark
- illustrative_assumption
- unknown

## Systems

- named system;
- prospect-confirmed vs public signal;
- relevant workflow.

## Stakeholders

- decision-maker;
- influencer;
- technical stakeholder;
- next person required.

## Objection

- category;
- exact wording summary;
- resolution/status.

## Next step

- action;
- owner;
- date/time;
- dependencies.

---

# 7. PROSPECT STATEMENT EXTRACTION

Post-call brain extracts material prospect statements into separate records.

Examples:

- “We get about 1,200 calls a month.”
- “We switched to Housecall Pro last month.”
- “Our answering service only takes a message.”
- “Call me in September after peak season.”

Preserve source call/timestamp.

Do not turn:

> “A lot of calls”

into

`1200 calls/month`.

---

# 8. RESEARCH CORRECTIONS

If prospect contradicts public research:

Create correction task/record.

Examples:

- CRM changed;
- location closed;
- offer expired;
- no longer advertises;
- owner changed.

Public research remains historical evidence, but current canonical profile updates after validation/prospect statement according to evidence precedence.

---

# 9. FOLLOW-UP TASK TYPES

- human_callback
- requested_callback
- send_email
- send_sms
- technical_integration_review
- data_request
- call_log_review
- strategy_call
- assessment
- proposal_follow_up
- seasonal_follow_up
- nurture
- contact_research
- research_refresh

Every task has:

- owner;
- due time;
- reason;
- source call;
- context;
- status.

---

# 10. REQUESTED CALLBACK OVERRIDES GENERIC CADENCE

If prospect asks:

> Call me September 15.

Create requested callback with:

- exact date/time if given;
- local timezone;
- reason;
- requester.

Do not keep cold-dialing the prospect under normal cadence before that date unless prospect separately requests it.

---

# 11. EMAIL FOLLOW-UP

If prospect requests email:

Content should be generated from:

- problem discussed;
- exact requested topic;
- relevant YAD capability;
- next step.

Default structure:

- short subject;
- one sentence context;
- 2–4 bullets/max or short paragraphs;
- specific CTA;
- no giant capability dump.

Before sending, deterministic action verifies:

- correct recipient;
- policy permission;
- approved sender identity;
- no unsupported claim.

---

# 12. SMS FOLLOW-UP

Use only under approved communication policy.

Typical purposes:

- requested link;
- meeting confirmation;
- approved follow-up;
- missed-call/lead workflow in client systems later.

Sales brain must not assume SMS permission from phone-call permission.

---

# 13. BOOKING

Booking flow stores:

- booking provider;
- event type;
- prospect timezone;
- selected slot;
- provider confirmation ID;
- attendees;
- status.

CRM stage/outcome advances only after provider confirms.

If failure:

- create fallback task;
- do not record scheduled disposition.

---

# 14. OUTBOX PATTERN

External writes can fail.

Use durable outbox for:

- CRM update;
- email;
- SMS;
- calendar/booking synchronization where appropriate;
- analytics/event export.

Each outbox item:

- idempotency key;
- payload;
- destination;
- attempts;
- last error;
- next retry;
- terminal status.

Do not rely on in-memory retry.

---

# 15. CRITICAL ACTION DURABILITY

## DNC

Must be durable synchronously or fail closed.

## CRM notes

Can use outbox retry if primary database captured call outcome.

## Email/SMS

Never retry blindly if provider status is ambiguous; use idempotency/provider message ID to avoid duplicates.

## Booking

Never create duplicate meeting on retry; use idempotent lookup/confirmation.

---

# 16. HUMAN REP NOTES

Human rep may edit/add notes.

Preserve:

- AI-generated initial notes;
- human correction/addition;
- author/time.

Human correction should update canonical understanding without erasing historical model output.

---

# 17. CLOSED-LOST LEARNING

Closed-lost reason is required where practical.

Do not hide disqualifications because they lower conversion metrics.

Useful learning:

- no pain means targeting issue or good diagnosis;
- no decision access means contact-data issue;
- budget/timing means follow-up/fit issue;
- existing system sufficient means no sale was correct;
- technical infeasibility means offer/delivery issue.

---

# 18. DUPLICATE OUTREACH PREVENTION

Before attempt:

- Account not already in active opportunity unless campaign explicitly coordinates;
- Contact/phone not leased/in-flight;
- no duplicate campaign attempt currently running;
- requested callback respected;
- suppression checked;
- merged aliases included in history check.

A new lead source finding the same account does not reset its contact history.

---

# 19. CRM PROVIDER ABSTRACTION

YAD's internal canonical model should not depend on Salesforce/HighLevel/HubSpot/etc.

Adapter operations:

- upsert account;
- upsert contact;
- create/update opportunity;
- append activity;
- create task;
- update stage;
- attach summary/reference;
- resolve external IDs.

Keep mapping configuration outside sales prompt.

---

# 20. V1 INTERNAL CRM POSSIBILITY

The outbound system may initially use its own PostgreSQL data model as the source of truth, then synchronize with a selected external CRM.

Do not block Market Miner because final YAD CRM vendor is unsettled.

The canonical entities in the data-contract spec are sufficient to build internal V1 workflow.

---

# 21. POST-CALL PIPELINE

1. call ends;
2. deterministic provider events finalized;
3. post-call model extracts structured facts/statements/outcome;
4. validator checks schema;
5. DNC already handled synchronously if applicable;
6. write CallOutcome;
7. write ProspectStatements;
8. update Account/Opportunity current read model;
9. create follow-up tasks;
10. enqueue external CRM/actions;
11. run QA review;
12. emit analytics events;
13. research-correction queue if needed.

---

# 22. CRM ACCEPTANCE TESTS

## A — no answer

- disposition correct;
- no fake notes;
- retry according to policy.

## B — gatekeeper identifies GM

- create/update contact/role clue;
- disposition gatekeeper;
- next action targets GM.

## C — prospect supplies numbers

- preserve exact values + source class;
- no conversion to verified system data.

## D — meeting booking succeeds

- disposition scheduled;
- provider confirmation ID;
- CRM stage/next step updated.

## E — booking fails

- not marked scheduled;
- fallback task created.

## F — DNC

- suppression durable before call workflow completes;
- no follow-up tasks except compliance/audit.

## G — research correction

- statement preserved;
- evidence refresh task created;
- old evidence not deleted.
