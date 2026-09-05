# Claude Code Handoff — Build the Your AI Department Prospect Factory + Outbound Sales Brain

**Implementation owner:** Claude Code on the EdgeXpert  
**Architecture owner:** ChatGPT / YAD architecture docs  
**Business owner:** Michael Chanata  
**First engineering objective:** Market Miner / Human-Assist prospect supply  
**Production autonomous dialing:** MUST REMAIN DISABLED until explicit approval after all required gates pass.  
**GitHub CI:** Keep manual-only unless Michael explicitly asks to re-enable automatic runs.

---

# 1. YOUR JOB

Implement the architecture that has already been defined.

Do not redesign the business model, prospecting doctrine, scoring system, commercial offers, or compliance strategy from scratch.

Your first useful product is NOT an autonomous dialer.

Your first useful product is:

> A system that can take a territory + vertical, find current high-value prospects — especially active Google advertisers — independently research them, deduplicate them, score them using the YAD Sales Manual, create evidence-backed Call Packs, and give a human salesperson a ranked daily queue.

Twilio/realtime calling comes after that supply chain works.

---

# 2. READ THESE ARCHITECTURE FILES FIRST

Read all before substantial implementation.

## Project authority

1. `CLAUDE.md`
2. `brain/README.md`
3. `brain/TODO.md`
4. `docs/00-company/launch-decisions.md`

## Outbound architecture

5. `docs/09-software/outbound-ai-sales-brain-master-spec.md`
6. `docs/09-software/market-miner-prospect-factory-spec.md`
7. `docs/09-software/market-miner-provider-blueprint.md`
8. `docs/09-software/google-advertiser-miner-search-matrix.md`
9. `docs/09-software/outbound-sales-brain-data-contract.md`
10. `docs/09-software/market-miner-entity-resolution-spec.md`
11. `docs/09-software/market-miner-website-intelligence-spec.md`
12. `docs/09-software/vertical-profile-schema.md`
13. `docs/09-software/vertical-profiles/hvac.v1.yaml`
14. `docs/09-software/vertical-profiles/plumbing.v1.yaml`
15. `docs/09-software/outbound-sales-brain-scoring-research-fixtures.yaml`
16. `docs/09-software/outbound-sales-brain-offer-selection-spec.md`
17. `docs/09-software/outbound-sales-brain-call-pack-spec.md`
18. `docs/09-software/outbound-sales-brain-sales-manual-rag-spec.md`
19. `docs/09-software/outbound-sales-brain-campaign-replenishment-spec.md`
20. `docs/09-software/outbound-sales-brain-crm-followup-spec.md`
21. `docs/09-software/outbound-sales-brain-compliance-engine-spec.md`
22. `docs/09-software/outbound-sales-brain-roleplay-certification-spec.md`
23. `docs/09-software/outbound-sales-brain-realtime-voice-policy.md`
24. `docs/09-software/outbound-sales-brain-analytics-learning-spec.md`
25. `docs/09-software/outbound-sales-brain-admin-control-plane-spec.md`
26. `docs/09-software/outbound-sales-brain-security-operations-spec.md`
27. `docs/09-software/outbound-sales-brain-implementation-gates.md`
28. `docs/09-software/outbound-sales-brain-architecture-backlog.md`

## Canonical Sales Manual

29. `docs/07-sales/training-manual/README.md`
30. `docs/07-sales/training-manual/module-01-sales-doctrine.md`
31. `docs/07-sales/training-manual/module-03-discovery-and-financial-diagnosis.md`
32. `docs/07-sales/training-manual/module-03b-crm-fundamentals-for-salespeople.md`
33. `docs/07-sales/training-manual/module-04a-cold-calling-and-prospecting.md`
34. `docs/07-sales/training-manual/module-04c-prospect-qualification-and-target-scoring.md`
35. `docs/07-sales/training-manual/module-05-hooks-and-opening-angles.md`
36. `docs/07-sales/training-manual/module-07-objection-handling.md`
37. `docs/07-sales/training-manual/module-10-hvac-industry-playbook.md`
38. `docs/07-sales/training-manual/module-11-plumbing-industry-playbook.md`
39. `docs/07-sales/training-manual/module-39-roleplay-academy.md`
40. `docs/07-sales/training-manual/module-40-sales-management-and-coaching.md`

Do not substitute memory for reading these current source files.

---

# 3. CURRENT PROTOTYPE RULE

The existing `phone-agent/` code on `feature/outbound-sales-brain` was an early architecture prototype.

Treat it as disposable/reusable implementation material, NOT architectural authority.

You may:

- keep transport-level pieces that are genuinely useful;
- refactor;
- replace;
- delete obsolete code.

Do not contort the final design around the prototype.

---

# 4. DO NOT DO THESE THINGS

