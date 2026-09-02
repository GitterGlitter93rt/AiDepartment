# Your AI Department — Prospect Factory / Outbound Sales Brain

**Status:** Architecture substantially defined; implementation must begin with Claude Code Gate 0 audit  
**Started:** 2026-09-02  
**Branch:** `feature/outbound-sales-brain`

## Current objective

Build a reusable prospecting and outbound-sales system where the most important upstream capability is not dialing — it is deciding **who should be contacted, why, and what should be discussed**.

The architecture is now Market-Miner-first:

1. territory / market definition
2. Google advertiser-first prospect discovery
3. business identity resolution and deduplication
4. independent website/business research
5. evidence normalization (`confirmed`, `likely`, `unknown`, contradicted/stale history)
6. canonical Sales Manual Module 4C score / Tier A-D
7. opportunity + current YAD offer hypothesis
8. Sales Manual retrieval
9. compact prospect-specific Call Pack
10. Human Assist sales queue
11. deterministic compliance/suppression gate
12. controlled/reviewed Twilio voice runtime later
13. structured CRM outcome/follow-up
14. call QA, provider economics, and learning

The phone is a downstream consumer of the prospect factory, not the foundation of the system.

## Implementation ownership

- ChatGPT: architecture/product/sales-brain design and specifications.
- Claude Code on the EdgeXpert: code implementation, local execution, tests, debugging, deployment preparation, and coherent commits.
- GitHub: source control and architecture/source-of-truth storage.

ChatGPT should not continuously implement/run production code in GitHub.

Automatic GitHub Actions remain manual-only unless Michael explicitly asks to re-enable them.

## Architecture authority

Start at:

- `docs/09-software/outbound-sales-brain-index.md` when available
- `docs/09-software/outbound-ai-sales-brain-master-spec.md`
- `docs/09-software/outbound-ai-sales-brain-claude-handoff.md`
- `docs/09-software/outbound-sales-brain-implementation-gates.md`

Market Miner specifications live under `docs/09-software/market-miner-*.md`.

Canonical Sales Manual remains:

`docs/07-sales/training-manual/**`

Current commercial truth remains:

`docs/00-company/launch-decisions.md`

## First implementation milestone

Before autonomous voice work, Claude must prove:

> HVAC — Jacksonville + St. Augustine — advertiser-first — Tier B+ — target 100 research-ready prospects.

The output must be deduplicated and include evidence-backed scoring, current Google ad observations where available, website/CTA research, system signals, primary/backup hypotheses, current YAD offer hypotheses, hooks, provenance, freshness, and provider cost.

If fewer than 100 genuinely meet criteria, the correct output is the true number plus an honest coverage/shortfall report.

No real prospect calling is required for this milestone.

## First verticals

1. HVAC — Sales Manual Vertical Priority 1
2. Plumbing — Sales Manual Vertical Priority 2

Machine-readable profiles now exist for both.

Do not expand into every vertical until the profile/research architecture is proven in implementation.

## Google-first prospect strategy

For advertiser-first campaigns, prioritize actual current Google paid-search/Local Services observations.

Architecture currently recommends benchmarking:

- DataForSEO for bulk paid-SERP mining
- SerpApi for fallback/validation/LSA cases
- Google Places as a gap-filler/identity source, not proof of active advertising
- first-party company websites as durable business-intelligence sources
- Apollo/licensed equivalents for decision-maker/contact enrichment
- Google Ads Transparency as supporting advertiser evidence
- Meta as a secondary cross-platform signal

Provider choice is not final until Claude runs the documented provider benchmark and terms/storage review.

## Critical truth rules

- Tracking pixels/tags do not prove current advertising.
- One Google search without an ad does not prove a company is not advertising.
- A ServiceTitan/HubSpot/etc. frontend signal does not prove the backend workflow.
- Absence of a detected CRM signature does not prove no CRM exists.
- Multiple ad observations of the same company remain one Account.
- Existing CRM/receptionist/IT/marketing agency is normally something to understand and extend, not automatically replace.
- Never invent ad spend, lead volume, missed-call rate, revenue loss, ROI, integrations, results, or guarantees.
- A correct outcome may be no sale / leave the strong existing workflow alone.

## Current `phone-agent/` prototype

The code currently under `phone-agent/` was an early architecture experiment.

It is NOT the current source of truth.

Claude must audit it at Gate 0 and may keep, refactor, replace, or delete pieces as appropriate.

Do not preserve prototype architecture merely because code exists.

## Production autonomous dialing

Production autonomous AI prospect calling remains intentionally disabled.

The compliance architecture treats AI-generated voice as a distinct contact technology and does not equate B2B prospecting with automatic permission to use autonomous AI voice.

Until formal policy/legal/company review is complete:

- Market Miner can be built.
- Human Assist can be built and used under approved human-sales procedures.
- controlled test calls may use explicit allowlisted test participants after implementation reaches the relevant gate.
- real autonomous cold prospect calling remains gated/off.

## Implementation gates

Claude must follow:

`docs/09-software/outbound-sales-brain-implementation-gates.md`

Key order:

Gate 0 audit
-> data model
-> scoring/profile loader
-> geography/mining jobs
-> Google advertiser miner
-> entity resolution
-> website intelligence
-> Market Miner acceptance
-> Human Assist
-> Sales Manual RAG
-> Call Pack/roleplay
-> compliance software
-> realtime voice benchmarking
-> controlled Twilio
-> action tools
-> audio certification
-> explicit approval before real-prospect pilot.

A commit is not proof a gate passed. Claude must run tests locally and report actual results.

## Development safety / workflow

- no secrets in repository
- no automatic GitHub CI spam
- no fake customer lead submissions
- no real prospect calls during normal development
- no merge to main without explicit review/request
- persistent DNC/suppression required before any production outreach
- global kill switch required before autonomous production use
- public control/dial APIs must be authenticated
- Twilio/provider webhooks must be validated
- voice stack selected through measured end-to-end latency benchmarks, not brand preference
