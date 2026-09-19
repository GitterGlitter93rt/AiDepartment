# Your AI Department — Contact Time Learning Specification

**Status:** Architecture / experiment authority  
**Date:** 2026-09-03  
**Purpose:** Improve when eligible prospects are contacted without hard-coding third-party cold-call folklore, violating local calling windows, or creating aggressive retry behavior.

---

# 1. PRINCIPLE

Timing is a **ranking variable inside an already-allowed contact window**.

It is never a permission source.

Correct order:

```text
relationship / requested callback
-> DNC / channel eligibility
-> local legal/policy calling window
-> cadence / attempt budget
-> candidate eligible now?
-> timing preference score
-> rep recommendation / approved AI scheduler
```

A high predicted connect rate cannot override a blocked contact.

---

# 2. EXTERNAL RESEARCH — DIRECTIONAL ONLY

Recent public sales research provides useful seed priors but not universal truth.

Examples reviewed:

- Gong Engage analytics reports stronger connect rates in Tuesday/Wednesday morning windows in its observed dataset;
- Cognism/WHAM 2025 data reports Tuesday as a strong meeting-booking day and roughly 10–11 AM as the strongest talk-time window, with 2–3 PM also performing well;
- Cognism's 2026 report continues to emphasize using actual team/region data rather than assuming one universal schedule.

YAD may use these only to seed controlled exploration.

Do not present these third-party results as YAD benchmarks or guarantees.

---

# 3. HARD BOUNDARY — POLICY WINDOW

Every destination has a versioned permitted call window from the compliance engine.

The timing learner receives only eligible candidate windows.

It cannot schedule outside:

- jurisdiction policy;
- campaign policy;
- destination timezone;
- holiday/weekend rules where applicable;
- attempt budget;
- requested callback agreements;
- manager pause/kill switch.

Use the stricter configured rule when policy is unresolved.

---

# 4. REQUESTED CALLBACK ALWAYS WINS

If prospect says:

> Call me Friday at 2.

then:

`requested_callback_at` overrides generic timing optimization.

Do not move it to Tuesday at 10 AM because historical connect data says Tuesday performs better.

Likewise:

- meeting booking;
- prospect-requested email-only path;
- specific follow-up date;
- DNC;

all outrank learned cold-call timing.

---

# 5. INITIAL EXPLORATION WINDOWS

Within current legal/policy hours, create configurable local-time buckets such as:

```text
08:00–09:00
09:00–10:00
10:00–11:00
11:00–12:00
12:00–13:00
13:00–14:00
14:00–15:00
15:00–16:00
16:00–17:00
17:00–18:00 if policy permits and campaign intentionally tests
```

Do not assume every bucket is valid in every jurisdiction/campaign.

Initial **soft priors** may slightly favor:

- Tuesday/Wednesday morning;
- 10–11 AM local;
- 2–3 PM local;

based on external research, but still reserve meaningful exploration in other eligible windows.

No bucket should be permanently starved before YAD has enough data.

---

# 6. VERTICAL / PERSONA LEARNING

Timing may differ by workflow owner.

Dimensions:

- vertical;
- target role;
- market/timezone;
- business size band if supported;
- contact route type;
- main-line vs named/direct route;
- human manual vs autonomous AI channel;
- first attempt vs later eligible attempt.

Examples of hypotheses to **test**, not assume:

- field-service owner availability may differ from office manager availability;
- front-desk/main-line gatekeepers may be easier at different times than owners;
- law intake teams may behave differently from roofing sales managers.

Do not encode stereotypes without data.

---

# 7. OUTCOME HIERARCHY

Do not optimize only `answered`.

Per timing bucket track:

1. attempted;
2. human answered;
3. right stakeholder reached;
4. useful process fact obtained;
5. meaningful problem supported;
6. qualified strategy call offered;
7. booked;
8. attended;
9. qualified attended meeting;
10. opportunity;
11. DNC/negative reaction;
12. opening hangup.

A window with high answer rate but poor stakeholder/meeting quality is not automatically better.

---

# 8. RECOMMENDATION SCORE

Keep timing score separate from fit/qualification.

Conceptual:

```text
TimingPreferenceScore
- account/contact/role segment
- local_time_bucket
- weekday
- sample_size
- human_answer_rate
- right_stakeholder_rate
- meaningful_problem_rate
- qualified_attended_rate
- negative_rate
- uncertainty
- prior_weight
- learned_score
- generated_at
```

Do not modify Module 4C score/Tier with call-time performance.

---

# 9. EXPLORATION VS EXPLOITATION

