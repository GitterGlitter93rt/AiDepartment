# Your AI Department — Outbound Sales Voicemail Specification

**Status:** Architecture authority  
**Purpose:** Keep voicemail short, relevant, traceable to the original research hypothesis, and useful for inbound callbacks without turning voicemail into a recorded sales presentation.

---

# 1. PRINCIPLE

Voicemail objective:

> Give the prospect enough context to know who called and why, without pitching the entire company.

The Sales Manual doctrine remains:

- short
- name/company
- one specific workflow question
- callback number if appropriate
- no full pitch.

---

# 2. VOICEMAIL ELIGIBILITY

Campaign/contact policy decides:

- whether voicemail may be left
- which attempt(s)
- maximum count
- AI/artificial voice policy
- whether prerecorded/generated voicemail is allowed
- callback number.

The LLM does not independently choose to leave one if policy denies it.

---

# 3. CONTENT INPUT

Use Call Pack:

- approved caller identity
- Account/company
- primary hook/hypothesis
- fresh research fact only if safe
- callback number
- human/AI callback routing context.

No CRM/system assumption.

---

# 4. DEFAULT STRUCTURE

1. identity
2. one reason/question
3. callback/“I'll try again” according to campaign
4. identity/name once more if natural.

Target roughly 10–20 seconds.

Avoid 45–90 second voicemail.

---

# 5. EXAMPLE — ADVERTISER

When current evidence is fresh:

> Hey, this is [approved identity] with Your AI Department. I had a quick question about how you handle the emergency AC leads you're advertising for in Jacksonville, especially after hours. You can reach us at [number]. Again, Your AI Department.

Do not say:

> You're wasting money on Google and we can fix it.

---

# 6. EXAMPLE — NON-ADVERTISER

> Hey, this is [approved identity] with Your AI Department. I had a quick question about what happens to replacement estimates that don't close on the first conversation. You can reach us at [number].

Only use when that hypothesis is valid from vertical/business context.

---

# 7. STALE RESEARCH

If ad evidence went stale before voicemail:

- refresh
- or use non-ad/research-safe question.

Do not record current-tense stale claim just because original Call Pack was created earlier.

---

# 8. MACHINE DETECTION UNCERTAINTY

If AMD/answer classification ambiguous:

- avoid playing voicemail over a real person if possible
- benchmark behavior.

Human experience is priority.

Campaign can use conservative fallback when classification confidence insufficient.

---

# 9. VOICEMAIL VARIANTS

V1 can have small controlled variants:

- primary workflow question
- requested callback follow-up
- prior conversation callback.

Do not A/B test deceptive urgency/scarcity.

---

# 10. FOLLOW-UP VOICEMAIL

Second voicemail, if policy permits, should have a reason and not repeat exact script.

Example:

> Hey Mike, this is [identity] with Your AI Department. I was following up on the replacement-estimate question I left earlier. If that's already handled well, no problem — I just wanted to see if it's relevant before I keep bothering you.

Campaign/company policy controls actual wording/frequency.

---

# 11. CALLBACK NUMBER

Use a legitimate YAD inbound-capable number.

The number should route through `inbound_sales_callback` context where possible.

Do not leave a number that rings into a generic unrelated script.

---

# 12. NUMBER SPEECH

Pronounce callback number naturally.

Consider repeating once if needed, not multiple robotic repetitions.

Voice benchmark tests clarity.

---

# 13. CALLBACK ATTRIBUTION

Voicemail event stores:

- Call ID
- campaign
- voicemail variant
- primary hypothesis
- callback number
- timestamp.

Inbound callback can attribute:

- voicemail -> callback
- time-to-callback
- outcome.

---

# 14. EMAIL/SMS AFTER VOICEMAIL

Do not automatically send another channel merely because voicemail was left.

Separate communication policy/permission required.

Campaign may have approved multi-channel cadence, but voice event alone is not universal SMS/email consent.

---

# 15. DNC HISTORY

If phone/account is suppressed:

- no voicemail call should have been initiated.

If DNC occurs via inbound callback after voicemail:

- suppression applies immediately
- pending voicemail/retry tasks cancel.

---

# 16. VOICEMAIL CONTENT VALIDATOR

Before playback/generation:

- no unsupported current fact
- no invented ad spend/ROI
- no fake urgency
- no fake referral
- no unapproved price
- callback number approved
- duration/text length within campaign target.

---

# 17. STATIC VS GENERATED

## Static/template voicemail

Advantages:

- predictable
- fast
- easy compliance review.

## Generated prospect-specific voicemail

Advantages:

- relevance.

Risks:

- claim drift
- latency
- inconsistent wording.

Recommended V1:

Use structured templates populated from validated Call Pack facts rather than unconstrained generative voicemail.

---

# 18. VOICEMAIL ANALYTICS

Track:

- voicemail count
- callbacks
- callback/voicemail rate
- decision-maker callback
- qualified conversation
- DNC after voicemail
- variant/hypothesis.

Do not optimize callback rate alone if callbacks are annoyed/wrong-target.

---

# 19. TEST FIXTURE — CURRENT GOOGLE AD

Fresh paid evidence.

Expected:

- ad-specific voicemail allowed
- no spend claim.

---

# 20. TEST FIXTURE — STALE AD

Expected:

- ad-specific current wording blocked
- generic safe workflow voicemail or no voicemail.

---

# 21. TEST FIXTURE — CALLBACK

Prospect returns call from same business number within configured recent window.

Expected:

- inbound callback route loads original voicemail context.

---

# 22. TEST FIXTURE — POLICY DENIED

Campaign/media/technology policy says no AI-generated voicemail.

Expected:

- no voicemail action even if AMD detects machine
- call outcome voicemail/no answer according policy.

---

# 23. ACCEPTANCE

- voicemail policy deterministic
- content short
- research fact current
- callback number inbound-capable
- generated wording constrained/validated
- callback attribution works
- no cross-channel side effects by assumption.
