# Your AI Department — Prospect Queue Priority & Ranking Specification

**Status:** Architecture authority  
**Purpose:** Determine who appears first in a Market Miner/Human Assist/call queue without replacing the canonical Module 4C score with an opaque AI score.

---

# 1. PRINCIPLE

There are separate concepts:

- `Module4CScore` — stable YAD fit score.
- `AdvertiserEvidenceStrength` — how much fresh paid-demand evidence exists.
- `ResearchCompleteness` — how reliable/complete research is.
- `Contactability` — whether the contact/phone is usable/eligible.
- `QueuePriority` — who should be worked next for this campaign.

Queue priority combines them through explicit rules.

---

# 2. HARD ELIGIBILITY BEFORE RANKING

A record is not “low priority” if it fails a hard gate; it is ineligible.

Examples:

- DNC/suppressed
- wrong number
- active duplicate lease
- campaign excluded existing customer
- insufficient identity
- wrong category
- stale required research
- mode mismatch
- compliance denial for autonomous queue.

Remove/route to review before rank.

---

# 3. HUMAN DAILY QUEUE PRIORITY

Highest category first:

1. due prospect-requested callback
2. scheduled follow-up due
3. active opportunity action due
4. fresh Tier A first-touch campaign prospects
5. fresh Tier B first-touch
6. policy-eligible retry attempts
7. manager-assigned special tasks
8. lower-priority campaign records.

A promised callback outranks a brand-new “better” cold prospect.

---

# 4. NEW-PROSPECT RANKING — LEXICOGRAPHIC DEFAULT

For uncontacted eligible prospects, compare in this order:

1. campaign cohort/mode preference
2. Tier: A > B > C > D
3. canonical Module 4C total descending
4. campaign-specific required/preferred signal
5. advertiser evidence strength descending when advertiser-first
6. primary hypothesis strength/relevance
7. research completeness/freshness
8. contact/decision-maker usefulness
9. lower recent YAD contact burden
10. stable tie-breaker such as ready timestamp/Account ID.

Use lexicographic rules before inventing a single weighted number.

---

# 5. ADVERTISER-FIRST MODE

Preferred cohorts:

- confirmed fresh Google/approved paid advertiser
- cross-channel/LSA strength where relevant
- gap-fill only if enabled.

Example order:

Tier A advertiser score 14
>
Tier A advertiser score 11
>
Tier B advertiser score 8
>
Tier A non-ad gap-fill

if campaign's configured cohort policy explicitly says advertisers before gap-fill.

Alternative campaign may rank Tier A non-ad above Tier B advertiser; this must be explicit campaign config, not silent algorithm drift.

---

# 6. ADVERTISER-ONLY MODE

Non-ad/unknown-ad Accounts are ineligible, not lower-ranked.

No gap-fill.

---

# 7. LOCAL-MARKET-FULL MODE

Tier/score generally precedes advertiser status.

Example:

Tier A non-ad score 12 may rank above Tier B advertiser score 8.

Advertising is a strong score/evidence component but not sole campaign purpose.

---

# 8. NO-WEBSITE MODE

Campaign eligibility requires `no_verified_website_found` under source policy.

Within eligible list, rank by:

- strategic business fit / vertical priority
- operational scale signals
- current business activity evidence
- contactability
- canonical YAD score as useful secondary context.

Do not inflate Module 4C score just because no website is the offer trigger.

---

# 9. PRIMARY HYPOTHESIS STRENGTH

Separate internal band:

- `strong` — multiple fresh facts create a clear question
- `moderate` — one meaningful public signal + vertical model
- `general` — business/vertical fit but little account-specific evidence.

Do not convert hypothesis strength into claimed pain.

Use it to choose among otherwise similar prospects.

---

# 10. RESEARCH COMPLETENESS

Within similar fit:

- complete/fresh can rank above partial
- partial high-fit can be sent to refresh queue instead of sales queue.

Do not allow a beautifully researched Tier C record to outrank a Tier A just because it has more data unless campaign explicitly prioritizes research completion and Tier A is not sales-ready.

