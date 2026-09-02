# Your AI Department — AI Phone / Outbound Sales Brain

**Status:** In implementation  
**Started:** 2026-09-02  
**Branch:** `feature/outbound-sales-brain`

## Objective

Build a reusable AI phone system that can research businesses before outreach, choose a sales angle from the canonical sales manual, enforce calling/suppression rules, place Twilio calls, run a natural conversational sales agent, and persist structured outcomes for CRM follow-up and learning.

## Current architecture

1. Lead intake
2. Prospect research adapters
3. Evidence-normalized dossier (`confirmed`, `likely`, `unknown`)
4. Sales-manual retrieval
5. ICP scoring and strategy generation
6. Compliance/suppression gate
7. Twilio outbound dialing + AMD
8. Twilio ConversationRelay / realtime voice runtime
9. Sales-agent actions: booking, transfer, SMS/email, DNC
10. Post-call structured summary
11. CRM/storage update
12. performance/learning loop

## Source-of-truth rule

Sales messaging and objection logic must retrieve from `docs/07-sales/training-manual/**`. The phone agent must not maintain an independently drifting copy of the sales manual.

## First vertical

HVAC / Plumbing is the recommended first end-to-end production playbook because it has strong fit with paid lead acquisition, emergency/after-hours demand, missed-call recovery, lead-speed, dispatch/booking, CRM automation, and measurable attribution.

## Implementation now present

Under `phone-agent/`:

- architecture README
- typed lead/evidence/dossier/strategy/compliance/call contracts
- multi-adapter research orchestrator
- strategy engine and deterministic ICP scoring baseline
- compliance/suppression gate
- Twilio outbound-call adapter with AMD parameters
- ConversationRelay TwiML builder
- realtime voice-agent prompt builder
- persistence schema for leads, dossiers, compliance checks, calls, suppressions, and call events

## Production blockers

Production autonomous dialing is intentionally disabled until all of the following are resolved:

- Twilio account SID/auth token/from number are supplied through secrets/environment configuration.
- Public voice callback/WebSocket endpoint is deployed and TLS verified.
- Twilio webhook signature validation is implemented.
- Persistent database is selected and migrations are run.
- Line-type/contact-basis enrichment policy is selected.
- Calling-hours and jurisdiction policy is reviewed.
- Internal DNC/suppression import is available.
- Realtime LLM provider/model and latency target are selected.
- Calendar/CRM/SMS/email actions are wired.
- End-to-end test calls are completed with non-customer test numbers before any prospect campaign.

## Design decisions

- Research and live conversation are separate stages.
- The live voice agent receives a compact dossier rather than the entire manual every turn.
- All research claims carry confidence and source metadata.
- The agent may not invent ad spend, CRM integrations, lead volume, revenue leakage, ROI, or results.
- Existing CRMs are generally treated as systems to extend/integrate, not automatically replace.
- DNC intent immediately suppresses future dialing.
- The same runtime can later support `inbound_receptionist`, but outbound and inbound prompts/policies remain separate.
