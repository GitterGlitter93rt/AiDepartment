# CLAUDE CODE — CURRENT EXTERNAL BLOCKERS

**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Purpose:** Separate real external prerequisites from work Claude can continue autonomously.

This supersedes older blocker wording when later architecture intentionally changed the provider/path.

---

# 1. BOOKING

## Old blocker

Azure/Microsoft Graph application credentials were previously listed as the V1 blocker.

## Current decision

Cal.com is the V1 scheduling authority. The existing Graph adapter can remain as an alternate/future adapter.

### External setup Michael/admin eventually supplies

- Cal.com account
- Outlook calendar `michael@youraidepartment.ai` connected inside Cal.com
- `YAD 15-Minute AI Strategy Call` event type
- Cal Video location
- Cal.com server API key/credential
- event type ID/reference

### Claude can do before credentials

- implement `CalComBookingAdapter`
- fake adapter tests
- Settings UI
- idempotency/reconciliation/webhook model
- canonical booking writes
- fallback behavior

Do not wait for Azure credentials to finish current booking implementation.

---

# 2. REAL PROSPECT LISTS

## Old blocker

No real CSV/XLSX lists existed on the EdgeXpert filesystem.

## Current UX solution

The CRM `Imports & Data Sources` page should make this a normal product workflow rather than requiring Michael to SSH/drop files.

### Claude can do now

- browser CSV upload to server-side temporary/import storage
- mapping wizard
- normalization preview
- dedupe/identity result preview
- suppression/ownership conflict preview
- confirm import
- import result summary

### Michael action later

Upload/export the actual Airtable/CSV/Apollo/local lists through the portal once the page is available.

No import triggers outreach.

---

# 3. MARKET MINER SERP PROVIDER

## Current first provider

DataForSEO is the first provider to integrate/benchmark under:

`market-miner-serp-provider-selection-current.md`

### External setup Michael/admin eventually supplies

- DataForSEO account
- API login/password/approved server credential
- source-governance approval after terms review
- initial budget cap

### Claude can do before credentials

- adapter implementation
- fixture/fake provider tests
- normalization
- provider usage/cost records
- durable job integration
- budget/circuit-breaker logic
- Settings UI

When credential arrives, run bounded Jacksonville/St. Augustine HVAC benchmark before scale.

---

# 4. SALES PORTAL ACCESS

## Current state

EdgeXpert/Tailscale can support a secure internal pilot without opening a public database or waiting for public DNS.

### Near-term path

Use the safest existing private/tailnet HTTPS route for internal testing.

### Later public-friendly path

If Michael wants reps to use `sales.youraidepartment.ai` from ordinary/unmanaged devices, configure an approved secure tunnel/reverse-proxy path plus application auth/RBAC.

### External action later

DNS/tunnel provider configuration as needed.

Do not block core CRM page implementation on the public hostname.

---

# 5. VOICE VPS / DEMO RUNTIME

The Sales AI architecture requires an audit of the actually deployed demo/receptionist runtime before rewriting voice transport.

Claude should determine from available SSH/config/repo/server access whether the voice VPS is reachable.

If reachable:

- inspect only; preserve working demo;
- identify reusable Twilio/ConversationRelay/STT/TTS/barge-in/telemetry pieces;
- implement Production Outbound Sales as separate service/process/session namespace.

If not reachable, report the exact missing access item. Do not guess or replace the working demo transport from memory.

---

# 6. WHAT IS NOT A BLOCKER

The following do not require Michael before Claude continues:

- complete CRM UI mockups/pages
- canonical data/read models
- public-first website decision-maker research
- account/contact/evidence/ownership model
- import wizard against fixtures
- Market Miner provider adapter against fake fixtures
- Cal.com adapter against fake fixtures
- Sales AI text roleplays
- page/RBAC/ownership tests
- mobile/responsive UI
- pilot control-plane UI
- call-review UI against fixture data

---

# 7. MICHAEL ACTION LIST — ONLY WHEN NEEDED

When Claude reaches the point where real external services are required, ask Michael for only the smallest relevant item:

1. Cal.com credential/event reference after Cal.com account/event is configured.
2. DataForSEO credential after provider adapter/tests are ready.
3. Upload actual prospect list through CRM Imports once available.
4. Choose/complete external access/DNS path only when private pilot access is insufficient.
5. Provide voice-VPS access only if Claude confirms it cannot reach the deployed demo runtime.

Do not ask Michael for things the repo/server/API can answer itself.

---

# 8. CORE RULE

**External credentials should gate only the final provider connection, not architecture, UI, adapters, tests or fake-provider end-to-end flows.**
