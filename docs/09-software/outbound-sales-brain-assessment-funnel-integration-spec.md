# Your AI Department — Assessment / Inbound Funnel Integration Specification

**Status:** Architecture authority  
**Purpose:** Merge YAD assessment and strategy-booking activity into the same canonical Account, Prospect Memory, Opportunity, and sales workflow used by Market Miner/outbound prospecting.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

Outbound and inbound should share one brain.

If Market Miner researched a company and later someone from that company completes a YAD assessment, the system should recognize:

> This is no longer merely a cold researched prospect. The business has supplied first-party discovery data and demonstrated inbound intent.

Do not create a parallel “website lead” universe.

---

# 2. INBOUND SOURCES

Architecture supports current/future:

- Short AI Assessment
- Comprehensive AI Assessment
- Strategy Call booking
- service-specific inquiry
- website contact form
- referral
- manual sales intake.

Exact website implementation/source fields should be audited by Claude against current production code before wiring.

---

# 3. INBOUND EVENT

`InboundFunnelEvent`

- event_id
- event_type
- occurred_at
- source_page/funnel
- contact identity fields
- company fields
- domain if supplied
- phone/email
- attribution fields (UTM/campaign/rep code where current implementation provides them)
- assessment response reference
- consent/communication metadata
- booking reference optional
- raw retention/privacy policy

Do not send unnecessary form content to analytics platforms.

---

# 4. ACCOUNT MATCHING

Attempt canonical match using:

1. normalized company domain
2. business phone
3. company name + location
4. contact email domain where appropriate
5. explicit user-selected business identity
6. conservative fuzzy review.

If ambiguous:

- create review/match candidate
- do not merge two companies automatically because names are similar.

---

# 5. CONTACT MATCHING

If same person already exists:

- enrich/update first-party contact data carefully
- preserve old source history.

If new person at existing Account:

- add Contact
- do not create new Account.

---

# 6. FIRST-PARTY DATA PRIORITY

Assessment answers become `ProspectStatements` or structured inbound discovery data with source:

`prospect_first_party_form`.

They may supersede weaker public hypotheses for internal workflow.

Example:

Public:
ServiceTitan frontend signal.

Assessment:
> CRM = Housecall Pro.

Current internal system should use Housecall Pro answer while preserving public historical evidence.

---

# 7. INTENT UPGRADE

Possible relationship transition:

`NEVER_CONTACTED / COLD_RESEARCHED`

->

`INBOUND_ENGAGED`

or equivalent relationship state.

Then:

- pause cold sequences
- release cold queue
- assign Human Assist/relationship owner
- prioritize response according to inbound process.

Do not cold-call them with “This is a cold call” after they just requested a strategy conversation.

---

# 8. ASSESSMENT RESULT -> QUALIFICATION

Assessment may inform:

- departments
- goals
- systems
- bottlenecks
- desired automation
- marketing/sales process
- readiness
- budget/timing where legitimately collected
- concerns.

Do not treat assessment score as proof that a specific implementation should be sold.

Use assessment data to generate:

- updated OpportunityHypotheses
- missing discovery questions
- StrategyMeetingBrief.

---

# 9. PUBLIC RESEARCH + ASSESSMENT COMBINATION

Useful meeting context:

**Public:** current HVAC Google ads + 24/7 + booking

**Assessment:** says follow-up is manual and they use Housecall Pro

**Meeting priority:** map lead entry -> Housecall Pro -> no-response follow-up -> measurement.

Public research creates context; first-party assessment confirms/changes the internal workflow hypothesis.

---

# 10. CONTRADICTIONS

If assessment says:

> “We do not run ads.”

but a fresh Google ad was observed:

Do not silently overwrite either.

Record:

- current public ad observation
- prospect statement
- possible interpretation: they may not personally know / agency handles it / timing changed.

Meeting can clarify respectfully.

---

# 11. BOOKING EVENT

When strategy call booked:

- meeting state becomes authoritative relationship commitment
- cold email/phone/field prospecting pauses
- Account owner/meeting router assigns appropriate rep
- StrategyMeetingBrief generated
- assessment/research context attached.

---

# 12. ATTRIBUTION

Preserve full path.

Example:

- discovered by Google advertiser miner
- received Smartlead email
- later visited website direct
- completed Short Assessment
- booked strategy call.

Do not overwrite origin with last click.

Keep:

- original prospect discovery
- channel touches
- inbound funnel attribution
- rep attribution fields
- meeting/opportunity attribution.

---

# 13. REP CODE

If current website/booking implementation supplies a salesperson/rep code:

- preserve it as attribution/routing input;
- validate against current active rep registry;
- do not allow arbitrary public value to override an existing active relationship owner without policy.

Claude must audit exact current field behavior in repo before implementation.

---

# 14. UTM FIELDS

Store permitted attribution:

- source
- medium
- campaign
- content
- term

Avoid storing PII in analytics/event tools where prohibited by platform/policy.

Canonical CRM/internal DB may hold business/contact data according to privacy policy.

---

# 15. ASSESSMENT VERSION

Store:

- assessment type
- form/schema version
- score version if applicable
- completion timestamp.

If questions/score change, old results remain interpretable.

---

# 16. PARTIAL ASSESSMENT

If partial form data is lawfully retained/available according to product/privacy design:

- do not treat as completed intent automatically;
- respect consent/communication rules;
- do not invent answers.

Implementation must follow current assessment privacy/data architecture.

---

# 17. DUPLICATE ASSESSMENTS

A prospect may complete multiple versions.

Preserve history.

Use most current relevant answers for current state while noting material changes.

Example:

June: no CRM
September: HubSpot

Current system = HubSpot if confirmed, with timeline.

---

# 18. HUMAN ASSIST VIEW

Inbound engaged Account should show:

- “Completed Short/Comprehensive Assessment”
- assessment date
- top stated goals/problems
- relevant public research
- contradictions
- meeting/next action
- source attribution.

Do not make rep open five separate dashboards.

---

# 19. FOLLOW-UP

If assessment completes without booking:

route according to current approved funnel/contact policy.

The Sales Brain may:

- create Human Assist task
- draft context-specific follow-up
- prioritize Account.

Do not invent an automated cadence beyond approved current process.

---

# 20. PRIVACY

Assessment may contain more business detail than public research.

Controls:

- role-based access
- retain only needed data
- no ad-platform PII leakage
- sensitive vertical answers handled appropriately
- never expose assessment responses inside public personalization beyond what prospect should reasonably expect.

---

# 21. ACCEPTANCE TESTS

1. Previously researched domain completes assessment -> same Account.
2. New employee at existing Account completes -> new Contact, same Account.
3. Assessment CRM answer contradicts public signature -> public evidence historical/context; first-party workflow answer prioritized.
4. Assessment completed + meeting booked -> all generic cold sequences pause.
5. Same Account had active rep -> inbound event preserves/coordinates owner rather than random reassignment.
6. Ambiguous company name -> human review, no bad merge.
7. Two assessments months apart -> history preserved, current answers used.
8. Full attribution path retained.
9. Rep code invalid -> does not hijack ownership.
10. Assessment answer never treated as guaranteed ROI or automatic proposal readiness.

---

# 22. CORE RULE

The moment a researched prospect gives YAD first-party information, the brain should become smarter and warmer—not create a duplicate lead and make them explain themselves all over again.
