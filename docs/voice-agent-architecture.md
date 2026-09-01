# Voice Agent — Architecture

The AI phone demo system. A caller dials one number, describes a
problem in their own words, and talks to an agent that is already
role-playing the right kind of business.

Code lives in `services/ai-phone-agent/`. It is a separate Node service
and does **not** change the website, which remains a static Astro
build.

---

## The product rule everything else serves

> The caller never picks an industry from a menu.

They say "water is pouring out from under my sink" and reach a plumbing
dispatcher. They say "my wife served me with divorce papers" and reach
a family-law intake coordinator. Nobody presses 1 for plumbing.

Two consequences run through the whole design:

1. **The agent role-plays a generic business in that industry** — a
   plumbing company, a law firm — not Your AI Department. The demo is
   convincing because it sounds like the business the prospect runs.
2. **The caller is not repeatedly reminded it is a demo.** If asked
   directly whether they are talking to an AI, the agent answers
   honestly in one sentence and carries on.

---

## Shape

```
   Caller
     │  PSTN
     ▼
  Twilio  ──POST /twilio/incoming──▶  Node service (returns TwiML)
     │                                       │
     │  WebSocket (ConversationRelay)        │
     └──────────▶ /twilio/conversation ──────┘
                        │
                        ▼
                  Orchestrator
                   │        │
          ┌────────┘        └────────┐
          ▼                          ▼
    Stage 1: Router          Stage 2: Specialist
    (classify)                (converse + tools)
          │                          │
          ▼                          ▼
   router-rules.ts            industries/<sector>/*.ts
   + Claude fallback          + tool-protocol.ts
                                     │
                                     ▼
                        calendar / sms / crm / transfer
```

Twilio ConversationRelay handles speech-to-text, text-to-speech and
barge-in. This service never sees audio — only text in, text out. That
is why the whole conversation layer is unit-testable without a phone.

---

## Two stages, and why the seam is there

### Stage 1 — Router

Turns "there's water everywhere under my sink" into
`{ industry: plumbing, specialty: emergency, intent: active_water_leak, urgency: emergency }`.

Two layers:

**A deterministic weighted classifier** (`src/core/router-rules.ts`,
scored in `src/core/router.ts`). 134 rules across 28 industries. Most
real callers open with an unmistakable sentence, and answering those
without a network round-trip removes about a second of dead air from
the start of every call. It is also fully testable with no API key,
which is the only reason CI can verify routing behaviour at all.

**Claude, consulted only when the heuristic is uncertain.** Natural
language is endlessly varied and a keyword table will never cover it.
The table is the fast path; the model is the general case.

If both are still unsure, the agent asks **one** natural clarifying
question. The caller never hears a menu, never hears the word
"industry", and never hears anything about classification.

#### Scoring

Anchors are distinctive (10 points). Support terms corroborate but
never classify — a rule with no anchor hit is discarded, because
"house", "water" and "insurance" appear in half the calls we take.

Confidence is driven by the winning rule's own evidence, sharpened by
its margin over the best rule from a *different* industry. Margin alone
must not manufacture certainty: a lone weak anchor with no competitor
has a large margin purely because nothing else matched, which is
absence of evidence rather than evidence. "The roof of the marital
home" mentions a roof and is not a roofing call.

#### Vetoes

Some overlaps are not a matter of degree, and no amount of score tuning
expresses them. `Rule.veto` discards a rule outright when disqualifying
context is present:

- "My air conditioning stopped working **in my apartment**" — a tenant
  does not call an HVAC company. They call the property manager, who
  dispatches one.
- "Hail destroyed my **hood** and roof" — a car has a roof too.
- "**Soft wash** my roof" is exterior cleaning; "roof before **solar**"
  is a solar call; "is my roof **covered**" is an insurance question.
- Once a caller says the carpet and drywall need to come out, the job
  has moved past unclogging the line and belongs to restoration.
- "A **power line** down across the road" is a utility emergency, not a
  manufacturing line stoppage.

