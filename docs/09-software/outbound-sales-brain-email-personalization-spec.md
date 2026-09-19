# Your AI Department — Researched Cold Email Personalization Specification

**Status:** Architecture authority  
**Purpose:** Use Market Miner evidence and Sales Manual doctrine to generate concise, truthful cold-email personalization and campaign context without creepy overresearch, invented pain, or generic AI feature dumps.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

Cold email should use the same logic as cold calling:

1. honest relevance
2. one researched business hypothesis
3. short question/CTA
4. no unsupported claims.

The system should not create a five-paragraph dossier disguised as personalization.

---

# 2. INPUTS

`EmailPersonalizationContext`

- Account
- Contact/role if known
- vertical profile
- current fresh evidence
- advertiser strength
- primary/backup opportunity hypothesis
- current CommercialTruthSnapshot
- relationship history
- campaign objective
- approved email strategy/template family
- channel/contact policy.

---

# 3. PERSONALIZATION LEVELS

## LEVEL A — SPECIFIC CURRENT PUBLIC FACT

Example:

> “I came across your emergency AC campaign in Jacksonville…”

Requires fresh eligible ad evidence.

## LEVEL B — COMPANY-SPECIFIC PUBLIC WORKFLOW

Example:

> “I noticed you offer 24/7 service and online booking…”

Requires current first-party evidence.

## LEVEL C — VERTICAL-SPECIFIC QUESTION

Example:

> “Quick question: what happens to a replacement estimate that doesn't close the first time?”

Used when specific public research is insufficient.

Do not manufacture Level A from weak evidence.

---

# 4. EMAIL STRUCTURE

Preferred cold email body:

1. one relevance/personalization sentence
2. one operational question or problem hypothesis
3. one short YAD positioning line if needed
4. low-friction CTA.

Avoid:

- autobiography
- generic AI list
- inflated ROI
- “I know you're losing…”
- fake compliments
- fake familiarity.

---

# 5. ADVERTISER PERSONALIZATION

If current paid-search evidence:

Possible:

> “I came across your roof-replacement ads in Jacksonville. Quick question—once a paid lead gets a proposal but doesn't sign right away, is there a defined follow-up process across every rep?”

Do not say:

- “you're spending heavily”
- “you're wasting ad money”
- “your leads are expensive”

unless prospect provides/validates relevant facts.

---

# 6. CRM SIGNAL PERSONALIZATION

If ServiceTitan frontend signal:

Possible:

> “Looks like you have ServiceTitan-related booking on the site. Once a lead gets into your system, what happens automatically after the first no-response?”

Cautious wording is required.

Do not write:

> “I see you're using ServiceTitan but not following up.”

---

# 7. NO-WEBSITE PERSONALIZATION

Only when absence sufficiently verified:

> “I wasn't able to find a current website for the business, so I was curious where most new customers are finding you today.”

Do not insult the company or assume website is required.

---

# 8. TARGET ROLE PERSONALIZATION

If current role known:

Operations:
- workflow/capacity

Marketing:
- source/lead/attribution

Sales:
- estimate/proposal follow-up

Intake:
- response/scheduling

Do not overstate personal research about an individual.

---

# 9. SUBJECT LINES

Keep grounded and non-deceptive.

Examples:

- question about your after-hours leads
- Jacksonville AC lead follow-up
- roof proposal follow-up
- intake question
- estimate workflow question

Avoid fake reply/forward conventions or misleading urgency.

---

# 10. CTA OPTIONS

Examples:

- worth comparing notes for 10–15 minutes?
- is this something you own, or is there someone else I should ask?
- open to a quick look at the workflow?
- want me to send the specific example?

Use current approved scheduling path if booking link is included.

---

# 11. VARIANT GENERATION

A/B/C variants may vary:

- hook family
- subject
- CTA
- length
- ad-specific vs workflow-specific framing.

They may NOT vary:

- truth
- price facts
- guarantees
- professional boundaries
- DNC behavior.

---

# 12. EMAIL PROFILE FIELDS

Exportable fields may include:

- company_name
- contact_first_name
- role
- city
- vertical
- advertised_service
- current_ad_context
- public_signal_summary
- primary_hypothesis
- personalized_line
- first_question
- CTA_variant
- campaign_id
- account_id
- research_version
- profile_version.

Avoid sending sensitive/internal notes to external email platform unnecessarily.

---

# 13. STALENESS

If campaign sends days/weeks after research:

validate time-sensitive personalization first.

Stale ad evidence:

- downgrade to generic vertical/company workflow line
- or refresh.

Do not send “I see you're currently advertising” from old observation.

---

# 14. RELATIONSHIP AWARENESS

Do not send cold-first-touch email if Account already has:

- active conversation
- booked meeting
- requested callback
- DNC/opt-out
- proposal
- current client relationship.

Use Multi-Channel Coordinator.

---

# 15. FOLLOW-UP EMAILS

Sequence follow-ups should remain related to original hypothesis.

Do not switch from:

`after-hours calls`

to:

`SEO + websites + chatbots + AI training`

just to create more touches.

If no engagement after policy-approved sequence, stop according to campaign rules.

---

# 16. REPLY CLASSIFICATION

Replies feed relationship memory:

- positive interest
- correct person referral
- timing
- send information
- already solved
- not interested
- unsubscribe/opt-out
- wrong person/company
- out of office
- bounce.

Never leave a meaningful reply trapped only in Smartlead.

---

# 17. EMAIL QUALITY QA

Check:

- evidence freshness
- no unsupported problem claim
- correct service/market
- correct contact/company
- no stale system assertion
- current commercial truth
- no professional-boundary issue
- CTA clear
- reasonable length
- no creepy irrelevant detail.

---

# 18. ANALYTICS

Measure beyond opens:

- delivered
- reply
- positive reply
- correct-person referral
- qualified conversation
- meeting
- opportunity
- unsubscribe/complaint
- by hook/vertical/source/research strength.

Open tracking may be unreliable and should not become the main business metric.

---

# 19. ACCEPTANCE TESTS

1. Fresh HVAC ad -> ad-specific line allowed.
2. 30-day-old ad beyond TTL -> ad-specific line blocked/refresh.
3. ServiceTitan frontend signal -> cautious workflow question.
4. No named contact -> company/role-safe email, no fake first name.
5. Existing meeting -> cold email suppressed.
6. DNC/unsubscribe -> no send.
7. Law firm PI ad -> correct practice-area context.
8. Prospect website says multiple services -> email uses campaign service, not random service.
9. A/B variants change hook/CTA but not truth.
10. Positive reply -> Account relationship updates and generic sequence pauses.

---

# 20. CORE RULE

Research should make the email more relevant, not more presumptuous. A good YAD cold email sounds like one informed business question—not surveillance and not an AI-generated brochure.
