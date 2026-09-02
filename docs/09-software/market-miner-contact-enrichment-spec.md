# Your AI Department — Market Miner Decision-Maker / Contact Enrichment Specification

**Status:** Architecture authority  
**Purpose:** Define how a researched company becomes a contactable sales prospect without confusing business identity with person identity, over-enriching low-value accounts, or treating a guessed owner as the only valid stakeholder.

---

# 1. PRINCIPLE

The Market Miner first decides:

> Is this company worth contacting?

Then:

> Who is the best person/role to contact about this specific business problem?

Do not spend premium person-enrichment credits on every raw discovered company.

---

# 2. CONTACT ENRICHMENT STAGE

Recommended cascade:

1. Account discovered/deduped.
2. Basic website research.
3. Preliminary YAD score/fit.
4. If plausible Tier A/B or campaign requires contact: search first-party leadership/team information.
5. Use licensed provider such as Apollo/equivalent for missing stakeholder/contact details.
6. Validate/normalize contact.
7. Preserve source/license/freshness.
8. Do not block Human Assist if decision-maker remains unknown; gatekeeper strategy can still work.

---

# 3. ROLE SELECTION IS PROBLEM-SPECIFIC

Use vertical profile role map.

## HVAC examples

Missed calls/after-hours:

- owner
- GM
- operations/service manager
- office/CSR manager

Replacement follow-up:

- owner
- GM
- sales/replacement manager

Attribution:

- owner
- GM
- marketing
- operations depending organization.

## Plumbing examples

Urgent call handling:

- owner
- GM
- service/operations/dispatch manager

Larger estimate follow-up:

- owner
- sales/estimating leadership

Do not blindly target CEO when the operational stakeholder is obvious and accessible.

---

# 4. CONTACT RECORD

Required/optional fields:

- contact ID
- account ID
- location ID optional
- full name
- first/last name
- title
- role category
- seniority
- department
- public business email
- direct business phone(s)
- source provider/reference
- confidence
- last verified
- contact-basis metadata
- suppression state
- preferred contact channel only if known

Never fill unknown fields with guessed names/emails in the canonical contact record.

---

# 5. SOURCE PRECEDENCE

For current title/employment:

- current first-party company leadership/team page can be strong evidence;
- licensed current business/contact provider;
- current professional/public business directory;
- older public source;
- AI inference last.

For email/phone:

- current explicit first-party business contact;
- licensed provider according to license;
- constructed/guessed email pattern is NOT verified contact unless validated and appropriately labeled.

---

# 6. FIRST-PARTY WEBSITE CONTACT EXTRACTION

Look for:

- About/Team/Leadership
- management bios
- location leadership
- contact page role addresses
- service/sales department addresses
- schema/structured data.

Role evidence should retain page URL/timestamp.

Do not scrape private/staff-only portals.

---

# 7. LICENSED PROVIDER ADAPTER

Core operations:

- search people by account/domain
- filter role/seniority
- retrieve provider-authorized business contact fields
- record provider person ID
- record data freshness/confidence if provided
- record credit/cost usage.

Core system does not depend on Apollo-specific field names.

Adapter maps provider data to canonical Contact.

---

# 8. TARGET ROLE RANKING

Rank candidate contacts using:

1. relevance to primary hypothesis;
2. decision authority/seniority;
3. direct ownership of workflow;
4. location relevance;
5. data confidence/freshness;
6. contact channel availability.

Do not make “owner” an automatic +infinity score.

---

# 9. CONTACT CONFIDENCE

## Confirmed

Current first-party or high-quality licensed evidence supports employment/title/contact.

## Likely

Provider/public evidence is plausible but not strongly current.

## Unknown/stale

Do not use personalized statement such as:

> I know you're the operations manager

unless confidence supports it.

Gatekeeper/role-based opening remains safer.

---

# 10. UNKNOWN DECISION-MAKER

Valid Call Pack:

- contact name unknown
- target role = operations/GM
- main business phone verified.

Gatekeeper objective:

> Who normally owns lead handling / operations / marketing / sales process?

Success can be correct role/contact discovery.

Do not discard a Tier A account only because person enrichment failed.

---

# 11. MULTI-LOCATION CONTACTS

Account may have:

- corporate owner/GM;
- regional operations;
- local branch manager;
- location office manager.

Contact should link to appropriate Account/Location.

Campaign decides whether outreach is:

- account-level;
- branch-level;
- regional.

Avoid multiple reps calling several branches of the same account simultaneously without deliberate strategy.

---

# 12. FRANCHISE CONTACTS

Franchise requires ownership/account relationship resolution first.

Do not call corporate brand leadership about a local franchise workflow unless campaign targets corporate.

Do not assume local franchise owner is employee of corporate entity.

---

# 13. PHONE TYPES

Distinguish:

- main business
- location
- direct business
- mobile/direct
- toll-free
- tracking number.

Contact enrichment does not decide autonomous call legality/policy.

Line/contact basis moves into Compliance Engine.

---

# 14. EMAIL TYPES

- named business email
- role/business email (`info@`, `sales@`)
- provider-supplied business email
- unknown.

Do not send email merely because address exists; communication policy applies.

---

# 15. EMAIL GUESSING

Do not store guessed pattern as verified contact.

If YAD later uses an email-verification provider:

- constructed candidate remains provenance-labeled;
- verification result stored;
- outreach policy evaluated.

Do not let LLM hallucinate likely email addresses and send them.

---

# 16. STALE CONTACT

If contact older than TTL or evidence conflicts:

- mark aging/stale;
- refresh before highly personalized outreach where cost justified;
- main business/gatekeeper path remains fallback.

If receptionist says person left:

- record ProspectStatement/contact correction;
- mark prior contact stale/invalid;
- ask appropriate role.

---

# 17. CONTACT COST CONTROL

Track:

- provider lookup cost
- contacts found
- high-confidence contacts
- decision-makers reached later
- meetings by contact provider/source.

Metric:

`contact_enrichment_cost_per_decision_maker_reached`

Do not buy ten contact records for a Tier C account by default.

---

# 18. ENRICHMENT DEPTH

## No person enrichment

Tier C/D or early discovery.

## Basic

First-party website role/name search.

## Standard

One licensed provider lookup for top relevant roles.

## Premium

High-value Tier A account: deeper account/role resolution if standard fails and campaign economics justify it.

---

# 19. DUPLICATE CONTACT RESOLUTION

Same person may appear:

- website name
- Apollo record
- several emails
- several phones.

Merge Contact when strong identity supports it.

Preserve SourceIdentity/provenance.

Do not merge common names across different companies without strong evidence.

---

# 20. CONTACT SUPPRESSION

Suppression can apply to:

- a phone
- person/contact
- account/company
- email
- campaign.

Contact provider refresh must never recreate a suppressed contact as “new” outreach target without matching suppression identity.

---

# 21. HUMAN CORRECTION

Rep can record:

- correct title
- person left company
- right decision-maker
- preferred department
- wrong direct line.

Human/prospect correction should update current contact read model while preserving source history.

---

# 22. FIXTURE A — OWNER FOUND

Website lists owner + licensed provider confirms same current title/email.

Expected:

- one high-confidence Contact
- sources linked
- role owner.

---

# 23. FIXTURE B — OLD OWNER RECORD

Licensed provider says John Smith owner; current website says Jane Doe owner.

Expected:

- Jane current higher precedence for public ownership clue
- John record marked stale/needs validation, not silently deleted
- no personalized call to John as current owner without refresh.

---

# 24. FIXTURE C — OPERATIONS BETTER THAN OWNER

Tier A multi-location HVAC account.

Contacts:

- owner
- director of operations
- marketing coordinator.

Primary hypothesis = call handling/dispatch capacity.

Expected preferred target:

- director of operations if role/current contact sufficiently strong, with owner as alternate depending campaign.

---

# 25. FIXTURE D — NO PERSON FOUND

Main business phone verified; no decision-maker.

Expected:

- Account stays in Human Assist if otherwise eligible
- Call Pack target role `GM/operations`
- gatekeeper script used
- no fake name.

---

# 26. FIXTURE E — FRANCHISE

Provider returns corporate executive while Account represents locally owned franchise.

Expected:

- do not set corporate executive as local decision-maker automatically
- resolve local franchise ownership/role or use main business gatekeeper.

---

# 27. ACCEPTANCE TEST

For manually reviewed Tier A/B sample:

Measure:

- current employment/title precision
- account/location association precision
- direct contact field validity where provider supplies it
- percentage with useful decision-maker/role
- false personalized-name/title claims
- enrichment cost per useful contact.

The objective is useful routing, not maximum personal-data collection.
