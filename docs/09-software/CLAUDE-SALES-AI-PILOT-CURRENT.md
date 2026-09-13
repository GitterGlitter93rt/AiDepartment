# CLAUDE CODE — SALES AI PILOT CURRENT

**Status:** Current implementation authority for the outbound Sales AI release/pilot gate  
**Updated:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Implementation owner:** Claude Code on EdgeXpert  
**Architecture owner:** ChatGPT

If an older Sales AI handoff conflicts with this file, this file wins for the immediate release implementation.

---

# 1. COORDINATION

ChatGPT may add architecture/documentation commits to the same feature branch while Claude implements locally.

Before starting/restarting this gate:

1. inspect local status;
2. preserve legitimate local work;
3. `git fetch origin`;
4. safely reconcile/rebase with current `origin/feature/outbound-sales-brain`;
5. never merge `main` as part of this task;
6. never force-push over remote architecture commits.

---

# 2. TOMORROW RELEASE PRIORITY

The immediate objective is a controlled release candidate for 2026-09-04.

Read these release-validation files **before** deciding the Sales AI is pilot-ready:

1. `TOMORROW-OUTBOUND-PILOT-PREFLIGHT-CURRENT.md`
2. `CLAUDE-DNC-RELEASE-ADDENDUM.md`
3. `outbound-sales-brain-hook-backtest-framework.md`
4. `outbound-sales-brain-hook-backtest-fixtures.v1.yaml`
5. `outbound-sales-brain-hook-backtest-report-v1.md`
6. `outbound-sales-brain-sales-ai-first-60-seconds-fixtures.v1.yaml`
7. `outbound-sales-brain-sales-ai-pilot-experiment-contract.v1.yaml`
8. `outbound-sales-brain-tomorrow-release-candidate-plan.md`

The first release goal is not high-volume autonomous dialing. It is proving the complete controlled chain from researched Account through natural conversation and correct next-step action.

At the end of testing, report exactly one release classification:

- `REAL_AI_PILOT_ELIGIBLE`
- `INTERNAL_AI_TEST_ONLY`
- `HUMAN_ASSIST_ONLY`

Do not use ambiguous language such as `mostly ready`.

---

# 3. CURRENT PRODUCT DECISION

One outbound Sales AI:

`yad-sales-core-v1`

Do **not** build one sales agent per vertical.

Vertical/business research changes the Call Pack:

- company/business identity;
- current evidence;
- business process to investigate;
- target stakeholder;
- hook/question;
- fact vs hypothesis boundaries;
- vertical safety boundaries.

The core sales personality/process stays shared.

---

# 4. READ ORDER — SALES CONVERSATION

1. `outbound-sales-brain-yad-sales-ai-core-script-v1.md`
2. `outbound-sales-brain-sales-ai-first-60-seconds-playbook.md`
3. `outbound-sales-brain-sales-ai-opener-selector-spec.md`
4. `outbound-sales-brain-sales-ai-response-cards.v1.yaml`
5. `outbound-sales-brain-yad-sales-ai-dialogue-policy.v1.yaml`
6. `outbound-sales-brain-strategy-call-qualification-gate-spec.md`
7. `outbound-sales-brain-sales-ai-next-step-ladder-spec.md`
8. `outbound-sales-brain-sales-ai-gold-dialogues-v1.md`
9. `outbound-sales-brain-yad-sales-ai-roleplay-fixtures.v1.yaml`
10. `outbound-sales-brain-sales-ai-first-60-seconds-fixtures.v1.yaml`
11. `outbound-sales-brain-agent-persona-style-spec.md`
12. `outbound-sales-brain-conversation-state-machine.md`
13. `outbound-sales-brain-priority-intent-detector-spec.md`
14. Sales Manual Modules 04A, 05 and 07.

---

# 5. FIRST 60 SECONDS — RELEASE BEHAVIOR

The first minute is not a product pitch.

Target:

```text
identity
-> honest cold context
-> one claim-safe reason
-> one process question
-> listen
-> one intelligent follow-up
-> route / continue / stop
```

By approximately the first three substantive AI turns, the conversation should normally produce at least one of:

- useful process fact;
- correct decision-maker route;
- requested callback/email;
- legitimate objection;
- clear no-need/no-interest;
- DNC/wrong-number correction.

Hard first-minute failures include:

- feature dump before first useful fact;
- meeting ask before relevance;
- stacked opening questions;
- repeated opener after interruption;
- more than one save attempt after busy/not-interested;
- gatekeeper manipulation;
- stale current-ad statement;
- DNC delayed while selling continues.

Use `outbound-sales-brain-sales-ai-first-60-seconds-playbook.md` as current behavior authority.

---

# 6. CURRENT HOOK RELEASE CANDIDATES

Offline design review currently ranks:

## `HVAC_AH_A1` — primary

Fresh advertiser/emergency context +:

> When a new call hits after hours, what happens today?

Offline design score: 48/50.

## `HVAC_OVERFLOW_A2` — primary A/B candidate

Fresh advertiser/phone context +:

> When a new call comes in while everybody's already tied up, what happens next?

Offline design score: 46/50.

## `CATEGORY_AH_B1` — safe fallback

No claim-safe current ad statement +:

> When somebody reaches out after hours, what happens today?

Offline design score: 42/50.

Other strong later candidates:

- Roofing estimate/proposal — 48/50;
- Real-estate nurture — 46/50;
- Collision estimate — 45/50;
- Law after-hours intake — 44/50 with law boundaries.

Rejected as default cold openers:

- generic AI automation pitch;
- product-first `Are you using an AI receptionist?`;
- stacked discovery questions;
- accusatory missed-revenue/loss claims;
- over-researched creepy opener.

These offline scores are design heuristics, **not conversion predictions**.

---

# 7. READ ORDER — RUNTIME DATA / PROMPT

1. `outbound-sales-brain-sales-ai-runtime-callpack-contract.v1.yaml`
2. `outbound-sales-brain-sales-ai-working-memory-contract.v1.yaml`
3. `outbound-sales-brain-call-pack-spec.md`
4. `outbound-sales-brain-prompt-composition-spec.md`
5. `outbound-sales-brain-sales-manual-rag-spec.md`
6. `outbound-sales-brain-action-tools-spec.md`

Realtime model gets compact normalized Call Pack + current state + working memory + only relevant response-card/manual material.

Never feed raw crawler/provider payloads or the whole Sales Manual per turn.

---

# 8. READ ORDER — BOOKING / MICHAEL HANDOFF

1. `outbound-sales-brain-calcom-strategy-call-booking-spec.md`
2. `outbound-sales-brain-strategy-call-prep-brief-spec.md`
3. `outbound-sales-brain-15-minute-strategy-call-playbook.md`
4. `outbound-sales-brain-qualified-hot-transfer-spec.md` — optional/later.

Current authority:

- Cal.com = scheduling authority;
- Michael calendar = `michael@youraidepartment.ai`;
- Cal Video = meeting location;
- event = YAD 15-Minute AI Strategy Call.

Do not create duplicate direct Outlook events when Cal.com owns the booking.

---

# 9. READ ORDER — PHONE ELIGIBILITY / COMPLIANCE

1. `CLAUDE-DNC-RELEASE-ADDENDUM.md`
2. `outbound-sales-brain-global-phone-channel-eligibility-dnc-spec.md`
3. `outbound-sales-brain-phone-screening-provider-interface-spec.md`
4. `outbound-sales-brain-phone-channel-eligibility-fixtures.v1.yaml`
5. `outbound-sales-brain-human-manual-call-v1-spec.md`
6. `outbound-sales-brain-compliance-engine-spec.md`
7. `outbound-sales-brain-contact-endpoint-quality-spec.md`
8. `outbound-sales-brain-multichannel-coordination-spec.md`

Required conceptual distinction:

```text
HUMAN_MANUAL_CALL = ALLOW | BLOCK | REVIEW_REQUIRED
AUTONOMOUS_AI_VOICE = ALLOW | BLOCK | REVIEW_REQUIRED
```

Do not use one generic `CALL_READY` boolean as authorization.

Twilio receives only current AI-ALLOWed attempts.

A rep's personal cell is only transport for a human-ALLOWed manual call; it is not a bypass.

---

# 10. READ ORDER — VOICE / PILOT

1. `outbound-sales-brain-demo-production-voice-mode-spec.md`
2. `outbound-sales-brain-realtime-voice-policy.md`
3. `outbound-sales-brain-twilio-telephony-spec.md`
4. `outbound-sales-brain-ai-pilot-control-plane-spec.md`
5. `outbound-sales-brain-ai-cold-call-pilot-scorecard.md`
6. `outbound-sales-brain-sales-ai-conversation-optimization-spec.md`
7. `outbound-sales-brain-sales-ai-pilot-experiment-contract.v1.yaml`
8. `TOMORROW-OUTBOUND-PILOT-PREFLIGHT-CURRENT.md`
9. `outbound-sales-brain-tomorrow-release-candidate-plan.md`

Same approved Twilio number can support:

- `DEMO_AI`;
- `PRODUCTION_INBOUND`;
- `PRODUCTION_OUTBOUND_SALES`.

Processes/session namespaces/config remain separate.

---

# 11. IMPLEMENTATION TARGET

Build a stateful system:

```text
Immutable Runtime Call Pack
 + Sales AI Persona
 + Opener Selector
 + Conversation State Machine
 + Dialogue Policy
 + Priority Intent Detector
 + Structured Working Memory
 + Relevant Response Card / Sales Manual Retrieval
 + Typed Action Tools
 = Realtime Sales Turn
```

