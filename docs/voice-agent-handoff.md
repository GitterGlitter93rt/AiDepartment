# Voice Agent — Session Handoff

**Read this first.** It assumes you know nothing about the conversation
that produced this code, and it is written so a fresh Claude Code
session can pick the work up cold.

| | |
|---|---|
| Branch | `feature/twilio-ai-phone-agent` |
| Latest commit | see `git log -1` |
| Pushed | **NO** — 12+ commits ahead. See [External blockers](#external-blockers) |
| Service tests | **706 passing, 0 failing** |
| Service typecheck | clean (`npm run typecheck`) |
| Demo scenarios | **94/94 clean** (`npm run voice:simulate -- --check`) |
| Industry coverage | complete (`npm run voice:coverage`) |
| Industry quality | 7 STRONG / 21 GOOD / **0 NEEDS_REFINEMENT** |
| Website build | clean (125 pages) |
| Website tests | 411 passing |
| `astro check` | 0 errors, 0 warnings |
| Source | 77 files, ~11,600 lines under `services/ai-phone-agent/src/` |

### By the numbers

| | |
|---|---|
| Website industries | 28 |
| Demo industries | 29 (28 + Pressure Washing) |
| Specialists | 31 |
| Distinct intents | 254 |
| Routing rules | 139 |
| Knowledge entries | 192 industry-specific + 15 universal |
| Demo scenarios | 94 |

**Never merge to `main`. Never deploy. Never change DNS, Cloudflare, or
Twilio production config without being asked.**

---

## Project purpose

One public phone number that demonstrates what an AI receptionist would
do *for the caller's own business*.

A prospect rings, describes a problem in their own words, and reaches an
agent already role-playing the right kind of business — a plumbing
dispatcher, a family-law intake coordinator, a roofing scheduler.

### Product decisions that everything else serves

1. **One demo number.** No IVR, no menu, no "press 1 for plumbing".
2. **The caller never selects an industry.** They describe a situation
   and the router infers industry, specialty, intent and urgency.
3. **The agent role-plays a generic business in that trade** — a
   plumbing company — **not Your AI Department.** The demo is
   convincing because it sounds like the business the prospect runs.
4. **It does not advertise Your AI Department during the scenario.**
   The demo *is* the pitch.
5. **The caller may switch industries mid-call** and the previous
   scenario's state is discarded. Prospects want to hear the plumbing
   agent after the divorce one.
6. **It never pretends to be human.** Asked directly, it says it is an
   AI assistant in one sentence and carries on.
7. **It never invents business facts.** No prices, hours, warranties,
   licences, or service areas it was not given. This is the single most
   important behavioural rule in the system.

---

## Current architecture

```
   Caller
     │  PSTN
     ▼
  Twilio  ──POST /twilio/incoming──▶  Node service returns TwiML
     │                                       │
     │  WebSocket (ConversationRelay)        │
     └──────────▶ /twilio/conversation ──────┘
                        │
                        ▼
                  Orchestrator  ── guardrails (in/out)
                   │        │
          ┌────────┘        └────────┐
          ▼                          ▼
    Stage 1: Router          Stage 2: Specialist
    router-rules.ts           industries/<sector>/*.ts
    + Claude fallback         + knowledge/  (what it may say)
                              + business/   (what it knows)
                              + tool-protocol.ts
                                     │
                                     ▼
                        calendar / sms / crm / transfer
     │
     ▼
  /twilio/relay-action ──▶ <Dial> for a warm transfer, else <Hangup>
```

Twilio ConversationRelay handles speech-to-text, text-to-speech and
barge-in. **The service never touches audio — only text in, text out.**
That is why the whole conversation layer is unit-testable without a
phone.

---

## Current file tree

```
services/ai-phone-agent/
├── src/
│   ├── server.ts                 HTTP + WebSocket, routes, endCall
│   ├── config.ts                 env → typed Config, redacted snapshot
│   ├── logger.ts                 structured JSON, secret redaction
│   ├── business/
│   │   └── profile.ts            BusinessProfile + demoProfile + renderer
│   ├── claude/
│   │   ├── client.ts             fetch wrapper, tool_use, usage; 3 stubs
│   │   └── models.ts             per-role model config (router/specialist/summary)
│   ├── core/
│   │   ├── taxonomy.ts           28 INDUSTRY_IDS + labels  ← source of truth
│   │   ├── types.ts              Session, RouteDecision, ContactRecord
│   │   ├── session.ts            SessionStore keyed by CallSid
│   │   ├── router.ts             classifyHeuristic, route, detectScenarioChange
│   │   ├── router-rules.ts       136 weighted rules, anchors/support/veto
│   │   ├── orchestrator.ts       turn loop, prompt assembly, tool rounds
│   │   ├── guardrails.ts         injection detection, output scanning
│   │   ├── tool-protocol.ts      TOOL_SCHEMAS, validate, execute
│   │   ├── call-summary.ts       human summary + anonymous analytics
│   │   ├── extract.ts            deterministic phone/email/ZIP capture
│   │   └── when.ts               "Thursday morning" → a real window
│   ├── knowledge/                WHAT THE AGENT MAY SAY
│   │   ├── types.ts              KnowledgeEntry, AnswerSource, matching
│   │   ├── index.ts              registry: specialist/industry → bank
│   │   ├── universal.ts          15 entries every business needs
│   │   ├── plumbing.ts roofing.ts real-estate.ts pressure-washing.ts
│   │   ├── attorneys-family-law.ts  attorneys-other.ts
│   │   ├── trades.ts             hvac, electrical, pest, garage, pool,
│   │   │                         screen, landscaping, restoration,
│   │   │                         construction, collision, auto dealer
│   │   └── professional.ts       property mgmt, healthcare, insurance,
│   │                             financial, professional services,
│   │                             manufacturing, logistics, energy,
│   │                             defense, solar, fiber, ecommerce
│   ├── industries/               WHO THE AGENT IS
│   │   ├── types.ts define.ts index.ts (REGISTRY, selectSpecialist)
│   │   ├── attorneys/            family-law, personal-injury,
│   │   │                         criminal-defense, probate-estate
│   │   ├── home-services/        12 modules
│   │   ├── property/ automotive/ regulated/ enterprise/ growth/
│   ├── prompts/
│   │   ├── core-agent.ts         phone style, tool truthfulness, AI honesty
│   │   └── router.ts             classification prompt
│   ├── sim/
│   │   ├── scenarios.ts          94 scenarios + NEVER_SAY
│   │   ├── run.ts                npm run voice:simulate
│   │   ├── coverage.ts           npm run voice:coverage
│   │   └── quality.ts            npm run voice:quality
│   ├── tools/                    calendar, sms, transfer, crm, index
│   ├── twilio/                   twiml, relay, signature
│   └── http/                     guards (rate limit, body cap), paths
├── tests/                        9 files, 653 tests
├── deploy/                       systemd, nginx, pm2, logrotate
├── DEPLOYMENT.md README.md ARCHITECTURE.md .env.example
└── package.json tsconfig.json
```

---

## Twilio flow

1. Caller dials the number.
2. Twilio POSTs `/twilio/incoming` (form-encoded, `X-Twilio-Signature`).
3. Service validates the signature, creates a session keyed by
   `CallSid`, and returns TwiML:
   `<Connect action="…/twilio/relay-action"><ConversationRelay url="wss://…/twilio/conversation" …/></Connect>`
4. Twilio opens the WebSocket and speaks `welcomeGreeting`.
5. Twilio POSTs `/twilio/status` on call completion → end-of-call
   summary + CRM push.
6. When the relay session ends, Twilio POSTs `/twilio/relay-action` →
   `<Dial>` if a transfer is pending, otherwise `<Hangup>`.

## ConversationRelay flow

Inbound message types handled in `server.ts`:

| Type | Handling |
|---|---|
| `setup` | Records `callSid`, `from`, `to`. Sends nothing — the TwiML greeting is already playing. |
| `prompt` | `voicePrompt` → orchestrator → reply chunked by `chunkForSpeech` and sent as `text` frames. |
| `interrupt` | Caller talked over the agent. Relay already stopped playback; nothing to undo. |
| `error` | Logged. |

Outbound: `{type:'text', token, last}` and `{type:'end', handoffData}`.
The `end` frame is sent **after** the final text chunk, so a transfer
never clips the agent's closing sentence.

## Claude flow

Per turn, `Orchestrator.specialistTurn` assembles:

1. `CORE_AGENT_RULES` — phone style, tool truthfulness, AI honesty,
   difficult callers.
2. The specialist's `systemPrompt` — identity, boundaries, what never
   to say.
3. `renderBusinessProfile(profile)` — **what it knows AND what it does
   not know.** The unknown list matters more.
4. `stateBrief` — what has been captured, what is still needed.
5. Matched knowledge for what the caller just said (≤3 entries).
6. A security reinforcement, only on a flagged turn.

Long calls also carry a **rolling summary** (`session.summary`),
generated AFTER a reply is sent so it costs the caller no silence,
using the cheap summary model, refreshed every ~8 turns. `contact` and
`qualification` already survive history trimming; the summary covers
narrative that never became a field.

Then `runTurn` loops: `claude.send({tools})` → if `tool_use`, validate +
execute + return `tool_result` → repeat, bounded by `maxToolRounds`
(default 2).

---

## Router design

Two layers:

1. **Deterministic weighted classifier** (`router-rules.ts`, scored in
   `router.ts`). 136 rules over 28 industries. Answers most calls with
   no network round-trip — the largest latency win in the system, and
   the only reason routing is testable without an API key.
2. **Claude**, consulted only when the heuristic is uncertain.

Still unsure → **one** natural clarifying question. Never a menu, never
the word "industry", never a confidence number spoken aloud.

### Scoring

- **anchor** hit = 10 points. Distinctive.
- **support** hit = 2 points. Corroborating only — **a rule with zero
  anchor hits is discarded**, because "house", "water" and "insurance"
  appear in half of all calls.
- **veto** — if any veto regex matches, the rule is dropped outright.

Confidence comes from the winning rule's own evidence, sharpened by its
margin over the best rule from a *different* industry. Margin alone must
not manufacture certainty: a lone weak anchor with no competitor has a
big margin only because nothing else matched.

### Vetoes that matter

| Situation | Goes to | Not |
|---|---|---|
| "…in my apartment" | property management | HVAC / electrical |
| hail on a "hood" | collision repair | roofing |
| "soft wash my roof" | pressure washing | roofing |
| "roof before solar" | solar | roofing |
| "is my roof covered" | insurance | roofing |
| tree ON the house | roofing | landscaping |
| tree near the house | landscaping | roofing |
| carpet/drywall "need to come out" | restoration | plumbing |
| "power line down" | energy | manufacturing |
| water "from the unit above" | property management | roofing |
| inherited **and selling** | real estate | probate |

---

## Specialist registry

`src/industries/index.ts` → `REGISTRY: Record<Industry, IndustrySpecialist[]>`.

**31 specialists across 28 industries.** Only `attorneys` has more than
one (four). Built via `defineSpecialist()`, which supplies
`COMMON_ESCALATIONS` and appends `BOOKING_GUIDANCE` + `DEMO_INTEGRITY`
so 31 prompts do not each restate them.

Each declares: `displayName`, `supportedIntents`, `openingLine(session)`
(returned instantly, never generated), `systemPrompt`,
`qualificationSchema`, `urgencyRules`, `escalationRules`,
`bookingRules`, `sampleUtterances` (≥3, also routing fixtures).

**254 distinct intents.**

---

## Session state

`SessionStore`, in-memory, keyed by `CallSid`. See `core/types.ts`:

```
callSid, from, to, startedAt, endedAt
route: { industry, specialty, intent, urgency, confidence, source }
qualification: Record<string, unknown>
contact: { firstName, lastName, phone, email, company, address, city, state, zip }
turns: { role, text, at }[]
routed: boolean
clarifyAttempts: number
toolCalls: { name, ok, at }[]
probeCount: number          // guardrail hits
scenarioSwitches: number
pendingTransfer?: { reason, summary, target }
```

**Scenario switching:** `detectScenarioChange` (threshold 0.85,
deliberately conservative). On a real switch: `routed=false`,
`clarifyAttempts=0`, `qualification={}`, `scenarioSwitches++`. Routing
after a switch considers only turns since the switch.

---

## Tool architecture

> **Claude REQUESTS. The application VALIDATES. The application EXECUTES.**

Model arguments are untrusted input. Rejections are returned as normal
tool results the agent can talk its way out of. **Nothing in the tool
path throws into the turn loop** — an exception mid-call is dead air.

| Tool | Guardrail |
|---|---|
| `check_availability` | `spokenWhen` ("Thursday morning") beats any window the model computed; past windows clamped; ≤3 slots; each with a speakable `say` string |
| `book_appointment` | no past times, no absurd lead times, email/phone shape-checked, `end` derived not trusted |
| `send_sms` | only the caller's number or one they gave — otherwise the demo line is a free SMS relay |
| `save_lead` | merges into the session, not a second record |
| `transfer_to_human` | records intent; the socket ends the relay after the closing sentence |
| `change_appointment` | RECORDS a reschedule/cancel for a person; explicitly does **not** change anything, and tells the agent not to claim it did |

---

## VPS / Nginx / DNS / Cloudflare

```
youraidepartment.ai        ──▶ Nginx ──▶ static Astro files      (UNCHANGED)
voice.youraidepartment.ai  ──▶ Nginx ──▶ 127.0.0.1:3001 (Node)   (new)
```

- Same 4 CPU / 8 GB Ubuntu VPS. **The website's Nginx block, build and
  deploy flow are untouched.**
- Node binds `127.0.0.1` — **the raw port is never public.**
- `TRUST_PROXY` defaults on in production (behind Nginx). If the port
  were ever exposed directly it must be off, or IPs can be spoofed past
  the rate limiter.
- Nginx must carry the WebSocket upgrade **and** `proxy_read_timeout
  3600s`. Without the long timeout, calls are cut at exactly 60s.
- **DNS:** an A record for `voice` → VPS IP. Nothing else changes.
- **Cloudflare:** the voice subdomain should be **DNS-only (grey
  cloud)** for the first call. Proxying adds a WebSocket hop and its own
  timeouts; get it working end-to-end first, then decide.
- systemd (`deploy/yad-voice-agent.service`) is the supported path; PM2
  provided for shops that standardise on it. `TimeoutStopSec=35` sits
  above `SHUTDOWN_GRACE_MS=25000` so live calls finish.

Runbook: `services/ai-phone-agent/DEPLOYMENT.md`.

---

## Calendar / SMS / transfer plans

| | Now | Live path |
|---|---|---|
| Calendar | deterministic mock, business hours, weekdays, ≤3 slots | Google Calendar adapter (OAuth refresh token). Google emails the invitation, which is why there is no mail server. |
| SMS | mock, logs the payload | Twilio REST. Opt-out text appended. |
| Transfer | `<Dial>` via `/twilio/relay-action` | Needs `HUMAN_TRANSFER_NUMBER`. Without it, degrades to a callback promise. |
| CRM | placeholder that logs the lead shape | Implement `CrmTool.pushLead`; nothing else moves. |

Mocks **fail safe in both directions**: even with `MOCK_*=false`, the
live path is used only when the matching credentials are present.

---

## Security decisions

- Twilio signature validation (HMAC-SHA1, constant-time) on
  `/twilio/incoming`, `/twilio/status`, `/twilio/relay-action`. On by
  default when `NODE_ENV=production`.
- Rate limit 120 req/min/IP; bounded body read.
- **No credential is ever placed in a prompt** — the structural
  guarantee, asserted over core rules, all 31 specialist prompts, and
  prompts assembled during a live call with a key in the environment.
- Input guardrails: injection / credential fishing / off-task. Past
  `PROBE_LIMIT` (3) **the model is not called at all**.
- Output guardrails: fails closed — the whole sentence is discarded, not
  patched, because a partial redaction tells an attacker they were close.
- Logger redacts secret-shaped keys at any depth; phone numbers masked
  to last four.
- `LOG_TRANSCRIPTS=false` by default.
- Analytics carry **no** name, phone, email or spoken text.

---

## Logging design

Structured JSON, one object per line, to stdout (journald collects it).

`service.started/stopping/stopped`, `call.started/ended/summary`,
`router.decision/clarify`, `specialist.selected`, `knowledge.matched`,
`field.captured`, `tool.requested/completed/failed`,
`llm.request/usage/failed`, `guard.flagged/blocked/output_blocked`,
`transcript.caller/agent`, `error`.

Worth alerting on: `guard.output_blocked` (should be rare — if not, a
prompt is inviting the model to recite itself), `llm.failed`,
`tool.failed`.

---

## Environment variables

```
NODE_ENV PORT HOST PUBLIC_BASE_URL TWILIO_CONVERSATION_RELAY_URL
VALIDATE_TWILIO_SIGNATURE TRUST_PROXY SHUTDOWN_GRACE_MS
ANTHROPIC_API_KEY
CLAUDE_MODEL CLAUDE_ROUTER_MODEL CLAUDE_SPECIALIST_MODEL CLAUDE_SUMMARY_MODEL
CLAUDE_ROUTER_MAX_TOKENS CLAUDE_SPECIALIST_MAX_TOKENS CLAUDE_SPECIALIST_TEMPERATURE
ROUTER_CONFIDENCE_THRESHOLD
TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_PHONE_NUMBER
GOOGLE_CALENDAR_ENABLED GOOGLE_CALENDAR_ID GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN
MOCK_CALENDAR_MODE MOCK_SMS_MODE HUMAN_TRANSFER_NUMBER
LOG_TRANSCRIPTS LOG_LEVEL CALL_SUMMARY_ENABLED
```

**The service starts with none of them set.** Routing is deterministic
so it still works; calendar and SMS fall back to mocks.

---

## Industries

**28 on the website**, read from `src/lib/industries.ts` (the registry
that drives nav, footer, the industries index and the assessment
dropdown) — not inferred from page files.

**28 in the agent taxonomy + 1 extra = 29 demo industries.**

> **Pressure Washing is deliberately implemented and deliberately absent
> from the website.** It is an active sales and demo target. This is a
> *website content gap*, not an agent gap. **Do not remove the
> specialist. Do not assume 29 is correct forever — re-run the coverage
> check.**

Full mapping, category by category: `docs/voice-agent-industry-inventory.md`.

**Coverage check:** `npm run voice:coverage` (see below) compares the
website registry against the specialist registry in both directions.

---

## Test / build status

```bash
cd services/ai-phone-agent
npm test              # 585 pass, 0 fail
npm run typecheck     # clean
npm run voice:simulate -- --check     # 60/60 scenarios clean
npm run voice:coverage                # industry coverage report

cd ../..              # website
npm run build         # 125 pages
npm test              # 411 pass
npx astro check       # 0 errors
```

There is **no ESLint config** in this repo. `tsc --noEmit` (service) and
`astro check` (site) are the lint equivalents.

---

## Known limitations

1. **No live-model content assertions in CI.** `npm test` checks
   routing, knowledge matching and structure. Whether the agent *says*
   the right thing needs `voice:simulate` with an API key.
2. **Sessions are in-memory.** One process only. Multiple processes
   would need shared state, since ConversationRelay pins a call to a
   socket.
3. **Extraction covers only high-confidence shapes.** `src/core/extract.ts`
   deterministically captures phone numbers, emails and ZIP codes from
   every caller turn; names and addresses are left to the
   `capture_details` tool, because "I'm at the end of my rope" is not
   an address. If the model does not call the tool, those go
   uncaptured.
4. **Google Calendar OAuth is untested against Google.** The HTTP shape
   is tested with a stub `fetch`.
5. **Pressure Washing has no website page** (deliberate — see the
   inventory).
6. **No multi-tenant routing.** One process, one profile. The seam
   exists (`OrchestratorDeps.resolveProfile`); the plumbing does not.
7. **CRM is a placeholder.** `CrmTool.pushLead` is the one method to
   implement.

---

## External blockers

1. **The feature branch cannot be pushed.** GitHub push protection
   rejects commit `2d4b52b` over a *fake* Twilio Account SID in a test
   fixture (`tests/guardrails.test.ts`). The fixture was fixed in
   `a4a01ce` to build the string at runtime, but the literal remains in
   `2d4b52b`'s history. Removing it needs an interactive rebase, which
   this environment denied.
   **Resolution — the user must choose one:**
   - Click the unblock link GitHub printed (it is not a real credential), or
   - Authorise rewriting the unpushed commits.
2. **No Twilio credentials** → cannot place a real call.
3. **No Anthropic API key in this environment** → cannot evaluate
   conversational quality with the live model.
4. **No Google credentials** → calendar stays mocked.

None of these block further development.

---

## Remaining work

Roughly in value order:

1. **Live-model evaluation** — see NEXT SESSION START HERE.
2. **Multi-tenant profile lookup**, keyed by the called number. The
   seam exists (`OrchestratorDeps.resolveProfile`).
3. **A real CRM adapter** — `CrmTool.pushLead` is the one method.
4. **First live Twilio call** — needs credentials.

---

## NEXT SESSION START HERE

**Exact next task: run the simulator against the live model and read
the transcripts.**

Why first: everything structural is now in place and tested, and
nothing has yet verified that the agent *says* the right thing. The
content assertions in `src/sim/scenarios.ts` — `prohibited`,
`NEVER_SAY`, `expectMentions` — only execute when a real model is
answering. Without a key they are skipped, by design, because with the
fixed fallback copy they would pass trivially and mean nothing.

```bash
cd services/ai-phone-agent
export ANTHROPIC_API_KEY=…
npm run voice:simulate -- --check                # all 94, terse
npm run voice:simulate -- --scenario DIVORCE_01  # one, with transcript
npm run voice:simulate -- --industry plumbing    # one trade
```

**What to look for, in priority order:**

1. **Fabrication.** Any dollar figure, any "we've been in business N
   years", any promised arrival time. `NEVER_SAY` catches the obvious
   shapes; read for the ones it does not.
2. **Refusals that come out preachy.** Declining to predict a custody
   outcome is correct; delivering a paragraph about it is not. These
   should be one sentence and then back to work.
3. **Reply length.** The harness flags anything over 90 words. On a
   phone that is already too long.
4. **Ignored questions.** If a caller asks something and the agent
   carries on with its own question, the knowledge match did not fire —
   check `knowledge.matched` in the logs.
5. **Re-asking.** Anything already in the state brief must never be
   asked again.

Fix by editing the specialist prompt or the knowledge entry's
`guidance`, then re-run. Prompt changes need no test updates unless an
assertion in `tests/conversation.test.ts` names the wording.

**Then, in order:** multi-tenant profile lookup keyed by the called
number, a real CRM adapter, and a first live Twilio call.

**Before stopping, always:**

```bash
cd services/ai-phone-agent
npm test && npm run typecheck
npm run voice:simulate -- --check
npm run voice:coverage
npm run voice:quality -- --write     # regenerates the quality matrix
cd ../.. && npm run build && npm test && npx astro check
```

then update this file, commit, and attempt the push.

## Documentation index

| Document | What it is for |
|---|---|
| `voice-agent-handoff.md` | **this file** — resume from cold |
| `voice-agent-architecture.md` | how and why it is built this way |
| `voice-agent-industry-inventory.md` | website ↔ agent industry mapping |
| `voice-agent-industry-quality.md` | **generated** — per-industry audit |
| `voice-agent-deployment.md` | running it in production |
| `voice-agent-twilio-setup.md` | Twilio console, field by field |
| `voice-agent-testing.md` | what the tests guarantee |
| `voice-agent-demo-script.md` | **for the sales team** |
| `voice-agent-client-onboarding.md` | turning the demo into a client's receptionist |
| `adding-an-industry.md` | the website side and the agent side |
