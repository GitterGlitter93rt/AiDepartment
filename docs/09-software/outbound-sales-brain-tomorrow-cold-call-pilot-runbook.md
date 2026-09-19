# Your AI Department — Controlled AI Cold-Call Pilot Runbook

**Status:** Operational authority for first real pilot  
**Date:** 2026-09-03  
**Purpose:** Define how YAD should run the first outbound Sales AI pilot in small observable stages so script, voice, routing, booking, and CRM failures are discovered before they affect a larger batch.

---

# 1. PILOT OBJECTIVE

The first real pilot is not a volume contest.

Primary objective:

> Prove that `yad-sales-core-v1` can contact a researched business, reach or identify the correct stakeholder, hold a short natural business conversation, correctly decide the next step, and persist the outcome without creating operational chaos.

Secondary objective:

> Learn which part of the system needs improvement before the next batch.

Do not judge the first pilot only by meetings booked.

---

# 2. PILOT INPUT QUALITY

Use a deliberately selected high-quality pilot cohort.

Prefer Accounts with:

- clear business identity;
- current website/business evidence;
- strong vertical fit;
- useful Module 4C score/Tier;
- current contact path;
- clear primary hypothesis;
- compact validated Runtime Call Pack;
- no relationship conflict;
- no active suppression;
- no duplicate rep ownership conflict;
- deterministic campaign/policy eligibility.

Do not use tomorrow's first calls to test dirty lead data and conversation quality simultaneously if avoidable.

---

# 3. COHORT SHAPE

For first pilot, favor one narrow conversation family rather than mixing every vertical/problem combination.

Recommended initial cohort concept:

- one primary vertical such as HVAC or another current high-confidence cohort;
- one geography/market;
- advertiser-first where available;
- similar likely opportunity families;
- strong current business phones;
- decision-maker known where possible, main-line role route otherwise.

The core Sales AI stays generic, but a narrower cohort makes failure diagnosis easier.

---

# 4. STAGE 0 — INTERNAL / ALLOWLIST FINAL CHECK

Immediately before first real prospect:

Run at least one complete end-to-end call through the production-outbound runtime to an approved internal/allowlisted participant.

Verify:

- correct caller ID;
- greeting latency;
- interruption/barge-in;
- STT accuracy;
- natural TTS;
- phone/email pronunciation;
- runtime Call Pack loaded;
- state transitions;
- booking availability check;
- booking test behavior in approved test path;
- DNC intent path in test data;
- wrong-number path;
- post-call persistence;
- operator stop control.

Do not proceed if a hard-fail path is broken.

---

# 5. STAGE 1 — ONE REAL PROSPECT

Start with **one** selected real prospect.

Before launch, operator previews:

- Account/company;
- phone/source;
- target person/role;
- why the company was selected;
- exact fact-safe opener context;
- primary question;
- booking readiness;
- callback routing;
- current suppression/policy result.

Launch manually.

After call, stop and review before dialing another prospect.

Required review:

- did the right business answer?
- did the greeting start promptly?
- did the agent sound natural?
- did it answer unexpected remarks instead of continuing script?
- did it ask one question at a time?
- did it use research honestly?
- did gatekeeper/person routing work?
- did DNC/wrong-number/ending semantics behave?
- did outcome persist?
- did any callback/booking/email promise create the right task/action?

---

# 6. STAGE 2 — SMALL SERIAL SET

If Stage 1 has no critical failure, run a small serial set.

Recommended operating pattern:

- operator-approved Accounts only;
- one active outbound Sales AI call at a time initially;
- review each outcome as it completes;
- pause instantly if a systemic issue appears.

Do not increase concurrency merely because telephony supports it.

The initial bottleneck should be learning/review, not dialing capacity.

---

# 7. STAGE 3 — CONTROLLED MINI-BATCH

Only after the serial calls show stable behavior should YAD permit a small controlled mini-batch.

Conditions before increasing batch size:

- no unresolved critical DNC/suppression defect;
- no booking false-confirmation defect;
- no repeated wrong-company/person issue caused by resolver/data model;
- no sustained 3–5 second conversational dead air;
- no major barge-in failure;
- no prompt loop/repetition defect;
- post-call outcomes reliably persist;
- callback route works;
- operator stop control works;
- current pilot owner explicitly approves continuation.

Batch size remains deliberately bounded and operator-configured.

---

# 8. HARD-STOP CONDITIONS

Immediately stop new outbound calls if any of these appear systemically:

- DNC request not durably written;
- DNC Account gets another cold attempt;
- wrong number is retried;
- AI claims a meeting was booked when provider did not confirm;
- AI fabricates customer results, referrals, spend, CRM facts or decision-maker identity;
- call goes to wrong business repeatedly due to data-resolution issue;
- severe latency makes natural conversation impossible;
- barge-in does not stop stale TTS;
- transcript/working memory consistently attributes statements to wrong party;
- outbound process destabilizes production inbound receptionist;
- same Twilio number routing sends inbound callbacks into demo/cold-opening behavior;
- account ownership/suppression state cannot be trusted;
- operator kill switch fails.

