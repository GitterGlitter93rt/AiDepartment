# Your AI Department — Market Miner Entity Resolution & Deduplication Specification

**Status:** Architecture authority  
**Purpose:** Prevent multiple search observations, DBAs, tracking numbers, locations, provider records, and franchise entities from becoming duplicate or incorrectly merged prospects.

---

# 1. PRINCIPLE

Discovery results are observations.

Accounts are canonical entities.

Never assume:

`one result = one prospect`

or:

`same brand name = same legal/operational account`.

Entity resolution must be auditable and reversible.

---

# 2. ENTITY LEVELS

Separate:

## Account

Organization/brand/business relationship unit.

## Location

Physical/operational branch/service location.

## Domain

Website/campaign/landing property.

## Phone endpoint

Main/branch/tracking/direct number.

## Contact

Person/role.

## Source identity

Provider-native record/ID.

This prevents the common mistake of treating each Google location as a separate independent company when one multi-location operator owns them.

---

# 3. NORMALIZATION

## Company name

Normalize for matching only:

- lowercase;
- trim whitespace;
- normalize punctuation;
- common legal suffix removal for comparison (`LLC`, `Inc`, etc.);
- common `&` / `and` normalization;
- preserve original name separately.

Do NOT remove meaningful brand words such as `Air`, `Heating`, `Plumbing` indiscriminately.

## Domain

- lowercase hostname;
- remove protocol;
- remove `www.` for canonical comparison;
- normalize trailing slash;
- identify registrable domain vs subdomain;
- preserve campaign/landing domain relation.

## Phone

- normalize to E.164 when possible;
- preserve observed formatting/source;
- recognize toll-free/tracking possibilities.

## Address

- normalized street components;
- city/state/postal;
- coordinates where available;
- preserve raw source string.

---

# 4. STRONG MATCH KEYS

High-confidence candidate match when one or more strong keys align and no strong conflict exists.

Examples:

- same verified canonical domain;
- same exact business phone;
- same provider stable ID mapping;
- same government/license/business entity number;
- same exact physical address + highly compatible name;
- explicit same parent/brand relationship from first-party website.

Strong conflict examples:

- same generic brand name but different states/domains/owners;
- franchise brand with independently operated franchisees;
- lead-gen domain representing many businesses.

---

# 5. MATCH SCORE — INTERNAL ONLY

Use transparent weighted features for entity-match confidence.

Illustrative features:

- exact verified domain: very strong
- exact phone: very strong
- exact address: strong
- provider stable-ID prior mapping: very strong
- business name similarity: moderate
- city proximity: moderate
- shared leadership/legal identity: strong
- same brand with franchise evidence: ambiguous, not automatically strong

Do not expose entity-match score as YAD sales score.

Thresholds:

- auto-link source observation;
- auto-merge location/account only when strict conditions met;
- manual review;
- separate entity.

Claude should tune thresholds with fixtures, not intuition alone.

---

# 6. MULTI-LOCATION BUSINESS

Example:

`ABC Heating & Air`

- Jacksonville address
- St. Augustine address
- same canonical domain
- same corporate ownership
- different location phones

Expected:

- one Account;
- two Locations;
- multiple PhoneEndpoints;
- source observations attached to correct location when known;
- `multiple_locations = confirmed` evidence.

Do not create two cold-prospect Accounts and call both offices independently without campaign/contact policy.

---

# 7. FRANCHISE

Franchise data can require:

- franchise brand Account/relationship;
- independently owned local franchise Account;
- local Locations.

Do not auto-merge all franchises into one corporate prospect merely because they share brand/domain templates.

Required signals for ownership resolution may include:

- first-party local franchise page;
- legal/business registry;
- licensed data;
- explicit corporate/franchise structure.

When ambiguous:

`review_required`

---

# 8. DBA / NAME VARIANTS

Example:

- `Comfort Air LLC`
- `Comfort Air Heating & Cooling`
- `Comfort Air of Jacksonville`

Potential same entity if domain/phone/address align.

Store:

- canonical name;
- legal name;
- DBA names;
- observed source names.

Do not lose alternative names because they improve later matching.

---

# 9. TRACKING NUMBERS

A company may display:

- main number;
- Google/website dynamic tracking number;
- CallRail number;
- ad-specific forwarding number;
- location number.

Rules:

- exact tracking number can link observations but may expire/change;
- never assume tracking number is the permanent canonical number;
- independently verify business identity/domain;
- preserve phone role and source.

Contact attempt should use approved verified endpoint rather than arbitrary stale observation when possible.

