# Your AI Department — Decision-Maker Routing & Contact Strategy

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Decide who YAD should contact inside a researched company, why that role owns the likely problem, how currentness/confidence is established, and what to do when no named decision-maker or direct endpoint is found.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

The correct contact is not always the owner.

Route by **problem ownership**, not prestige.

Examples:

- missed-call/dispatch problem -> operations/office/GM may be better than owner;
- paid marketing attribution -> marketing/operations/owner/GM;
- unsold roofing proposals -> sales manager/GM/owner;
- collision estimate workflow -> GM/CSR/operations depending problem;
- law intake -> intake director/COO/administrator/managing partner;
- real-estate nurture -> ISA/lead manager/team leader/operations.

YAD must be able to route useful Accounts in `PUBLIC_ONLY` mode with no Apollo dependency.

---

# 2. CONTACT TARGET OBJECT

`ContactTarget`

- account_id
- contact_id optional
- role_category
- observed_title optional
- normalized_title optional
- company_relationship optional
- source/evidence IDs
- employer_match
- role_match
- currentness
- problem_ownership_score
- authority_score
- accessibility_score
- location_scope_match
- campaign_relevance
- preferred_contact_channel if approved
- reason_for_targeting
- fallback_role_category
- last_verified_at

Internal routing values do NOT modify Module 4C fit score.

---

# 3. ROLE CATEGORIES

Canonical categories include:

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
- other_relevant.

Public-record relationships such as `registered_agent`, `license_holder`, and `qualifier` are evidence relationships and must not be silently normalized to operational sales roles.

---

# 4. ROUTING BY HYPOTHESIS

## Paid-lead response / attribution

Default:

1. marketing where current/relevant;
2. operations / GM;
3. owner/president;
4. sales leadership.

Small-business fallback: owner/GM.

## Missed calls / after-hours

1. operations / office manager;
2. GM;
3. customer service / dispatch leadership;
4. owner.

## Unsold estimates/proposals

1. sales leadership;
2. GM/operations;
3. owner.

## CRM workflow

1. operations;
2. sales leadership;
3. marketing;
4. owner/GM.

## Employee capacity / admin

1. operations;
2. office/practice administrator;
3. GM;
4. owner.

## AI governance in law

1. COO/operations;
2. managing partner;
3. IT/security leadership if present;
4. practice administrator.

---

# 5. VERTICAL ROUTING DEFAULTS

## HVAC / Plumbing

- owner/president
- GM
- operations manager
- office manager
- dispatch/customer-service manager
- marketing director.

## Roofing

- owner/president
- sales manager
- GM
- operations
- marketing.

## Collision Repair

- owner
- GM
- multi-store operations
- marketing
- CSR/front-office manager where relevant.

## PDR/Hail

- owner/operator
- market manager
- sales manager
- operations
- marketing.

## Law Firms

- intake director
- COO
- practice administrator
- managing partner
- marketing director depending hypothesis.

Do not default to an attorney merely because they are the most visible person if another role clearly owns intake operations.

## Real Estate

- broker-owner
- team leader
- operations director
- ISA manager
- marketing director.

---

# 6. CURRENT SOURCE HIERARCHY — PUBLIC FIRST

Preferred evidence order for current routing:

1. fresh prospect/gatekeeper correction;
2. current first-party company team/leadership/contact evidence;
3. approved public company/entity records where the relationship actually supports the claim;
4. approved public licensing/professional records where relevant;
5. approved public business/professional directory or business news evidence;
6. optional licensed contact provider when campaign policy enables it;
7. older imported/third-party records;
8. AI inference only as a candidate requiring evidence.

Do not let low-confidence third-party data overwrite a fresh first-party or prospect-confirmed role silently.

Registered-agent evidence is not decision-maker evidence by default.

---

# 7. TITLE NORMALIZATION

Examples:

- `VP of Operations`, `Director of Operations`, `Operations Manager` -> operations
- `Intake Director`, `Director of Intake`, `New Client Intake Manager` -> intake
- `Office Administrator`, `Firm Administrator` -> practice_administrator/office_manager depending vertical
- `BDC Manager` -> sales/customer-acquisition leadership
- `CSR Manager` -> customer_service
- `Market Sales Manager` -> sales_leadership / market_manager depending profile.

Store raw title and normalized category.

---

# 8. CONTACT CONFIDENCE

Keep dimensions explicit rather than a single opaque score.

Possible currentness/employer states:

- `CONFIRMED_CURRENT`
- `LIKELY_CURRENT`
- `STALE_POSSIBLE`
- `ROLE_ONLY_NO_PERSON`
- `CONFLICTED`
- `UNKNOWN`.

A named person from an old source should not automatically outrank a current role-only target.

---

# 9. ROLE-ONLY CALLING

If no named person is found, the Call Pack remains useful.

Example:

> “I'm trying to figure out who oversees inbound lead handling and operations.”

The gatekeeper branch asks naturally for the role.

The agent/rep must not invent a name.

`ROLE_ROUTE_READY` is a valid contact-resolution state.

---

