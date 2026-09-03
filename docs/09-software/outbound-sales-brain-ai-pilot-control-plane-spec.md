# Your AI Department — AI Outbound Pilot Control Plane

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Give Michael a safe, observable operator console for the first Sales AI outbound tests instead of treating the dialer as an unattended batch job.

---

# 1. PRODUCT DECISION

The first production-intent outbound test should be **operator-controlled**.

Do not begin with an invisible background job that attempts hundreds of calls.

Initial flow:

`researched Account inventory`
-> `eligible pilot candidates`
-> `Michael selects exact Accounts`
-> `preview Call Pack / target / reason`
-> `pilot batch`
-> `one-at-a-time dialing initially`
-> `live status + outcome`
-> `QA review`
-> `increase concurrency only after evidence supports it`.

---

# 2. PORTAL LOCATION

Add manager/admin area such as:

`Sales AI -> Pilot`

Possible navigation:

- Candidate Prospects
- Pilot Batch
- Live Calls
- Completed Calls
- Review
- Settings

This is not visible to ordinary reps unless role permits.

---

# 3. CANDIDATE TABLE

Each candidate should show:

- company;
- vertical;
- market;
- YAD Tier/score;
- advertiser evidence;
- target contact/role;
- phone endpoint + type/source;
- decision-maker confidence;
- primary hypothesis;
- opening-context preview;
- strategy-call target;
- research freshness;
- contact history;
- current owner;
- compliance/policy status;
- pilot eligibility result;
- reason if blocked/review required.

Michael should be able to open full Account/Call Pack before selecting.

---

# 4. SELECT FOR PILOT

Manager selects exact Accounts.

Actions:

- `Add to Pilot`
- `Remove`
- `Refresh Research`
- `Review Contact`
- `Preview Opening`
- `Preview Call Pack`

Adding to pilot does **not** immediately dial.

---

# 5. PRE-FLIGHT CHECK

Before a candidate can become `READY`, verify current required gates such as:

- Account not suppressed/DNC;
- correct relationship/campaign status;
- phone endpoint usable under current policy;
- local time/calling-window eligibility;
- contact history/cadence eligible;
- current Call Pack exists;
- current evidence snapshot available;
- current agent profile version exists;
- realtime voice health green;
- booking adapter health green if booking enabled;
- kill switch healthy;
- required logging/persistence healthy.

The language model cannot mark itself eligible.

---

# 6. PILOT STATES

- `DRAFT`
- `PREFLIGHT_REVIEW`
- `READY`
- `CALLING`
- `CONNECTED`
- `COMPLETED`
- `BLOCKED`
- `PAUSED`
- `CANCELLED`
- `REVIEW_REQUIRED`

Each Account also retains its ordinary contact/outcome state.

---

# 7. INITIAL CONCURRENCY

For earliest pilot:

`max_concurrent_outbound_calls = 1`

Purpose:

- listen/review closely;
- isolate defects;
- avoid scaling a bad behavior;
- protect voice runtime while latency is measured;
- simplify booking/action verification.

After reviewed pass criteria, manager may explicitly raise controlled concurrency.

Do not let LLM choose concurrency.

---

# 8. START CONTROLS

Buttons:

- `Start Next Call`
- `Run Ready Batch` (disabled for earliest gate or still concurrency-limited)
- `Pause After Current Call`
- `STOP NEW OUTBOUND CALLS`

`STOP NEW OUTBOUND CALLS`:

- immediately prevents new call creation;
- does not abruptly drop a healthy active call unless separate emergency-stop action is explicitly chosen;
- visible system-wide;
- audited with actor/time/reason.

---

# 9. LIVE CALL CARD

While active show:

- company/contact;
- call duration;
- current state (`opening`, `discovery`, `booking`, etc.);
- target hypothesis;
- last prospect intent classification;
- tool action status;
- high-level latency indicators;
- DNC/termination alert;
- transcript stream where approved;
- recording status where approved;
- no raw chain-of-thought/internal hidden reasoning.

