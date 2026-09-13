# Your AI Department — Cross-Vertical Intelligence Router Specification

**Status:** Architecture authority  
**Purpose:** Route each discovered/imported business into the correct machine-readable vertical intelligence profile without contaminating research, scoring, hooks, professional boundaries, or call strategy with another industry's logic.  
**Implementation owner:** Claude Code

---

# 1. WHY THIS ROUTER EXISTS

The Market Miner now has machine profiles for multiple verticals. That creates a new failure mode:

> The system correctly discovers a business, but uses the wrong industry's assumptions, search terms, hooks, economics, decision-maker roles, or safety rules.

Examples:

- a collision shop that also advertises hail repair;
- a roofer that also offers gutters and solar;
- a general contractor that occasionally performs roofing;
- a law firm with several practice areas;
- a brokerage that also operates property management;
- an HVAC company whose site mentions plumbing because the parent company offers both.

The router must preserve business reality instead of forcing every account into exactly one permanent category.

---

# 2. CURRENT SUPPORTED PROFILE REGISTRY

Initial registry:

- `hvac-us-v1`
- `plumbing-us-v1`
- `roofing-us-v1`
- `collision-repair-us-v1`
- `pdr-hail-us-v1`
- `law-firms-us-v1`
- `real-estate-brokerages-us-v1`

Future profiles use the same registry contract.

Each registry entry contains:

- `profile_id`
- `version`
- `status`
- `industry_name`
- `priority`
- `source_manual_paths[]`
- `profile_path`
- `profile_hash`
- `enabled_for_mining`
- `enabled_for_human_assist`
- `enabled_for_voice`
- `country_scope[]`

A campaign must snapshot the exact profile version/hash used.

---

# 3. EXPLICIT CAMPAIGN VERTICAL WINS

If Michael/admin creates:

> HVAC — Jacksonville — advertiser-first

then the discovery/search strategy is HVAC.

Do not change that campaign to Plumbing merely because one result's website mentions plumbing.

Instead:

- evaluate whether the business genuinely offers HVAC;
- if yes, retain it in the HVAC campaign;
- record secondary vertical signals separately;
- if no HVAC service exists, classify it as out-of-scope for that mining job.

The campaign asks:

> Does this company belong in THIS target set?

not:

> What is the only industry this company may ever belong to?

---

# 4. PROFILE ASSIGNMENT OBJECT

Every Account may have multiple assignments.

```text
VerticalAssignment
- assignment_id
- account_id
- profile_id
- profile_version
- role: primary | secondary | campaign_context
- confidence: confirmed | likely | review_required
- evidence_ids[]
- classification_reasons[]
- disqualifying_reasons[]
- assigned_at
- reviewed_by optional
- superseded_at optional
```

Do not store only one `industry` string on Account and throw away the evidence.

---

# 5. EVIDENCE USED FOR CLASSIFICATION

Strong classification evidence, roughly in descending practical value:

1. first-party website service pages;
2. clearly matched current paid-ad landing page/service;
3. company homepage + structured organization/service content;
4. current public business category from an approved discovery provider;
5. licensed/public registry where the registry is authoritative for that business class;
6. multiple consistent search observations;
7. imported lead-source classification;
8. AI semantic classification of collected evidence.

AI classification is the last synthesis layer. It does not override contradictory source evidence silently.

---

# 6. CLASSIFICATION PIPELINE

For each candidate:

1. normalize source category/name/domain;
2. resolve canonical Account/Location;
3. collect basic website/service evidence;
4. compare evidence against every enabled profile's `classification_rules`;
5. calculate classification support per profile;
6. apply negative/exclusion evidence;
7. assign:
   - `confirmed`,
   - `likely`, or
   - `review_required`;
8. retain all meaningful secondary profiles;
9. select campaign-context profile;
10. use only the campaign-context profile for campaign query/hook defaults.

---

# 7. CLASSIFICATION SUPPORT MODEL

Do not use a mysterious LLM percentage as the only decision.

Create auditable components.

Suggested evidence weights for classification only, configurable:

- first-party dedicated service page: +5
- homepage prominently sells target service: +4
- current paid ad/landing page for target service: +4
- approved provider category matches: +3
- multiple website target keywords/context: +2
- imported vertical label from trusted internal list: +2
- weak incidental mention: +1

Negative evidence:

- clearly excluded business category: -6
- first-party site says service not offered: -6
- likely directory/lead generator rather than provider: route to review/exclude
- target keyword appears only in blog/educational context: no positive service point by itself

Suggested result interpretation:

- strong support with no conflict -> `confirmed`
- moderate support -> `likely`
- conflicting/multi-business evidence -> `review_required`

These classification weights are NOT YAD Module 4C points and must never be added to prospect fit score.

---

# 8. MULTI-VERTICAL ACCOUNTS

A business may legitimately receive several assignments.

Example:

**ABC Heating Plumbing & Air**

