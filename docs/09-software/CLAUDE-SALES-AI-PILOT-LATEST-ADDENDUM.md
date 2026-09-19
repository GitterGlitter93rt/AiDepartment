# CLAUDE CODE — SALES AI PILOT LATEST ADDENDUM

**Date:** 2026-09-03  
**Branch:** `feature/outbound-sales-brain`  
**Purpose:** Point Claude at the newest Sales AI architecture added while implementation work was already in progress.

This file supplements:

- `CLAUDE-CURRENT-TASK.md`
- `CLAUDE-SALES-AI-PILOT-CURRENT.md`

Do not discard completed local implementation merely because these docs are newer. Reconcile the design into the correct next gate after preserving/committing legitimate local work.

---

# 1. NEW FILES TO READ

Read these before the next Sales AI / pilot implementation pass:

1. `outbound-sales-brain-sales-ai-first-60-seconds-spec.md`
2. `outbound-sales-brain-sales-ai-hypothesis-question-bank.v1.yaml`
3. `outbound-sales-brain-sales-ai-followup-message-cards.v1.yaml`
4. `outbound-sales-brain-strategy-call-reminder-no-show-spec.md`
5. `outbound-sales-brain-tomorrow-cold-call-pilot-runbook.md`
6. `outbound-sales-brain-first-pilot-cohort-selection-spec.md`

These extend the existing current Sales AI stack; they do not replace the core script/state machine/Call Pack/booking specs.

---

# 2. FIRST 60 SECONDS

Implement/test first-minute behavior as its own high-leverage QA surface.

Core objectives:

- identify YAD;
- reach/confirm correct person/role;
- give one fact-safe reason;
- ask one relevant process question;
- react to the answer;
- avoid feature pitch.

Critical branches:

- decision maker;
- gatekeeper;
- busy owner;
- `what is this?`;
- `is this a sales call?`;
- `why me?`;
- `how did you get my number?`;
- `are you AI?`.

Do not book merely because the prospect is polite.

---

# 3. ONE SALES AI / BUSINESS-PROBLEM QUESTION BANK

Do not solve cross-vertical relevance by creating separate personalities.

Use:

`outbound-sales-brain-sales-ai-hypothesis-question-bank.v1.yaml`

Current reusable problem families include:

- missed calls / overflow;
- after-hours response;
- speed-to-lead;
- unsold estimate/proposal follow-up;
- CRM workflow;
- marketing attribution;
- employee/admin capacity;
- reactivation/nurture;
- appointment/no-show;
- intake/qualification.

Vertical profiles and Call Packs choose the appropriate family.

Each family defines:

- relevant stakeholder roles;
- one strong first question;
- selective probes;
- gap signals;
- handled/no-need signals;
- meeting framing.

The agent asks one question at a time and normally uses at most one supported backup hypothesis.

---

# 4. FOLLOW-UP CARDS

When prospect requests email/info, use the approved message-card layer plus actual conversation facts.

Do not generate generic capability dumps.

Current topic cards include:

- lead handling/missed calls;
- unsold estimate/proposal follow-up;
- CRM workflow;
- marketing attribution;
- employee/admin capacity;
- generic short-call follow-up;
- free AI Department Assessment fallback;
- gatekeeper-forward note;
- requested callback confirmation;
- internal booked-meeting handoff;
- no-show reschedule.

Channel/suppression policy still governs sends.

---

# 5. BOOKING AFTERCARE

A confirmed Cal.com booking must:

- exit generic cold cadence;
- sync through Cal.com to Michael's connected Outlook calendar;
- use Cal Video;
- generate StrategyCallPrepBrief;
- rely on configured Cal.com reminder workflow by default;
- handle reschedule/cancel without creating duplicate meetings;
- distinguish confirmed no-show from attendance unknown;
- use one concise no-show recovery path by default.

Do not optimize only booked count; track attended qualified meetings.

---

# 6. FIRST PILOT COHORT

First real cohort should be intentionally clean.

Prefer:

- one narrow vertical/market;
- Tier B+ / strong fit;
- current business identity;
- strong current phone path;
- clear stakeholder route;
- one clear primary hypothesis;
- fresh evidence for opener;
- no relationship/suppression conflict;
- immutable Runtime Call Pack ready.

Do not weaken quality just to hit a requested round number.

---

# 7. PILOT OPERATING METHOD

Use the existing Pilot control plane plus the runbook.

Initial behavior:

- final internal/allowlisted end-to-end check;
- one selected real prospect;
- stop/review;
- small serial set only if no critical failure;
- controlled mini-batch only after stable behavior.

Hard-stop systematic defects before generating more examples.

---

# 8. REVIEW OUTPUT

After each early real call, operator should be able to see:

- company/contact;
- outcome;
- right decision-maker reached?;
- hypothesis supported/contradicted/inconclusive;
- key prospect statement;
- next-step decision;
- booking/callback/email/DNC/wrong-number result;
- latency summary;
- transcript/recording where authorized;
- QA/hard fail;
- root-cause tag.

Do not require raw server-log inspection for basic pilot review.

---

# 9. COORDINATION

Before implementing these newer docs:

1. inspect local status;
2. preserve/commit legitimate local changes;
3. fetch latest remote feature branch;
4. reconcile without force-pushing over architecture commits;
5. do not merge `main`;
6. report any genuine design/implementation conflict rather than silently discarding either side.

---

# 10. CORE RULE

**The first live calls should maximize trustworthy learning per call. The first minute earns the conversation, the business-problem question bank keeps one Sales AI relevant across industries, the qualification gate earns the 15-minute meeting, and the post-booking workflow gets the qualified prospect in front of Michael.**
