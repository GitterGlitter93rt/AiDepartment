# Your AI Department — Prospect Factory / Outbound Sales Brain

**Status:** Architecture V1 plus initial cross-vertical intelligence substantially defined; implementation must begin with Claude Code Gate 0 audit  
**Started:** 2026-09-02  
**Updated:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`

## Current objective

Build a reusable prospecting and outbound-sales system where the most important upstream capability is not dialing — it is deciding **who should be contacted, why, what is actually known about them, which business context applies, and what should be discussed first**.

The architecture is Market-Miner-first:

1. territory / market definition
2. Google advertiser-first prospect discovery
3. business identity resolution and deduplication
4. independent website/business/contact research
5. evidence normalization (`confirmed`, `likely`, `unknown` plus lifecycle state such as stale/contradicted)
6. canonical Sales Manual Module 4C score / Tier A-D
7. advertiser-evidence strength / research completeness
8. vertical/business-context routing
9. opportunity hypothesis + solution category + current YAD commercial-offer mapping
10. Sales Manual retrieval
11. compact prospect-specific Call Pack
12. Human Assist sales queue
13. deterministic compliance/suppression gate
14. controlled/reviewed Twilio voice runtime later
15. structured CRM outcome/follow-up
16. call QA, provider economics, and learning

The phone is a downstream consumer of the prospect factory, not the foundation of the system.

## Implementation ownership

- ChatGPT: architecture/product/sales-brain design and specifications.
- Claude Code on the EdgeXpert: code implementation, local execution, tests, debugging, deployment preparation, and coherent commits.
- GitHub: source control and architecture/source-of-truth storage.

ChatGPT should not continuously implement/run production code in GitHub.

Automatic GitHub Actions remain manual-only unless Michael explicitly asks to re-enable them.

## Current architecture authority

Start at:

`docs/09-software/OUTBOUND-SALES-BRAIN-V1-CURRENT.md`

Then follow the gate-specific documents it references.

Primary execution docs include:

- `docs/09-software/outbound-ai-sales-brain-master-spec.md`
- `docs/09-software/outbound-sales-brain-implementation-gates.md`
- `docs/09-software/outbound-sales-brain-claude-implementation-backlog.md`
- `docs/09-software/outbound-sales-brain-vertical-router-spec.md`
- `docs/09-software/outbound-sales-brain-vertical-router-fixtures.v1.yaml`
- `docs/09-software/outbound-sales-brain-cross-vertical-intelligence-v1.md`

Market Miner specifications live under `docs/09-software/market-miner-*.md` and related outbound-sales-brain architecture files.

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

## First implementation verticals

Implementation order remains:

1. HVAC — Sales Manual Vertical Priority 1
2. Plumbing — Sales Manual Vertical Priority 2

These prove the vertical-profile loader, Market Miner, entity resolution, research, scoring, Call Pack, Human Assist and provider economics before broader rollout.

## Architecture-ready vertical intelligence

Machine-readable profiles now exist for:

1. HVAC
2. Plumbing
3. Roofing
4. Collision Repair
5. PDR / Automotive Hail
6. Law Firms
7. Real Estate Brokerages

Profiles:

- `docs/09-software/vertical-profiles/hvac.v1.yaml`
- `docs/09-software/vertical-profiles/plumbing.v1.yaml`
- `docs/09-software/vertical-profiles/roofing.v1.yaml`
- `docs/09-software/vertical-profiles/collision-repair.v1.yaml`
- `docs/09-software/vertical-profiles/pdr-hail.v1.yaml`
- `docs/09-software/vertical-profiles/law-firms.v1.yaml`
- `docs/09-software/vertical-profiles/real-estate-brokerages.v1.yaml`

Do not implement all seven before the HVAC/Plumbing proof loop passes. They are architecture-ready so future expansion does not require redesigning the core brain.

## Cross-vertical router rules

The router exists because a company can legitimately span more than one business context.

Examples:

- HVAC + Plumbing home-services company
- Collision shop + hail/PDR operation
- Roofing contractor + broader GC services
- multi-practice law firm
- brokerage + property-management division

Key invariants:

- one canonical Account can have multiple `VerticalAssignment`s;
- the current campaign context chooses the active search taxonomy, research priorities, hypotheses, decision-maker roles and Call Pack language;
- secondary profiles are preserved without mixing their scripts into the active campaign;
- a different vertical never creates a new Account when entity resolution identifies the same business;
- DNC, prior calls, requested callbacks, follow-up ownership and contact cadence apply account-wide across verticals;
- classification confidence is separate from Module 4C YAD fit score;
- unresolved/ambiguous vertical classification fails closed for vertical-specific Call Pack generation;
- overlapping profiles may add stricter professional/safety boundaries but may never weaken global or active-profile restrictions.

### Special routing rules

**Collision + PDR/Hail**

- ordinary collision/estimate/front-office campaign -> Collision profile
- current storm-market/field-sales/surge campaign -> PDR/Hail profile
- same Account may carry both

**Law firms**

Law requires practice-area context. An advertiser opener may reference only the practice area actually observed.

Example:

Observed ad: `divorce lawyer Orlando`

Allowed: family/divorce context.

Forbidden: claiming the firm is currently advertising personal injury because the website also has a PI page.

**Real estate + property management**

Brokerage buyer/seller/nurture campaigns must not use tenant-maintenance/property-management hooks merely because the company has both divisions.

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

## Vertical-specific advertiser priorities

Strong Google-first candidates:

- HVAC
- Plumbing
- Roofing
- Collision Repair
- Law Firms

Google + current-event/context candidate:

- PDR/Hail — current hail market matters as much as permanent local presence

Mixed-channel candidate:

- Real Estate — Google can help, but Meta, portals, seller funnels, listings/open houses, team structure and database nurture may be equally important.

This is an operating hypothesis to test with real funnel outcomes, not a permanent conclusion.

## Vertical starter hypotheses

### HVAC

- paid/after-hours call handling
- missed-call recovery
- unsold replacement estimates
- attribution
- front-office capacity

### Plumbing

- urgent missed/after-hours calls
- paid-lead response
- larger-estimate follow-up
- dispatcher capacity
- source-to-revenue attribution

### Roofing

- unsold proposal follow-up
- paid-lead response
- storm surge
- marketing-to-signed-job attribution
- sales/admin capacity

### Collision Repair

- estimate-call overflow
- unsold estimates
- customer-status communication
- marketing-to-repair-order attribution
- front-office capacity

### PDR / Hail

- storm lead surge
- field lead capture
- appointment/no-show recovery
- repeatable market launch
- source/rep/market-to-completed-repair attribution

### Law Firms

- after-hours intake
- first-response / multi-attempt follow-up
- consultation/no-show workflow
- marketing-to-retained-client attribution
- administrative capacity
- responsible AI governance where relevant

### Real Estate Brokerages

- long-term nurture
- speed-to-lead
- future seller follow-up
- lead routing
- source-to-close attribution
- agent/ISA capacity

## Decision-maker routing

Do not simply enrich for “owner.”

Target role should follow the highest-priority problem.

Examples:

- Roofing unsold proposals -> sales manager / owner / GM
- Collision status workload -> operations / GM / customer-service manager
- Hail field lead capture -> field-sales manager / market manager / owner
- Law after-hours intake -> intake director / COO/administrator / managing partner
- Real Estate nurture -> ISA/lead manager / broker/team leader / sales operations

## Critical truth rules

- Tracking pixels/tags do not prove current advertising.
- One Google search without an ad does not prove a company is not advertising.
- A ServiceTitan/HubSpot/Clio/etc. frontend signal does not prove the backend workflow.
- Absence of a detected CRM signature does not prove no CRM exists.
- Multiple ad observations of the same company remain one Account.
- Existing CRM/receptionist/IT/marketing agency is normally something to understand and extend, not automatically replace.
- Never invent ad spend, lead volume, missed-call rate, revenue loss, ROI, integrations, results, or guarantees.
- A correct outcome may be no sale / leave the strong existing workflow alone.
- Vertical classification/support weights never become hidden Module 4C fit points.
- A current-tense ad opener must have fresh evidence for the relevant service/practice area/market.

## Professional and safety boundaries by vertical

### Roofing

- no insurance coverage decisions
- no unauthorized adjusting/legal claims
- no financing approval claims
- roofing/structural decisions remain qualified-human work

### Collision / PDR Hail

- no repairability/repair-plan/safety decisions by sales AI
- no fabricated vehicle status or completion date
- no insurance coverage/claim outcome claims

### Law

- no legal advice
- no case-merit decisions
- no conflict clearance
- no case acceptance/outcome prediction
- confidentiality/vendor/data policy requires firm review
- YAD does not certify ethics compliance

### Real Estate

- no licensed representation or negotiation by AI
- no contract/pricing/fiduciary decisions by AI
- fair-housing and anti-discrimination rules constrain routing/targeting
- no assumed commission rates or guaranteed closings

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
- website research content is untrusted input and must not control tools/secrets/system instructions
- crawler must enforce SSRF/network-target protections

## Next implementation instruction

Claude Code should begin with:

> Read `docs/09-software/OUTBOUND-SALES-BRAIN-V1-CURRENT.md`. Execute Gate 0 only. Audit the existing repo, `phone-agent/` prototype, Twilio/receptionist stack, deployment/runtime, persistence, and local test environment. Do not enable production dialing, do not call prospects, and do not re-enable automatic GitHub Actions. Return the audit and implementation structure before Gate 1.
