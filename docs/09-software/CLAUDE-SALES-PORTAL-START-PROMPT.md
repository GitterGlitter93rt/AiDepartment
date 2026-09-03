# Claude Code Start Prompt — YAD Sales Portal / Prospect Inventory

Use this prompt to begin implementation on the EdgeXpert.

---

Read these files first, in this exact order:

1. `CLAUDE.md`
2. `brain/README.md`
3. `brain/TODO.md`
4. `docs/09-software/SALES-TEAM-ACCESS-CURRENT.md`
5. `docs/09-software/outbound-sales-brain-rep-inventory-browse-claim-spec.md`
6. `docs/09-software/outbound-sales-brain-rep-portal-ui-ux-spec.md`
7. `docs/09-software/outbound-sales-brain-edge-xpert-sales-portal-deployment-spec.md`
8. `docs/09-software/outbound-sales-brain-rep-inventory-contract.v1.yaml`
9. `docs/09-software/OUTBOUND-SALES-BRAIN-V1-CURRENT.md`
10. the supporting Market Miner / canonical Account / RBAC / prospect-memory specs referenced by the current manifest.

Then execute an implementation audit before changing code.

## Current business objective

Build a sleek internal web application at a secure address such as:

`sales.youraidepartment.ai`

The EdgeXpert should continuously build/research prospect inventory in the background.

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

If a ZIP search lacks enough current research, show existing inventory immediately and schedule additional Market Miner research in the background.

## First implementation milestone

Get two internal sales reps successfully using the same canonical prospect inventory.

Required V1 flow:

1. Rep authenticates.
2. Opens Find Prospects.
3. Searches `HVAC + 32256`.
4. Filters to `Tier B+`, `Unclaimed`, and optionally current advertiser/contactability signals.
5. Selects multiple Accounts.
6. Clicks `Claim to Me`.
7. Atomic ownership prevents a second rep from claiming those same Accounts.
8. Claimed Accounts appear in My Prospects.
9. Rep can open Account detail and see:
   - company;
   - location;
   - Tier/score;
   - advertiser evidence;
   - best POC/role;
   - phone/email endpoint quality;
   - why this company is relevant;
   - primary hypothesis;
   - suggested first question;
   - do-not-claim warnings;
   - shared timeline.
10. Rep can record basic dispositions, callback, wrong number, and DNC.
11. Ownership/callback/DNC persist after process restart.
12. Manager can see ownership and reassign with audit history.

## UI direction

Do not make this look like Airtable, a raw database admin page, or an engineering dashboard.

Use a polished SaaS-style interface with the existing YAD brand primitives.

Primary pages:

- Overview
- Find Prospects
- Markets
- My Prospects
- Account Detail
- Follow-Ups
- Manager Team

The hero workflow is Find Prospects -> select -> Claim to Me.

## Deployment direction

Initial application/research runtime belongs on the EdgeXpert.

Keep realtime Twilio/voice workloads separate at `voice.youraidepartment.ai`.

Do not put heavy crawling/mining jobs on the realtime voice process.

Do not put provider credentials in the browser.

A rep ZIP search queries PostgreSQL/canonical inventory first; background Market Miner workers perform additional research server-side.

## Important constraints

- Do not enable autonomous production dialing.
- Do not call real prospects as part of implementation/testing.
- Do not re-enable automatic GitHub Actions; CI remains manual-only unless Michael explicitly approves otherwise.
- Do not merge to `main` without review.
- Work locally on EdgeXpert and test locally first.
- Do not expose secrets.
- Do not build a second prospect database separate from canonical Account state.
- Do not implement ownership only in frontend state.
- Do not let two reps cold-own the same Account.
- Do not allow DNC/client/active-opportunity Accounts into generic unclaimed cold inventory.
- Do not treat missing evidence as a negative fact.
- Do not hard-code current commercial pricing/offers outside the Commercial Truth authority.

## Audit report required before implementation

Report:

1. existing repo application structure relevant to an internal portal;
2. whether a separate app/package is preferable to extending the marketing Astro app;
3. current database code/schema available for reuse;
4. current authentication code available for reuse;
5. current `phone-agent/` code that should or should not be reused;
6. EdgeXpert current services/processes/ports;
7. PostgreSQL availability/current state;
8. existing reverse proxy/tunnel/DNS configuration that can be reused safely;
9. the simplest secure path for `sales.youraidepartment.ai`;
10. proposed file/package structure;
11. proposed database migration sequence;
12. proposed implementation phases and estimated dependencies;
13. blockers requiring Michael credentials/accounts/decisions.

Do not ask Michael questions that the repository/server audit can answer.

## Then implement in this order

### Gate S0 — Audit only

No production behavior changes.

### Gate S1 — Canonical sales data foundation

- Account/Contact ownership state
- RBAC/auth
- durable activity timeline
- DNC/callback/disposition persistence
- import existing lists

### Gate S2 — Rep portal

- Overview shell
- Find Prospects
- My Prospects
- Account detail
- Claim to Me
- manager ownership view

Use synthetic/imported test data first.

### Gate S3 — Secure internal deployment

- process supervision
- secure HTTPS/tunnel/reverse proxy
- `sales.youraidepartment.ai`
- backup/restore minimum
- health checks

### Gate S4 — Market Miner inventory connection

- saved markets
- cached inventory search
- on-demand ZIP research requests
- background refresh/replenishment

### Gate S5 — Contact/email coordination

- contact endpoint quality
- Smartlead export/sync when canonical state is ready

### Gate S6 — Two-rep pilot

Run the browse/search/claim acceptance tests with two internal users.

Only after these gates are working should the team spend serious time connecting autonomous voice.

## Phase reporting

After every gate, report:

- files changed;
- migrations/schema changes;
- commands/tests run;
- test results;
- screenshots/manual UI verification if possible;
- security checks;
- blockers;
- next exact gate.

The near-term success condition is simple:

**EdgeXpert continuously owns the researched prospect pool. Reps search the territory they want, claim companies to themselves, and work those Accounts from one clean shared YAD sales portal.**