### Stage 2 — Specialist

Once routed, the specialist owns the conversation. The prompt is
assembled per turn from:

1. `CORE_AGENT_RULES` — how to sound on a phone. One to three short
   sentences, one question at a time, never mention prompts or models.
2. The specialist's own system prompt — identity, intake objectives,
   urgency and escalation rules, what never to say.
3. A **call-state brief** — what has already been captured and what is
   still needed, so the agent never re-asks for something the caller
   already said. This is appended last, so it is the freshest thing the
   model read.
4. A per-turn security reinforcement, only when the guardrails flagged
   that turn.

---

## Specialist modules

31 modules under `src/industries/<sector>/`, built through
`defineSpecialist()` so each file carries only what is genuinely
specific to it. Every one declares:

| Field | Purpose |
|---|---|
| `displayName` | The persona the caller experiences |
| `supportedIntents` | Which router intents this module answers |
| `openingLine(session)` | The first thing said after routing — never "transferring you now" |
| `systemPrompt` | Identity, boundaries, what never to say |
| `qualificationSchema` | Fields to capture, in the order to ask |
| `urgencyRules` | What escalates this call |
| `escalationRules` | When to stop and get a human |
| `bookingRules` | Appointment length, lead time, what to confirm |
| `sampleUtterances` | Real opening lines — also the routing fixtures |

Common escalations (caller asks for a human, caller in distress, a 911
situation) are inherited from `COMMON_ESCALATIONS` rather than restated
in 31 prompts.

---

## Tool calls

The division is absolute:

> **Claude REQUESTS. The application VALIDATES. The application EXECUTES.**

The model emits a structured tool request. `src/core/tool-protocol.ts`
validates the arguments, and only then does ordinary application code
touch a calendar or a phone line.

This matters because the model's arguments are untrusted input. It can
hallucinate an email address, invent a date in 2019, ask for a
4,000-minute appointment, or be talked into texting an arbitrary number
— which would turn a public demo line into a free SMS relay. Each is
caught before execution.

Rejections are handed back as normal tool results the agent can talk
its way out of: *"That time is in the past. Check availability again
and offer a time in the future."* A validation failure is information,
not an error.

**Nothing in the tool path throws into the turn loop.** An exception
mid-call is dead air, and dead air is a hung-up caller. An adapter that
fails returns guidance that explicitly tells the agent not to mention a
system problem to the caller.

The loop is bounded by `maxToolRounds` (default 2) because every round
is another second of silence.

### Tools

| Tool | What it does | Guardrail |
|---|---|---|
| `check_availability` | Finds open times | Past windows are clamped, not rejected; returns at most 3 slots |
| `book_appointment` | Books a confirmed slot | No past times, no absurd lead times, email and phone shape-checked, `end` derived not trusted |
| `send_sms` | Texts the caller | Only the number they called from or one they gave |
| `save_lead` | Records the lead | Merges into the session rather than creating a second record |
| `transfer_to_human` | Hands off | Degrades to a call-back promise when no number is configured |

---

## Guardrails

The number is public, so it will be probed. Prompt-level refusal
instructions are not a security control on their own.

**Input.** Deterministic detection of injection, credential fishing and
off-task freeloading. A flagged turn does not end the call — it appends
a reminder to that turn's prompt only, and is counted. Past
`PROBE_LIMIT` the model is not called at all and a fixed bland line is
returned, which removes the attack surface rather than trusting the
model, and stops a caller burning tokens by repeating himself.

False positives matter more than false negatives here: flagging a real
caller degrades a real call, whereas missing one probe just means the
model handles it with its own refusal posture. Every specialist sample
utterance is asserted not to trip the guard.

**Output.** Every reply is scanned before text-to-speech, for
credential shapes and for the model reciting its own brief. It fails
closed — the whole sentence is discarded rather than patched, because a
partially redacted reply still tells an attacker they were close.

