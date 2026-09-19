# Your AI Department — Vertical Profile Generation & Governance Process

**Status:** Architecture authority  
**Purpose:** Define how YAD converts additional Sales Manual industry playbooks into machine-readable Market Miner/call-strategy profiles after HVAC and Plumbing prove the schema.

---

# 1. PRINCIPLE

The Sales Manual remains the human-readable authority.

A vertical YAML profile is a compiled/structured operational representation used by software.

Do not allow a profile to drift into a separate industry doctrine.

---

# 2. WHEN TO ADD A VERTICAL

Only after:

- HVAC profile loads/works;
- Plumbing profile loads/works;
- Market Miner Gate 7 passes;
- profile fields proven useful;
- schema pain points identified.

Then add verticals based on business priority, not simply module order.

---

# 3. CANDIDATE NEXT VERTICALS

Likely YAD priorities from existing Sales Manual/business strategy:

- Roofing
- Collision Repair
- PDR/Hail
- Law Firms
- Real Estate Brokerages
- Dental
- Med Spas
- Assisted Living

Final order is a business decision.

---

# 4. SOURCE REVIEW

For each new vertical read:

1. vertical Sales Manual module;
2. Module 4C scoring;
3. Hooks module;
4. CRM fundamentals;
5. discovery/ROI doctrine;
6. objection handling;
7. relevant evidence register entries;
8. launch decisions/current commercial truth.

Do not generate profile from general industry knowledge alone.

---

# 5. EXTRACTION CHECKLIST

Extract:

- business model/revenue categories
- customer types
- high-value services
- recurring revenue
- urgency/seasonality
- lead types
- customer journey
- CRM/system families
- strong public signals
- Google search query families
- exclusions/classification traps
- leakage hypotheses
- hooks
- discovery questions
- ROI tools
- objection guidance
- safety/professional boundaries
- no-sale conditions
- decision-maker roles
- research requirements.

---

# 6. SEARCH TAXONOMY DESIGN

For each vertical define:

## Core category queries

Broad business discovery.

## High-intent/urgent queries

Service need with immediate purchasing intent where applicable.

## High-ticket queries

Services/cases/projects likely to create meaningful economics.

## Financing/offer queries

If industry uses them.

## Specialty/practice-area queries

Examples:

- personal injury lawyer
- roof replacement
- dental implants.

## Negative terms

Exclude suppliers, schools, manufacturers, irrelevant specialties, DIY/content sites, directories where appropriate.

---

# 7. PUBLIC SIGNAL DESIGN

Every public signal must answer:

- what source can confirm it?
- what exactly does it mean?
- which hypothesis does it support?
- can it support a canonical Module 4C score rule?
- what can caller safely say?
- what must remain unknown?

Avoid vague signal names such as:

`bad_marketing`.

---

# 8. HYPOTHESIS DESIGN

Each hypothesis includes:

- business problem category
- trigger signals
- disqualifying/strong-process signals
- verification questions
- primary/backup hook templates
- solution categories
- ROI tool
- prohibited assumptions.

Profile should make it easy for strategy engine to ask:

> What is worth investigating?

not:

> What product can we force-sell?

---

# 9. PROFESSIONAL / SAFETY BOUNDARIES

Some verticals need stricter boundaries.

Examples:

## Law

- no legal advice
- confidentiality
- professional advertising/intake boundaries
- retained-client decisions/human oversight.

## Medical/Dental/Med Spa

- clinical decisions stay human/qualified
- privacy/health information controls.

## Financial services

- investment/credit/fiduciary decisions human/licensed where required.

## Assisted living

- care/clinical eligibility decisions human.

Boundaries must be explicit machine-readable fields used by prompt compiler/QA.

---

# 10. CRM / SYSTEM FAMILY DESIGN

List commonly encountered systems only when useful.

Purpose:

- detect frontend/public clues;
- ask intelligent questions;
- apply incumbent-safe positioning.

Never build “system detected = broken” behavior.

---

# 11. ROI TOOL MAPPING

Map existing calculator types first.

Examples:

- missed call
- speed-to-lead
- unsold estimate/proposal
- no-show
- reactivation
- employee capacity
- attribution.

Create a new calculator only when the business economics genuinely differ.

Do not duplicate same formula under 20 vertical names.

---

# 12. SCORE DISCIPLINE

Module 4C remains canonical across verticals.

Profile can define:

- how to recognize high-value economics;
- how to recognize intake/estimate-heavy process;
- strong phone dependence;
- additional queue-priority signals.

Profile does not silently create extra canonical score points.

---

# 13. PROFILE TEST FIXTURES

Every new vertical gets at least:

- strong advertiser Tier A case
- non-advertiser good-fit case
- low-fit case
- pixel-not-ad case
- system-signal-not-workflow case
- primary hypothesis case
- no-sale case
- professional/safety boundary case
- wrong-category exclusion case.

---

# 14. SEARCH QUERY REVIEW

Before running at scale:

- manually run/review sample queries;
- identify aggregators/directories;
- confirm terminology customers actually use;
- review sponsored result mix;
- adjust negative terms;
- benchmark provider parsing.

Do not assume manual's illustrative terms are sufficient for every market.

---

# 15. PROFILE VALIDATION

Automated:

- YAML/schema validation
- required fields
- unique IDs
- referenced hypothesis IDs exist
- referenced ROI tools exist
- canonical score mappings valid
- no forbidden extra score rules.

Human:

- Sales Manual fidelity
- hook quality
- public-signal safety
- industry realism
- professional boundary completeness.

---

# 16. VERSIONING

Semantic profile version.

Material changes:

- query taxonomy
- scoring recognition
- safety boundary
- hypothesis
- system family
- decision-maker ranking.

Every Call Pack records profile version.

Do not mutate old profile versions used by historical calls without preserving source commit/hash.

---

# 17. MANUAL CHANGE DETECTION

If vertical Sales Manual module changes:

- flag profile for reconciliation;
- do not automatically synthesize and deploy new profile;
- human/architecture review updates YAML;
- run fixtures/regression;
- release new profile version.

---

# 18. FIELD FEEDBACK

Real sales outcomes can propose profile changes:

- better search term
- irrelevant query
- better decision-maker role
- common objection
- common system
- missing leakage point.

Proposals require review against Sales Manual/company truth.

Do not let learned model silently modify profile source.

---

# 19. PROFILE GENERATION ASSISTANT

Claude can help draft profile from manual, but process must:

1. cite/extract source sections;
2. mark inferred fields;
3. validate against schema;
4. run tests;
5. human review;
6. commit version.

LLM draft is not automatically production profile.

---

# 20. ACCEPTANCE

A new vertical is ready when:

- valid profile
- source mappings
- query sample verified
- classification false-positive traps tested
- score fixtures pass
- hooks grounded
- boundaries tested
- Market Miner produces manually reviewed real companies in one market
- Human Assist Call Packs make sense to a salesperson familiar with the vertical.
