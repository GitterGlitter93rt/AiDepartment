# YAD Outbound Sales Brain — Public Decision-Maker Resolution Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Implementation owner:** Claude Code on EdgeXpert  
**Product decision:** YAD must be able to identify useful decision-makers and contact paths without depending on Apollo or another paid people database. Licensed enrichment remains an optional fallback, not a core dependency.

---

# 1. PURPOSE

The Decision-Maker Resolver answers two separate questions:

1. **Who appears to own the business process YAD wants to discuss?**
2. **What legitimate business contact path do we have to reach that person or role?**

These must remain separate.

A company may have a high-confidence current Operations Director while YAD only has the company's main business line.

That is still a useful sales record.

The system must never fabricate a direct phone, title, ownership status, or email simply because a rep would prefer one.

---

# 2. CORE PRODUCT DECISION — NO-APOLLO-FIRST

Default V1 resolution path:

`Qualified Account`
-> `Vertical + opportunity hypothesis`
-> `Target role ranking`
-> `First-party website research`
-> `Public business identity sources`
-> `Public professional / licensing sources`
-> `Search-indexed public business evidence`
-> `Public business endpoint discovery`
-> `Role/name + verified main-line fallback`
-> `Gatekeeper learning after human contact`
-> `Optional licensed enrichment only when justified`

Apollo/equivalent must not be required for:

- Account creation;
- YAD fit scoring;
- Tier assignment;
- decision-maker role selection;
- named person resolution when public evidence is sufficient;
- Human Assist call readiness through a verified business line;
- rep portal launch.

Paid enrichment can improve direct phone/email fill rate, but it is not the identity authority.

---

# 3. TWO OUTPUTS, NOT ONE

## DecisionMakerIdentity

Represents who the system believes is relevant.

Fields:

- `contact_id`
- `account_id`
- `person_name` optional
- `raw_title` optional
- `normalized_role_category`
- `company_relationship`
- `scope` (`ACCOUNT`, `REGION`, `LOCATION`, `MARKET`)
- `employer_match`
- `role_match`
- `currentness`
- `problem_ownership`
- `authority_class`
- `evidence_ids[]`
- `resolved_at`
- `refresh_due_at`
- `resolution_status`

## ContactPath

Represents how YAD may attempt to reach that person/role.

Fields:

- `endpoint_id`
- `contact_id` optional
- `account_id`
- `type`
- `value`
- `extension` optional
- `endpoint_quality`
- `endpoint_source`
- `source_reference`
- `observed_at`
- `verified_at` optional
- `relationship_to_person`
- `channel_readiness`
- `suppression_state`

Never imply a main company line is the person's direct line.

---

# 4. ROLE RESOLUTION COMES BEFORE PERSON SEARCH

Before searching names, the system asks:

> Which role is most likely to own the current YAD hypothesis?

Examples:

## HVAC / Plumbing

After-hours / missed calls:

1. Operations / Service Manager
2. Office / CSR Manager
3. GM
4. Owner for smaller firms

Paid acquisition / attribution:

1. Marketing
2. GM / Operations
3. Owner / President

Estimate / replacement follow-up:

1. Sales leadership
2. GM
3. Owner

## Roofing

Proposal follow-up:

1. Sales Manager
2. GM
3. Owner

Storm / paid-lead intake:

1. Operations / Sales
2. GM
3. Owner

## Law

Intake:

1. Intake Director
2. COO / Firm Administrator
3. Managing Partner

Advertising attribution:

1. Marketing
2. COO / Administrator
3. Managing Partner

## Collision

Estimate/front-office flow:

1. GM
2. Operations / CSR leadership
3. Owner

## Real Estate

Lead nurture:

1. ISA / Lead Manager
2. Sales Manager / Team Leader
3. Operations
4. Broker-owner

The resolver may still return an owner, but `owner` is not automatically the correct first stakeholder.

---

# 5. PUBLIC SOURCE WATERFALL

All adapters must comply with source terms, reasonable request rates, retention policy, and YAD's source-governance review.

