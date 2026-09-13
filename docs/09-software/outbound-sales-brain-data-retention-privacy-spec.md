# Your AI Department — Prospect Factory / Outbound Sales Data Retention & Privacy Specification

**Status:** Architecture / policy framework  
**Purpose:** Define what categories of prospect, research, call, transcript, provider and audit data may be retained, for how long, and under what access controls. Final legal/privacy policy must be reviewed for actual jurisdictions/providers.

---

# 1. PRINCIPLE

Store the minimum data necessary to:

- identify and research businesses;
- avoid duplicate/suppressed outreach;
- conduct and document legitimate sales work;
- improve targeting/quality;
- preserve compliance/audit history;
- fulfill active customer/prospect follow-up.

Do not build a broad personal-data warehouse simply because enrichment providers make data available.

---

# 2. DATA CLASSES

## A — Public business identity

Examples:

- company name
- business website
- public business phone
- business address/location
- public services/hours
- public leadership role.

## B — Licensed business/contact data

Examples:

- Apollo/equivalent business email/direct line
- provider person/company IDs
- firmographic data.

Retention/use follows provider contract and YAD policy.

## C — Public research evidence

- paid ad observation
- landing page/CTA evidence
- website technology signal
- public service/offer evidence.

## D — Sales interaction data

- attempt history
- disposition
- follow-up
- prospect statements
- meeting details
- CRM notes.

## E — Media

- call audio
- transcript
- voice metadata.

## F — Compliance/suppression

- DNC
- consent/contact-basis evidence
- compliance decisions
- policy version.

## G — Security/audit

- administrative actions
- system access
- provider tool execution logs.

---

# 3. RETENTION IS FIELD/SOURCE SPECIFIC

Do not assign one blanket retention period to all data.

Retention decision considers:

- source terms/license;
- business need;
- compliance/legal requirement;
- prospect request;
- media policy;
- active opportunity/customer status;
- security/audit need.

Each data class/record can carry:

- retention class
- retain-until date
- source/license policy
- deletion/anonymization requirement.

---

# 4. RETENTION CLASSES

Suggested system classes:

## `durable_business_record`

Canonical business identity/history needed for dedupe/CRM.

## `licensed_until_policy`

Provider-derived data retained only under applicable provider/license rules.

## `short_lived_research_raw`

Raw HTML/provider payload/cache; delete quickly after normalized evidence unless terms/business need justify.

## `evidence_history`

Minimal source-linked observation retained for scoring/QA/history.

## `active_sales_record`

Call/follow-up/opportunity data retained while active plus defined archive period.

## `suppression_durable`

DNC/suppression retained long enough to continue honoring request; never deleted merely because ordinary prospect history expires without a reviewed replacement mechanism.

## `media_ephemeral`

Audio/transcript deleted on short schedule.

## `media_qa_window`

Retained temporarily for QA/training under approved policy.

## `audit_security`

Retained according to security/audit requirement.

---

# 5. SOURCE DATA VS DERIVED DATA

Example:

SERP provider raw JSON may have restrictive retention terms.

YAD may retain, where allowed:

- its own internal account ID
- source/provider reference
- paid observation classification
- advertiser/domain
- query/geography/timestamp
- minimal service/landing evidence.

Do not automatically retain entire raw provider response forever.

---

# 6. WEBSITE CONTENT

Prefer storing:

- extracted structured facts
- relevant small supporting snippet/hash/reference
- URL
- timestamp
- page title/heading

rather than full permanent copies of every public webpage.

Temporary raw page cache can support extraction/debugging, then expire.

---

# 7. PUBLIC BUSINESS CONTACTS

Public business phone/address/domain can remain in canonical business record when needed for identity/contact history.

For named individuals:

- store only relevant business role/contact details;
- avoid unrelated personal information;
- refresh stale employment/title;
- honor suppression/contact policy.

---

# 8. LICENSED CONTACT DATA

Every provider-sourced person/contact field stores:

- provider
- provider ID
- license/retention class
- retrieved timestamp
- current/stale state.

If provider agreement requires deletion after termination or on request, system needs a deletion/reconciliation path.

Do not lose canonical suppression just because a licensed contact record is removed.

---

# 9. DNC / SUPPRESSION

Suppression is special.

Goal:

Continue honoring an opt-out even if ordinary prospect data is later deleted.

Possible minimal retained suppression identity:

- normalized phone/email/account identity as needed
- suppression scope
- effective date
- source/reason
- audit ID.

Final retention/law policy reviewed formally.

System should not “forget” DNC because a 90-day prospect cleanup ran.

---

# 10. CALL AUDIO

Default architecture should minimize retained audio unless YAD has a reviewed reason/policy.

Campaign options:

- no retained audio
- temporary QA audio
- retained audio under specific policy.

