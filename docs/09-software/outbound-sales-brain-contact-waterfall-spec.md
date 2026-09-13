# Your AI Department — Contact / Decision-Maker Waterfall Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Turn a researched company into one or more trustworthy human/business contact paths for YAD reps to call and email without requiring Apollo or another paid people database.  
**Implementation owner:** Claude Code

---

# 1. CORE QUESTION

For every sales-ready Account answer:

> Who is the best person/role for the active business hypothesis, and what truthful business phone/email path can YAD actually use to reach them?

The system must not stop at company discovery if public research can responsibly improve contactability.

It also must not fabricate a person, title, email pattern, or direct number merely to make the record look complete.

---

# 2. CURRENT PRODUCT DECISION

Default YAD contact-enrichment mode:

`PUBLIC_ONLY`

Apollo/equivalent is an optional fallback, not a required stage.

Canonical V1 waterfall:

`Qualified Account`
-> `Target role selection`
-> `Company first-party research`
-> `Public company/entity records`
-> `Public licensing/professional records`
-> `Search-indexed public business evidence`
-> `Public business endpoint discovery`
-> `Named person + main-line route OR role-only main-line route`
-> `Gatekeeper/prospect learning`
-> `Optional paid enrichment if campaign economics justify it`.

Read the deeper authority:

`outbound-sales-brain-public-decision-maker-resolution-spec.md`

---

# 3. CONTACT TARGET STARTS WITH PROBLEM OWNERSHIP

The target role is selected from the active opportunity hypothesis.

Examples:

## Missed calls / after-hours / dispatch

Possible priority roles:

- Operations Manager
- Office / CSR Manager
- Service Manager
- Dispatch Manager
- GM
- Owner for smaller companies

## Unsold estimates / proposals

- Sales Manager
- Sales Director
- GM
- Owner
- Estimating Manager where appropriate

## Paid marketing / attribution

- Marketing Director
- Growth / Marketing Manager
- Operations / GM
- Owner / President for smaller company

## Law intake

- Intake Director
- COO / Firm Administrator
- Managing Partner
- Marketing Director where the issue is acquisition attribution

## Real estate lead nurture

- ISA / Lead Manager
- Sales Manager
- Team Leader / Broker
- Operations

Do not blindly target `owner` when another role clearly owns the workflow.

---

# 4. PUBLIC-FIRST CONTACT WATERFALL

## Stage A — First-party company website

Look for:

- Team / Leadership
- About
- Contact
- Locations
- management bios
- public staff directories
- role-specific email addresses
- public direct business numbers
- public PDFs
- structured data.

Advantages:

- current first-party evidence
- clear employer relationship
- explicit business endpoints where published.

Preserve source URL/timestamp.

## Stage B — Public company/entity records

Use approved government/public registries for identity clues.

Possible evidence:

- legal entity
- manager/member/officer
- filing status
- DBA
- registered agent
- principal/business address.

Important:

**Registered agent does not equal decision-maker.**

Do not normalize a registered-agent service or law firm into owner/GM/POC solely because a filing names it.

## Stage C — Public licensing/professional records

Where relevant and permitted, use public records identifying:

- qualifier
- contractor/license holder
- responsible professional
- professional role
- current license relationship.

A qualifier proves a type of company/person relationship; it does not automatically prove that person owns marketing, calls, dispatch, intake, or daily operations.

## Stage D — Search-indexed public business evidence

Use bounded searches around the known Account/domain/target roles.

Examples:

- `"Company Name" owner`
- `"Company Name" president`
- `"Company Name" operations manager`
- `"Company Name" general manager`
- `site:company.com team`
- vertical-specific roles such as `intake director`, `sales manager`, `ISA manager`.

Possible approved source evidence:

- company press releases
- chambers / associations
- trade directories
- conference/speaker bios
- reputable business news
- public professional/business pages where terms permit.

Do not bypass login gates, CAPTCHA, anti-bot controls, or source restrictions.

## Stage E — Public business endpoint discovery

Look for:

- explicit direct business phone
- extension
- named business email
- department email
- location phone
- main company line.

Do not infer that a main company number is a named person's direct line.

