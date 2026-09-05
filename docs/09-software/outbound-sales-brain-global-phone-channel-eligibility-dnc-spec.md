# Your AI Department — Global Phone Channel Eligibility & DNC Specification

**Status:** Immediate architecture authority  
**Date:** 2026-09-03  
**Implementation owner:** Claude Code  
**Scope:** Prospect Factory, Sales Team Access, human phone outreach, future Twilio voice, callbacks and suppression

---

# 1. PRODUCT DECISION

DNC/compliance screening belongs to the **canonical Prospect Factory**, not only to the Twilio service.

The Prospect Factory should continue to research and retain legitimate business Accounts even when one outreach channel is unavailable.

Core rule:

> **Researchable does not mean human-callable. Human-callable does not mean AI-callable.**

A researched Account may therefore remain valuable for:

- market intelligence;
- email where independently eligible;
- field/relationship workflows where independently eligible;
- future inbound interaction;
- dedupe;
- existing-client/account intelligence;
- no-contact history;

while a specific phone endpoint is blocked for one or all outbound call modes.

Do not delete a good Account merely because a phone endpoint is not callable.

---

# 2. CENTRALIZED ENDPOINT ELIGIBILITY

Every normalized `PhoneEndpoint` should have independent current decisions for at least:

- `HUMAN_MANUAL_CALL`
- `AUTONOMOUS_AI_VOICE`
- `SMS` where implemented
- `INBOUND_CALLBACK_ROUTE` as relationship context, not cold-outbound permission

Email remains separately evaluated by email policy.

Recommended normalized decision values per channel:

- `ALLOW`
- `BLOCK`
- `REVIEW_REQUIRED`
- `NOT_APPLICABLE`

Rep/product labels may render these as:

- `Human Call Allowed`
- `AI Voice Allowed`
- `Review Required`
- `Do Not Call`

Do not expose one ambiguous `CALL_READY` flag when human and AI eligibility differ.

---

# 3. WHY THIS IS GLOBAL RATHER THAN TWILIO-ONLY

The same Account can be contacted through:

- a rep's manual phone call;
- future company click-to-call;
- Twilio outbound Sales AI;
- requested callback;
- field sales;
- Smartlead/email;
- inbound callback.

A suppression request or registry result must not disappear merely because YAD changes the tool used to place the call.

Twilio is a transport provider downstream of the policy decision.

Correct architecture:

`Market Miner / imports`
-> `Canonical Account + PhoneEndpoint`
-> `Registry/Suppression Screening`
-> `Channel Eligibility`
-> `Rep Portal / AI Campaign`
-> `Immediate pre-action recheck`
-> `Human phone OR approved Twilio action`.

---

# 4. DO NOT THROW PROSPECTS AWAY

The Market Miner should not discard an Account merely because:

- National/state registry screening blocks a call mode;
- AI voice is review-required;
- line type is unknown;
- a direct person's phone is suppressed;
- current local calling window is closed.

Instead preserve:

- Account identity;
- website;
- market/vertical;
- ad/research evidence;
- decision-maker research;
- eligible non-phone channels;
- suppression/registry state;
- timeline/history.

A suppressed endpoint should no longer appear as an actionable cold-call endpoint, but its minimal identity must remain sufficient to prevent rediscovery from resurrecting it as callable.

---

# 5. SCREENING SOURCES / LAYERS

The compliance engine should reconcile, according to current reviewed policy:

1. YAD entity-specific/internal DNC;
2. phone/contact/account suppression;
3. applicable National Do Not Call registry screening;
4. applicable state DNC/telemarketing restrictions;
5. provider/carrier policy requirements, including Twilio rules when Twilio is used;
6. line type / business-vs-personal context;
7. contact basis/consent/relationship;
8. destination jurisdiction and local calling time;
9. attempt/cooldown history;
10. campaign mode/technology (`human_live_call` vs `AI_generated_voice`);
11. recording/transcription policy where relevant.

No LLM decides these rules.

---

# 6. REGISTRY DATA IS PURPOSE-LIMITED

Do Not Call registry data is compliance data, not prospect-enrichment data.

Architecture requirements:

- registry access occurs in a protected compliance service/worker;
- raw registry data is not exposed to sales reps;
- raw registry data is not added to prompt/RAG context;
- registry membership is not used as a marketing feature or ranking signal;
- store only the minimum screening result/provenance needed for compliance/audit;
- access/version/freshness follows reviewed legal/provider requirements.

Suggested minimal `RegistryScreenResult`:

```text
registry_screen_id
phone_endpoint_id
registry_type
jurisdiction
result = MATCH | NO_MATCH | UNKNOWN | ERROR
screened_at
source_dataset_version_or_access_date
policy_version
expires_or_refresh_by
reason_codes[]
```

Do not use the Registry for any purpose other than compliance/preventing prohibited calls.

---

# 7. HUMAN MANUAL CALLS

A live human rep calling manually is a distinct channel from AI-generated/artificial voice.

A prospect may legitimately resolve as:

```text
HUMAN_MANUAL_CALL = ALLOW
AUTONOMOUS_AI_VOICE = REVIEW_REQUIRED
```

or:

```text
HUMAN_MANUAL_CALL = BLOCK
AUTONOMOUS_AI_VOICE = BLOCK
```

or another reviewed combination.

The system must never assume that `AI blocked` means `human allowed` automatically. Human eligibility still runs through current applicable policy.

---

# 8. SALES REP CELL PHONE WORKFLOW

V1 may allow a rep to place an eligible human call from the rep's normal phone/cell phone.

However, the rep's cell phone is **not** a compliance bypass.

Required portal flow:

1. Rep claims/owns Account.
2. Rep chooses `Start Manual Call` or taps a human-call action.
3. Server re-evaluates current `HUMAN_MANUAL_CALL` eligibility.
4. If `ALLOW`, portal may reveal/tap/copy the approved endpoint and open the phone dialer where supported.
5. Create/log a manual `ContactAttempt` with rep/account/endpoint/time/policy decision.
6. Rep places the live human call.
7. Rep records disposition/callback/wrong-number/DNC.
8. Any DNC immediately updates canonical suppression for all affected YAD channels according to scope.

If `BLOCK`:

- disable call action;
- do not show a misleading `Call Ready` state;
- explain short business-safe reason such as `Do Not Call`, `Channel Blocked`, or `Policy Review Required`.

If `REVIEW_REQUIRED`:

- rep cannot self-override;
- route to configured review process.

---

# 9. YAD-SPECIFIC DNC IS CROSS-CHANNEL

If a prospect tells YAD:

- `stop calling me`;
- `do not call this number again`;
- `take me off your call list`;

YAD must preserve and honor the resulting suppression scope across YAD calling systems.

A YAD-specific phone DNC may not be bypassed by:

- Twilio;
- a rep's personal cell;
- a different rep;
- a future calling provider;
- rediscovering the business from Google/Apollo/import;
- changing campaign.

If request is account-wide, apply account-wide scope according to deterministic policy.

If scope is ambiguous, use conservative policy/review rather than salesperson interpretation.

---

# 10. TWILIO-SPECIFIC REQUIREMENT

When Twilio is the telephony provider, the current Twilio Voice Services Policy becomes an additional provider rule.

For telemarketing/advertising use, implementation must apply applicable DNC registry screening required by Twilio before the Twilio call request.

Twilio does not become the source of truth for YAD suppression.

YAD maintains its own canonical screening/suppression state and sends Twilio only an already-authorized call attempt.

No Twilio REST `Calls.create` equivalent should execute unless the current provider-aware compliance decision permits the specific action.

---

# 11. SCREENING MOMENTS

Do not perform only one lifetime DNC lookup.

Recommended lifecycle:

## Endpoint creation/import

- normalize phone;
- attach provenance;
- run/queue initial registry/policy screening if endpoint may become actionable.

## Saved Market / list preparation

- refresh stale screening for prospects intended for phone outreach.

## Claim / My Prospects

- show current human/AI eligibility separately.

## Immediately before manual call action

- recheck internal suppression;
- re-evaluate current human-call policy;
- refresh registry decision when TTL/policy requires.

## Immediately before autonomous/Twilio call

- recheck all current suppression;
- current applicable registry result;
- provider rule;
- AI-voice/jurisdiction/contact-basis rule;
- line type;
- local calling window;
- attempt history;
- kill/campaign state.

A stale yesterday decision is not a permanent authorization.

---

# 12. CONTACTABILITY READ MODEL

Recommended rep-facing read model:

```text
PhoneEndpointReadiness
- endpoint_id
- display_number
- endpoint_type
- quality_state
- source_summary
- line_type
- human_manual_call: ALLOW | BLOCK | REVIEW_REQUIRED
- autonomous_ai_voice: ALLOW | BLOCK | REVIEW_REQUIRED
- next_human_eligible_at optional
- next_ai_eligible_at optional
- user_safe_reason_codes[]
- evaluated_at
- policy_version
```

The portal should make it visually obvious when:

- a number is usable by a human only;
- AI voice is not approved;
- no outbound phone use is allowed;
- registry/policy review is pending.

---

# 13. INVENTORY / SEARCH FILTERS

