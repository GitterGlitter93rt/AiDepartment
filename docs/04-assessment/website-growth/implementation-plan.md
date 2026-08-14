# Website & Growth Assessment — Implementation Plan (V1)

Status: Architecture Draft — Pending Owner Approval
This plan keeps the production frontend blocked until every architecture decision in this directory is explicitly approved by the owner. No phase below begins before the owner confirms the preceding phase's stop conditions are satisfied.

## Phase A — Backend Foundation & URL Security

- **Objective:** Stand up the chosen backend platform and implement the full URL-validation/SSRF pipeline from `security-threat-model.md` §2–3, in isolation, before any real website is ever fetched.
- **Prerequisites:** `backend-options.md` recommendation approved; the DNS-rebinding-pinning technical spike (backend-options.md §3) resolved with a confirmed implementation approach.
- **Likely files/components:** URL parser/validator module, IP-range blocklist table, DNS-resolve-then-pin fetch wrapper, secrets configuration.
- **Tests required:** Full URL/security test suite from §"Testing Standard" below (every blocked-range address, malformed URLs, credential-embedded URLs, scheme rejection, port rejection) — must pass before Phase B begins.
- **Security considerations:** This entire phase *is* the security layer. No shortcuts.
- **Stop conditions:** Do not proceed to Phase B until 100% of URL/security tests pass and a second reviewer (not the original implementer) has reviewed the validation pipeline.
- **Owner approvals required:** Backend provider final confirmation; sign-off that the security test suite is complete and passing.

## Phase B — Controlled Scanner

- **Objective:** Implement the bounded crawl from `crawl-specification.md` on top of the Phase A validation layer.
- **Prerequisites:** Phase A complete and approved.
- **Likely files/components:** Page-fetch orchestrator (respecting concurrency/timeout/redirect limits), HTML extractor (title/meta/headings/links/forms/etc. per `crawl-specification.md`), robots.txt/sitemap handler, page-prioritization logic.
- **Tests required:** Crawler test suite from §"Testing Standard" (page limits, depth limits, duplicate/query-string/canonical handling, non-HTML rejection, oversized-response abort, timeout handling, malformed HTML, partial-crawl failure).
- **Security considerations:** Every fetch in this phase must route through the Phase A validator — no new fetch path may bypass it. HTML parsing must use the hardened parser from `security-threat-model.md` §1.18; sitemap XML parsing must have entity-expansion protections per §1.22.
- **Stop conditions:** No page is ever fetched without passing Phase A validation, verified by code review, not just test coverage.
- **Owner approvals required:** Confirmation that the 8-page/depth-2 crawl scope (`crawl-specification.md` §8–9) still matches expectations after seeing it run against real test sites.

## Phase C — Scoring Engine + Tests

- **Objective:** Implement the 48 deterministic rules from `scoring-matrix.md` as pure functions over `WebsiteAnalysis` + `UserAnswer` data (per `data-model.md`), with no dependency on live network calls.
- **Prerequisites:** Phase B complete (to produce real `WebsiteAnalysis` fixtures for testing), `question-specification.md` question set approved.
- **Likely files/components:** One scoring-rule module per category, a category-aggregation function, an overall-score function, all implementing the exact formulas in `scoring-matrix.md` §12–13.
- **Tests required:** Full deterministic-scoring test suite from §"Testing Standard" (same input → same output, every rule boundary, partial credit, unknown handling, denominator handling, category/overall normalization, score bands).
- **Security considerations:** None directly (this phase operates on already-validated, already-fetched data) — but must not accept or execute any free-text input as part of scoring, per `supplemental-questions.md` §"Scoring."
- **Stop conditions:** 100% of scoring tests pass, including a specific test asserting that running the same fixture twice produces byte-identical output.
- **Owner approvals required:** Final sign-off on category weights and score-band labels if any changed during implementation from the values proposed in `scoring-matrix.md` §2/§14.

## Phase D — Supplemental Questionnaire

