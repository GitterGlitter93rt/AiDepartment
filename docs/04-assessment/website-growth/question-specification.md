# Website & Growth Assessment — Question Specification (V1)

Status: Architecture Draft — Pending Owner Approval
Formalizes `supplemental-questions.md` into exact, implementable question definitions.

## 1. Design Summary

- 10 defined questions (Q1–Q10), all optional individually (see §"Not Sure Behavior" below) but presented as a short required flow.
- Typical number of questions shown to a user: **7** (Q1–Q6, Q8, Q10 minus conditional skips — see §3 Branching for the exact typical path).
- Maximum possible number of questions after branching: **10** (no question is ever added beyond this fixed set; branching only ever *skips* questions, never adds new ones).
- No free-text numeric answer directly determines scoring, per `supplemental-questions.md` §"Scoring" and `scoring-matrix.md` §5–9 (all rules driven by enumerated option selection).

## 2. Question Definitions

### Q1 — CRM
- Wording: "Where do new website leads currently go?"
- Why it matters: Backs FU-01 and AI-04.
- Options: `Email inbox`, `CRM`, `Scheduling system`, `Call center / team`, `Multiple systems`, `Not sure`, `Other`
- Type: Single-select.
- "Not sure" behavior: Treated identically to Fail for FU-01/AI-04 scoring (evidence classified as User-Provided, confidence Not Verified) — not excluded, because the business's own uncertainty about where its leads go is itself a meaningful finding.
- Branch condition: None (always shown).
- Scoring rule impact: FU-01, AI-04.
- Finding trigger: FU-F01 (if Fail), AI-F04 (if Fail).
- Result-page usage: Displayed as "Based on your answers" provenance under Follow-Up Systems and AI Readiness.
- Privacy classification: Business-operational, not personal data about an individual.

### Q2 — Lead Response Time
- Wording: "How quickly are new website inquiries typically contacted by a person?"
- Why it matters: Backs FU-05, the highest-weighted single rule in Follow-Up Systems.
- Options: `Within 5 minutes`, `Within 15 minutes`, `Within 1 hour`, `Same business day`, `Next business day or later`, `Varies / not tracked`, `Not sure`
- Type: Single-select.
- "Not sure" behavior: Scored as Fail (0 points) — consistent with `supplemental-questions.md`'s instruction not to present benchmark claims, but the *absence* of a tracked answer is itself evidence of an untracked process, which is a legitimate Fail condition (not an Unknown-exclusion), distinct from Q1's treatment because response time not being trackable is a stronger, more specific signal of process immaturity than "not sure" about where leads generally go.
- Branch condition: None (always shown).
- Scoring rule impact: FU-05.
- Finding trigger: FU-F05.
- Result-page usage: "Based on your answers."
- Privacy classification: Business-operational.

### Q3 — Automated Acknowledgment
- Wording: "Do new website leads automatically receive an immediate acknowledgment?"
- Why it matters: Backs FU-02.
- Options: `Yes`, `No`, `Sometimes`, `Not sure`
- Type: Single-select.
- "Not sure" behavior: Treated as Fail (0 points), same rationale as Q2.
- Branch condition: None (always shown).
- Scoring rule impact: FU-02.
- Finding trigger: FU-F02.
- Result-page usage: "Based on your answers."
- Privacy classification: Business-operational.

### Q4 — Lead Assignment
- Wording: "Are new leads automatically assigned or routed to the correct person/team?"
- Why it matters: Backs FU-03, contributes to AI-06.
- Options: `Yes`, `No`, `Partially`, `Not sure`
- Type: Single-select.
- "Not sure" behavior: Treated as Fail (0 points).
- Branch condition: None (always shown).
- Scoring rule impact: FU-03, AI-06 (combined with Q3, Q5).
- Finding trigger: FU-F03.
- Result-page usage: "Based on your answers."
- Privacy classification: Business-operational.

### Q5 — Follow-Up Automation
- Wording: "Does your system automatically create reminders, tasks, or follow-up sequences for uncontacted leads?"
- Why it matters: Backs FU-04, contributes to AI-06.
- Options: `Yes`, `No`, `Partially`, `Not sure`
- Type: Single-select.
- "Not sure" behavior: Treated as Fail (0 points).
- Branch condition: None (always shown).
- Scoring rule impact: FU-04, AI-06.
- Finding trigger: FU-F04.
- Result-page usage: "Based on your answers."
- Privacy classification: Business-operational.

### Q6 — Marketing-Source Attribution
- Wording: "Can you identify which marketing source generated a lead after the lead enters your CRM or business system?"
- Why it matters: Backs TA-06.
- Options: `Yes, reliably`, `Partially`, `No`, `Not sure`
- Type: Single-select.
- "Not sure" behavior: **Excluded from denominator** (not scored as Fail) — unlike Q2–Q5, genuine uncertainty about an attribution capability (a more technical, less universally-understood concept than "do you follow up with leads") is treated as a neutral Unknown rather than an implicit Fail, per `scoring-matrix.md` §14 rule type 1.
- Branch condition: None (always shown).
- Scoring rule impact: TA-06.
- Finding trigger: TA-F06.
- Result-page usage: "Based on your answers."
- Privacy classification: Business-operational.