Do not implement one giant static script prompt.

---

# 12. REQUIRED PILOT STATES

At minimum:

- opening;
- role_check;
- gatekeeper;
- hook;
- listen;
- discovery;
- probe;
- position;
- objection;
- strategy_call_readiness;
- availability;
- booking;
- confirmation;
- close;
- terminal.

Priority interrupts override ordinary selling:

- DNC;
- wrong number/company;
- clear prospect end;
- policy/technical stop.

---

# 13. STRATEGY CALL READINESS

Explicit results:

- `BOOK_NOW`
- `CONTINUE_BRIEFLY`
- `CALLBACK`
- `SEND_TARGETED_INFO`
- `END_NO_NEED`
- `DISQUALIFY_OR_REVIEW`.

Positive sentiment does not equal meeting qualification.

No-sale is a valid success.

---

# 14. NEXT-STEP LADDER

When appropriate:

1. 15-minute strategy call;
2. requested callback;
3. targeted short email;
4. free AI Department Assessment when useful;
5. human follow-up/review;
6. no sale;
7. DNC/end.

Never stack every CTA after rejection.

Assessment URL/config comes from current funnel authority, not stale hard-coded copy.

---

# 15. RECEPTIONIST / DEMO RUNTIME REUSE

Audit the actually deployed demo/receptionist runtime before rebuilding transport.

Reuse proven components where appropriate:

- Twilio webhook/signature handling;
- ConversationRelay/WebSocket;
- STT/TTS;
- barge-in;
- phone/date pronunciation;
- session lifecycle;
- low-latency greeting;
- transfer/tool transport;
- telemetry.

Do not reuse demo business prompts/context in production Sales AI.

Outbound Sales AI is a separate service/process from production inbound reception.

---

# 16. OFFLINE BACKTEST BEFORE VOICE

Build/run simulation against ALL THREE:

- `outbound-sales-brain-yad-sales-ai-roleplay-fixtures.v1.yaml`;
- `outbound-sales-brain-hook-backtest-fixtures.v1.yaml`;
- `outbound-sales-brain-sales-ai-first-60-seconds-fixtures.v1.yaml`.

For hook/first-minute tests capture:

- hook version;
- persona;
- first-question answered;
- useful process fact by turn 3;
- objection generated;
- unsupported/creepy wording;
- natural transition to discovery;
- interruption handling;
- repetition;
- readiness decision;
- hard fail.

Negative controls must score/review materially worse than preferred process hooks.

Do not interpret offline simulations as real conversion evidence.

---

# 17. INTERNAL / ALLOWLISTED VOICE GATE

Before a real prospect hears the release candidate, run actual production outbound voice configuration against internal/allowlisted participants for at least:

- normal owner;
- opener interruption;
- repeated interruption;
- `who is this?`;
- `why are you calling?`;
- `are you AI?`;
- AI-curious prospect;
- gatekeeper;
- busy;
- send email;
- existing answering service;
- existing receptionist;
- existing CRM;
- strong system/no sale;
- Cal.com booking;
- booking failure;
- wrong number;
- DNC.

Required:

- no 3–5 second dead air;
- short natural turns;
- immediate barge-in;
- no stale replay;
- no full-opener restart after interruption;
- natural number/email/time speech;
- correct fact boundaries;
- durable DNC;
- no false booking confirmation.

---

# 18. PILOT CONTROL PLANE

Initial controlled pilot:

- exact Account selection;
- Call Pack/hook preview;
- current phone eligibility decision preview;
- deterministic pre-flight;
- concurrency = 1 initially;
- Start Next Call;
- Pause After Current;
- STOP NEW OUTBOUND CALLS;
- completed-call review;
- immutable version snapshot.

No unattended high-volume launch.

---

# 19. EXPERIMENT VERSIONING

Every call persists the fields in:

`outbound-sales-brain-sales-ai-pilot-experiment-contract.v1.yaml`.

At minimum version-stamp:

- hook;
- core script;
- first-60-second behavior version;
- dialogue policy;
- response cards;
- prompt composer;
- model;
- STT;
- TTS voice/config;
- Call Pack/research snapshot;
- vertical profile;
- booking config;
- compliance policy;
- phone eligibility decision/screening references.

Never hot-edit the live prompt/hook mid-call.

Preserve failures, not just booked meetings.

---

# 20. LIVE HOOK TEST ORDER

After internal voice passes and exact endpoints are AI-ALLOWed:

1. HVAC `HVAC_AH_A1`;
2. HVAC `HVAC_OVERFLOW_A2` on comparable prospect quality;
3. `CATEGORY_AH_B1` only when current ad claim is unavailable or as deliberate safe comparison;
4. Plumbing once baseline voice/dialogue is stable;
5. Roofing estimate hook after urgent-service proof.

