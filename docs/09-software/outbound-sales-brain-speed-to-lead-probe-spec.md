# Your AI Department — Speed-to-Lead Probe Number Pool Specification

**Status:** Architecture authority — **design only. No live probing authorized by this document.**  
**Date:** 2026-09-09  
**Purpose:** Measure what actually happens to a new web/paid lead at a prospect company — acknowledgement, first human contact, channel, latency — through a controlled, authorized, attributable audit, using a small shared pool of Twilio numbers rather than one number per prospect.  
**Implementation owner:** Claude Code  
**Architecture:** ChatGPT  
**Approval owner:** Michael Chanata

---

# 1. WHY THIS SUBSYSTEM EXISTS

The HVAC vertical profile already declares, on the `speed_to_lead` hypothesis:

```yaml
must_not_claim:
  - current_response_time_without_measurement
```

and on its ROI tool:

```yaml
roi_tool_id: lead_response_roi
required_inputs: [lead_volume, current_response_process, outcome_rate_or_measurement_plan]
prohibited_shortcuts: [invented_speed_to_lead_gain]
```

So the single most commercially useful thing a rep could say about a paid advertiser —
*how long a new lead actually waits* — is a sentence the architecture currently
forbids, correctly, because nothing measures it. `speed_to_lead` fires today from
`active_google_search_ads`, `active_meta_ads` and `online_quote_or_booking`: all of
which establish that leads exist, and none of which say what happens to one.

This subsystem is the measurement that turns that prohibition into an evidenced fact
for one inquiry on one date. It does not turn it into a claim about the company's
typical performance, and §18 exists to keep that distinction.

---

# 2. WHAT IS AND IS NOT AUTHORIZED

Authorized by this document:

- the design, schema, state machine, attribution logic and signals below;
- implementation behind a **dry-run/simulated** mode that submits nothing (§21);
- fixtures and tests against simulated forms and simulated inbound events.

**Not** authorized by this document:

- any live form submission to any real company;
- purchasing Twilio numbers for a probe pool;
- enabling the inbound probe agent on a live number;
- any bulk or autonomous probing.

A future live probe requires explicit written authorization from Michael, per §22.
That authorization is **separate from and must not be conflated with** the DataForSEO
paid canary gate (`DATAFORSEO_GOVERNANCE_REVIEWED`, SB-B3). Those are different
spends, different counterparties and different risks. Neither implies the other.

---

# 3. STANDING PROHIBITIONS THIS SUBSYSTEM CONFLICTS WITH

This is the part that cannot be resolved by writing a new document, and it is
recorded here rather than left for somebody to discover during implementation.

A lead-response probe **is** a fake inquiry. It submits a form representing a
prospective customer who does not exist. Five places across three
architecture-authority documents prohibit exactly that, unconditionally:

| Document | Location | Text |
| --- | --- | --- |
| `outbound-ai-sales-brain-master-spec.md` | Front-End Technology Adapter, line 341 | "Do not submit fake forms, appointments, legal inquiries, patient inquiries, or quote requests." |
| `outbound-ai-sales-brain-master-spec.md` | Research acceptance, line 1731 | acceptance criterion: "no fake form submissions" |
| `outbound-sales-brain-implementation-gates.md` | standing rules, line 15 | standing rule: "no fake lead/form submissions" |
| `outbound-sales-brain-implementation-gates.md` | Gate 6 criteria, line 160 | Gate criterion: "no form submission" |
| `outbound-sales-brain-index.md` | §15 Non-negotiable rules | non-negotiable rule: "no fake lead/form submissions" |

Three more scope themselves around the same boundary:

- `market-miner-paid-demand-funnel-audit-spec.md` — audits the funnel "without
  submitting fake inquiries". That spec is the **passive** half; this one is the
  active half, and the two must not be merged.
- `market-miner-website-intelligence-spec.md` — its stated purpose is claim-safe
  intelligence "without fake form submissions". The probe does not change how that
  engine works; it must not become a caller of it.
- `market-miner-untrusted-content-security-spec.md` §16 (line 284) — "Browser
  fallback must prevent accidental form submission/booking/message."

Consequences, stated plainly:

1. **These prohibitions are not reinterpreted by this document and are not waived by
   it.** Until Michael amends those five lines, the live probe cannot run, and
   the dry-run mode in §21 is not an exception to them because it submits nothing.
2. The §16 security rule must **stay** as written. A probe submission is a
   deliberate, authorized, ledger-backed action taken by the probe worker. It must
   never be reachable from the research crawler, and "accidental submission is
   prevented" must remain true of every other code path.
3. Amending a prohibition is a decision about what YAD is willing to do to a
   prospect, not a technical detail. §22 carries it.

---

# 4. PRIMARY IDENTITY: THE PROBE, NOT THE NUMBER

