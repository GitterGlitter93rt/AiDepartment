# Your AI Department — Language Detection & Multilingual Routing Specification

**Status:** Architecture authority  
**Purpose:** Handle prospects who answer or communicate in another language without bluffing fluency, translating high-risk claims incorrectly, or breaking compliance/professional boundaries.  
**Implementation owner:** Claude Code

---

# 1. PRINCIPLE

Language support is a capability that must be tested and approved per language/channel.

The system must not assume:

> “The model can translate, therefore YAD can safely conduct every sales conversation in every language.”

Commercial truth, objections, professional boundaries, phone-number reading, DNC intent, and follow-up all require language-aware validation.

---

# 2. LANGUAGE STATE

Per conversation/contact:

- detected_language
- detection_confidence
- prospect_preferred_language
- agent_supported_languages
- approved_full_sales_languages
- approved_basic_routing_languages
- human_fallback_languages
- translation_required

---

# 3. LANGUAGE SUPPORT LEVELS

## FULL_APPROVED

System has:

- validated STT/TTS or text quality
- translated invariant sales policy
- DNC/priority intent tests
- commercial truth terminology
- objection/claim tests
- professional-boundary tests
- QA fixtures.

May run normal approved conversation mode.

## BASIC_ROUTING_ONLY

Agent may:

- identify YAD
- ask language preference
- capture name/basic callback intent
- offer human follow-up.

No complex sales claims.

## HUMAN_REQUIRED

End/route to qualified human.

## UNSUPPORTED

Politely explain limitation and arrange appropriate follow-up if possible.

---

# 4. DETECTION

Language detection should consider early utterances and may use STT/provider metadata.

If uncertain:

> ask preferred language.

Do not repeatedly switch languages mid-turn based on one borrowed word.

---

# 5. PROSPECT LANGUAGE PREFERENCE

If prospect asks:

> “Do you speak Spanish?”

System should accurately answer based on current supported mode.

Never claim human-level fluency if only basic routing is approved.

---

# 6. DNC / STOP INTENT

Before FULL_APPROVED production use, language must have tested phrases for:

- stop calling
- don't call again
- remove me
- wrong number
- call later
- call tomorrow
- not now.

Critical distinction between DNC and requested callback must work in that language.

If uncertain on a potential stop request, default conservative/human review according to policy.

---

# 7. COMMERCIAL TRUTH

Translated pricing/offer language must preserve:

- approximate
- starting at
- custom
- not guaranteed
- scope-dependent
- verify integration.

A translation that removes qualifiers is a claim violation.

---

# 8. PROFESSIONAL BOUNDARIES

Law/healthcare/safety boundaries apply equally across languages.

Do not let translation turn:

> “AI may collect basic intake information for attorney review”

into:

> “AI evaluates the case.”

Critical boundaries need language-specific tests.

---

# 9. PROPER NOUNS / SYSTEM NAMES

STT/TTS must handle:

- Your AI Department
- CRM names
- ServiceTitan
- Housecall Pro
- CCC
- Clio
- city/business names.

Do not translate product/company names incorrectly.

---

# 10. NUMBERS / DATES / MONEY

Language-specific verbalization must be tested for:

- phone numbers
- times
- dates
- currency
- percentages.

Readback/confirmation for critical scheduling details.

---

# 11. CODE-SWITCHING

Some callers switch languages.

For approved languages:

- maintain same relationship state
- don't duplicate transcript/context
- preserve structured extraction language/source.

If switch enters unsupported language:

- offer human follow-up rather than hallucinating.

---

# 12. HUMAN HANDOFF

Store preferred language on Contact/Account relationship.

Human transfer/booking should prefer:

- appropriate language-capable rep if configured
- otherwise communicate expectation honestly.

Do not promise bilingual human availability if not known.

---

# 13. WRITTEN FOLLOW-UP

Email/SMS language should match prospect preference when supported.

Translated content still checks:

- Promise Registry
- CommercialTruthSnapshot
- DNC/channel policy
- vertical boundaries.

Human review default during early language rollout.

---

# 14. QA

Evaluate per language:

- identity
- naturalness
- claim accuracy
- DNC
- objection meaning
- technical vocabulary
- numbers/dates
- professional boundary
- cultural politeness without stereotyping.

Do not assume English QA score transfers to translated agent.

---

# 15. LANGUAGE EXPANSION PROCESS

To add FULL_APPROVED language:

1. translated invariant policy reviewed
2. commercial terms reviewed
3. vertical glossary where needed
4. STT benchmark
5. TTS benchmark
6. DNC/priority fixtures
7. objection fixtures
8. professional-boundary fixtures
9. controlled participant calls
10. QA pass
11. approval/config enable.

---

# 16. ANALYTICS

Track:

- language preference
- routing outcome
- STT confidence/error
- conversation QA
- transfer/follow-up availability.

Do not use language/ethnicity proxies as a sales propensity feature.

---

# 17. ACCEPTANCE TESTS

1. Unsupported language -> honest human-fallback path.
2. Supported Spanish DNC phrase -> immediate suppression.
3. Spanish “call me tomorrow” -> callback, not DNC.
4. Approximate $5,000+ strategy price -> qualifier preserved.
5. Specific integration question -> “needs verification” preserved in translation.
6. Law legal-advice boundary preserved.
7. Date/time readback correct.
8. Prospect switches English/Spanish -> one relationship/context.
9. TTS mispronounces critical company/system names badly -> fails certification.
10. No language/ethnicity used for propensity ranking.

---

# 18. CORE RULE

Multilingual sales is not a translation checkbox. A language becomes production-capable only when YAD can preserve truth, intent, safety, and next-step accuracy in that language.
