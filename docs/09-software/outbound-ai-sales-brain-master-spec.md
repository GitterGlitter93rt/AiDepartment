# Your AI Department — Outbound AI Sales Brain Master Architecture Specification

**Status:** Architecture / implementation authority for Claude Code  
**Owner:** Michael Chanata  
**Architect:** ChatGPT  
**Implementation owner:** Claude Code on the EdgeXpert  
**Date:** 2026-09-02  
**Production dialing:** DISABLED until the rollout gates in this document are passed and explicitly approved

---

# 1. MISSION

Build a reusable outbound sales system for Your AI Department that can:

1. accept a business lead;
2. research the company before contact;
3. distinguish verified public facts from hypotheses;
4. score the prospect using the canonical YAD qualification model;
5. retrieve the correct sales doctrine, vertical guidance, hooks, objections, CRM guidance, and evidence boundaries from `docs/07-sales/training-manual/**`;
6. prepare a compact prospect-specific call strategy;
7. enforce suppression, contact-policy, calling-window, attempt-frequency, recording/transcription, and autonomous-calling rules before any call;
8. place and manage an outbound Twilio call;
9. conduct a low-latency, natural, interruptible business conversation;
10. discover the current workflow rather than feature-dump AI;
11. quantify real business pain only from defensible inputs;
12. book, transfer, send relevant follow-up, or disqualify as appropriate;
13. write a structured CRM-quality outcome;
14. grade the call against the YAD Sales Manual;
15. learn which lists, industries, hooks, and conversations create qualified business opportunities.

The system should make a researched cold call feel like a competent business-development representative who understands the prospect's business and has one useful question — not a generic AI robocaller.

---

# 2. SOURCE-OF-TRUTH HIERARCHY

The phone system must not create a second drifting sales doctrine.

For sales behavior and messaging, use:

1. `docs/00-company/launch-decisions.md` for current commercial truth.
2. `docs/00-company/**` for foundational company strategy.
3. `docs/07-sales/training-manual/**` for sales doctrine, prospecting, CRM, hooks, objections, industry playbooks, roleplay, and coaching.
4. This document for the software architecture that operationalizes those sources.
5. Current implementation only after it has been reconciled against the documents above.

The live agent must never rely on an old hard-coded price, offer, CTA, booking provider, promise, case study, benchmark, or capability when a newer authoritative source exists.

---

# 3. DESIGN DOCTRINE

The system must embody these principles:

- Business problem first. Technology second.
- Diagnose before prescribing.
- A cold call earns a business conversation; it does not attempt to close a complex implementation immediately.
- Every outbound attempt has one researched hypothesis.
- Public fact and hypothesis are different data types.
- A visible CRM signal does not prove the backend workflow.
- A tracking pixel does not prove current paid advertising.
- Absence of a detectable technology does not prove the business does not use it.
- Active advertising is a qualification signal, not proof of poor performance.
- Existing employees, receptionists, IT teams, CRMs, and marketing agencies are not automatically competitors to be attacked or replaced.
- Prospect-provided data outranks generic benchmarks for financial diagnosis.
- Never convert theoretical exposure into guaranteed recovery or ROI.
- The system is allowed to conclude that the prospect is not a fit.
- A do-not-contact request overrides sales objectives immediately.
- Deterministic policy controls compliance, suppression, dialing, and sensitive actions. The LLM may not override them.

---

# 4. ONE SYSTEM, MULTIPLE LOGICAL BRAINS

The word "brain" describes logical responsibilities. Do not implement eleven independent LLMs merely because this document names eleven brains.

Use deterministic code wherever rules are deterministic. Use an LLM only where language understanding, synthesis, judgment, or natural conversation materially helps.

## Brain A — Campaign Brain

Responsible for:

- lead import;
- deduplication;
- campaign/vertical/geography assignment;
- research queue priority;
- stale-research detection;
- timezone-aware scheduling;
- attempt limits;
- campaign pause/kill switch;
- approved operating mode.

Mostly deterministic.

## Brain B — Prospect Research Brain

Responsible for public pre-call research across approved sources.

May use Claude for synthesis, but evidence collection and source metadata must be preserved.

## Brain C — Evidence Brain

Normalizes raw research into claim-safe facts with confidence, source, timestamp, and expiration.

Deterministic normalization plus optional AI classification.

## Brain D — Qualification Brain

Applies the canonical YAD prospect-priority model from Module 4C.

Deterministic.

## Brain E — Sales Strategy Brain

Retrieves relevant manual sections and creates:

- problem hypothesis;
- primary hook;
- backup hook;
- opener;
- first diagnostic questions;
- likely objections;
- allowed claims;
- prohibited assumptions;
- target next step.

AI-assisted, constrained by retrieved canonical guidance.

## Brain F — Compliance Brain

Controls whether the system may:

- research only;
- prepare a human rep;
- make a controlled test call;
- make an autonomous call;
- record/transcribe;
- retry;
- suppress.

Deterministic and policy-versioned.

## Brain G — Realtime Conversation Brain

Runs the live call using the compact Call Pack and the conversation state machine in this document.

Low-latency LLM behind a provider abstraction.

## Brain H — Action Brain

Executes deterministic tools:

- book meeting;
- warm transfer;
- send SMS;
- send email;
- create follow-up task;
- update CRM;
- add DNC suppression;
- retrieve approved collateral;
- calculate an illustrative scenario from prospect-supplied inputs.

## Brain I — Post-Call Brain

Produces structured outcome, notes, exact prospect claims, systems named, values supplied, next step, and transcript summary.