# 10. NAMED PERSON + MAIN-LINE ROUTE

If a current named person exists but no direct number is found:

> `Sarah Jones — Operations Manager; official company main line; ask for Sarah.`

This is valid and should appear as such in the portal.

Do not attach the main number to Sarah as a direct endpoint without explicit evidence.

---

# 11. GATEKEEPER LEARNING

A gatekeeper may provide:

- correct person
- correct department
- best callback time
- person no longer employed
- extension
- shared/business email.

These become structured prospect/contact corrections with provenance.

Future routing should use the current correction while retaining older source history.

---

# 12. ACCOUNT OWNERSHIP

When a rep claims/works an Account:

- ownership is account-wide unless manager rules say otherwise;
- prevent simultaneous duplicate cold outreach;
- preserve account-wide contact history across vertical campaigns;
- route callbacks to the current relationship owner when possible;
- release/reassign according to manager policy.

A newly discovered alternative decision-maker does not create a new cold Account.

---

# 13. MULTI-LOCATION COMPANIES

Decision-maker may be:

- corporate centralized;
- regional;
- location-specific.

Store scope:

- account-wide
- region
- location
- market.

Do not call five local managers about the same centralized marketing problem when corporate owns it.

Do not assume corporate controls a local workflow without evidence.

---

# 14. FRANCHISES

Required distinctions:

- franchisor corporate
- franchisee business
- branch/location
- shared marketing center where known.

Contact routing follows actual ownership/control evidence.

Avoid implying local franchise leadership controls corporate advertising/systems when unknown.

---

# 15. CONTACTABILITY IS NOT FIT

A Tier A company with no decision-maker direct phone/email remains Tier A.

Contactability affects readiness/channel strategy, not business fit.

Separate:

- YAD fit score
- contact target quality
- endpoint quality
- channel readiness
- compliance eligibility.

---

# 16. ROUTING COMPARATOR

A transparent comparator may consider:

1. opportunity-hypothesis ownership;
2. current role/title evidence;
3. authority;
4. location/account scope match;
5. evidence currentness;
6. contactability;
7. prior prospect/gatekeeper confirmation.

Do not use one hidden LLM probability as final authority.

---

# 17. PUBLIC RECORD RELATIONSHIP GUARDS

## Registered agent

Never primary decision-maker solely from registered-agent relationship.

## License holder / qualifier

May support person-company relationship but does not automatically prove operational ownership.

## Founder

Founder may be historical/non-operational; current role evidence still matters.

## Corporate officer

Officer may be a valid authority fallback, but route to workflow owner where current evidence exists.

---

# 18. OPTIONAL PAID ENRICHMENT

Paid enrichment is permitted only when policy/configuration enables it.

Recommended modes:

- `PUBLIC_ONLY` — default
- `PUBLIC_THEN_PAID`
- `PAID_ALLOWED_FOR_TIER_A`
- `IMPORT_ONLY`.

The portal/miner must operate normally if no Apollo/equivalent credentials exist.

Do not make paid direct-contact fill a release dependency for Human Assist.

---

# 19. DO-NOT-CONTACT PROPAGATION

If a contact requests DNC:

- apply suppression according to policy scope;
- do not bypass valid account/contact suppression simply by discovering another person.

Sales model never decides suppression scope by itself.

---

# 20. FIRST CONTACT FALLBACKS

If primary named contact unavailable:

1. ask gatekeeper for correct role/person;
2. store corrected target if provided;
3. leave approved concise voicemail if campaign policy allows;
4. schedule requested callback;
5. use approved alternate channel if permitted;
6. avoid cycling through unrelated employees.

---

# 21. CONTACT RESEARCH BUDGET

Suggested cascade:

- company qualifies/researches to plausible Tier B+;
- run public decision-maker resolution;
- Tier A may receive deeper public research;
- optional paid enrichment only if incremental direct-contact value justifies cost;
- low-tier candidates remain company-level until promoted.

Track:

- public named-target rate
- role-route rate
- direct-public endpoint rate
- optional provider incremental lift
- cost per decision-maker reached.

---

# 22. ACCEPTANCE TESTS

Use:

`outbound-sales-brain-public-contact-resolution-fixtures.v1.yaml`

At minimum:

1. HVAC advertiser with current operations director -> operations first.
2. Small owner-operated plumbing company -> owner valid.
3. Roofing proposal hook -> sales manager before owner where current/relevant.
4. Collision MSO -> role depends on local vs centralized hypothesis.
5. Law intake director -> intake before random partner.
6. No person -> role-only main-line route, no invented name.
7. Stale CEO but current GM -> current GM wins for operational hook.
8. Registered agent -> never automatic POC.
9. Qualifier -> supporting relationship, not automatic workflow owner.
10. Apollo unavailable -> Account still eligible for Human Assist if company route exists.

---

# 23. CORE RULE

**Contact the current person or role most likely to own the business process being investigated. Public/first-party evidence is sufficient for routing; direct paid contact data is optional. Never mistake hierarchy, a filing relationship, or a clean-looking phone number for proof of relevance.**
