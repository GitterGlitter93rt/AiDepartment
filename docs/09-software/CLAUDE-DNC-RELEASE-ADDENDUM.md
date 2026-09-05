# CLAUDE CODE — DNC / PHONE CHANNEL ELIGIBILITY RELEASE ADDENDUM

**Status:** Immediate release addendum  
**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Implementation owner:** Claude Code  
**Architecture owner:** ChatGPT

This addendum is mandatory for Sales Portal / Sales AI phone implementation and supplements `CLAUDE-CURRENT-TASK.md` and `CLAUDE-SALES-AI-PILOT-CURRENT.md`.

Before implementing or releasing phone actions, read in this order:

1. `outbound-sales-brain-global-phone-channel-eligibility-dnc-spec.md`
2. `outbound-sales-brain-phone-screening-provider-interface-spec.md`
3. `outbound-sales-brain-phone-channel-eligibility-fixtures.v1.yaml`
4. `outbound-sales-brain-human-manual-call-v1-spec.md`
5. `TOMORROW-OUTBOUND-PILOT-PREFLIGHT-CURRENT.md`
6. `outbound-sales-brain-compliance-engine-spec.md`
7. `outbound-sales-brain-contact-endpoint-quality-spec.md`
8. `outbound-sales-brain-multichannel-coordination-spec.md`
9. `outbound-sales-brain-twilio-telephony-spec.md`
10. `outbound-sales-brain-data-retention-privacy-spec.md`

---

# 1. IMMEDIATE PRODUCT DECISION

DNC/compliance is not a Twilio-only concern.

Implement it at the canonical Prospect Factory / `PhoneEndpoint` layer so every downstream channel receives its own deterministic eligibility result.

Required conceptual states:

```text
HUMAN_MANUAL_CALL = ALLOW | BLOCK | REVIEW_REQUIRED
AUTONOMOUS_AI_VOICE = ALLOW | BLOCK | REVIEW_REQUIRED
SMS = ALLOW | BLOCK | REVIEW_REQUIRED when implemented
EMAIL = independently evaluated
```

Do not continue using one generic `CALL_READY` boolean as the only source of truth.

---

# 2. RESEARCH VS CONTACT

Do not discard Accounts merely because phone contact is blocked.

A researched company remains in canonical inventory/history for:

- dedupe;
- research;
- market intelligence;
- independently eligible email;
- relationship history;
- inbound recognition;
- future approved workflows.

Suppress the action/channel, not the existence of the Account.

---

# 3. HUMAN CELL PHONE V1

Human Assist may allow reps to place live manual calls using their normal/cell phone where the current `HUMAN_MANUAL_CALL` decision is `ALLOW`.

Implement a server-authoritative manual-call preflight:

```text
Rep opens owned Account
-> Start Manual Call
-> server rechecks suppression + current human-call eligibility
-> ALLOW: create ContactAttempt and enable/reveal tap-to-call endpoint
-> BLOCK: no call action
-> REVIEW_REQUIRED: route to review, no self override
```

The rep's personal phone is transport only. It is not a policy bypass.

The detailed implementation authority is:

`outbound-sales-brain-human-manual-call-v1-spec.md`

---

# 4. UNIVERSAL YAD DNC

A valid YAD-specific phone/contact/account DNC must block affected YAD outbound calling regardless of transport:

- rep cell;
- future company human dialer;
- Twilio;
- alternate telephony provider;
- another rep;
- another campaign.

Rediscovery/import/enrichment may not recreate a cold-call eligible duplicate.

Rep may add DNC immediately.

Rep may not remove DNC.

---

# 5. SCREENING PROVIDER ABSTRACTION

Do not hard-code DNC/number screening around one vendor.

Implement the provider-neutral contract in:

`outbound-sales-brain-phone-screening-provider-interface-spec.md`

Required architecture:

```text
PhoneEndpoint
-> internal suppression first
-> applicable external screening adapters
-> normalized RegistryScreenResult(s)
-> deterministic channel eligibility
```

Important:

- screen when an endpoint becomes operationally relevant rather than spending on every scraped company immediately;
- cache only within source/policy TTL;
- a new YAD DNC invalidates prior positive eligibility immediately;
- `ERROR`/`UNKNOWN` never becomes `NO_MATCH`;
- if a required external screen is unavailable, AI outbound fails closed.

---

# 6. TWILIO

