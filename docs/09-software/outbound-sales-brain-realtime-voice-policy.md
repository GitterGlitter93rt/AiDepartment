# Your AI Department — Realtime Voice Turn-Taking & Latency Policy

**Status:** Architecture authority  
**Purpose:** Define how the outbound agent should sound and behave in realtime so Claude can benchmark implementations against objective conversational requirements.

---

# 1. PRODUCT REQUIREMENT

The caller should feel responsive enough that normal human turn-taking works.

The known failure modes to eliminate are:

- 3–5 second dead air;
- prospect talking over slow AI;
- AI continuing stale speech after interruption;
- repeated scripted promises;
- unnecessarily long replies;
- unnatural number pronunciation;
- forcing future callbacks when the user wants action now.

---

# 2. LATENCY DEFINITIONS

Measure end-to-end caller experience.

## Greeting latency

From usable human-answer signal to first audible agent speech.

Target:

- p50 < 0.8 s
- p95 < 1.25 s

## Turn response latency

From prospect end-of-turn decision to first audible agent speech.

Target:

- p50 < 1.0 s
- p95 < 1.5 s

## Barge-in stop latency

From interruption detection to agent audio stop.

Target:

- p50 < 200 ms
- p95 < 300 ms

## Tool action latency

Tracked separately from conversational first-audio latency.

The agent may acknowledge an action before a slow tool completes only if it does not falsely state success.

Example:

Allowed:

> Let me check the calendar.

Not allowed before confirmation:

> You're booked.

---

# 3. ENDPOINTING PRINCIPLE

Do not wait for excessive silence before deciding the prospect finished speaking.

Use:

- provider speech endpointing;
- partial transcript context;
- punctuation/semantic completeness;
- short configurable silence threshold;
- longer patience when prospect is dictating phone/email/numbers.

Do not cut off natural pauses aggressively.

---

# 4. PARTIAL STT POLICY

Partial transcripts may be used to:

- anticipate retrieval/topic;
- prepare likely response;
- detect likely interruption intent;
- prefetch a manual section.

Partial transcripts must NOT trigger irreversible actions such as:

- DNC write unless intent is sufficiently clear/final;
- booking commit;
- CRM stage change;
- transfer;
- sending message.

Irreversible actions require stable/final intent or a deterministic confirmation rule.

---

# 5. STREAMING RESPONSE

The realtime model/TTS pipeline should begin speaking as soon as a safe coherent opening phrase is ready.

Do not generate a full paragraph before TTS begins.

Generation should favor:

- short clauses;
- natural first phrase;
- one question;
- early semantic completeness.

Avoid openings that require 30 tokens before the sentence makes sense.

---

# 6. NORMAL TURN LENGTH

Default spoken response:

- 1–2 sentences;
- roughly 5–25 words for simple turns;
- one question at a time.

Longer allowed when:

- prospect explicitly asks for explanation;
- complex objection needs context;
- summarizing numbers/next step;
- disclosure/policy requires it.

A long answer should still be broken into interruptible natural phrases.

---

# 7. INTERRUPTION / BARGE-IN

When prospect begins a meaningful interruption:

1. stop TTS immediately;
2. increment response generation/cancellation token;
3. discard unsent stale text/audio;
4. prioritize new prospect speech;
5. answer their new intent;
6. do not resume old script unless context requires it.

Example:

Agent:

> I noticed you guys are advertising around—

Prospect:

> Who is this again?

Agent:

> Your AI Department. I had one quick question about how you handle new HVAC calls.

Do not finish the advertising sentence first.

---

# 8. BACKCHANNELS

Use sparingly:

- got it
- okay
- makes sense
- understood

Do not generate constant artificial “uh-huh” audio while prospect speaks.

Backchannels should not interfere with STT or feel like the system is pretending to understand before it does.

---

# 9. SILENCE HANDLING

## Short silence

Wait naturally.

## Medium silence after direct question

A small prompt may be appropriate:

> Still with me?

or repeat/rephrase the question once.

## Long silence / connection ambiguity

Check connection briefly, then end if no response.

Do not fill latency with fake thinking sounds or deceptive “typing” behavior.

---

# 10. LATENCY FILLER POLICY

For genuinely slow tools, a truthful status phrase may be used.

Examples:

- “Let me check that.”
- “One second, I’m looking at the calendar.”

Do not use filler to disguise repeated model latency on every turn.

If ordinary conversation needs filler frequently, the architecture is failing the latency target.

---

# 11. REPETITION CONTROL

Track semantic commitments already stated:

- who YAD is;
- why call was made;
- offered link/email;
- booking offer;
- AI disclosure;
- product explanation.

Before generating, detect whether candidate response repeats a recent semantic unit without reason.

Allow repetition only for:

- prospect asks again;
- audio misunderstanding;
- confirmation of important next step;
- safety/compliance disclosure.

---

# 12. QUESTION DENSITY

Do not stack questions:

Bad:

> How many calls do you get, how many do you miss, what CRM do you use, and what’s a customer worth?

Good:

> Roughly how many inbound calls do you handle in a normal month?

Then listen.

The orchestration state may know four questions are pending; speech asks one.

---

# 13. NUMBER PRONUNCIATION

U.S. phone numbers should be spoken naturally.

Example stored:

`+1 904 555 1212`

Preferred speech semantic representation:

