# CLAUDE CODE — DNC / PHONE CHANNEL ELIGIBILITY RELEASE ADDENDUM

**Status:** Immediate release addendum  
**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Implementation owner:** Claude Code  
**Architecture owner:** ChatGPT

This addendum is mandatory for Sales Portal / Sales AI phone implementation and supplements `CLAUDE-CURRENT-TASK.md` and `CLAUDE-SALES-AI-PILOT-CURRENT.md`.

Before implementing or releasing phone actions, read:

1. `outbound-sales-brain-global-phone-channel-eligibility-dnc-spec.md`
2. `outbound-sales-brain-phone-channel-eligibility-fixtures.v1.yaml`
3. `outbound-sales-brain-compliance-engine-spec.md`
4. `outbound-sales-brain-contact-endpoint-quality-spec.md`
5. `outbound-sales-brain-multichannel-coordination-spec.md`
6. `outbound-sales-brain-twilio-telephony-spec.md`
7. `outbound-sales-brain-data-retention-privacy-spec.md`

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

Implement/prepare a server-authoritative manual-call preflight:

```text
Rep opens owned Account
-> Start Manual Call
-> server rechecks suppression + current human-call eligibility
-> ALLOW: create ContactAttempt and enable/reveal tap-to-call endpoint
-> BLOCK: no call action
-> REVIEW_REQUIRED: route to review, no self override
```

The rep's personal phone is transport only. It is not a policy bypass.

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

# 5. TWILIO

Twilio receives only already-authorized attempts.

Before any outbound Twilio REST call, require a current provider-aware policy decision for the exact endpoint + campaign + technology.

Do not assume Twilio will block DNC numbers on YAD's behalf.

The YAD compliance layer is responsible for screening and suppression.

---

# 6. DNC REGISTRY DATA HANDLING

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

# 7. UI CHANGE

Replace ambiguous phone readiness display with channel-specific badges/actions where possible:

- `Human Call Allowed`
- `AI Voice Allowed`
- `Email Only`
- `Review Required`
- `Do Not Call`

For ordinary reps, suppressed phone endpoints must not have an active tap/copy/call action through the normal workflow.

Manager/research visibility may retain redacted/appropriate suppression context under RBAC.

---

# 8. DATA / API

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

---

# 9. REQUIRED TESTS BEFORE TOMORROW RELEASE

Run the complete:

`outbound-sales-brain-phone-channel-eligibility-fixtures.v1.yaml`

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
11. suppression-store failure blocks autonomous dialing.

---

# 10. TOMORROW PILOT REQUIREMENT

Do not place a real outbound Sales AI prospect call unless the exact endpoint has a current deterministic decision allowing that exact AI-voice action under the approved campaign/provider policy.

For Human Assist, a rep may manually call only when current human-call policy returns ALLOW.

Do not use manual rep calling to work around an AI/provider/DNC restriction that also applies to the human channel.

---

# 11. IMPLEMENTATION REPORT

At next checkpoint report:

- current DNC/suppression schema;
- registry screening implementation/provider status;
- human vs AI eligibility representation;
- manual rep-cell preflight behavior;
- Twilio preflight behavior;
- UI badges/actions;
- DNC durability/rediscovery test;
- fixture pass/fail;
- external credentials/registry access blockers;
- whether tomorrow's real AI pilot is `ELIGIBLE`, `BLOCKED`, or `INTERNAL_TEST_ONLY` based on current implementation/policy state.

---

# 12. CORE RULE

**One canonical prospect database. One canonical suppression history. Separate channel decisions. No transport or rep may bypass the current decision for the action being attempted.**
