# Your AI Department — Outbound Sales Brain Normative Consistency Decisions

**Status:** Normative clarification for architecture v1  
**Purpose:** Resolve terminology or schema ambiguities discovered during cross-document review before Claude implements the system.

If an older architecture file conflicts with an explicit decision below, this file plus the more-specific current spec controls until the older file is updated.

---

# 1. PROBLEM / SOLUTION / COMMERCIAL OFFER ARE THREE DIFFERENT THINGS

Do not collapse them.

## Opportunity hypothesis

What business problem may exist?

Examples:

- missed calls
- speed to lead
- unsold estimates
- attribution
- employee capacity

## Solution category

What technical/operational capability might address it if confirmed?

Examples:

- AI phone handling
- CRM configuration
- workflow automation
- call tracking
- landing page/conversion work
- reactivation workflow
- reporting/dashboard

## Commercial offer family

How YAD currently sells/engages commercially according to `docs/00-company/launch-decisions.md`.

Examples:

- AI Department Assessment
- AI Strategy Call
- Executive AI Strategy
- AI Implementation
- AI Growth Systems
- Managed AI Department
- Google Ads
- Meta Ads
- SEO
- AI Training / Workshops / Coaching

Normative `OfferHypothesis` should therefore contain:

- `solution_category`
- `commercial_offer_family`
- `rank`
- evidence/opportunity references
- discovery requirements
- next step
- must-not-promise rules

Earlier architecture fields named `offer_family` that contain values such as `ai_phone_agent`, `crm_system`, or `workflow_automation` should be interpreted as **solution categories**, not newly approved packaged commercial offers.

---

# 2. VERTICAL PROFILE `offer_families` COMPATIBILITY

The first HVAC/Plumbing YAML architecture drafts use `offer_families` inside leak hypotheses.

For v1 loader compatibility, interpret those values as:

`solution_categories`

unless the value is explicitly a current commercial offer such as `ai_growth_systems` or `ai_implementation`.

Preferred implementation normalization:

- profile can list `solution_categories[]`;
- Offer Selection Engine maps those to `commercial_offer_family` using current commercial truth.

Do not let YAML wording create a new price/package.

---

# 3. EVIDENCE CONFIDENCE VS EVIDENCE STATE

These are separate.

## Confidence

- `confirmed`
- `likely`
- `unknown`

## Lifecycle/state

- `active`
- `aging`
- `stale`
- `contradicted`
- `superseded`

`contradicted` is not a confidence value.

Example:

Old website evidence:

- confidence at observation time: `confirmed`
- current state after prospect correction: `contradicted`

Preserve original confidence and the contradicting evidence relation.

---

# 4. NEGATIVE FACTS

Use three-state factual semantics:

- `yes`
- `no_confirmed`
- `unknown`

`no_confirmed` requires affirmative evidence that the negative is true from an appropriate source.

Examples:

- business explicitly says it does not provide 24/7 service -> potentially `no_confirmed` for 24/7 if current/reliable.
- known CRM script not found -> `unknown`, not `no_confirmed`.
- one Google search shows no ad -> `unknown`.
- Meta adapter unavailable -> `unknown`.

---

# 5. PAID-AD SIGNAL

Canonical Module 4C paid-ad points require positive current/relevant evidence.

- Google confirmed -> +4 once.
- Meta confirmed -> +3 once.
- two or more confirmed paid channels -> +1 once.

Repeated Google observations increase advertiser-strength/queue priority evidence but do not add additional Module 4C Google points.

Tracking technology never creates active-ad points by itself.

---

# 6. CANONICAL MODULE 4C SCORE

The general Sales Manual Module 4C model is the auditable YAD fit score.

Maximum under current rules when every listed signal is awarded:

18 points.

Tier thresholds:

- A: 9+
- B: 6–8
- C: 3–5
- D: 0–2

Corrected fixture values are authoritative in:

`outbound-sales-brain-scoring-research-fixtures.yaml` v1.0.1+

Do not use earlier arithmetic examples if they conflict with those fixtures.

---

# 7. VERTICAL-SPECIFIC PRIORITY SIGNALS

HVAC/Plumbing manuals may highlight additional signals such as financing, membership, drain/sewer focus, multiple trucks, etc.

Unless leadership explicitly changes canonical scoring:

- these may influence hypothesis selection and queue tie-break priority;
- they may help satisfy an existing general rule such as high-value economics;
- they do NOT silently add new hidden Module 4C points.

This keeps score explainable.

---

# 8. MULTIPLE LOCATIONS VS SERVICE TERRITORIES

