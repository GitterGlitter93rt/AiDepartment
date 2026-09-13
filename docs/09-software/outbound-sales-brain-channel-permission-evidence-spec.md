# Your AI Department — Channel Permission & Relationship Evidence Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Give the deterministic eligibility engine structured evidence about why a person/account may be contacted through a particular channel/technology, without letting public contact discovery or model inference become `consent`.

**Important:** This is software/data architecture, not legal advice. Reviewed compliance policy determines what each evidence class legally permits.

---

# 1. PRINCIPLE

`We found the number` is not the same thing as `they agreed to this channel`.

`They are a business` is not the same thing as `autonomous AI voice is allowed`.

`They booked a meeting` is not the same thing as `they consented to unrelated promotional SMS`.

The compliance engine needs explicit structured evidence of the **relationship/contact basis** and a separate policy that decides what that basis permits.

---

# 2. CANONICAL OBJECT

Add a canonical append-oriented object conceptually named:

`ChannelPermissionEvidence`

Fields:

```text
permission_evidence_id
account_id
contact_id optional
endpoint_id optional
seller_entity_id / YAD entity
basis_type
source_type
source_reference
captured_by_actor_type
captured_by_actor_id optional
statement_or_artifact_reference optional
granted_or_observed_at
valid_from optional
valid_until optional
revoked_at optional
revocation_reference optional
scope_channels[]
scope_technologies[]
scope_campaigns[] optional
scope_purposes[]
called_party_or_authorizing_party optional
confidence
review_status
policy_version_at_capture optional
created_at
```

Do not overwrite old evidence when relationship changes; append new evidence/revocation and derive current state.

---

# 3. BASIS TYPES

Initial normalized values:

```text
PUBLIC_BUSINESS_CONTACT
BUSINESS_DIRECTORY_CONTACT
PROSPECT_SUPPLIED_CONTACT
GATEKEEPER_SUPPLIED_BUSINESS_CONTACT
INBOUND_INQUIRY
REQUESTED_CALLBACK
REQUESTED_INFORMATION
EXISTING_CUSTOMER_RELATIONSHIP
PRIOR_BUSINESS_TRANSACTION
EXPRESS_CONSENT
EXPRESS_WRITTEN_CONSENT
EVENT_REGISTRATION_OR_FORM_CONSENT
REFERRAL_INTRODUCTION
ACTIVE_OPPORTUNITY_RELATIONSHIP
MEETING_RELATIONSHIP
INBOUND_CALLBACK
OTHER_REVIEWED_BASIS
UNKNOWN
```

These labels describe evidence/facts. They do not encode a legal conclusion.

---

# 4. SOURCE TYPES

Examples:

- company_website
- business_directory
- public_business_record
- prospect_live_call_statement
- prospect_email
- prospect_form_submission
- prospect_sms
- gatekeeper_live_call_statement
- signed_agreement
- CRM_transaction_record
- Cal.com booking
- inbound_call_event
- referral_record
- manual_verified_entry
- provider_assertion
- unknown.

Provider assertion remains provider assertion; do not upgrade it to prospect consent.

---

# 5. PUBLIC BUSINESS CONTACT

A public business phone/email establishes that:

- the business publicly uses or publishes that contact path according to evidence.

It does NOT by itself establish:

- express consent;
- express written consent;
- a particular individual owns the endpoint;
- AI-generated voice authorization;
- SMS marketing authorization;
- unlimited contact frequency.

Store it because it matters to business/contact context, but policy remains separate.

---

# 6. REQUESTED CALLBACK

If prospect says:

> Call me tomorrow at two.

Capture:

```text
basis_type = REQUESTED_CALLBACK
scope_channels = [voice]
scope_purposes = [continue_current_business_conversation]
requested_time/timezone
requesting_party
source_call_id
```

The evidence should be narrow to the actual request.

Do not automatically treat a requested human callback as blanket permission for:

- autonomous AI voice;
- promotional SMS;
- unrelated future campaigns.

Reviewed policy decides whether same-channel AI callback is permitted for that context.

---

# 7. REQUESTED INFORMATION

If prospect says:

> Email me that information.

Capture evidence for the requested email/topic.

Do not reinterpret as consent for a generic automated nurture sequence unless current policy + evidence support it.

---

# 8. INBOUND INQUIRY / CALLBACK

Inbound interaction is meaningful relationship evidence.

Store:

- inbound timestamp;
- endpoint;
- Account match confidence;
- topic/reason;
- prospect request/expectation.

Do not assume every inbound call grants future AI telemarketing permission.

Use the evidence to route the immediate conversation and let policy determine follow-up scope.

---

# 9. EXPRESS CONSENT

Only create `EXPRESS_CONSENT` when a real source records the called party/prospect affirmatively agreeing to the applicable contact.

Evidence should include, where available:

- exact or normalized consent language;
- who provided it;
- date/time;
- channel/technology/purpose scope;
- source artifact/call/form.

The model may extract a candidate from a transcript, but deterministic validation / reviewed interpretation is required before it becomes permission evidence used to authorize a regulated channel.

Do not infer consent from silence or friendliness.

---

# 10. EXPRESS WRITTEN CONSENT

Use a separate evidence class because reviewed policy may treat written agreement differently from ordinary consent.

Capture sufficient audit evidence such as:

- form/agreement version;
- exact disclosure version;
- timestamp;
- signatory/contact identity;
- signature/affirmative action evidence;
- applicable seller/entity;
- phone number/channel;
- purpose/technology scope;
- source artifact pointer/retention policy.