---

# 11. CONTACT CONFIDENCE

Useful verified decision-maker can break ties.

But:

- no decision-maker does not eliminate a strong SMB account when gatekeeper/main-business line is valid;
- do not overpay for contacts merely to improve ranking.

---

# 12. ATTEMPT / CONTACT BURDEN

Before each queue appearance consider:

- total recent Account attempts
- Contact attempts
- Phone attempts
- other campaign activity
- requested timing.

A prospect with repeated recent calls should not stay at top solely because score is high.

---

# 13. FRESHNESS

If primary hook relies on current ad/offer evidence and it is near/outside TTL:

- send to priority refresh
- only return to sales queue after valid refresh or safe non-stale hook generation.

“High score” does not authorize stale claims.

---

# 14. EXPLAINABILITY

Every queue item gets:

```text
QueuePriorityExplanation
- priority_class
- cohort
- tier
- score
- key score reasons
- advertiser strength
- hypothesis band
- research readiness
- contact readiness
- contact-history note
- why ranked ahead of next items (summary)
```

Human UI can say:

> Tier A 14; fresh Google + LSA; emergency/replacement; 2 locations; strong after-hours hypothesis; research complete.

Not:

> AI priority 97.43.

---

# 15. OPTIONAL INTERNAL SORT KEY

Implementation can create numeric/compound sort key for database efficiency, but it must be generated from documented comparator fields.

Do not expose it as a business “lead score” if meaning is just queue mechanics.

---

# 16. DIVERSITY / EXPLORATION

Future analytics may recommend reserving a small portion of research/outreach for:

- new query families
- new markets
- Tier B
- non-ad gap-fill

so system can learn.

This is experiment allocation, not hidden random reordering of promised callbacks.

V1: manager-controlled.

---

# 17. REP ASSIGNMENT

After ranking, assignment can consider:

- territory
- vertical expertise
- current workload
- account ownership
- prior relationship.

Do not let assignment create duplicate simultaneous outreach.

---

# 18. AUTONOMOUS CALL QUEUE

Later, before actual Twilio request:

Recheck:

- current rank/eligibility
- compliance decision
- suppression
- calling window
- attempt cadence
- kill switch
- contact lease.

A queue record is not a permanent authorization.

---

# 19. CALL QUEUE STARVATION

If high-scoring same type always fills queue, lower-priority exploration can starve.

Only introduce controlled exploration after core quality is proven.

Do not lower call quality just to “use the database.”

---

# 20. FIXTURE A — SAME TIER, AD STRENGTH

A: Tier A 12, Google current + LSA + multiple high-intent queries.

B: Tier A 12, one generic Google paid observation.

Advertiser-first campaign:

A ranks above B.

Canonical scores unchanged.

---

# 21. FIXTURE B — REQUESTED CALLBACK VS TIER A

A: requested callback due now, Tier B.

B: new Tier A score 15.

Human daily queue:

A first.

---

# 22. FIXTURE C — STALE TIER A

A: Tier A, primary ad hook stale.

B: Tier A, fresh research.

A goes to refresh/not sales-ready until updated; B can rank first.

---

# 23. FIXTURE D — DNC

Highest possible score but suppressed.

Expected:

not in sales/call rank at all.

---

# 24. FIXTURE E — ADVERTISER ONLY

Target 100; 60 advertisers + 40 Tier A non-ad.

Expected:

only 60 eligible; non-ad not ranked.

---

# 25. ANALYTICS

Track outcomes by queue component:

- Tier
- score
- advertiser strength
- hypothesis strength
- research completeness
- decision-maker confidence.

Future learned propensity may become another ranking feature after enough data, but remains separate from canonical score and explainable.

---

# 26. ACCEPTANCE

- hard ineligible records never appear as low-priority callable records
- requested callbacks outrank new cold inventory
- canonical score remains visible/unchanged
- campaign mode changes ranking transparently
- stale research routes to refresh
- ranking explanation available
- no opaque model-generated single score required.
