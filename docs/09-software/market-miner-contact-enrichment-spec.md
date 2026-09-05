# Your AI Department — Market Miner Decision-Maker / Contact Enrichment Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Define how a researched company becomes a contactable sales prospect without confusing company identity, person identity, role relevance, or endpoint quality.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

The Market Miner first decides:

> Is this company worth contacting?

Then:

> Which role/person most likely owns the business process YAD wants to investigate?

Then:

> What truthful business contact path is available?

Do not spend premium person-enrichment credits on every raw discovered company.

Do not require Apollo for Human Assist.

---

# 2. CURRENT DEFAULT — PUBLIC FIRST

Default YAD enrichment mode:

`PUBLIC_ONLY`

Recommended cascade:

1. Account discovered/deduped.
2. Basic website research.
3. Preliminary YAD fit/Tier.
4. Select target role from opportunity hypothesis + vertical profile.
5. Search first-party team/leadership/contact evidence.
6. Search approved public company/entity records.
7. Search approved public licensing/professional records where relevant.
8. Run bounded public search-result discovery for target roles.
9. Resolve public business phone/email endpoints.
10. Produce named-person + company-route or role-only company-route if no direct endpoint exists.
11. Use gatekeeper/prospect feedback to improve contact memory.
12. Only if campaign policy allows and Account value justifies it, use Apollo/equivalent as optional paid fallback.

Read:

- `outbound-sales-brain-public-decision-maker-resolution-spec.md`
- `outbound-sales-brain-public-contact-source-registry.v1.yaml`
- `outbound-sales-brain-contact-waterfall-spec.md`
- `outbound-sales-brain-contact-endpoint-quality-spec.md`

---

# 3. ROLE SELECTION IS PROBLEM-SPECIFIC

Use vertical profile role maps.

## HVAC examples

Missed calls / after-hours:

- operations/service manager
- office/CSR manager
- GM
- owner for smaller firms.

Replacement follow-up:

- sales/replacement manager
- GM
- owner.

Attribution:

- marketing
- GM/operations
- owner depending organization.

## Plumbing examples

Urgent call handling:

- service/operations/dispatch manager
- GM
- owner.

Larger estimate follow-up:

- sales/estimating leadership
- GM
- owner.

Do not blindly target CEO/Owner if another current role clearly owns the workflow.

---

# 4. CONTACT RECORD

Required/optional fields:

- contact ID
- account ID
- location/scope optional
- full name
- first/last name
- raw title
- normalized role category
- company relationship type
- seniority/department optional
- employer match
- role relevance
- currentness
- source/evidence IDs
- last resolved
- refresh due
- suppression state.

Endpoint values live in ContactEndpoint records rather than being flattened into one ambiguous Contact row.

Never fill unknown fields with guessed names, titles, phones, or verified-looking emails.

---

# 5. SOURCE PRECEDENCE

For current title/employment, consider:

1. fresh prospect/gatekeeper confirmation;
2. fresh first-party company team/leadership evidence;
3. fresh public government/license record where it actually supports the relationship;
4. fresh public professional/business evidence;
5. approved licensed contact provider if enabled;
6. older public/provider evidence;
7. AI inference only as a candidate, never canonical fact without supporting evidence.

For endpoint ownership:

1. prospect/gatekeeper supplied business endpoint;
2. explicit current first-party business endpoint;
3. suitable public business source;
4. licensed provider assertion if enabled;
5. guessed/constructed endpoint remains unverified.

---

# 6. PUBLIC CONTACT RESEARCH

Look for:

- About/Team/Leadership
- public staff directory
- management bios
- location leadership
- public PDFs
- entity/DBA records
- officers/managers where exposed
- licenses/qualifiers where relevant
- chamber/trade/professional profiles where permitted
- company press/news
- bounded search queries around the exact Account + target role.

Every useful claim retains source + timestamp.

Do not scrape private/staff-only/login-gated sources by bypassing controls.

---

# 7. REGISTERED AGENT / LICENSE SAFETY

Registered agent:

- is a relationship type;
- is not owner/POC automatically;
- must not become cold outreach target solely because filing names it.

License holder / qualifier:

- can strongly support person-company relationship;
- does not automatically prove workflow ownership or company ownership;
- must be routed according to the actual hypothesis.

---

# 8. OPTIONAL LICENSED PROVIDER ADAPTER

Provider support is optional.

Core operations when enabled:

- search people by Account/domain;
- filter role/seniority;
- retrieve provider-authorized business contact fields;
- record provider person ID;
- record provider freshness/confidence semantics;
- record credit/cost usage.

Core domain model must not depend on Apollo-specific field names.

If no provider credentials exist, Market Miner/portal remains fully functional in PUBLIC_ONLY mode.

---

# 9. TARGET ROLE RANKING

Rank candidate contacts using:

1. relevance to primary hypothesis;
2. current ownership of workflow;
3. authority;
4. account/location scope match;
5. evidence currentness;
6. contactability;
7. prior prospect/gatekeeper confirmation.

Do not make owner an automatic infinity score.

---

# 10. CONTACT CONFIDENCE DIMENSIONS

Keep separately:

## Employer Match

- confirmed
- likely
- uncertain
- historical
- conflicted.

## Role Relevance

- primary process owner
- strong stakeholder
- valid fallback
- weak.

## Currentness

- fresh
- aging
- stale
- unknown.

## Endpoint Person Relationship

- direct confirmed
- direct provider asserted
- company route
- location route
- role inbox
- unverified.

Do not collapse to an opaque percentage.

---

# 11. UNKNOWN DECISION-MAKER

Valid Human Assist Call Pack:

- contact name unknown
- target role = Operations / GM
- verified main business phone.

Gatekeeper objective:

> Who normally owns inbound lead handling / operations / sales follow-up?

Success may be correct-person discovery.

Do not discard a Tier A Account because no named person or direct mobile exists.

---

# 12. NAMED PERSON, NO DIRECT NUMBER

Also valid:

- `John Smith — Owner`
- strong current relationship evidence
- no public direct number
- current official main business phone
- route = ask for John Smith.

Never attach the company main line to John as `DIRECT_BUSINESS_LINE` without explicit evidence.

---

# 13. MULTI-LOCATION / FRANCHISE

Account may have:

- corporate leadership
- regional operations
- location manager
- local franchisee leadership.

Contact should link to appropriate Account/Location scope.

Do not target corporate leadership for a local branch workflow unless control evidence supports it.

Do not assume local franchise owner is corporate employee.

---

# 14. PHONE TYPES

Distinguish:

- main business
- location
- direct business
- extension
- mobile asserted business
- toll-free
- tracking number
- unknown.

Phone type/contact evidence does not decide autonomous call legality/policy.

---

# 15. EMAIL TYPES

Distinguish:

- named/direct business email
- role/business inbox
- general business email
- provider-supplied email if enabled
- guessed/unverified.

Do not send merely because an address string exists.

---

# 16. EMAIL GUESSING

Pattern inference may be stored only as `GUESSED_UNVERIFIED` if policy permits.

It must not:

- display as verified;
- auto-export under a verified-email requirement;
- be described as publicly found.

Verification is a separate adapter/process.

---

# 17. STALE CONTACT

Refresh triggers:

- role evidence exceeds TTL
- website no longer lists person
- public evidence conflicts
- email bounce
- wrong-number feedback
- gatekeeper says person left
- Account becomes active opportunity and existing contact is aging.

Preserve historical relationship; do not erase provenance.

---

# 18. CONTACT COST CONTROL

Track public and paid costs separately:

- search/crawl cost
- LLM extraction cost
- public named-person fill
- public email/direct-phone fill
- main-line route rate
- optional provider lookup cost
- decision-maker reach rate
- meetings by contact source.

Key metric:

`contact_resolution_cost_per_decision_maker_reached`

Do not optimize solely for row fill rate.

---

# 19. ENRICHMENT DEPTH

## Company-only

Low-priority / discovery stage.

## Public Basic

First-party website role/name search.

## Public Standard

First-party + bounded public company/license/search evidence.

## Public Deep

Tier A / high-value account receives deeper public-source reconciliation.

## Paid Optional

Only when direct endpoint value justifies incremental cost and campaign permits it.

---

# 20. DUPLICATE CONTACT RESOLUTION

Same person may appear in multiple sources.

Merge Contact when strong identity supports it.

Preserve every source identity/evidence reference.

Do not merge common names across companies without strong evidence.

---

# 21. CONTACT SUPPRESSION

Suppression may apply to:

- endpoint
- person/contact
- Account/company
- email
- campaign.

Re-research or paid enrichment must never recreate a suppressed target as a new cold record while suppression still applies.

---

# 22. HUMAN CORRECTION

Rep can record:

- correct title
- person left
- correct decision-maker
- preferred department
- wrong direct line
- new extension
- business email supplied.

Prospect/gatekeeper correction updates current routing while preserving source history.

---

# 23. ACCEPTANCE FIXTURES

Use:

`outbound-sales-brain-public-contact-resolution-fixtures.v1.yaml`

Required behaviors include:

- current owner + main line != direct owner number;
- registered agent != owner;
- qualifier supports relationship but not automatic workflow ownership;
- Operations may outrank Owner for operational hypothesis;
- stale directory loses to current company evidence;
- role-only route remains sales-ready;
- explicit company-published direct endpoint can be direct-confirmed;
- dubious personal-number source rejected;
- guessed email not verified;
- gatekeeper correction updates routing;
- franchise scope respected;
- Apollo unavailable does not block Human Assist.

---

# 24. ACCEPTANCE TEST

For manually reviewed Tier A/B sample measure:

- current person/title precision
- role relevance precision
- account/location scope precision
- public named-person rate
- public direct endpoint fill
- verified main-line fallback rate
- registered-agent false-positive rate
- stale-person error rate
- decision-maker reach rate
- optional provider incremental lift if later enabled.

The objective is useful, trustworthy routing—not maximum personal-data collection.

---

# 25. CORE RULE

**YAD resolves the right business stakeholder from first-party/public evidence first and treats paid contact databases as optional accelerators. A truthful role/name + verified company route is a valid result.**