Do not let a generic `I agree to terms` checkbox become written telemarketing consent unless the actual approved consent disclosure covers it.

---

# 11. EXISTING CUSTOMER / TRANSACTION

Existing-client or prior-transaction evidence belongs in relationship state.

This can be useful to policy but does not automatically bypass:

- entity-specific DNC;
- artificial-voice rules;
- state rules;
- channel-specific opt-outs.

Always evaluate current policy rather than converting customer status directly to `ALLOW`.

---

# 12. MEETING / CAL.COM

A Cal.com booking establishes:

- a meeting relationship;
- attendee contact information supplied for meeting purposes;
- agreed meeting time/event according to provider record.

It does not automatically prove unrelated promotional-channel permission.

It does support:

- meeting reminders according to provider/approved workflow;
- reschedule/cancel communication within that event context;
- Account relationship state.

---

# 13. REFERRAL

Referral evidence should distinguish:

- referrer told YAD about prospect;
- prospect personally agreed to be contacted;
- warm introduction actually occurred.

Do not treat `John said I should call Sarah` as Sarah's express consent unless reviewed policy says the documented context is sufficient for the intended channel.

It can still be relevant to HUMAN_MANUAL_CALL relationship/context under policy.

---

# 14. REVOCATION / OPT-OUT

Permission evidence is subordinate to later revocation/suppression.

If the person says:

- stop calling;
- don't text;
- unsubscribe;
- no more emails;

store the opt-out/suppression event with scope.

Current permission read model computes:

```text
historical_basis + subsequent_revocations + current_policy -> current_channel_basis_state
```

Never delete an opt-out because a new source rediscovers the phone.

---

# 15. SCOPE

Evidence must be scoped where possible.

Dimensions:

## Channel

- voice
- email
- sms
- meeting

## Technology

- human_live_voice
- autonomous_ai_voice
- prerecorded_voice
- manual_email
- automated_email
- sms

## Purpose

- cold_business_development
- requested_callback
- requested_information
- meeting_reminder
- opportunity_followup
- existing_customer_service
- existing_customer_expansion
- other approved.

## Seller/entity

Permission may apply to the relevant YAD legal/seller entity and may not automatically transfer to unrelated brands/clients.

---

# 16. CURRENT BASIS READ MODEL

Create derived object:

`CurrentContactBasis`

Per Account/Contact/Endpoint/Channel/Technology/Purpose:

```text
basis_types[]
strongest_current_evidence
revocation_state
evidence_age
scope_match
policy_interpretation_reference
basis_status = SUPPORTED | INSUFFICIENT | CONTRADICTED | UNKNOWN | REVIEW_REQUIRED
```

This still does **not** equal final call permission.

It feeds `ChannelEligibilityDecision` alongside DNC, line type, jurisdiction, provider policy, time, cadence and relationship state.

---

# 17. LLM BOUNDARY

The Sales AI may:

- hear a prospect request a callback;
- hear a prospect request email;
- extract candidate relationship facts;
- call typed tools to record those facts.

The Sales AI may not:

- declare its own consent legally sufficient;
- upgrade a public business phone to AI permission;
- override an opt-out;
- change the configured scope;
- interpret a vague phrase as blanket written consent.

Typed action service validates and persists evidence.

---

# 18. UI

Ordinary reps should see business-safe summaries, for example:

- `Public business contact`
- `Requested callback: Friday 2 PM`
- `Existing client`
- `Contact basis needs review`
- `AI voice not authorized for this endpoint`

Do not display pseudo-legal conclusions such as `TCPA EXEMPT` unless that label comes from reviewed policy and is appropriate for the role.

Manager audit can inspect evidence class/source/time/scope.

---

# 19. IMPORTS

Imported CSV/Apollo/Airtable fields do not become consent automatically.

If a source contains a claimed consent field:

- map to candidate permission evidence;
- require source/field semantics and auditability;
- do not trust `opt_in = yes` without knowing what disclosure/channel/purpose it represented.

Unknown consent metadata remains unknown.

---

# 20. TEST FIXTURES

1. company website phone -> PUBLIC_BUSINESS_CONTACT; no AI consent.
2. owner says `call me tomorrow at 2` -> narrow REQUESTED_CALLBACK.
3. owner says `email me the assessment` -> REQUESTED_INFORMATION for email/topic.
4. gatekeeper gives GM extension -> GATEKEEPER_SUPPLIED_BUSINESS_CONTACT; no GM consent.
5. inbound prospect calls YAD -> INBOUND_CALLBACK evidence; immediate routing supported, future AI cold permission not inferred.
6. prospect completes approved explicit written AI-voice consent form -> EXPRESS_WRITTEN_CONSENT with disclosure version/artifact.
7. generic website terms checkbox -> not automatically express written telemarketing consent.
8. old customer record -> EXISTING_CUSTOMER_RELATIONSHIP; DNC still overrides.
9. Cal.com booking -> MEETING_RELATIONSHIP; no generic SMS permission inferred.
10. prospect later says stop calling -> suppression overrides prior call evidence.
11. CSV `consent=yes` with no source semantics -> REVIEW_REQUIRED/UNKNOWN, not permission.
12. public owner mobile from directory -> public contact evidence + mobile line type; AI permission still unresolved.

---

# 21. CORE RULE

**Capture why YAD has a contact path and what the prospect actually authorized as structured evidence. Let reviewed deterministic policy decide what that evidence permits. Never turn discovery, friendliness, a meeting, or a public business listing into invented consent.**
