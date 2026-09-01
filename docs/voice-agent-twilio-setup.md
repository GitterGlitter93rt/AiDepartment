# Voice Agent — Twilio Setup

Everything that happens in the Twilio console, and what each setting
means for the call.

Prerequisite: the service is deployed and `https://voice.youraidepartment.ai/health`
returns 200. See `docs/voice-agent-deployment.md`.

---

## What Twilio is doing

The service uses **ConversationRelay**. Twilio handles the parts that
need to be near the audio:

- speech-to-text
- text-to-speech
- barge-in (the caller interrupting the agent mid-sentence)

and streams **text** to this service over a WebSocket. The service
never touches audio. That is why the entire conversation layer is
unit-testable without a phone, and why latency is dominated by model
calls rather than by anything in this codebase.

```
Caller ──PSTN──▶ Twilio ──POST /twilio/incoming──▶ service returns TwiML
                    │
                    └──WebSocket──▶ wss://voice.youraidepartment.ai/twilio/conversation
```

---

## 1. Buy a voice-capable number

Console → **Phone Numbers → Manage → Buy a number**. Filter for
**Voice**. A local number in the market you are demoing to sounds more
credible than a toll-free one.

---

## 2. Point the number at the service

Console → **Phone Numbers → Manage → Active numbers →** your number.

Under **Voice Configuration**:

| Field | Value |
|---|---|
| A call comes in | **Webhook** |
| URL | `https://voice.youraidepartment.ai/twilio/incoming` |
| HTTP method | **POST** |
| Primary handler fails | `https://voice.youraidepartment.ai/twilio/incoming` |

Under **Call Status Changes**:

| Field | Value |
|---|---|
| URL | `https://voice.youraidepartment.ai/twilio/status` |
| HTTP method | **POST** |

The status callback is what triggers the end-of-call summary and the
CRM push. Without it those still fire when the WebSocket closes, but
the status callback is the reliable signal — a socket can drop for
reasons that are not the call ending.

**Save.**

---

## 3. Credentials

Console → **Account → API keys & tokens**.

Put these in `/opt/yad-voice-agent/services/ai-phone-agent/.env`:

```
TWILIO_ACCOUNT_SID=AC…
TWILIO_AUTH_TOKEN=…
TWILIO_PHONE_NUMBER=+1…
```

Then `sudo systemctl restart yad-voice-agent`.

`TWILIO_PHONE_NUMBER` must be in **E.164** (`+19045550142`). It is the
"from" number for outbound SMS.

---

## 4. Signature validation

Leave `VALIDATE_TWILIO_SIGNATURE` unset — it defaults ON when
`NODE_ENV=production`.

Every webhook must carry a valid `X-Twilio-Signature`, verified with
HMAC-SHA1 and a constant-time compare. Without it, anyone who learns
the webhook URL can originate calls that bill your Anthropic account.

Validation signs the **exact public URL Twilio called**. If the URL
Twilio has configured and `PUBLIC_BASE_URL` disagree — http vs https, a
trailing slash, `www`, a stale ngrok hostname — every request will fail
with 403. When debugging a 403, check that first.

---

## 5. Place a test call

Dial the number. You should hear the greeting, then say something a
real caller would say:

| Say this | You should reach |
|---|---|
| "Water is pouring out from under my kitchen sink." | A plumbing dispatcher asking about the shutoff valve |
| "My wife served me with divorce papers yesterday." | A family-law intake coordinator |
| "My roof started leaking after last night's storm." | A roofing company |
| "I'm looking to buy a house in St Augustine." | A real estate team |
| "My driveway is black and needs pressure washing." | A pressure washing company |

Then, on the same call, switch: *"Actually, what about plumbing? Water
is pouring under my sink."* The persona should change cleanly and the
previous scenario's answers should not follow you across.

Watch it happen:

```bash
sudo journalctl -u yad-voice-agent -f
```

`router.decision` shows the classification and confidence.
`specialist.selected` shows which brain loaded.

---

## 6. Local development

You need a public HTTPS URL for Twilio to reach.

```bash
cd services/ai-phone-agent
cp .env.example .env      # fill in ANTHROPIC_API_KEY at minimum
npm start
```

In another terminal:

```bash
ngrok http 3001           # or: cloudflared tunnel --url http://localhost:3001
```

Set `PUBLIC_BASE_URL` to the HTTPS URL ngrok prints, restart, and point
the Twilio number's webhook at `<that URL>/twilio/incoming`.

`TWILIO_CONVERSATION_RELAY_URL` is derived from `PUBLIC_BASE_URL`
automatically (`wss://…/twilio/conversation`) — there is a contract test
asserting the derived path matches the path the socket actually listens
on, because a mismatch there drops every call at connect and looks like
a Twilio problem.

For local dev only, set `VALIDATE_TWILIO_SIGNATURE=false` if the
tunnel URL rewriting causes signature mismatches. **Never in
production.**

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Call connects then immediately drops | Relay WebSocket URL mismatch. Check `PUBLIC_BASE_URL` and that `/twilio/conversation` is reachable through Nginx with `Upgrade`/`Connection` headers set. |
| 403 on every webhook | Signature validation. The URL Twilio calls and `PUBLIC_BASE_URL` disagree. |
| Greeting plays, then silence | Anthropic call failing. Check `journalctl` for `llm.failed`. Routing is deterministic so the greeting works even when the API does not. |
| Agent takes details but never books | Calendar mocked (expected without Google credentials) or the model is not requesting the tool. Check for `tool.requested` in the log. |
| Wrong industry | Check `router.decision` for confidence and source. Low confidence with `source: heuristic` means the sentence needs a rule; see `docs/adding-an-industry.md`. |
| Everything works, no summary | Status callback not configured (step 2). |

---

## Nginx WebSocket requirements

ConversationRelay needs a real WebSocket upgrade. The provided
`deploy/nginx-voice.youraidepartment.ai.conf` includes it; if you are
adapting an existing block, these matter:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 3600s;   # a call is a long-lived socket
```

Without the long read timeout, calls are cut off mid-conversation at
whatever the default is (60s), which presents as callers being
disconnected exactly one minute in.
