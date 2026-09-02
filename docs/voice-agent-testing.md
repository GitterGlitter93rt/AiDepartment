# Voice Agent — Testing

```bash
cd services/ai-phone-agent
npm test                              # 763 tests — deterministic, no API key
npm run typecheck
npm run voice:simulate -- --check     # 94 scenarios through the orchestrator
npm run voice:coverage                # website ↔ agent industry drift
npm run voice:quality                 # per-industry audit
npm run voice:eval -- --priority      # LIVE MODEL — costs money, opt-in
```

**Three layers, deliberately separate.**

| Layer | Needs a key | What it proves |
|---|---|---|
| `npm test` | no | Structure, routing, guardrails, state, tools, the rubric itself |
| `voice:simulate` | no | The orchestrator end to end, with fallback copy |
| `voice:eval` | **yes** | What the model actually SAYS |

The first two are the CI story: deterministic, free, and fast. The
third is the one that answers "is the brain any good", and it is opt-in
because it costs real requests.

No API key, no network, no phone. Everything below runs offline, which
is the point: a conversation system whose behaviour can only be checked
by calling it is a conversation system nobody checks.

---

## What is where

| File | Tests | Covers |
|---|---|---|
| `rubric.test.ts` | 42 | The evaluation harness itself — see below |
| `extraction.test.ts` | 33 | Phone/email/ZIP capture, corrections, capture_details |
| `failure-modes.test.ts` | 23 | Every external dependency failing |
| `routing-coverage.test.ts` | 324 | All 28 industries: reachability, sample utterances, natural variants, ambiguity, the safety contract |
| `guardrails.test.ts` | 46 | Injection, off-task, false positives, output scanning, secret-free prompts |
| `tools-and-telemetry.test.ts` | 28 | Tool validation and execution, the turn loop, summaries, analytics, model config |
| `session-and-tools.test.ts` | 26 | Session store, calendar, SMS, transfer, CRM, log redaction |
| `router.test.ts` | 25 | Acceptance cases, disambiguation, JSON parsing, LLM fallback |
| `production.test.ts` | 25 | Signature validation, rate limiting, config, path contracts, scenario switching |
| `conversation.test.ts` | 16 | End-to-end turns, persona loading, state brief, concurrency, degradation |

---

## The properties that actually matter

Most tests assert a specific behaviour. A few assert a *property* over
the whole system, and those are the ones that catch regressions nobody
anticipated.

### 1. The safety contract

> No utterance may route **confidently** (≥ 0.8) into the wrong industry.

Checked across every specialist's sample utterances and every natural
variant.

This is the strongest assertion in the suite, and it is asymmetric on
purpose. A confident misroute puts the caller in front of an agent
role-playing the wrong business, and there is no graceful recovery from
that — the agent will confidently ask a plumbing question about a
divorce. Admitting uncertainty and asking one clarifying question is a
normal call. So the suite is much harsher about wrong-and-sure than
about unsure.

### 2. Genuine ambiguity is admitted, not guessed at

Nine real opening lines are asserted to stay *below* the confidence
threshold:

- "Someone rear-ended me in a parking lot." — injury claim or body shop
- "Where is my order?" — consumer retail or B2B manufacturing
- "The lock on my front door is broken." — locksmith, property manager, handyman
- "I have a question about my bill." — every industry bills someone

These are not gaps to be closed. Forcing a keyword table to pick one is
how you get a confident misroute.

### 3. Every industry is reachable

Three structural tests: every taxonomy ID has a specialist, every ID
has at least one routing rule, and every specialist's own sample
utterances route to its own industry. A specialist that exists but can
never be routed to is dead code with a nice prompt.

### 4. No credential is ever in a prompt

Asserted over the core rules, all 31 specialist prompts, and the
prompts actually assembled during a live two-turn call with
`ANTHROPIC_API_KEY` set in the environment. This is the structural
guarantee that makes the output scanner a backstop rather than the
primary control.

### 5. Analytics carry no personal data

Both the forbidden *keys* and the actual *values* are asserted absent
from the payload — a test that only checks key names passes happily
while a name sits in a summary string.

### 6. Guardrail false positives

