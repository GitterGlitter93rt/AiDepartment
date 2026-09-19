# Your AI Department — Prospect Factory / Outbound Sales Brain Incident Response Runbook

**Status:** Architecture / operations authority  
**Purpose:** Define what YAD does when the prospecting/calling system behaves incorrectly, spends unexpectedly, violates truth/DNC rules, degrades caller reputation, or loses a critical dependency.

---

# 1. PRINCIPLE

The system needs a fast way to stop harm before anyone debates root cause.

Order:

`STOP -> CONTAIN -> PRESERVE EVIDENCE -> FIX -> VERIFY -> RESUME GRADUALLY`

Do not keep a campaign running merely because the bug is “probably minor.”

---

# 2. SEVERITY LEVELS

## SEV-0 — Immediate safety/compliance/brand stop

Examples:

- explicit DNC ignored or redialed;
- autonomous calling occurs outside approved mode/cohort;
- system calls non-allowlisted numbers in controlled test;
- material false claims repeated across calls;
- secrets exposed;
- unauthorized access to call/control APIs;
- suppression store unavailable while autonomous calls continue;
- caller identity deception/impersonation;
- runaway campaign far above approved contact volume.

Action:

- global autonomous kill switch immediately;
- pause affected campaigns;
- preserve call/event/audit data;
- leadership/security/compliance review.

## SEV-1 — Major quality/operational incident

Examples:

- widespread wrong-company/duplicate outreach;
- provider parser classifies organic results as paid;
- booking falsely reported successful;
- CRM outcomes badly corrupted;
- p95 voice latency degrades to clearly unusable levels;
- spam/reputation issue materially impacts outbound number;
- provider cost runaway.

Action:

- pause affected service/campaign/provider path;
- Human Assist may remain available if isolated and safe.

## SEV-2 — Degraded feature

Examples:

- Meta adapter down;
- contact enrichment unavailable;
- some websites blocked;
- QA backlog delayed;
- noncritical analytics missing.

Action:

- degrade to unknown/partial;
- continue unaffected paths.

## SEV-3 — Minor issue

Examples:

- UI display bug;
- noncritical stale metric;
- one provider field not rendering.

Normal bug workflow.

---

# 3. GLOBAL KILL SWITCH PROCEDURE

Trigger when SEV-0 or when incident owner cannot confidently bound an autonomous-calling failure.

Kill switch effect:

- no new autonomous calls initiate;
- queued call jobs recheck and stop;
- research/Human Assist can continue only if unrelated/safe;
- active calls follow safe termination policy;
- audit event records actor/time/reason.

Do not delete campaign/data when stopping calls.

---

# 4. CAMPAIGN PAUSE

Use campaign-level pause when incident is isolated to:

- one vertical;
- one market;
- one prompt/model/voice version;
- one provider/source;
- one experiment.

Examples:

- Jacksonville HVAC query parser broken;
- new Plumbing prompt overclaims;
- one from-number gets severe reputation issue.

Keep global kill switch for unbounded risk.

---

# 5. DNC INCIDENT

Trigger:

- prospect requested stop;
- suppression did not persist;
- number was called again after valid DNC;
- suppression scope mismatch causes repeated outreach.

Immediate:

1. stop affected campaign/autonomous path;
2. manually ensure suppression is durably recorded;
3. identify Account/Contact/Phone aliases;
4. check whether duplicates/merged records bypassed suppression;
5. search for any additional calls after DNC timestamp;
6. preserve event logs.

Root-cause categories:

- tool failure;
- DB transaction failure;
- entity resolution mismatch;
- stale worker authorization;
- race condition;
- manual override;
- import resurrected identity;
- policy bug.

Resume only after regression test proves immediate suppression across aliases/queues.

---

# 6. UNSUPPORTED CLAIM INCIDENT

Examples:

- “You spend $20k/month on Google” without source;
- “Your ServiceTitan isn’t following up” from frontend signal;
- guaranteed ROI;
- stale ad presented as current.

Immediate:

- pause affected model/prompt/vertical if repeated/systemic;
- identify prompt/compiler/Call Pack/evidence source;
- mark affected call QA hard fail;
- find calls using same version/evidence pattern.

Debug chain:

`spoken claim -> transcript turn -> prompt/Call Pack -> EvidenceRecord -> claim registry -> source observation`

If chain cannot support statement, fix at earliest broken layer.

Do not merely add “be careful” to the prompt if evidence normalization is wrong.

---

# 7. WRONG-COMPANY / DUPLICATE OUTREACH INCIDENT

Symptoms:

- same company called from several aliases;
- franchise locations treated as duplicates/one entity incorrectly;
- tracking number linked to wrong contractor;
- aggregator ad assigned to contractor.

Immediate:

- pause affected cohort if repeated;
- quarantine ambiguous Accounts;
- run entity merge/unmerge audit;
- preserve source observations/contact history.

Fix:

- entity resolver;
- source identity mapping;
- aggregator classification;
- campaign duplicate gate.

Never “fix” by deleting call history.

---

# 8. PAID-AD CLASSIFICATION INCIDENT

Symptoms:

- organic result parsed as sponsored;
- tracking pixel awarded Google/Meta ad points;
- provider response schema changed;
- stale observation treated current.

Immediate:

- pause advertiser-specific hook generation from affected provider/parser;
- leave ad status `unknown` while repairing;
- recalculate affected scores/Call Packs after fix.

Do not downgrade to “not advertising.”

---

# 9. PROVIDER COST RUNAWAY

Triggers:

- spend exceeds hard cap;
- unexpected task multiplication;
- query planner Cartesian explosion;
- retry loop resubmits paid tasks;
- duplicate crawler/model operations.

Immediate:

- provider circuit breaker;
- pause mining job;
- stop new paid submissions;
- collect already-paid async results where appropriate.

Investigate:

- idempotency
- query/cell plan
- retry semantics
- provider pricing change
- worker duplication.

Resume with small capped batch first.

---

# 10. VOICE LATENCY INCIDENT

Trigger examples:

- p95 ordinary response >2 seconds repeatedly;
- observed 3–5 second dead air returns;
- barge-in does not stop speech;
- callers frequently talk over AI.

Immediate:

- pause affected realtime version if production quality degraded;
- Human Assist remains available.

Inspect timings:

- answer classification
- STT endpoint
- model first token
- RAG/tool wait
- TTS first audio
- network/WebSocket
- provider queue.

Fix the measured bottleneck; do not guess.

---

# 11. FALSE TOOL SUCCESS INCIDENT

Examples:

- meeting not booked but agent says booked;
- email failed but agent says sent;
- transfer failed but agent says transferred.

Treat as SEV-1 or SEV-0 depending impact/systemic scope.

Immediate:

- disable affected tool from live agent;
- review pending/confirmed semantics;
- inspect idempotency/provider response mapping;
- correct CRM records;
- human follow-up affected prospects where appropriate.

Regression target: false success = zero.

---

# 12. SUPPRESSION SERVICE OUTAGE

Autonomous outbound must fail closed.

Immediate:

- block new autonomous calls;
- alert;
- preserve queued work;
- Human Assist UI should visibly warn and follow approved human policy.

Resume only when:

- suppression DB/service healthy;
- current suppression checks tested;
- queued call jobs re-evaluate.

---

# 13. DATABASE OUTAGE

Critical data unavailable:

- suppressions;
- contact history;
- current campaign state;
- Call Pack/compliance decision.

Autonomous calls blocked.

Research workers may pause unless they can safely buffer without losing provenance/idempotency.

After restore:

- verify suppression integrity first;
- reconcile jobs/provider async tasks;
- ensure no duplicate calls queued.

---

# 14. PROVIDER DATA-SHAPE CHANGE

Symptoms:

- parser error spike;
- zero paid results across all markets unexpectedly;
- fields renamed;
- ad format changes.

Action:

- circuit-break affected adapter;
- provider evidence becomes unknown;
- run fixture + manually inspect raw permitted sample;
- version parser.

Never let parser default unknown result types to “paid.”

---

# 15. CALLER REPUTATION / SPAM LABEL INCIDENT

Signals:

- answer rate collapses independent of list quality;
- carrier rejection increases;
- external reputation tool indicates spam labeling;
- complaints spike.

Actions:

- pause/limit affected number/campaign;
- review call volume/cadence/DNC/complaints;
- review Twilio reputation/STIR/SHAKEN/branded-calling options;
- do not rotate/spoof numbers to evade labeling.

Fix business/reputation cause.

---

# 16. SECURITY INCIDENT

Examples:

- leaked API key;
- unauthorized admin login;
- public dial endpoint abuse;
- transcript export unauthorized.

Immediate:

- revoke/rotate secrets;
- disable compromised account/service;
- global kill switch if dial controls at risk;
- preserve security logs;
- investigate scope.

Follow company/security/legal notification requirements.

---

# 17. MEDIA / RETENTION INCIDENT

Examples:

- audio retained beyond policy;
- transcript stored when disabled;
- deletion job fails.

Action:

- stop new affected retention;
- identify impacted records/provider-side copies;
- perform required deletion/containment;
- document incident.

---

# 18. INCIDENT RECORD

Every SEV-0/1 record includes:

- incident ID
- severity
- detected time
- detector/person
- affected services/campaigns/versions
- customer/prospect scope
- immediate containment
- kill/pause events
- timeline
- root cause
- corrective actions
- regression tests
- resume approval
- follow-up owner.

---

# 19. RESUME CHECKLIST

Before resuming affected autonomous path:

- root cause understood or risk fully mitigated;
- code/config fix tested locally;
- relevant fixture added;
- critical regression suite passes;
- affected data repaired/reconciled;
- provider state healthy;
- compliance/security review if needed;
- resume with small cap;
- monitor first batch closely.

---

# 20. BLAME-FREE ENGINEERING, STRICT BUSINESS OUTCOME

The purpose is not to punish a developer/model.

The purpose is to make the system safer and more reliable.

But operational severity should not be softened because the error came from AI or a third-party provider.

A false claim is still a false claim; a DNC miss is still a DNC miss.