We are not buying one Twilio number per prospect. At ~100 audits/night that is a
number-purchasing programme, not a measurement.

**The probe is the identity. The Twilio number is a shared transport detail.**

One pool number services many simultaneously open probes. Attribution is performed
by the durable probe ledger and the inbound event ledger, never by number ownership.
Nothing in this subsystem may infer an Account from a Twilio number alone.

Corollary, because it is the shortcut everyone reaches for: **a number having exactly
one open probe is not attribution.** Wrong numbers, spam, and a previous probe's late
response all land on that number too. Sole occupancy contributes nothing on its own;
see §7.

---

# 5. THE PROBE LEDGER

`lead_response_probes`. One row per probe, durable, append-mostly.

This adds no second Account or prospect database. `account_id` references the
canonical `accounts` row and is resolved through `resolveAccountId()` (merge-aware)
on read, exactly as `src/inbound/resolver.ts` does.

Identity and selection:

- `probe_id` — primary identity, a UUID
- `account_id` — canonical Account
- `market_id` / geography — the market the Account was selected from
- `vertical_profile_id`
- `discovery_observation_id` — the search/SERP observation that caused selection
- `paid_ad_evidence_ids[]` — the ad evidence, where the probe was selected because
  the company is paying for demand
- `target_form_url` — the exact page submitted to
- `target_funnel_observation_id` — the `PaidDemandFunnelObservation` this probe was
  built from, so the CTA and form we submitted are the ones that were audited

Submission:

- `assigned_pool_number_id` — the pool number, not the number string
- `submitted_email_identity` — the probe alias (§10)
- `submitted_identity_id` — which fictitious identity was used (§14.6)
- `submitted_at`
- `submitted_payload_digest` — hash of what was submitted, so the submission can be
  proven without storing a re-submittable payload
- `consent_checkboxes_presented[]` / `consent_checkboxes_checked[]` — recorded
  verbatim, because §22.3 turns on exactly what we agreed to

Identity snapshot at submission time. Snapshotted because attribution must not be
corrupted by a later merge, rename or phone-number edit:

- `account_name_at_submission`
- `account_domain_at_submission`
- `account_phones_at_submission[]` — normalized E.164, the primary attribution key
- `account_alternate_phones_at_submission[]` — call-center, franchise, toll-free

State and attribution:

- `status` — §13
- `attribution_state` — UNATTRIBUTED | ATTRIBUTED | AMBIGUOUS | CONTESTED
- `attribution_confidence` — HIGH | MEDIUM | LOW | NONE
- `attribution_evidence_ids[]`

Response milestones. Each is a nullable timestamp plus the inbound event that
established it. All six are distinct facts and none substitutes for another:

- `first_automated_sms_at` / `_event_id`
- `first_human_sms_at` / `_event_id`
- `first_automated_call_at` / `_event_id`
- `first_human_call_at` / `_event_id`
- `first_email_response_at` / `_event_id`
- `first_meaningful_contact_at` / `_event_id` — the first contact from a human that
  engages the inquiry (§8.4)

Derived measurements (§9):

- `elapsed_to_first_response_seconds`
- `elapsed_to_first_meaningful_seconds`
- `business_hours_adjusted_seconds` — **nullable, and null when business hours are
  unknown.** Never zero as a stand-in.
- `business_hours_source`
- `submitted_outside_business_hours` — boolean, nullable

Outcome:

- `final_outcome` — §13 terminal state
- `window_1_closed_at` / `window_final_closed_at`
- `cooldown_until`
- `authorized_by` / `authorized_at` — who authorized this probe (§14.1)
- `provenance` — evidence record ids for everything above

---

# 6. THE INBOUND EVENT LEDGER

`probe_inbound_events`. Every inbound Twilio event on a pool number, recorded
whether or not it is ever attributed. An unattributable event is data about our
attribution, not a fact about anybody.

- `event_id`
- `provider_sid` — Twilio `CallSid` or `MessageSid`, unique, the idempotency key
- `channel` — CALL | SMS
- `from_number` — normalized E.164, raw preserved
- `to_number` — the pool number reached
- `occurred_at` — provider timestamp, and `received_at` ours
- `message_body` — SMS only, retained under §16
- `call_disposition` — for calls
- `actor_type` — HUMAN | AUTOMATED | UNKNOWN (§8)
- `actor_type_evidence[]`
- `attributed_probe_id` — nullable
- `attribution_tier` — which rung of §7 decided it
- `attribution_confidence`
- `attribution_evidence[]`
- `candidate_probe_ids[]` — every probe that remained plausible, kept even when one
  won, because that is what makes an AMBIGUOUS verdict reviewable

Twilio request signature validation is mandatory and reuses the existing ingress
rules in `outbound-sales-brain-public-webhook-ingress-spec.md`. An event failing
signature validation is rejected, not stored as a response.