### Q7 — Revenue Attribution
- Wording: "Can you connect a closed customer or sale back to the original marketing source?"
- Why it matters: Backs TA-07.
- Options: `Yes, reliably`, `Partially`, `No`, `Not sure`
- Type: Single-select.
- "Not sure" behavior: Excluded from denominator (same rationale as Q6).
- Branch condition: **Shown only if Q6 ≠ "No"** — if a business cannot attribute leads to a marketing source at all, asking about connecting closed revenue to that same source is redundant and adds a low-value question to a short flow. If Q6 = "No," Q7 is skipped and TA-07 is scored as Fail directly (the logical implication of Q6 = "No" is that revenue attribution cannot exist either).
- Scoring rule impact: TA-07.
- Finding trigger: TA-F07.
- Result-page usage: "Based on your answers."
- Privacy classification: Business-operational.

### Q8 — Phone Attribution
- Wording: "Are inbound phone calls attributed back to marketing source or campaign?"
- Why it matters: Backs TA-05.
- Options: `Yes`, `Partially`, `No`, `Not sure`, `Phone calls are not a meaningful lead source`
- Type: Single-select.
- "Not sure" behavior: Excluded from denominator.
- Branch condition: None (always shown) — asked unconditionally because phone-lead relevance varies enough by business that it isn't safe to infer from other answers; the dedicated "not a meaningful lead source" option handles the exclusion case directly rather than via branching logic.
- Scoring rule impact: TA-05. If "Phone calls are not a meaningful lead source" is selected, TA-05 is excluded from the denominator entirely.
- Finding trigger: TA-F05 (only when included).
- Result-page usage: "Based on your answers."
- Privacy classification: Business-operational.

### Q9 — Paid Media Usage
- Wording: "Do you currently use paid advertising?"
- Why it matters: Gates TA-03 and TA-04 (conditional rules).
- Options: `Google Ads`, `Meta Ads`, `Other paid channels`, `No` — **multi-select** (per `supplemental-questions.md` §"Paid Media": "Allow multi-select if appropriate").
- Type: Multi-select. If `No` is selected, it is exclusive (selecting `No` deselects any other option, and vice versa) since "no paid advertising" and "we use Google Ads" cannot both be true.
- "Not sure" behavior: No "Not sure" option offered — whether a business currently runs paid ads is something any decision-maker can answer definitively; unlike response times or attribution capability, this is not a fact that plausibly requires "I don't know."
- Branch condition: None (always shown).
- Scoring rule impact: Gates TA-03 (included only if `Google Ads` selected) and TA-04 (included only if `Meta Ads` selected).
- Finding trigger: None directly (gates other findings).
- Result-page usage: Not displayed as a standalone finding; used to explain why TA-03/TA-04 are present or absent from the results page ("not applicable — you reported no Google Ads usage").
- Privacy classification: Business-operational.

### Q10 — Lead Reactivation
- Wording: "Do you systematically follow up with old leads or past customers?"
- Why it matters: Backs FU-06.
- Options: `Yes, automated`, `Yes, mostly manual`, `Occasionally`, `No`, `Not sure`
- Type: Single-select.
- "Not sure" behavior: Treated as Fail (0 points), consistent with Q2–Q5 (this is an operational-process question a decision-maker should be able to answer; uncertainty is itself informative).
- Branch condition: None (always shown).
- Scoring rule impact: FU-06.
- Finding trigger: FU-F06.
- Result-page usage: "Based on your answers."
- Privacy classification: Business-operational.

## 3. Branching Summary

Only one true branch exists in V1: **Q7 is skipped if Q6 = "No"** (§Q7). Every other question is always shown. This keeps the flow close to the "5–10 questions" target from `supplemental-questions.md` while still avoiding one clearly redundant question.

- **Typical path (Q6 ≠ "No"):** Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10 = **10 questions shown.**
- **Shortened path (Q6 = "No"):** Q1, Q2, Q3, Q4, Q5, Q6, Q8, Q9, Q10 = **9 questions shown.**

Correction to §1 summary: given only one branch exists and it removes at most one question, the **typical number of questions is 9–10**, and the **maximum is 10** (the full set, when Q6 ≠ "No"). This is intentionally at the upper bound of the "5–10" target in `supplemental-questions.md` — if owner review during `implementation-plan.md` Phase D wants a shorter flow, the most removable candidates without losing scoring integrity are Q8 (if phone attribution is judged lower-priority than the other six User-Provided rules) or combining Q4+Q5 into a single "is your follow-up process automated" question at the cost of losing the FU-03/FU-04 distinction.

## 4. Question Design Rules (Applied)

Per `supplemental-questions.md` §"Question Design Rules": every question above is answerable by a business decision-maker without technical jargon, includes "Not sure" where the underlying fact is plausibly unknown to a non-technical owner (Q1–Q8, Q10), excludes "Not sure" only where the fact is unambiguously knowable (Q9), and avoids shame-oriented language (e.g., Q2's options are neutral time bands, not phrased as "too slow").

## 5. Industry Question (Intake, Not Scored)

Collected at intake (before Q1), not part of the 10-question scoring flow. Used only to personalize result-page examples/phrasing (per `supplemental-questions.md` §"Optional Industry Question") — never to adjust any deterministic score. If the industry matches one of the nine existing `/industries/` pages, the result page's recommended-next-steps section may link to that page; otherwise no industry-specific link is shown.