Module 4C language includes “multiple locations or service territories.”

Implementation must distinguish:

- multiple confirmed physical locations;
- one location with multiple listed service cities;
- broad service territory;
- separately operated franchises.

A business can satisfy the rule based on genuinely meaningful multiple service territories if the implemented canonical scoring interpretation explicitly documents that mapping.

Do not simply count every city listed in a footer as a separate “location.”

---

# 9. RESEARCH COMPLETENESS IS NOT FIT

`ResearchCompleteness` may decide:

- refresh needed;
- human review needed;
- whether a research-specific hook can be used;
- queue order.

It never changes the canonical Module 4C score.

A Tier A prospect can have partial research.

The correct behavior is often `refresh`, not downgrade to Tier B.

---

# 10. COMPLIANCE/CONTACTABILITY IS NOT FIT

Line type, DNC, local calling time, consent/contact basis and autonomous-call eligibility do not alter YAD Tier.

They alter:

- queue eligibility;
- contact channel;
- timing;
- autonomous vs human mode.

A perfect Tier A prospect may still be `human_only` or `suppress`.

---

# 11. VERTICAL PROFILE SOURCE VERSION

The YAML drafts include architecture placeholder metadata such as `source_manual_commit: main-current-at-profile-review`.

Do not treat that literal placeholder as provenance in production.

Implementation must record actual version data such as:

- source repository commit SHA;
- relevant source file/blob hashes;
- profile file hash/version;
- generation/review timestamp.

Every Call Pack later records the vertical-profile version and KnowledgeSnapshot used.

---

# 12. PROVIDER RECOMMENDATIONS ARE CANDIDATES UNTIL BENCHMARKED

The current architecture recommends DataForSEO as the likely bulk Google advertiser source and SerpApi as a likely fallback/validation/LSA source.

These are not hard vendor locks.

Claude must execute:

`market-miner-provider-benchmark-plan.md`

before final routing selection.

Provider documentation/pricing/storage terms must be revalidated at implementation time.

---

# 13. GOOGLE PLACES IS NOT ACTIVE-AD PROOF

Google Places/business discovery may help find/resolve companies.

It does not establish current Google paid advertising.

Active Google ad evidence comes from paid SERP/LSA/transparency evidence under the ad research model.

---

# 14. META IS OPTIONAL FOR V1 SUPPLY

A lack of automated Meta commercial-ad access must not block Market Miner.

Valid state:

`meta_active_ad_status = unknown`

Strong Google advertisers can still score/rank based on other signals.

Never fabricate Meta-negative evidence.

---

# 15. FIRST-PARTY WEBSITE FACTS VS INTERNAL WORKFLOW

First-party website can confirm public statements such as:

- “24/7 emergency service”
- services
- locations
- financing offer
- contact/booking CTA

It generally cannot confirm:

- missed-call percentage
- actual response time
- CRM adoption quality
- salesperson follow-up consistency
- campaign ROI
- collected-revenue attribution quality

Those remain discovery questions.

---

# 16. PROSPECT STATEMENT PRECEDENCE

A prospect's current direct statement about their own workflow usually becomes the best current conversational source for that workflow, subject to context/reliability.

If prospect says:

> We switched to Housecall Pro last month.

The agent should accept/update current conversation state.

The previous ServiceTitan public signal remains historical evidence with `contradicted` or `stale` state.

---

# 17. CALL PACK FACT LIMIT

The realtime Call Pack should include only the highest-value facts/unknowns needed for the call.

Human UI may expose deeper evidence.

Do not inflate live context merely because the research database contains hundreds of observations.

---

# 18. CURRENT COMMERCIAL TRUTH ALWAYS WINS

Pricing, current offers, scheduling/payment flow and CTA truth come from the current launch/commercial authority.

RAG retrieval cannot override that with an older Sales Manual passage.

If current truth is missing:

- do not invent;
- use discovery/technical/commercial follow-up.

---

# 19. NO-SALE IS A FIRST-CLASS OUTCOME

If the prospect demonstrates strong systems/workflow and no meaningful problem, correct result can be:

- disqualify;
- no sale;
- maintain relationship;
- measure another category only if there is legitimate evidence.

Do not make the AI search indefinitely for a problem.

---

# 20. HUMAN ASSIST PRECEDES AUTONOMOUS PRODUCTION

The implementation should prove value through:

- Market Miner;
- evidence-backed ranking;
- Human Assist.

Autonomous real-prospect AI voice remains downstream and gated.

The presence of Twilio credentials or a working realtime model must never bypass this architecture order.