- HVAC: confirmed
- Plumbing: confirmed

Campaign context determines which playbook drives the Call Pack.

If discovered in an HVAC campaign:

- HVAC search taxonomy;
- HVAC hypotheses;
- HVAC Call Pack;
- HVAC scoring evidence where applicable.

If later mined in Plumbing:

- reuse same Account;
- do not create duplicate company;
- run/refresh Plumbing-specific research;
- create Plumbing-specific Call Pack snapshot.

Contact history is account-wide so YAD does not unknowingly cold-call the same company as a “new prospect” tomorrow from another vertical campaign.

---

# 9. COLLISION + PDR/HAIL SPECIAL CASE

A collision business can be:

1. collision-primary with hail capability;
2. PDR/hail-primary with collision capability;
3. genuinely separate operating divisions;
4. a temporary hail operation attached to a permanent shop.

Rules:

- `collision-repair-us-v1` controls ordinary collision estimate/front-office/customer-status campaigns;
- `pdr-hail-us-v1` controls storm-market, field-sales, surge, appointment and multi-market hail campaigns;
- same Account may carry both profiles;
- active hail campaign may create a market-specific Location/OperatingMarket record rather than a new company;
- never assume insurance/repair decision authority from either profile.

---

# 10. ROOFING + GENERAL CONTRACTOR SPECIAL CASE

A GC/remodeler site may mention roofing among many services.

For Roofing campaign inclusion, seek evidence the company actively sells roofing as a meaningful customer service, such as:

- dedicated roofing service pages;
- roof replacement/repair CTA;
- current roofing ads;
- roofing-specific inspection/financing/offer;
- roofing provider category.

A single sentence such as “we handle roofing, siding and remodeling” may be `likely` but does not automatically make it a high-priority Roofing campaign prospect.

If ambiguous, preserve Account and send vertical assignment to review rather than invent certainty.

---

# 11. LAW-FIRM PRACTICE-AREA SUBROUTER

Law is one vertical profile with a required practice-area context.

Possible practice-area assignments:

- personal injury
- criminal defense
- family/divorce
- employment
- immigration
- estate planning
- business law
- bankruptcy
- real estate law
- mass tort / complex litigation
- other

Store:

```text
PracticeAreaAssignment
- account_id
- practice_area
- confidence
- evidence_ids[]
- current_paid_ad_observations[]
```

A law-firm advertiser opener must use the practice area actually observed.

Allowed:

> “I noticed the firm is advertising around personal injury in Jacksonville...”

Not allowed:

> “I noticed you're advertising for personal injury...”

when the only observed ad was estate planning.

High-value economics must also be evaluated using practice-area-appropriate evidence/client data, never a universal law-firm assumption.

---

# 12. REAL ESTATE + PROPERTY MANAGEMENT SPECIAL CASE

Real-estate sales brokerage and property management have different customer journeys.

If a company provides both:

- Real Estate Brokerage profile applies to buyer/seller lead acquisition, routing, nurture, agent capacity and source-to-close attribution;
- Property Management profile, once enabled, applies to owner acquisition, leasing, maintenance, resident communication and PMS workflows.

Do not use tenant-maintenance hooks on a seller-lead campaign merely because the brokerage also manages rentals.

---

# 13. SEARCH ROUTER

A mining job loads only the selected profile's query dictionary.

Example:

HVAC:
- AC repair
- HVAC replacement

Roofing:
- roof replacement
- storm damage roof

Collision:
- collision repair
- body shop estimate

Hail/PDR:
- auto hail repair
- PDR hail repair

Law:
- practice-area-specific queries

Real estate:
- realtor
- sell my home

Never run a giant cross-industry keyword soup for one campaign.

---

# 14. RESEARCH ROUTER

All profiles use core adapters:

- identity;
- website;
- ads;
- contact enrichment;
- technology signals.

Profiles additionally activate vertical-specific research targets.

Examples:

Roofing:
- financing;
- inspection CTA;
- storm market;
- multiple markets.

Collision:
- estimate CTA;
- hail capability;
- location count;
- customer-status language.

PDR/Hail:
- current storm market;
- temporary locations;
- field-sales signals;
- appointment CTA.

Law:
- practice area;
- consultation CTA;
- intake/after-hours language;
- legal platform signals;
- multiple offices.

Real Estate:
- seller/home-value funnel;
- portal lead signals;
- open-house/listing activity;
- team/office size signals.

---

# 15. HYPOTHESIS ROUTER

Generate hypotheses only from the active campaign-context profile plus universal YAD categories.

Universal categories may include:

- speed to lead;
- missed calls;
- CRM capture;
- follow-up;
- attribution;
- employee capacity;
- reporting.

But the actual workflow expression remains vertical-specific.

Bad cross-contamination:

> Ask a law firm about unsold roofing estimates.

> Ask a body shop how it nurtures six-month home buyers.

