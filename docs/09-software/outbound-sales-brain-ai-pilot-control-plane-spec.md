# Your AI Department — AI Outbound Pilot Control Plane

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Give Michael a visible operator console for the first Sales AI outbound tests instead of treating the dialer as an unattended batch job.

Read with:

- `outbound-sales-brain-ai-pilot-candidate-selection-contract.v1.yaml`
- `TOMORROW-OUTBOUND-PILOT-PREFLIGHT-CURRENT.md`
- `CLAUDE-TOMORROW-RELEASE-REPORT-TEMPLATE.md`

---

# 1. PRODUCT DECISION

The first production-intent outbound test should be **operator-controlled**.

Do not begin with an invisible background job that attempts hundreds of calls.

Initial flow:

`researched Account inventory`
-> `hard eligibility/relationship gates`
-> `eligible pilot candidates`
-> `Michael selects exact Accounts`
-> `preview Call Pack / target / reason`
-> `pilot batch`
-> `one-at-a-time dialing initially`
-> `live status + outcome`
-> `QA review`
-> `increase concurrency only after evidence supports it`.

This does not change the ordinary salesperson experience into a queue. The Pilot area is a manager-controlled execution surface for Sales AI testing only.

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

# 3. CANDIDATE GENERATION

Candidate generation must use:

`outbound-sales-brain-ai-pilot-candidate-selection-contract.v1.yaml`

Hard gates run before ranking.

Required concepts:

- canonical Account identity resolved;
- relationship state compatible with generic pilot outreach;
- ownership/manager assignment compatible with AI use;
- no active YAD suppression;
- exact phone endpoint valid enough for intended action;
- current `AUTONOMOUS_AI_VOICE = ALLOW` decision;
- sufficient fresh research for selected opener;
- current immutable Call Pack;
- voice/persistence/campaign health.

Only after hard gates pass may the system order candidates using transparent dimensions such as:

- contact-route strength;
- fresh claim-safe hook evidence;
- YAD Tier/score;
- research completeness;
- advertiser strength;
- hypothesis/question clarity;
- research age.

Do not let Module 4C score, Tier A status, manager preference or rep ownership override a failed phone/policy/relationship gate.

---

# 4. CANDIDATE TABLE

Each candidate should show:

- company;
- vertical;
- market;
- YAD Tier/score;
- advertiser evidence;
- target contact/role;
- contact route class: Direct / Named via Main Line / Role via Main Line / Generic Main Line;
- phone endpoint type/source;
- primary hypothesis;
- selected hook family;
- opening-context preview;
- first question;
- research freshness;
- contact history;
- current owner;
- current AI voice decision + refresh time;
- pilot eligibility result;
- reason if blocked/review required.

Michael should be able to open full Account/Call Pack before selecting.

Do not show raw registry records or provider secrets.

---

# 5. SELECT FOR PILOT

Manager selects exact Accounts.

Actions:

- `Add to Pilot`
- `Remove`
- `Refresh Research`
- `Review Contact`
- `Preview Opening`
- `Preview Call Pack`

Adding to pilot does **not** immediately dial.

A candidate that becomes ineligible after being added must change state before the next call rather than retaining stale READY status.

---

# 6. PRE-FLIGHT CHECK

Immediately before `Start Next Call`, recheck current required gates such as:

- Account not suppressed/DNC;
- correct relationship/campaign status;
- owner/assignment still permits AI action;
- exact phone endpoint still usable;
- current autonomous AI voice eligibility decision;
- any required registry/provider screen current;
- local time/calling-window eligibility;
- contact history/cadence eligible;
- current Call Pack exists;
- any current-ad fact used in opener still claim-safe/fresh;
- current agent profile version exists;
- realtime voice health green;
- booking adapter health green if booking enabled;
- kill switch healthy;
- required logging/persistence healthy.

The language model cannot mark itself eligible.

If a current gate changes from ALLOW to BLOCK/REVIEW, do not issue the Twilio request. Surface the reason and let Michael select another candidate.

---

# 7. PILOT STATES

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

A Pilot state never replaces canonical Account relationship state.

---

# 8. INITIAL CONCURRENCY

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

# 9. START CONTROLS

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

No hidden background dial loop may bypass these controls.

---

# 10. LIVE CALL CARD

While active show:

- company/contact;
- call duration;
- current state (`opening`, `discovery`, `booking`, etc.);
- target hypothesis;
- selected hook;
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

# 11. COMPLETED CALL ROW

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

# 12. CALL REVIEW PAGE

Use `outbound-sales-brain-ai-cold-call-pilot-scorecard.md`.

