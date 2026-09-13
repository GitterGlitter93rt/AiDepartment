# Your AI Department — Outbound Sales Conversation State Machine

**Status:** Architecture authority  
**Purpose:** Define deterministic conversational stages, transitions, terminal states and action priorities around the realtime language model.

---

# 1. PRINCIPLE

The LLM generates natural language inside a controlled sales process.

It does not have unlimited freedom to decide whether to:

- continue after DNC;
- call wrong number again;
- claim booking success;
- skip identity;
- invent a financial diagnosis;
- stay in discovery forever.

Conversation state is explicit and persisted in call session state.

---

# 2. TOP-LEVEL STATES

- `connecting`
- `answer_classification`
- `opening`
- `role_check`
- `gatekeeper`
- `hook`
- `listen`
- `discovery`
- `probe`
- `quantify`
- `position`
- `objection`
- `next_step`
- `action_in_progress`
- `confirmation`
- `close`
- `terminal`

Post-call processing is outside live conversation state.

---

# 3. TERMINAL REASONS

- completed
- voicemail_left
- no_answer
- wrong_number
- dnc
- prospect_ended
- disqualified
- transferred
- technical_failure
- policy_terminated
- carrier_failure

Once terminal, normal sales generation stops.

---

# 4. PRIORITY INTERRUPTS

Highest-priority intents can transition from almost any live state.

## DNC

-> invoke suppression -> terminal dnc.

## Wrong number

-> record -> terminal wrong_number.

## Prospect explicitly ends call

-> brief close -> terminal prospect_ended.

## Technical/policy forced stop

-> safe close if possible -> terminal.

## Transfer completed

-> terminal transferred for AI session.

These take precedence over sales state.

---

# 5. CONNECTING

Responsibilities:

- provider call setup;
- retrieve immutable Call Pack;
- validate current policy/session authorization;
- initialize semantic memory/action state.

No prospect-facing speech yet unless transport requires greeting initiation.

Transition:

- connected -> answer_classification
- failure -> terminal carrier/technical.

---

# 6. ANSWER CLASSIFICATION

Inputs:

- provider answer events;
- machine detection if used;
- initial speech.

Outcomes:

- human -> opening
- machine -> voicemail policy
- fax -> terminal carrier/failure outcome
- unknown -> conservative answer handling.

Human-answer UX takes priority over waiting excessively for perfect machine classification.

---

# 7. OPENING

Objectives:

- identity;
- honest cold/unexpected contact framing according to policy/campaign;
- brief relevant reason;
- first question.

Target one short turn.

Transition:

- role unclear -> role_check
- decision-maker responding to question -> listen/hook
- gatekeeper detected -> gatekeeper
- busy brush-off -> objection(busy)
- DNC -> priority interrupt.

---

# 8. ROLE CHECK

Determine:

- target contact/decision-maker;
- gatekeeper/front desk;
- wrong person but same company;
- wrong company/number.

Do not over-interrogate.

Transitions:

- right stakeholder -> hook/listen
- gatekeeper -> gatekeeper
- can provide routing -> gatekeeper
- wrong number -> terminal.

---

# 9. GATEKEEPER

Goal:

- identify who owns workflow/problem;
- get routing/contact path;
- leave concise note/email path if appropriate.

Not goal:

- full financial discovery with receptionist;
- deceptive bypass.

Transitions:

- transferred to stakeholder -> role_check/opening adapted
- contact identified -> next_step/close
- unavailable/no access -> close
- gatekeeper has legitimate authority/process knowledge -> may ask one relevant routing/process question but remain concise.

---

# 10. HOOK

Use primary Call Pack hook unless conversation already changed context.

Rules:

- fact grounding checked;
- one question;
- no accusation;
- no feature dump.

Transition:

- prospect answers with process info -> listen
- objection/brush-off -> objection
- correction -> update structured state then listen/discovery
- question about YAD -> short position/explanation then return to hook.

---

# 11. LISTEN

This is a real state, not instant response generation.

Capture:

- process facts;
- systems;
- stakeholder;
- pain/no pain;
- correction;
- numbers;
- objection clues.

Classifier updates hypothesis status:

- untested
- supported
- contradicted
- inconclusive.

Transition based on content.

---

# 12. DISCOVERY

Objective:

Understand current workflow:

`trigger -> input -> system -> owner -> action -> handoff -> outcome -> measurement`

Ask the next highest-information question, not a fixed list.

Transition:

- clear problem but frequency/impact unclear -> probe
- no problem -> backup hypothesis or disqualify
- asks what YAD does -> position briefly
- objection -> objection.

---

# 13. PROBE

Understand:

- how often;
- how much volume;
- what happens when it fails;
- who owns it;
- whether measured;
- what system is involved.

Transition:

- meaningful measurable pain + numeric data -> quantify
- meaningful pain, no data -> next_step may be measurement/strategy review
- process solved -> backup hypothesis/disqualify.

---

# 14. QUANTIFY

Only when appropriate.

Use deterministic calculator for material arithmetic.

Rules:

- source-label numbers;
- unknown remains unknown;
- exposure separated from illustrative recovery;
- no guaranteed ROI.

Transition:

- business case worth deeper review -> position / next_step
- insufficient data -> measurement next step
- economics too small -> disqualify/close.

---

# 15. POSITION

Explain only the relevant YAD capability/approach.

Pattern:

`confirmed problem -> how YAD could approach category -> human/technical boundaries -> next step`

Do not list every service.

Transition:

- interested -> next_step
- objection -> objection
- asks detail -> concise position/retrieval
- no interest -> close/disqualify.

