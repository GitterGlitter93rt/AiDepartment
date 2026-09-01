# AI Phone Demo Line

One phone number that becomes the right industry intake agent, automatically, with no menu.

A prospect calls, says what's going on in their own words, and the line responds as the appropriate specialist — a family-law intake coordinator, a plumbing dispatcher, a roofing scheduler — so they experience what an AI phone agent would feel like *for their business*.

```
Caller ──▶ Twilio number ──▶ POST /voice ──▶ TwiML <ConversationRelay>
                                                    │
                          speech ⇄ text over WS ────┤
                                                    ▼
                                            WS /relay ──▶ Router (stage 1)
                                                            │
                                                            ▼
                                                    Specialist (stage 2) ──▶ Claude
```

---

## 0. Public surface

| Path | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness + redacted config snapshot |
| `/twilio/incoming` | POST | Twilio inbound-call webhook → ConversationRelay TwiML |
| `/twilio/status` | POST | Twilio call-status callback |
| `/twilio/conversation` | WS | ConversationRelay socket: transcripts in, speech out |

Production: `https://voice.youraidepartment.ai` · **[DEPLOYMENT.md](./DEPLOYMENT.md)** is the VPS runbook.

The service binds `127.0.0.1:3001` and is reached only through Nginx. The Node port is never exposed publicly.

## 1. Architecture

| Path | Role |
|---|---|
| `src/server.ts` | HTTP + WebSocket entry point |
| `src/core/router.ts` | **Stage 1** — decides industry / specialty / intent / urgency |
| `src/core/orchestrator.ts` | Turn control; routes, then hands to a specialist |
| `src/core/session.ts` | Per-call state, keyed by Twilio `CallSid` |
| `src/industries/*` | **Stage 2** — one module per specialist brain |
| `src/tools/*` | Calendar, SMS, transfer, CRM — each with a mock |
| `src/twilio/*` | TwiML generation + ConversationRelay protocol |
| `src/claude/client.ts` | Anthropic Messages API over `fetch` |
| `src/prompts/*` | Router prompt + shared voice rules |

**One runtime dependency: `ws`.** Anthropic, Twilio and Google are reached with `fetch`, which keeps the install small and makes every piece of logic unit-testable without a network or an API key.

**This is a separate service, not part of the website.** The Astro site is `output: 'static'` and ships as flat files to SiteGround; a voice agent needs a long-lived process with a WebSocket. Deploy this independently.

## 2. How routing works

Two layers, for latency and testability:

1. **Deterministic classifier** (`classifyHeuristic`). A weighted keyword table scores every rule. Confidence comes mostly from the *margin* over the best rule in a different industry — which is how "my roof is leaking" resolves to roofing rather than plumbing when both match "leak". Clear cases route with zero network round-trips, removing about a second of dead air at the start of every call.
2. **Claude**, consulted only when the heuristic is unsure. Returns strict JSON; anything malformed or out-of-vocabulary is rejected rather than trusted.

If both are unsure, the agent asks **one** natural clarifying question ("is this about a repair, a legal matter, buying or selling, or something else?") and re-routes using *all* the caller's turns together. After two attempts it stops interrogating.

Routing is one-way: once committed, the agent never re-classifies mid-call, which would make it lurch between personas.

## 3. How specialist brains work

Each module implements `IndustryModule`:

- `matches()` — which router outputs it claims
- `openingLine()` — the first thing said after routing. This *is* the handoff; the caller never hears "transferring you to the plumbing agent"
- `systemPrompt` — domain knowledge, intake plan, and boundaries
- `fields` — ordered intake goals, used to steer and to measure coverage

At each turn the orchestrator builds: shared voice rules + the specialist prompt + a **call-state brief** listing what is already known, so the agent never re-asks something the caller already said.

The **family-law/divorce** brain is the deepest: it carries the legal-advice boundary (no advice, no predicted outcomes, no telling them what to do about the house or the children) and a safety path that breaks off intake and points to 911 and domestic-violence resources when a caller describes danger.

## 4. Adding a new industry

1. Create `src/industries/<name>.ts` implementing `IndustryModule`.
2. Register it in `src/industries/index.ts`.
3. Add keyword rules to `RULES` in `src/core/router.ts`.
4. Add a routing test to `tests/router.test.ts`.

Nothing else changes — orchestrator, sessions, tools and transport are all industry-agnostic.

## 5. Run locally

```bash
cd services/ai-phone-agent
npm install
cp .env.example .env        # works with everything blank
npm run dev                 # http://127.0.0.1:3001
```

```bash
curl localhost:3001/health
curl -X POST localhost:3001/twilio/incoming -d "CallSid=CA1&From=%2B15551234567&To=%2B15559998888"
```

`npm test` · `npm run typecheck`

