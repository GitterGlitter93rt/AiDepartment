# CLAUDE CODE — TOMORROW RELEASE REPORT TEMPLATE

**Target:** 2026-09-04  
**Branch:** `feature/outbound-sales-brain`  
**Purpose:** Force a concise evidence-backed release decision after implementation/testing.  

Claude: fill this report from actual repo/server/provider tests. Do not mark a gate PASS because the code appears plausible. Do not expose secrets.

---

# RELEASE CLASSIFICATION

Select exactly one:

- [ ] `REAL_AI_PILOT_ELIGIBLE`
- [ ] `INTERNAL_AI_TEST_ONLY`
- [ ] `HUMAN_ASSIST_ONLY`

**Decision reason:**

**Blocking issue(s), if any:**

**Exact next action:**

---

# 1. SOURCE / ENVIRONMENT

- Remote branch reconciled: PASS / FAIL
- Local legitimate work preserved: PASS / FAIL
- Current commit SHA:
- Main merged? MUST BE NO unless Michael explicitly approved:
- Automatic GitHub Actions enabled? MUST BE NO:
- Secrets committed/exposed? MUST BE NO:

EdgeXpert:

- sales portal service:
- API service:
- PostgreSQL:
- research worker:
- process supervisor:
- HTTPS/reverse proxy/tunnel:
- health endpoint:
- backup/restart persistence:

Voice VPS:

- production inbound service:
- demo service/mode:
- outbound sales service:
- process isolation:
- Twilio webhook route:
- WebSocket/ConversationRelay:
- health endpoint:

Evidence / commands/tests:

---

# 2. SALES PORTAL

URL:

Authentication:

Pages working:

- [ ] Overview
- [ ] Find Prospects
- [ ] Markets
- [ ] My Prospects
- [ ] Account Detail
- [ ] Follow-Ups
- [ ] Manager ownership/team controls

Core UX:

- search ZIP/city + vertical: PASS / FAIL
- cached inventory returned before live research: PASS / FAIL
- Claim to Me atomic: PASS / FAIL
- simultaneous claim fixture: PASS / FAIL
- claimed Account persists after restart: PASS / FAIL
- sleek/mobile UI acceptance: PASS / FAIL

Phone/contact UI:

- Direct business line distinguished: PASS / FAIL
- Named person via main line distinguished: PASS / FAIL
- Role-only main-line route distinguished: PASS / FAIL
- Human vs AI phone status separated: PASS / FAIL
- blocked phone action unavailable to rep: PASS / FAIL

Evidence:

---

# 3. PROSPECT INVENTORY

Approved market tested:

- vertical:
- geography:
- mining mode:

Inventory:

- canonical Accounts:
- fresh research:
- Tier A:
- Tier B:
- unclaimed:
- named decision-maker found:
- named DM + direct business phone:
- named DM + main-line route:
- role-only main-line route:
- usable email:
- contact research needed:

Source breakdown if available:

- Google advertiser discovery:
- existing/imported list:
- Airtable import:
- public contact resolver:
- paid enrichment:

Quality audit:

- duplicate Account failures:
- wrong company/domain failures:
- unsupported fact/hypothesis failures:
- stale ad language failures:

Do not claim market completeness unless coverage model supports it.

---

# 4. MARKET MINER / RESEARCH

- advertiser discovery provider configured:
- provider credential ready:
- website research:
- public decision-maker resolver:
- dedupe/entity resolution:
- Module 4C deterministic score:
- evidence ledger:
- advertiser freshness:
- saved-market replenishment:
- ZIP Research More:
- budget/circuit breaker:
- provider error -> unknown/degraded rather than false negative: PASS / FAIL

Current blockers:

---

# 5. HUMAN MANUAL CALL

Implementation authority:

`outbound-sales-brain-human-manual-call-v1-spec.md`

Tests:

- owned Account + `HUMAN_MANUAL_CALL=ALLOW` -> preflight PASS / FAIL
- ContactAttempt created before tel action: PASS / FAIL
- phone dialer opens only after server ALLOW: PASS / FAIL
- return/disposition workflow: PASS / FAIL
- unresolved initiated call remains unresolved, no invented outcome: PASS / FAIL
- callback persistence: PASS / FAIL
- wrong number disables endpoint only: PASS / FAIL
- DNC immediately blocks future phone actions: PASS / FAIL
- another rep sees updated state: PASS / FAIL
- rep personal phone number required in canonical schema? MUST BE NO

