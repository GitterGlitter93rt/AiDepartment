# CLAUDE CODE — SALES AI PILOT CURRENT TASK

**Status:** Immediate implementation addendum  
**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Implementation owner:** Claude Code on EdgeXpert  
**Architecture owner:** ChatGPT

---

# 1. COORDINATION RULE

ChatGPT is continuing to add architecture/documentation commits to `feature/outbound-sales-brain` while Claude implements locally.

Before beginning this Sales AI pilot gate:

1. inspect local status;
2. preserve/commit or stash legitimate local work;
3. `git fetch origin`;
4. reconcile/rebase against the current remote `feature/outbound-sales-brain` safely;
5. do **not** merge `main`;
6. do **not** force-push over remote architecture commits.

If local and remote edits conflict in an architecture document, current remote architecture docs are the design authority unless Michael/ChatGPT explicitly resolved otherwise.

Code implementation findings may require architecture review rather than silently rewriting the doctrine.

---

# 2. READ THESE NEW FILES FIRST

1. `docs/09-software/outbound-sales-brain-yad-sales-ai-core-script-v1.md`
2. `docs/09-software/outbound-sales-brain-yad-sales-ai-dialogue-policy.v1.yaml`
3. `docs/09-software/outbound-sales-brain-sales-ai-opener-selector-spec.md`
4. `docs/09-software/outbound-sales-brain-sales-ai-response-cards.v1.yaml`
5. `docs/09-software/outbound-sales-brain-sales-ai-gold-dialogues-v1.md`
6. `docs/09-software/outbound-sales-brain-strategy-call-qualification-gate-spec.md`
7. `docs/09-software/outbound-sales-brain-yad-sales-ai-roleplay-fixtures.v1.yaml`
8. `docs/09-software/outbound-sales-brain-ai-cold-call-pilot-scorecard.md`
9. `docs/09-software/outbound-sales-brain-calcom-strategy-call-booking-spec.md`
10. `docs/09-software/outbound-sales-brain-demo-production-voice-mode-spec.md`
11. `docs/09-software/outbound-sales-brain-conversation-state-machine.md`
12. `docs/09-software/outbound-sales-brain-priority-intent-detector-spec.md`
13. `docs/09-software/outbound-sales-brain-agent-persona-style-spec.md`
14. `docs/09-software/outbound-sales-brain-action-tools-spec.md`
15. Sales Manual Modules 04A, 05 and 07.

These refine but do not discard the broader `CLAUDE-CURRENT-TASK.md` architecture.

---

# 3. CURRENT SALES AI PRODUCT DECISION

One outbound Sales AI:

`yad-sales-core-v1`

Do not build a separate conversational agent/prompt for each vertical.

Vertical profiles and Call Packs supply:

- research context;
- correct business process;
- primary/backup hypothesis;
- target role/person;
- opening question;
- evidence/proof boundaries;
- relevant safety boundaries;
- relevant Sales Manual retrieval.

Core sales behavior remains shared.

---

# 4. IMMEDIATE IMPLEMENTATION GOAL

Implement the Sales AI as a **stateful conversation system**, not one giant system prompt.

Required conceptual layers:

```text
Immutable CallPack
        +
Sales AI core persona
        +
Opener selector
        +
Dialogue policy
        +
Conversation state machine
        +
Priority-intent detector
        +
Small relevant Sales Manual retrieval / response cards
        +
Typed action tools
        +
Conversation working memory
        =
Realtime turn generation
```

Do not place the entire Sales Manual into every realtime prompt.

Use the gold dialogues as behavior examples, not exact transcripts to memorize.

---

# 5. REQUIRED LIVE STATES FOR PILOT

At minimum support/test:

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
- terminal

Priority interrupts:

- DNC
- wrong number/company
- prospect ends call
- policy/technical stop.

---

# 6. STRATEGY CALL READINESS

Implement explicit result categories:

- `BOOK_NOW`
- `CONTINUE_BRIEFLY`
- `CALLBACK`
- `SEND_TARGETED_INFO`
- `END_NO_NEED`
- `DISQUALIFY_OR_REVIEW`

Do not infer `BOOK_NOW` merely from positive sentiment.

Read `outbound-sales-brain-strategy-call-qualification-gate-spec.md`.

---

# 7. OPENER SELECTION

Do not use one identical opener for every prospect.

Use `outbound-sales-brain-sales-ai-opener-selector-spec.md`.

Opening priority:

1. fresh claim-safe paid-demand/service context;
2. strong first-party workflow/service context;
3. market + category relevance;
4. role-based process question.

Then ask one question driven by the active hypothesis.

Do not turn public evidence into an accusation.

---

# 8. RESPONSE CARDS

Use `outbound-sales-brain-sales-ai-response-cards.v1.yaml` as a concise doctrine retrieval layer for common situations such as:

- busy;
- send email;
- not interested;
- has receptionist;
- has answering service;
- has CRM;
- uses ChatGPT;
- has IT company;
- has marketing agency;
- asks if AI;
- price;
- booking;
- wrong person;
- wrong number;
- DNC.

Cards are response shapes, not exact lines to repeat mechanically.

The model must answer the prospect's actual last statement before applying a card.

---

# 9. BOOKING

Current authority:

- Cal.com = scheduling authority;
- Michael Outlook calendar `michael@youraidepartment.ai` = connected calendar/source of conflicts;
- Cal Video = meeting location;
- event = YAD 15-Minute AI Strategy Call.

Required typed tools:

- `check_strategy_call_availability`
- `book_strategy_call`

Do not directly create a duplicate Outlook event if Cal.com owns booking.

Do not claim booking success until Cal.com confirms.

---

# 10. DEMO / PRODUCTION ROUTING

Same approved Twilio business number may be used, but runtime roles remain distinct:

- `DEMO_AI`
- `PRODUCTION_INBOUND`
- `PRODUCTION_OUTBOUND_SALES`

Outbound Calls API may specify the Sales AI voice URL while the number's inbound webhook remains routed to the currently selected inbound mode.

Reuse proven demo/receptionist transport/voice components where appropriate, not demo business prompts/context.

---

# 11. RECEPTIONIST RUNTIME REUSE AUDIT

Before rewriting voice transport, inspect the actually deployed demo/receptionist runtime on the voice VPS.

Identify reusable implementation for:

- Twilio webhook validation;
- ConversationRelay/WebSocket transport;
- STT/TTS provider/config;
- interruption/barge-in;
- natural number pronunciation;
- session lifecycle;
- initial greeting latency;
- logging/telemetry;
- transfer/tool plumbing.

Then implement outbound Sales AI as a separate service/process/session namespace.

Do not run heavy Market Miner research in the realtime service.

---

# 12. TEXT SIMULATION BEFORE VOICE

Build a deterministic text simulation runner around:

`outbound-sales-brain-yad-sales-ai-roleplay-fixtures.v1.yaml`

For each fixture capture:

- state transitions;
- generated turns;
- extracted prospect facts;
- readiness decision;
- requested tool actions;
- termination reason;
- QA/hard-fail result.

The fixture does not require exact wording. Grade required/prohibited behaviors.

Compare high-quality outputs against `outbound-sales-brain-sales-ai-gold-dialogues-v1.md` for behavioral style.

Critical fixtures must pass before controlled voice test.

---

# 13. PROMPT CONSTRUCTION

Realtime prompt should contain only what is necessary for the turn/session:

- YAD identity/persona;
- immutable Account/Call Pack summary;
- current conversation state;
- current prospect working-memory facts;
- current hypothesis/readiness;
- relevant proof boundaries;
- relevant objection/manual card when needed;
- tool contracts/action result;
- concise dialogue-policy instructions.

Avoid resending:

- irrelevant vertical manuals;
- raw crawler content;
- huge research logs;
- unrelated commercial material.

---

# 14. CALL WORKING MEMORY

Implement/update structured in-call memory for:

- current stakeholder/person/role;
- corrected person/role;
- current workflow;
- systems prospect explicitly states;
- pain status;
- volume/numbers + source turn;
- primary hypothesis status;
- backup hypothesis status;
- objections;
- busy/timing request;
- email request;
- callback request;
- booking intent;
- promised next action;
- DNC/wrong endpoint.

The live model should not have to reconstruct all of this from a growing transcript every turn.

---

# 15. VOICE BEHAVIOR

Hard implementation targets:

- concise 1–2 sentence normal turns;
- one question at a time;
- stop output promptly on barge-in;
- do not replay the interrupted sentence from the beginning;
- natural phone-number/date/time speech;
- no 3–5 second dead-air gaps;
- acknowledge prospect content specifically;
- no generic script continuation after unexpected answer.

Instrument latency.

---

# 16. POST-CALL HANDOFF

For every call persist structured outcome.

For every booked meeting, create Michael handoff containing:

- Account/company;
- attendee/role;
- meeting time/timezone;
- reason YAD called;
- confirmed workflow;
- problem in prospect's words;
- numbers/systems prospect stated;
- objections/concerns;
- expectation for meeting;
- suggested questions for Michael;
- things Michael must not assume;
- source call/transcript/recording refs.

---

# 17. PILOT QA

Use:

`outbound-sales-brain-ai-cold-call-pilot-scorecard.md`

Instrument enough telemetry to distinguish:

- research failure;
- wrong contact;
- conversation/prompt failure;
- model reasoning failure;
- STT failure;
- TTS/prosody failure;
- latency/runtime failure;
- booking-tool failure;
- telephony failure.

Do not label all failures `AI issue`.

---

# 18. DO NOT DO

- do not implement 30 vertical-specific sales agents;
- do not load the entire Sales Manual per turn;
- do not use one giant static script prompt as the state machine;
- do not make Cal.com and direct Outlook writes both create meetings;
- do not let demo context enter production calls;
- do not let outbound crash kill inbound reception;
- do not book polite/no-pain prospects just to increase conversion;
- do not call real prospects as an implementation test;
- do not re-enable automatic GitHub Actions;
- do not merge `main`;
- do not force-push over architecture changes;
- do not commit secrets.

---

# 19. IMPLEMENTATION CHECKPOINT RESPONSE

After this gate report:

1. latest remote commit reconciled;
2. receptionist/demo components audited;
3. reusable components identified;
4. Sales AI service/package structure;
5. opener selector implementation status;
6. state machine implementation status;
7. working-memory implementation;
8. prompt/response-card composition implementation;
9. roleplay test count/pass/fail;
10. Cal.com adapter status;
11. voice-runtime readiness;
12. latency instrumentation readiness;
13. blockers;
14. exact next step before controlled test.

---

# 20. SUCCESS CONDITION

**The system can run the same researched sales process across verticals, choose a truthful relevant opener, react to what the prospect actually says, decide whether a 15-minute call is warranted, and book a real Cal.com slot without behaving like a scripted robocaller.**