With **no credentials at all** the service still boots, routes correctly, and runs calendar/SMS in mock mode. Add `ANTHROPIC_API_KEY` for the specialist to actually converse.

## 6. Expose it to Twilio

```bash
ngrok http 3001
# or: cloudflared tunnel --url http://localhost:3001
```

Take the HTTPS forwarding URL and set `PUBLIC_BASE_URL` in `.env`:

```
PUBLIC_BASE_URL=https://your-id.ngrok.app
```

`TWILIO_CONVERSATION_RELAY_URL` is derived automatically (`wss://your-id.ngrok.app/twilio/conversation`), so that single line is usually all you need. Restart after changing it.

## 7. Twilio console configuration

Phone Numbers → Manage → Active numbers → *your number* → **Voice Configuration**:

| Setting | Value |
|---|---|
| A call comes in | **Webhook** |
| URL | `https://your-id.ngrok.app/twilio/incoming` |
| HTTP method | **POST** |
| Call status changes | `https://your-id.ngrok.app/twilio/status` (POST) — optional but recommended |

ConversationRelay must be enabled on the account (Twilio Console → Voice → Settings). It is generally available but region-restricted; if the TwiML errors, check the account's voice region.

## 8. Environment variables

See `.env.example`. Only `ANTHROPIC_API_KEY` and `PUBLIC_BASE_URL` are needed for a live demo call. Everything else has a working default or a mock.

## 9. Testing without Google Calendar or Twilio SMS credentials

Both default to mock and **fail safe**: even with `MOCK_SMS_MODE=false`, the real path is used only if the matching credentials are actually present. A misconfigured deploy sends nothing rather than sending wrongly.

- Mock calendar offers deterministic weekday business-hours slots and records bookings in memory.
- Mock SMS records the message, always with the `Reply STOP to opt out.` line.
- `/health` reports which mode each tool is in.

## 10. Turning mocks off for production

1. Google Calendar: set `GOOGLE_CALENDAR_ENABLED=true` plus `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`, then `MOCK_CALENDAR_MODE=false`. Attendee invitations are sent by Google, which is why this service has no mail server.
2. SMS: set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, then `MOCK_SMS_MODE=false`.
3. Confirm on `/health` that both read `google-live` / `twilio-live`.

## 11. Security

**Implemented:**

- **Twilio signature validation** on `/twilio/incoming` and `/twilio/status` (HMAC-SHA1, constant-time compare). On by default when `NODE_ENV=production`; requires `TWILIO_AUTH_TOKEN`. Fails closed — no token means no validation *and* no pretence of it, surfaced on `/health`.
- **Rate limiting** — 120 requests/min per IP, fixed window, swept so the map cannot grow unbounded.
- **Body size cap** — 64 KB on HTTP, `maxPayload` on the WebSocket.
- **Loopback binding** — the Node port is not publicly reachable.
- **X-Forwarded-For trusted only behind a proxy**, so a direct client cannot spoof its IP to evade limits.
- **No secrets in source or logs** — redacted by key name and by pattern; phone numbers masked to the last four digits.
- **Graceful shutdown** so a restart does not cut a live call.
- systemd hardening: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, restricted address families, 1 GB memory cap.

**Future improvements:**

- Per-`CallSid` concurrency cap (a single caller cannot currently open unlimited sockets).
- WebSocket origin/handshake validation — ConversationRelay does not sign the socket, so the `CallSid` in `setup` is trusted; pairing it against a recently-seen webhook would close that gap.
- Redis-backed sessions so a restart cannot drop in-flight calls.
- Anthropic spend cap / circuit breaker.

## 12. Logging

One JSON line per event: `call.started`, `router.decision`, `specialist.selected`, `field.captured`, `tool.requested`, `tool.completed`, `tool.failed`, `call.ended`.

Events: `service.started`, `service.stopping`, `service.stopped`, `call.started`, `router.decision`, `specialist.selected`, `tool.requested`, `tool.completed`, `tool.failed`, `llm.failed`, `error`, `call.ended`.

Secrets are redacted by key name *and* by pattern. Phone numbers are masked to the last four digits. **Transcripts are off by default** (`LOG_TRANSCRIPTS=true` to enable) because a call transcript contains everything the caller said about their divorce, their address and their phone number.


## 13. Process management

`deploy/` contains ready-to-use configs:

| File | Purpose |
|---|---|
| `yad-voice-agent.service` | **systemd unit (recommended)** |
| `nginx-voice.youraidepartment.ai.conf` | Nginx server block, HTTP + WSS |
| `ecosystem.config.cjs` | PM2 alternative — use one or the other, never both |
| `logrotate-yad-voice-agent` | Log rotation (PM2 only; journald handles it under systemd) |

systemd is recommended: already installed, starts on boot without `pm2 startup`/`pm2 save`, and journald provides log handling and rotation with no extra runtime.