---

# 7. THE ATTRIBUTION LADDER

This extends `src/inbound/resolver.ts` and `src/inbound/evidence.ts` rather than
building a parallel resolver. That resolver already decides identity deterministically
before any prompt exists, ranks evidence strongest-first, treats a two-Account match
as ambiguous rather than a coin toss, and fails safe. A third mode is added:

```
InboundMode = INBOUND_CALLBACK | INBOUND_GENERAL | INBOUND_PROBE_RESPONSE
```

Ranked strongest first. The first rung that matches decides, and the rungs below it
are recorded as corroboration rather than re-evaluated:

**Tier 1 — HIGH. Known Account number.**
Inbound `From` exactly matches a normalized phone in
`account_phones_at_submission` for exactly **one** probe currently open on the
`To` pool number.
If it matches such a phone for **two or more** open probes on that number, this is
AMBIGUOUS — which is precisely the collision §11 exists to prevent in advance.

**Tier 2 — HIGH or MEDIUM. Known alternate/call-center number.**
`From` matches `account_alternate_phones_at_submission` for exactly one open probe.
HIGH when that alternate number is known to belong to that Account alone; MEDIUM
when it is a franchise or call-center number that could serve siblings. MEDIUM never
promotes itself to HIGH by being the only rung that matched.

**Tier 3 — MEDIUM. Self-identifying SMS content.**
An inbound SMS whose body contains the Account's name, domain, or a booking/ticket
reference traceable to the submission. Deterministic matching against the snapshot
fields, not model judgement. A generic body ("Thanks for contacting us!") identifies
nothing and stays at Tier 5.

**Tier 4 — HIGH or MEDIUM. Answered identification question.**
For an inbound **call** whose ANI is unknown or withheld, the probe agent may ask one
neutral question — *"Which company are you calling from?"* — and use the structured
answer to resolve among the probes open on that number (§15). HIGH when the answer
matches exactly one open probe's snapshot name/domain; MEDIUM when the match is
partial but unique; AMBIGUOUS when it matches more than one.

**Tier 5 — AMBIGUOUS. Everything else.**
More than one plausible probe, or none. Recorded with `candidate_probe_ids[]` and
routed to human review. **No response-time fact of any kind is derived from an
AMBIGUOUS event, and an AMBIGUOUS event is never evidence that anybody failed to
respond.**

Sole occupancy of a pool number is deliberately absent from this ladder.

---

# 8. ACTOR TYPE: DO NOT ASSUME THE CALLER IS HUMAN

`actor_type` is `HUMAN | AUTOMATED | UNKNOWN` and **defaults to UNKNOWN.**

## 8.1 Evidence for AUTOMATED

- inbound SMS within a few seconds of submission (configurable, default 60s);
- sender is a no-reply/short-code/alphanumeric sender;
- body matches a known auto-responder template;
- the `OUT_OF_OFFICE` class already implemented in `src/email/inbound.ts`;
- **cross-probe template fingerprint** — the same normalized body observed for two or
  more distinct probes. Strong, cheap, and it improves as the pool runs.
- for calls: IVR/ringless-voicemail detection, no speech, DTMF-only.

## 8.2 Evidence for HUMAN

- a two-way exchange;
- a person answering the §15 identification question;
- free text specific to this submission — naming the service, the alias, or the
  submitted detail.

## 8.3 The rule that matters

**Absence of automation evidence is not evidence of a human.** An unclassifiable
response stays UNKNOWN, and UNKNOWN never satisfies a human-response signal.

## 8.4 First meaningful contact

`first_meaningful_contact_at` requires **all** of: `actor_type = HUMAN`,
attribution confidence HIGH or MEDIUM, and content that engages the inquiry.

An automated "Thanks for contacting us, we'll be in touch" is
`first_automated_sms_at` and nothing else. It is never human follow-up, never
meaningful contact, and never `lead_response_latency`'s human variant.

---

# 9. LATENCY: TWO NUMBERS, NEVER ONE

Both are preserved separately, always, because one of them can be used to mislead
and the other cannot be used at all without the first.

- **`elapsed_*_seconds`** — true wall-clock elapsed time. The honest primary number.
- **`business_hours_adjusted_seconds`** — elapsed time minus time outside the
  Account's business hours.

Rules:

1. Business hours come from the Account's timezone and published hours, reusing the
   timezone/calling-window machinery in
   `outbound-sales-brain-compliance-engine-spec.md` §7. `business_hours_source`
   records which.
2. **When hours are unknown, the adjusted figure is `null`.** Not zero, not the raw
   elapsed time, not an assumed 9-5. A null renders as "business-hours figure not
   available" and the rep gets the raw number only.
