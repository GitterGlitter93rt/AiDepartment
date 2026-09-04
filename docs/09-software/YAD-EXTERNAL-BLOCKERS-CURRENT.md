# YAD SALES BRAIN — EXTERNAL BLOCKERS CURRENT

**Status:** Current external dependency register  
**Date:** 2026-09-03  
**Architecture owner:** ChatGPT  
**Implementation owner:** Claude Code  
**Business owner:** Michael Chanata

This file distinguishes real external dependencies from engineering work Claude can continue without Michael.

If an older implementation log still lists direct Outlook/Azure Graph or manual filesystem lead drops as primary blockers, this file supersedes those assumptions.

---

# 1. NOT A CURRENT PRIMARY BLOCKER — AZURE GRAPH

The V1 booking authority is now **Cal.com**, not direct Microsoft Graph.

Existing Graph adapter work may remain as an alternate/future provider, but real V1 booking does not require Michael to create a dedicated Azure app registration first.

Current flow:

`YAD -> Cal.com -> Michael's connected Outlook calendar -> Cal Video`.

External requirement instead:

- Michael connects the correct Microsoft 365 calendar inside Cal.com;
- YAD receives Cal.com API credentials/config;
- current YAD 15-minute event type exists/configured.

---

# 2. B-1 — CAL.COM LIVE CONFIGURATION

Needed for real booking:

- Cal.com account accessible to Michael/YAD;
- `michael@youraidepartment.ai` Outlook calendar connected in Cal.com;
- `YAD 15-Minute AI Strategy Call` event type created/configured;
- Cal Video selected;
- API credential/token for server-side booking;
- event type ID/slug/config;
- working hours/minimum notice/buffers reviewed.

Claude can continue without credential:

- adapter code;
- fake/provider fixture tests;
- UI;
- booking state model;
- webhook inbox;
- reconciliation tests.

Claude should ask Michael only after the adapter/settings UI is ready to accept the credential/config.

---

# 3. B-2 — CAL.COM PUBLIC WEBHOOK INGRESS

Cal.com SaaS webhooks require a public HTTPS subscriber URL; tailnet/private localhost alone is insufficient.

Need one narrow public ingress such as:

- `hooks.youraidepartment.ai` through Cloudflare/public edge;
- narrowly exposed webhook route on an existing public YAD host;
- voice VPS webhook gateway relaying privately to EdgeXpert.

Do **not** expose the internal CRM broadly just to receive webhooks.

Claude can continue without final DNS:

- signed webhook fixtures;
- durable inbox;
- idempotent processor;
- reconciliation poller;
- health UI.

Michael action only if required:

- DNS/Cloudflare account change;
- approve/use existing public VPS/hostname.

---

# 4. B-3 — MARKET MINER SERP PROVIDER CREDENTIALS

Current first implementation/benchmark provider:

`DataForSEO`.

Needed for live new-business discovery:

- DataForSEO account;
- API login/password/credential;
- small approved test spend/budget ceiling.

Claude can continue without credential:

- adapter implementation;
- fixture parser;
- task queue flow;
- provider usage accounting;
- Standard vs Live routing;
- market-query fingerprint/cache;
- synthetic/provider-response tests.

Do not buy provider volume or run broad searches before spend control exists.

---

# 5. B-4 — PRODUCTION PHONE SCREENING / DNC SOURCE

This is a **real autonomous AI voice blocker**.

Provider interface and internal YAD suppression can be implemented/tested without a live external registry source.

For production AI cold calling, YAD needs an approved current screening source/configuration such as:

## Direct FTC National DNC path

Potential requirements:

- seller/telemarketer registration as applicable;
- Subscription Account Number (SAN);
- subscribed area codes;
- Registry file access;
- secure ingestion/synchronization.

or

## Vetted commercial compliance provider

Must be verified for needed coverage/terms, potentially including:

- federal DNC;
- applicable state lists/rules;
- line-type/wireless data where used by policy;
- reassigned-number or other screening where required;
- calling time/holiday rules where offered;
- reliable API/audit semantics.

Current architecture reference:

`outbound-sales-brain-dnc-provider-selection-current.md`.