Evidence:

---

# 6. DNC / PHONE SCREENING

Internal YAD suppression:

- durable phone/contact/account DNC:
- rep may add immediately:
- ordinary rep can remove? MUST BE NO
- rediscovery/import resets DNC? MUST BE NO
- suppression store failure AI behavior:

External screening path:

- selected provider/source:
- provider class: direct FTC / commercial / hybrid / none
- credentials ready without exposing them: YES / NO
- source provenance reviewed: YES / NO
- pilot geography coverage:
- National DNC:
- state DNC as applicable:
- line type as applicable:
- RND as applicable:
- update/freshness policy:
- p50 lookup latency:
- p95 lookup latency:
- error semantics tested:
- cache/TTL tested:

Direct FTC if applicable:

- organization/SAN exists: YES / NO / UNKNOWN
- subscribed pilot area codes:
- Full List access:
- Change List access:
- protected snapshot current:
- last successful sync:
- next sync due:

Required fixtures:

- provider error != NO_MATCH: PASS / FAIL
- stale required screen cannot authorize AI: PASS / FAIL
- internal DNC beats external no-match: PASS / FAIL
- National no-match does not independently authorize AI: PASS / FAIL
- Twilio receives no request without current AI ALLOW: PASS / FAIL

Current phone-channel outputs:

- `HUMAN_MANUAL_CALL`: operational? YES / NO
- `AUTONOMOUS_AI_VOICE`: operational? YES / NO

Blockers:

---

# 7. SALES AI — FIRST 60 SECONDS

Agent:

`yad-sales-core-v1`

Primary hook candidate:

Fallback hook:

Fixture suites:

- YAD roleplay fixtures: PASS / FAIL
- hook backtest fixtures: PASS / FAIL
- first-60-second fixtures: PASS / FAIL
- HVAC end-to-end gold fixtures: PASS / FAIL
- negative controls materially worse: PASS / FAIL

First-minute behavior:

- one question in opener: PASS / FAIL
- no feature dump before useful fact: PASS / FAIL
- useful process fact/route by early turns: PASS / FAIL
- busy = max one save attempt: PASS / FAIL
- gatekeeper routing: PASS / FAIL
- AI identity truthful when asked: PASS / FAIL
- DNC interrupts selling immediately: PASS / FAIL
- stale ad context degrades safely: PASS / FAIL

Hard-fail counts:

- unsupported claims:
- fake/referral/familiarity:
- meeting offered with no reason:
- DNC failures:
- wrong-number failures:

---

# 8. REALTIME VOICE

Model:

STT:

TTS voice:

Telephony config version:

Internal/allowlisted scenarios completed:

- [ ] normal owner
- [ ] opener interruption
- [ ] repeated interruptions
- [ ] who is this
- [ ] why are you calling
- [ ] are you AI
- [ ] gatekeeper
- [ ] busy
- [ ] send email
- [ ] existing answering service
- [ ] existing receptionist
- [ ] existing CRM
- [ ] strong process / no sale
- [ ] booking
- [ ] booking failure
- [ ] wrong number
- [ ] DNC

Latency:

- greeting p50:
- greeting p95:
- turn response p50:
- turn response p95:
- barge-in stop p50:
- barge-in stop p95:

Quality:

- recurring 3–5 sec dead air? MUST BE NO
- stale replay after interruption? MUST BE NO
- full opener restart after interruption? MUST BE NO
- unnatural phone/email/time pronunciation:
- demo context leaked into production? MUST BE NO
- outbound failure takes down inbound? MUST BE NO

Evidence:

---

# 9. CAL.COM / MICHAEL BOOKING

Booking authority:

`Cal.com`

Calendar:

`michael@youraidepartment.ai`

Meeting:

`YAD 15-Minute AI Strategy Call`

Location:

`Cal Video` unless current configuration intentionally differs.

Tests:

- real availability lookup: PASS / FAIL
- only returned slots offered: PASS / FAIL
- timezone handling: PASS / FAIL
- same-day slot when actually available: PASS / FAIL
- booking creation: PASS / FAIL
- provider confirmation required before saying booked: PASS / FAIL
- attendee invite received: PASS / FAIL
- booking appears on Michael Outlook calendar through Cal.com: PASS / FAIL
- duplicate direct Outlook event created? MUST BE NO
- booking failure produces human follow-up instead of false success: PASS / FAIL
- booked Account exits generic cold outreach: PASS / FAIL
- StrategyCallPrepBrief generated: PASS / FAIL

Blockers:

---

# 10. PILOT CONTROL PLANE

- exact cohort visible before dial: PASS / FAIL
- Account/contact/hook preview: PASS / FAIL
- current AI eligibility visible: PASS / FAIL
- concurrency initially 1: PASS / FAIL
- Start Next Call: PASS / FAIL
- Pause After Current: PASS / FAIL
- STOP NEW OUTBOUND CALLS: PASS / FAIL
- completed-call review: PASS / FAIL
- immutable config/version snapshot: PASS / FAIL
- hidden background dialing? MUST BE NO

---

# 11. END-TO-END GOLD FIXTURE RESULTS

Use:

`outbound-sales-brain-tomorrow-hvac-pilot-gold-fixtures.v1.yaml`

Report each fixture:

| Fixture | PASS/FAIL | Notes |
|---|---|---|
| GOLD_HVAC_001_DIRECT_DM_AD_AFTER_HOURS | | |
| GOLD_HVAC_002_NAMED_DM_MAIN_LINE | | |
| GOLD_HVAC_003_ROLE_ROUTE_NO_PERSON | | |
| GOLD_HVAC_004_STALE_AD_DEGRADE_HOOK | | |
| GOLD_HVAC_005_HUMAN_ALLOW_AI_REVIEW | | |
| GOLD_HVAC_006_DNC_UNIVERSAL_PHONE_BLOCK | | |
| GOLD_HVAC_007_WRONG_NUMBER_ACCOUNT_RETAINED | | |
| GOLD_HVAC_008_CALLBACK_PROTECTED | | |
| GOLD_HVAC_009_EMAIL_ONLY | | |
| GOLD_HVAC_010_MEETING_BOOKED_REMOVED_FROM_COLD | | |
| GOLD_HVAC_011_SIMULTANEOUS_CLAIM | | |
| GOLD_HVAC_012_IMPORT_REDUPLICATION_PRESERVES_HISTORY | | |

---

# 12. RELEASE STOP CONDITIONS REVIEW

Confirm none remain:

- [ ] DNC failure
- [ ] wrong-number reuse
- [ ] wrong company/Call Pack
- [ ] unsupported/stale ad statement
- [ ] invented spend/revenue/results/CRM
- [ ] false booking confirmation
- [ ] repeated severe latency/dead air
- [ ] repeated barge-in failure
- [ ] stale response after interruption
- [ ] demo context leak
- [ ] phone eligibility bypass
- [ ] required screening failure treated as allow
- [ ] Twilio outbound without current AI ALLOW
- [ ] duplicate ownership
- [ ] persistence failure

If any box represents an unresolved failure, do not classify `REAL_AI_PILOT_ELIGIBLE`.

---

# 13. EXACT NEXT STEP

If `REAL_AI_PILOT_ELIGIBLE`:

- identify the tiny reviewed HVAC pilot cohort;
- show count;
- show contact-route mix;
- show current AI ALLOW count;
- confirm concurrency 1;
- wait for Michael's explicit launch decision before the real prospect batch.

If `INTERNAL_AI_TEST_ONLY`:

- state the exact blocker preventing real prospects;
- continue allowlisted Sales AI testing;
- keep Human Assist operating for independently eligible human calls;
- give the shortest path to clear the blocker.

If `HUMAN_ASSIST_ONLY`:

- state why voice is not ready;
- keep reps using the portal/manual-call workflow;
- identify the next voice component to fix.

---

# 14. FINAL ONE-PARAGRAPH EXECUTIVE SUMMARY

Write a compact summary for Michael covering:

- what is live;
- what was proven;
- what remains blocked;
- exact release classification;
- what he needs to decide/do next, if anything.

Do not bury the release classification in a long engineering report.