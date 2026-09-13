# Your AI Department — Market Miner Data Quality SLO Specification

**Status:** Architecture authority  
**Purpose:** Define measurable research-quality targets so Market Miner is judged by correctness and sales usefulness, not only number of businesses found.

---

# 1. PRINCIPLE

A list of 10,000 noisy companies is worse than 500 accurate, ranked, explainable prospects.

Market Miner quality must be measured on sampled truth.

Core dimensions:

- identity accuracy
- vertical accuracy
- paid-ad accuracy
- website/CTA accuracy
- entity deduplication
- score arithmetic
- evidence freshness
- contact accuracy
- hook grounding.

---

# 2. SLO VS SLA

These are internal engineering SLOs, not customer promises.

They can be tightened as the system matures.

Do not publish these as marketing guarantees.

---

# 3. BUSINESS CATEGORY PRECISION

Metric:

`correct_target_vertical_accounts / manually_reviewed_ready_accounts`

Initial Gate 7 target:

>=95%.

Critical false positives include:

- HVAC supply house
- auto AC shop
- plumbing school
- directory/lead aggregator misclassified as local contractor.

---

# 4. CANONICAL DOMAIN PRECISION

For records where canonical domain resolved:

`correct_domain / manually_reviewed_resolved_domains`

Initial target:

>=95%.

Wrong domain is high severity because it corrupts all downstream research.

---

# 5. BUSINESS PHONE PRECISION

For records labeled verified business phone:

`correct_phone_for_account_or_location / reviewed_phones`

Target:

>=95%, with zero known cross-company misroutes in controlled acceptance sample.

Tracking numbers are okay if identity/role is understood and contact policy permits use; label them correctly.

---

# 6. PAID-AD CLASSIFICATION PRECISION

`correct_paid_observations / reviewed_observations_classified_paid`

Target:

>=95% initial; strive higher.

Hard fail patterns:

- organic classified paid
- pixel/tag converted into current ad
- stale ad stated current.

---

# 7. FALSE NEGATIVE LANGUAGE RATE

Measure whether system incorrectly asserts:

- “not advertising”
- “no CRM”
- “no website”

from mere failed detection.

Target:

0 material false-negative claims in acceptance sample.

Unknown is correct when evidence absent.

---

# 8. ENTITY DUPLICATE RATE

Sample ready inventory for duplicate Accounts representing same operational business.

Metric:

`duplicate_account_pairs / reviewed_ready_accounts`

Goal:

very low; zero critical duplicate-outreach risk in first acceptance sample.

Track separately:

- harmless duplicate awaiting review
- duplicate eligible for outreach (critical).

---

# 9. FALSE MERGE RATE

More serious than some duplicates.

`incorrectly_merged_distinct_businesses / reviewed_merges`

Target:

approach zero.

Use conservative thresholds and review ambiguous franchise/common-name cases.

---

# 10. SCORE ARITHMETIC

For evidence inputs:

- deterministic rule result must be exact.

Target:

100% fixture pass.

Any arithmetic discrepancy is code bug, not model uncertainty.

---

# 11. SCORE EVIDENCE COVERAGE

`awarded_score_components_with_valid_evidence / awarded_components`

Target:

100%.

No score point may exist only because model said so.

---

# 12. CTA EXTRACTION PRECISION

Sample:

- phone CTA
- form
- booking
- quote/estimate
- chat/SMS.

Initial target:

>=95% precision on high-value CTA types.

Recall can be improved later; false claim about a lead flow is more damaging than missing one secondary CTA.

---

# 13. 24/7 / EMERGENCY PRECISION

For confirmed `emergency_24_7_service`:

>=98% preferred because hook often uses it directly.

Do not conflate:

- emergency service offered
- live answer 24/7.

---

# 14. PHYSICAL LOCATION PRECISION

Measure:

- correct number/location relationship
- no service-city list counted as physical offices.

Target:

>=95% on reviewed ready Accounts.