## Stage A — Company first-party sources

Crawl approved public pages such as:

- About
- Team
- Leadership
- Staff
- Contact
- Locations
- service pages with named leadership
- press/news posts
- public structured data
- public PDFs hosted on company domain

Extract claims such as:

- `Jane Doe is President`
- `Mike Lee manages Jacksonville operations`
- `Sarah Jones is Director of Intake`

Preserve page URL and timestamp.

A current first-party team page is generally stronger current-employment evidence than an old third-party directory.

## Stage B — Public company / entity records

Use approved state/public registries where relevant.

Possible facts:

- legal entity name
- manager/member/officer names when actually exposed
- filing status
- principal/registered address
- entity relationship clues
- DBAs where available

Important:

**Registered agent does not equal decision-maker.**

A law firm or registered-agent service appearing in a corporate filing must never be promoted to company owner/GM merely because its name is present.

Entity records are identity evidence, not automatic sales-role evidence.

## Stage C — Public licensing / professional records

Useful for regulated verticals when current permitted public records identify:

- qualifying contractor
- license holder
- responsible professional
- facility/practice leadership where appropriate

Example:

A contractor license naming `John Smith` plus the company website saying `Founded by John Smith` can strongly reinforce identity.

A qualifier/license holder still does not automatically prove they run daily lead operations.

## Stage D — Search-indexed public business evidence

Run constrained search queries around the known company/domain.

Examples:

- `"ABC Air" owner`
- `"ABC Air" president`
- `"ABC Air" operations manager`
- `"ABC Air" general manager`
- `site:abcair.com team`
- `site:abcair.com owner`
- `"ABC Roofing" sales manager`
- `"Smith Law" intake director`

Permitted result sources may include:

- company press releases
- chamber/business association profiles
- public trade association profiles
- conference/speaker bios
- reputable business news
- public professional profiles where terms permit use

Do not bypass authentication/login gates or anti-bot controls.

## Stage E — Public business endpoint discovery

Look for explicitly business-published endpoints:

- direct business phone
- extension
- named business email
- department email
- location line
- main business line

Public endpoint evidence must remain provenance-labeled.

A number published as a business contact can be stored as a business endpoint; it is not automatically a personal/direct line unless the source explicitly supports that relationship.

## Stage F — Verified role-route fallback

If person resolution succeeds but no direct endpoint is found:

> `Jane Doe — Operations Director; reach through verified company main line.`

If no person can be confirmed:

> `Target role: Operations / GM; call verified company main line and ask for that role.`

This is a valid, sales-ready Human Assist record.

## Stage G — Gatekeeper / prospect learning

During human outreach, a receptionist or stakeholder may reveal:

- correct person
- role
- extension
- business email
- person left company
- best callback time

Store as structured prospect-supplied evidence.

This can outrank stale public evidence for future routing.

## Stage H — Optional paid enrichment

Only after the above or when campaign policy explicitly requests it.

Use Apollo/equivalent when:

- Account is valuable enough to justify cost;
- a direct endpoint materially improves outreach;
- public resolution did not produce adequate contactability;
- provider terms/license support intended use.

Paid data remains `PROVIDER_ASSERTED` / `PROVIDER_VERIFIED` according to its actual semantics.

It does not overwrite stronger prospect-confirmed evidence silently.

---

# 6. SEARCH QUERY PLANNER FOR PEOPLE/ROLES

The resolver should not issue random broad searches.

Inputs:

- canonical company name
- DBA names
- domain
- city/state
- vertical
- target roles
- location scope

Generate bounded query families:

## Ownership / leadership

- company + owner
- company + founder
- company + president
- company + CEO
- domain-scoped team/leadership search

## Operations

- company + operations manager
- company + general manager
- company + service manager
- company + office manager

## Sales / marketing

- company + sales manager
- company + marketing director
- company + business development

## Vertical specific

- law: intake director, firm administrator, COO
- real estate: broker owner, team leader, ISA manager
- hail/PDR: market manager, sales manager
- collision: general manager, MSO operations

Stop when:

- sufficient high-confidence target exists;
- query budget reached;
- results become repetitive/noisy;
- remaining role depth does not justify cost.

---

# 7. EVIDENCE GRAPH

Person resolution should use an evidence graph rather than one LLM answer.

Example:

```text
Account: ABC Air LLC
  |
  +-- website/team -> John Smith, Founder
  +-- state entity -> John Smith, Manager
  +-- contractor license -> John Smith, Qualifier
  +-- website/contact -> main phone
  +-- no direct phone evidence
```

Output:

- John Smith current company relationship: HIGH
- owner/founder relevance: HIGH
- direct phone: UNKNOWN
- main business route: CURRENT_BUSINESS_CONFIRMED

The system must be able to explain this output to a reviewer without exposing hidden model chain-of-thought.

---

# 8. REGISTERED AGENT TRAP

Corporate records frequently contain registered agents.

Rules:

- `registered_agent` is a relationship class, not a sales role;
- do not normalize `registered_agent` to owner/president/GM;
- if registered agent is also independently verified as owner/member/officer, keep both relationships as separate evidence;
- professional registered-agent firms are normally identity/filing metadata only;
- never personalize cold outreach to a registered agent solely because a public filing names them.

---

# 9. LICENSE HOLDER / QUALIFIER TRAP

A qualifier/license holder may be:

- owner
- employee
- partner
- responsible professional
- historical/stale

Rules:

- license relationship supports company/person association;
- require additional evidence before claiming operational ownership unless the source explicitly establishes it;
- route by current opportunity hypothesis, not simply by license seniority.

---

# 10. PUBLIC PERSONAL DATA BOUNDARY

The resolver is for business prospecting.

Do not collect unrelated personal information such as:

- home/family details
- personal financial information
- protected/sensitive attributes
- personal social content unrelated to business role
- personal phone numbers from dubious people-search/doxxing sources

If a mobile/direct number is explicitly published for business contact or supplied by an approved licensed provider, store it with source/type semantics.

The goal is useful business contact routing, not personal-data accumulation.

---

# 11. EMAIL DISCOVERY WITHOUT APOLLO

Allowed useful sources:

- named email on company site
- team bio
- public business PDF
- role inbox
- gatekeeper/prospect supplied email

Potential inferred email pattern:

- may be generated only as `GUESSED_UNVERIFIED` if product policy allows;
- must never be displayed as verified;
- must not automatically become Smartlead-ready unless campaign policy + verification step explicitly allow it.

Email verification is a separate adapter/problem.

---

# 12. DIRECT PHONE DISCOVERY WITHOUT APOLLO

Preferred public paths:

- explicitly named number on company leadership bio
- staff/department directory
- location page with extension
- public business card/PDF hosted by company
- public professional/business directory where use rights allow
- prospect/gatekeeper confirmation

If none exist, use the verified business line and known target name/role.

Do not degrade data quality just to populate `direct_phone`.

---

# 13. CONFIDENCE MODEL

Keep dimensions separate.

## Employer relationship

- `CONFIRMED`
- `LIKELY`
- `UNCERTAIN`
- `HISTORICAL`
- `CONFLICTED`

## Role relevance

- `PRIMARY_PROCESS_OWNER`
- `STRONG_STAKEHOLDER`
- `VALID_FALLBACK`
- `WEAK`

## Currentness

- `FRESH`
- `AGING`
- `STALE`
- `UNKNOWN`

## Endpoint-person relationship

- `DIRECT_CONFIRMED`
- `DIRECT_PROVIDER_ASSERTED`
- `COMPANY_ROUTE`
- `LOCATION_ROUTE`
- `ROLE_INBOX`
- `UNVERIFIED`

Do not collapse these to `confidence = 87%`.

---

# 14. RESOLUTION STATUS

Recommended output status:

- `NAMED_DIRECT_READY`
- `NAMED_EMAIL_READY`
- `NAMED_MAINLINE_ROUTE_READY`
- `ROLE_ROUTE_READY`
- `PUBLIC_RESEARCH_PARTIAL`
- `PAID_ENRICHMENT_OPTIONAL`
- `REVIEW_REQUIRED`
- `STALE_REFRESH_REQUIRED`

