# Your AI Department — Market Miner Reference Algorithm

**Status:** Normative behavioral pseudocode, not implementation code  
**Purpose:** Show Claude the intended orchestration from market request to ranked prospect inventory while preserving provider abstraction, evidence discipline and cost controls.

---

# 1. INPUT

Conceptual request:

```text
MiningJobRequest
vertical = HVAC
territory = Jacksonville + St. Augustine FL
mode = advertiser_first
minimum_tier = B
ready_target = 100
research_depth = sales_ready
paid_ad_freshness = 48h
provider_budget = configured
```

---

# 2. PLAN PHASE

```text
profile = loadVerticalProfile(HVAC)
territory = resolveTerritory(request.territory)
searchCells = planProgressiveSearchCells(territory)
queryFamilies = profile.search_taxonomy

plan = planPass1(
  highIntentQueries(queryFamilies),
  coreMarketCells(searchCells),
  defaultDeviceAndTimeStrategy
)

validateBudget(plan)
return planForReviewOrStart
```

No provider spend required for planning where possible.

---

# 3. PASS 1 — GOOGLE ADVERTISER DISCOVERY

```text
for each planned SearchTask:
  if campaign paused or budget unavailable:
    stop scheduling

  result = paidSerpProvider.search(task)
  record ProviderUsage
  record SearchObservation for each paid result
  record resolved geography/time/device
```

Unknown provider result type is not automatically paid.

---

# 4. DISCOVERY CANDIDATE RESOLUTION

For each paid observation:

```text
candidate = normalizeAdvertiserIdentity(observation)
match = entityResolver.find(candidate)

if strong existing match:
  link observation to Account
else if safe new identity:
  create Account + SourceIdentity
else:
  create EntityReviewCandidate
```

Aggregator/lead-generator observations do not auto-create local contractor identity.

---

# 5. ACCOUNT-LEVEL OBSERVATION AGGREGATION

```text
account.adObservations = all linked fresh/historical observations
account.advertiserEvidenceStrength = computeStrength(account.adObservations)
```

Canonical Google Module 4C points still maximum +4.

---

# 6. PRE-RESEARCH FILTER

Before expensive research:

```text
if obvious excluded category:
  mark excluded
  stop deep enrichment

if account suppressed/existing-customer exclusion relevant:
  keep identity/history
  exclude from sales-ready inventory
```

Do not spend Apollo/browser/model budget on obvious supply house/aggregator.

---

# 7. DOMAIN RESOLUTION

```text
domain = resolveDomain(
  paidLandingDomain,
  firstPartyClues,
  approvedBusinessDiscoverySources
)

if ambiguous:
  research status partial/review
else:
  attach canonical Domain
```

A provider-missing website is not proof of no website.

---

# 8. WEBSITE RESEARCH

Page plan:

```text
landing page
homepage
contact
relevant service page
emergency/24-7
financing/offers
locations
team/about
booking/estimate page
```

For each page within crawl budget:

```text
fetch safely
extract deterministic signals
optionally classify ambiguous text with structured LLM
create evidence candidates
validate against claim registry
persist EvidenceRecords
```

No form submission.

---

# 9. PRELIMINARY CLAIMS

Examples from evidence engine:

```text
active_google_search_ad = yes
emergency_24_7_service = yes
high_value_service_promoted = ac_replacement
prominent_lead_capture_cta = quote_form
crm_frontend_signal = ServiceTitan booking widget
call_tracking_signal = CallRail
multiple_physical_locations = 2
```

Backend CRM workflow remains unknown.

---

# 10. PRELIMINARY SCORE

```text
score = scoreRecognizer.evaluate(currentEvidence, profile)
```

Output:

```text
rule + points + evidence refs + reason
```

No LLM total.

If below campaign threshold and research depth policy says stop:

- keep Account/profile
- skip premium enrichment
- not ready.

---

# 11. DEEP RESEARCH DECISION

For plausible Tier A/B:

```text
if contact needed and not fresh:
  enrich first-party + licensed contacts

if Meta check configured and marginal value justifies:
  run Meta adapter

if Transparency corroboration useful:
  run advertiser lookup

if website needs browser render:
  render selected pages
```

Every paid action checks budget again.

---

# 12. FINAL EVIDENCE / SCORE

After adapters settle or optional timeout:

```text
profile = compileCurrentProspectProfile(EvidenceRecords)
score = calculateNewScoreSnapshot(profile)
researchCompleteness = calculateCompleteness(run)
adStrength = calculateAdvertiserStrength(observations)
```

Score and completeness remain separate.

---

# 13. OPPORTUNITY HYPOTHESIS

