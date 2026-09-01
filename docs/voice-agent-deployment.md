# Voice Agent — Deployment

How the AI phone demo runs in production, what it needs, and how to
operate it.

**Copy-pasteable server runbook:** `services/ai-phone-agent/DEPLOYMENT.md`.
This document is the "why and what", that one is the "type this".

---

## Topology

The website is **not** touched. It stays a static Astro build served by
Nginx. The voice agent is a separate Node process on a new subdomain.

```
youraidepartment.ai        ──▶ Nginx ──▶ static Astro files      (unchanged)
voice.youraidepartment.ai  ──▶ Nginx ──▶ 127.0.0.1:3001 (Node)   (new)
```

Both live on the same 4 CPU / 8 GB Ubuntu VPS. Nothing about the
website's Nginx server block, build, or deploy flow changes.

**The Node port is never exposed publicly.** It binds `127.0.0.1` and
Nginx proxies to it. This is why `TRUST_PROXY` defaults on in
production: the service is behind a reverse proxy, so
`X-Forwarded-For` is trustworthy. If the port were ever exposed
directly, `TRUST_PROXY` must be off or clients can spoof their IP and
walk straight through the rate limiter.

---

## Requirements

| | |
|---|---|
| Node | **≥ 22.12** — the service runs TypeScript directly via `--experimental-strip-types`, so there is no build step |
| Runtime dependencies | one: `ws` |
| Memory | ~80 MB idle; sessions are in-memory and small |
| Inbound | 443 only (Nginx) |
| Outbound | `api.anthropic.com`, `oauth2.googleapis.com`, `api.twilio.com` |

---

## What it needs to run

Nothing. The service starts with **no credentials at all**: routing is
deterministic so it still works, and the calendar and SMS tools fall
back to mocks automatically. That is deliberate — a demo you cannot
start because a key is missing is not a demo.

What each credential unlocks:

| Variable | Without it |
|---|---|
| `ANTHROPIC_API_KEY` | Calls connect and route correctly; the specialist opens with its own copy and takes details with fixed lines, but cannot converse |
| `TWILIO_AUTH_TOKEN` | Signature validation cannot run — **required in production** |
| `TWILIO_ACCOUNT_SID` / `TWILIO_PHONE_NUMBER` | SMS stays mocked |
| `GOOGLE_*` | Calendar stays mocked; a full booking conversation still demonstrates end to end |
| `HUMAN_TRANSFER_NUMBER` | Transfer degrades to a call-back promise |

The mock flags fail safe in both directions: even with
`MOCK_CALENDAR_MODE=false`, the live path is only used when the
matching credentials are actually present.

---

## Security posture

**Twilio signature validation.** Every webhook is verified
(HMAC-SHA1, constant-time compare). Defaults ON when
`NODE_ENV=production`. Without it, anyone who learns the webhook URL
can originate calls against the account.

**Rate limiting.** 120 requests per minute per IP on the HTTP
endpoints, with a bounded body read so a large POST cannot exhaust
memory.

**No secrets in prompts.** Structural, not incidental — see
`docs/voice-agent-architecture.md`. Asserted by tests.

**Log redaction.** The logger strips secret-shaped keys at any depth.
Phone numbers are masked to the last four digits.

**Transcripts are off by default** (`LOG_TRANSCRIPTS=false`). They
contain everything the caller said. Turn them on deliberately and
briefly, for debugging, and turn them back off.

**`CALL_SUMMARY_ENABLED`** controls only the human-readable summary,
which carries contact details. The anonymous analytics event is always
emitted and carries no personal data at all.

---

## Process management

**systemd is the supported path** (`deploy/yad-voice-agent.service`).
PM2 is provided (`deploy/ecosystem.config.cjs`) for environments that
already standardise on it, but systemd is what the runbook uses:
it is already on the box, it handles restart-on-failure and boot
ordering without another daemon, and its journal is where everything
else on the VPS logs.

The unit runs as a dedicated `yadvoice` system user with no login
shell, reads its environment from a root-owned `.env`, and sets
`TimeoutStopSec=35` — comfortably above `SHUTDOWN_GRACE_MS=25000`, so
in-progress calls finish rather than being cut off mid-sentence on a
restart.

---

## Deploying an update

```bash
cd /opt/yad-voice-agent
sudo -u yadvoice git pull
cd services/ai-phone-agent
sudo -u yadvoice npm ci --omit=dev
sudo systemctl restart yad-voice-agent
```

No build step. Restart is graceful: active calls get up to
`SHUTDOWN_GRACE_MS` to finish.

Verify:

```bash
curl -s https://voice.youraidepartment.ai/health | jq
sudo journalctl -u yad-voice-agent -n 50 --no-pager
```

`/health` reports which tools are live versus mocked, so a
misconfigured deployment is visible without placing a call.

---

## Logs

Structured JSON, one object per line, to stdout — journald collects it.
`deploy/logrotate-yad-voice-agent` handles any file-based output.

Events worth alerting on:

| Event | Meaning |
|---|---|
| `llm.failed` | Anthropic call failed; the caller heard a recovery line |
| `tool.failed` | A tool was rejected at validation or threw |
| `guard.blocked` | A caller probed past the limit and is being stonewalled |
| `guard.output_blocked` | A reply was suppressed before speech — investigate |
| `call.summary` | End-of-call record |
| `llm.usage` | Per-request token counts |

`guard.output_blocked` should be rare. If it is not, something in a
prompt is inviting the model to recite itself.

---

## Cost

Every model request logs `input_tokens` and `output_tokens`, and the
orchestrator accumulates process totals. Cost control is mostly
structural rather than a budget check:

- The deterministic router answers most calls with **no model call at
  all**.
- The router model is fast and capped at 200 tokens.
- Specialist replies are capped at 220 tokens.
- History is trimmed to the last 20 turns, so a long call does not grow
  quadratically.
- A caller who keeps probing stops reaching the model entirely.

---

## Scaling

Sessions are in-memory and keyed by `CallSid`. A single process handles
concurrent calls fine — the work per turn is one or two HTTPS requests
and the CPU cost is negligible.

Running more than one process would need shared session state, because
ConversationRelay holds one WebSocket per call and a caller must land
on the process holding their session. On this VPS, for a demo line,
one process is the right answer.

---

## Rollback

```bash
cd /opt/yad-voice-agent
sudo -u yadvoice git checkout <previous-commit>
sudo systemctl restart yad-voice-agent
```

There is no database and no migration, so rollback is just moving the
checkout. Twilio configuration is unaffected.