Do not substitute FTC unwanted-call complaint data for National Registry membership.

Claude can continue without production credential:

- provider interface;
- fixture/mock provider;
- internal DNC;
- human-vs-AI channel split;
- cache/TTL;
- fail-closed behavior;
- pilot UI showing blocked/review state.

Real autonomous AI prospect calls remain blocked until exact targets have valid current eligibility under configured policy/data.

---

# 6. B-5 — REAL YAD PROSPECT DATA / LISTS

The import pipeline no longer requires SSH/filesystem handoff.

Preferred flow:

`CRM -> Imports -> upload CSV/export -> map -> preview -> dedupe -> suppression/ownership conflicts -> confirm`.

Michael/sales team still needs to provide actual source files when they want those historical lists loaded, for example:

- Jacksonville/St. Augustine list;
- Airtable export;
- Apollo export;
- prior prospect spreadsheets.

This does not block Market Miner/provider implementation.

Import must never automatically initiate outreach.

---

# 7. B-6 — SALES PORTAL ACCESS OUTSIDE TAILNET

Current secure internal pilot can use Tailscale if both reps' devices are enrolled/approved.

If Brent/other reps need normal browser access without Tailscale, choose/configure a secure public access path, likely:

- Cloudflare Tunnel / Access;
- another approved authenticated reverse proxy.

Requirements:

- HTTPS;
- app auth remains enforced;
- Postgres never public;
- no shared sales password;
- audit/RBAC preserved.

This does not block EdgeXpert-local/internal testing.

---

# 8. B-7 — VOICE VPS ACCESS / RUNTIME AUDIT

Before production outbound voice implementation, Claude needs access to inspect the actually deployed working demo/receptionist on `voice.youraidepartment.ai`.

Need, if not already available to EdgeXpert/Claude session:

- SSH/deployment access or equivalent runtime visibility;
- current service/process locations;
- non-secret configuration visibility;
- ability to run controlled internal/allowlisted tests.

Claude should reuse proven voice plumbing where appropriate rather than rewriting from prototype assumptions.

This blocks production voice transport integration, not Sales Brain/CRM/Call Pack development.

---

# 9. B-8 — TWILIO LIVE PRODUCTION CONFIG

Before controlled outbound voice can place an approved call, runtime needs valid server-side Twilio configuration such as:

- account credentials/API auth;
- approved caller number/business identity;
- TwiML/ConversationRelay routing;
- webhook/signature configuration;
- selected Demo / Production Inbound / Production Outbound mode;
- voice configuration;
- required reputation/configuration work when applicable.

Do not put Twilio credentials into GitHub or browser UI.

Existing demo configuration should be audited/reused where possible.

---

# 10. WHAT CLAUDE SHOULD NOT WAIT FOR

Continue autonomously on:

- complete CRM UI waves;
- shared component/read models;
- Sales AI roleplay/objection/hook fixtures;
- meeting outcome feedback;
- DataForSEO adapter with fixtures;
- Cal.com adapter with fake server/tests;
- webhook inbox/processor;
- public ingress code/config templates;
- spoken normalization;
- voice benchmark harness;
- DNC provider interface/mocks;
- import UI;
- analytics schema/UI;
- Account/Opportunity/Meeting workflow.

Do not stop and ask Michael for a credential before the receiving code/UI/test is ready.

---

# 11. WHAT MICHAEL WILL EVENTUALLY NEED TO DO

Likely small action set:

1. connect/configure Cal.com + Outlook + Cal Video;
2. supply Cal.com API credential/event type values securely;
3. approve/configure narrow public webhook ingress/DNS if needed;
4. create/fund DataForSEO test account and supply credential securely;
5. provide/choose production DNC screening source credentials/access;
6. upload any historical prospect lists desired;
7. ensure reps can access portal via Tailscale or approve public Access path;
8. provide Claude deployment access to voice VPS if not already available;
9. approve the exact controlled real-call pilot only after release report says eligible.

---

# 12. CORE RULE

**Engineering continues until an external account, credential, DNS change, provider subscription or explicit business approval is genuinely required. Claude should make each external ask small, specific and ready to use immediately.**
