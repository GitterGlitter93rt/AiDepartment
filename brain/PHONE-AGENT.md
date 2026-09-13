# Your AI Department — Prospect Factory / Outbound Sales Brain

**Status:** Architecture V1 substantially defined; implementation begins with Claude Code Gate 0 audit  
**Started:** 2026-09-02  
**Updated:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`

## Current objective

Build a reusable prospecting and outbound-sales system where the primary advantage is deciding:

> **Who should YAD contact next, why, what is actually known about them, which business context applies, who owns the likely workflow, and what should be asked first?**

The phone is downstream.

Canonical architecture:

1. approved territory/market
2. controlled query planner
3. advertiser-first discovery
4. identity resolution/dedupe
5. false-positive/aggregator filtering
6. website/business/contact research
7. evidence ledger + freshness
8. vertical/business-context routing
9. canonical Module 4C score / Tier A-D
10. advertiser-evidence strength / research completeness
11. opportunity-hypothesis ranking
12. decision-maker routing
13. current YAD solution/commercial mapping
14. Sales Manual retrieval
15. compact Call Pack
16. relationship-aware ready queue
17. Human Assist Daily Brief
18. deterministic compliance/suppression
19. controlled/reviewed realtime voice later
20. prospect memory / CRM / follow-up
21. QA / analytics / closed-loop learning
22. reviewed optimization proposals for markets/queries/hooks/providers.

## Implementation ownership

- ChatGPT: architecture/product/sales-brain design and specifications.
- Claude Code on EdgeXpert: implementation, local execution, tests, debugging, deployment preparation, coherent commits.
- GitHub: source control and architecture/source-of-truth storage.

Automatic GitHub Actions remain manual-only unless Michael explicitly changes this.

## Current architecture authority

Start at:

`docs/09-software/OUTBOUND-SALES-BRAIN-V1-CURRENT.md`

Implementation sequencing:

`docs/09-software/outbound-sales-brain-implementation-waves-v1.md`

Claude must still begin with Gate 0 audit.

## First proof milestone

Before autonomous voice work:

> **HVAC — Jacksonville + St. Augustine — advertiser-first — Tier B+ — target 100 research-ready prospects — no contact.**

Required output includes honest deduped identity, fresh paid-ad evidence where available, website/CTA/system research, score/tier, advertiser strength, research completeness, opportunity hypothesis, target role, Call Pack, provenance/freshness and provider cost.

If the true result is fewer than 100, report the true number and coverage shortfall. Never relax criteria invisibly.

## Profile implementation policy

Wave 1 proves the engine with:

1. HVAC
2. Plumbing

Do not implement every architecture-ready profile before that proof passes.

## Architecture-ready profile registry

Canonical machine registry:

`docs/09-software/vertical-profile-registry.v1.yaml`

Profiles currently defined:

1. HVAC
2. Plumbing
3. Roofing
4. Collision Repair
5. PDR / Automotive Hail
6. Law Firms
7. General Contractors / Remodeling
8. Electrical
9. Dental
10. Med Spas
11. Real Estate Brokerages
12. Water / Fire / Mold Restoration
13. Garage Door Service / Installation

All profiles use the same profile schema and canonical Module 4C fit score. No vertical receives hidden bonus points.

## Cross-vertical router

A canonical Account may legitimately carry multiple `VerticalAssignment`s.

Examples:

- HVAC + Plumbing
- Collision + PDR/Hail
- Brokerage + property management
- GC + meaningful roofing division

Rules:

- campaign context selects the active profile;
- secondary profiles remain attached without mixing scripts into the active campaign;
- cross-vertical discovery never creates duplicate Account/contact history;
- DNC, callbacks, meetings, rep ownership and prior conversations are account-wide according to policy;
- ambiguous classification blocks vertical-specific factual claims;
- overlapping safety/professional boundaries can only become stricter.

## Market Miner autopilot

The architecture now includes:

- approved-query autonomous planner
- three-pass market probe/coverage/long-tail strategy
- search-cell saturation and cooldown
- false-positive/noise memory
- query/provider cost tracking
- evidence refresh orchestration
- territory-expansion recommendations
- target ready-inventory low/high water
- provider/query/market downstream learning.

Important:

V1 can reprioritize **approved** queries/search cells/providers within bounded config.

V1 cannot autonomously:

- invent unrestricted query families
- enter unapproved geography
- change Module 4C
- change compliance/DNC policy
- rewrite commercial truth
- weaken professional boundaries.

## Prospect memory

The system remembers separately:

- Account/Location/Domain identity
- public Evidence with freshness
- prospect-verified statements
- prior conversations/outcomes
- callbacks/meetings
- CRM/system corrections
- DNC/suppression
- historical Call Packs/scores/hooks.

Stale history never masquerades as current fact.

A prospect correction does not erase the historical public observation; it adds provenance and changes current strategy.

## Ready-queue priority

Module 4C fit score is not the only question when deciding who gets worked next.

Hard gates first:

- suppression/policy
- duplicate/in-flight lease
- required research freshness
- booked meetings
- campaign eligibility.

Then priority considers:

1. requested callback / relationship commitment
2. campaign priority
3. Tier
4. exact Module 4C score
5. advertiser evidence strength
6. opportunity-hypothesis strength
7. research completeness/freshness
8. decision-maker quality
9. age/fairness.

A requested Tier B callback due now beats a brand-new Tier A cold prospect because YAD made a commitment.

## Decision-maker routing

Do not default to “owner” for every company.

Route based on problem ownership.

Examples:

- paid attribution -> marketing / operations / owner
- missed calls -> operations / office / dispatch
- unsold proposals -> sales leadership / GM / owner
- law intake -> intake director / COO / administrator / managing partner
- dental/med-spa front desk -> practice/office/operations manager
- hail field-lead workflow -> market/sales/operations leadership.

Role-only gatekeeper targeting is valid when no current named person is verified. Never invent a name.

## Opportunity hypothesis engine

The system ranks **questions worth asking**, not problems it pretends are true.

Example:

Current emergency HVAC ads + 24/7 website + phone-first CTA

supports:

> “When one of those calls comes in after hours and everybody is tied up, what happens next?”

It does NOT support:

> “You're losing emergency calls.”

If prospect later verifies that workflow is strong, that hypothesis is demoted and the system explores another legitimate workflow or accepts no-sale.

## Human Assist product

Before autonomous voice, Brent should have a Daily Brief containing:

- commitments/callbacks first
- ranked new prospects
- why each is ranked
- target person/role
- 3 confirmed facts max
- primary/backup hypothesis
- first questions
- systems/signals
- prohibited claims
- evidence links
- one-click dispositions
- structured notes/corrections
- DNC/callback/meeting handling.

Human Assist creates useful labeled sales data before voice automation.

## Closed-loop learning

Three learning loops:

### Supply

- market
- query
- provider
- research depth
- cost/Tier B+

### Sales

- hook
- role target
- question sequence
- Call Pack usefulness
- qualified conversation / meeting / opportunity

### Quality

- research correction
- false-positive rules
- refresh TTL proposals
- QA
- voice configuration proposals.

V1 learning is measured, explainable and human-reviewed.

It does not auto-edit canonical score, compliance, profile doctrine, production prompt or commercial truth.

## Advertiser strategy

Primary premium signal for most targeted service verticals remains actual current Google paid-search / LSA observations.

Strong Google-first profiles:

- HVAC
- Plumbing
- Roofing
- Collision
- Law
- GC/Remodeling
- Electrical
- Restoration
- Garage Door.

Mixed strategies:

- PDR/Hail: current storm market + Google + Meta/social/field context
- Med Spa: Meta/Instagram plus Google
- Real Estate: Google + Meta + portals/listing/seller funnel context
- Dental: Google service-specific ads plus local/new-patient funnel signals.

Tracking tags/pixels never prove current advertising.

## Critical truth rules

- One Google search without an ad != not advertising.
- Repeated ad observations strengthen advertiser evidence; Google still adds +4 once in Module 4C.
- Frontend CRM/booking signal != backend workflow confirmed.
- Failed CRM detection != no CRM.
- Multiple search observations != multiple Accounts.
- Existing CRM/receptionist/IT/agency is normally context to understand/extend, not automatically replace.
- Never invent spend, volume, missed-call rate, revenue loss, ROI, integrations, results or guarantees.
- No-sale can be the correct outcome.
- Current-tense personalized claims require fresh eligible evidence.

## Professional/safety boundaries

### Home services / construction

Qualified professionals retain technical, code, electrical, structural, repair and safety judgment.

### Roofing / restoration / collision / hail

No insurance coverage/claim outcome/unauthorized adjusting claims. No repair/safety decisions by sales AI.

### Law

No legal advice, case-merit decisions, conflict clearance, case acceptance/outcome prediction, or claim of ethics compliance.

### Dental / Med Spa

No diagnosis, treatment recommendation, clinical suitability or casual PHI movement. Privacy/security/vendor review required before sensitive data workflows.

### Real Estate

Licensed representation, advice, negotiation, contracts, pricing/fiduciary decisions remain with qualified humans; fair-housing constraints apply.

## Existing `phone-agent/` prototype

Early implementation experiment only.

It is not architectural authority.

Claude must audit it at Gate 0 and may reuse/refactor/replace/delete pieces.

## Production autonomous dialing

Production autonomous AI prospect calling remains intentionally disabled.

Until formal company/legal/policy review and technical gates:

- Market Miner can be built.
- Human Assist can be built/used under approved human-sales procedures.
- controlled allowlisted test calls may occur only after relevant technical gates.
- real autonomous cold-prospect AI voice remains gated/off.

## Development safety

- no secrets in repository
- no automatic GitHub CI spam
- no fake customer form submissions
- no real prospect calls during ordinary development
- no merge to main without explicit review/request
- durable DNC/suppression
- global kill switch before autonomous production use
- authenticated control APIs
- validated provider callbacks
- public website content is untrusted data
- crawler SSRF/private-network protections required
- research LLM gets no communication/shell/secrets authority.

## Next Claude instruction

> Read `docs/09-software/OUTBOUND-SALES-BRAIN-V1-CURRENT.md` first. Execute Gate 0 only. Audit the repo, `phone-agent/` prototype, existing Twilio/receptionist implementation, `voice.youraidepartment.ai` runtime/deployment, persistence and EdgeXpert local test workflow. Do not enable production dialing, do not call prospects, do not re-enable automatic GitHub Actions, and do not merge main. Return the Gate 0 audit and proposed Market Miner implementation structure before Gate 1.
