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

There is a **third** endpoint you do not configure here:
`/twilio/relay-action`. It is passed to Twilio inside the TwiML as the
`action` attribute on `<Connect>`, so the service supplies it
automatically from `PUBLIC_BASE_URL`. Twilio POSTs to it when the relay
session ends, and the service answers with `<Dial>` for a warm transfer
or `<Hangup>` otherwise. If `PUBLIC_BASE_URL` is wrong, transfers fail
silently while everything else appears to work — worth knowing when a
transfer does nothing.

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

## 3b. What the TwiML actually contains

You never write TwiML by hand — the service generates it — but knowing
what Twilio receives makes debugging much faster. On an inbound call
`/twilio/incoming` returns:

```xml
<Response>
  <Connect action="https://voice.youraidepartment.ai/twilio/relay-action">
    <ConversationRelay
      url="wss://voice.youraidepartment.ai/twilio/conversation"
      welcomeGreeting="Thanks for calling. Tell me a bit about what's going on..."
      voice="en-US-Journey-O"
      language="en-US"
      transcriptionProvider="google"
      interruptible="true" />
  </Connect>
</Response>
```

| Attribute | Effect | Where to change it |
|---|---|---|
| `url` | The WebSocket the transcripts stream to. Derived from `PUBLIC_BASE_URL` unless `TWILIO_CONVERSATION_RELAY_URL` overrides it. | `.env` |
| `welcomeGreeting` | Spoken by Twilio before the socket carries anything. This is why the first thing a caller hears is instant — it does not wait on a model. | `GREETING` in `src/core/orchestrator.ts` |
| `voice` | The TTS voice. | `conversationRelayTwiml()` in `src/twilio/twiml.ts` |
| `transcriptionProvider` | Which STT engine Twilio uses. | same |
| `interruptible` | Lets the caller talk over the agent, as on a real call. Turning this off makes it feel like an IVR. | same |
| `action` | Where Twilio goes when the relay ends — this is what makes a warm transfer possible. | derived from `PUBLIC_BASE_URL` |

**On voice and language:** consult Twilio's ConversationRelay
documentation for the currently supported voice identifiers and
transcription providers rather than assuming the values above are
still current. They change, and an unsupported value fails at call
time, not at configuration time.

## 3c. Messages on the socket

Twilio sends JSON frames; the service replies with JSON frames. Useful
when reading `journalctl` output.

**Inbound (Twilio → service)**

| `type` | Carries | Handled by |
|---|---|---|
| `setup` | `callSid`, `from`, `to` | Creates the session. Sends nothing back — the greeting is already playing. |
| `prompt` | `voicePrompt` (the transcript), `last` | The turn. Goes to the orchestrator. |
| `interrupt` | `utteranceUntilInterrupt` | Caller talked over the agent. Playback already stopped; nothing to undo. |
| `error` | `description` | Logged. |

**Outbound (service → Twilio)**

| Frame | Purpose |
|---|---|
| `{"type":"text","token":"…","last":false}` | A clause to speak. Long replies are chunked so speech starts before the whole reply exists. |
| `{"type":"text","token":"…","last":true}` | Final chunk of the turn; the relay starts listening again. |
| `{"type":"end","handoffData":"…"}` | Ends the relay session. Sent only AFTER the final text frame, so a transfer never clips the agent's closing sentence. |

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

## 4b. Reading the Twilio debugger

Twilio Console → **Monitor → Logs → Calls**, then open a call.

- **Request Inspector** shows the exact TwiML the service returned. If
  a transfer is not working, this is where you confirm the `action`
  URL.
- **Errors** carries Twilio's own warnings (11200 is an HTTP retrieval
  failure — usually a 403 from signature validation, or a timeout).
- The service's own view is `journalctl -u yad-voice-agent -f`, and the
  two are best read side by side: Twilio tells you what it asked for,
  the service tells you what it decided.

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
| Transfer says "connecting you" then hangs up | `PUBLIC_BASE_URL` wrong, so the `action` URL Twilio was given does not resolve. Check the TwiML in the Twilio call log. |
| Agent talks over the caller / cannot be interrupted | `interruptible` is false, or the client is not sending `interrupt` frames. |
| First greeting is slow | It should be instant — it is spoken by Twilio from the TwiML and does not wait on a model. If it is slow, the delay is Twilio reaching `/twilio/incoming`. |
| Replies arrive all at once after a pause | Chunking is not happening. Check `chunkForSpeech` output in the logs. |

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