Do not test 12 hook families at once.

Do not use deceptive/weak negative controls on real prospects.

---

# 21. LIVE REVIEW METRICS

Per hook/version track:

- human answers;
- right-person conversations;
- first-question answer rate;
- useful process fact by turn 3;
- >30 second engagement;
- meaningful problem supported;
- qualified strategy-call offer;
- strategy-call accepted/booked;
- callback/email;
- no-need;
- DNC;
- opener hang-up;
- latency;
- talk/listen ratio;
- interruption/repetition failures.

Do not optimize booking rate without meeting quality.

---

# 22. RELEASE STOP CONDITIONS

Stop/pause new outbound calls for:

- repeated severe latency/dead air;
- repeated barge-in failure;
- stale audio/replayed opener after interruption;
- wrong Account/Call Pack;
- stale/unsupported ad statement;
- invented spend/results/CRM/workflow;
- DNC failure;
- wrong-number reuse;
- registry/screening error treated as allow;
- Twilio call without current AI ALLOW decision;
- repeated argument/rebuttal loop;
- false booking confirmation;
- demo context in production;
- deterministic policy/compliance gate failure.

One severe truth/DNC/policy failure can stop the pilot immediately.

---

# 23. HUMAN ASSIST FALLBACK

If the release classification is not `REAL_AI_PILOT_ELIGIBLE`, do not waste the day.

Human Assist should still support:

```text
Search market
-> Claim Account
-> Open Account
-> HUMAN_MANUAL_CALL preflight
-> create ContactAttempt
-> open rep device dialer
-> disposition/callback/email/DNC
-> canonical timeline
```

Use `outbound-sales-brain-human-manual-call-v1-spec.md`.

The rep's phone is transport only. YAD remains the system of record.

---

# 24. POST-CALL / MICHAEL HANDOFF

Every booked strategy call generates `StrategyCallPrepBrief`:

- company;
- attendee/role;
- time;
- reason called;
- public context;
- prospect-stated workflow;
- problem wording;
- systems/numbers stated;
- objection;
- unanswered questions;
- suggested Michael questions;
- prominent DO NOT ASSUME;
- transcript/recording refs.

Target Michael prep time: under 60 seconds.

---

# 25. QA / OPTIMIZATION

Use the pilot scorecard and conversation optimization spec.

Classify actual root cause:

- prospect fit;
- contact data;
- hook;
- first-60-second behavior;
- research/Call Pack;
- dialogue/state;
- objection;
- qualification;
- model;
- STT;
- TTS;
- latency;
- telephony;
- phone eligibility/screening;
- booking;
- compliance/policy.

Change the smallest responsible component, version it, rerun affected fixtures, then retest.

Keep last-known-good rollback package.

---

# 26. HARD CONSTRAINTS

Do not:

- build 30 vertical-specific sales agents;
- load the whole Sales Manual every turn;
- invent business/contact facts;
- attack employees/CRM/IT/agencies;
- book no-pain prospects just for metrics;
- claim unconfirmed booking;
- leak demo context into production;
- let outbound crash inbound;
- run Market Miner in realtime voice process;
- use real prospects as implementation smoke tests;
- bypass channel eligibility because a rep owns the Account;
- treat a rep's cell phone as a compliance workaround;
- re-enable automatic GitHub Actions;
- merge `main`;
- force-push over architecture work;
- commit secrets.

---

# 27. IMPLEMENTATION CHECKPOINT

Report:

1. remote branch reconciled;
2. demo/receptionist runtime audit;
3. Sales AI service status;
4. runtime Call Pack;
5. working memory;
6. opener/hook selector;
7. first-60-second behavior implementation;
8. state machine;
9. response-card/RAG composition;
10. roleplay fixture results;
11. hook backtest fixture results;
12. first-60-second fixture results;
13. negative-control comparison;
14. phone screening/provider status;
15. human vs AI eligibility status;
16. manual rep-cell preflight status;
17. DNC durability results;
18. Cal.com status;
19. pilot control plane;
20. voice/latency/barge-in results;
21. experiment version stamping;
22. blockers;
23. exact release classification;
24. exact next controlled-release step.

---

# 28. SUCCESS CONDITION

**One YAD Sales AI can call an actually eligible researched prospect, choose the shortest truthful relevant hook, survive interruptions without restarting, extract a useful process fact quickly, correctly decide whether a 15-minute strategy call is warranted, execute the right next-step tool, and leave a fully versioned record that lets YAD improve the next batch scientifically instead of guessing. When AI eligibility is not available, the same Prospect Factory still lets human reps work eligible Accounts through a controlled manual-call workflow.**