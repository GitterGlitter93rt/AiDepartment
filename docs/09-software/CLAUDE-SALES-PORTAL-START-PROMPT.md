# Claude Code Start Prompt — YAD Sales Portal / Prospect Inventory

**Current date:** 2026-09-03  
**Implementation environment:** EdgeXpert  
**Branch:** `feature/outbound-sales-brain`

Use this file as the start point for the immediate rep-access implementation.

---

# 1. READ ORDER

Read these files first, in this order:

1. `CLAUDE.md`
2. `brain/README.md`
3. `brain/TODO.md`
4. `docs/09-software/SALES-TEAM-ACCESS-CURRENT.md`
5. `docs/09-software/CLAUDE-TODAY-SALES-BRAIN-BUILD-BRIEF.md`
6. `docs/09-software/outbound-sales-brain-rep-inventory-browse-claim-spec.md`
7. `docs/09-software/outbound-sales-brain-rep-portal-ui-ux-spec.md`
8. `docs/09-software/outbound-sales-brain-rep-portal-visual-system.md`
9. `docs/09-software/outbound-sales-brain-edge-xpert-sales-portal-deployment-spec.md`
10. `docs/09-software/outbound-sales-brain-rep-inventory-contract.v1.yaml`
11. `docs/09-software/outbound-sales-brain-public-decision-maker-resolution-spec.md`
12. `docs/09-software/outbound-sales-brain-public-contact-source-registry.v1.yaml`
13. `docs/09-software/outbound-sales-brain-public-contact-resolution-fixtures.v1.yaml`
14. `docs/09-software/outbound-sales-brain-contact-waterfall-spec.md`
15. `docs/09-software/outbound-sales-brain-contact-endpoint-quality-spec.md`
16. `docs/09-software/outbound-sales-brain-decision-maker-routing-spec.md`
17. `docs/09-software/OUTBOUND-SALES-BRAIN-V1-CURRENT.md`
18. supporting canonical Account / RBAC / ownership / prospect-memory / Market Miner specs referenced by the manifests.

Do not begin by coding the Twilio caller.

---

# 2. CURRENT BUSINESS OBJECTIVE

Build a sleek internal web application at a secure address such as:

`sales.youraidepartment.ai`

The EdgeXpert continuously builds/researches prospect inventory in the background.

Sales reps do NOT primarily receive a forced queue.

They should be able to:

- browse precompiled researched markets;
- search a ZIP/city/market + vertical;
- filter existing inventory;
- inspect ranked prospects;
- select one or many;
- click `Claim to Me`;
- work claimed Accounts from `My Prospects`;
- call/email/Smartlead/follow up;
- share one canonical Account history with other reps.

If a ZIP search lacks enough current inventory, show existing results first and schedule additional Market Miner research in the background.

---

# 3. CONTACT PRODUCT DECISION — PUBLIC FIRST

Apollo is NOT required for the immediate product.

Default:

`contact_enrichment_mode = PUBLIC_ONLY`

YAD should resolve decision-makers/roles from:

- company first-party website/team/contact pages;
- approved public company/entity records;
- approved public licensing/professional records;
- bounded search-indexed public business evidence;
- explicit public business endpoints;
- gatekeeper/prospect corrections after human contact.

A valid result can be:

> `John Smith — Owner; official company main line; ask for John.`

or:

> `Named person not verified; target Operations/GM; official company main line.`

Do NOT block Human Assist because a direct mobile number is unavailable.

Paid contact providers may later be optional adapters for incremental direct phone/email fill.

Hard rules:

- registered agent != owner by default;
- license qualifier != operational workflow owner by default;
- company main line != named person's direct line;
- guessed email != verified email;
- stale third-party contact must not overwrite fresh prospect/company evidence;
- no sensitive unrelated personal-data enrichment.

---

# 4. FIRST IMPLEMENTATION MILESTONE

Get two internal sales reps successfully using the same canonical prospect inventory.

Required V1 flow:

1. Rep authenticates.
2. Opens Find Prospects.
3. Searches `HVAC + 32256`.
4. Filters to `Tier B+`, `Unclaimed`, and useful advertiser/contactability signals where data exists.
5. Selects multiple Accounts.
6. Clicks `Claim to Me`.
7. Atomic ownership prevents a second rep from claiming those same Accounts.
8. Claimed Accounts appear in My Prospects.
9. Rep opens Account detail and sees:
   - company/location;
   - Tier/score if available;
   - advertiser evidence if available;
   - best POC or target role;
   - role/currentness evidence class;
   - phone endpoint type/quality/source;
   - email endpoint type/quality/source;
   - why this company is relevant;
   - primary hypothesis if researched;
   - suggested first question if available;
   - do-not-claim warnings;
   - shared timeline.
10. Rep can record disposition, callback, wrong number, and DNC.
11. Ownership/callback/DNC persist after restart.
12. Manager can see ownership and reassign with audit history.

---

# 5. UI DIRECTION

Do not make this look like Airtable, a raw database admin page, or an engineering dashboard.

Use the polished YAD visual system and the existing UI specs.

Primary pages:

- Overview
- Find Prospects
- Markets
- My Prospects
- Account Detail
- Follow-Ups
- Manager Team.

Hero workflow:

`Find Prospects -> filter -> inspect -> select -> Claim to Me`.

Important contact UI:

- visually distinguish `Direct business line` from `Official company main line`;
- show `Ask for Sarah` when routing through main line;
- show public/provider/prospect source semantics without clutter;
- show `Decision maker not verified — ask for Operations/GM` honestly;
- support filters such as `Named POC`, `Direct Phone`, `Any Business Phone`, `Email`, `Phone + Email`.

If a direct-phone filter returns 28 Accounts, return 28. Do not pad with front-desk numbers mislabeled as direct.

---

# 6. DEPLOYMENT DIRECTION

Initial application/research runtime belongs on the EdgeXpert.

Keep realtime Twilio/voice workloads separate at:

`voice.youraidepartment.ai`

Do not put heavy crawling/mining jobs on the realtime voice process.

Do not put provider credentials in browser code.

A rep ZIP search queries PostgreSQL/canonical inventory first; background Market Miner workers perform additional research server-side.

Target secure portal address:

`sales.youraidepartment.ai`

Use the safest path supported by the actual EdgeXpert network audit (for example secure tunnel/reverse proxy). Do not expose Postgres or worker/debug ports publicly.

---

# 7. IMPORTANT CONSTRAINTS

- Do not enable autonomous production dialing.
- Do not call real prospects as implementation tests.
- Do not auto-email real prospects as implementation tests.
- Do not re-enable automatic GitHub Actions; CI remains manual-only unless Michael explicitly approves otherwise.
- Do not merge to `main` without review.
- Work/test locally on EdgeXpert first.
- Do not expose secrets.
- Do not build a second prospect database separate from canonical Account state.
- Do not implement ownership only in frontend state.
- Do not let two reps cold-own the same Account.
- Do not allow DNC/client/active-opportunity Accounts into generic unclaimed cold inventory.
- Do not treat missing evidence as a negative fact.
- Do not hard-code current commercial pricing/offers outside Commercial Truth authority.
- Do not make Apollo credentials a prerequisite for the portal/miner.
- Do not bypass source login/CAPTCHA/rate-limit/anti-bot controls.

---

# 8. AUDIT REPORT REQUIRED BEFORE IMPLEMENTATION

Report:

1. existing repo application structure relevant to an internal portal;
2. whether a separate app/package is preferable to extending the marketing Astro app;
3. current database code/schema available for reuse;
4. current authentication code available for reuse;
5. current `phone-agent/` code that should or should not be reused;
6. EdgeXpert current services/processes/ports;
7. PostgreSQL availability/current state;
8. reverse proxy/tunnel/DNS configuration available for safe reuse;
9. simplest secure path for `sales.youraidepartment.ai`;
10. proposed file/package structure;
11. proposed database migration sequence;
12. current existing prospect lists/import paths available on machine/repo;
13. feasible first-party/public contact-research adapters;
14. what public-source adapters require source/terms validation before automation;
15. implementation phases/dependencies;
16. blockers requiring Michael credentials/accounts/decisions.

Do not ask Michael questions the repository/server audit can answer.

---

# 9. IMPLEMENTATION GATES

## Gate S0 — Audit only

No production behavior changes.

## Gate S1 — Canonical sales data foundation

- Account/Location/Contact/Endpoint
- Account ownership
- RBAC/auth
- durable timeline
- DNC/callback/disposition persistence
- import existing lists.

## Gate S2 — Rep portal

- Overview shell
- Find Prospects
- Markets basic view
- My Prospects
- Account detail
- Claim to Me / Claim Selected
- manager ownership view
- mobile essential flows.

Use synthetic/imported test data first.

## Gate S3 — Secure internal deployment

- process supervision
- HTTPS/tunnel/reverse proxy
- `sales.youraidepartment.ai`
- backup/restore minimum
- health checks.

## Gate S4 — Public contact resolution

- company first-party team/contact research
- public-source adapter interface
- bounded role-search planner
- evidence reconciliation
- endpoint classification
- named-mainline / role-mainline fallback
- on-demand `Research Contact`
- regression fixtures.

Default stays `PUBLIC_ONLY`.

## Gate S5 — Market Miner inventory connection

- Saved Markets
- cached inventory search
- on-demand ZIP research
- Google advertiser discovery adapter after provider/source review
- website research
- refresh/replenishment.

## Gate S6 — Email coordination

- contact endpoint readiness
- Smartlead export/sync when canonical state is ready.

## Gate S7 — Two-rep pilot

Run browse/search/claim/contact/disposition acceptance tests with two internal users.

Only after these gates work should autonomous voice receive serious implementation time.

---

# 10. PHASE REPORTING

After every gate report:

- files changed;
- migrations/schema changes;
- commands/tests run;
- test results;
- screenshots/manual UI verification where possible;
- security checks;
- public contact-resolution fixture results where relevant;
- blockers;
- next exact gate.

Do not report a gate complete merely because code compiles.

---

# 11. NEAR-TERM SUCCESS CONDITION

**EdgeXpert owns a growing researched prospect pool. Reps search the ZIP/market they want, claim companies to themselves, and immediately see the strongest truthful decision-maker/contact route available from one polished shared YAD sales portal — without requiring Apollo and without waiting for autonomous Twilio.**