Twilio receives only already-authorized attempts.

Before any outbound Twilio REST call, require a current provider-aware policy decision for the exact endpoint + campaign + technology.

Do not assume Twilio will block DNC numbers on YAD's behalf.

The YAD compliance layer is responsible for screening and suppression.

The voice service must not keep a second independent DNC truth store.

---

# 7. DNC REGISTRY DATA HANDLING

Do not expose raw registry data to the rep UI or the Sales AI.

Do not use registry membership as:

- a sales score;
- prospect targeting signal;
- hook/personalization;
- enrichment feature.

Store only minimal protected screening/audit result required by policy.

Implement refresh/TTL semantics rather than a permanent one-time lookup.

A registry/provider screening error must never become `NO_MATCH`.

---

# 8. UI CHANGE

Replace ambiguous phone readiness display with channel-specific badges/actions where possible:

- `Human Call Allowed`
- `AI Voice Allowed`
- `Email Only`
- `Review Required`
- `Do Not Call`

For ordinary reps, suppressed phone endpoints must not have an active tap/copy/call action through the normal workflow.

Manager/research visibility may retain redacted/appropriate suppression context under RBAC.

For a manual call that is ALLOWed, create the ContactAttempt before returning the active `tel:` action.

---

# 9. DATA / API

Add or reconcile durable structures for:

- RegistryScreenResult;
- channel eligibility decision(s);
- policy version;
- evaluated_at;
- refresh_by/TTL;
- reason codes;
- provider-aware constraints;
- manual ContactAttempt with eligibility decision ID;
- suppression source/scope.

Do not create a parallel DNC database disconnected from canonical PhoneEndpoint/Account identity.

Do not mark an unresolved manual call as connected/no-answer merely because the device dialer opened.

---

# 10. REQUIRED TESTS BEFORE TOMORROW RELEASE

Run the complete:

`outbound-sales-brain-phone-channel-eligibility-fixtures.v1.yaml`

and the acceptance cases in:

`outbound-sales-brain-human-manual-call-v1-spec.md`

At minimum prove:

1. human manual ALLOW + AI REVIEW_REQUIRED works;
2. YAD DNC blocks both rep-cell and Twilio cold calls;
3. registry/provider block prevents Twilio request;
4. registry error does not become no-match;
5. stale screen forces current recheck where required;
6. rep marking DNC during a manual cell call blocks future AI and other reps;
7. Account remains researched after phone block;
8. phone-blocked/email-eligible renders `Email Only`;
9. claim ownership does not grant phone permission;
10. rediscovery does not reset DNC;
11. suppression-store failure blocks autonomous dialing;
12. manual ALLOW creates ContactAttempt before dial action;
13. wrong-number disposition disables only the endpoint, not the Account;
14. requested callback persists after restart;
15. personal rep phone number is not required in canonical Prospect Factory schema.

---

# 11. TOMORROW PILOT REQUIREMENT

Use:

`TOMORROW-OUTBOUND-PILOT-PREFLIGHT-CURRENT.md`

as the final operational gate.

Do not place a real outbound Sales AI prospect call unless the exact endpoint has a current deterministic decision allowing that exact AI-voice action under the approved campaign/provider policy.

For Human Assist, a rep may manually call only when current human-call policy returns ALLOW.

Do not use manual rep calling to work around a restriction that also applies to the human channel.

At the end of testing, classify the release as exactly one of:

- `REAL_AI_PILOT_ELIGIBLE`
- `INTERNAL_AI_TEST_ONLY`
- `HUMAN_ASSIST_ONLY`

---

# 12. IMPLEMENTATION REPORT

At next checkpoint report:

- current DNC/suppression schema;
- registry screening implementation/provider status;
- external registry/provider credentials/access status;
- normalized screening adapter status;
- screening cache/TTL behavior;
- human vs AI eligibility representation;
- manual rep-cell preflight behavior;
- ContactAttempt lifecycle;
- Twilio preflight behavior;
- UI badges/actions;
- DNC durability/rediscovery test;
- fixture pass/fail;
- manual-call acceptance results;
- Cal.com booking status;
- voice latency/barge-in status;
- exact tomorrow release classification.

---

# 13. CORE RULE

**One canonical prospect database. One canonical suppression history. Separate channel decisions. The Sales Brain authorizes the action; the rep's phone or Twilio only transports it.**