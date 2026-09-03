# CLAUDE CODE — SALES AI PILOT CURRENT

**Status:** Current implementation authority for the outbound Sales AI gate  
**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Implementation owner:** Claude Code on EdgeXpert  
**Architecture owner:** ChatGPT

If an older Sales AI handoff conflicts with this file, this file wins for the immediate pilot implementation.

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

# 2. CURRENT PRODUCT DECISION

One outbound Sales AI:

`yad-sales-core-v1`

Do **not** build one sales agent per vertical.

Vertical/business research changes the Call Pack:

- who the company is;
- what we observed;
- which business process to investigate;
- which stakeholder to seek;
- which hook/question to use;
- what facts may be stated;
- what must remain a question/hypothesis;
- vertical safety boundaries.

The core sales personality/process stays shared.

---

# 3. READ ORDER — SALES CONVERSATION

Read these in this order:

1. `outbound-sales-brain-yad-sales-ai-core-script-v1.md`
2. `outbound-sales-brain-sales-ai-opener-selector-spec.md`
3. `outbound-sales-brain-sales-ai-response-cards.v1.yaml`
4. `outbound-sales-brain-yad-sales-ai-dialogue-policy.v1.yaml`
5. `outbound-sales-brain-strategy-call-qualification-gate-spec.md`
6. `outbound-sales-brain-sales-ai-next-step-ladder-spec.md`
7. `outbound-sales-brain-sales-ai-gold-dialogues-v1.md`
8. `outbound-sales-brain-yad-sales-ai-roleplay-fixtures.v1.yaml`
9. `outbound-sales-brain-agent-persona-style-spec.md`
10. `outbound-sales-brain-conversation-state-machine.md`
11. `outbound-sales-brain-priority-intent-detector-spec.md`
12. Sales Manual Modules 04A, 05 and 07.

---

# 4. READ ORDER — RUNTIME DATA / PROMPT

1. `outbound-sales-brain-sales-ai-runtime-callpack-contract.v1.yaml`
2. `outbound-sales-brain-sales-ai-working-memory-contract.v1.yaml`
3. `outbound-sales-brain-call-pack-spec.md`
4. `outbound-sales-brain-prompt-composition-spec.md`
5. `outbound-sales-brain-sales-manual-rag-spec.md`
6. `outbound-sales-brain-action-tools-spec.md`

The realtime model should receive a compact normalized Call Pack, structured working memory, current state and only the relevant Sales Manual/response-card material.

Do not feed raw crawler/provider payloads or the entire Sales Manual into every turn.

---

# 5. READ ORDER — BOOKING / NEXT STEP

1. `outbound-sales-brain-calcom-strategy-call-booking-spec.md`
2. `outbound-sales-brain-strategy-call-prep-brief-spec.md`
3. `outbound-sales-brain-15-minute-strategy-call-playbook.md`
4. `outbound-sales-brain-qualified-hot-transfer-spec.md` — optional/later

Current booking authority:

- Cal.com scheduling;
- Michael calendar = `michael@youraidepartment.ai`;
- Cal Video meeting location;
- event = YAD 15-Minute AI Strategy Call.

Do not create duplicate direct Outlook meetings when Cal.com owns the booking.

---

# 6. READ ORDER — VOICE / PILOT

1. `outbound-sales-brain-demo-production-voice-mode-spec.md`
2. `outbound-sales-brain-realtime-voice-policy.md`
3. `outbound-sales-brain-twilio-telephony-spec.md`
4. `outbound-sales-brain-ai-pilot-control-plane-spec.md`
5. `outbound-sales-brain-ai-cold-call-pilot-scorecard.md`
6. `outbound-sales-brain-sales-ai-conversation-optimization-spec.md`

Same approved Twilio business number can support:

- `DEMO_AI`;
- `PRODUCTION_INBOUND`;
- `PRODUCTION_OUTBOUND_SALES`.

Keep processes/session namespaces/config separate.

---

# 7. IMPLEMENTATION TARGET

Build a stateful conversation system:

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

# 8. REQUIRED PILOT STATES

At minimum:

- opening
- role_check
- gatekeeper
- hook
- listen
- discovery
- probe
- position
- objection
- strategy_call_readiness
- availability
- booking
- confirmation
- close
- terminal.

Priority interrupts override ordinary selling:

- DNC;
- wrong number/company;
- clear prospect end;
- policy/technical stop.

---

# 9. STRATEGY CALL READINESS

Implement explicit results:

- `BOOK_NOW`
- `CONTINUE_BRIEFLY`
- `CALLBACK`
- `SEND_TARGETED_INFO`
- `END_NO_NEED`
- `DISQUALIFY_OR_REVIEW`.

Do not use positive sentiment as a proxy for meeting qualification.

No-sale is a valid successful outcome.

---

# 10. NEXT-STEP LADDER

Preferred order when appropriate:

1. 15-minute strategy call;
2. requested callback;
3. targeted short email;
4. free AI Department Assessment when useful;
5. human follow-up/review;
6. no sale;
7. DNC/end.