## Brain J — QA / Coach Brain

Grades the call against the manual's call scorecard and hard-fail rules.

## Brain K — Learning Brain

Aggregates outcomes by industry, source, public signal, hook, call variant, and rep/agent version. It proposes improvements but does not autonomously rewrite production prompts during V1.

---

# 5. OPERATING MODES

Every campaign and lead must have an explicit operating mode.

## OFF

No research or contact.

## RESEARCH_ONLY

Research and score the company. No contact.

## HUMAN_ASSIST

Research, score, and generate a Call Pack for a human salesperson. No autonomous dialing.

## CONTROLLED_TEST

Autonomous calling only to an explicit allowlist of internal/test numbers. Used for latency, roleplay, voicemail, DNC, transfer, booking, and failure testing.

## AUTONOMOUS_OUTBOUND

Production outbound sales calling. Must remain impossible unless all production gates are green and an explicit production flag is enabled.

## INBOUND_RECEPTIONIST

Shares telephony infrastructure where useful, but uses a completely different prompt, goals, workflow, and policy. Do not reuse the outbound sales prompt as the inbound receptionist prompt or vice versa.

---

# 6. END-TO-END PIPELINE

Canonical flow:

`Lead Source`

→ `Identity / Deduplication`

→ `Compliance Preflight 0`

→ `Research Orchestrator`

→ `Evidence Ledger`

→ `Prospect Research Card`

→ `Canonical Priority Score + Tier`

→ `Sales Manual Retrieval`

→ `Problem Hypothesis + Call Strategy`

→ `Compliance Preflight 1`

→ `Dial Queue`

→ `Twilio`

→ `Human / Voicemail / Failure Classification`

→ `Realtime Conversation State Machine`

→ `Booking / Transfer / Follow-Up / Disqualify / DNC`

→ `Post-Call Structured Outcome`

→ `CRM / Data Store`

→ `QA Score`

→ `Metrics / Learning`

No stage may silently invent data needed by the next stage.

---

# 7. LEAD SOURCES

V1 should support a provider-neutral lead-import contract.

Possible sources:

- Apollo exports;
- manually curated lists;
- Google Business Profile / local-business research;
- advertiser research lists;
- existing YAD prospect spreadsheets;
- referrals;
- CRM exports;
- future inbound assessment leads;
- future purchased/licensed datasets after policy review.

Required minimum lead fields:

- internal lead ID;
- company name;
- phone;
- website/domain if known;
- city/state/country if known;
- industry if known;
- source;
- contact name/title if known;
- source timestamp;
- contact-basis metadata if available.

Never silently merge two businesses merely because names are similar.

Deduplicate using normalized domain, normalized phone, address, and explicit identity logic.

---

# 8. PROSPECT RESEARCH BRAIN

The research brain should answer one question:

> What can we responsibly know before the call that helps us ask a more relevant business question?

It should NOT spend unlimited time building a dossier. The manual's human standard is a fast relevant hypothesis. Automation may do deeper background work because it can run before dialing, but the live agent should receive only the useful result.

## 8.1 Research adapters

Implement adapters so sources can fail independently.

### Business Identity Adapter

Collect/confirm:

- canonical business name;
- domain;
- main phone;
- locations/service areas;
- primary services;
- hours;
- explicit 24/7/emergency language;
- public contact roles.

### Website Crawl Adapter

Crawl only a controlled number of same-domain pages relevant to sales research:

- home;
- contact;
- service pages;
- emergency/after-hours pages;
- locations;
- about/team;
- financing/offers;
- booking/estimate/consultation pages.

Extract:

- CTAs;
- phone emphasis;
- forms;
- chat;
- SMS/text links;
- booking widgets;
- emergency/24-7 claims;
- financing offers;
- specific services promoted;
- locations;
- public staff/decision-maker clues.

Do not submit fake forms, appointments, legal inquiries, patient inquiries, or quote requests.

### Front-End Technology Adapter

Detect visible signals such as:

- Google Tag Manager;
- Google Analytics;
- Meta Pixel;
- Google Ads tags;
- call tracking;
- chat provider;
- form provider;
- scheduling provider;
- marketing automation scripts;
- publicly visible CRM-related forms/widgets.

Technology signals must be classified as FRONTEND SIGNALS unless the backend connection is explicitly verifiable.

### Lead-Flow Mapper

Map the public journey:

`Ad/Search/Referral entry`
→ `Landing page`
→ `Call/Form/Chat/Booking`
→ `Visible acknowledgement or next step`
→ `Unknown backend`

Do not pretend to know what happens after a form submit unless public evidence or prospect confirmation supports it.

### Google Advertising Adapter

Goal: determine whether there is credible CURRENT advertising evidence.

Potential evidence sources:

- sponsored placement observed for relevant high-intent queries;
- Google Ads Transparency Center advertiser/domain evidence;
- other approved public Google advertising evidence.

One search that does not show the company must NOT become `google_ads = false`. It should remain `unknown` unless a source can legitimately establish otherwise.

Capture:

- observed query;
- market/location context;
- service advertised;
- landing URL;
- CTA;
- observed timestamp.

Never infer exact spend from ad position or presence.

### Meta Advertising Adapter

Goal: identify credible active Meta advertising when publicly visible through Meta Ad Library or another approved source.

Capture:

- active/unknown;
- offer/service;
- CTA type;
- destination;
- observed timestamp.

Never infer spend from number of creatives.

### CRM / System Signal Adapter

Search for visible signals of systems such as:

- ServiceTitan;
- Housecall Pro;
- Jobber;
- HubSpot;
- HighLevel / GoHighLevel;
- Salesforce;
- Podium;
- Lawmatics;
- Clio;
- shop-management systems;
- vertical systems listed in the applicable playbook.

The output is `CRM/System signal detected`, not `Their leads definitely go into CRM X` unless the integration is explicitly confirmed.

### Growth / Hiring Adapter

Optional public signals:

- multiple locations;
- recent new location;
- visible hiring;
- expanded service area;
- franchise/multi-branch structure.

Use only as a qualification signal, not proof of financial health.

### Decision-Maker Adapter

Find public roles where legitimately available:

- owner;
- general manager;
- operations manager;
- marketing leader;
- sales manager;
- intake manager;
- office manager;
- practice administrator;
- other vertical-specific role.

Do not scrape prohibited sources or invent contact information.

### Public Web Research / Claude Synthesis Adapter

Claude may perform current web research and synthesize public sources when permitted by the chosen API/tooling.

Its output must still be decomposed into individual Evidence Ledger records. A prose answer from Claude is never itself permission to state every sentence as fact.

---

# 9. EVIDENCE LEDGER — THE MOST IMPORTANT TRUTH LAYER

Every research assertion becomes an evidence record.

Minimum fields:

- `evidence_id`
- `lead_id`
- `category`
- `claim`
- `value`
- `confidence`
- `source_type`
- `source_reference`
- `observed_at`
- `expires_at`
- `can_state_as_fact`
- `notes`

## 9.1 Confidence classes

### CONFIRMED

Direct current public evidence supports the statement.

Call language may say:

> I noticed...

> I saw...

### LIKELY

There is a meaningful signal, but the full fact is not established.

Call language should say:

> I was seeing some signs that...

> It looked like you may be...

or convert the hypothesis into a question.

### UNKNOWN

Do not claim it.

Ask.

## 9.2 Never treat absence as negative proof

Examples:

- No CRM script detected ≠ no CRM.
- No Meta Pixel detected ≠ no Meta ads.
- No sponsored result in one query ≠ no Google ads.
- No booking widget ≠ no appointment process.

Use tri-state values wherever possible: `yes / no-supported-evidence / unknown`, with `unknown` as the normal result for absence of evidence.

## 9.3 Research freshness

Suggested initial TTLs, configurable:

- active ad evidence: 48 hours;
- website CTA/offer: 7 days;
- website technology: 14 days;
- locations/hours: 30 days;
- public decision-maker: 30 days;
- suppression/compliance: evaluate immediately before each attempt.

If the high-value hook depends on stale evidence, refresh it before dialing.

---

# 10. PROSPECT RESEARCH CARD

The automated Prospect Research Card should mirror Module 4C.

Required fields:

- company;
- industry;
- location(s);
- website;
- decision-maker if known;
- Google sponsored-ad signal: Yes / Unknown;
- Google Ads Transparency signal: Yes / Unknown;
- Meta active-ad signal: Yes / Unknown;
- offer/service advertised;
- landing page/CTA;
- emergency/after-hours: Yes / No / Unknown;
- high-ticket economics: Likely / Unknown;
- multiple locations: Yes / No / Unknown;
- growth/hiring: Yes / No / Unknown;
- strong phone dependence: Likely / Unknown;
- visible forms/booking/quote CTA: Yes / No / Unknown;
- CRM/system signals;
- lead-capture signals;
- call-tracking signals;
- primary public facts;
- primary hypothesis;
- primary hook;
- backup hook;
- score;
- tier;
- research freshness.

---

# 11. CANONICAL PRIORITY SCORING

V1 must use the manual's Module 4C point system as the baseline. Do not replace it with an arbitrary 0-100 AI score.

## Paid acquisition

- +4 active Google paid-search/high-intent sponsored advertising signal
- +3 active Meta/Facebook/Instagram advertising signal
- +1 active on more than one paid channel

## Economic value

- +2 high-value customer/job/case/treatment/contract/recurring-account economics
- +2 lead/intake/estimate volume appears operationally important

## Urgency/workflow

- +1 emergency/after-hours/24-7 service model
- +1 appointment/estimate/consultation/intake-heavy buying process
- +1 multiple locations/service territories
- +1 visible growth/hiring/expansion signal
- +1 strong phone dependence
- +1 prominent forms/booking/quote/consultation CTA

## Tiering

- Tier A: 9+ — research first; highest priority
- Tier B: 6–8 — normal outbound priority
- Tier C: 3–5 — possible fit; lower evidence of immediate leverage
- Tier D: 0–2 — deprioritize unless another strong reason exists

Store the raw points and reasons, not only the tier.

Later optimization may create an empirical conversion model, but it must remain a separate learned score so the canonical manual score is auditable.

---

# 12. SALES MANUAL KNOWLEDGE SYSTEM

Do not paste the entire sales manual into every call prompt.

Build a retrieval layer over `docs/07-sales/training-manual/**`.

## 12.1 Indexing

Chunk by semantic heading rather than arbitrary token count where possible.

Attach metadata:

- source path;
- module number;
- module title;
- heading;
- vertical;
- stage: prospecting/discovery/ROI/objection/closing;
- hook family;
- objection type;
- system/CRM topic;
- evidence/claim status where applicable;
- version/hash.

Use hybrid retrieval:

- lexical/keyword matching;
- embeddings/semantic matching.

## 12.2 Pre-call retrieval

Retrieve only what is relevant to the Call Pack:

- cold-call doctrine;
- vertical playbook;
- primary/backup hook family;
- likely objection responses;
- CRM/system positioning;
- current next-step/booking guidance;
- approved evidence cards if genuinely relevant.

