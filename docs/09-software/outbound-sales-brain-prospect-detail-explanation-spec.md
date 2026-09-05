# YAD Sales Brain — Prospect Detail Explanation Specification

**Status:** Product/design authority  
**Implementation owner:** Claude Code  
**Purpose:** Make every prospect understandable to a rep in under one minute without exposing raw model reasoning or overwhelming them with research logs.

---

# 1. CORE QUESTION

The Account page must answer:

> Why is this company worth contacting, who should I contact, what should I ask, and what must I not assume?

The UI should show concise decision evidence, not chain-of-thought.

---

# 2. HERO SUMMARY

Top of Account page/drawer:

- company name
- city/market
- vertical/business context
- Tier + canonical score
- advertiser evidence strength
- research completeness
- owner
- relationship state
- research freshness

Primary actions:

- Call
- Email
- Claim / Owned status
- Follow-Up
- Disposition

---

# 3. WHY THIS PROSPECT

Show one short generated summary grounded in evidence.

Example:

> Observed running Google paid search for emergency AC in Jacksonville. Public website emphasizes 24/7 response, financing, phone intake and estimate requests. This makes after-hours paid-lead handling worth investigating.

Separate into:

## Confirmed / observed

Facts the rep may safely reference.

## Hypothesis

What the rep should investigate.

Never visually blur these together.

---

# 4. CONTACT TARGET

Show:

- best known contact
- title/role
- email
- phone
- source/quality indicator
- alternate contacts
- target role if exact decision maker unknown

Example:

**John Smith — Owner**  
Business email — provider verified  
Main business line — website verified

If person unknown:

> Ask for: Owner / GM / Operations

Do not invent a person to make the card look complete.

---

# 5. SALES APPROACH

Show:

## Primary angle

One business issue/hypothesis.

## Backup angle

Second evidence-supported question.

## First question

A natural question from Sales Manual guidance.

## If they say...

Only surface the 2–4 most likely relevant objections/responses for this Account/vertical.

Do not dump the entire objection manual into the card.

---

# 6. DO NOT CLAIM

This is a first-class UI component.

Examples:

- do not claim exact ad spend
- do not say they miss calls
- do not say their CRM is broken
- do not claim ServiceTitan automation is absent
- do not claim reviews prove a systemic issue

Use warning styling but keep concise.

---

# 7. SIGNALS

Signal grid should show only evidence-backed current/usable signals.

Potential signals:

- Google Ads observed
- Local Services Ads observed
- Meta ads observed
- emergency/24-7
- financing
- multiple locations
- strong phone CTA
- quote/estimate form
- booking
- CallRail
- ServiceTitan-related frontend signal
- HubSpot form
- hiring/growth

Each signal opens evidence details:

- source
- observed time
- confidence
- current/stale

Unknown should remain absent or explicitly `Unknown`; never render as a red `No` by default.

---

# 8. PAID FUNNEL SNAPSHOT

If ad evidence exists, show compact funnel:

`Google ad` → `landing page` → `Call / Form / Booking` → `backend unknown`

Example:

- Query: emergency AC Jacksonville
- Advertised service: emergency AC repair
- Landing page: /ac-repair
- CTA: Call Now + Schedule Service
- Call tracking: observed
- Backend workflow: unknown

This gives reps context without fake-lead submissions.

---

# 9. SCORE EXPLANATION

Show the deterministic score breakdown.

Example:

- +4 Google high-intent advertising
- +2 high-value economics
- +2 lead/estimate volume important
- +1 24/7
- +1 estimate/appointment flow
- +1 strong phone dependence
- +1 form/booking CTA

Total: 12 — Tier A

No hidden AI points.

If a score item is based on an approved vertical recognition rule, show that label.

---

# 10. RESEARCH COMPLETENESS

Show what we know vs what remains missing.

Example:

**Research: GOOD**

Known:
- website
- business phone
- Google ads
- offer
- landing funnel

Missing:
- confirmed decision maker
- Meta status
- backend CRM workflow

This helps reps know what to ask instead of assuming missing data means no.

---

# 11. SHARED TIMELINE

Timeline events:

- discovered
- ad observation
- research refresh
- claimed/released/reassigned
- call/email attempt
- Smartlead reply
- contact correction
- callback
- meeting
- assessment completion
- proposal/opportunity
- DNC

Ordinary reps should see business-relevant events without provider/debug noise.

---

# 12. QUICK NOTE / CORRECTION

Rep must be able to correct research from real conversation.

Examples:

> Uses Housecall Pro, not ServiceTitan.

> Mary is the office manager; ask for her.

> Main number routes to answering service after 5pm.

Prospect-provided facts should be source-labeled and generally outrank weaker public hypotheses.

Do not overwrite historical evidence silently; add new evidence/correction.

---

# 13. MOBILE PRIORITY

On mobile, first screen should show:

- company
- Tier
- contact
- Call button
- Email button
- Why Reach Out
- First Question
- Do Not Claim

Secondary research sections can collapse below.

A field rep should not scroll through 2,000 words before finding the phone number.

---

# 14. HARD FAILS

Implementation fails if:

- AI-generated hypothesis is visually presented as confirmed fact;
- raw chain-of-thought/model reasoning is shown;
- score cannot be explained by canonical point inputs;
- stale advertising evidence is presented without freshness;
- missing CRM detection displays `No CRM`;
- rep corrections delete prior evidence history;
- DNC/ownership state is visually hidden.

---

# 15. ACCEPTANCE TARGET

A new rep should open an unfamiliar Account and, within 60 seconds, correctly answer:

1. What does this company do?
2. Why did YAD rank it highly?
3. Who should I try to reach?
4. What is the first relevant business question?
5. What am I not allowed to assume?
6. Has anybody at YAD already contacted them?