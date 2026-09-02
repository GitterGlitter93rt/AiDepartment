# Live call QA — measurement runbook

How to get real latency numbers off a real phone call, and which of
them are ours to fix.

---

## 0. What can and cannot be measured

ConversationRelay owns the audio. This service never sees a media
stream: Twilio does speech recognition, decides when the caller has
stopped, synthesises speech and plays it. We exchange text.

So the honest split is:

| Measured here, exactly | Not observable here, at all |
|---|---|
| When Twilio handed us the caller's words | When the caller started making sound |
| When we sent text back | When the caller heard the first syllable |
| Model time to first token | Synthesis time, playback start |
| When we stopped generating after an interrupt | When playback actually stopped |

Anything in the right-hand column needs a stopwatch and a handset. The
report tool prints `NOT MEASURABLE` for those rows rather than
producing a number that would look authoritative and be invented.

**Endpointing** — the gap between the caller falling silent and Twilio
declaring the turn over — is the one Twilio-side number we *can* see,
via interim transcripts (`RELAY_PARTIAL_PROMPTS`, on by default). It is
usually the largest single component of a slow-feeling turn, and it is
not ours to fix.

---

## 1. Deploy

```bash
ssh you@45.32.171.201

cd /opt/yad-voice-agent
sudo -u yadvoice git fetch origin
sudo -u yadvoice git checkout feature/twilio-ai-phone-agent
sudo -u yadvoice git pull --ff-only origin feature/twilio-ai-phone-agent

cd services/ai-phone-agent
sudo -u yadvoice npm ci --omit=dev
sudo systemctl restart yad-voice-agent
```

`/etc/yad-voice-agent.env` is not touched by any step here. Nginx, DNS,
Twilio console and the website are not touched either.

## 2. Verify what is actually running

```bash
curl -s https://voice.youraidepartment.ai/health | python3 -m json.tool
```

```json
"build": {
  "commit": "…",
  "shortCommit": "…",
  "branch": "feature/twilio-ai-phone-agent",
  "dirty": false,
  "source": "git"
}
```

Check three things:

- `shortCommit` matches the commit you meant to deploy.
- `dirty` is **false**. True means the VPS working tree has edits that
  are not in git, and you are not testing what you think you are.
- `config.partialPrompts` is `true` (see §5 if calls misbehave).

`git rev-parse HEAD` on the box confirms the checkout; `/health`
confirms the *running process* — they differ if the restart failed.

## 3. Watch the call

```bash
sudo journalctl -u yad-voice-agent -f -o cat | tee /tmp/qa-calls.log
```

## 4. Read the numbers

```bash
node tools/call-timeline.mjs < /tmp/qa-calls.log
```

Per turn, with each row attributed to whoever owns it:

```
  caller speech -> end of turn        703ms       ConversationRelay (endpointing)
  end of turn -> handler start          1ms       our code
  handler start -> Claude request      22ms       our code (prompt assembly)
  Claude request -> first token       428ms       Anthropic (TTFT)
  first token -> speakable clause       0ms       our code (clause threshold)
  --------------------------------------------------------------------
  END OF TURN -> FIRST TEXT SENT      449ms       PERCEIVED SILENCE (best proxy)
```

Turns answered from a deterministic opening line never reach the model
and say so — those are the ~25ms turns, and they are not a measurement
error.

## 5. If something is wrong

| Symptom | Cause | Fix |
|---|---|---|
| Call connects then drops immediately | `partialPrompts` attribute rejected | `RELAY_PARTIAL_PROMPTS=false` in the env file, restart. Everything else is unchanged; you lose only the endpointing row. |
| `dirty: true` | Uncommitted edits on the VPS | `sudo -u yadvoice git status` and resolve before trusting any number |
| `commit: "unknown"` | Not a git checkout | Set `GIT_COMMIT` in the env file at deploy time |
| Agent answers half a sentence | An interim transcript was treated as a turn | Should be impossible — interim frames return early. File it with the log. |

## 6. Rehearsing without a phone

The whole chain can be exercised locally against a stub that speaks the
real SSE protocol, with a configurable time to first token:

```bash
node tools/stub-anthropic.mjs &
ANTHROPIC_BASE_URL=http://127.0.0.1:3099 ANTHROPIC_API_KEY=stub \
  PORT=3078 VALIDATE_TWILIO_SIGNATURE=false \
  node --experimental-strip-types src/server.ts > /tmp/svc.log &

node tools/rehearse-call.mjs bargein
node tools/call-timeline.mjs < /tmp/svc.log
```

This proves the marks fire and the arithmetic is right. It proves
nothing about recognition, synthesis or playback, because none of those
run locally.