- **Objective:** Build the Q1–Q10 flow from `question-specification.md`, including the single Q6/Q7 branch.
- **Prerequisites:** Phase C complete (so answers can be wired directly into real scoring rules for testing).
- **Likely files/components:** Question data/config (mirroring the pattern already used for the existing AI Department Assessment's `src/data/assessment/questions.ts`, per repository precedent — reuse that architectural pattern, not necessarily that file), branching logic, answer-to-rule mapping.
- **Tests required:** Question test suite from §"Testing Standard" (branching, "Not sure" handling per-question, skipped-answer handling, deterministic answer-to-score mapping).
- **Security considerations:** Multi-select (Q9) and free-text (none in V1 — confirmed no free-text scoring inputs exist) must not allow injection into any downstream display without escaping, consistent with how the existing AI Department Assessment already handles Q41/Q42 free text (`docs/04-assessment/implementation-spec.md` precedent).
- **Stop conditions:** Typical-path and shortened-path (Q6="No") flows both produce correct, tested rule inputs.
- **Owner approvals required:** Final question wording sign-off if any changed from `question-specification.md`.

## Phase E — Findings / Results Engine

- **Objective:** Implement `findings-catalog.md`'s 45 findings, the priority-opportunity selection algorithm (§6), and assemble the full `AssessmentResult` object per `results-contract.md`.
- **Prerequisites:** Phases B, C, D complete.
- **Likely files/components:** Finding-trigger evaluator (maps scored rule outcomes to finding IDs), priority-ranking function (pure arithmetic per `findings-catalog.md` §6), result-object assembler matching `results-contract.md` §1 exactly.
- **Tests required:** Recommendation test suite (correct finding trigger per rule outcome, correct service mapping, deterministic priority ordering including tie-breaking, stable ordering per `results-contract.md` §3).
- **Security considerations:** Result assembly must never include raw fetched HTML or raw provider API responses in the object returned to the frontend (`security-threat-model.md` §1.30 open-proxy concern extends conceptually here — the result object itself must not become a vector for reflecting untrusted content).
- **Stop conditions:** A fixture representing every one of the 45 findings individually triggers correctly in isolation, plus at least one combined fixture exercising the tie-breaking rules.
- **Owner approvals required:** None beyond what Phases C/D already required, unless finding wording changes materially from `findings-catalog.md`.

## Phase F — Frontend Assessment Experience

- **Objective:** Build the actual user-facing intake form, progress state, and results page consuming the `results-contract.md` object — the first phase that touches `src/pages/` or any production-visible surface.
- **Prerequisites:** Phases A–E complete and individually approved. This is the gate referenced throughout this plan: **no frontend work begins before this line**, regardless of how far backend work has progressed.
- **Likely files/components:** New route (exact slug TBD per `page-seo-standard.md` review — `website-growth-assessment.md` §"SEO Opportunity" suggests `/website-assessment/` as a starting point, not yet finalized), intake form component, results-page component, loading/progress state, error states matching the closed set in `results-contract.md` §7.
- **Tests required:** Frontend behavioral tests (progress state transitions, error-state rendering for each `PartialFailureInfo.type`, results rendering matches contract exactly, mobile responsive behavior at the standard breakpoint matrix used throughout this repository's prior sprints).
- **Security considerations:** Frontend must never call the analysis backend with anything other than the user-submitted URL and questionnaire answers — no client-side construction of internal API calls that could be manipulated to bypass Phase A validation (defense in depth; validation is authoritative server-side regardless, but the frontend should not create a false sense that client-side checks are sufficient).
- **Stop conditions:** Full manual QA pass across the responsive matrix; confirmation that the existing AI Department Assessment (`/ai-assessment/`) is completely unaffected (explicit regression check, not an assumption).
- **Owner approvals required:** Final route/slug, SEO title/meta/H1 (per `page-seo-standard.md`), visual design review against the existing production design system.

## Phase G — Lead Capture / Email / CRM Integration

- **Objective:** Connect submitted contact information to actual business follow-up (email notification, CRM record creation, or both).
- **Prerequisites:** Phase F live and stable.
- **Likely files/components:** Notification/webhook integration, following the same "clearly isolated submission adapter" pattern already used for the existing AI Department Assessment's contact form (`src/lib/assessment/submissionAdapter.ts` precedent) and the main site Contact page — reuse that architectural pattern.
- **Tests required:** Integration tests confirming submission data reaches the intended destination; failure-mode tests (what happens if the CRM/email service is down — must not lose the submission or show a false "delivered" state, matching the existing site's "do not pretend submissions are being delivered if they are not" principle).
- **Security considerations:** Any new third-party processor introduced here requires a Privacy Policy update per `legal-pages.md` §"Privacy Policy" and `data-model.md` §10.
- **Stop conditions:** Confirmed end-to-end delivery in a staging environment before production cutover.
- **Owner approvals required:** Choice of CRM/email provider; Privacy Policy update sign-off.

## Phase H — Security / Abuse / Reliability QA

- **Objective:** Full-system adversarial testing before public launch.
- **Prerequisites:** Phases A–G complete.
- **Likely files/components:** No new product code expected; this phase is testing/hardening of existing code.
- **Tests required:** Complete re-run of every test category in §"Testing Standard," plus live (non-mocked, against real test infrastructure the team controls) verification of at least: one real SSRF attempt against a controlled private-IP target, one real rate-limit-exceeding burst, one real oversized-response test against a controlled endpoint.
- **Security considerations:** This phase exists specifically because unit/mock tests, however thorough, are not a substitute for at least one live-fire verification of the SSRF and abuse protections against real infrastructure the team controls.
- **Stop conditions:** No known unresolved High-severity finding from this phase's testing.
- **Owner approvals required:** Explicit go/no-go sign-off before Phase I.

## Phase I — Launch

- **Objective:** Public availability.
- **Prerequisites:** Phase H sign-off.
- **Likely files/components:** Navigation/footer link additions (if approved), sitemap entry, robots.txt review.
- **Tests required:** Final production smoke test (submit a real assessment against a real, owned test site end-to-end in production).
- **Security considerations:** Confirm rate limits and monitoring are active *before* any public link to the page is published anywhere, not after.
- **Stop conditions:** None beyond the smoke test — this is the terminal phase.
- **Owner approvals required:** Final launch go-ahead.

## Testing Standard for Future Implementation

### Deterministic Scoring Tests
- Same input always returns same score (byte-identical result object for byte-identical input).
- Every rule boundary in `scoring-matrix.md` (e.g., SV-02's 10/70-character thresholds, SP tier boundaries).
- Partial-credit paths for every rule that defines one.
- Unknown/excluded-from-denominator handling for every conditional rule (TA-03, TA-04, TA-05, TA-06, TA-07, LC-05, LC-07, SV-04).
- Category-score normalization (§`scoring-matrix.md` §12) with 0, 1, and all-rules-included denominators.
- Overall-score normalization with 0, 1, and all-7 categories unavailable.
- Every score band boundary (39/40, 59/60, 74/75, 89/90).

### URL/Security Tests
- Localhost, 127.0.0.1, private IPv4 (all 5 ranges in `security-threat-model.md` §1.5), IPv6 loopback, IPv6 unique-local, link-local (both stacks), cloud-metadata addresses (§1.11's explicit list), malformed URLs, credentials-in-URL, invalid schemes, redirects into every blocked category, multi-hop redirects mixing valid and invalid hops, DNS-rebinding simulation, arbitrary non-standard ports.

### Crawler Tests
- Page-count limit enforcement (exactly 8, not 9). Depth-limit enforcement (depth-2 candidates only pulled when budget remains). Duplicate URL / query-string / trailing-slash / canonical-tag handling per `crawl-specification.md` §13–16. Sitemap/robots behavior including the billion-laughs/XXE payloads from `security-threat-model.md` §1.22. Non-HTML content-type rejection. Oversized-response and decompression-bomb abort. Timeout handling at all three timeout tiers (connect/read/total). Malformed HTML parsing (no crash). Broken-link handling (404s recorded as fetch failures, not crashes). Partial-crawl scoring behavior.

### Performance Tests
- Provider success path. Provider timeout. Provider unavailable (non-2xx / connection refused). Malformed provider response (unexpected JSON shape). Explicit assertion: no score penalty is ever applied when the provider cannot run, across all of the above failure modes — this is the single most important performance-related test given the "must not automatically become a negative website score" requirement.

### Question Tests
- Q6→Q7 branching (both directions). Every per-question "Not sure" behavior matches `question-specification.md` exactly (some Fail, some excluded). Skipped/missing-answer handling matches "Not sure" handling per §10 of `results-contract.md`. Deterministic answer-to-rule-points mapping for every option of every question.

### Recommendation Tests
- Correct finding triggered for every one of the 45 finding conditions, tested individually. Correct service/commercial-destination mapping per finding. Deterministic priority-opportunity ordering, including a fixture specifically constructed to exercise all three tie-break levels in `findings-catalog.md` §6.

### AI Isolation Tests
- If/when generative wording assistance is introduced (`recommendation-logic.md` §"Generative AI Use"), a dedicated test must assert: generative output cannot alter `overallScore`, `categoryScores`, `findingId`, `severity`, `confidence`, or `priorityRank` — only display-text fields not yet defined in this V1 contract. A second test asserts the full result renders correctly with the AI layer entirely disabled/unavailable (deterministic fallback).

### Regression Tests
- The existing AI Department Assessment (`/ai-assessment/`) remains completely unmodified — no shared code path between the two assessments beyond, at most, shared visual/interior components already used site-wide (`InteriorHero`, `CTABand`, etc., if the frontend phase reuses them for visual consistency).
- The existing 29/29 assessment test suite (`tests/assessment.test.ts`) continues to pass unchanged, run as part of CI for every change in this feature area, for the entire duration of Phases A–I, since this new feature must never be the cause of a regression in the unrelated, already-shipped assessment.