---

# 10. LEAD-GENERATION / AGGREGATOR DOMAINS

Some sponsored results may land on:

- marketplace;
- referral service;
- lead aggregator;
- affiliate page;
- agency-owned funnel.

Do not assign advertisement to a contractor unless advertiser/business identity is actually resolved.

Possible status:

`lead_generator_or_aggregator`

Such records may be excluded from normal local-contractor campaign.

---

# 11. PARENT COMPANY / PORTFOLIO

Private equity/holding structures may operate multiple local brands.

Do not automatically collapse local brands if sales decisions occur independently.

Store:

- parent_account_id;
- operational brand account;
- locations;
- shared systems evidence if known.

Campaign may choose account-level or location-level prospect strategy later.

---

# 12. MERGE RECORD

Every merge stores:

- merge ID;
- winning canonical account;
- source/merged account IDs;
- matching evidence;
- confidence;
- algorithm/profile version;
- actor (system/human);
- timestamp;
- reason.

Data is remapped, not destroyed.

---

# 13. UNMERGE

System must support reversing a bad merge.

Unmerge restores:

- source identities;
- locations;
- domains;
- phones;
- evidence ownership where determinable;
- contact history links.

Historical call records must remain immutable and retain the entity ID/context used at call time, with a later correction relation if needed.

---

# 14. DUPLICATE OUTREACH GATE

Before outreach, consider all:

- aliases;
- merged source identities;
- shared domains;
- shared phone endpoints;
- account/location hierarchy;
- active opportunity/customer state;
- previous attempts.

Finding the same company through a new provider does not make it “new” for outreach.

---

# 15. FIXTURE — SAME DOMAIN / SAME PHONE

Six paid Google observations:

- different queries;
- same `examplehvac.com`;
- same main phone.

Expected:

- 1 Account;
- 6 SearchObservations;
- ad strength increases/repetition recorded;
- Google Module 4C score remains +4 once.

---

# 16. FIXTURE — SAME DOMAIN / TWO LOCATIONS

Two Google local observations:

- same domain;
- Jacksonville phone/address;
- St. Augustine phone/address;
- website location pages confirm both.

Expected:

- 1 Account;
- 2 Locations;
- 2+ phones;
- multiple-location signal confirmed.

---

# 17. FIXTURE — SAME NAME / DIFFERENT BUSINESS

`All-Star Plumbing`

Jacksonville, FL domain A

and

`All Star Plumbing`

Austin, TX domain B

No shared phones/ownership.

Expected:

- separate Accounts;
- name similarity alone insufficient.

---

# 18. FIXTURE — FRANCHISE

Same brand domain template, two franchise cities, ownership uncertain.

Expected:

- do not auto-merge into one local prospect;
- franchise relationship flagged;
- review/ownership resolution.

---

# 19. FIXTURE — TRACKING PHONE CHANGED

Same verified domain/address, paid observation has different tracking phone than website main number.

Expected:

- one Account;
- separate PhoneEndpoints with roles;
- do not create duplicate.

---

# 20. FIXTURE — DOMAIN REDIRECT

Ad URL uses tracking redirect and resolves to canonical company domain.

Expected:

- preserve landing/redirect observation;
- resolve canonical domain;
- attach ad to Account if identity is clear.

---

# 21. FIXTURE — AGGREGATOR

Sponsored landing page lists multiple plumbing contractors and has generic lead-capture number.

Expected:

- source classified aggregator;
- no automatic contractor assignment;
- excluded/manual research depending campaign.

---

# 22. FIXTURE — COMPANY REBRAND

Old source says `Old Air LLC`; current website says `New Comfort Air`, same legal entity/phone/domain redirect.

Expected:

- preserve old alias;
- current canonical name updated based on evidence;
- no new duplicate account;
- historical observations retained.

---

# 23. HUMAN REVIEW QUEUE

Review card should show side-by-side:

- names;
- domains;
- phones;
- addresses;
- source IDs;
- first-party evidence;
- proposed action.

Reviewer options:

- same account;
- separate accounts;
- parent/child;
- franchise relationship;
- uncertain/defer.

---

# 24. ENTITY RESOLUTION ACCEPTANCE TARGET

Before scaling a territory, manually audit a statistically useful/random sample of:

- auto-merges;
- non-merges;
- multi-location grouping;
- franchise cases;
- tracking-number cases.

False merge is generally more damaging than leaving a duplicate for later review because it can corrupt contact/compliance history.

Prefer conservative merge behavior when strong keys conflict.