```text
candidateHypotheses = profile.vertical.leakageHypotheses

for hypothesis in candidateHypotheses:
  match trigger signals against current evidence
  subtract/disqualify if strong existing-process evidence known
  rank by evidence relevance + economic leverage + campaign objective
```

Output top:

- primary
- backup
- missing facts to ask
- prohibited assumptions.

LLM can synthesize wording, but evidence IDs required.

---

# 14. SOLUTION / COMMERCIAL MAPPING

```text
solutionCategories = mapProblemToSolution(primaryHypothesis)
commercialOffers = mapSolutionToCurrentCommercialTruth(
  solutionCategories,
  CommercialTruthSnapshot
)
```

Do not create a new commercial package from solution name.

---

# 15. SALES MANUAL RETRIEVAL

Retrieve relevant:

- cold-call doctrine
- vertical module
- hook family
- likely objections
- CRM positioning
- ROI discipline
- current next-step guidance.

CommercialTruthSnapshot remains higher authority.

---

# 16. CALL PACK GENERATION

```text
CallPack = compile(
  identity,
  top confirmed facts,
  critical unknowns,
  primary/backup hypothesis,
  hooks,
  first questions,
  system signals,
  objections,
  solution/offer hypotheses,
  prohibited claims,
  next-step options,
  evidence/knowledge/profile/commercial versions
)
```

Validate:

- every researched fact -> EvidenceRecord
- stale facts not current language
- unknowns not facts
- compact context budget.

Store immutable Call Pack.

---

# 17. READY ELIGIBILITY

For Human Assist:

```text
ready =
  score >= minimum tier
  AND identity sufficient
  AND research completeness meets policy
  AND primary hook safe/current
  AND not excluded/suppressed
```

For phone queue:

also require phone endpoint.

For autonomous voice later:

add separate current ComplianceDecision.

Never let fit score bypass eligibility gates.

---

# 18. INVENTORY RANKING

Example comparator:

```text
Tier A before B
higher canonical score
advertiser cohort preference for advertiser-first campaign
advertiser evidence strength
fresh complete research
primary hypothesis relevance/economic leverage
useful decision-maker confidence
oldest/no prior contact according cadence
```

Requested callbacks later outrank cold inventory in rep daily queue.

---

# 19. INVENTORY CHECK

```text
readyCount = countReady(campaign)

if readyCount >= highWater:
  pause mining
else if readyCount < lowWater:
  replenish
```

Replenishment chooses next query/cell based on historical new-advertiser/Tier-B+ yield per cost.

---

# 20. PASS 2

If inventory short:

```text
highYieldQueries = rankPass1QueriesByNewAdvertiserAndTierYield()
priorityCells = rankUndercoveredZctasCells()
plan pass2(highYieldQueries x selectedCells)
```

Do not run every query x every ZIP blindly.

---

# 21. PASS 3

If still short and mode/territory permits:

Evaluate marginal choices:

- more synonyms/query families
- second time window
- selected second device
- adjacent cells
- Transparency/Places gap fill
- non-ad gap fill only in advertiser_first mode when explicitly enabled.

Choose cheapest/highest historical expected yield.

---

# 22. SATURATION

For cell/query combinations:

```text
if repeated searches mostly return known advertisers
AND new advertiser/Tier yield below threshold
AND enough observations exist:
  mark cooldown/saturated
```

One empty search is insufficient.

---

# 23. TARGET SHORTFALL

If territory/query options exhausted under mode:

```text
return actual ready inventory
+ coverage report
+ saturation report
+ cost
+ recommended next expansion
```

Never fabricate/list lower-quality prospects as meeting criteria.

---

# 24. HUMAN ASSIST FEEDBACK

Rep calls prospect and records:

- outcome
- decision-maker
- problem/no pain
- current systems
- numbers/source
- correction
- next step
- DNC.

Post-call:

```text
persist ProspectStatements
update current evidence where appropriate
queue targeted research refresh
calculate new score/profile if material
preserve old CallPack for historical QA
```

---

# 25. LEARNING

Aggregate:

- provider/query/cell -> Tier B+
- Tier/source/hook -> decision-maker
- -> qualified conversation
- -> meeting
- -> opportunity.

V1 outputs recommendations; does not automatically rewrite canonical score/profile/prompt.

---

# 26. CORE INVARIANTS

At every step:

- provider failure -> unknown/partial, not invented negative
- duplicate observation -> one canonical Account
- active-ad score awarded once/channel
- pixel/tag != active ad
- CRM frontend != backend workflow
- public research != proof of business pain
- current commercial truth != stale RAG
- DNC/contact policy separate from fit
- no-sale remains valid.