Early data is sparse.

Use a conservative strategy such as:

- soft prior + randomized exploration;
- or Bayesian/upper-confidence approach later.

Do not implement opaque self-optimizing behavior in V1 if a simple transparent weighted model is enough.

Manager should be able to see:

`Recommended window: 10–11 AM local · limited YAD data · seeded from external prior`.

Once enough YAD data exists:

`Recommended window: 2–3 PM local · 84 comparable attempts · higher right-stakeholder rate`.

---

# 10. SAMPLE SIZE

Do not declare a winning time from five calls.

Reports must show:

- numerator;
- denominator;
- confidence/uncertainty label;
- date range;
- segment filters.

Use labels like:

- INSUFFICIENT_DATA
- EARLY_SIGNAL
- MODERATE_EVIDENCE
- STRONG_INTERNAL_EVIDENCE

Thresholds should be versioned analytics config rather than improvised in UI.

---

# 11. REP PORTAL

For human reps, timing is advisory.

`My Prospects` may show:

- `Good time to try`;
- `Requested callback 2:00 PM`;
- `Calling window closed`;
- `Try tomorrow morning`;

but never hide good Accounts solely because their preferred timing window is not now.

Requested callbacks appear ahead of generic recommendations.

---

# 12. AI PILOT / AUTOPILOT

For autonomous AI voice, timing can determine ordering only **after exact candidates pass all hard gates**.

Earliest pilot remains manager-selected and one-at-a-time.

No auto-batch expansion merely because the `best time` window starts.

At scale, scheduler may select among currently ALLOW candidates by timing score + queue priority while respecting:

- max concurrency;
- contact attempt budget;
- number health;
- campaign limits;
- provider capacity;
- kill switch.

---

# 13. ATTEMPT NUMBER

Timing analysis should distinguish attempt number.

Do not mix:

- first attempt;
- requested callback;
- third no-answer retry;
- prior gatekeeper best-time call.

These have different intent and selection bias.

---

# 14. VOICEMAIL

Leaving voicemail can affect future contact behavior and cross-channel response.

Timing learner should retain:

- voicemail left?;
- attempt number;
- subsequent callback;
- email reply after voicemail.

Do not conclude a time bucket is worse because more machine answers occurred if those voicemails later generated useful callbacks.

---

# 15. SELECTION BIAS

High-quality prospects may already be preferentially called at certain times.

Therefore raw conversion by hour can be misleading.

During learning:

- retain Tier/fit/contact route/vertical/attempt number;
- use controlled exploration where practical;
- avoid comparing one hour full of Tier A direct contacts against another hour full of main-line Tier B prospects as if time caused the difference.

---

# 16. TIMEZONE

All analysis uses prospect-local time plus canonical UTC timestamp.

Store:

```text
attempted_at_utc
prospect_timezone
prospect_local_weekday
prospect_local_hour_bucket
```

Server/rep local time is irrelevant to the prospect timing model.

---

# 17. SEASONALITY

Later, timing model may incorporate:

- season;
- storm/event period;
- vertical busy season;
- market-specific patterns.

Do not enable complex seasonal timing before base volume supports it.

Recent data may receive more weight than old data, but do not erase historical observations.

---

# 18. CAMPAIGN SETTINGS

Manager can configure:

- eligible days within policy;
- preferred exploration windows;
- AI call capacity per hour/day;
- excluded business-sensitive windows;
- minimum sample before learned prioritization applies.

Manager settings may be **stricter** than compliance policy, never more permissive.

---

# 19. ANALYTICS

Charts:

- human answer by local hour/day;
- right stakeholder by local hour/day;
- qualified attended meeting by local hour/day;
- DNC/negative reaction by local hour/day;
- attempts/sample size heatmap.

Use counts in tooltip/cell.

Do not render a dark `best hour` cell without showing that it might have six attempts.

---

# 20. EARLY YAD TEST PLAN

After Human Assist reps have meaningful volume, compare eligible attempts across:

- 9–10 AM;
- 10–11 AM;
- 11–12 PM;
- 1–2 PM;
- 2–3 PM;
- 3–4 PM;

subject to current policy and rep availability.

For initial AI pilot:

- do not test timing and opener frame simultaneously if avoidable;
- use a normal business-hours window with clear policy;
- focus first on voice/runtime correctness.

---

# 21. CORE RULE

**Compliance decides when YAD may call. The prospect's request decides when YAD should call them back. Only after those conditions are satisfied should historical performance influence which eligible prospect is worked next. Seed timing with public research, then replace assumptions with transparent YAD data.**
