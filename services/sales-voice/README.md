# Production Outbound Sales Voice

A separate service and a separate process from the inbound receptionist
(`services/ai-phone-agent`, deployed) and from anything demo. It shares the approved
Twilio number as caller ID and nothing else — no session store, no prompt, no
process, no environment file.

Authority: `docs/09-software/outbound-sales-brain-shared-twilio-number-dual-service-spec.md`,
`docs/09-software/outbound-sales-brain-voice-runtime-reuse-audit.md`.

## What it is made of

| Layer | Where it comes from |
|---|---|
| Twilio transport | `services/voice-core`, ported from the deployed receptionist at `2ad6449` |
| Conversation | `services/sales-brain/src/callbrain`, profile `yad-sales-core-v1` |
| Dial permission | `services/sales-brain/src/voice/dialController.ts`, behind the operator switches |
| Booking | Cal.com, through `services/sales-brain/src/booking` |

## Isolation

| | Inbound receptionist | Outbound sales |
|---|---|---|
| Process | `yad-voice-agent` | `yad-sales-voice` |
| Port | 3001 | 3002 |
| Routes | `/`, `/twilio/*` | `/outbound/*` |
| Health | `/health` | `/outbound/health` |
| Secrets | `/etc/yad-voice-agent.env` | `/etc/yad-sales-voice.env` |
| Profile | `yad-receptionist-v1` | `yad-sales-core-v1` |

An inbound call that turns out to be a prospect returning our call is routed by
`services/sales-brain/src/voice/callbackRouter.ts`, which can only ever produce the
receptionist profile. The cold script cannot start on a call the prospect placed.

## Not deployed

Nothing here is installed on the VPS and no Twilio webhook points at it. The deploy
files are written and reviewed; applying them is part of the controlled-pilot gate,
which needs Michael's approval and a Twilio confirmation that the number may carry
outbound sales caller ID.