## 12.3 Live retrieval

The live model may request a small additional retrieval when the prospect introduces a new objection or topic.

Examples:

- “We already use ChatGPT.”
- “We have ServiceTitan.”
- “Can you integrate with X?”
- “We have an agency.”

Live retrieval must have a short timeout and a safe fallback. Never create 3–5 seconds of dead air waiting on RAG.

## 12.4 Knowledge snapshots

Every call should record the manual index version/hash used so later QA can determine what guidance was available at the time.

---

# 13. STRATEGY BRAIN

Input:

- Prospect Research Card;
- score/tier;
- evidence ledger;
- industry playbook;
- campaign objective;
- retrieved manual guidance.

Output: `Call Pack`.

## 13.1 Problem hypothesis formula

Use the manual's logic:

`BUSINESS MODEL + VISIBLE WORKFLOW + LIKELY LEAK = PROSPECTING HYPOTHESIS`

A hypothesis is a reason to ask a question — not permission to assert a problem.

## 13.2 Hook-family ranking

Rank at least:

1. Paid-lead protection / marketing efficiency
2. Speed to lead
3. Missed calls / after-hours
4. Follow-up consistency
5. Unsold estimates/proposals
6. CRM workflow
7. Attribution
8. Employee capacity
9. Reporting visibility
10. Reactivation
11. No-show / appointment recovery
12. Growth/scalability
13. System integration

## 13.3 Example hook rules

- Confirmed Google ads + emergency service + phone-heavy business → paid-call/after-hours hook.
- Confirmed Meta lead ads + form/consultation funnel → speed-to-lead and follow-up hook.
- High-ticket estimate business + estimate CTA → unsold-estimate hook.
- Visible CRM signal → ask what happens automatically after a lead enters; do not pitch CRM replacement.
- Multiple locations → routing/attribution/visibility hook.
- Hiring/growth signal → capacity/scalability hook.
- No ad evidence but strong phone dependence → missed-call/process hook.
- No strong public signal → generic-but-specific workflow question based on vertical; do not fabricate relevance.

## 13.4 Call Pack

The realtime agent should receive a compact object containing:

- identity and role target;
- industry;
- tier and score reasons;
- top 3 confirmed facts;
- top 2 hypotheses;
- primary hook;
- backup hook;
- recommended honest opener;
- first 3 diagnostic questions;
- likely objections and concise guidance;
- known/possible systems;
- advertised offer/CTA if confirmed;
- prohibited claims;
- current objective;
- available tools;
- compliance result;
- manual snapshot/version.

Do not send raw crawler HTML or an entire 40-module manual to the realtime model.

---

# 14. OPENING BEHAVIOR

Default doctrine follows Module 4A:

1. identify Your AI Department;
2. do not fake familiarity;
3. be honest that it is an unexpected/cold contact where appropriate;
4. explain relevance in one short phrase;
5. ask one operational question.

Preferred pattern:

> Hey [Name], this is [Agent] with Your AI Department. This is a cold call, so I’ll be brief. I had a quick question about how you handle [specific workflow].

If current ad evidence is confirmed:

> I noticed you’re actively promoting [service/offer]. When one of those new inquiries comes in and nobody can respond immediately, what happens next?

Do not say:

- “You guys spend a fortune on Google.”
- “You’re losing thousands from missed calls.”
- “I know you don’t have a CRM.”
- “Your agency is wasting your money.”
- “We can save you X%.”

unless the prospect has supplied or verified the relevant facts.

---

# 15. REALTIME CONVERSATION STATE MACHINE

The live model is conversational, but the orchestration layer should track explicit state.

## CONNECTING

No sales behavior yet.

## ANSWER_CLASSIFICATION

Possible paths:

- human;
- voicemail/machine;
- carrier/failure;
- ambiguous.

## OPENING

Identity + relevance + one question.

## ROLE_CHECK

Determine whether this is:

- decision-maker;
- gatekeeper;
- wrong department;
- wrong number.

## GATEKEEPER

Goal: identify correct role/contact path without deception.

Never lie about a referral or pretend to be an existing customer.

## HOOK

Ask the selected operational question.

## LISTEN

Do not rush into a pitch.

## DISCOVERY

Capture current process.

## PROBE

Understand:

- frequency;
- owner;
- system;
- failure point;
- what happens next;
- whether measured.

## QUANTIFY

Only if meaningful pain exists.

Capture prospect-provided or verified values with source labels.

## POSITION

Explain YAD in business language and connect only to the confirmed problem.

## NEXT_STEP

Choose:

- book discovery/strategy conversation;
- warm transfer;
- send targeted email/SMS;
- schedule human follow-up;
- nurture;
- disqualify.

## CLOSE

Confirm next action and end efficiently.

## POST_CALL

No longer a live voice state. Generate structured outcome and QA.

---

# 16. REQUIRED BRANCH STATES

The conversation engine must have explicit handling for:

## Prospect is busy

Use one short relevance question. If a real issue appears, book a better time. Do not trap them on the phone.

## “Send me an email”

Ask which topic is actually relevant so the email is specific. Send short follow-up, not a giant generic brochure.

## “We already use ChatGPT”

Distinguish tool access from repeatable business workflows.

## “We already have a receptionist”

Do not attack the employee. Explore overflow, after-hours, repetitive intake, scheduling, follow-up, and capacity.

## “We already have a CRM”

Treat this positively. Ask what happens automatically after a lead enters and whether phone/web/attribution/follow-up are connected.

## “We have an IT company”

Do not position YAD as automatically replacing IT.

