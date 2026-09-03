# Your AI Department — Decision-Maker Routing & Contact Strategy

**Status:** Architecture authority  
**Purpose:** Decide who YAD should contact inside a researched company, why that role owns the likely problem, how confidence is established, and what to do when no named decision-maker is found.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

The correct contact is not always the owner.

The system should route by **problem ownership**, not prestige.

Examples:

- missed-call/dispatch problem -> operations/office/GM may be better than owner;
- paid marketing attribution -> marketing/owner/GM;
- unsold roofing proposals -> sales manager/owner/GM;
- collision estimate workflow -> GM/CSR manager/marketing depending problem;
- law-firm intake -> intake director/COO/administrator/managing partner;
- real-estate nurture -> team leader/ISA manager/operations/marketing.

---

# 2. CONTACT TARGET OBJECT

`ContactTarget`

- account_id
- contact_id optional
- role_category
- observed_title
- normalized_title
- source
- source_confidence
- problem_ownership_score
- authority_score
- accessibility_score
- currentness_score
- campaign_relevance
- preferred_contact_channel if approved
- evidence_ids[]
- reason_for_targeting
- fallback_role_category
- last_verified_at

These internal routing scores do NOT modify Module 4C fit score.

---

# 3. ROLE CATEGORIES

Canonical categories:

- owner_founder
- president_ceo
- general_manager
- operations
- office_manager
- intake
- sales_leadership
- marketing
- business_development
- customer_service
- dispatch
- practice_administrator
- managing_partner
- broker_owner
- team_leader
- isa_leadership
- market_manager
- location_manager
- other_relevant

Profiles map titles into these categories.

---

# 4. ROUTING BY HYPOTHESIS

The primary opportunity hypothesis should produce a ranked role list.

## Paid-lead response / attribution

Default:

1. marketing
2. operations / GM
3. owner/president
4. sales leadership

Small business fallback: owner/GM.

## Missed calls / after-hours

1. operations / office manager
2. GM
3. customer service / dispatch leadership
4. owner

## Unsold estimates/proposals

1. sales leadership
2. GM/operations
3. owner

## CRM workflow

1. operations
2. sales leadership
3. marketing
4. owner/GM

## Employee capacity / admin

1. operations
2. office/practice administrator
3. GM
4. owner

## AI governance in law

1. COO/operations
2. managing partner
3. IT/security leadership if present
4. practice administrator

---

# 5. VERTICAL ROUTING DEFAULTS

## HVAC / Plumbing

Possible priorities:

- owner/president
- GM
- operations manager
- office manager
- dispatch/customer-service manager
- marketing director

## Roofing

- owner/president
- sales manager
- GM
- operations
- marketing

## Collision Repair

- owner
- GM
- multi-store operations
- marketing
- CSR/front-office manager where relevant

## PDR/Hail

- owner/operator
- market manager
- sales manager
- operations
- marketing

## Law Firms

- managing partner
- COO
- practice administrator
- intake director
- marketing director

Do not default to an attorney merely because they are the most visible person if another role clearly owns intake operations.

## Real Estate

- broker-owner
- team leader
- operations director
- ISA manager
- marketing director

---

# 6. CONTACT SOURCES

Preferred evidence hierarchy:

1. first-party team/leadership page;
2. first-party contact/about/location page;
3. licensed enrichment provider;
4. public professional/business directory with suitable use rights;
5. imported CRM/list data;
6. receptionist/gatekeeper correction after contact.

Do not let low-confidence third-party data overwrite a current first-party title silently.

---

# 7. TITLE NORMALIZATION

Examples:

- `VP of Operations`, `Director of Operations`, `Operations Manager` -> operations
- `Intake Director`, `Director of Intake`, `New Client Intake Manager` -> intake
- `Office Administrator`, `Firm Administrator` -> practice_administrator/office_manager depending vertical
- `BDC Manager` -> sales/customer-acquisition leadership
- `CSR Manager` -> customer_service
- `Market Sales Manager` -> sales_leadership / market_manager depending profile

Store raw title and normalized category.

---

# 8. CONTACT CONFIDENCE

Possible statuses:

