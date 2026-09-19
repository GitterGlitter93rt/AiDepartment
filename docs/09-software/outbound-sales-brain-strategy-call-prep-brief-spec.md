# Your AI Department — Strategy Call Prep Brief Specification

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Ensure Michael enters every AI-booked strategy call with the important context already synthesized from public research and the prospect's own conversation.

---

# 1. OUTPUT

Generate one concise mobile-friendly `StrategyCallPrepBrief` when a meeting is booked and refresh it if meaningful new Account evidence arrives before meeting time.

The brief must distinguish:

- confirmed public facts;
- prospect-stated facts;
- hypotheses;
- unresolved questions.

Do not mix them into one narrative that looks equally certain.

---

# 2. HEADER

```text
YAD 15-Minute AI Strategy Call
[Company]
[Prospect Name] — [Role]
[Date / time / timezone]
[Cal Video link]
Source: AI Outbound / Human / Assessment / Other
Account owner: [rep]
```

---

# 3. 30-SECOND READ

First card should answer:

**Why are we meeting?**

Example:

> John said roofing estimate follow-up is handled individually by each salesperson and he does not have a simple view of whether every open proposal is being worked consistently. He agreed it is worth reviewing the workflow.

Only use prospect-stated content as statements about internal workflow.

---

# 4. PUBLIC RESEARCH CONTEXT

Small section:

- vertical;
- service/market;
- current advertising evidence if fresh;
- relevant public funnel/CTA;
- locations;
- important first-party business signals.

Example:

> Public research: current Google paid-search observation for roof replacement in Jacksonville; website advertises financing and free inspections.

Never convert these into internal business performance claims.

---

# 5. WHAT THE PROSPECT SAID

Quote/paraphrase concise factual points with call-turn references internally:

- current workflow;
- systems;
- owner of process;
- pain/gap;
- numbers;
- urgency/timing;
- objections.

Example:

- `Salespeople handle their own estimates.`
- `No standard team-wide follow-up sequence stated.`
- `Management visibility into untouched proposals described as difficult.`

If a number is approximate, label it approximate.

---

# 6. CURRENT OPPORTUNITY HYPOTHESIS

One to three categories maximum:

1. primary;
2. optional secondary;
3. measurement-first if applicable.

Example:

> Primary: proposal follow-up consistency/visibility.  
> Secondary: CRM/pipeline reporting only if current system data supports it.

Do not prescribe exact technology before discovery/feasibility.

---

# 7. FIVE QUESTIONS MICHAEL SHOULD ASK

Generate only unanswered/high-value questions.

Examples:

1. Where does each estimate live today?
2. Who owns follow-up after the estimator leaves?
3. Roughly how many proposals remain open in a normal month?
4. What can management see about last-touch/next-action today?
5. What would a better process need to integrate with?

Do not ask five when only two are needed.

---

# 8. DO NOT ASSUME

Prominent warning panel.

Examples:

- do not assume ad spend;
- do not assume missed revenue;
- do not assume close rate;
- do not assume CRM detected publicly is still used;
- do not assume decision-maker controls technology budget;
- do not assume integration feasibility;
- do not assume implementation is needed.

Populate from Call Pack `do_not_claim` and conversation uncertainty.

---

# 9. OBJECTIONS / CONCERNS

Examples:

- does not want to replace receptionist;
- previous automation failed;
- security concern;
- already has agency/CRM;
- price concern;
- busy season/timing.

Include only actually expressed concerns, not generic possibilities.

---

# 10. WHAT YAD ALREADY TOLD THEM

Capture material commitments/expectations:

- 15-minute purpose;
- promised follow-up;
- specific material to send;
- whether a demo was discussed;
- any pricing/range actually stated;
- any technical caveat.

Michael must not contradict prior approved promises accidentally.

---

# 11. SUGGESTED NEXT-STEP OPTIONS

System can suggest categories based on current evidence:

- measurement/data request;
- AI Department Assessment;
- deeper discovery;
- Executive AI Strategy discussion;
- implementation feasibility review;
- service-specific consultation;
- no sale.

Label as recommendations, not predetermined outcome.

---

# 12. SOURCE LINKS

Keep a collapsed/details section for:

- Account page;
- original Call Pack;
- outbound call recording/transcript;
- key public evidence links;
- assessment response if completed;
- prior email thread/reply when available.

Michael should not have to search across systems.

---

# 13. DELIVERY

Make brief visible in:

- YAD Sales Portal meeting detail;
- Account timeline;
- optionally a pre-meeting notification/digest.

Do not put confidential internal notes into the prospect's Cal.com invite.

---

# 14. REFRESH

If prospect completes Assessment or sends material reply before the meeting:

- update brief;
- mark what changed;
- preserve previous snapshot in history;
- avoid overwriting prospect statements incorrectly.

---

# 15. CORE RULE

**Michael should be able to understand the entire reason for the meeting in under 60 seconds without replaying the cold call.**