These are contact-resolution states, not YAD fit tiers.

---

# 15. COST / WORK BUDGET

Public research is not free even when no per-record vendor charge exists.

Track:

- search-provider/API cost
- crawler requests
- LLM extraction cost
- resolution elapsed time
- public-source hit rate
- named-person fill rate
- direct-email fill rate
- direct-phone fill rate
- main-line route rate
- decision-maker reach rate

Only deepen public research for Accounts whose campaign/fit justifies it.

Example depth:

- Tier C/D: company-level contact only
- Tier B: first-party + bounded public role research
- Tier A: deeper public resolution + optional paid enrichment fallback

---

# 16. SOURCE ADAPTER INTERFACE

Conceptual interface:

```text
resolvePeople(account, targetRoles, budget) -> PersonObservation[]
resolveEndpoints(account, people, budget) -> EndpointObservation[]
```

Each observation must include:

- source type
- source reference
- observed timestamp
- retention class
- raw relationship label
- extracted claim
- confidence basis

The adapter never directly decides final decision-maker priority.

The resolver reconciles observations.

---

# 17. REFRESH

Refresh named contacts when:

- first-party team page changes;
- public record conflicts;
- email bounces;
- phone wrong-number disposition;
- gatekeeper says person left;
- role evidence exceeds TTL;
- Account becomes a high-value opportunity and prior contact data is aging.

Do not rerun every source every day.

---

# 18. REP PORTAL PRESENTATION

Examples:

## Best case

> **Sarah Jones — Director of Operations**  
> Current role: company team page + public business evidence  
> Direct: 904-555-0188 — business-published  
> Email: sarah@company.com — company-published  
> **Recommended target for:** inbound/after-hours operations

## Named person, no direct phone

> **John Smith — Owner**  
> Current relationship: strong public evidence  
> Direct phone: not publicly found  
> Main line: 904-555-0100 — current official website  
> **Call route:** Ask for John Smith

## No named person

> **Target role:** Operations / GM  
> Named person: not verified  
> Main line: 904-555-0100  
> **Call route:** Ask who oversees inbound lead handling / operations

The second and third examples are not product failures.

---

# 19. PUBLIC-ONLY CAMPAIGN MODE

Support campaign flag:

`contact_enrichment_mode = PUBLIC_ONLY`

Other future modes:

- `PUBLIC_ONLY`
- `PUBLIC_THEN_PAID`
- `PAID_ALLOWED_FOR_TIER_A`
- `IMPORT_ONLY`

V1 default for YAD internal mining should be `PUBLIC_ONLY` until management explicitly enables a paid contact adapter.

---

# 20. ACCEPTANCE TARGETS

For a manually audited Tier A/B sample, measure separately:

- company identity precision
- named target precision
- target-role relevance
- public named-person fill rate
- public direct-email fill rate
- public direct-phone fill rate
- verified-main-line fallback rate
- false owner/role claims
- registered-agent false-positive rate
- stale-person error rate
- gatekeeper correct-person referral rate

A successful public resolver does not require 100% direct mobile fill.

Its job is to give reps the strongest truthful business route available.

---

# 21. HARD FAILS

Hard fail if the implementation:

- makes Apollo/equivalent mandatory for every Account;
- equates registered agent with owner/decision-maker;
- labels a company main line as a person's direct line;
- invents a name/title/email/phone;
- scrapes login-gated/private pages by bypassing controls;
- collects unrelated sensitive personal information;
- treats a license qualifier as operational decision-maker without supporting evidence;
- silently overwrites prospect-confirmed corrections with third-party data;
- marks guessed email as verified;
- disqualifies a Tier A company merely because no direct phone exists.

---

# 22. CORE RULE

**YAD should identify the best business stakeholder from its own evidence first, reach them through the strongest truthful business path available, and buy third-party contact data only when the incremental value justifies it.**