Store:

- recording consent/disclosure state where required
- provider recording ID/object reference
- created/expiry
- access scope.

Deletion should cover both YAD storage and provider-side recording when controllable/required.

---

# 11. TRANSCRIPTS

Transcript may be operationally useful for:

- CRM summary
- QA
- training
- research correction.

But full transcript may contain more data than needed.

Architecture supports:

- no persisted transcript
- short QA-window transcript
- durable structured ProspectStatements/outcome with transcript deletion.

This is preferable when long-term raw transcript is unnecessary.

---

# 12. STRUCTURED POST-CALL DATA

Even if media expires, retain appropriate structured business records such as:

- disposition
- problem category
- current system
- requested callback
- DNC
- agreed next step
- source-labeled business numbers

according to CRM/retention policy.

Do not preserve sensitive irrelevant conversation merely because it was spoken.

---

# 13. SENSITIVE INCIDENTAL INFORMATION

If prospect volunteers unrelated sensitive information:

- do not promote it into targeting/profile fields;
- post-call summarizer should omit unless directly needed for legitimate requested follow-up and appropriate to store;
- do not use protected/sensitive characteristics for propensity scoring.

Examples include personal health, religion, political affiliation, sexual life, etc.

---

# 14. PROPENSITY MODEL EXCLUSIONS

Future learned models must not use sensitive/protected personal attributes.

Features should focus on:

- business vertical
- public company/workflow signals
- advertiser evidence
- geography at business-market level
- source
- score components
- call timing/history
- hook/outcome.

---

# 15. EXPORTS

Exports should:

- require role/purpose
- include only fields needed
- respect provider licenses
- expire/delete exported artifact where possible
- record audit.

Avoid casually emailing giant prospect databases as attachments.

---

# 16. LOGS

Operational logs should use:

- Account ID
- Call ID
- redacted phone/email

rather than full personal data.

Do not log:

- full transcript
- auth tokens
- provider secrets
- payment data.

---

# 17. ADMIN ACCESS

Role-based:

## Sales rep

Only assigned/relevant prospect business details and call history.

## Manager

Broader sales/research view.

## QA

Media/transcript only where role/policy permits.

## Admin/security

Audit/compliance configuration.

Do not make every employee able to browse every transcript/contact record.

---

# 18. DELETION / DATA SUBJECT REQUEST WORKFLOW

If YAD receives a valid deletion/access/correction request under applicable policy/law:

System should identify:

- Account
- Contact
- phones/emails
- media
- CRM records
- provider-sourced data
- exports
- suppression implications.

Deletion must not accidentally remove minimal suppression needed to honor no-contact when policy permits retaining that purpose-limited record.

Final workflow requires legal/privacy review.

---

# 19. SOURCE RETENTION MATRIX

Implementation keeps configurable table:

- source/provider
- data category
- raw retention allowed?
- normalized derived retention allowed?
- attribution required?
- deletion requirement?
- reviewed date
- source policy URL/reference.

Provider benchmark is incomplete without this.

---

# 20. EXAMPLE INITIAL ENGINEERING DEFAULTS

Not final legal policy; safe implementation defaults:

- raw SERP/provider payload: short-lived unless terms explicitly allow durable need
- raw website HTML: short-lived extraction/debug cache
- normalized business/evidence facts: durable/current-history as appropriate
- contact provider data: per license
- full audio: off by default until campaign media policy approves
- full transcript: minimize/temporary QA by default
- structured call outcome: durable sales record
- DNC/suppression: durable purpose-limited record
- security audit: durable according security policy.

---

# 21. EXPIRY JOB

Scheduled retention worker:

- selects records past `retain_until`
- deletes/anonymizes by policy
- handles provider/object-storage deletion
- writes deletion audit
- retries failures
- alerts persistent failures.

Do not simply mark deleted if media remains accessible in object/provider storage.

---

# 22. BACKUP RETENTION

Deletion policy must consider backups.

Document:

- backup lifespan
- restore procedure
- how deleted records are prevented from becoming active after restore
- suppression integrity after restore.

---

# 23. TEST FIXTURES

## Audio expiry

Expired QA audio removed, structured outcome remains.

## DNC + prospect cleanup

Ordinary prospect enrichment removed/archived; minimal DNC still prevents outreach.

## Provider license purge

Provider person data removed while public business Account identity remains if independently sourced.

## Restore

Database restored from backup; deletion/suppression reconciliation reapplied before outbound enabled.

---

# 24. ACCEPTANCE

Before real prospect voice pilot:

- campaign has explicit media retention policy
- recording/transcription settings implement compliance decision
- deletion jobs tested
- access roles tested
- logs redacted
- provider retention matrix reviewed
- suppression survives ordinary data expiry
- backup/restore does not resurrect callable suppressed records.