The rep can still search/browse the entire researched market subject to normal RBAC.

Add filters such as:

- `Human Call Allowed`
- `AI Voice Allowed`
- `Phone Review Required`
- `Email Only`
- `Do Not Call / Suppressed` manager/research visibility only where appropriate

Ordinary prospect-count metrics should distinguish:

- researched Accounts;
- human-call eligible;
- AI-call eligible;
- email eligible;
- no outbound phone.

Do not hide market coverage merely because phone eligibility is lower.

---

# 14. CLAIMING VS CONTACTING

Account ownership and channel permission are separate.

A rep may be allowed to claim/research an Account even if:

- phone currently blocked;
- email only;
- contact research still running;

if product policy says there is another legitimate reason to own/work it.

But `Claim to Me` must never be interpreted as permission to use every endpoint/channel.

Every action checks the current channel plan.

---

# 15. DNC DURABILITY

DNC/suppression must survive:

- service restart;
- server migration;
- Account merge;
- contact re-enrichment;
- new provider import;
- Market Miner rediscovery;
- source deletion;
- ordinary prospect retention cleanup;
- rep reassignment;
- campaign change.

Backups/restores must reconcile suppression before outbound is re-enabled.

---

# 16. MANUAL CALL AUDIT

Even when the actual voice travels over a rep's cellular carrier rather than Twilio, YAD should preserve enough metadata to coordinate the relationship:

```text
manual_contact_attempt_id
account_id
contact_id optional
endpoint_id
rep_user_id
channel = HUMAN_PHONE
intent
eligibility_decision_id
started_at
completed_at optional
disposition
notes
callback_id optional
suppression_event_id optional
```

Do not require call audio/recording to log a manual contact attempt.

Recording is a separate policy question.

---

# 17. COMPANY-MANAGED CALLING LATER

Personal cell calling is acceptable as a V1 Human Assist option where policy permits, but the preferred mature design is a company-managed human-calling path because it improves:

- centralized attempt logging;
- caller identity/brand consistency;
- callback routing;
- ownership enforcement;
- DNC preflight;
- campaign metrics;
- manager visibility;
- number reputation controls.

This must not be implemented as caller-ID spoofing or number rotation to evade reputation or suppression.

---

# 18. PROVIDER-NEUTRAL POLICY

Do not encode `twilio_allowed` as the only policy concept.

Core eligibility is provider-neutral and technology-aware.

Provider adapters may add stricter constraints.

Example:

```text
base human policy -> ALLOW
base AI voice policy -> REVIEW_REQUIRED
Twilio provider policy -> BLOCK
```

Final Twilio action is BLOCK.

A separate human manual call may still be ALLOW if the human policy independently permits it.

The stricter applicable rule wins for the requested action.

---

# 19. HARD FAILS

Release hard fails include:

- Twilio-only DNC list while rep cell calls ignore the same YAD suppression;
- rep can copy/tap a `BLOCK` endpoint through ordinary portal UI;
- AI queue can use an endpoint marked human-only;
- YAD DNC disappears after Account re-import/rediscovery;
- National/state registry data used to score or enrich prospects;
- raw registry membership exposed as a sales-personalization fact;
- one generic `CALL_READY` flag hides human-vs-AI difference;
- rep can self-override a DNC/review block;
- Twilio call can execute without a fresh provider-aware decision;
- registry screening failure silently converts to `NO_MATCH`.

---

# 20. CORE ACCEPTANCE EXAMPLES

## Example A — business line, human allowed, AI not yet approved

```text
ABC HVAC
Phone: official main business line
Human Manual Call: ALLOW
AI Voice: REVIEW_REQUIRED
```

Rep may manually call according to current human-sales policy. Sales AI does not receive it in a production dial cohort.

## Example B — YAD DNC

```text
ABC HVAC
Phone: valid official number
YAD DNC: ACTIVE
Human Manual Call: BLOCK
AI Voice: BLOCK
```

Account remains in canonical history/research but is not a cold-call target.

## Example C — phone blocked, email independently eligible

```text
XYZ Roofing
Human Manual Call: BLOCK
AI Voice: BLOCK
Email: ALLOW
```

Rep sees `Email Only`, not `Call Ready`.

## Example D — unknown line/contact context

```text
Direct-number candidate from weak source
Human Manual Call: REVIEW_REQUIRED
AI Voice: REVIEW_REQUIRED
```

Research can continue; no call action until resolved.

---

# 21. CORE RULE

**Build one researched Account inventory, then decide channel-by-channel what YAD may do with each endpoint. Never use a different phone or provider as a workaround for a suppression or policy block.**
