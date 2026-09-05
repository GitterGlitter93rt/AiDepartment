# Your AI Department — Sales AI Opener Selector

**Status:** Architecture authority  
**Date:** 2026-09-03  
**Purpose:** Choose the strongest truthful opening for each researched prospect without creating one script per vertical or randomly rotating canned lines.

---

# 1. PRINCIPLE

The opener is generated from **evidence + business context**, not vertical name alone.

One core Sales AI should sound researched because it chooses the most relevant business-process question for the actual Account.

The opener should answer quickly:

1. Who is calling?
2. Why might this be relevant?
3. What is the one question?

---

# 2. OPENER INPUT

```text
OpenerContext
- account
- target_contact/role
- vertical_profile
- market/geography
- fresh advertiser observations
- advertised service/offer
- first-party website signals
- primary opportunity hypothesis
- hypothesis evidence strength
- contact source/confidence
- campaign identity/disclosure policy
- prior Account contact history
```

Do not feed unrelated research into opener selection.

---

# 3. OPENER PRIORITY

Prefer the most specific truthful context available.

## Priority 1 — Fresh paid-demand/service observation

Use when YAD has fresh, claim-safe evidence that the company is currently advertising a specific service/market.

Pattern:

> Hey [Name], [identity] with Your AI Department. This is a cold call, so I'll be brief. I came across you guys while looking at companies advertising [service] around [market], and I had one question about what happens after those leads come in.

Then primary process question.

Do not mention spend, performance, volume or agency quality.

## Priority 2 — First-party business-model signal

Example:

- 24/7/emergency service;
- consultation-heavy funnel;
- online estimate/booking;
- multiple locations;
- high-value proposal workflow.

Pattern:

> Hey [Name], [identity] with Your AI Department. Quick cold call. I saw you guys handle [observable service/workflow], and I had one question about how [process] works on your side.

## Priority 3 — Market + business-category relevance

When no strong current advertising claim exists:

> Hey [Name], [identity] with Your AI Department. This is a cold call, so I'll be brief. I was looking at [business category] companies around [market] and had one question about [process].

Do not imply current ad activity.

## Priority 4 — Role-based process question

When public business context is weak but correct stakeholder is known:

> Hey [Name], [identity] with Your AI Department. Quick cold call — I had a question about how your team handles [process].

---

# 4. PRIMARY HYPOTHESIS TO QUESTION MAP

Universal categories:

## after_hours_lead_handling

> When somebody reaches out after hours looking for a new service, what happens today?

## simultaneous_call_overflow

> When a new call comes in while everybody's already tied up, what happens next?

## missed_call_recovery

> If a legitimate new-business call reaches voicemail, what actually keeps working it until somebody connects?

## speed_to_lead

> How quickly does a brand-new inquiry normally hear from somebody?

## unsold_estimate_or_proposal

> What normally happens to an estimate or proposal that doesn't close the first time?

## crm_followup

> Once a lead gets into your system, what actually keeps the follow-up moving?

## attribution

> Can you currently trace a lead from the original source all the way to actual revenue?

## admin_capacity

> What repetitive office task eats more employee time than you think it should?

## reactivation

> What happens to older leads or customers that go quiet — does anything consistently bring them back into the pipeline?

## appointment_no_show

> When somebody books and doesn't show, what happens after that?

## long_term_nurture

> When somebody isn't ready right now but might be in a few months, what keeps that relationship alive?

---

# 5. DECISION-MAKER NAME CONFIDENCE

Use first name in opener only when current contact identity has sufficient support under Contact policy.

If name uncertain:

- use role/gatekeeper route;
- do not guess pronunciation/identity;
- do not personalize just to sound researched.

---

# 6. EXISTING CONTACT HISTORY

If Account has prior legitimate YAD interaction, the opener must use the actual history rather than generic cold framing.

Examples:

- requested callback;
- prior email reply;
- rep conversation;
- assessment completion;
- prior strategy booking.

Never call a requested callback `a cold call` if it is actually a callback.

Never use fake familiarity when no prior interaction exists.

---

# 7. AVOID OVER-SPECIFIC RESEARCH CREEPINESS

Do not cram multiple public facts into the opening.

Bad:

> I saw you have 4.7 stars, 312 reviews, opened your Jacksonville branch in 2022, use CallRail, advertise AC replacement and finance through...

Good:

> I came across you while looking at companies advertising AC replacement around Jacksonville. Quick question about what happens after those leads come in.

Research should create relevance, not surveillance vibes.

---

# 8. OPENER VARIATION

Variation should be **semantic and constrained**, not random creative writing.

Approved dimensions:

- `This is a cold call, so I'll be brief.`
- `Quick cold call — I'll keep it short.`
- `I know I'm calling you out of nowhere; quick question.`

Reason-context options:

- `came across you while looking at companies advertising...`
- `was looking at [category] companies around...`
- `saw you guys handle [observable service]...`

Question remains driven by hypothesis.

Do not A/B test deceptive or aggressive language.

---

# 9. WHEN NOT TO USE ADVERTISING CONTEXT

Do not say `I saw you're advertising` when:

- evidence is stale;
- observation is ambiguous/aggregator;
- business identity match is weak;
- only organic/local result exists;
- only Meta context exists but wording implies Google;
- current campaign does not have claim-safe evidence.

Use generic business/category context instead.

---

# 10. OPENING QUALITY CHECK

Before first audio, verify:

- company identity correct;
- contact name confidence sufficient if used;
- service/market claim evidence fresh;
- primary question matches active vertical/business context;
- no unsupported negative claim;
- no stale prior-contact assumption;
- one question only.

If verification fails, degrade gracefully to a safer generic process opener.

---

# 11. EXAMPLES

## HVAC advertiser

> Hey Mike, this is [identity] with Your AI Department. Quick cold call — I came across you guys while looking at companies advertising emergency AC around Jacksonville. When a new call hits after hours, what happens today?

## Roofing advertiser

> Hey John, [identity] with Your AI Department. This is a cold call, so I'll be brief. I saw you guys advertising roof replacement around St. Augustine. What normally happens to an estimate that doesn't close the first time?

## Law current divorce-ad context

> Hey Sarah, [identity] with Your AI Department. Quick cold call. I came across the firm while looking at family-law advertising in Jacksonville. What happens to a new inquiry that comes in after the office closes?

Do not use personal-injury language simply because the firm also has a PI page.

## Collision shop, no fresh ad evidence

> Hey Mike, [identity] with Your AI Department. I know I'm calling out of nowhere. Quick question — what normally happens to an estimate that doesn't turn into a repair right away?

## Real estate seller funnel

> Hey Chris, [identity] with Your AI Department. Quick cold call. I was looking at real-estate teams around Jacksonville and had a question — when a homeowner isn't ready to list yet, what keeps the follow-up going over the next few months?

---

# 12. CORE RULE

**Use the strongest truthful reason for the call, then get out of the way and ask one good business question.**