Every specialist sample utterance is asserted **not** to trip the
guardrail. Flagging a real caller degrades a real call; missing one
probe just means the model handles it with its own refusal posture.

---

## Natural-caller phrasing

`routing-coverage.test.ts` carries 95 utterances written the way
people actually talk, because nobody calls a plumber and says "I
require plumbing services":

```
"uhh yeah so theres water like everywhere under my sink man"
"aint got no hot water since this morning"
"my ac quit and its 96 degrees in the house"
"i think we got bedbugs, im covered in bites"
"somebody backed into my bumper in a parking lot"
"wheres my order, it was supposed to be here tuesday"
```

Missing punctuation, missing apostrophes, filler, slang, and the
run-on sentences a speech-to-text engine produces. If a change makes
these fail, it made the router worse regardless of what the tidy test
cases say.

---

## Testing without credentials

Three stubs, each for a different job:

**`createStubClaudeClient(reply)`** — a fixed reply, or a function of
the request. For simple "does it call the model" checks.

**`createRecordingClaudeClient()`** — records every request and exposes
`lastSystem()`. **Use this to assert on the assembled system prompt.**
The obvious approach — have the stub echo the prompt back as its reply
— does not work, because the output guardrail correctly blocks a reply
that recites the agent's own instructions. Reading the prompt
out-of-band is also closer to what such a test actually means.

**`createScriptedClaudeClient([...])`** — plays a sequence of full
responses, so a tool exchange runs end to end: first response asks for
a tool, second speaks the result.

Tools have mock implementations by default (`createMockCalendar`,
`createMockSms`), so a full booking conversation is exercisable with no
Google credentials. The mock calendar is deterministic on purpose.

---

## Adding a routing test

When a caller says something that routes wrong, add the sentence
**verbatim** to `NATURAL_VARIANTS` before touching the rules:

```ts
const NATURAL_VARIANTS: [string, Industry][] = [
  ["the thing under my sink is spraying everywhere", 'plumbing'],
];
```

Then fix the rule. Two traps:

**Do not widen an anchor to make one sentence pass.** Broad anchors
steal calls from other industries, and the safety contract will catch
it — but only if you run the whole suite, so run the whole suite.

**Consider a veto instead.** If the sentence contains a word that
*disqualifies* another industry rather than qualifying this one, that
is what `Rule.veto` is for. "in my apartment" does not make a call
more plumbing-ish; it makes it not-HVAC.

---

## Testing the tester

`tests/rubric.test.ts` exists because **an evaluator that passes
everything is worse than no evaluator** — it produces a green report
and false confidence.

It feeds the rubric conversations that are deliberately wrong and
asserts it notices: a claimed booking with no successful tool call, an
invented service-call fee, a claim of being human, three questions in
one breath, the same question asked twice, a recited prompt. Then it
feeds good conversations and asserts it stays quiet — because a scorer
that flags "I can get that booked for you" as a false claim is noise
nobody reads.

Writing those tests found three real scorer bugs:

- the memory check flagged an agent for asking a name on turn two that
  it received on turn three
- duplicate detection missed "what's the address we'd be coming to?"
  versus "what is the address for the visit?", which share almost no
  words and are obviously the same question — it now keys on the
  question's SUBJECT
- the emergency scorer demanded urgency *language* when acting urgently
  counts for more: an agent whose first sentence is "is the water shut
  off?" is handling it correctly, and one that announces "this is
  urgent" then asks for an email address is not

Two end-to-end tests drive a scripted bad agent and a scripted good one
through the real orchestrator, so the wiring is exercised without
spending anything.

## What is not tested here

**Live Twilio behaviour.** Speech recognition quality, barge-in timing,
and audio latency are Twilio's, and are verified by placing a call —
see `docs/voice-agent-twilio-setup.md` §5.

**Real Anthropic responses.** The tests assert what the system does
with a response, not what the model says. Prompt quality is verified by
placing calls.

**Google Calendar against a real calendar.** The adapter's HTTP shape
is tested with a stub `fetch`; the OAuth exchange is not exercised
against Google.

These are the right things to leave out. Each needs a credential or a
phone, and putting them in the suite would mean the suite stops being
run.
