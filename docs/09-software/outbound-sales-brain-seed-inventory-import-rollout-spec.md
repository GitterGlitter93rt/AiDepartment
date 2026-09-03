# YAD Sales Brain — Seed Inventory Import & Rollout Specification

**Status:** Product/architecture authority  
**Implementation owner:** Claude Code  
**Purpose:** Get useful prospect inventory into the Sales Portal immediately using YAD's existing lists while the 24/7 Market Miner is still being completed.

---

# 1. CORE PRINCIPLE

Do not make rep rollout depend on perfect live mining.

The portal should accept existing YAD prospect sources into the same canonical Account model from day one.

Potential seed sources:

- existing Jacksonville/St. Augustine business lists;
- Apollo exports;
- Smartlead prospect exports where appropriate;
- salesperson-created Airtable/CSV lists;
- manually researched Google advertiser lists;
- no-website business lists;
- CRM exports;
- other approved licensed datasets.

All imports flow through identity, dedupe, suppression and source attribution before becoming available to reps.

---

# 2. IMPORT CONTRACT

Minimum useful fields:

- source name
- company name
- website/domain optional
- phone optional
- email optional
- city/state/ZIP optional
- industry/vertical optional
- contact name/title optional
- source timestamp optional
- notes optional

Additional fields should map to canonical schema, not become random custom columns unless truly necessary.

---

# 3. SOURCE PRESERVATION

Every imported observation retains:

- import_batch_id
- source_system
- source_file/list/campaign
- source_record_id if available
- imported_at
- imported_by
- source timestamp if present
- license/retention metadata where needed

After merge, source history must remain queryable.

---

# 4. NORMALIZATION

Normalize before matching:

- domain
- company name
- phone to canonical format
- email case/whitespace
- address
- city/state/ZIP

Do not destroy original raw value; retain source observation where appropriate.

---

# 5. DEDUPE

Strong matching signals:

- canonical domain
- exact normalized business phone
- permitted stable source ID
- exact address + business identity
- license/business identifier where applicable

Fuzzy name matching alone must not silently merge Accounts.

Potential duplicate should go to merge/review logic when confidence insufficient.

---

# 6. EXISTING ACCOUNT

If imported row maps to existing Account:

- add source observation;
- enrich missing Contact/endpoints if stronger/newer;
- preserve current owner;
- preserve DNC/suppression;
- preserve callback;
- preserve opportunity/client state;
- do not reclassify as fresh cold lead.

---

# 7. NEW ACCOUNT

If no Account exists:

1. create canonical Account;
2. create Contacts/endpoints from source-labeled data;
3. apply suppression/contact checks;
4. assign research status;
5. queue further research according to campaign/value;
6. keep unclaimed until rep/manager ownership action.

---

# 8. IMPORT QUALITY STATES

Suggested row outcomes:

- `CREATED_NEW_ACCOUNT`
- `MERGED_EXISTING_ACCOUNT`
- `UPDATED_EXISTING_ACCOUNT`
- `POSSIBLE_DUPLICATE_REVIEW`
- `SUPPRESSED_EXISTING`
- `INVALID_ROW`
- `INSUFFICIENT_IDENTITY`

Provide batch summary.

---

# 9. SALESPERSON AIRTABLE / PERSONAL LISTS

A salesperson's independently created list can be imported as a source cohort.

Important behavior:

- preserve source as that salesperson/list;
- do not automatically grant permanent ownership solely because source came from that rep unless manager/company policy says so;
- optionally default new valid Accounts from rep-owned import to that rep during pilot;
- dedupe against all YAD Accounts first;
- existing Account relationship wins over source-import preference.

This lets YAD compare list quality objectively later.

---

# 10. RESEARCH AFTER IMPORT

Imported data is not automatically research-complete.

Depending on Account priority, run:

- website resolution/refresh;
- advertising evidence check;
- contact verification;
- vertical routing;
- canonical score;
- opportunity hypothesis;
- Call Pack/Human Assist summary.

Raw list notes may be retained as source notes but not automatically promoted to confirmed evidence.

---

# 11. CSV EXPERIENCE

Manager/Research Ops uploads CSV.

UI should provide:

1. preview;
2. column mapping;
3. validation warnings;
4. dry-run summary;
5. import confirmation;
6. final batch report.

Example dry run:

> 500 rows
> 287 new Accounts
> 166 existing matches
> 21 possible duplicates needing review
> 14 invalid rows
> 12 suppressed existing Accounts

Do not blindly create 500 new leads.

---

# 12. EXPORT ROUND TRIP

If data leaves YAD for Smartlead or approved spreadsheet workflow, maintain stable Account/contact IDs when possible so returned results map back cleanly.

Never use email address alone as the only long-term Account identifier.

---

# 13. INITIAL ROLLOUT

For same-day/early rollout:

1. create portal/schema/auth;
2. import one known high-quality current YAD list;
3. dedupe/suppress;
4. research enough fields for useful Account cards;
5. let two reps browse and claim;
6. collect real dispositions;
7. turn on automatic Market Miner replenishment into the same inventory afterward.

This proves rep workflow without waiting for every provider adapter.

---

# 14. MIGRATION PRIORITY

Suggested order:

1. current local Jacksonville/St. Augustine lists;
2. best advertiser-focused list available;
3. current Apollo/Smartlead cohorts;
4. salesperson Airtable lists;
5. older historical lists only after freshness review.

Do not flood V1 with stale junk merely because data exists.

---

# 15. QUALITY REPORT

Per import batch track:

- rows
- new Accounts
- existing matches
- possible duplicates
- invalid rows
- suppressed
- usable phones
- usable emails
- research-ready after enrichment
- Tier A/B yield
- eventual qualified-conversation/meeting rate

This lets YAD compare which external list-generation process actually performs.

---

# 16. HARD FAILS

Implementation fails if:

- re-import resets DNC;
- source list creates duplicate Account because contact email changed;
- active opportunity becomes unclaimed after import;
- imported salesperson note is treated as confirmed public fact;
- all CSV rows create Accounts without dedupe;
- invalid emails/phones are marked verified;
- import destroys source attribution;
- batch cannot be audited or rolled back/reconciled.

---

# 17. ACCEPTANCE EXAMPLE

Brent uploads 50 Airtable-generated HVAC prospects.

Expected:

- 31 new Accounts created;
- 14 matched existing YAD Accounts;
- 3 flagged possible duplicate;
- 2 invalid;
- one existing DNC remains suppressed;
- one existing Account remains owned by Sarah;
- source cohort recorded as Brent Airtable import;
- valid Accounts receive research/scoring;
- Brent can browse/claim eligible unowned Accounts according to team policy;
- future outcomes can compare this cohort against Google advertiser-mined prospects.