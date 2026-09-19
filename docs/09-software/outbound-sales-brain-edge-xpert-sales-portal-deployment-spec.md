# YAD Sales Brain — EdgeXpert Sales Portal Deployment Specification

**Status:** Deployment architecture authority  
**Implementation owner:** Claude Code on EdgeXpert  
**Purpose:** Host the internal sales portal and Market Miner on the EdgeXpert while keeping the realtime Twilio voice runtime isolated.

---

# 1. TARGET SHAPE

Initial deployment:

`sales.youraidepartment.ai`
-> secure edge/tunnel/reverse proxy
-> EdgeXpert internal sales application
-> Sales Brain API
-> PostgreSQL
-> background workers
-> Market Miner provider adapters.

Separate voice deployment:

`voice.youraidepartment.ai`
-> voice VPS
-> Twilio webhooks / realtime voice gateway.

Do not make the marketing website process host heavy research workers.

Do not make the voice gateway host heavy research/crawling workers.

---

# 2. EDGE XPERT RESPONSIBILITIES

EdgeXpert should initially run:

- internal sales web app;
- authenticated Sales Brain API;
- Market Miner orchestration;
- website-research workers;
- contact-enrichment jobs;
- evidence normalization;
- scoring/hypothesis generation;
- worklist/inventory queries;
- durable job scheduler/worker runtime;
- connection to PostgreSQL;
- provider clients;
- application logs/metrics.

Provider credentials remain server-side.

---

# 3. PUBLIC ACCESS MODEL

Sales reps should access the application through a normal HTTPS URL such as:

`https://sales.youraidepartment.ai`

Preferred initial exposure:

- outbound tunnel or equivalent secure reverse-proxy architecture;
- no direct exposure of database ports;
- no public SSH requirement for reps;
- HTTPS required;
- authentication required before any sales data is shown.

The exact tunnel/provider may be chosen during implementation audit. Cloudflare Tunnel is a strong initial candidate if it fits existing DNS/control, but this specification is provider-neutral.

---

# 4. INTERNAL SERVICE BOUNDARIES

Recommended logical services:

## Web / Portal

Rep-facing UI.

Must not contain provider secrets.

## Sales Brain API

Handles:

- authentication/session validation;
- search/filter inventory;
- Account detail;
- claim/release/assignment;
- dispositions;
- follow-ups;
- manager controls;
- mining requests;
- Smartlead integration endpoints;
- audit events.

## Background Job Runtime

Handles:

- territory discovery;
- provider SERP jobs;
- website crawling;
- enrichment;
- research refresh;
- dedupe/entity resolution;
- scoring;
- evidence TTL refresh;
- contact research.

## PostgreSQL

Canonical durable state.

## Optional queue/cache

Use only if implementation needs it; do not require a separate component merely because the architecture names jobs/queues.

---

# 5. DATABASE PLACEMENT

For same-day/MVP, PostgreSQL may run on EdgeXpert if operationally acceptable and backed up.

Longer term, consider moving the canonical database to a managed/central server if:

- multiple worker nodes are added;
- EdgeXpert uptime/network becomes a bottleneck;
- backup/recovery requirements justify it;
- external integrations need more reliable public API access.

Do not split canonical Account state between EdgeXpert and voice VPS databases.

There should be one canonical Account/Contact/Relationship state.

---

# 6. VOICE VPS INTEGRATION

The voice VPS should consume prepared prospect intelligence, not perform heavy research.

When controlled/autonomous calling is eventually enabled:

Voice runtime requests:

- Account identity;
- Call Pack;
- current contact endpoint;
- current relationship state;
- compliance decision;
- relevant follow-up/meeting context.

The Voice Gateway should never begin crawling a prospect site during the greeting path.

This protects latency and keeps research/provider failures away from live audio.

---

# 7. REP SEARCH FLOW

Rep browser:

`Find Prospects: HVAC + 32256`

-> Sales Brain API

-> PostgreSQL inventory query

-> return existing results immediately.

If research is incomplete:

-> API creates Market Miner background job

-> EdgeXpert workers research the territory

-> durable inventory is updated

-> frontend receives/polls for new results.

The browser does not contain DataForSEO/SerpApi/Apollo credentials and does not directly scrape Google.

---

# 8. AUTHENTICATION

V1 must have individual user accounts.

Minimum roles:

- SALES_REP
- SALES_MANAGER
- RESEARCH_OPS
- ADMIN

No shared "sales" password as the long-term design.

Session/auth implementation may use an appropriate established framework/library after Claude audits the current stack.

Required:

- secure password/session handling;
- logout;
- role enforcement server-side;
- ownership checks server-side;
- audit actor ID;
- admin disable user.

Optional later:

- Google/Microsoft SSO;
- MFA;
- IP/device policies.

---

# 9. NETWORK / SECRET RULES

Never expose publicly:

- Postgres port;
- Redis/queue port if used;
- provider admin ports;
- local worker debug endpoints;
- environment files;
- provider API keys.

Public application surface should be limited to the reverse-proxied authenticated web/API endpoints required for operation.

SSH should remain separately controlled and not share ordinary rep authentication.

---

# 10. BACKUP / RECOVERY

At minimum before reps rely on this operationally:

- scheduled PostgreSQL backups;
- backup location separate from the live database disk where practical;
- restore procedure documented/tested;
- configuration/secrets recovery procedure;
- application source in GitHub;
- no critical ownership/DNC/follow-up data stored only in browser/local files.

Critical durable data includes:

- Accounts;
- Contacts;
- ownership;
- DNC/suppression;
- callbacks/follow-ups;
- opportunity/client state;
- evidence/source references;
- activity timeline.

---

# 11. PROCESS SUPERVISION

Application and workers must restart automatically after reboot/crash.

Claude should select the simplest reliable mechanism appropriate to the final stack, such as systemd/container orchestration/process supervisor.

Required services should expose health checks.

Do not depend on someone leaving a terminal session open.

---

# 12. OBSERVABILITY

Operator should be able to determine:

- portal healthy/unhealthy;
- API healthy;
- database healthy;
- worker backlog;
- research jobs failing;
- provider rate/cost failures;
- last successful Market Miner run;
- number of new Accounts today;
- contact-enrichment failures;
- stale evidence backlog.

Rep UI should not expose raw infrastructure logs.

---

# 13. FAILURE BEHAVIOR

## EdgeXpert internet outage

Portal may become temporarily unavailable in initial deployment.

No Account state should be corrupted.

Workers resume safely after reconnection.

## Provider outage

Existing researched inventory remains usable according to freshness rules.

Do not turn unavailable provider into `not advertising` or `no contact` claims.

## Worker crash

Lease/retry job safely.

## Portal frontend crash

No ownership/activity state should be lost because state is committed server-side first.

## Voice VPS outage

Human sales portal/mining should remain operational.

## EdgeXpert outage once voice exists

Voice system should fail safely rather than invent missing Call Pack/account state. Long-term architecture may move core API/database to always-on infrastructure if this dependency becomes unacceptable.

---

# 14. SAME-DAY DEPLOYMENT PRIORITY

If rolling out quickly, prefer this sequence:

1. establish Postgres/schema;
2. implement auth/RBAC;
3. implement inventory browse/search;
4. implement Account detail;
5. implement atomic Claim to Me;
6. implement My Prospects;
7. implement dispositions/callback/DNC;
8. import existing prospect lists;
9. expose portal securely at `sales.youraidepartment.ai`;
10. test with two internal reps;
11. add/enable Market Miner provider adapters;
12. let 24/7 workers replenish inventory.

This allows salespeople to work existing researched/imported leads even before every mining provider is online.

---

# 15. DO NOT BLOCK SAME-DAY VALUE ON PERFECT AUTOMATION

If the web portal, Account model, claiming, ownership and existing-list import are working, reps can begin using the system.

The Market Miner can deepen/replenish inventory incrementally.

Do not delay the human sales portal merely because autonomous Twilio, every vertical, Meta research, or every enrichment provider is not complete.

---

# 16. ACCEPTANCE

Deployment is acceptable for an initial internal pilot when:

- two named reps can securely log in from separate devices;
- both can search existing inventory;
- a rep can search by ZIP + vertical;
- Claim to Me is atomic;
- My Prospects persists across restart;
- DNC persists and is globally enforced in UI queries;
- callbacks persist;
- manager can see/reassign ownership;
- provider credentials are not exposed in browser;
- imported leads and mined leads resolve into the same Account model;
- heavy research work is not running on the voice gateway;
- no automated real prospect calls are enabled.