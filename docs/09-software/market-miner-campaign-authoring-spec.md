# Your AI Department — Market Miner Campaign Authoring Specification

**Status:** Architecture authority  
**Purpose:** Define how an admin describes exactly which businesses the Prospect Factory should find, research, rank, assign, and optionally make available to Human Assist without hard-coded campaigns.  
**Implementation owner:** Claude Code

---

# 1. CAMPAIGN IS THE OPERATING INTENT

A campaign answers:

- Which vertical/business context?
- Which geography?
- What discovery strategy?
- What signals are required/preferred?
- What minimum fit?
- How much inventory?
- Which providers/budget?
- Which rep/team?
- Which channels are allowed?
- How fresh must research be?
- What is explicitly excluded?

---

# 2. CAMPAIGN OBJECT

`CampaignDefinition`

- campaign_id
- name
- status
- business_owner
- vertical_profile_id
- campaign_objective
- geography_policy
- mining_mode
- search_policy
- qualification_policy
- research_policy
- inventory_policy
- provider_policy
- assignment_policy
- outreach_mode
- channel_policy
- exclusions
- compliance_policy_reference
- budget
- start/end optional
- version
- created_by
- approved_by

---

# 3. MINING MODES

- `ADVERTISER_ONLY`
- `ADVERTISER_FIRST`
- `FULL_LOCAL_MARKET`
- `NO_VERIFIED_WEBSITE`
- `WEAK_WEBSITE`
- `MULTI_LOCATION`
- `IMPORTED_LIST_ENRICHMENT`
- `FIELD_ROUTE`
- `EVENT_MARKET`
- `RESEARCH_ONLY`

Mode influences discovery priority, not truth rules.

---

# 4. GEOGRAPHY POLICY

May specify:

- country
- states
- counties
- cities
- metros/CBSA
- ZIP/ZCTAs
- radius
- custom polygons/search cells
- explicit exclusions.

Expansion:

- fixed geography only
- approved adjacent markets
- recommendation only.

No autonomous unapproved national expansion.

---

# 5. SEARCH POLICY

Fields:

- approved query families
- required query families
- provider candidates
- device strategy
- observation windows
- max search budget
- saturation thresholds config reference
- event/context rules.

Campaign cannot create unrestricted query terms outside active profile/policy unless reviewed.

---

# 6. SIGNAL REQUIREMENTS

Possible:

- current Google ad required
- current Google ad preferred
- LSA preferred
- Meta required/preferred
- 24/7 required/preferred
- multi-location
- financing
- quote/booking CTA
- no verified website
- weak website signal
- hiring/growth.

Required signals should be used cautiously; inability to verify may yield insufficient inventory rather than inventing qualification.

---

# 7. FIT POLICY

- minimum Module 4C tier
- optional minimum score
- allowed research completeness
- allowed advertiser-strength classes
- profile-specific classifications.

Never add campaign-only hidden fit points.

---

# 8. INVENTORY POLICY

- target ready inventory
- low water
- high water
- maximum research backlog
- stale inventory behavior
- replenishment enabled
- honest-shortfall behavior.

If target 250 but market only has 83 qualifying prospects:

return 83 + shortfall explanation.

---

# 9. PROVIDER POLICY

- allowed providers
- preferred provider
- fallback providers
- total budget
- per-day/per-run budget
- paid test opt-in
- cost anomaly threshold
- provider retention/license reference.

---

# 10. RESEARCH POLICY

Choose adapters:

- website
- paid funnel audit
- technology detection
- decision-maker enrichment
- ad transparency
- Meta
- registry/licensing
- event context.

Deep enrichment can be conditional on preliminary fit.

---

# 11. ASSIGNMENT POLICY

- rep/team
- territory
- vertical skill
- language
- workload
- ownership preservation
- unassigned pool allowed yes/no.

---

# 12. OUTREACH MODE

- RESEARCH_ONLY
- HUMAN_ASSIST
- CONTROLLED_TEST
- AUTONOMOUS_OUTBOUND only if system/policy later allows.

Campaign definition alone cannot bypass global production dial gate.

---

# 13. CHANNEL POLICY

Possible allowed channels:

- human_phone
- human_email
- Smartlead
- field_visit
- SMS where approved
- autonomous voice if later approved.

Cross-channel coordinator still decides current eligibility.

---

# 14. EXCLUSIONS

Examples:

- existing customers
- Account DNC
- prior disqualified reason
- chains/franchises if strategy excludes
- home-based businesses for field route
- specific companies/domains
- competitors/vendors
- low-fit service subcategories.

Exclusion has reason/source.

---

# 15. CAMPAIGN OBJECTIVE

Examples:

- protect paid demand
- website foundation
- missed-call/phone workflow
- CRM/follow-up
- attribution
- reactivation
- market research
- field sales.

Objective can influence hypothesis ranking but cannot create unsupported pain.

---

# 16. VERSIONING

Changes create campaign version:

- geography
- min tier
- query families
- provider routing
- budget
- outreach mode
- channels.

Historical prospects/calls keep original version.

---

# 17. PAUSE / KILL

Admin controls:

- pause mining
- pause enrichment
- pause assignment
- pause outreach
- archive campaign.

Global dial kill switch is separate and higher authority.

---

# 18. CAMPAIGN HEALTH

Dashboard:

- discovery tasks
- unique Accounts
- Tier A/B
- ready inventory
- research completeness
- decision-maker rate
- provider cost
- saturation
- downstream rep activity
- qualified/meeting/opportunity where applicable.

---

# 19. CAMPAIGN REVIEW

Before starting:

- vertical profile valid
- geography valid
- provider budget
- signals achievable
- min tier
- exclusions
- assignment team
- outreach/channel policy
- compliance mode
- no hidden assumptions.

---

# 20. ACCEPTANCE TESTS

1. Advertiser-only with no current ad evidence -> Account not eligible, not falsely negative globally.
2. Target 250 but 80 qualified -> outputs 80 + shortfall.
3. Research-only -> no communication jobs.
4. Human Assist -> rep queue available, no autonomous calls.
5. Event market -> research activates only under event policy.
6. No-website campaign -> verified website absence required to use site-specific hook.
7. Existing customer -> excluded from cold campaign.
8. Campaign changes min tier -> new version; old history intact.
9. Provider budget exceeded -> mining pauses/degrades safely.
10. Campaign asks autonomous mode while global gate off -> remains blocked.

---

# 21. CORE RULE

Campaign configuration tells the Prospect Factory what business objective to pursue. It never gets to weaken truth, identity, suppression, scoring, or safety rules to hit a volume target.