## Stage F — Verified role/main-line route

If the named person is known but no direct endpoint exists:

> `Sarah Jones — Operations Manager; call verified main line and ask for Sarah.`

If no person is known:

> `Target role: Operations / GM; call verified main line and ask who oversees inbound lead handling / operations.`

These are valid Human Assist outcomes.

## Stage G — Gatekeeper/prospect learning

If a receptionist/gatekeeper/stakeholder provides:

- name
- title
- extension
- best time
- business email
- person-left-company correction

store it as structured prospect/gatekeeper-supplied evidence.

Fresh direct-business correction should outrank stale directory data for future routing.

## Stage H — Optional licensed provider

Examples:

- Apollo
- approved equivalent.

Use only when:

- Account value justifies cost;
- public resolution did not produce adequate direct contactability;
- campaign policy enables paid enrichment;
- provider license supports intended use.

Paid provider data remains provider-asserted/provider-verified according to actual semantics.

If Apollo is unavailable, the Market Miner and Human Assist portal must continue working.

---

# 5. CONTACT CANDIDATE OBJECT

```text
ContactCandidate
- contact_candidate_id
- account_id
- person_name optional
- first_name optional
- last_name optional
- job_title optional
- normalized_role_category
- company_relationship optional
- department optional
- seniority optional
- business_email optional
- email_quality/status
- phone optional
- phone_quality/status
- extension optional
- endpoint_person_relationship
- source_type
- source_reference
- source_provider optional
- observed_or_verified_at
- employer_match
- role_match
- currentness
- location/scope match
- license/retention metadata
- notes
```

---

# 6. CONTACT CONFIDENCE DIMENSIONS

Do not collapse everything into one confidence score.

Track separately:

## Employer Match

- confirmed
- likely
- uncertain
- historical
- conflicted

## Role Match

- primary process owner
- strong stakeholder
- valid fallback
- weak/general

## Recency

- fresh
- aging
- stale
- unknown

## Endpoint Relationship

- direct confirmed
- direct provider asserted
- company route
- location route
- role inbox
- unverified

This allows:

> Sarah is definitely Operations Manager, but we only have the main business number.

without pretending a direct number exists.

---

# 7. CONTACT PRIORITY

Conceptual ordering:

1. prospect/gatekeeper-confirmed current stakeholder with useful endpoint;
2. current first-party decision-maker with explicit direct business endpoint;
3. current first-party decision-maker + verified company route;
4. strong public-source decision-maker + company route;
5. likely current decision-maker + appropriate endpoint;
6. correct target role + verified main business line;
7. optional paid-enrichment candidate;
8. human review.

Never rank a stale named contact above a current verified role route just because personalization looks better.

---

# 8. MULTIPLE CONTACTS

One Account can have several useful contacts.

Example HVAC company:

- Owner
- Operations Manager
- Marketing Director.

Primary contact depends on current hypothesis/campaign.

Store alternatives for:

- gatekeeper referral
- no response
- stakeholder expansion
- meeting invitation.

Do not blast all contacts simultaneously by default.

---

# 9. BUSINESS PHONE RESOLUTION

Phone candidate sources may include:

- company website
- public business/government record where appropriate
- approved public directory
- prospect/gatekeeper supplied
- optional licensed provider.

Normalize E.164.

Store source/freshness/type.

Distinguish:

- `MAIN_BUSINESS_LINE`
- `LOCATION_BUSINESS_LINE`
- `DIRECT_BUSINESS_LINE`
- `EXTENSION`
- `MOBILE_ASSERTED_BUSINESS`
- `CALL_TRACKING_NUMBER`
- unknown.

A phone type does not itself authorize autonomous calling.

---

# 10. EMAIL RESOLUTION

Preferred public-first sources:

- company-published named business email
- company team/bio
- public company PDF
- role/business email
- prospect/gatekeeper supplied email.

Optional provider email is permitted when provider mode is enabled.

Potential email states include:

- `YAD_CONFIRMED_DELIVERABLE`
- `PROVIDER_VERIFIED`
- `PUBLIC_OBSERVED_CURRENT`
- `ROLE_INBOX`
- `GUESSED_UNVERIFIED`
- `HARD_BOUNCE`
- `SUPPRESSED`.