Never stack every CTA after a clear rejection.

Assessment link/config must come from current funnel authority rather than a stale hard-coded URL.

---

# 11. RECEPTIONIST / DEMO RUNTIME REUSE

Audit the actually deployed working demo/receptionist on the voice VPS before rewriting transport.

Reuse proven components where appropriate:

- Twilio webhook/signature handling;
- ConversationRelay/WebSocket;
- STT/TTS;
- barge-in;
- number/date pronunciation;
- session lifecycle;
- low-latency greeting;
- transfer/tool transport;
- telemetry.

Do not reuse demo business prompts/context in production Sales AI.

Outbound Sales AI should be a separate service/process from production inbound reception.

---

# 12. TEXT ROLEPLAY BEFORE VOICE

Build a simulator around:

`outbound-sales-brain-yad-sales-ai-roleplay-fixtures.v1.yaml`

Capture per fixture:

- state transitions;
- generated turns;
- working-memory updates;
- readiness result;
- action/tool requests;
- terminal reason;
- hard-fail/QA result.

Compare behavior to `outbound-sales-brain-sales-ai-gold-dialogues-v1.md` without forcing exact wording.

Critical fixtures must pass before controlled voice testing.

---

# 13. VOICE QUALITY

Required behavior:

- no 3–5 second dead air;
- concise 1–2 sentence turns;
- one question at a time;
- immediate barge-in handling;
- no stale sentence replay after interruption;
- natural phone/email/date/time speech;
- specific acknowledgement of what the prospect said;
- no generic next-script-line behavior.

Instrument the existing realtime latency targets.

---

# 14. PILOT CONTROL PLANE

Implement/prepare the manager pilot workflow in:

`outbound-sales-brain-ai-pilot-control-plane-spec.md`

Initial pilot should support:

- exact candidate selection;
- Call Pack/opener preview;
- deterministic pre-flight result;
- concurrency = 1 initially;
- Start Next Call;
- Pause After Current;
- STOP NEW OUTBOUND CALLS;
- completed-call review;
- immutable configuration/version snapshot.

Do not begin with unattended high-volume dialing.

---

# 15. BOOKING

Typed actions:

- `check_strategy_call_availability`
- `book_strategy_call`.

Rules:

- prospect must agree;
- use real Cal.com availability;
- offer max two slots at a time;
- prefer same-day when provider/event rules permit;
- next-business-day is normal fallback;
- collect/confirm business email;
- claim success only after provider confirms;
- booking failure -> capture preference + human follow-up.

---

# 16. POST-CALL / MICHAEL HANDOFF

Every booked strategy call gets a `StrategyCallPrepBrief` with:

- company;
- attendee/role;
- meeting time;
- why YAD called;
- public research context;
- exact prospect-stated workflow;
- problem/pain wording;
- numbers/systems they stated;
- objections;
- unanswered questions;
- suggested questions for Michael;
- prominent `DO NOT ASSUME` section;
- transcript/recording/source refs.

Michael should be able to prep in under 60 seconds.

---

# 17. QA / OPTIMIZATION

Use:

`outbound-sales-brain-ai-cold-call-pilot-scorecard.md`

Classify failures by actual root cause:

- contact/research;
- hypothesis;
- opener;
- listening;
- state/prompt;
- objection;
- qualification;
- STT;
- TTS;
- latency;
- telephony;
- booking/tool;
- policy.

Use `outbound-sales-brain-sales-ai-conversation-optimization-spec.md` before promoting script/prompt changes.

Keep a last-known-good conversation package for rollback.

---

# 18. HARD CONSTRAINTS

Do not:

- build 30 separate vertical agents;
- load the whole Sales Manual per turn;
- invent public/internal business facts;
- fabricate contact source/identity;
- attack employees, CRM, IT or marketing agencies;
- book polite/no-pain prospects to inflate metrics;
- claim an unconfirmed calendar booking;
- let demo context leak into production;
- let outbound failure take down inbound reception;
- run heavy Market Miner crawling on realtime voice process;
- use real prospects as implementation tests;
- re-enable automatic GitHub Actions;
- merge `main`;
- force-push over architecture commits;
- commit secrets.

---

# 19. IMPLEMENTATION CHECKPOINT

Report:

1. remote branch reconciled;
2. demo/receptionist runtime audit;
3. reusable components;
4. Sales AI service structure;
5. runtime Call Pack implementation;
6. working-memory implementation;
7. opener selector;
8. state machine;
9. response-card/RAG prompt composition;
10. roleplay pass/fail;
11. Cal.com adapter;
12. pilot control plane;
13. voice/latency readiness;
14. blockers;
15. exact next controlled-test step.

---

# 20. SUCCESS CONDITION

**One YAD Sales AI can call a researched prospect, choose a truthful relevant opener, react to the prospect instead of reciting a script, identify whether a real opportunity exists, choose the correct next step, and when warranted book a real 15-minute Cal.com strategy call with Michael — while remaining observable and controllable enough to improve from every reviewed call.**
