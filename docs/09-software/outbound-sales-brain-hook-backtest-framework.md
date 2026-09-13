# Your AI Department — Sales AI Hook Backtest Framework

**Status:** Release-validation authority  
**Date:** 2026-09-03  
**Purpose:** Define how YAD evaluates cold-call openers/hooks before live use and how tomorrow's pilot converts real call outcomes into evidence without pretending synthetic simulation is real conversion data.

---

# 1. CORE RULE

A hook is good only if it earns the next useful sentence **without lying, accusing, sounding creepy, or wasting time**.

Offline testing can validate:

- truthfulness;
- relevance;
- answerability;
- naturalness;
- non-accusatory framing;
- fit with the researched Call Pack;
- resistance handling;
- whether the hook opens a useful discovery path.

Offline testing **cannot** establish actual answer rate, conversation rate, meeting rate or revenue conversion. Those require real calls.

Therefore YAD uses two layers:

1. **Synthetic/offline hook certification** before release.
2. **Controlled live hook experiment** after release.

---

# 2. WHAT IS BEING TESTED

Test hook packages, not isolated clever sentences.

A HookPackage contains:

- identity/disclosure frame;
- relevance context;
- opening question;
- expected first prospect reactions;
- first follow-up logic;
- truth/proof boundaries;
- target hypothesis;
- target role;
- vertical/business context;
- version ID.

Example:

```text
HOOK-HVAC-AH-A1
Context: fresh emergency-HVAC advertiser observation
Frame: honest cold call + observed advertiser context
Question: "When a new call hits after hours, what happens today?"
Hypothesis: after-hours paid-lead handling
```

---

# 3. OFFLINE SCORE

Each hook is scored 0–5 on:

1. **Truth Safety** — can every statement be supported by the Call Pack?
2. **Specific Relevance** — does the prospect understand why this question could matter to their business?
3. **Answerability** — can the person answer quickly without needing a presentation?
4. **Non-Accusatory Framing** — asks instead of claiming a leak exists.
5. **Natural Spoken Delivery** — sounds like a competent person rather than ad copy.
6. **Discovery Yield** — answer naturally creates a useful next question.
7. **Role Fit** — appropriate for the stakeholder being targeted.
8. **Low Creepiness** — public research feels relevant, not surveillance-like.
9. **Brevity** — reaches the question quickly.
10. **Cross-Vertical Core Fit** — works within one YAD sales process rather than requiring a separate agent.

Maximum raw score: 50.

Penalties:

- unsupported claim: **automatic FAIL**;
- fake familiarity/referral: **automatic FAIL**;
- invented pain/result/spend: **automatic FAIL**;
- aggressive/deceptive gatekeeper behavior: **automatic FAIL**;
- excessive research creepiness: -5 to -15;
- AI/feature-first opening: -3 to -10;
- stacked questions: -2 to -6;
- generic pitch before question: -2 to -8.

Release recommendation:

- 43–50 = primary candidate;
- 38–42 = acceptable backup/test variant;
- 32–37 = rewrite before pilot;
- <32 = reject;
- any hard fail = reject regardless of points.

The score is a design-quality heuristic, **not a predicted conversion percentage**.

---

# 4. NEGATIVE CONTROLS

Every backtest suite must include intentionally weak controls so the grader proves it understands why YAD's preferred approach is better.

Examples:

## Generic AI pitch

> Hi, we're an AI automation company that helps businesses save time and money with AI agents. Do you have a few minutes?

Expected weaknesses:

- AI first;
- no researched relevance;
- vague;
- easy brush-off;
- no business-process question.

## Accusatory loss hook

> You're probably losing a lot of money from missed calls. Want to fix that?

Expected weaknesses:

- unsupported loss assertion;
- adversarial;
- prospect must defend business;
- hard fail when no internal evidence supports it.

## Creepiness overload

> I saw your 4.7-star rating, 312 reviews, CallRail tags, financing widget and the AC replacement ad you ran this morning...

Expected weaknesses:

- too much research in first seconds;
- creates surveillance feeling;
- delays actual question.

## Product-first AI receptionist hook

> Are you using an AI receptionist yet?

Expected weaknesses:

- prescribes before diagnosing;
- narrows YAD prematurely to one product;
- encourages yes/no shutdown.

---

# 5. CORE RELEASE HOOK FAMILIES

## A. Paid-demand / after-hours

Use when fresh advertiser evidence and after-hours/emergency context are claim-safe.

Preferred question:

> When a new call hits after hours, what happens today?

Why:

- extremely easy to answer;
- operational rather than technical;
- naturally reveals answering service/voicemail/on-call/booking workflow;
- works across HVAC, plumbing, restoration, garage door and similar urgent businesses.

## B. Paid-demand / overflow

> When a new call comes in while everybody's already tied up, what happens next?

Use when phone dependence is strong but after-hours claim is weaker.

## C. Unsold estimate/proposal

> What normally happens to an estimate or proposal that doesn't close the first time?

Strong for:

- roofing;
- remodeling;
- collision;
- higher-ticket electrical;
- solar/energy;
- B2B quotes.

## D. CRM/follow-up

> Once a new lead gets into your system, what actually keeps the follow-up moving?