---

# 16. OBJECTION

Objection is typed:

- busy
- send_email
- has_crm
- has_receptionist
- answering_service
- marketing_agency
- IT_company
- uses_chatgpt
- customers_want_humans
- too_expensive
- timing
- ROI_guarantee
- integration
- distrust_AI
- other.

Handler retrieves/uses relevant doctrine.

After response:

- return to prior business state if prospect remains engaged;
- next_step if objection resolves and problem clear;
- close if not interested;
- DNC priority interrupt if requested.

Do not loop on same objection more than once/twice.

---

# 17. BACKUP HYPOTHESIS RULE

If primary is convincingly handled:

- mark contradicted/solved;
- acknowledge positively;
- use at most one high-quality backup hypothesis when evidence justifies it.

If backup also strong/no pain:

- disqualify/close.

Do not cycle through every YAD service trying to find weakness.

---

# 18. NEXT STEP

Select one:

- strategy_call
- assessment
- human_callback
- requested_callback
- targeted_email
- technical_followup
- measurement/data_review
- warm_transfer
- no_sale/disqualify.

Choice based on real conversation, not mandatory meeting KPI.

---

# 19. ACTION IN PROGRESS

For booking/email/SMS/transfer/DNC:

- tool request made;
- generation state knows result pending;
- truthfully acknowledge wait if needed;
- no success claim yet.

Transitions:

- success -> confirmation
- recoverable failure -> fallback next_step
- terminal action e.g. DNC -> terminal
- technical failure -> safe close/follow-up.

---

# 20. CONFIRMATION

Confirm only verified result.

Examples:

- booked date/time/provider confirmation;
- email sent;
- callback request recorded;
- transfer is occurring.

Do not over-repeat contact information.

Transition -> close or transfer terminal.

---

# 21. CLOSE

Brief:

- confirm next step if any;
- thank/exit;
- no last-second pitch after no-sale.

Transition -> terminal completed/disqualified/prospect_ended.

---

# 22. “WHAT DO YOU GUYS DO?” SIDE PATH

From opening/hook/discovery:

- answer with short YAD business-language explanation;
- return to one prospect-specific question.

Do not reset conversation to beginning.

---

# 23. “IS THIS AI?” SIDE PATH

- answer truthfully;
- apply policy/disclosure;
- if prospect continues, return to prior state;
- if they decline AI interaction, close/transfer according to approved options.

---

# 24. PROSPECT CORRECTION

From any relevant state:

- accept correction;
- create session fact/ProspectStatement candidate;
- suppress old fact from live use;
- update hypothesis if material;
- continue.

No argument.

---

# 25. FINANCIAL INPUT STATE

When prospect gives numbers, store them immediately in structured session state with source class.

Example:

`monthly_calls = 1200 (prospect_estimate)`

If later revised:

- preserve old statement history;
- current calculation uses newest explicit value.

---

# 26. REPETITION STATE

Track semantic topics already delivered:

- identity
- company explanation
- main hook
- offer description
- email offer
- booking offer
- AI disclosure.

Generator receives `already_said` summary.

Do not repeat unless prospect asks/clarification needed.

---

# 27. MAX DISCOVERY DEPTH

Cold call should not become unlimited consulting session by default.

Once:

- meaningful problem confirmed;
- correct stakeholder engaged;
- enough evidence for next step;

move to next_step rather than collecting every possible metric.

Campaign can define target call length ranges as a coaching signal, not hard cutoff.

---

# 28. TOOL AUTHORITY

State machine can only enter tool states for tools code says are available.

No booking tool -> cannot enter booking commit; can create human follow-up.

No transfer target -> cannot promise warm transfer.

---

# 29. SESSION RECOVERY

If realtime model disconnects/restarts mid-call and transport supports recovery:

- restore structured state from session store;
- recent transcript buffer;
- pending action status;
- do not re-run already completed irreversible tool.

If recovery impossible, end safely rather than restart sales pitch from beginning.

---

# 30. POST-CALL HANDOFF

Terminal state passes:

- Call Pack
- conversation state
- transcript/events as policy permits
- ProspectStatement candidates
- tool results
- terminal reason

to post-call processor.

---

# 31. TRANSITION TEST — STRONG AFTER-HOURS PROCESS

opening -> hook(after-hours) -> listen -> prospect proves strong -> mark primary contradicted -> backup(replacement follow-up) -> strong again -> disqualify -> close.

Expected: no third/fourth product hunt.

---

# 32. TRANSITION TEST — BUSY OWNER

opening -> objection(busy) -> one ten-second relevance question -> pain yes -> requested callback/booking -> action/confirmation -> close.

Expected: no prolonged discovery.

---

# 33. TRANSITION TEST — DNC DURING POSITION

position -> DNC interrupt -> stop audio -> suppression -> confirmation -> terminal dnc.

Expected: never return to objection/discovery.

---

# 34. TRANSITION TEST — BOOKING FAILURE

next_step -> action booking -> failure -> fallback human follow-up -> confirmation of request only -> close.

Expected: disposition not scheduled.

---

# 35. TRANSITION TEST — WRONG PERSON, RIGHT COMPANY

opening -> role_check -> not owner but identifies operations manager -> create contact/routing -> next_step/close.

Outcome can be productive gatekeeper/routing.

---

# 36. IMPLEMENTATION RULE

State machine should be testable without Twilio.

Run simulated text events through transitions first.

Realtime model proposes language/intent; orchestration owns terminal/action/safety transitions.