3. Neither figure may be presented alone. A 16-hour overnight wait shown only as raw
   elapsed invites "they ignore leads for 16 hours"; shown only as adjusted it hides
   that the customer waited overnight. The rep-facing renderer (§19) emits both or
   refuses.
4. An after-hours submission is a deliberate, recorded property of the probe
   (`submitted_outside_business_hours`), not an accident to be explained later.

---

# 10. EMAIL ATTRIBUTION: CHEAP, UNIQUE, NO NEW MAILBOXES

The precedent already exists: `src/email/inbound.ts` carries `enrollmentId` — *"the
correlation id we supplied on export. Preferred over the address."* Probe email
attribution is the same idea keyed to `probe_id`.

Mechanism, in preference order:

1. **Sub-addressing** — `probe+<probe_token>@<domain>` where the provider supports it.
   Zero cost, exact mapping, no new mailbox.
2. **Catch-all on a dedicated probe subdomain** — `<probe_token>@probes.<domain>`.
   Preferred where sub-addressing is stripped by the target's form validation, which
   is common; some forms reject `+`.
3. **Never** one mailbox per probe.

`probe_token` is a random opaque token, not a sequential id and not the raw
`probe_id`: the alias is handed to a third party and must not leak volume or
ordering.

Requirements:

- the token maps to exactly one probe, permanently, and is never reused;
- an inbound email whose token resolves gives **Tier 1-equivalent HIGH** attribution
  — it is the strongest signal in the subsystem, because only that company was ever
  given that address;
- a reply to the alias from an unexpected domain is recorded and attributed to the
  probe, with the domain mismatch noted — that is how a franchise call center or an
  outsourced ISA shows up, which is itself a finding;
- the probe subdomain must have its own SPF/DKIM/DMARC and must be separate from the
  outbound sales sending domain, so a probe cannot affect sales deliverability.

---

# 11. NUMBER POOL AND COLLISION-AWARE ALLOCATION

`probe_pool_numbers`: `pool_number_id`, E.164, Twilio SID, market/area-code affinity,
`status` (ACTIVE | QUARANTINED | RELEASED), `max_concurrent_open_probes`.

Many-to-one multiplexing is expected and normal. A number does not become exclusive
to a probe while its window is open.

## 11.1 Round-robin is not acceptable

Round-robin will eventually put two companies that share a phone system on the same
number at the same time, and every response from that system becomes permanently
ambiguous. The allocator is collision-aware.

## 11.2 Collision keys

For each Account, compute a `collision_key_set` at allocation time:

- every normalized known phone number, including alternates and toll-free;
- franchise/brand identifier;
- corporate parent or ownership group, from the existing merge/ownership model;
- shared registrable domain;
- shared call-center or answering-service number;
- shared LSA/lead-portal account identifier where known.

Two probes **collide** if their key sets intersect.

## 11.3 Allocation rule

A pool number may be assigned to a new probe only if **no currently-open probe on
that number collides** with it. If every ACTIVE number collides, the probe is
**deferred, not forced**. `PLANNED` is a legitimate resting state; a forced
assignment buys one measurement and destroys its own attribution.

Secondary preferences, applied only among non-colliding candidates: market/area-code
affinity, then fewest open probes, then least-recently-assigned.

## 11.4 Attribution-quality cap

`max_concurrent_open_probes` is a separate guard from collision. Collision protects
Tiers 1-3; the cap protects Tier 4, because "which company are you calling from?"
resolves cleanly against fifteen candidates and less cleanly against two hundred.
Default 25, configurable.

## 11.5 Pool sizing — what actually constrains it

At ~100 probes/night with a response window spanning into the next business day
(~36h), roughly 150 probes are open at peak. Across 10 numbers that is ~15 open per
number, comfortably inside §11.4.

**Volume is therefore not what sizes the pool.** The binding constraint is the
largest set of mutually-colliding probes we want open at once: with 10 numbers, at
most 10 companies sharing a phone system can be probed concurrently, and the 11th
defers. A market dominated by two franchise groups will defer far more than a market
of independents at identical volume.

So: 10 numbers is a sound **starting** pool for 100/night, and the metric that
decides whether to grow it is the **deferral rate**, not the probe count. Instrument
that from day one.

Numbers are QUARANTINED, not immediately reused, after a probe closes, for a
configurable tail (default 72h) so a late response still attributes to the probe that
earned it rather than to whoever inherited the number.

---

# 12. WHAT A PROBE MAY NOT DO

Hard interlocks, enforced in code, not in the prompt.

## 12.1 Never request dispatch

A probe submits an **inquiry**, never a service request. It must not:

- provide a service address, real or invented;
- select "emergency", "same-day", "urgent" or dispatch options;
- request a site visit, a technician, or an appointment;
- submit anything that could put a truck on a road or hold a dispatch slot.

