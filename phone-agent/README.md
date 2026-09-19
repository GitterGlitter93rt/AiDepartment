# Your AI Department — Outbound Sales Brain

This directory contains the isolated implementation track for the outbound AI sales system. It is intentionally separate from the production Astro website while the production-source synchronization blocker remains open.

## Goal

Turn a raw business lead into a compliant, research-backed, personalized outbound call that can:

1. Research the prospect before dialing.
2. Detect advertising, tracking, lead-capture, and likely CRM signals.
3. Score fit and select the right sales angle.
4. Enforce suppression/compliance gates before any call.
5. Place the call through Twilio.
6. Run a low-latency conversational sales agent.
7. Book, transfer, text, or email when appropriate.
8. Summarize the call and write structured outcomes back to a CRM/storage layer.
9. Learn which hooks, objections, industries, and dispositions correlate with booked meetings.

## Architecture

```text
Lead Source
   |
   v
Research Orchestrator
   |-- Website crawler / tag detector
   |-- Google Ads signal adapter
   |-- Meta Ads signal adapter
   |-- CRM / marketing-tech detector
   |-- Contact / booking / chat detector
   v
Prospect Dossier
   |
   v
Sales Strategy Engine
   |-- Sales Manual retrieval
   |-- Industry playbook selection
   |-- ICP score
   |-- Hook + discovery questions
   |-- Objection plan
   v
Compliance Gate
   |-- DNC / internal suppression
   |-- line type / consent state
   |-- jurisdiction / calling hours
   |-- retry limits
   v
Dial Queue
   |
   v
Twilio Programmable Voice
   |-- AMD
   |-- ConversationRelay / streaming voice
   v
Realtime Sales Agent
   |-- short-turn response policy
   |-- interruption handling
   |-- tool calls: transfer / booking / SMS / email / DNC
   v
Post-Call Processor
   |-- transcript summary
   |-- disposition
   |-- objections / pain points
   |-- CRM fields
   |-- next step
   v
Analytics / Learning Loop
```

## Important design rule

The live voice model should **not** ingest the entire sales manual on every turn. A slower research/strategy step should precompute a concise dossier and retrieve only the relevant manual sections for the selected industry and call objective.

## Source of truth

Sales knowledge comes from:

- `docs/07-sales/training-manual/**`

Do not duplicate or silently rewrite the manual in this directory. The phone brain should index/retrieve from those modules.

## Safety / compliance rule

No autonomous outbound call may be placed unless the lead passes the compliance gate. The implementation must support a `research_only` or `human_assist` disposition for leads that should not be autonomously dialed.

## V1 operating modes

- `research_only`
- `human_assist`
- `autonomous_outbound`
- `inbound_receptionist` (future reuse of the same runtime)

## Recommended V1 launch vertical

HVAC / Plumbing first. The engine remains generic, but the first end-to-end playbook should optimize for expensive paid leads, emergency intent, missed-call leakage, after-hours response, CRM automation, booking, and dispatch workflows.

## Environment variables

Do not commit values.

```bash
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
PUBLIC_VOICE_BASE_URL=
ANTHROPIC_API_KEY=
REALTIME_MODEL_PROVIDER=
DATABASE_URL=
CRM_PROVIDER=
CRM_API_KEY=
```

## Current status

This scaffold defines the contracts and orchestration boundaries. Production dialing remains disabled until Twilio credentials, persistence, line-type/compliance data, and the selected realtime voice runtime are configured and verified.