Franchise ambiguity flagged rather than guessed.

---

# 15. TECHNOLOGY SIGNAL PRECISION

For provider-specific frontend signals:

- ServiceTitan
- Housecall Pro
- HubSpot
- CallRail
- Meta Pixel
- Google tags.

Target:

>=95% precision for `confirmed` signatures.

Likely/ambiguous patterns should not be upgraded to confirmed to hit coverage.

---

# 16. BACKEND WORKFLOW FALSE-CLAIM RATE

Target:

0.

No frontend signal should produce:

- “your CRM doesn't follow up”
- “every lead goes into ServiceTitan”
- “your attribution is broken”

without prospect/system evidence.

---

# 17. CONTACT PRECISION

For `confirmed current decision-maker/contact`:

measure manually/provider feedback:

- employed at company
- title/role current
- company/location association.

Initial target:

>=90–95% depending provider; report uncertainty honestly.

If provider cannot support high confidence, label likely/stale and use gatekeeper path.

---

# 18. RESEARCH FRESHNESS SLO

For Call Packs using current-ad opener:

100% of referenced ad evidence must be within configured current TTL at time of pack generation/contact preflight.

For time-sensitive offers:

refresh according claim registry.

---

# 19. HOOK EVIDENCE GROUNDING

`research_specific_hooks_with_valid_supporting_evidence / research_specific_hooks`

Target:

100%.

Generic vertical-specific question may require business classification but not specific paid-ad evidence.

---

# 20. CALL PACK UNKNOWN DISCIPLINE

Sample unknown fields:

- ad spend
- missed-call rate
- CRM workflow
- lead volume.

Target:

0 unknowns promoted to fact without new prospect/system evidence.

---

# 21. PROVIDER PARSER ERROR RATE

Track:

- schema parse failures
- unknown result types
- missing geography
- provider task failures.

Sudden spike triggers adapter degradation review.

Do not silently skip parse errors and report complete research.

---

# 22. RESEARCH COMPLETENESS CALIBRATION

A record labeled `complete` should genuinely include all campaign-required research components.

Audit false-complete rate.

Target:

0 missing required components labeled complete.

---

# 23. MANUAL AUDIT SAMPLING

During first markets:

- random sample >=20 ready Accounts per acceptance run
- oversample edge cases separately:
  - franchise
  - multi-location
  - LSA
  - aggregator-like
  - system signal
  - no website/contact.

Random sample measures overall quality; edge-case sample finds failure modes.

Do not blend them into one misleading percentage without noting sampling method.

---

# 24. QUALITY TREND

Weekly:

- sample precision
- correction rate
- wrong-category rate
- duplicate rate
- ad-parser accuracy
- contact correction rate
- hook grounding failures.

A growing database does not excuse degrading data quality.

---

# 25. CORRECTION FEEDBACK

Rep/prospect correction becomes labeled quality event:

- category correction
- contact correction
- system correction
- ad correction
- location correction.

Track by source/provider/parser version.

This helps identify where the bad data originates.

---

# 26. CIRCUIT BREAKERS

Examples:

- paid-ad precision sample drops below threshold -> disable provider-specific ad hooks until reviewed
- duplicate outreach critical incident -> pause affected campaign
- domain precision collapses -> stop deep research spending on affected resolver.

Quality SLOs should be operational controls, not just reports.

---

# 27. FIRST MARKET PASS

Jacksonville/St. Augustine HVAC acceptance pack controls exact initial targets.

At minimum:

- category >=95%
- domain >=95%
- paid-ad precision >=95%
- score arithmetic 100%
- backend CRM false claims 0
- pixel-to-active-ad false inference 0
- current-ad hook with stale evidence 0.

---

# 28. SCALE GATE

Before expanding from one market into large multi-state mining:

- first market meets SLO or has explicit approved exception
- major edge cases addressed
- provider economics acceptable
- correction feedback loop working.

Do not scale known bad data faster.
