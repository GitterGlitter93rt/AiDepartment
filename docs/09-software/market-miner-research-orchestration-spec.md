# Your AI Department — Market Miner Research Orchestration Specification

**Status:** Architecture authority  
**Purpose:** Define how deterministic adapters, public web research, LLM synthesis, evidence normalization, scoring and strategy interact so Claude does not build one unconstrained agent that browses the internet and writes whatever it thinks is true.

---

# 1. PRINCIPLE

Research is a pipeline with source-preserving steps.

Correct pattern:

`source adapter -> raw observation -> deterministic extraction -> evidence candidate -> validation/normalization -> optional LLM synthesis/classification -> EvidenceRecord -> ProspectProfile`

Wrong pattern:

`Ask an LLM: research this business and tell us everything`

then treat the prose as truth.

---

# 2. RESEARCH RUN

Each Account research execution creates one `ResearchRun`.

It contains adapter states:

- queued
- running
- succeeded
- partial
- failed
- skipped

One failed adapter does not fail entire Account unless the campaign requires that source.

---

# 3. ADAPTER TYPES

## Discovery/ad adapter

- paid Google/LSA observations
- Transparency evidence
- Meta evidence

## First-party website adapter

- website facts
- CTA
- services
- scripts/tech
- leadership

## Business identity adapter

- public/licensed identity
- location
- registry/license where useful

## Contact adapter

- first-party team
- Apollo/licensed people data

## Geography adapter

- normalized geography/timezone/search cell.

Each adapter has independent timeout/retry/cost policy.

---

# 4. RAW OBSERVATION RETENTION

Before storing raw provider payload:

- check source retention class;
- store permitted minimal structured observation;
- raw payload pointer only where terms permit;
- otherwise extract allowed durable fields and discard raw.

Evidence must preserve enough provenance to know why a claim exists even when raw payload cannot be kept.

---

# 5. DETERMINISTIC EXTRACTION FIRST

Use code for fields that do not require language judgment:

- URLs/domains
- phone/email strings
- structured data
- provider result types
- paid/organic result labels from structured provider API
- tag/script signatures
- form elements
- timestamps
- coordinates
- exact addresses
- duplicate match keys
- arithmetic score rules.

LLM should not be asked to parse what reliable code can extract.

---

# 6. LLM-SUITABLE TASKS

Use Claude/approved model for:

- classifying business services from messy site text;
- summarizing customer journey;
- distinguishing a current promotion from general copy;
- mapping services to vertical profile categories;
- generating problem hypotheses from evidence;
- Call Pack synthesis;
- post-call summary/QA.

Even here, require source/evidence IDs.

---

# 7. LLM OUTPUT SCHEMA

Every research synthesis call uses strict structured output.

Example classification output:

- classification
- confidence
- evidence_refs[]
- reasoning_summary (internal, short)
- unknowns[]

Reject output if:

- evidence refs do not exist;
- required field invalid;
- model introduces a material fact with no evidence ref;
- schema fails.

Retry once with validation error; otherwise mark partial/review.

---

# 8. NO FREE-FORM FACT PROMOTION

A model sentence such as:

> This company likely uses ServiceTitan to automate all follow-up.

must never become EvidenceRecord as written when source only shows ServiceTitan widget.

Normalizer should produce:

- claim: ServiceTitan-related frontend/booking signal detected
- confidence: likely/confirmed frontend signal depending evidence
- backend follow-up: unknown.

The evidence model is stricter than the language model.

---

# 9. EVIDENCE CANDIDATE VALIDATION

Before EvidenceRecord:

Validate:

- claim type permitted;
- normalized value valid;
- source reference exists;
- observation timestamp exists;
- retention class known;
- confidence allowed;
- state active/stale logic;
- can-state-as-fact rule.

Invalid candidate goes to error/review, not score.

---

# 10. CLAIM REGISTRY

Maintain canonical claim keys and semantics.

Examples:

- active_google_search_ad
- active_meta_ad
- local_services_ad
- emergency_24_7_service
- financing_promoted
- multiple_physical_locations
- multiple_service_territories
- online_quote_booking
- google_ads_tag_signal
- meta_pixel_signal
- call_tracking_signal
- crm_frontend_signal
- visible_growth_hiring
- current_owner_role

Do not let each adapter invent differently named claims for same fact.

---

# 11. CLAIM KEY POLICY

Each key defines:

- value type
- allowed confidence
- authoritative source classes
- default TTL
- can-state-as-fact rule
- score rules it can support
- conflict resolution behavior.

Example:

`active_google_search_ad`

- value boolean/observation status
- requires direct paid SERP/current approved evidence
- TTL 48h default
- supports +4 Module 4C
- pixel cannot create it.

---

# 12. PARALLELIZATION

After identity/domain resolved, independent adapters can run in parallel:

- website pages
- contact search
- ad transparency
- Meta check
- public registry.

But do not launch expensive enrichment until basic fit/identity gates justify it.

Use staged parallelism.

---

# 13. COST-AWARE ORCHESTRATION

Before each adapter:

- campaign budget remaining
- provider cost estimate
- Account preliminary priority
- whether source can change score/strategy materially
- whether data already fresh.

Example:

Tier D supply house misclassification should be rejected before Apollo contact enrichment.

---

# 14. AD RESEARCH ORDER

Advertiser-first discovery:

- Google paid observation already exists from discovery.

For unique Account:

1. preserve paid observation;
2. resolve canonical domain/account;
3. website research;
4. calculate preliminary score;
5. deeper transparency/Meta/contact enrichment when worthwhile;
6. final score/profile.

Do not re-run expensive Google discovery unnecessarily for same fresh observation.

---

# 15. WEBSITE RESEARCH ORDER

Within site:

1. paid landing page if known
2. homepage
3. contact
4. relevant advertised/high-value service page
5. emergency/24-7
6. financing/offer
7. locations
8. team/about
9. booking/estimate pages

Stop when crawl budget reached or needed data sufficiently resolved.

---

# 16. CONFLICT HANDLING

When two sources disagree:

- preserve both EvidenceRecords;
- run claim-specific precedence;
- current read model selects canonical conclusion;
- mark contradiction relation/state;
- trigger manual review when conflict material and no source clearly controls.

Do not ask LLM to choose based on rhetoric.

---

# 17. PROSPECT-PROVIDED CORRECTIONS

Post-call ProspectStatement can supersede current public workflow understanding.

Research scheduler may create targeted refresh task.

Example:

> We stopped advertising in August.

Current paid observation from today still shows ad:

- preserve conflict;
- do not automatically assume either source means billing/spend status;
- conversationally accept what prospect says and avoid arguing;
- research/admin can investigate later.

---

# 18. RESEARCH COMPLETENESS CALCULATION

Completeness is deterministic from attempted/resolved components.

Possible weights:

- identity 15
- domain/website 15
- phone 10
- website research 20
- Google ad status 15
- tech/system check 10
- geography 5
- decision-maker attempt 5
- freshness 5

Exact weights can be tuned, but completeness stays separate from fit score.

Label thresholds documented/configured.

---

# 19. RESEARCH FAILURE BEHAVIOR

## Website down

- website status unresolved/temporarily unavailable
- do not infer no website.

## Paid SERP provider fails

- ad status unknown/refresh failed
- do not score ad points.

## Contact provider fails

- contact unknown
- account can still be Human Assist.

## LLM synthesis fails

- deterministic evidence remains
- mark strategy generation partial/retry
- do not discard Account.

---

# 20. RESEARCH CACHE

Cache source outputs/evidence according to:

- source terms
- field TTL
- account freshness
- query/context.

Do not call external provider if same result/evidence still valid and campaign does not require refresh.

Cache is not authority; EvidenceRecord/source metadata is.

---

# 21. RESEARCH IDEMPOTENCY

Same ResearchRun job should not create duplicate identical EvidenceRecords on retry.

Use deterministic observation/evidence fingerprints such as:

- account
- claim key
- normalized value
- source/provider reference
- observed timestamp/bucket where appropriate.

Repeated distinct ad observations remain distinct SearchObservations but can map to one current ad claim.

---

# 22. RESEARCH MODEL COST

Track:

- tokens/input/output
- model
- operation type
- Account/research run
- estimated actual cost.

Metric later:

`AI research cost per Tier B+ prospect`

Do not use largest model for every extraction task by default.

---

# 23. MODEL ROUTING

Possible architecture:

- deterministic parser first
- smaller/cheaper model for straightforward classification
- stronger Claude model for ambiguous business synthesis/Call Pack
- no model for score arithmetic/compliance.

Claude Code should benchmark cost/quality and keep provider abstraction.

---

# 24. WEB RESEARCH BY CLAUDE/API

If current Anthropic/API web-search capability is used:

- treat it as another ResearchAdapter;
- store each source URL/reference/timestamp available;
- decompose model synthesis into evidence candidates;
- do not treat model prose as source;
- enforce cost/time limits;
- do not run during normal realtime conversation.

Provider/tool availability must be verified against current API docs during implementation.

---

# 25. RESEARCH AUDIT VIEW

Admin should show per run:

- adapters attempted
- status/time/cost
- observations
- EvidenceRecords created
- conflicts
- score impact
- errors
- source freshness.

This makes “why did the AI think that?” answerable.

---

# 26. FIXTURE A — PIXEL + NO META CHECK

Website parser:

- Meta Pixel found.

Meta adapter:

- not configured.

Expected:

- meta_pixel_signal evidence
- active_meta_ad unknown
- no Meta score points.

---

# 27. FIXTURE B — WEBSITE LLM HALLUCINATION

Raw site does not mention 24/7.

LLM returns `24/7=true` without evidence reference.

Expected:

- validator rejects candidate
- no evidence/score point
- model output logged as invalid research synthesis.

---

# 28. FIXTURE C — AD + LANDING PAGE

Paid SERP confirms AC replacement ad.

Landing page confirms replacement + financing.

Expected separate evidence:

- active Google paid ad
- advertised service = replacement
- financing promoted
- landing page CTA

Strategy may choose replacement follow-up hook, but no claim about current follow-up quality.

---

# 29. FIXTURE D — PARTIAL PROVIDER FAILURE

Google observation succeeds; website crawler succeeds; Apollo fails.

Expected:

- research status partial/good depending completeness
- Account can score/Call Pack
- contact unknown/gatekeeper path
- no whole-run failure.

---

# 30. ACCEPTANCE REQUIREMENT

For sampled research runs, every material Call Pack fact must be traceable backward:

`Call Pack fact -> EvidenceRecord -> source observation/reference -> adapter/run`

If that chain breaks, fact cannot be used as a researched assertion in outreach.