The free-text is a pricing/process question. If the form's only mode is a dispatch
request, the probe is **not eligible** and closes `FAILED` with reason
`DISPATCH_ONLY_FORM`. That is a fact about the form, not about the company.

## 12.2 Categorically ineligible verticals

Any vertical where a submission could trigger an emergency, clinical, legal or
safety-of-life response is ineligible regardless of authorization: medical, dental,
legal, mental health, emergency restoration/water/fire, and anything dispatching to a
reported hazard. This list is a floor, not a ceiling.

## 12.3 No CAPTCHA circumvention

If a form presents a CAPTCHA, bot-detection challenge, or a terms gate prohibiting
automated submission, the probe closes `FAILED` with the reason recorded. It does not
solve, bypass, outsource or retry the challenge. Circumventing an access control to
audit somebody is a different act from measuring a public response time, and this
subsystem does not do it.

## 12.4 Volume and repetition

- **One open probe per Account, ever** — enforced by a unique partial index on
  `account_id` where `status` is in the open set, not by application logic alone.
- **Cooldown** — no re-probe within `cooldown_until` (default 180 days,
  configurable). A re-probe inside cooldown is refused, not queued.
- **No autonomous high-volume probing** — a nightly cap, a per-market cap and a
  global kill switch, all defaulting to zero until §22 is signed.
- **No retry-on-failure submissions.** A failed submission is not retried against
  the same form; retrying is how one audit becomes four inquiries.

## 12.5 Identity discipline

- a fictitious identity from a small registered set (`submitted_identity_id`), never
  a real person's name, never a competitor's, never a name resembling either;
- never a real third party's phone or email;
- the phone number is always a YAD-controlled pool number, so every consent to be
  contacted is consent YAD can honour;
- identities are registered, versioned and auditable, so "who did we appear to be"
  is answerable months later.

---

# 13. PROBE LIFECYCLE

```
PLANNED ──> AUTHORIZED ──> SUBMITTING ──> SUBMITTED ──┬─> AUTO_ACKNOWLEDGED ─┐
   │             │             │                      │                      │
   │             │             │                      ├─> RESPONDED ─────────┤
   │             │             └─> FAILED              │                      │
   │             │                                     │                      v
   └─> CANCELLED <─────────────────────────────────────┘         ATTRIBUTED / AMBIGUOUS
                                                                        │
                        NO_RESPONSE_WINDOW_1 ──> NO_RESPONSE_FINAL <────┘
```

| State | Meaning |
| --- | --- |
| `PLANNED` | Selected and eligible. Also the resting state for a deferred probe (§11.3). Nothing has been sent. |
| `AUTHORIZED` | A named person authorized this specific probe or its batch. Records who and when. |
| `SUBMITTING` | Submission in progress. A crash here is resolved by the submission ledger, never by resubmitting blind. |
| `SUBMITTED` | Form accepted. `submitted_at` set. The response window opens. |
| `AUTO_ACKNOWLEDGED` | An AUTOMATED response was attributed. **Not** a response for human-latency purposes. |
| `RESPONDED` | Any attributed response arrived, of any actor type. |
| `ATTRIBUTED` | The window closed with at least one HIGH/MEDIUM attributed response. |
| `AMBIGUOUS` | Responses arrived that could not be attributed to one probe. Requires review. Produces no latency fact. |
| `NO_RESPONSE_WINDOW_1` | First window closed with no attributed response. Provisional and non-assertive. |
| `NO_RESPONSE_FINAL` | Final window closed with no attributed response on the monitored channels. Still not a claim that nobody responded — see §18. |
| `CANCELLED` | Withdrawn before submission, or the Account became ineligible. |
| `FAILED` | The probe could not be executed: form unreachable, CAPTCHA, dispatch-only, validation rejected the alias. **Never evidence about the company.** |

Windows are configurable. Defaults: window 1 = 4 business hours; final = 72 hours
wall-clock, extended to the end of the next business day so an after-hours
submission is not scored against a closed office.

---

# 14. AUTHORIZATION AND SAFETY MODEL

1. **Per-probe or per-batch authorization** by a named person, recorded in
   `authorized_by`/`authorized_at`. No probe leaves `PLANNED` without it.
2. **Global kill switch**, defaulting to off, in the same pattern as the existing
   outbound switches (`OUTBOUND_DIAL_ENABLED`, `OUTBOUND_EMAIL_ENABLED`). A probe
   switch is a **third** switch: `PROBE_SUBMISSION_ENABLED`. It must not be implied by
   either existing one, and none of the three implies the DataForSEO gate.
3. **Dry-run is the default mode** and the only mode until §22 is signed.
4. Compliance evaluation before submission, reusing the existing engine: suppression,
   DNC, and Account-level exclusions apply. A suppressed Account is not probed —
   we do not measure the response time of a company we may not contact.

---

# 15. THE INBOUND PROBE AGENT