- `CONFIRMED_CURRENT`
- `LIKELY_CURRENT`
- `STALE_POSSIBLE`
- `ROLE_ONLY_NO_PERSON`
- `CONFLICTED`
- `UNKNOWN`

A named person from an old source should not automatically outrank a current role-only target.

---

# 9. ROLE-ONLY CALLING

If no named person is found, the Call Pack can still be useful.

Example:

> “I'm trying to figure out who oversees intake operations and marketing-to-client tracking.”

The gatekeeper branch should ask for the role naturally.

The agent must not invent a name.

---

# 10. GATEKEEPER LEARNING

A gatekeeper may provide:

- correct person
- correct department
- best callback time
- person no longer employed
- shared inbox/number

These become `ProspectStatement` / contact corrections with provenance.

The system should update routing for future attempts without erasing the original source history.

---

# 11. CONTACT LEASING / OWNERSHIP

When a rep begins working an Account:

- lease Account/contact to rep;
- prevent simultaneous duplicate outreach;
- preserve account-wide contact history across vertical campaigns;
- route future callbacks to current owner when possible;
- release/reassign lease according to manager policy.

---

# 12. MULTI-LOCATION COMPANIES

Decision-maker may be:

- corporate centralized;
- regional;
- location-specific.

Store scope:

- account-wide
- region
- location
- market

Do not call five location GMs about the same centralized marketing problem when corporate owns it.

Conversely, do not assume corporate controls a locally franchised operation.

---

# 13. FRANCHISES

Required classification:

- franchisor corporate
- franchisee business
- branch/location
- shared marketing center where known

Contact routing must follow actual ownership/control evidence.

Avoid implying the local owner controls corporate advertising or systems when that is unknown.

---

# 14. CONTACTABILITY IS NOT FIT

A Tier A company with no decision-maker email/phone remains Tier A.

Contactability affects queue readiness and channel strategy, not business-fit score.

Separate fields:

- YAD fit score
- contact target quality
- contact-channel readiness
- compliance eligibility

---

# 15. ROUTING SCORE

A transparent contact routing comparator may consider:

1. hypothesis ownership
2. title authority
3. source confidence/currentness
4. location/account scope match
5. contactability
6. prior conversation/gatekeeper confirmation

Do not use one opaque LLM probability.

---

# 16. DO-NOT-CONTACT PROPAGATION

If a contact requests DNC:

- apply suppression according to policy scope;
- do not bypass by calling another person at the company merely because a different role exists if policy/account suppression prohibits it.

If request clearly applies only to the individual number/contact, policy engine determines whether other legitimate company contact is permissible.

Sales model never decides this itself.

---

# 17. FIRST CONTACT FALLBACKS

If primary named contact unavailable:

1. ask gatekeeper for role owner;
2. create corrected target if provided;
3. leave concise voicemail if campaign policy allows;
4. schedule requested callback;
5. use approved alternate channel if permitted;
6. avoid cycling through unrelated employees.

---

# 18. CONTACT ENRICHMENT BUDGET

Do not spend premium contact enrichment on every discovered candidate.

Suggested cascade:

- company qualifies/researches to plausible Tier B+;
- then run decision-maker enrichment;
- Tier A may receive deeper enrichment;
- low-tier candidates remain company-level until promoted.

Track cost per usable decision-maker.

---

# 19. ACCEPTANCE TESTS

1. HVAC 24/7 advertiser with operations director -> operations first.
2. small plumbing owner-operated company -> owner first.
3. roofing company with sales manager -> sales manager for proposal-follow-up hook.
4. collision MSO with corporate marketing director and local GM -> marketing for attribution, local GM for front-office overflow.
5. law firm with intake director -> intake director before random partner for intake issue.
6. law firm with only managing partner known -> managing partner valid fallback.
7. brokerage with ISA manager -> ISA manager for nurture/speed-to-lead.
8. stale CEO name but current first-party GM -> current GM wins for operational hook.
9. no person found -> role-only gatekeeper strategy, no invented name.
10. same Account discovered in HVAC and Plumbing campaigns -> one contact history/lease.

---

# 20. CORE RULE

Contact the person most likely to own the business process being investigated. Do not mistake hierarchy for relevance, and do not invent personal information to make a cold call sound more researched than it is.