Present synchronized:

- audio/recording where permitted;
- transcript where permitted;
- state transitions;
- tool calls/results;
- latency timeline;
- Call Pack snapshot;
- selected hook/opener context;
- phone eligibility decision reference;
- prompt/config versions;
- extracted facts/outcome;
- QA score/hard fails;
- reviewer notes.

This must make the call reproducible enough to debug.

---

# 13. VERSION SNAPSHOT

Every attempt records immutable references to:

- agent profile version/hash;
- core script/first-60 behavior version;
- dialogue policy version/hash;
- opener selector/hook version;
- response-card version;
- Sales Manual knowledge snapshot;
- vertical profile/version;
- Call Pack version;
- research snapshot;
- phone eligibility/policy decision;
- screening source/version where applicable;
- realtime model/provider;
- TTS/STT config;
- voice profile;
- booking adapter version;
- compliance/policy snapshot.

Without this, comparing calls after prompt changes becomes unreliable.

---

# 14. PILOT BATCH OBJECT

```text
PilotBatch
- pilot_batch_id
- name
- created_by
- created_at
- purpose
- candidate_account_ids[]
- candidate_selection_contract_version
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

# 15. FIRST BATCH DESIGN

Earliest real batch should normally be only **3–5 manager-reviewed Accounts, possibly fewer**.

Prefer a deliberate mix after all current AI eligibility gates pass:

- strong named decision-maker + direct business route;
- named decision-maker via verified main line;
- one gatekeeper/main-line route if the endpoint is actually AI-eligible and Michael wants to test that branch;
- current advertiser with after-hours hypothesis;
- comparable overflow-hook candidate;
- optional strong-system/no-sale branch only as an intentional learning case.

Do not include a candidate simply to create diversity when its data/policy quality is weaker.

Do not mix law, roofing, real estate, collision and HVAC into the first real handful.

Run the fictional HVAC gold fixture suite before selecting real Accounts.

---

# 16. REVIEW AFTER EACH EARLIEST CALL

For the earliest real calls, do not automatically progress through a batch without review.

Review:

- correct Account and contact route;
- current policy/phone preflight;
- opener truth/relevance;
- first-question response;
- useful process fact by early turns;
- barge-in/repetition;
- unsupported claim count;
- qualification/readiness decision;
- next-step tool execution;
- DNC/wrong-number behavior;
- booking truth;
- latency;
- root cause.

Then explicitly:

- KEEP;
- PAUSE;
- RETEST;
- REWRITE smallest responsible component.

---

# 17. NO AUTOMATIC SCALE-UP

A high booking rate on five calls does not authorize 500 calls.

Scale decision should consider:

- hard failures;
- latency stability;
- contact accuracy;
- naturalness;
- objection handling;
- DNC reliability;
- phone screening/eligibility reliability;
- booking reliability;
- qualified/attended meeting quality;
- complaint/negative signals;
- provider health.

Manager explicitly advances pilot stage.

---

# 18. INTEGRATION WITH REP OWNERSHIP

If Account belongs to a human rep:

- do not let AI silently work it unless campaign/manager rule assigns AI action;
- outcome writes back to same Account;
- booked meeting/current owner rules remain explicit;
- positive conversation should not trigger contradictory rep/Smartlead outreach.

AI is another execution channel against one Account memory.

---

# 19. CALL-BACK ROUTING

Because outbound caller ID may be the shared YAD number:

- inbound callback routes to Production Inbound, not Sales AI cold opener;
- recent outbound Account context is retrieved;
- callback can route to Michael/current owner or create a task;
- pilot screen should surface returned calls tied to pilot Accounts.

---

# 20. FAILURE CATEGORIES

Normalize failures:

- carrier/no-answer;
- voicemail;
- AMD issue;
- wrong endpoint;
- phone eligibility/screening;
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

# 21. RELEASE REPORT

At the end of tomorrow's implementation/testing, use:

`CLAUDE-TOMORROW-RELEASE-REPORT-TEMPLATE.md`

and select exactly one release classification:

- `REAL_AI_PILOT_ELIGIBLE`
- `INTERNAL_AI_TEST_ONLY`
- `HUMAN_ASSIST_ONLY`

If not real-pilot eligible, the control plane can still support internal/allowlisted voice testing while independently eligible human reps use Human Assist.

---

# 22. CORE RULE

**The first outbound pilot is a tiny, explicit, manager-reviewed experiment. Hard eligibility and relationship gates decide who can enter; transparent quality ranking decides who is worth testing first; Michael decides the exact Accounts; and each early call is reviewed before the system earns more automation.**