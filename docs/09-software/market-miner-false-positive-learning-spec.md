# Your AI Department — Market Miner False-Positive & Noise Learning

**Status:** Architecture authority  
**Purpose:** Prevent the Prospect Factory from repeatedly researching directories, aggregators, supply houses, training schools, irrelevant businesses, duplicated entities, or misleading advertiser results.  
**Implementation owner:** Claude Code

---

# 1. PROBLEM

A large-scale market miner will repeatedly encounter noise.

Examples:

- HVAC supply houses appearing for HVAC searches;
- lawyer directories appearing for attorney searches;
- roofing lead-generation aggregators;
- PDR training schools/tool vendors;
- auto-AC shops in HVAC searches;
- property portals instead of brokerages;
- national lead-routing brands that do not identify the actual service provider;
- franchise corporate pages without callable local business identity;
- SEO/blog pages that mention a target service but do not sell it.

If the system merely rejects these once, it wastes money discovering and researching them again tomorrow.

The system therefore needs a versioned noise-learning layer.

---

# 2. NEGATIVE KNOWLEDGE IS NOT THE SAME AS DNC

Keep separate:

## `ProspectingExclusion`

Reason a discovered entity should not enter a given campaign/search pipeline.

Examples:

- wrong industry
- directory
- supply house
- school
- aggregator
- manufacturer
- franchise parent only
- non-service publisher

## `Suppression/DNC`

Communication policy applying to an actual business/contact.

Never use a classification exclusion as a substitute for DNC, and never erase a valid company because one campaign rejected it.

---

# 3. EXCLUSION SCOPES

Possible scopes:

- exact domain
- root domain family
- exact provider-native ID
- exact account
- business category
- URL pattern
- advertiser/display-domain pattern
- keyword/context pattern
- profile-specific
- campaign-specific
- global discovery noise

Examples:

`hvacschool.example` -> global domain exclusion from service-business prospecting.

`angi.com` -> aggregator classification requiring special handling, not a contractor Account.

`exampleholdings.com` -> may remain valid as parent Account but excluded from local-call queue unless local identity/contact exists.

---

# 4. FALSE-POSITIVE RECORD

`NoiseObservation`

- noise_id
- discovered_from_task_id
- observed_entity/reference
- normalized_domain
- provider category
- campaign_profile
- classification_result
- rejection_reason
- supporting evidence IDs
- reviewed_by
- confidence
- scope recommendation
- created_at
- expires/review_at optional

---

# 5. REJECTION TAXONOMY

Standard reason codes:

- `WRONG_VERTICAL`
- `DIRECTORY`
- `LEAD_AGGREGATOR`
- `SUPPLY_HOUSE`
- `WHOLESALER`
- `MANUFACTURER_ONLY`
- `TRAINING_SCHOOL`
- `TOOL_VENDOR`
- `PUBLISHER_INFORMATIONAL`
- `JOB_BOARD`
- `GOVERNMENT_ENTITY`
- `NONPROFIT_NON_TARGET`
- `FRANCHISE_PARENT_NO_LOCAL_CONTACT`
- `DUPLICATE_SOURCE_IDENTITY`
- `CLOSED_OR_NONOPERATING`
- `NO_CUSTOMER_SERVICE_EVIDENCE`
- `IRRELEVANT_SEARCH_MATCH`
- `AMBIGUOUS_REVIEW_REQUIRED`

Do not create dozens of ad hoc strings.

---

# 6. AUTOMATIC VS REVIEWED EXCLUSIONS

## Safe automatic exclusion

Use when evidence is strong and rule is deterministic.

Examples:

- profile explicitly marks category as negative;
- first-party site is clearly an HVAC training school;
- directory page says “find local contractors” and does not itself provide service;
- exact domain is on an approved noise list.

## Review-required

Use when exclusion could hide a real prospect.

Examples:

- general contractor with limited roofing service;
- collision shop plus training division;
- dealership with internal collision center;
- parent company with operating local subsidiaries;
- law marketing network that may itself be a firm.

---

# 7. NEGATIVE PATTERN LIBRARY

Maintain versioned patterns per vertical/profile.

Examples:

## HVAC

- training/school/course
- wholesale/supply/parts
- automotive AC

## Roofing

- roofing materials/supply
- roofing school/training
- lead marketplace

## Collision

- collision parts supplier
- auto body equipment vendor
- trade publication

## PDR/Hail