- Do not enable production autonomous dialing.
- Do not call real prospects during normal development.
- Do not submit fake service calls/forms/consultations/appointments.
- Do not commit secrets.
- Do not modify the production marketing website unless a separate explicit task requires it.
- Do not re-enable automatic GitHub Actions notifications without Michael's request.
- Do not merge to `main` without explicit review/request.
- Do not invent offers/pricing/case studies/results/integrations/ROI.
- Do not replace Module 4C with an opaque 0–100 fit score.
- Do not award ad points from a tracking pixel/tag.
- Do not treat “CRM signature not detected” as “no CRM.”
- Do not treat one Google search without an ad as “not advertising.”
- Do not call the same company multiple times because several queries found it.
- Do not put the entire Sales Manual into every live model turn.
- Do not make the LLM responsible for compliance/DNC decisions.
- Do not let a failed booking/transfer/email be described to a prospect as success.

---

# 5. GATE-DRIVEN BUILD

`outbound-sales-brain-implementation-gates.md` is mandatory.

Do not jump ahead because a later feature is more interesting.

For every gate report:

1. implementation/files changed;
2. tests added;
3. tests actually run locally;
4. result;
5. manual verification performed;
6. remaining blockers;
7. exact next gate.

---

# 6. GATE 0 — AUDIT FIRST, CHANGE NOTHING MATERIAL

Inspect:

- current branch/code;
- `phone-agent/` prototype;
- current Twilio/receptionist implementation;
- deployed `voice.youraidepartment.ai` runtime/configuration accessible from the EdgeXpert/server environment;
- persistence/database state;
- existing model/STT/TTS stack;
- current latency path;
- current callbacks/WebSockets;
- existing CRM/calendar/SMS/email code;
- current local test setup.

Produce written audit.

Specifically answer:

1. Which existing modules are reusable?
2. Which should be replaced?
3. What caused the previously observed 3–5 second voice pauses, if diagnosable?
4. What is the proposed component/file structure for the Market Miner first?
5. What DB/migration/queue stack will be used and why?
6. How will local tests run without GitHub Actions?

Stop and report before major implementation if you discover a conflict requiring product/architecture decision.

---

# 7. IMPLEMENT MARKET MINER BEFORE TWILIO

## Phase M1 — canonical data model

Implement `outbound-sales-brain-data-contract.md`.

Use durable DB/migrations.

Critical:

- Accounts separate from Locations/Contacts/Phones;
- immutable Evidence/Score/CallPack snapshots;
- SourceIdentity/provider lineage;
- ProviderUsage cost records;
- durable Suppression/attempt history.

Run Gate 1.

## Phase M2 — scoring + vertical loader

Implement canonical Module 4C score.

Load/validate HVAC and Plumbing YAML profiles.

Run every fixture in `outbound-sales-brain-scoring-research-fixtures.yaml`.

No hidden CRM points.

No research-completeness points mixed into fit score.

Run Gates 2–3.

## Phase M3 — geography / mining jobs

Implement:

- states/counties/places/ZCTA/CBSA source;
- search cells;
- MiningJob;
- query budget;
- target inventory;
- saturation/coverage state.

Use Census/reference data as designed.

## Phase M4 — Google advertiser provider

Before coding provider adapter, revalidate current:

- API docs;
- pricing;
- storage terms;
- authentication;
- response shapes.

Prototype preferred bulk path from provider blueprint.

Goal:

> Find current Google sponsored HVAC advertisers in Jacksonville/St. Augustine using the three-pass query matrix.

Store immutable observations.

Do not contact anyone.

Run Gate 4.

## Phase M5 — entity resolution

Implement conservative matching/merge model.

Run entity-resolution fixtures.

Audit real sample manually.

Run Gate 5.

## Phase M6 — website intelligence

Implement tiered fetch/render strategy and structured extraction.

Detect:

- services;
- 24/7;
- financing;
- CTAs;
- locations;
- hiring;
- leadership clues;
- GTM/GA4/Ads/Meta tracking;
- call tracking;
- CRM/field-service frontend signals.

Never submit forms.

Never infer active ads from pixels.

Run Gate 6.

## Phase M7 — prospect research / evidence / strategy

Create Evidence Ledger, ResearchCompleteness, OpportunityHypotheses, OfferHypotheses.

Every claim must trace to evidence.

Generate Call Pack according to spec.

## Phase M8 — first Market Miner milestone

Request:

> HVAC — Jacksonville + St. Augustine — advertiser-first — Tier B+ — target 100.

Return an honest deduplicated ranked set with:

- company/location;
- verified website/phone where available;
- fresh paid-ad evidence;
- score/tier with reasons;
- research completeness;
- website/CTA findings;
- CRM/system signals;
- primary/backup hypothesis;
- primary/backup hook;
- offer hypothesis;
- evidence timestamps;
- provider cost.

