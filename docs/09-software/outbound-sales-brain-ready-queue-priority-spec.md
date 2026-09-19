# Your AI Department — Ready Prospect Queue Priority Specification

**Status:** Architecture authority  
**Purpose:** Order eligible researched prospects for Human Assist or later approved calling without hiding the logic inside one opaque AI score.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

The canonical YAD Module 4C score answers:

> How attractive does this company look as a YAD prospect?

It does NOT fully answer:

> Who should Brent call first at 10:15 AM today?

Queue priority also depends on evidence freshness, advertiser strength, contact quality, callback commitments, territory/campaign needs, and in-flight ownership.

Keep these layers separate.

---

# 2. HARD GATES BEFORE RANKING

A prospect is not ranked in the ready queue unless all required gates pass.

Examples:

- not suppressed/DNC
- not already leased/in-flight elsewhere
- no conflicting duplicate Account
- campaign eligible
- required research sufficiently fresh
- valid target company identity
- contact route exists according to Human Assist policy
- no requested callback requiring a different schedule
- no booked meeting making cold outreach inappropriate

Hard gates are not ranking penalties.

---

# 3. PRIORITY DIMENSIONS

Once eligible, compare separately:

## A. Relationship Obligation

Highest priority may be a promised callback, not the highest-scoring cold Account.

Classes:

1. requested callback due now
2. active follow-up due
3. warm prior conversation
4. fresh cold prospect

## B. YAD Fit

Canonical tier/score.

Prefer:

A before B before C under normal campaign policy.

## C. Advertiser Evidence Strength

Examples:

- repeated current high-intent search + LSA
- repeated current paid search
- single current high-intent observation
- transparency-only
- no confirmed ads

This is a tie-break/context signal, not extra Module 4C points.

## D. Hypothesis Strength

How well the available facts support a useful first business question.

## E. Research Completeness/Freshness

Prefer a complete/fresh Call Pack over equally fitting but stale/partial research.

## F. Decision-Maker / Contact Quality

Named confirmed relevant role > role-only > generic main line, all else equal.

## G. Market/Campaign Priority

Business owner may prioritize one market/vertical/campaign.

## H. Time-Sensitive Context

Examples:

- requested callback time
- active hail event
- recent advertising evidence aging soon
- current launch/season where business strategy explicitly prioritizes it.

---

# 4. LEXICOGRAPHIC COMPARATOR

Prefer an explainable ordered comparator over a single mystery weighted number for V1.

Suggested default order:

1. due requested callback / committed follow-up
2. campaign priority
3. YAD Tier
4. exact YAD score within Tier
5. current advertiser evidence strength
6. hypothesis strength
7. research freshness/completeness
8. decision-maker quality
9. oldest ready date / fairness

This can later be tuned by approved config.

---

# 5. WHY LEXICOGRAPHIC FIRST

Example:

Account A:

- Tier A 12
- weak contact info

Account B:

- Tier B 8
- confirmed marketing director

A weighted model might rank B above A depending weights.

That may be useful later, but V1 should preserve understandable business priority and then use contact quality as a tie-break unless campaign explicitly chooses otherwise.

---

# 6. CALLBACK OVERRIDE

If prospect says:

> “Call me Friday at 2.”

then when Friday 2 arrives, that follow-up should outrank ordinary cold prospects regardless of their fit score.

If outside requested time, the Account should not sit at top of ordinary queue causing accidental early contact.

---

# 7. WARM VS COLD

Relationship stage is explicit.

Possible classes:

- requested_callback
- engaged_followup
- email_sent_followup
- gatekeeper_referral
- prior_meaningful_conversation
- cold_researched

Do not pretend all Tier A records are equally cold.

---

# 8. ADVERTISER STRENGTH TIE-BREAK

Among equal-tier cold prospects, prefer stronger current paid-demand evidence when campaign strategy is advertiser-first.

Example:

Tier A 12:

- repeated `emergency AC repair` + LSA

should normally rank above Tier A 12:

- one generic `HVAC contractor` paid observation

for an advertiser-first HVAC campaign.

Do not infer spend.

---

# 9. HYPOTHESIS STRENGTH

Possible labels:

- STRONG
- GOOD
- TENTATIVE
- GENERIC_ONLY

Strong means:

- enough confirmed facts exist to ask a specific useful question;
- not that the pain is confirmed.

Example strong:

current emergency ads + 24/7 page + phone-heavy service.

Still ask what happens to calls; do not state missed calls exist.

---

# 10. RESEARCH COMPLETENESS

Suggested order:

COMPLETE > GOOD > PARTIAL > THIN

STALE requires refresh or safe strategy downgrade.

A stale ad-specific Call Pack should not outrank fresh research merely because old advertiser evidence was strong.

---

# 11. CONTACT QUALITY

Possible labels:

- confirmed_named_problem_owner
- confirmed_named_relevant_leader
- likely_named_contact
- role_only_main_line
- generic_main_line

Never manufacture contact detail to improve queue score.

---

# 12. FAIRNESS / STARVATION

A prospect should not remain buried forever because new Tier A records continuously arrive.

Use aging/fairness rules within comparable priority class.

Examples:

- oldest ready record first among otherwise equal prospects;
- campaign-specific max ready age before refresh or deprioritize.

---

# 13. MULTI-CAMPAIGN COLLISION

Same Account may qualify for HVAC and Plumbing campaigns.

Only one active outreach lease at a time unless manager explicitly coordinates otherwise.

Queue should show:

- other eligible campaign contexts
- active owner
- last contact

Do not let two reps call the same company with different vertical pitches on the same day.

---

# 14. HUMAN REP PERSONAL QUEUE

Rep view should show top reason:

> **Why #1:** Requested callback due now.

> **Why #4:** Tier A 14, strong Google advertiser evidence, complete research, confirmed operations director.

Explain priority in plain language.

---

# 15. LATER AUTONOMOUS QUEUE

If autonomous outbound is ever approved, the same ready comparator feeds the dial queue after deterministic compliance preflight.

Additional runtime factors may include:

- local calling window
- channel-specific policy
- concurrency
- number reputation/telecom controls

These remain gates/scheduling constraints rather than business-fit features.

---

# 16. LEARNED PRIORITY LATER

Future propensity models may estimate:

- probability of decision-maker reach
- probability of qualified conversation
- probability of meeting

Do not replace the V1 comparator until:

- enough labeled outcomes exist;
- model performance is validated;
- feature use is explainable/approved;
- sensitive/protected features are excluded;
- rollback exists.

Keep learned probability visible separately.

---

# 17. EXAMPLES

## Example A

Requested callback due, Tier B 8.

Ranks above cold Tier A because YAD made a commitment.

## Example B

Two cold Tier A 12 HVAC prospects.

One has current LSA + high-intent search + confirmed operations contact.

One has single generic ad + main line only.

First ranks higher.

## Example C

Tier A 14 research is stale and ad opener blocked.

Tier A 11 is fresh/complete.

Fresh account may rank above until stale account refresh completes.

## Example D

Tier A has active booked meeting tomorrow.

Remove from cold queue entirely.

---

# 18. CORE RULE

Ranking tells YAD which eligible relationship deserves attention next. It must respect promises and current state before optimizing cold-prospect attractiveness.