## “We have a marketing agency”

Do not attack the agency. Explore the entire chain from acquisition to lead response to sale/revenue.

## Prospect asks price immediately

Do not invent a custom implementation price. Use only current approved fixed offers if applicable; otherwise explain that scope depends on the workflow and the first step is diagnosis.

## Prospect asks about an integration

If not verified:

> We’d need to verify that specific integration before I promise it.

Create a technical follow-up task if appropriate.

## Prospect wants guaranteed ROI

Do not guarantee. Separate illustrative exposure, recoverable opportunity, and actual measured ROI.

## No meaningful pain

Disqualify professionally.

## Explicit DNC / stop calling

Acknowledge once, write suppression synchronously, end call. Sales logic may not continue after the suppression request.

## Hostile / abusive / unsafe request

End professionally rather than escalating.

---

# 17. FINANCIAL DIAGNOSIS DATA DISCIPLINE

Every numeric field must carry a source class:

- `prospect_verified`
- `prospect_estimate`
- `system_verified`
- `public_source`
- `external_benchmark`
- `illustrative_assumption`
- `unknown`

The agent may perform arithmetic on legitimate inputs, but must label scenarios correctly.

Example:

If prospect says:

- 500 calls/month;
- about 10% missed;
- $900 average customer;
- legitimate-new-business share unknown;

then the system must NOT say:

> You are losing $45,000 per month.

It should mark the missing legitimate-opportunity and close-rate inputs and, if useful, create clearly labeled scenarios.

---

# 18. REALTIME VOICE UX REQUIREMENTS

The user experience must avoid the failures already observed in generic receptionist testing: long dead air, slow robotic replies, repetition, failure to act in the current interaction, and unnatural number reading.

## 18.1 Latency targets

Targets for controlled testing:

- first greeting after usable human-answer signal: target < 1.0 second;
- median conversational first-audio response: target < 1.0 second;
- p95 conversational first-audio response: target < 1.5 seconds;
- hard-fail review when repeated turns exceed 2.0 seconds without a deliberate reason;
- barge-in/interrupt speech stop: target < 300 ms after interruption detection.

These are product targets. Claude must measure actual end-to-end latency rather than assuming model latency equals caller experience.

## 18.2 Streaming

Use streaming at every possible layer:

- STT partials where useful;
- LLM streaming;
- TTS incremental delivery.

Do not wait for a full multi-sentence LLM response before beginning speech.

## 18.3 Turn length

Normal response:

- 1–2 short sentences;
- one question at a time;
- avoid lists unless the prospect asks;
- no 30–60 second monologues.

## 18.4 Barge-in

The prospect must be able to interrupt naturally. The agent stops, discards stale generated speech, and answers the new utterance.

## 18.5 Repetition control

Maintain semantic memory of the previous agent turns. Do not repeat the same promise, booking line, or explanation unless clarification is requested.

## 18.6 Phone-number verbalization

For U.S. phone numbers, verbalize naturally in human groups, e.g. area code, three digits, four digits, and pronounce zero as “oh” where natural. Do not machine-gun digits or speak unnatural four-digit chunks.

## 18.7 Action now, not unnecessary callback

If the system can book, transfer, send the link, answer the business-process question, or capture the next step now, do it now. Do not default to “call back later” merely because a scripted path expected a future interaction.

---

# 19. MODEL ARCHITECTURE

## Slow brain / pre-call

Claude is a strong fit for:

- web research synthesis;
- evidence classification assistance;
- business-model understanding;
- sales-manual retrieval synthesis;
- Call Pack generation;
- post-call QA/coaching.

## Fast brain / live call

Use a provider abstraction and benchmark the lowest-latency model that can reliably follow the YAD conversation rules.

Do not hard-code “Claude must always be the realtime model” if another approved model materially outperforms it on voice latency and tool reliability.

The realtime model should never perform a long web research job during a call. Research happens before the call.

---

# 20. ACTION TOOL CONTRACTS

Tools are deterministic server actions. The LLM requests them; code validates and executes them.

Minimum V1 tools:

## `add_do_not_contact`

Synchronous and highest priority.

Inputs:

- lead/contact ID;
- phone;
- reason;
- call ID.

## `book_strategy_call`

Provider-neutral adapter. Do not hard-code a scheduling platform in conversation logic.

## `warm_transfer`

Transfer only to configured approved destinations and within availability rules.

## `send_sms`

Send only approved content to a permissible destination under policy.

## `send_email`

Send a concise topic-specific follow-up.

## `create_human_followup`

Create owner, date/time, reason, and notes.

## `crm_update`

Write stage/outcome/notes/next action.

## `retrieve_manual_guidance`

Small live retrieval for new objection/topic.

## `calculate_business_case`

Arithmetic only on explicitly labeled inputs. Output must preserve source labels and assumptions.

## `end_call`

Allows orchestration to terminate cleanly after DNC, disqualification, transfer, or completion.

---

# 21. VOICEMAIL

Voicemail must be short.

Recommended structure:

- name/company;
- one specific workflow question;
- callback number if appropriate;
- no long pitch.

The system should log voicemail separately from a live conversation and follow campaign retry policy.

---

# 22. CALL OUTCOME SCHEMA

Minimum disposition values should map to the Sales Manual:

- no answer;
- voicemail;
- gatekeeper — decision-maker identified;
- wrong contact;
- wrong number;
- spoke — no meaningful pain;
- spoke — possible opportunity;
- follow-up requested;
- email requested;
- discovery/strategy conversation scheduled;
- transferred;
- disqualified;
- do not contact;
- failed/technical.

