# AI Assessments — Short and Long Architecture

**Status:** Architecture reconciliation required  
**Last reviewed:** 2026-08-30

## Approved operating direction

Your AI Department now needs two assessment experiences:

| Experience | Approved concept | Still unresolved |
|---|---|---|
| Short assessment | Lower-friction entry for ads/funnels and fast initial value/qualification | Name, route, exact questions, time, scoring, lead gate, result, and next CTA |
| Long assessment | Deeper diagnostic covering the business and generating richer deterministic scores/recommendations | Name, route, invitation/handoff, lead gate, report depth, persistence, and whether the current assessment_v1 is designated as this experience |

This is a conceptual decision, not authorization to invent either experience's missing logic.

## Current repository reality

As of inspected main commit 648da9d8b9aa62c1a9bfc38a533bac8452e0ab0f:

- One public route exists at /ai-assessment/.
- One results route exists at /ai-assessment/results/.
- src/components/assessment/assessmentApp.ts runs one configuration-driven assessment app.
- src/data/assessment/questions.ts implements up to 64 questions with conditional sections.
- Deterministic public scoring, commercial scoring, flags, recommendations, ROI prerequisites, persistence, and a submission adapter exist.
- tests/assessment.test.ts covers core scoring/recommendation paths; the Aug. 14 resource commit reported 29/29 tests passing.
- The current repository contains no short assessment or long assessment naming or routing.

## Specification discrepancy to resolve

docs/04-assessment/overview.md describes the public assessment as approximately 35–45 questions and 7–10 minutes. docs/04-assessment/implementation-spec.md defines up to 64 conditional questions, and the code implements that deeper system.

The short/long split can resolve this cleanly, but only after Michael approves which specification belongs to which experience and what the handoff is. Do not silently delete deep questions or copy the long score into a short quiz.

## Required architecture decisions

For each experience, approve:

1. Canonical public name and promise
2. Audience and traffic source
3. Route and URL ownership
4. Target completion time and question count
5. Required versus optional questions
6. Branching and resume behavior
7. Whether it creates a score, classification, preview, or recommendation
8. Contact-capture timing and consent
9. User-visible result and internal lead fields
10. Handoff to the other assessment, a strategy call, contact, nurture, or enterprise route
11. Persistence, backend, CRM, email, and report delivery
12. Version identifier and migration/compatibility behavior
13. Analytics events and completion definition

## Constraints that remain in force

- Deterministic rules—not an LLM—control scores, flags, recommendation eligibility, and financial prerequisites.
- AI may explain established results but may not invent facts, flags, ROI, or services.
- Contact information does not alter the public score.
- Raw answers, private commercial scores, contact details, and sensitive/free-text inputs do not belong in GA4 or Meta parameters.
- Result pages must not expose private company/contact data through guessable, indexable URLs.
- Free text is untrusted data and must not be allowed to modify model/system instructions.
- Enterprise candidates require an enterprise conversation; they should not be forced into an SMB sales script.
- Assessment versions must be retained with stored results.

## Provisional funnel patterns — choose; do not implement yet

Examples to evaluate after the content is defined:

- Ad → short assessment → immediate preview → contact/booking → optional long assessment
- Ad → short assessment → qualified handoff → long assessment → detailed results → strategy call
- Organic/service page → long assessment directly; paid cold traffic → short assessment

These are alternatives, not a decision. The approved route must be recorded in brain/DECISIONS.md and the canonical docs.

## Event definitions to finalize

- short_assessment_start
- short_assessment_complete
- long_assessment_start
- long_assessment_complete
- assessment_handoff_click
- lead_submit
- strategy_call_click
- booked_call

Define each by a verified state change, not merely a page view. See brain/WEBSITE.md.

## Canonical references

- docs/00-company/launch-decisions.md
- docs/02-website/ai-assessment.md
- docs/04-assessment/overview.md
- docs/04-assessment/questions.md
- docs/04-assessment/scoring.md
- docs/04-assessment/recommendations.md
- docs/04-assessment/report-template.md
- docs/04-assessment/roi-calculator.md
- docs/04-assessment/consent-and-data.md
- docs/04-assessment/implementation-spec.md