When an inbound call arrives on a pool number and resolves to `INBOUND_PROBE_RESPONSE`:

1. **Identify YAD honestly.** The agent states it is calling on behalf of / answering
   for Your AI Department. It never claims to be the fictitious identity as a person,
   never claims an emergency, and never invents a customer situation.
2. **Resolve identity** with one neutral question where the ANI is unknown:
   *"Which company are you calling from?"* — asked once, answer captured
   structurally (§7 Tier 4).
3. **Terminate politely and promptly.** Thank them, confirm nothing further is
   needed, end the call. The design goal is the shortest honest call that still
   resolves attribution. We are consuming a salesperson's time; minimizing that is a
   requirement, not a courtesy.
4. **Never** book, quote, negotiate, express purchase intent, or accept a service
   appointment.
5. **Never** transfer to a human rep at YAD. A probe response is not a sales
   conversation.

If asked directly what this is, the agent may say YAD is conducting a lead-response
audit and offer to remove the company from future audits. That request is honoured
permanently and recorded as a suppression.

---

# 16. RECORDING AND RETENTION

- **Calls are not recorded by default and not transcribed by default.** Structured
  attribution metadata is preserved: SID, from, to, timestamps, disposition, actor
  type and evidence.
- Recording or transcription requires separate approval and must satisfy the existing
  Florida two-party analysis in
  `outbound-sales-brain-florida-recording-transcription-policy-research-2026-09.md`
  and the retention rules in
  `outbound-sales-brain-twilio-conversation-data-retention-spec.md`.
- Inbound SMS bodies **are** retained, because the body is the attribution evidence
  and the automation fingerprint. They are prospect-side business content and fall
  under the existing retention/redaction rules; `src/workers/redaction.ts` applies.
- A probe response may contain a real person's name and direct number. That is
  incidental personal data collected without their knowledge, and it is retained
  under the shortest applicable retention class, never exported to a rep-facing
  surface beyond "a human called back at HH:MM".

---

# 17. SIGNALS AND CANONICAL FACTS

Declared in `src/domain/signalRegistry.ts`. Until the subsystem is implemented, each
is declared with **no producer** and a `requiredCapability`, which is the established
pattern (`active_meta_ad`, `storm_hail_market_signal`) and means the validator reports
`SOURCE_UNAVAILABLE` — understood, not collectable — rather than a defect.

New capability: `LEAD_RESPONSE_PROBE`.

Subject is `RELATIONSHIP` for every probe-derived fact. This is deliberate and it is
the load-bearing decision in this section: the subject of the fact is **the
interaction we observed**, not the company. A `COMPANY`-subject latency signal reads
as "this company's response time" and would license exactly the claim
`must_not_claim: [current_response_time_without_measurement]` was written to prevent.

| Signal | Value type | States | Notes |
| --- | --- | --- | --- |
| `lead_response_probe_completed` | OBSERVED | YES, NOT_CHECKED, UNKNOWN, SOURCE_UNAVAILABLE | A probe reached a terminal measured state with resolved attribution. No `NO`: a probe that failed is `NOT_CHECKED`, not a negative. |
| `lead_response_latency` | COUNT | YES, NOT_CHECKED, UNKNOWN, SOURCE_UNAVAILABLE | Seconds to first attributed response of any actor type, for one inquiry on one date. |
| `human_response_latency` | COUNT | YES, NOT_CHECKED, UNKNOWN, SOURCE_UNAVAILABLE | Seconds to `first_meaningful_contact_at`. Requires actor `HUMAN` and HIGH/MEDIUM attribution. |
| `after_hours_response_gap` | COUNT | YES, NOT_CHECKED, UNKNOWN, SOURCE_UNAVAILABLE | Only where `submitted_outside_business_hours` is true **and** business hours are known. Null hours means this signal is not produced at all. |
| `paid_lead_followup_gap` | COUNT | YES, NOT_CHECKED, UNKNOWN, SOURCE_UNAVAILABLE | Human latency where the probe was selected from paid-ad evidence. The commercially sharpest fact the subsystem produces. |
| `no_human_followup_observed` | OBSERVED | YES, NOT_OBSERVED, NOT_CHECKED, UNKNOWN, SOURCE_UNAVAILABLE | See §18. Named `_observed` on purpose. |
| `response_channel` | CATEGORY | YES, NOT_CHECKED, UNKNOWN, SOURCE_UNAVAILABLE | SMS \| CALL \| EMAIL \| MULTIPLE |
| `response_actor_type` | CATEGORY | YES, UNKNOWN, SOURCE_UNAVAILABLE | HUMAN \| AUTOMATED \| UNKNOWN. Never absent-means-human. |
| `response_attribution_confidence` | CATEGORY | YES, UNKNOWN, SOURCE_UNAVAILABLE | HIGH \| MEDIUM \| LOW \| NONE. Travels with every fact above. |