Do not let `GUESSED_UNVERIFIED` silently become Smartlead-ready.

---

# 11. EMAIL GUESSING / VERIFICATION

A naming-pattern guess such as:

`first.last@company.com`

may exist only as `GUESSED_UNVERIFIED` if policy allows.

Verification is a separate step.

Do not let the LLM hallucinate likely email addresses and send them.

---

# 12. REGISTERED AGENT / QUALIFIER SAFETY

## Registered agent

- relationship type only;
- not owner by default;
- not decision-maker by default;
- not a cold sales contact solely from filing.

## License qualifier / license holder

- supports person-company relationship;
- may be strategically useful in some owner-operated businesses;
- does not automatically prove daily workflow ownership.

Require additional role evidence for strong personalized claims.

---

# 13. STALE CONTACT

If contact evidence is old or conflicting:

- mark aging/stale/conflicted;
- refresh when Account value justifies it;
- use current company/role route if available.

If receptionist says person left:

- record correction;
- age/close prior employment relationship;
- find current target;
- preserve history.

---

# 14. CONTACT COST CONTROL

Track:

- public search/crawl cost
- public named-person fill
- public direct-email fill
- public direct-phone fill
- verified-main-line fallback rate
- optional provider lookup cost
- contacts found
- high-confidence contacts
- decision-makers reached
- meetings by contact source.

Metric examples:

- `public_resolution_cost_per_named_target`
- `contact_enrichment_cost_per_decision_maker_reached`

Do not buy ten people records for a weak prospect.

---

# 15. ENRICHMENT DEPTH

## Company-only

Lower-priority or early discovery.

## Public Basic

Company website + target-role resolution.

## Public Standard

First-party + bounded public entity/license/search research.

## Public Deep

High-value Account: broader approved public-source reconciliation.

## Paid Optional

High-value Account where direct endpoint would materially help and campaign permits paid enrichment.

---

# 16. DUPLICATE CONTACT RESOLUTION

Same person may appear in several sources.

Merge when strong identity supports it.

Preserve every SourceIdentity/evidence item.

Do not merge common names across unrelated companies without strong evidence.

---

# 17. CONTACT SUPPRESSION

Suppression may apply to:

- phone endpoint
- email endpoint
- Contact
- Account
- campaign.

Public or paid re-research must never recreate a suppressed endpoint/person as a new cold target while suppression still applies.

---

# 18. HUMAN CORRECTION

Rep can record:

- correct title
- person left
- correct decision-maker
- best department
- wrong number
- new extension
- business email supplied.

Prospect/gatekeeper corrections update current read models while preserving source history.

---

# 19. MANAGER / REP FILTERS

Support filters such as:

- Named decision-maker
- Named + direct business phone
- Named + email
- Any current business phone
- Phone + email
- Role-route only
- Public-only contacts
- Paid-enriched contacts
- Contact research needed.

If only 28 Accounts meet `Named + Direct Phone`, return 28.

Do not pad results with company main lines mislabeled as direct numbers.

---

# 20. REGRESSION TESTS

Use:

`outbound-sales-brain-public-contact-resolution-fixtures.v1.yaml`

At minimum prove:

1. current owner + main line => named main-line route, not direct;
2. registered agent => never automatic owner/POC;
3. qualifier + founder evidence => strong relationship but hypothesis routing still applies;
4. current Operations Manager beats owner for operations hypothesis when appropriate;
5. stale owner conflict => current evidence wins;
6. no named person => role-route remains valid;
7. explicit business-published direct number => direct confirmed;
8. dubious personal-number source => rejected;
9. guessed email => not verified/Smartlead-ready;
10. gatekeeper correction => future routing updates;
11. franchise local scope => local stakeholder over unrelated corporate exec;
12. Apollo unavailable => Human Assist still works.

---

# 21. CORE RULE

**The brain should maximize trustworthy business contact paths. Public evidence and role routing come first; paid people-data providers are optional accelerators, not dependencies. An honest main-line route to the correct person/role is better than a fabricated direct contact.**