Minimum structured notes:

- problem discussed;
- prospect's exact wording for material claims;
- current workflow;
- frequency/volume;
- monetary inputs + source type;
- decision-maker/stakeholders;
- timing/urgency;
- current systems named;
- objection(s);
- primary hook used;
- public research corrected by prospect;
- next action;
- next-action date;
- agent/prompt/manual version;
- latency/technical metrics.

Never store insulting editorial notes about the prospect or employees.

---

# 23. CRM / DATA ARCHITECTURE

The phone brain needs an internal source of truth even if YAD later chooses a commercial CRM.

Recommended conceptual entities:

## Account

Business identity.

## Contact

Person/role/phone/email and communication permissions.

## LeadSource

Apollo, advertiser search, referral, etc.

## ResearchRun

One research execution with timestamp/version.

## Evidence

Atomic claim-safe evidence records.

## ProspectScore

Canonical Module 4C score and tier plus reasons.

## CallPack

The exact strategy snapshot supplied to the live agent.

## ComplianceDecision

Decision, policy version, reason, timestamp.

## Call

Twilio/provider IDs, timing, disposition, mode.

## CallEvent

Answer classification, turn, interruption, tool call, transfer, DNC, error, etc.

## ProspectStatement

Important prospect-supplied fact with source timestamp.

## Opportunity

Problem, workflow, economics, stage, owner, next step.

## Suppression

Phone/contact/business suppression with reason and date.

## FollowUpTask

Owner, due date, channel, reason.

## QAReview

Call scorecard and hard fails.

## ExperimentAssignment

Hook/prompt/voice/test variant used for valid analysis.

## KnowledgeSnapshot

Sales-manual version/hash.

---

# 24. COMPLIANCE / POLICY ENGINE

This is architecture, not legal advice. Production rules must be reviewed and encoded based on applicable law, carrier/provider rules, jurisdiction, line type, contact basis, recording/transcription requirements, and company policy.

The system must not let the LLM decide whether a call is legal/permitted.

## Inputs

- destination country/state/jurisdiction;
- business vs personal context where determinable;
- line type;
- contact basis/consent status;
- prior opt-out/DNC;
- campaign purpose;
- attempt history;
- local time;
- recording/transcription policy;
- AI disclosure policy;
- policy version.

## Decisions

- `ALLOW_AUTONOMOUS`
- `HUMAN_ONLY`
- `RESEARCH_ONLY`
- `REVIEW_REQUIRED`
- `SUPPRESS`

Default uncertain classes to review/human-only, not autonomous.

## DNC

DNC is immediate and durable.

## Calling windows

Use the destination's local timezone. Do not infer timezone only from server time.

## Recording/transcription

Make recording and transcript behavior policy-driven. If recording cannot legally/policy-wise occur, the call flow must be able to proceed without forbidden recording rather than silently recording anyway.

## AI identity

The system must not impersonate a named human employee. It should accurately identify Your AI Department and follow the reviewed AI-disclosure policy. If directly asked whether it is AI, answer truthfully.

---

# 25. SECURITY

- Never commit secrets/API keys to GitHub.
- Keep Twilio, model, CRM, SMS, email, and database credentials server-side.
- Validate Twilio/provider webhook signatures.
- Require authenticated internal control APIs.
- Encrypt sensitive persistent data at rest where appropriate.
- Minimize transcript access.
- Define transcript/audio retention and deletion.
- Preserve audit trails for DNC and compliance decisions.
- Restrict production dial-enable controls.
- Add a global kill switch that stops new calls immediately without requiring deployment.
- Keep the public marketing website isolated from the realtime voice service.

---

# 26. FAILURE HANDLING

Every external dependency requires a defined failure behavior.

## Research source unavailable

Continue with remaining sources; lower confidence; never invent missing evidence.

## Sales-manual retrieval unavailable

Use a minimal safe base prompt, avoid complex claims, and prefer human follow-up for uncertain questions.

## Realtime model slow/unavailable

Do not leave 5+ seconds of dead air repeatedly. Fail over to a configured backup or end politely if service is unusable.

## TTS/STT failure

Retry only within a strict latency budget; otherwise recover/end.

## Booking unavailable

Capture preferred time and create human follow-up; do not pretend booking succeeded.

## CRM write unavailable

Write to durable outbox/queue and retry. Do not lose DNC events.

## DNC database unavailable

Fail closed for new autonomous dialing until suppression storage is trustworthy.

## Transfer destination unavailable

Offer scheduling/follow-up instead of blind transfer loops.

---

# 27. QA / COACH BRAIN

Grade every eligible call using Module 4A's 12-point scorecard:

1. Relevant preparation
2. Honest opening
3. Clear reason for calling
4. Quality of first question
5. Listening
6. Follow-up questions
7. Business language instead of AI jargon
8. Financial diagnosis when appropriate
9. Employee-safe positioning
10. No invented claims
11. Clear next step
12. Accurate CRM documentation

## Hard-fail flags

- false referral/fake familiarity;
- invented ad spend;
- invented CRM/integration;
- invented ROI/revenue loss;
- guarantee presented as fact;
- attacks employee to sell automation;
- continues selling after explicit DNC;
- claims a booking/email/transfer occurred when it failed;
- unauthorized production dial;
- deceptive mystery-shop/fake lead submission;
- unsafe/legal/sensitive automation promise beyond approved scope.

A call with a hard fail cannot be considered a passing production-quality call regardless of the numeric score.

---

# 28. ROLEPLAY TEST HARNESS

Before real prospect traffic, build automated and human roleplay using the manual's personas.

