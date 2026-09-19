# YAD Sales Brain — Sales Portal V1 Release Acceptance Matrix

**Status:** Release gate authority  
**Implementation owner:** Claude Code  
**Purpose:** Define what must be true before YAD gives the portal to sales reps.

---

# 1. RELEASE PHILOSOPHY

V1 does not need autonomous Twilio outbound.

V1 must reliably let real reps:

- find researched prospects;
- search a ZIP/city/market;
- claim Accounts;
- see useful contact + research context;
- call/email manually;
- disposition outcomes;
- schedule follow-up;
- share one canonical Account history.

A pretty interface with unreliable ownership or suppression is not releasable.

---

# 2. GATE A — AUTH / ACCESS

PASS when:

- authenticated access required;
- SALES_REP / SALES_MANAGER / RESEARCH_OPS / ADMIN roles exist;
- ordinary reps cannot change system/provider secrets;
- ordinary reps cannot remove DNC;
- ordinary reps cannot enable autonomous outbound;
- sessions expire/revoke appropriately.

HARD FAIL:

- anonymous portal access;
- provider credentials delivered to frontend.

---

# 3. GATE B — INVENTORY SEARCH

PASS when rep can:

- search vertical + ZIP/city/market;
- filter Tier/advertising/contact/ownership/freshness;
- receive existing database results quickly;
- distinguish current inventory from research-in-progress;
- see zero-results/partial-coverage state honestly.

HARD FAIL:

- every search synchronously waits for live internet mining;
- unknown shown as negative fact;
- duplicates appear as separate companies without justification.

---

# 4. GATE C — ACCOUNT IDENTITY / DEDUPE

PASS when:

- same company rediscovered via Google/Apollo/import does not create duplicate cold relationship;
- locations/franchises handled according to entity-resolution rules;
- domain/phone/address/source IDs used appropriately;
- merge decisions auditable/reversible where required.

HARD FAIL:

- DNC/ownership resets because another source imported same company.

---

# 5. GATE D — CLAIM / OWNERSHIP

PASS when:

- Claim to Me is atomic;
- simultaneous claim test produces one winner;
- bulk claim supports partial success;
- ownership visible to other reps;
- release preserves history;
- manager reassignment audited;
- callbacks/opportunities protected from generic reassignment.

HARD FAIL:

- two reps unknowingly cold-own same Account.

---

# 6. GATE E — ACCOUNT DETAIL

PASS when rep can see:

- company/market/vertical;
- Tier/score explanation;
- advertiser evidence/freshness;
- best contact/target role;
- Why Reach Out;
- confirmed facts vs hypothesis;
- first question;
- Do Not Claim warnings;
- shared timeline;
- research completeness.

HARD FAIL:

- hypothesis presented as fact;
- hidden AI score without explanation;
- stale ad evidence displayed as current.

---

# 7. GATE F — CONTACT / DISPOSITION

PASS when rep can record:

- no answer;
- voicemail;
- gatekeeper;
- DM reached;
- send info;
- callback requested;
- possible opportunity;
- meeting scheduled;
- not fit;
- wrong number;
- DNC.

Callback and DNC must persist after restart.

HARD FAIL:

- DNC exists only as note text;
- wrong number remains primary verified endpoint without correction state.

---

# 8. GATE G — FOLLOW-UP / REPLIES

PASS when:

- callbacks surface by due time;
- positive email replies attach to canonical Account;
- contradictory cold outreach is stopped/flagged;
- owner sees actionable reply/follow-up;
- overdue callbacks visible.

HARD FAIL:

- positive reply can coexist with another rep's generic cold sequence unnoticed.

---

# 9. GATE H — SAVED MARKETS / EDGE XPERT MINING

PASS when:

- Saved Market displays inventory counts/freshness;
- background research can replenish inventory;
- provider failure becomes degraded/unknown, not false negative;
- market budgets exist;
- saturation/cooldown supported;
- reps can browse existing inventory while research continues.

HARD FAIL:

- rep ZIP search can trigger unlimited provider spend;
- quality thresholds silently relax to hit inventory quota.

---

# 10. GATE I — MOBILE

PASS on iPhone-sized viewport:

- login;
- Find Prospects;
- filters;
- claim;
- Account view;
- tap phone;
- copy/open email;
- disposition;
- callback;
- DNC.

HARD FAIL:

- only usable through horizontally scrolling desktop table.

---

# 11. GATE J — UI QUALITY

PASS when:

- YAD design tokens used consistently;
- navigation clear;
- no raw provider/debug concepts shown to reps;
- loading/empty/error states designed;
- destructive actions confirmed;
- accessibility/contrast adequate;
- ordinary workflows do not require spreadsheet export.

The product should feel like a premium internal SaaS application, not Airtable/database admin UI.

---

# 12. GATE K — AUDIT / SECURITY

PASS when:

- claims/releases/reassignments/DNC/exports logged;
- sensitive credentials server-side;
- research workers use SSRF/prompt-injection protections from global architecture;
- logs redact secrets and unnecessary PII;
- backups/restart persistence verified.

---

# 13. TWO-REP LIVE ACCEPTANCE

Use two real test rep accounts.

Scenario:

1. both search HVAC + 32256;
2. both see same unclaimed Account;
3. both try to claim;
4. one wins atomically;
5. winner calls/records voicemail;
6. schedules callback;
7. other rep cannot cold-claim it;
8. manager can see ownership/activity;
9. prospect rediscovered through import remains same Account;
10. DNC test removes Account from actionable prospect search.

---

# 14. RELEASE DECISION

Release to reps only if:

- all HARD FAIL conditions absent;
- Gates A–G pass;
- Gate I passes for essential mobile workflows;
- production backups/persistence verified;
- at least one real Saved Market contains useful prospect inventory;
- no autonomous outbound is enabled by accident.

V1 may ship with lighter analytics/replies polish, but it may not compromise ownership, DNC, Account identity, or truth/evidence handling.