# Your AI Department — Market Miner Lead Import / Export / Source Reconciliation Specification

**Status:** Architecture authority  
**Purpose:** Allow Apollo lists, spreadsheets, prior YAD prospect lists, manual leads and future CRM data to enter the same canonical Prospect Factory without creating parallel databases or duplicate outreach.

---

# 1. PRINCIPLE

Externally supplied lists are discovery sources, not automatically trusted canonical Accounts.

Every import follows:

`Import Batch -> Raw Row -> Normalize -> Match Existing Entity -> Create/Link Account -> Research/Refresh -> Score -> Queue`

A CSV row does not bypass evidence, dedupe, suppression or contact history.

---

# 2. SUPPORTED INPUT TYPES

V1:

- CSV
- XLSX export converted/parsed by implementation tooling
- Apollo export/API adapter
- manual single-account entry
- prior YAD lead lists
- CRM account/contact export

Future:

- partner feeds
- webhook/API lead intake
- inbound Assessment/Strategy Call leads.

---

# 3. IMPORT BATCH

Fields:

- batch ID
- source type/provider
- source file/provider reference
- imported by
- imported at
- campaign/mining job optional
- row count
- valid/invalid rows
- matched existing accounts
- new accounts
- duplicate rows
- suppressed matches
- errors
- retention/license metadata.

Raw source file retention follows source/data policy.

---

# 4. RAW ROW

Preserve original row values long enough for audit/reconciliation according to retention policy.

Do not overwrite raw source with normalized values.

Typical fields:

- company
- domain
- website
- business phone
- person name
- title
- direct phone
- email
- city/state/postal
- industry
- employee count/provider fields
- provider IDs
- source notes.

---

# 5. COLUMN MAPPING

UI/import config maps source columns to canonical fields.

Support saved mapping templates:

- Apollo standard export
- YAD local prospect spreadsheet
- generic CRM export.

Unknown columns remain source metadata only if useful/allowed.

Do not blindly create arbitrary database columns from every imported spreadsheet header.

---

# 6. NORMALIZATION

Normalize:

- domain
- phone E.164
- company name matching form
- state/country
- email casing
- title/role category
- location fields.

Keep original display values.

---

# 7. ACCOUNT MATCHING

Use entity-resolution spec.

Before new Account:

1. source-native stable ID match
2. domain
3. phone
4. address/name
5. fuzzy/manual review.

Import should report:

- linked existing
- new
- ambiguous/review.

Do not create 5,000 new Accounts before dedupe.

---

# 8. CONTACT MATCHING

Person matching within Account using:

- provider-native ID
- email
- direct phone
- name/title composite.

Do not merge same common name across accounts.

---

# 9. SOURCE TRUST

Imported fields receive provenance/confidence.

Example Apollo:

- source provider = Apollo
- retention/license = provider contract
- last verified = provider timestamp if available.

Imported company website should still be independently resolved/refreshed for high-priority Accounts.

---

# 10. INDUSTRY CLASSIFICATION

Source industry labels are hints.

Example provider says:

`construction`

Website clearly shows HVAC.

Canonical vertical can become HVAC through research/classification with evidence.

Do not reject good prospect because provider taxonomy is coarse.

---

# 11. IMPORT DOES NOT CREATE AD SIGNAL

An imported field saying:

`uses_google_ads = yes`

is source-provider evidence only.

It may become supporting evidence if source semantics are known/trusted, but current-ad-specific hook should still require the configured fresh evidence standard.

Do not automatically award +4 unless the claim source qualifies under scoring policy.

---

# 12. SUPPRESSION MATCHING DURING IMPORT

Before queue eligibility, match:

- phone suppression
- contact suppression
- account/domain suppression
- existing customer/active opportunity exclusions.

A new Apollo file must not resurrect a DNC number.

---

# 13. CONTACT HISTORY MATCHING

New import source does not reset:

- prior attempts
- voicemail count
- requested callback
- disqualification
- active opportunity
- DNC.

History follows canonical Account/Contact/Phone identity.

---

# 14. RESEARCH REFRESH AFTER IMPORT

For Tier candidate list:

- resolve website
- fresh Google advertiser check according to campaign
- website research
- current score
- current contact validation where useful.

Do not rely on a six-month-old exported list as current Call Pack evidence.

---

# 15. LIST QUALITY REPORT

After import show:

- rows
- unique accounts
- duplicate percentage
- websites resolved
- phones resolved
- suppressed/existing customer matches
- vertical match rate
- Tier A/B after research
- ad-confirmed percentage
- decision-maker resolution rate.

This lets YAD compare purchased/exported lists with Market Miner-generated supply.

---

# 16. SOURCE PERFORMANCE

Track downstream by import source/batch:

- decision-maker reach
- qualified conversations
- meetings
- opportunities
- closes.

Example:

Compare:

`Apollo generic HVAC list`

vs

`Google advertiser-mined HVAC list`.

This is one of the core hypotheses YAD should measure rather than assume forever.

---

# 17. EXPORT

Human-approved export may include:

- canonical company
- website
- business phone
- decision-maker/contact under policy/license
- city/state
- tier/score
- primary hook
- research status
- source
- last outcome
- next action.

Do not export:

- secrets
- internal prompt
- unnecessary transcript text
- source fields prohibited by license
- raw provider payload.

---

# 18. EXPORT USE CASES

- sales rep backup/offline list
- CRM migration
- approved Smartlead/email workflow
- approved Meta audience workflow where data/use policy permits
- management analysis.

Export does not itself authorize a communication channel.

---

# 19. EXPORT AUDIT

Record:

- who exported
- filter/cohort
- row count
- fields
- timestamp
- purpose
- retention/license warnings.

Especially important when contact-person data is included.

---

# 20. IMPORT FIXTURE A — APOLLO DUPLICATES MARKET MINER

Apollo row domain matches already researched Google advertiser Account.

Expected:

- link same Account
- add/update Contact/source identity
- retain Google ad observations
- no new prospect/account
- no contact history reset.

---

# 21. FIXTURE B — SUPPRESSED PHONE

New list contains previously DNC phone under slightly different company spelling.

Expected:

- entity/phone match
- suppression visible
- not queue eligible.

---

# 22. FIXTURE C — OLD CONTACT

Imported owner no longer appears on current website and licensed source is old.

Expected:

- contact aging/stale
- refresh or gatekeeper path
- no confident personalized owner claim.

---

# 23. FIXTURE D — WRONG VERTICAL LABEL

Provider labels `consumer services`; website/research confirms plumbing contractor.

Expected:

- canonical Plumbing profile
- original provider industry retained as source metadata.

---

# 24. FIXTURE E — TWO ROWS, ONE COMPANY

Same domain/main phone, two contacts.

Expected:

- 1 Account
- 2 Contacts
- 2 raw rows
- no duplicate company.

---

# 25. FIRST BUSINESS COMPARISON

After Market Miner works, run an explicitly comparable test:

- cohort A: advertiser-mined HVAC Tier A/B
- cohort B: generic Apollo HVAC Tier A/B after same research/scoring

Compare:

- research cost
- decision-maker data availability
- contact rate
- qualified conversation
- meeting rate.

This tells YAD whether advertiser-first truly produces stronger sales opportunities.