Required personas include:

- friendly owner;
- busy owner;
- skeptical owner;
- gatekeeper;
- send me something;
- already uses ChatGPT;
- already has receptionist;
- already has CRM;
- has IT company;
- has marketing agency;
- AI isn't ready;
- customers want humans;
- employees can do it;
- too expensive;
- needs to think;
- guaranteed ROI request;
- specific integration promise request;
- no measurable pain;
- pain with weak data;
- clear economic pain + decision authority.

Also test:

- voicemail;
- wrong number;
- repeated interruption;
- mumbled speech;
- accents/noisy audio;
- prospect changes topic;
- prospect corrects research;
- prospect gives DNC mid-sentence;
- booking failure;
- CRM failure;
- model timeout.

---

# 29. LEARNING BRAIN

V1 learning is analytical, not self-modifying.

Track the management metrics in Module 40:

- calls attempted;
- conversations;
- decision-makers reached;
- gatekeeper referrals;
- qualified conversations;
- meetings/next steps;
- disqualifications;
- conversation/dial;
- decision-maker/conversation;
- qualified/decision-maker;
- meeting/qualified.

Break down by:

- industry;
- hook;
- list/source;
- advertiser signal;
- Google/Meta/multi-channel;
- score/tier;
- campaign;
- agent/prompt version;
- voice/model version.

Also track:

- research facts corrected by prospect;
- unsupported-claim rate;
- average QA score;
- hard-fail rate;
- first-audio latency;
- interruption-stop latency;
- average agent turn length;
- DNC handling success;
- action-tool success;
- booking completion;
- CRM outcome accuracy.

The system may recommend changes such as:

> “After-hours hook outperforms generic AI opener for Tier A HVAC advertisers.”

It may NOT automatically rewrite the production prompt and deploy the change without review during V1.

---

# 30. FIRST VERTICAL: HVAC, THEN PLUMBING

HVAC is the canonical first production playbook because the manual explicitly identifies it as Vertical Priority 1 and it combines urgent inbound demand, phone dependence, paid-search competition, after-hours demand, replacement estimates, dispatch/scheduling, field-service software, and measurable front-office workload.

## HVAC default hypothesis bank

- paid call after-hours handling;
- missed call recovery;
- speed to form lead;
- unsold replacement estimate follow-up;
- financing follow-up;
- CRM/field-service routing;
- attribution to booked/sold job;
- seasonal front-office capacity;
- maintenance/reactivation;
- repetitive ETA/status communication.

The system must ask which problems are real.

After HVAC passes the production gates, clone the architecture — not the prompt — for Plumbing using the Plumbing playbook.

Vertical adapters should contain:

- business model;
- common customer journey;
- public qualification signals;
- hypothesis bank;
- hook ranking;
- common systems;
- discovery questions;
- sensitive boundaries;
- ROI worksheets/evidence guidance;
- roleplay personas.

Then add roofing, law, collision/PDR, real estate, etc. from the canonical manual.

---

# 31. CAMPAIGN ORCHESTRATION

A campaign contains:

- vertical;
- geography;
- lead source;
- operating mode;
- research freshness requirements;
- minimum tier;
- allowed hours;
- max attempts;
- concurrency limit;
- voicemail policy;
- follow-up cadence;
- agent/voice version;
- approved next-step target;
- compliance policy version;
- kill-switch state.

Queue priority should normally consider:

1. compliance eligibility;
2. Tier A before B before C;
3. research freshness;
4. current local calling window;
5. no recent attempt;
6. campaign limits.

This is not a blind power dialer. It is a researched queue.

---

# 32. HUMAN-ASSIST MODE

Human-assist should be a first-class product, not a fallback.

For each prospect it can show:

- research card;
- evidence sources;
- score/tier;
- primary hook;
- backup hook;
- first questions;
- likely CRM/system signal;
- objection pointers;
- claim boundaries;
- call notes template.

This means YAD gets value from the research brain even for numbers/campaigns that cannot or should not be autonomously called.

---

# 33. DASHBOARD REQUIREMENTS

V1 admin UI may be simple, but the eventual control plane should show:

## Queue

- ready/researching/review/callable/human-only/suppressed;
- tier;
- vertical;
- local time;
- last attempt.

## Prospect detail

- evidence card;
- score reasons;
- Call Pack;
- history;
- research freshness;
- compliance decision.

## Calls

- disposition;
- duration;
- transcript/audio subject to policy;
- QA score;
- latency metrics;
- tools/actions.

## Campaign metrics

- funnel metrics;
- hook performance;
- industry performance;
- advertiser-sourced performance;
- score/tier performance.

## Compliance

- suppression search;
- policy version;
- DNC events;
- call-enable kill switch;
- audit log.

---

# 34. DEPLOYMENT SHAPE

Keep the realtime phone system separate from the Astro marketing website.

Preferred logical components:

1. **Control/API Service** — campaign, prepare, admin APIs.
2. **Research Worker** — crawls/researches asynchronously.
3. **Knowledge Indexer** — builds sales-manual search index.
4. **Realtime Voice Gateway** — Twilio webhook/WebSocket handling.
5. **Tool Service Layer** — booking/SMS/email/CRM/DNC/transfer.
6. **Post-Call Worker** — summary/QA/follow-up.
7. **PostgreSQL** — durable business/call records.
8. **Queue/session store** — use Redis or equivalent if required by concurrency/latency.
9. **Admin UI** — later or minimal V1.

Claude should inspect the existing Twilio/receptionist infrastructure and reuse transport-level work that is good, but keep outbound conversation logic and data contracts independent.