Consumers: `domain/hypotheses` (`speed_to_lead`, `paid_lead_response`,
`after_hours`, `follow_up`), `domain/researchFacts`, `scoring/recognize`,
`outbound-sales-brain-call-pack-spec.md`.

**Scoring is deliberately out of scope in v1.** These signals feed hypotheses,
hooks and call packs. Whether a measured response gap changes the canonical Module 4C
score is a separate decision with its own fixtures and its own version bump, and
bundling it here would silently re-rank every advertiser in the database.

---

# 18. NEGATIVE-EVIDENCE DISCIPLINE

The registry's own words: *"NO is deliberately absent from most signals: we can prove
a company advertises and we cannot prove it does not."* The same asymmetry governs
response times, and it is easier to violate here because a silent probe *feels* like
a finding.

Non-negotiable:

1. **`FAILED` is never evidence about the company.** A CAPTCHA, an unreachable form,
   a rejected alias, a dispatch-only form — all are facts about the form or about us.
2. **`AMBIGUOUS` is never evidence about the company.** Attribution failure is our
   failure. It produces no latency fact and no absence fact.
3. **`NO_RESPONSE_FINAL` is a bounded observation, not an absence.** The honest
   statement is: *no response attributable to this probe arrived on the monitored
   channels within the window.* They may have called a number we did not monitor,
   emailed an address we did not watch, replied to a different alias, or been filtered
   before reaching us. The signal is therefore named
   `no_human_followup_observed`, its YES means "not observed within a closed
   window", and it can render as `NOT_OBSERVED` but **never as a bare "No".**
4. The rep-facing renderer may never emit "they never responded". It emits what was
   observed, on which channels, within which window.
5. A single probe is n=1. Nothing in this subsystem may produce a rate, an average, a
   "typically", or a comparison to a benchmark from one probe.

---

# 19. REP-FACING EVIDENCE

The renderer emits observation, window and both latency figures, or it refuses.

Measured example:

> **Observed through a controlled lead-response audit**
> Lead submitted 10:03 PM, 8 September.
> Automated acknowledgment 10:04 PM (SMS, automated).
> First human callback 2:07 PM, 9 September.
> Elapsed human response time **16h 04m**.
> Business-hours-adjusted **6h 07m** (hours from published website hours).
> Attribution: HIGH — inbound call from a published company number.
> One inquiry, one date. Not a measure of typical performance.

Unknown-hours example — note what is missing rather than filled in:

> Elapsed human response time **16h 04m**.
> Business-hours-adjusted figure not available: this company's hours are not known.

No-response example:

> Lead submitted 10:03 PM, 8 September. Automated acknowledgment 10:04 PM.
> No further response attributable to this inquiry arrived by SMS, call or email
> before the window closed at 11:59 PM, 11 September.
> This does not establish that nobody responded.

This is also where `must_not_claim` is enforced at the point of speech: the renderer
carries `response_attribution_confidence` into the sentence, and a LOW/NONE
confidence probe produces no sentence at all.

---

# 20. POSITION IN THE PIPELINE

```
Google / paid-search discovery            market-miner SERP adapters
        |
        v
canonical Account                          accounts + merge/resolveAccountId
        |                                  (no second prospect database)
        v
prospect ranking                           Module 4C score + queue tie-break
        |
        v
paid demand funnel audit (passive)         PaidDemandFunnelObservation
        |                                  -- supplies target_form_url + CTA
        v
AUTHORIZED response-time probe   <<< THIS SPEC. Requires §22.
        |                                  lead_response_probes + pool
        v
inbound response attribution               extends src/inbound/resolver.ts
        |                                  probe_inbound_events
        v
measured pain-point evidence               §17 signals, RELATIONSHIP-subject
        |
        v
hypothesis                                 speed_to_lead / paid_lead_response
        |                                  (categories already in migration 006)
        v
sales hook                                 domain/hooks.ts ordering
        |
        v
call pack                                  outbound-sales-brain-call-pack-spec.md
```

The probe sits **after** ranking, not before: probing is the expensive,
consent-sensitive step and it is spent on companies already worth calling. It sits
**after** the passive funnel audit because the audit is what tells the probe which
form to submit and whether a form exists at all.

---

# 21. DRY-RUN / SIMULATION MODE

Default and, until §22, only mode.

- `PROBE_SUBMISSION_ENABLED=false` — the submitter resolves the form, builds the
  payload, validates eligibility, computes the digest and writes the ledger row, then
  stops. Nothing leaves the machine.
- Local fixture site — the pattern already used elsewhere in this project — serves
  forms covering: plain form, form with consent checkbox, dispatch-only form,
  CAPTCHA-guarded form, `+`-rejecting validator, and a form that 500s.