If the market only yields 63 matching prospects, return 63 and explain shortfall. Never silently lower criteria to hit 100.

Run Gate 7.

---

# 8. HUMAN-ASSIST BEFORE AUTONOMOUS

Build minimum internal control plane from admin spec:

- campaign/mining jobs;
- ranked prospect list;
- prospect evidence/score;
- Call Pack;
- rep assignment/lease;
- dispositions;
- follow-up;
- DNC/suppression;
- provider spend.

Brent/human rep should be able to use it before autonomous voice exists.

Run Gate 8.

This creates immediate business value and real labeled data.

---

# 9. SALES MANUAL RAG

Implement after Market Miner core is stable.

Index canonical Sales Manual using semantic headings + metadata + hybrid retrieval.

Create deterministic CommercialTruthSnapshot from launch decisions.

Run gold retrieval tests.

Run Gate 9.

---

# 10. CALL PACK STRATEGY ENGINE

Implement Call Pack generation and 15 worked examples.

Critical behavior:

- primary hook only uses fresh confirmed facts;
- hypotheses stay questions;
- existing CRM/receptionist/agency treated positively;
- no sale is valid;
- current offer/pricing truth only.

Run Gate 10.

---

# 11. TEXT ROLEPLAY BEFORE VOICE

Implement simulated prospect harness and QA grader.

Use roleplay certification spec.

Run Gate 11.

No telephony if truth/DNC/no-sale behavior is still unstable.

---

# 12. COMPLIANCE ENGINE

Implement deterministic policy engine separately from LLM.

Initial autonomous cold-AI policy remains disabled/review-required until approved.

Human-assist can still operate.

Run Gate 12.

---

# 13. REALTIME VOICE

Only now benchmark STT/LLM/TTS stacks.

Use `outbound-sales-brain-realtime-voice-policy.md`.

Measure actual audio experience, including p50/p95.

The previously observed 3–5 second ordinary response delays are not acceptable.

Run Gate 13.

---

# 14. TWILIO CONTROLLED TEST

Allowlisted test numbers only.

Verify:

- signed webhooks;
- realtime connection validation;
- answer/voicemail behavior;
- interruption cancellation;
- global kill switch;
- test allowlist.

Run Gate 14.

---

# 15. ACTION TOOLS / CRM

Implement deterministic:

- DNC;
- booking;
- transfer;
- email;
- SMS where approved;
- human follow-up;
- CRM/outbox;
- manual retrieval;
- business-case calculation.

Use CRM follow-up spec and security operations spec.

Run Gate 15.

---

# 16. AUDIO CERTIFICATION

Run roleplay personas through controlled voice stack.

No real prospects.

Run Gate 16.

---

# 17. REAL PROSPECT PILOT

DO NOT START THIS YOURSELF.

Stop and present:

- Market Miner results;
- test evidence;
- QA scores;
- latency metrics;
- compliance/policy state;
- recommended pilot size/campaign.

Michael must explicitly approve moving into Gate 17 real-prospect micro-pilot.

---

# 18. FIRST VERTICALS

Engineering priority:

1. HVAC
2. Plumbing

Do not build 30 industry profiles in code before these work.

The machine-readable profile schema is designed for later expansion from the existing Sales Manual.

---

# 19. CURRENT COMMERCIAL TRUTH

Read `docs/00-company/launch-decisions.md` directly.

Do not hard-code old pricing.

Current architecture includes:

- AI Department Assessment — free;
- AI Strategy Call — free;
- Executive AI Strategy — approximately $5,000+ starting depending scope;
- AI Implementation — approximately $5,000–$50,000+ depending scope;
- AI Growth Systems — custom;
- Managed AI Department — custom monthly retainer;
- Calendly is current scheduling provider;
- Stripe is current payment provider for paid appointments.

If source changes, source wins.

---

# 20. FINAL ENGINEERING PRINCIPLE

The core advantage is not “an AI that can dial.”

It is:

`Google/market demand signal`
-> `company identity`
-> `independent website/business research`
-> `evidence ledger`
-> `YAD fit score`
-> `problem/offer hypothesis`
-> `Sales Manual strategy`
-> `ranked human/approved call queue`
-> `conversation`
-> `structured outcome`
-> `learning`

Build that chain cleanly.

Do not optimize the final Twilio step while the upstream prospect supply is still noisy.

---

# 21. EXACT FIRST COMMAND / TASK

Start with:

> Read the full handoff and every required architecture file. Execute Gate 0 only. Audit the current repo, `phone-agent/` prototype, existing Twilio/receptionist implementation, runtime/deployment, persistence, and local test workflow. Do not enable production dialing, do not call prospects, and do not re-enable automatic GitHub Actions. Then present the Gate 0 audit plus the proposed Market Miner implementation structure before starting Gate 1.
