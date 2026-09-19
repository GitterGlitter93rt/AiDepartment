# Your AI Department — External Cold-Call Research Evidence Synthesis

**Status:** Supporting research evidence; does not override YAD Sales Manual or current conversation authority  
**Date:** 2026-09-03  
**Purpose:** Capture useful public cold-call research and translate it into concrete YAD design implications without treating third-party vendor benchmarks as guarantees.

---

# 1. WHY THIS EXISTS

YAD already has a strong internal doctrine:

`research -> relevance -> one business-process question -> listen -> diagnose briefly -> earn next step`.

Public sales research can help pressure-test that doctrine, but it must not become fake authority or a source of unsupported conversion promises.

This memo records external findings as **directional evidence**, not universal truth.

---

# 2. SOURCES REVIEWED

## HubSpot — 2025 State of Cold Calling Report

Public source:

`https://blog.hubspot.com/sales/state-of-cold-calling`

HubSpot reports survey responses from 379 sales professionals.

Relevant directional findings in the published report include:

- personalized/research-driven outreach is commonly cited as effective;
- direct introduction/purpose and question-led/research-led openers are widely used;
- company websites/news and CRM/past interactions are common research sources;
- active listening/adaptability and research/personalization are frequently cited as important cold-call skills;
- many practitioners use scripts but adapt them substantially rather than reading verbatim.

YAD implication:

The Market Miner + Call Pack approach is directionally aligned with how experienced sellers report preparing for calls. The runtime should use a structured talk track rather than a rigid transcript.

## Gong — large cold-call datasets

Public sources:

- `https://www.gong.io/blog/the-best-and-worst-cold-call-openers-backed-by-data-from-300m-calls`
- `https://www.gong.io/blog/cold-call-stats`
- `https://www.gong.io/blog/cold-call-opening-lines`
- `https://www.gong.io/files/gong-guide-how-to-master-cold-calls.pdf`

Relevant directional findings published by Gong include:

- opening wording materially affects outcomes;
- clearly communicating the reason for the call is associated with better cold-call outcomes in Gong's datasets;
- `Did I catch you at a bad time?` has historically performed poorly in Gong's analyses;
- permission-based/tailored permission openers have performed well in more recent Gong material;
- cold calls behave differently from later-stage discovery calls and should not turn into long interrogations.

YAD implication:

State the reason for calling quickly. Do not burn the first 10–15 seconds negotiating for permission with a weak generic opener. Also do not turn a cold call into a 10-question discovery session simply because the AI can keep asking.

## Gong — broader conversation research

Public source:

`https://www.gong.io/blog/talk-to-listen-conversion-ratio`

Gong's broader sales-call research emphasizes buyer participation, balanced dialogue and consistent seller behavior across calls.

YAD implication:

Do not overfit to one historical cold-call talk-ratio statistic. Optimize for **interactive progress**:

- the AI says enough to establish relevance;
- the prospect gives enough information to establish whether a real business issue exists;
- the agent stops discovery once the 15-minute strategy call is justified.

---

# 3. IMPORTANT LIMITATIONS

These sources are not controlled scientific trials of YAD's target markets.

Potential limitations include:

- vendor-specific customer datasets;
- self-reported survey responses;
- different definitions of `success`;
- different industries, contact quality and brand recognition;
- different human vs AI caller behavior;
- historic datasets collected under different market conditions.

Therefore:

- do not quote external benchmark conversion rates to prospects;
- do not hard-code third-party percentages as YAD goals;
- do not declare an opener `proven` for YAD before YAD live data exists;
- use public research to prioritize experiments, not replace experiments.

---

# 4. YAD DESIGN SYNTHESIS

The evidence supports the following current architecture.

## A. Research before the call

The agent should know:

- company/business type;
- market;
- claim-safe current observation;
- target stakeholder;
- one primary business-process hypothesis;
- one optional backup hypothesis;
- best supported contact route.

Do not conduct heavyweight research live while the prospect waits.

## B. Reason early

The prospect should understand quickly why YAD called **this business**.

Good pattern:

`identity + honest unsolicited context + claim-safe relevance + one operational question`.

Do not lead with:

- generic AI claims;
- feature list;
- fake familiarity;
- unsupported loss statement;
- long permission negotiation.

## C. One easy operational question

First question should be answerable without mental homework.

Preferred families remain:

- after-hours handling;
- call overflow;
- unsold estimate/proposal follow-up;
- speed-to-lead;
- CRM follow-up;
- nurture/reactivation;
- intake;
- attribution when role/context supports it.

## D. Avoid over-discovery

A normal useful cold call should often need only:

1. current process;
2. one failure/visibility/ownership probe;
3. optional quantification or priority question;
4. next-step decision.

The agent should not mechanically run an eight-question discovery ladder.

Once a meaningful gap and interest are established, move to the strategy call.

## E. Scripts are adaptive talk tracks

Use:

- immutable opener/hook version;
- state machine;
- working memory;
- response cards;
- qualification gate;
- action tools.

Do not use one verbatim transcript for every prospect.

## F. Optimize downstream quality

The winning hook is not the one that merely produces the longest calls.

Rank live performance using:

- correct stakeholder reached;
- useful process fact learned;
- meaningful problem supported;
- qualified strategy call offered;
- strategy call booked;
- strategy call attended;
- Michael-rated meeting quality;
- opportunity created;
- negative reaction/DNC;
- hard-fail rate.

---

# 5. FIRST-MINUTE RECOMMENDATION

Maintain two principal transparent frame candidates for controlled testing:

### F1 — explicit cold context

> Hey [Name], [identity] with Your AI Department. Quick cold call — I'll keep it short. [claim-safe reason]. [one question]

### F2 — out-of-nowhere context

> Hey [Name], [identity] with Your AI Department. I know I'm calling you out of nowhere — one quick question. [claim-safe reason/question]

Do not make `Did I catch you at a bad time?` the default opener.

Do not test a permission-heavy frame, a new hook and a new voice simultaneously.

---

# 6. TALK / LISTEN INTERPRETATION

Do not target a rigid percentage in the prompt.

Instead use behavioral constraints:

- opener is concise;
- one question per turn;
- short reflection before next probe;
- no feature monologue;
- do not ask low-information questions just to make the prospect talk;
- once meeting justification exists, close instead of continuing discovery.

Track talk/listen ratio for analytics, but treat it as diagnostic metadata rather than a direct optimization target.

---

# 7. LIVE LEARNING RULE

Third-party evidence decides **what YAD should test first**.

YAD's own reviewed live data decides **what YAD should keep**.

Promotion loop:

`external evidence -> offline fixture -> controlled YAD live test -> meeting-quality feedback -> promote / revise / retire`.

---

# 8. CORE CONCLUSION

**The most defensible release behavior is a well-researched, transparent cold opener that states a real reason, asks one easy operational question, adapts to the answer, avoids over-discovery, and moves to Michael's 15-minute strategy call as soon as a legitimate business reason exists.**