- Simulated inbound events exercise every §7 tier and every §8 actor case, including
  the two that must fail: a colliding franchise pair, and an unknown-ANI call with
  two plausible probes.
- Attribution, latency and business-hours arithmetic are fully testable with no
  Twilio number and no live target. Assert the null-hours path explicitly — it is the
  one most likely to be "fixed" into a zero.

Acceptance for the dry-run phase: every §13 transition exercised; every §7 tier
exercised including AMBIGUOUS; `FAILED` and `AMBIGUOUS` provably produce no signal;
`no_human_followup_observed` provably cannot render as "No"; collision allocator
provably defers rather than forcing; unique-open-probe index provably rejects a
duplicate.

---

# 22. DECISIONS MICHAEL MUST APPROVE BEFORE ANY LIVE PROBE

Engineering cannot decide these, and none is a technical question.

1. **Amend the standing prohibitions in §3.** Five lines across three
   architecture-authority documents forbid fake form submissions without qualification. They must be
   amended to carve out an authorized, ledgered, rate-limited lead-response audit —
   or this subsystem stays in dry-run permanently. Naming the lines is engineering's
   job; changing them is not.
2. **Is a controlled fake inquiry acceptable conduct toward a prospect?** It consumes
   a salesperson's time and may hold a dispatch slot. §12 and §15 minimize that; they
   do not eliminate it. This is the ethical decision underneath the legal ones, and
   it should be made explicitly rather than inherited from a schema.
3. **Form consent checkboxes.** Many forms carry "I agree to be contacted, including
   by automated calls/texts". Checking it submits a consent representation on behalf
   of an identity that does not exist. The mitigating fact is real — the number is
   YAD's and YAD does consent to be contacted on it — but whether that makes the
   representation truthful is a question for counsel, not for this document.
4. **Target terms of use.** Automated submission and false information are prohibited
   by many sites' terms. Whether YAD accepts that exposure, and whether a terms gate
   makes a target ineligible outright, needs a decision. §12.3 already refuses
   CAPTCHA circumvention regardless.
5. **Fictitious identity policy.** Which names, which email domain, and whether a
   probe may ever decline to identify itself when asked. §15 currently says it always
   identifies YAD when asked directly.
6. **Vertical eligibility.** §12.2 is engineering's floor. The commercial list of
   verticals YAD is willing to probe is Michael's.
7. **Volume, cooldown and caps.** Nightly cap, per-market cap, cooldown length.
   Defaults in this document are conservative placeholders, not recommendations.
8. **Recording/transcription** of inbound probe calls — separately, if ever (§16).
9. **Suppression on request.** Confirmation that an audited company asking to be
   excluded is honoured permanently, and whether it also suppresses sales outreach.

Legal conclusions belong to qualified counsel. This document identifies the
questions and refuses to answer them.

---

# 23. IMPLEMENTATION ORDER

Not started, and deliberately sequenced so the parts that cannot cause harm come
first and the part that can comes last.

1. Ledger schema, pool schema, state machine, unique-open-probe index.
2. Collision-aware allocator + deferral, with fixtures for franchise clusters.
3. Attribution ladder as an extension of `src/inbound/resolver.ts`; `INBOUND_PROBE_RESPONSE`.
4. Actor-type classifier including the cross-probe template fingerprint.
5. Latency arithmetic, including the null-business-hours path.
6. Email alias mechanism and inbound token resolution.
7. Signal registry entries with `LEAD_RESPONSE_PROBE`, no producers.
8. Dry-run submitter + fixture site + full simulation suite (§21).
9. Rep-facing renderer with confidence gating and the refuse-if-incomplete rule.
10. **Stop.** Live enablement requires §22.

---

# 24. NON-NEGOTIABLE RULES

- The probe is the identity; the Twilio number is shared transport.
- Sole occupancy of a number is not attribution.
- Ambiguous attribution produces no fact.
- A failed probe is a fact about the form, never about the company.
- No response observed is a bounded observation, never "they did not respond".
- An automated acknowledgement is never human follow-up.
- Absence of automation evidence is never evidence of a human.
- Raw and business-hours-adjusted latency are always presented together.
- Unknown business hours produce null, never zero.
- One inquiry is n=1 and never becomes a rate or an average.
- No dispatch, no emergency, no site visit, no appointment, ever.
- No CAPTCHA or bot-gate circumvention, ever.
- One open probe per Account; cooldown enforced; caps default to zero.
- No live submission without §22, and §22 is not the DataForSEO gate.
- No second Account or prospect database.

---

# 25. A NOTE ON THE LINE NUMBERS IN §3

Line numbers are given as a convenience and will drift as those documents are
edited; the section names are the durable reference. The §15 entry in
`outbound-sales-brain-index.md` has already been annotated to point back here, so
the contradiction is discoverable from either end rather than only from this side.