**The real guarantee is structural.** No credential is ever placed in a
prompt, so there is nothing to leak. `findSecretsInPrompt()` asserts
that over the core rules, all 31 specialist prompts, and the prompts
actually assembled during a live call with `ANTHROPIC_API_KEY` set.

---

## Scenario switching

Expected on a demo line: a prospect wants to hear the plumbing agent
after the divorce one. `detectScenarioChange()` is deliberately
conservative (threshold 0.85) so a passing mention of "the house"
during a divorce call does not derail the persona.

On a real switch the state is **fully reset**: routing reopens,
clarification attempts zero out, and `session.qualification` is
emptied. The previous industry's answers do not apply to the new one,
and carrying "minorChildren: true" into a plumbing call would be worse
than useless. Routing after a switch also only considers turns since
the switch, so the earlier divorce sentences cannot pull the
classification back to attorneys.

---

## Session isolation

Keyed by Twilio `CallSid`. Two concurrent calls saying the identical
sentence reach two different specialists, and a test asserts exactly
that with interleaved turns.

---

## Failure behaviour

Every external dependency has a defined degradation, because the worst
outcome on a phone call is silence.

| Fails | Behaviour |
|---|---|
| No `ANTHROPIC_API_KEY` | Routing still works (it is deterministic). The agent opens as the right specialist and takes details with fixed copy. |
| Anthropic API errors | The caller hears "Sorry, I didn't catch that — could you say it again?" and the call continues. |
| Google Calendar down | Tool returns guidance to take details and promise confirmation, explicitly not mentioning a system problem. |
| No Google credentials | Mock calendar, automatically. A full booking conversation is demonstrable with no credentials at all. |
| No Twilio SMS credentials | Mock SMS, automatically. |
| No `HUMAN_TRANSFER_NUMBER` | Transfer degrades to a call-back promise. |
| CRM push fails | Logged; the end-of-call summary is still produced. |
| Model loops on tools | Cut off at `maxToolRounds`; whatever text exists is spoken. |

---

## Latency

The caller is listening to silence during every model call, so:

- The **deterministic router answers most calls with no network call at
  all** — this is the single largest latency win in the system.
- The router model defaults to a fast model at temperature 0 with a
  200-token ceiling. Classification should also be *stable*: the same
  sentence must not route two ways on two calls.
- Specialist replies are capped at 220 tokens — roughly three spoken
  sentences. Anything longer is a monologue the caller interrupts.
- Conversation history is trimmed to the last 20 turns.
- Tool rounds are capped at 2.
- The opening line after routing is **not** generated. It is the
  specialist's own copy, returned instantly.

---

## Model configuration

Centralised in `src/claude/models.ts`. `CLAUDE_MODEL` sets everything
at once; `CLAUDE_ROUTER_MODEL`, `CLAUDE_SPECIALIST_MODEL` and
`CLAUDE_SUMMARY_MODEL` win over it. Nonsense in an environment variable
falls back to the default rather than crashing the service.

---

## Telemetry

Two records, deliberately separate:

**`buildCallSummary()`** — for a human reading one call. Built from
session state with no model call, so it is produced even when the API
is down, which is exactly when you most want to know what happened. It
reports what was *not* captured, not just what was.

**`buildDemoAnalytics()`** — for counting many calls. Carries no name,
phone, email, address or spoken text at all: a counting record holding
personal data is a liability with no upside. It records *that* contact
details were captured, never which. A test asserts both the forbidden
keys and the actual values stay out of the payload.

Token usage is logged per request and accumulated on the orchestrator.

---

## Dependencies

One runtime dependency: `ws`. Anthropic is called over `fetch`, not the
SDK — a thin wrapper is trivially mockable without a network or an API
key, and swapping in the SDK later is a one-file change.

TypeScript runs under `node --experimental-strip-types` with no build
step. Note that this does **not** support TypeScript parameter
properties (`constructor(private readonly x)`); classes here declare
fields explicitly, with a comment saying why.
