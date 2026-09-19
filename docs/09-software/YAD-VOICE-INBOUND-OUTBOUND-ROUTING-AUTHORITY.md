# YAD Voice — Inbound / Outbound Routing Authority

**Status:** Product/runtime authority for the next voice deployment phase.

**Scope:** Your AI Department's production Twilio sales number must support both outbound sales calls and inbound calls/callbacks without confusing the two call modes. This document defines the required behavior and naming. It does **not** authorize production prospect dialing.

## 1. One phone number, separate call modes

The same YAD Twilio number may be used for both directions, but **same number does not mean same process or persona**.

Required logical modes:

- `OUTBOUND_SALES` — YAD initiates an approved sales call.
- `INBOUND_CALLBACK` — a caller is deterministically matched to a recent outbound YAD sales attempt or an existing sales relationship.
- `INBOUND_GENERAL` — an incoming caller cannot safely be matched to a recent outbound sales context and receives normal inbound/receptionist handling.

The runtime must determine direction/mode deterministically from Twilio request context plus CRM state. The LLM must never decide whether a call is inbound vs outbound, whether a callback relationship exists, or whether outbound dialing is permitted.

## 2. Service names must be unmistakable

Target service ownership:

- `yad-sales-voice.service` — **NEW OUTBOUND SALES AI**. Owns outbound sales voice traffic, including `/outbound/*`.
- `yad-inbound-voice.service` — **NEW INBOUND / CALLBACK AI**. Owns inbound Twilio voice traffic after it is implemented and verified.
- `yad-voice-agent.service` — **LEGACY AGENT**. Do not disable, rename, or repurpose it until we inspect exactly what it serves and prove the replacement inbound path works.

Each production service must have its own route namespace, health check, logs, process/service name, and deployment/rollback procedure. An operator must be able to tell from a service name and request path which mode handled a call.

Do not route inbound callbacks through the outbound cold-call opener simply because both use the same phone number.

## 3. Outbound behavior

`OUTBOUND_SALES` uses the Sales AI and the current deterministic compliance/eligibility gates.

Production prospect dialing remains blocked unless all required gates are satisfied. Enabling or deploying inbound voice must **not** arm outbound dialing.

Outbound must preserve:

- deterministic channel/compliance eligibility;
- DNC/suppression as authoritative;
- approved caller-ID checks;
- pilot/kill-switch controls;
- CRM call-attempt and relationship state;
- no invented research, proof, pricing, outcomes, or booking confirmation.

## 4. Inbound callback behavior

When an incoming call arrives on the YAD sales number, backend logic must attempt a bounded, deterministic callback-context resolution before prompting the model.

A positive callback match may use only bounded CRM facts needed to continue the relationship, such as:

- Account/company identity;
- known contact identity when sufficiently supported;
- the fact and time of a recent YAD outbound attempt;
- last disposition / call status;
- an existing requested callback or follow-up;
- existing positive reply, meeting, or opportunity state;
- current suppression/DNC/wrong-number state;
- the safe next action already recorded in CRM.

A matched callback **must not restart the cold outbound opener**. The system should acknowledge the return call naturally and continue from the known relationship state without pretending to remember facts that are not in CRM.

If callback resolution is ambiguous, stale, conflicting, or unavailable, fail safely to `INBOUND_GENERAL`; do not guess the caller's identity or company.

## 5. General inbound behavior

An unknown incoming caller receives normal inbound/receptionist handling. The inbound agent may identify Your AI Department, understand why the person is calling, capture needed contact/context, route or schedule when permitted, and create an auditable CRM event.

An unknown inbound caller must never inherit the outbound cold-sales persona or a different Account's recent context.

Inbound contact by itself does **not** create permission for later cold outbound calls and does not bypass DNC/suppression or channel-eligibility policy.

## 6. DNC, wrong-number, and suppression callbacks

DNC/suppression governs **future outbound initiation**. It must not cause the system to hang up on a person who voluntarily calls YAD for service or to resolve a prior interaction, but it must remain visible and prevent inappropriate future outbound work.

If an inbound callback establishes that a phone endpoint is a wrong/reassigned number:

- mark that endpoint invalid/wrong-number using the canonical CRM workflow;
- stop sales treatment of that endpoint;
- do not suppress unrelated valid endpoints or destroy the Account relationship;
- do not restart a cold pitch;
- write the event durably and audibly to the CRM timeline/audit trail.

Wrong-number handling must be represented in the Sales Manual/knowledge authority before production voice rollout; the current retrieval evaluation has identified it as a known content gap.

## 7. Relationship coordination

Inbound and outbound share CRM relationship facts but not conversational sessions/personas.

Required cases include:

- prospect returns a missed outbound call;
- prospect calls back after a short prior conversation;
- caller returns after requesting a specific callback time;
- positive email/SMS reply followed by inbound call;
- caller already has a meeting or opportunity;
- caller asks for Michael or another human;
- gatekeeper returns the call;
- multi-location / multi-contact Account;
- DNC callback;
- wrong-number callback;
- unknown inbound caller.

A callback must not create duplicate meetings, duplicate opportunities, duplicate follow-ups, or restart generic cold outreach when a relationship already exists.

## 8. Twilio routing and cutover requirements

Before changing the production Twilio number's inbound Voice URL or outbound application routing:

1. deploy and independently health-check the new service involved;
2. test route isolation;
3. test known callback, unknown inbound, DNC callback, wrong-number callback, and existing-meeting/opportunity cases;
4. verify CRM events are correct and idempotent;
5. verify no route can arm outbound dialing;
6. verify rollback;
7. only then change the relevant Twilio route;
8. preserve the legacy agent until the replacement path is proven;
9. after cutover, verify real inbound behavior before disabling the legacy service.

The old `yad-voice-agent.service` must not be stopped merely because `yad-sales-voice.service` is healthy. Outbound readiness does not prove inbound replacement readiness.

## 9. Privacy and recording

Realtime voice processing, durable transcript retention, audio recording, QA audio retention, and transcript analytics remain separate policy decisions. Inbound callback support does not weaken the existing consent/privacy gates.

Do not retain audio or verbatim transcripts merely because the call was inbound or a callback.

## 10. Required release evidence before legacy retirement

Legacy voice retirement requires evidence that:

- outbound and inbound service identities are unambiguous;
- `/outbound/*` cannot be mistaken for inbound handling;
- inbound routing has a dedicated, healthy owner;
- a recent-prospect callback resumes context without a cold opener;
- unknown inbound never receives another Account's context;
- DNC and wrong-number behavior is correct;
- callback state survives duplicate webhook delivery/retries;
- booking/tool failures never produce false confirmations;
- inbound deployment does not arm outbound dialing;
- rollback to the previous inbound route is documented and tested;
- the legacy service can be disabled without breaking the production phone number.

## 11. Safety boundary

This document is a routing/product authority, **not an authorization to place prospect calls**. Production outbound remains subject to the existing external blockers, deterministic compliance gates, named-pilot approval, and explicit operator authorization.