> Ask an HVAC company about case intake.

These should be impossible through profile validation.

---

# 16. DECISION-MAKER ROUTER

Do not merely choose “owner.”

Select target role from the highest-priority hypothesis.

Examples:

Roofing unsold proposals:
- sales manager;
- owner;
- GM.

Collision customer-status capacity:
- operations;
- GM;
- customer-service/office manager.

Hail field lead capture:
- sales manager;
- market manager;
- owner/operator.

Law after-hours intake:
- intake director;
- COO/administrator;
- managing partner.

Real-estate nurture:
- ISA/lead manager;
- team leader/broker;
- sales operations.

The enrichment engine should search roles in priority order based on the current problem, not a universal contact hierarchy.

---

# 17. SAFETY-BOUNDARY ROUTER

The Call Pack must inherit:

1. global YAD boundaries;
2. compliance/policy boundaries;
3. active vertical boundaries;
4. any secondary profile boundary relevant to the topic.

Example collision + hail company:

- repair/safety decisions remain human;
- insurance/coverage/claim-specific decisions remain human;
- automated status claims require reliable source data.

Example law:

- no legal advice;
- no case-merit decision;
- confidentiality/vendor review;
- human attorney responsibility.

A vertical boundary may only make the agent more restrictive, never less restrictive than global policy.

---

# 18. OFFER ROUTER

The vertical profile supplies possible solution categories and commercial wrappers, but current `CommercialTruthSnapshot` controls what YAD can actually sell/name/price.

The router must never invent vertical-specific products such as:

- “Roofing AI Package”
- “Law Firm AI Package”
- “Body Shop AI Package”

unless company authority later defines them.

Correct:

problem -> solution category -> current YAD commercial offer.

---

# 19. CROSS-CAMPAIGN CONTACT SUPPRESSION

Before a new vertical campaign can contact an Account, check account-wide history.

Example:

Monday:
- ABC Home Services called from HVAC campaign.

Wednesday:
- Plumbing miner rediscovers same Account.

The Plumbing campaign must see:

- prior call;
- outcome;
- follow-up date;
- DNC/suppression;
- assigned owner;
- opportunity history.

Do not treat a different vertical as a loophole around contact cadence or DNC.

---

# 20. PROFILE FALLBACK

If no profile reaches acceptable classification confidence:

- preserve discovered Account;
- mark `vertical_review_required`;
- do not invent a vertical;
- optionally place into generic research-only queue;
- no vertical-specific Call Pack until resolved.

If the campaign is strictly advertiser-only for a named vertical, exclude unresolved candidates from ready queue until classification is resolved.

---

# 21. PROFILE VALIDATION

Every machine profile must pass schema validation before loading.

At minimum verify:

- unique `profile_id`;
- semantic version;
- source manual exists;
- required top-level sections exist;
- query arrays valid;
- no duplicate hypothesis IDs;
- all referenced hypothesis IDs exist;
- all ROI references map to allowed tools;
- commercial offer IDs map to canonical offer registry;
- no hidden Module 4C points;
- boundaries present for sensitive verticals;
- source hash/version recorded.

Invalid profile -> fail closed for campaign use.

---

# 22. CALL PACK SNAPSHOT

Every Call Pack stores:

- `campaign_vertical_profile_id`
- `campaign_vertical_profile_version`
- `vertical_assignment_id`
- `secondary_vertical_assignments[]`
- `practice_area_context` if applicable
- `profile_hash`
- `vertical_specific_boundaries[]`

That lets later QA reproduce exactly why the agent chose a hook/question.

---

# 23. ANALYTICS BY VERTICAL

Track separately:

- discovered businesses;
- classification-review rate;
- advertiser density;
- Tier A/B yield;
- research cost;
- decision-maker found rate;
- conversations;
- qualified conversations;
- meetings;
- opportunities;
- DNC;
- hooks;
- hard fails.

Do not conclude one vertical is “better” from tiny sample sizes.

---

# 24. FIRST ROUTER ACCEPTANCE

Claude should be able to feed synthetic candidates representing:

- HVAC-only business;
- Plumbing-only business;
- combined HVAC/Plumbing business;
- roofer;
- GC that merely mentions roofing;
- collision shop;
- collision + hail shop;
- mobile PDR hail operator;
- personal-injury law firm;
- multi-practice law firm;
- real-estate brokerage;
- brokerage + property management;
- directory/lead generator;
- unknown SMB.

For each, assert:

- correct profile assignments;
- correct campaign inclusion/exclusion;
- correct primary hook family;
- correct role priority;
- correct safety boundaries;
- no cross-industry language.

---

# 25. CORE RULE

A business can have several capabilities, locations, divisions, and customer journeys.

The system's job is not to stamp one permanent industry label onto the company.

The system's job is to select the **correct business context for the current campaign and current problem**, while preserving account-wide identity, history, evidence, and safety rules.