Use after evidence/contact/history suggests CRM/process is the relevant route. Avoid as the very first hook when a simpler operational question is available.

## E. Speed-to-lead

> How quickly does a brand-new inquiry normally hear from somebody?

Useful but potentially more defensive because it sounds like measurement/audit. Prefer when the target role owns lead response and the company uses fast-response channels.

## F. Attribution

> Can you currently trace a lead from the original source all the way to actual revenue?

Useful with owners/marketing leadership, but cognitively heavier. Not preferred for hurried front-line contacts.

## G. Long-term nurture

> When somebody isn't ready right now but might be in a few months, what keeps that relationship alive?

Strong for real estate, legal consultations, high-ticket home services and long-cycle sales.

## H. Admin capacity

> What repetitive office task eats more employee time than you think it should?

Useful in discovery, but generally weaker as a cold first hook because it is broad and asks the prospect to search mentally. Prefer after a specific context is established.

---

# 6. HOOK SELECTION PRINCIPLE

Do **not** find one universal winning sentence.

The goal is to choose the best hook family for the evidence and role.

Comparator order:

1. current conversation/history if this is a callback;
2. high-confidence prospect-requested topic;
3. fresh claim-safe paid-demand/service context;
4. first-party workflow/service context;
5. strongest hypothesis supported by business model;
6. generic category/role process question.

The same company may legitimately receive a different hook six months later if current evidence/history changed.

---

# 7. SYNTHETIC PROSPECT PERSONAS

Each hook must survive at least:

- friendly owner;
- owner in a hurry;
- skeptical owner;
- gatekeeper;
- technically sophisticated owner;
- strong-existing-system/no-sale prospect;
- prospect who asks why YAD called them;
- prospect who asks how YAD found the number;
- prospect who asks if caller is AI;
- "send me an email";
- "not interested";
- prospect correcting research;
- wrong contact;
- DNC.

The hook should not require the prospect to follow a specific happy-path response.

---

# 8. OUTCOME SIGNALS FOR OFFLINE SIMULATION

For each simulated conversation capture:

- opener version;
- prospect persona;
- business context;
- whether first question was answered;
- whether answer contained a usable process fact;
- number of agent turns before first useful prospect fact;
- objection generated;
- whether objection was caused by unsupported/creepy wording;
- whether the hook transitioned naturally into discovery;
- whether the model repeated/pitched before listening;
- strategy-call readiness result;
- terminal reason;
- hard-fail result.

Primary offline metric:

`useful_process_fact_by_agent_turn_3`

Secondary:

- `clean_role_route_by_turn_3`;
- `no_unnecessary_pitch_before_fact`;
- `no_unsupported_claim`;
- `no_repeat_after_brush_off`;
- `qualified_next_step_correctness`.

---

# 9. TOMORROW LIVE EXPERIMENT DESIGN

Do not change five things at once.

Initial live batches should hold constant:

- voice;
- model;
- TTS/STT config;
- market/vertical quality band;
- qualification gate;
- booking offer.

Change only the **hook package** where possible.

Suggested initial advertiser-heavy HVAC/plumbing experiment:

### A1 — advertiser + after-hours process

> I came across you guys while looking at companies advertising [service] around [market]. When a new call hits after hours, what happens today?

### A2 — advertiser + overflow process

> I came across you guys while looking at companies advertising [service] around [market]. When a new call comes in while everybody's tied up, what happens next?

### B1 — category + after-hours without ad mention

> I was looking at [category] companies around [market]. Quick question — when somebody reaches out after hours, what happens today?

Do not include weak/deceptive negative controls in real prospect testing merely for experimental purity. Negative controls are offline only.

---

# 10. LIVE METRICS

Track the funnel by hook version:

- attempted calls;
- human answers;
- right-person conversations;
- gatekeeper routes;
- first-question answer rate;
- useful-process-fact rate;
- >30-second engaged conversation;
- meaningful problem discovered;
- qualified strategy-call offer;
- strategy-call accepted;
- strategy-call booked;
- targeted email requested;
- callback requested;
- no-need/disqualified;
- DNC;
- hang-up within opening;
- average first meaningful response latency;
- average talk/listen ratio;
- interruption/repetition failures.

Do not optimize raw booking rate in isolation. A hook that books unqualified people is worse than one that creates fewer but better meetings.

---

# 11. MINIMUM SAMPLE DISCIPLINE

Tomorrow's first calls are a **micro-pilot**, not statistical proof.

Rules:

- do not declare a winner after one lucky booking;
- treat early results as directional;
- preserve every call/hook version;
- use qualitative failure review alongside counts;
- only expand a hook after it passes voice/truth/experience checks.

A hook can be paused immediately for a severe qualitative failure even before sufficient sample exists.

---

# 12. RELEASE GATE

A hook package may enter tomorrow's pilot only when:

- no hard-fail behavior in offline fixtures;
- offline score >= 38/50;
- opener length acceptable in voice test;
- Call Pack can support every claim;
- role/hypothesis pairing is sensible;
- response cards cover likely first objections;
- DNC/wrong-number priority interrupts pass;
- no stale advertiser context used;
- no fake personalization required.

---

# 13. CORE RULE

**The best hook is the shortest truthful question that makes the right prospect want to explain how the business currently works.**