---

# 35. BUILD PHASES FOR CLAUDE CODE

## Phase 0 — Audit, no production change

- Read project authority files.
- Inspect existing Twilio/receptionist code and `voice.youraidepartment.ai` deployment.
- Audit the current `phone-agent/` prototype against this specification.
- Identify reusable code vs code that should be discarded/rebuilt.
- Confirm local testing method.
- Keep automatic GitHub Actions disabled.
- Keep production dialing disabled.

Deliverable: architecture audit + implementation plan.

## Phase 1 — Core contracts and local data model

Build:

- canonical lead/account/contact contracts;
- evidence ledger;
- research card;
- canonical Module 4C scoring;
- Call Pack;
- compliance-decision contract;
- call/outcome/QA contracts;
- migrations.

Tests first.

## Phase 2 — Research engine

Build:

- website crawler;
- tech/CTA detector;
- Google/Meta adapter interfaces;
- public research adapter;
- CRM/system signal detector;
- evidence normalization;
- TTL/freshness;
- research snapshots.

Verify on known HVAC/plumbing businesses without contacting them.

## Phase 3 — Sales Manual retrieval

Build indexer + hybrid retrieval over canonical manual.

Test retrieval for:

- HVAC missed calls;
- paid advertiser hook;
- already has CRM;
- send email;
- receptionist;
- marketing agency;
- ROI guarantee;
- integration uncertainty;
- DNC.

## Phase 4 — Strategy engine

Generate stable Call Packs from deterministic scoring + RAG.

Test that public facts and hypotheses never blur.

## Phase 5 — Roleplay conversation engine, no phone

Run the 20+ personas through text/simulated conversation first.

Pass manual scorecard and hard-fail tests before telephony.

## Phase 6 — Controlled Twilio test calling

Only allowlisted internal numbers.

Validate:

- answer detection;
- voicemail;
- first-audio latency;
- interruption;
- DNC;
- phone-number speech;
- booking;
- transfer;
- SMS/email;
- failure recovery.

## Phase 7 — CRM/follow-up/tooling

Wire durable outcomes, outbox retries, booking, follow-up, and suppression.

## Phase 8 — QA and analytics

Automated scorecard + dashboard metrics.

## Phase 9 — Human-reviewed HVAC pilot

No autonomous mass campaign.

Use a small explicitly approved list. Review calls in batches. Any unsupported-claim, DNC, or compliance hard fail pauses the campaign.

## Phase 10 — Production ramp

Only after all gates pass and Michael explicitly approves enabling production autonomous outbound.

---

# 36. PRODUCTION ACCEPTANCE GATES

Production autonomous outbound must remain disabled until all are true.

## Research

- research sources preserved;
- fact/hypothesis separation tested;
- no fake form submissions;
- canonical score matches Module 4C test fixtures;
- stale ad evidence refresh works.

## Knowledge

- correct manual sections retrieved in test scenarios;
- current commercial truth overrides stale manual references;
- manual snapshot recorded per call.

## Conversation quality

- average call score at least 10/12 across the controlled certification set;
- zero unresolved hard-fail categories;
- agent handles all required roleplay personas;
- no long generic AI pitch;
- existing CRM/receptionist/agency handled correctly.

## Voice UX

- repeated 3–5 second pauses eliminated;
- latency measured and within agreed product thresholds;
- interruption works;
- number verbalization natural;
- no repetitive response loops.

## Actions

- DNC writes synchronously and is respected on the next attempted lookup;
- booking success is verified before the agent says booked;
- failed booking creates a fallback task;
- transfer failure has fallback;
- CRM writes durable/retriable.

## Compliance/security

- counsel/company-reviewed policy table loaded;
- calling windows/timezones tested;
- line/contact-basis decisions tested;
- recording/transcription rules tested;
- provider webhook validation enabled;
- secrets not committed;
- kill switch tested.

## Operations

- logging/monitoring;
- error alerts;
- campaign pause;
- per-campaign caps;
- post-call QA;
- suppression administration.

---

# 37. V1 NON-GOALS

Do not let Claude overbuild these before the core loop works:

- dozens of verticals at once;
- autonomous prompt self-modification;
- complex custom CRM UI before durable data exists;
- fake lead mystery-shopping;
- automatic proposal generation on first cold call;
- replacement of every existing SaaS tool;
- unbounded web browsing during live calls;
- custom speech model training before basic latency is solved;
- massive power-dialing infrastructure before conversion/quality is proven.

---

# 38. DEFINITION OF V1 SUCCESS

A successful V1 can take an approved HVAC prospect, research it, produce an evidence-backed Tier score and Call Pack, pass deterministic compliance policy, call an allowlisted/test destination through Twilio, speak naturally with low latency, handle interruptions, conduct YAD-style discovery without false claims, execute a next-step action, record a structured CRM-quality outcome, and grade itself against the Sales Manual.

Only after that works repeatedly should YAD move to a small real-prospect pilot.

---

# 39. PRODUCT VISION AFTER V1

Once proven internally, the same architecture can become a YAD client product:

- AI inbound receptionist;
- missed-call recovery;
- speed-to-lead outbound callback;
- old-lead reactivation;
- appointment confirmation/no-show recovery;
- estimate follow-up;
- customer-status calls;
- sales qualification;
- CRM-integrated call intelligence;
- managed AI phone department.

The internal outbound sales brain therefore serves two purposes:

1. it helps YAD acquire customers;
2. it becomes a live reference implementation of the systems YAD sells.

The architecture should preserve that future without making V1 unnecessarily complex.