`nine oh four — five five five — one two one two`

Rules:

- country code usually omitted for domestic confirmation unless needed;
- area code separated;
- three-digit exchange separated;
- four-digit line number spoken digit-by-digit or natural paired cadence only if voice sounds normal;
- zero may be “oh” in phone numbers;
- never read as large cardinal number;
- never chunk as unnatural four/four groups.

For confirmation:

> I have nine-oh-four, five-five-five, one-two-one-two. Is that right?

---

# 14. EMAIL PRONUNCIATION

When confirming email:

- speak local part carefully;
- say “at” and “dot” naturally;
- allow prospect to spell;
- do not repeat full address more than needed;
- confirmation can repeat in chunks if long.

Store canonical text separately from spoken rendering.

---

# 15. CURRENCY / PERCENTAGES

Speak naturally:

- `$5,000` -> “five thousand dollars”
- `12%` -> “twelve percent”

When numbers are illustrative:

Say so before/with the number.

Do not let speech rendering remove uncertainty labels.

---

# 16. DATES / TIMES

Always interpret using prospect/local timezone and explicit date context.

Confirm booking naturally:

> Thursday, September third at 10 AM Eastern.

If timezone could be ambiguous, say it.

Do not verbally expose ISO timestamps.

---

# 17. DNC INTERRUPTION PRIORITY

DNC intent has higher priority than current speech/state.

If prospect interrupts with:

> Stop calling me.

- stop TTS;
- DNC action;
- brief confirmation;
- end.

Do not finish the prior sentence.

---

# 18. WRONG-NUMBER PRIORITY

If prospect says wrong number:

- stop pitch;
- apologize;
- mark outcome;
- end.

Do not continue because the Account is high-scoring.

---

# 19. GATEKEEPER TURN STYLE

Gatekeeper interaction should be shorter than owner discovery.

Goal:

- identify right role;
- get routing/contact path;
- exit politely if unavailable.

Do not explain every YAD capability to receptionist.

---

# 20. “WHAT DO YOU DO?” RESPONSE

Use the short business-language explanation.

Target ~15–25 seconds maximum when spoken, usually less.

Then return to a question.

No AI acronym stack.

---

# 21. “IS THIS AI?”

Answer directly and truthfully under approved policy.

Do not dodge or pretend to be a named person.

Then, if prospect remains engaged, return to business purpose.

---

# 22. TOOL CALL TURN PATTERN

## Booking

1. clarify needed parameters;
2. invoke availability/tool;
3. if slow, truthful brief status;
4. present options;
5. confirm chosen option;
6. commit;
7. only after provider success say booked.

## SMS/email

Confirm destination/content topic when needed; send; verify success; report honestly.

## Transfer

Explain transfer briefly; attempt; if failure, recover with booking/follow-up.

## DNC

Immediate, no extra discovery.

---

# 23. TOOL FAILURE LANGUAGE

Never fabricate success.

Examples:

Booking failure:

> The calendar isn’t confirming it on my side. I can capture the time you want and have the team confirm it rather than tell you it’s booked when it isn’t.

Transfer failure:

> I’m not getting the transfer through. Let me get you a proper callback instead.

---

# 24. VOICEMAIL

If machine classification is confident and policy permits message:

- name;
- YAD;
- one relevant workflow question;
- callback/contact if configured;
- short ending.

No full pitch.

Target approximately 15–25 seconds.

If machine/human classification is uncertain, use safe logic that avoids delivering a long prerecorded sales message into ambiguous context.

---

# 25. ANSWER DETECTION

Track:

- ringing;
- human answer;
- machine;
- fax;
- unknown.

Do not let slow answer detection create 3–5 seconds of silent human-answer experience.

Claude must benchmark synchronous vs asynchronous answer/machine detection strategies with controlled calls.

Product metric is human experience, not detection algorithm elegance.

---

# 26. ERROR RECOVERY

If STT/model/TTS has one short transient failure:

- one quick retry/recovery may be acceptable.

If repeated:

- apologize briefly;
- end or route to human according to mode.

Do not trap prospect in repeated “sorry, I didn’t get that” loops.

---

# 27. NATURALNESS TESTS

Review controlled calls for:

- response timing;
- interruption;
- phrasing length;
- pronunciation;
- emotional overacting;
- repetitive cadence;
- unnatural confirmation;
- filler frequency;
- transition smoothness.

A technically low-latency voice can still sound robotic.

---

# 28. BENCHMARK MATRIX CLAUDE MUST RUN

For each candidate realtime stack:

- STT provider/model;
- realtime LLM/model;
- TTS voice/provider;
- endpointing settings;
- streaming strategy.

Test:

- p50/p95 greeting latency;
- p50/p95 turn first audio;
- p50/p95 barge-in stop;
- transcript accuracy on business terms/names;
- phone number accuracy;
- tool-call latency;
- subjective naturalness score;
- cost/minute.

Select based on whole caller experience, not one vendor benchmark.

---

# 29. ACCEPTANCE GATE

Before prospect pilot:

- no repeated 3–5 second ordinary-turn gaps;
- p95 first-audio target met or explicitly approved exception;
- interruption works reliably;
- DNC interruption passes 100%;
- phone number confirmation sounds natural;
- tool success/failure language accurate;
- human reviewers can complete multiple calls without talking over agent due to lag.