Optional later:

- supervisor listen-only;
- human takeover/warm transfer where transport supports and policy approves.

Do not require live supervisor features for first functional pilot.

---

# 10. COMPLETED CALL ROW

Show immediately:

- outcome;
- duration;
- right person reached?;
- problem found?;
- strategy call offered?;
- booked?;
- callback?;
- email requested?;
- DNC?;
- wrong number?;
- technical issue?;
- hard-fail QA?;
- review score status.

Click -> full call review.

---

# 11. CALL REVIEW PAGE

Use `outbound-sales-brain-ai-cold-call-pilot-scorecard.md`.

Present synchronized:

- audio/recording where permitted;
- transcript;
- state transitions;
- tool calls/results;
- latency timeline;
- Call Pack snapshot;
- prompt/config versions;
- extracted facts/outcome;
- QA score/hard fails;
- reviewer notes.

This must make the call reproducible enough to debug.

---

# 12. VERSION SNAPSHOT

Every attempt records immutable references to:

- agent profile version/hash;
- dialogue policy version/hash;
- opener selector version;
- response-card version;
- Sales Manual knowledge snapshot;
- vertical profile/version;
- Call Pack version;
- realtime model/provider;
- TTS/STT config;
- voice profile;
- booking adapter version;
- compliance/policy snapshot.

Without this, comparing calls after prompt changes becomes unreliable.

---

# 13. PILOT BATCH NOTES

Batch object:

```text
PilotBatch
- pilot_batch_id
- name
- created_by
- created_at
- purpose
- candidate_account_ids[]
- agent_profile_version
- max_concurrency
- start_status
- stopped_at optional
- stop_actor optional
- stop_reason optional
- reviewed_count
- hard_fail_count
- booking_count
- qualified_booking_count later
```

Example name:

`2026-09-04 HVAC Jacksonville Pilot 01`

---

# 14. FIRST BATCH DESIGN

Prefer a **small diverse sample** rather than ten nearly identical perfect leads.

Example controlled sample mix after all current eligibility gates pass:

- strong named decision-maker + direct/business route;
- main-line/gatekeeper route;
- current advertiser with after-hours hypothesis;
- advertiser with estimate-follow-up hypothesis;
- strong existing-system possibility;
- one likely `send email`/busy-owner type if known only from contact context.

The goal is to exercise conversation branches, not maximize bookings on the first ten calls.

---

# 15. NO AUTOMATIC SCALE-UP

A high booking rate on five calls does not authorize 500 calls.

Scale decision should consider:

- hard failures;
- latency stability;
- contact accuracy;
- naturalness;
- objection handling;
- DNC reliability;
- booking reliability;
- qualified/attended meeting quality;
- complaint/negative signals;
- provider health.

Manager explicitly advances pilot stage.

---

# 16. INTEGRATION WITH REP OWNERSHIP

If Account belongs to a human rep:

- do not let AI silently work it unless campaign/manager rule assigns AI action;
- outcome writes back to same Account;
- booked meeting/current owner rules remain explicit;
- positive conversation should not trigger contradictory rep/Smartlead outreach.

AI is another execution channel against one Account memory.

---

# 17. CALL-BACK ROUTING

Because outbound caller ID may be the shared YAD number:

- inbound callback routes to Production Inbound, not Sales AI cold opener;
- recent outbound Account context is retrieved;
- callback can route to Michael/owner or create a task;
- pilot screen should surface returned calls tied to pilot Accounts.

---

# 18. FAILURE CATEGORIES

Normalize failures:

- carrier/no-answer;
- voicemail;
- AMD issue;
- wrong endpoint;
- STT issue;
- TTS issue;
- websocket/runtime;
- high latency;
- model/prompt behavior;
- tool failure;
- booking failure;
- compliance/policy block;
- unknown.

Do not dump all errors into `failed`.

---

# 19. CORE RULE

**The first outbound pilot is a controlled experiment with a visible operator, not a volume campaign. Prove the conversation and action loop before increasing automation.**