- PDR tools
- PDR training
- certification course

## Law

- directory
- lawyer referral marketplace where not itself a firm
- legal news publisher
- law school

## Real Estate

- listing portal
- mortgage-only lender
- home-inspection-only company
- property portal with no brokerage identity

Patterns are evidence helpers, not sole truth when context is ambiguous.

---

# 8. AGGREGATOR HANDLING

Aggregators are not always useless.

The miner should distinguish:

1. aggregator as non-prospect noise;
2. aggregator as source for discovering underlying businesses where terms permit;
3. aggregator/lead-gen company as a potential YAD prospect in its own right under another business model.

Do not call a contractor because a generic aggregator ad appeared unless contractor identity is independently established.

---

# 9. REDIRECT / TRACKING DOMAIN HANDLING

Paid results may use:

- Google tracking URLs;
- call-tracking domains;
- campaign redirectors;
- lead-gen landing domains;
- agency-controlled pages.

Resolve final destination safely.

Never merge advertiser identities purely on redirect host.

Store:

- observed URL
- resolved final URL
- root domain
- redirect chain summary
- advertiser identity evidence

---

# 10. DUPLICATE NOISE LEARNING

If the same noisy domain appears across many query families:

- increment noise recurrence;
- avoid repeated deep research;
- still record raw discovery count for provider/query evaluation;
- apply approved exclusion before expensive enrichment.

This lowers `cost per Tier B+` without distorting raw search-yield analytics.

---

# 11. PROVIDER-SPECIFIC NOISE

Measure rejection rates by provider and result type.

Example:

`Provider A local results` may have 4% wrong-category noise.

`Provider B organic results` may have 35% directory/publisher noise.

Track:

- discovered candidates
- rejected candidates
- rejection reasons
- cost spent before rejection

This feeds provider routing decisions.

---

# 12. HUMAN CORRECTION

Human Assist/admin may mark:

- wrong company
- wrong industry
- directory
- duplicate
- inactive business
- franchise relationship wrong
- aggregator

Corrections create structured labels.

They should not simply edit the row and erase the prior classification.

Store original + correction + reviewer + timestamp.

---

# 13. LEARNING PROPOSALS

The system may propose:

> Add `hvac academy` to HVAC negative query/context library; 22 discoveries produced zero service businesses.

or:

> Domain family X is consistently a lead aggregator; avoid deep website enrichment unless a campaign explicitly targets aggregators.

Each proposal includes:

- proposed rule
- supporting sample count
- false-positive risk
- affected profiles
- estimated cost savings
- reviewer decision

Do not automatically promote a learned pattern into global exclusion without review during V1.

---

# 14. HARD CASE: CLOSED BUSINESS

A source may say closed while the first-party website remains active.

Correct behavior:

- mark operating status conflicted;
- seek independent verification;
- do not permanently delete Account;
- do not queue outreach until resolved.

---

# 15. HARD CASE: FRANCHISES

A franchise brand may generate:

- corporate ad
- local franchise ad
- shared domain
- location-specific phone
- multiple legal entities.

Noise system must not suppress all franchisees because corporate root domain is not a callable local prospect.

Use entity-resolution hierarchy before exclusion.

---

# 16. QUALITY METRICS

Track:

- false-positive discovery rate
- false-positive research-complete rate
- human correction rate
- repeat-noise avoidance rate
- dollars spent on rejected candidates
- provider/category rejection rate
- exclusion false-negative audits

Goal:

Move rejection earlier in the pipeline without hiding legitimate businesses.

---

# 17. ACCEPTANCE FIXTURES

Minimum tests:

1. HVAC supply house -> exclude.
2. HVAC company with small supply-store page -> include HVAC, do not exclude entire company.
3. PDR training school -> exclude.
4. collision shop that sells training occasionally -> review/include based on repair evidence.
5. lawyer directory -> exclude from law-firm campaign.
6. multi-office law firm directory page -> resolve actual firm, include.
7. roofing lead aggregator -> aggregator, no contractor attribution.
8. general contractor with dedicated roofing division -> likely/confirmed Roofing depending evidence.
9. Zillow-like property portal -> not brokerage campaign Account unless brokerage identity separately established.
10. franchise corporate page + local franchise -> one brand relationship, local Account/Location preserved.

---

# 18. CORE RULE

The Market Miner should remember what it learned was noise, but it must be conservative about turning a rejected search result into a permanent statement about a real business.