Do not continue to gather more examples of a known critical defect.

---

# 9. NON-CRITICAL ISSUES

Examples that can be logged and tuned without necessarily ending the pilot:

- opener slightly too long;
- unnatural acknowledgment;
- one poor but truthful objection response;
- suboptimal question order;
- minor TTS pronunciation issue;
- conservative decision not to book;
- brief awkward pause still inside acceptable range;
- gatekeeper route not optimal but safe.

Classify the root cause rather than labeling it `AI bad`.

---

# 10. ROOT-CAUSE CATEGORIES

Every reviewed issue should map to one primary category:

- prospect data quality;
- decision-maker routing;
- endpoint/contact quality;
- Call Pack construction;
- opener selection;
- prompt/response-card behavior;
- working memory/state;
- STT;
- TTS/prosody;
- latency/endpointing;
- Twilio transport;
- booking adapter;
- callback routing;
- follow-up action;
- CRM persistence;
- policy/suppression;
- operator UX.

This determines who/what gets fixed next.

---

# 11. CALL REVIEW SNAPSHOT

After every pilot call, operator should be able to see one compact review card:

```text
Company / Contact
Call time / duration
Outcome
Decision-maker reached? yes/no
Primary hypothesis supported / contradicted / inconclusive
Key prospect statement
Next-step decision
Meeting booked? / callback? / email requested?
DNC / wrong number status
Latency summary
Transcript / recording links where authorized
QA score / hard fail
Root-cause tags
```

Do not force Michael to dig through raw server logs after every call.

---

# 12. WHAT COUNTS AS A GOOD PILOT CALL

A good call can end as:

- qualified strategy call booked;
- correct decision-maker discovered;
- meaningful process fact learned;
- requested callback captured;
- useful targeted email requested;
- current system shown to be strong -> respectful no-sale;
- correct wrong-number correction;
- DNC immediately honored.

A polite owner who has no problem is not a failed call.

---

# 13. WHAT COUNTS AS A BAD PILOT CALL

Examples:

- AI talks for 45 seconds before asking anything;
- ignores prospect's answer and continues script;
- stacks four questions;
- turns `we have a receptionist` into employee-replacement pitch;
- claims public ad observation proves marketing spend;
- keeps selling after clear rejection;
- repeats same response card twice;
- cannot explain why YAD called;
- gives vague/creepy answer to contact-source question;
- tries to book before identifying a meaningful reason;
- makes prospect repeat email/time multiple times because memory failed;
- false booking confirmation.

---

# 14. PILOT KPI BOARD

Display counts/funnels for the current pilot only:

- calls attempted;
- human answers;
- gatekeeper answers;
- target decision-maker conversations;
- useful routing discoveries;
- meaningful business conversations;
- strategy-call-ready;
- strategy calls booked;
- requested callbacks;
- requested emails;
- no need/disqualified;
- wrong numbers;
- DNC;
- voicemails;
- inbound callbacks;
- hard fails;
- median/p95 greeting latency;
- median/p95 turn latency;
- barge-in performance where measurable.

Do not display an opaque `AI success score` as the main metric.

---

# 15. BOOKED MEETING HANDOFF

For every confirmed strategy call:

- remove Account from generic cold cadence;
- generate StrategyCallPrepBrief;
- preserve original call transcript/summary;
- show meeting in Michael's workflow;
- Cal.com/Cal Video handles scheduling experience;
- use reminder/no-show spec.

---

# 16. CALLBACKS FROM THE SHARED NUMBER

Because outbound and inbound share the approved YAD number:

- inbound callback checks recent outbound context first;
- callback does not begin the original cold opener again;
- caller can ask why YAD called, book, route to Michael/owner, or request stop contact;
- unknown inbound callers continue through ordinary production reception.

Use `outbound-sales-brain-inbound-callback-spec.md`.

---

# 17. SCRIPT CHANGE DISCIPLINE

Do not rewrite the master prompt during the middle of a batch without versioning.

If a meaningful conversation change is required:

1. pause new calls if necessary;
2. classify defect;
3. make smallest relevant change;
4. increment behavior/config version;
5. run fixed roleplay regression;
6. run internal voice check if voice-sensitive;
7. resume controlled pilot;
8. compare outcomes by version.

Use `outbound-sales-brain-sales-ai-conversation-optimization-spec.md`.

---

# 18. END-OF-PILOT REVIEW

Produce a brief covering:

- Accounts attempted;
- outcomes;
- booked calls;
- qualified/no-sale mix;
- top gatekeeper issues;
- top objections;
- top data-quality defects;
- conversation defects;
- voice/latency defects;
- booking/callback defects;
- specific changes recommended;
- changes explicitly not recommended due to insufficient evidence;
- next pilot size/cohort recommendation.

Do not infer broad conversion rates from a tiny sample.

---

# 19. CORE RULE

**Tomorrow's first outbound run should maximize learning per call, not calls per hour. Once behavior is trustworthy, volume is easy to add.**
