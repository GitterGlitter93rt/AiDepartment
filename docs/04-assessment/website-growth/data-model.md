# Website & Growth Assessment — Data Model (V1)

Status: Architecture Draft — Pending Owner Approval
Conceptual models only. No production secrets, no implementation-specific database schema — field-level design intended to guide (not dictate) the eventual implementation.

## 1. Evidence Categories Used Throughout

- **Raw user input** — exactly what the user typed/selected, unmodified.
- **Normalized URL** — derived from raw input per `crawl-specification.md` §2.
- **Observed technical evidence** — derived from the crawler/analyzer.
- **User-reported evidence** — derived from questionnaire answers.
- **Derived deterministic values** — computed from the above via `scoring-matrix.md` rules (scores, findings).
- **Recommendation output** — derived from findings via `findings-catalog.md`/`recommendation-logic.md`.
- **Operational metadata** — timestamps, job state, retry counts, etc. — never shown publicly.

## 2. AssessmentSubmission

| Field | Type | Req? | Description | Source | Privacy | Retention | Public on Result Page? |
|---|---|---|---|---|---|---|---|
| submissionId | UUID | Required | Unique ID for this submission. | Generated | Operational | Same as parent record | No (internal reference only; a separate opaque `assessmentId` is used publicly — see `results-contract.md`) |
| rawUrl | string | Required | Exactly what the user typed. | Raw user input | Low-sensitivity business data | Per Privacy Policy retention window | No |
| normalizedUrl | string | Required | After `crawl-specification.md` §2 normalization. | Normalized URL | Low-sensitivity | Same | Yes (as "analyzed domain," see `results-contract.md`) |
| companyName | string | Optional | Self-reported company name. | Raw user input | Low-sensitivity business data | Per Privacy Policy | No |
| contactName | string | Required | For follow-up. | Raw user input | **Personal data** | Per Privacy Policy; flag for disclosure (§5) | No |
| businessEmail | string | Required | For results delivery/follow-up. | Raw user input | **Personal data** | Per Privacy Policy; flag for disclosure (§5) | No |
| phone | string | Optional | For follow-up. | Raw user input | **Personal data** | Per Privacy Policy; flag for disclosure (§5) | No |
| industry | enum/string | Optional | Self-reported, from the 9 existing `/industries/` values or "Other." | Raw user input | Low-sensitivity | Per Privacy Policy | No (used only to select which industry page, if any, appears in recommendations) |
| submittedAt | timestamp | Required | Submission time. | Operational | Operational | Per Privacy Policy | No |
| sourceIp | string (hashed or truncated — implementation decision) | Required | For rate limiting/abuse prevention only. | Operational | **Personal data (IP address)** — flag for disclosure (§5) | Short (rate-limiting window only, e.g., 24–48h) — do not retain long-term | No |
| consentAcknowledged | boolean | Required | Confirms consent language was shown and accepted before submission. | Operational (UI-enforced) | Operational | Per Privacy Policy | No |

## 3. WebsiteAnalysis

| Field | Type | Req? | Description | Source | Privacy | Retention | Public? |
|---|---|---|---|---|---|---|---|
| analysisId | UUID | Required | Links to one `AssessmentSubmission`. | Generated | Operational | Same as parent | No |
| pagesRequested | integer | Required | Target page count (8 per `crawl-specification.md` §8, unless config changes). | Operational | Operational | Same | No (informs `analysisCoverage`, see `results-contract.md`) |
| pagesAnalyzed | integer | Required | Actual count successfully analyzed. | Observed | Operational | Same | Yes (as part of `analysisCoverage`) |
| homepageFetchSucceeded | boolean | Required | Per `crawl-specification.md` §18. | Observed | Operational | Same | Indirectly (drives partial-failure state) |
| pageRecords | array of PageRecord (see §3a) | Required | Per-page extracted evidence. | Observed | Business data (not personal) | Same | No (only derived findings are shown, not raw page records) |
| performanceProviderStatus | enum: `succeeded` / `unavailable` / `timeout` / `malformed_response` | Required | Per `performance-options.md` §4. | Observed | Operational | Same | Indirectly (drives SP category exclusion messaging) |
| performanceMobileScore, performanceDesktopScore, lcpMobile, cls | numbers, nullable | Optional | Raw provider metrics when available. | Observed | Business data | Same | No (only derived SP rule outcomes shown, not raw metrics — keeps result-page language consistent with `recommendation-logic.md` guardrails) |
| startedAt, completedAt | timestamps | Required | Job timing. | Operational | Operational | Same | No |

### 3a. PageRecord (sub-object, not a top-level entity)

| Field | Type | Description |
|---|---|---|
| url | string | The specific page fetched. |
| httpStatus | integer | Response status. |
| title, metaDescription, h1Count, canonicalPresent, structuredDataPresent | mixed | Per-page SV evidence. |
| ctaDetected, contactFormDetected, formFieldCount, phoneTelLinkDetected, emailMailtoLinkDetected, bookingLinkDetected, viewportConfigured, chatWidgetDetected, analyticsTagDetected, tagManagerDetected, googleAdsTagDetected, metaPixelDetected, callTrackingIndicatorDetected | booleans/counts | Per-page CV/LC/TA/AI evidence, feeding the rules in `scoring-matrix.md`. |

## 4. ObservedFinding

| Field | Type | Req? | Description | Source | Privacy | Retention | Public? |
|---|---|---|---|---|---|---|---|
| findingId | string | Required | One of the 45 IDs from `findings-catalog.md`. | Derived deterministic value | Operational | Same as parent | Yes |
| ruleId | string | Required | The `scoring-matrix.md` rule that triggered it. | Derived | Operational | Same | Yes (as provenance detail) |
| evidenceState | enum: `pass` / `partial` / `fail` / `excluded_unknown` | Required | Outcome for this rule on this assessment. | Derived | Operational | Same | Indirectly (determines whether the finding is shown at all — `excluded_unknown` findings are never shown as findings, only reflected in `unverifiedItems`, see `results-contract.md`) |
| confidence | enum (§`findings-catalog.md` §2) | Required | | Derived | Operational | Same | Yes |
| severity | enum: High/Medium/Low | Required | | Fixed per finding ID | Operational | Same | Yes |
| isPriorityOpportunity | boolean | Required | Result of `findings-catalog.md` §6 selection. | Derived | Operational | Same | Yes |

## 5. UserAnswer

| Field | Type | Req? | Description | Source | Privacy | Retention | Public? |
|---|---|---|---|---|---|---|---|
| questionId | string (Q1–Q10) | Required | From `question-specification.md`. | Operational | Operational | Same as parent | No (shown only via the derived findings/provenance, not as raw Q&A on the result page, to keep the result page focused on business meaning rather than a survey readout) |
| selectedOption(s) | string or array | Required | Raw selection. | Raw user input | Business data (not personal) | Per Privacy Policy | No |
| answeredAt | timestamp | Required | | Operational | Operational | Same | No |

## 6. CategoryScore

| Field | Type | Req? | Description | Source | Privacy | Retention | Public? |
|---|---|---|---|---|---|---|---|
| category | enum (7 categories) | Required | | Fixed | Operational | Same as parent | Yes |
| score | integer 0–100, nullable | Required | Null when category is `unavailable` (`scoring-matrix.md` §12). | Derived | Operational | Same | Yes |
| status | enum: `scored` / `unavailable` | Required | | Derived | Operational | Same | Yes |
| rulesIncluded, rulesExcluded | arrays of rule IDs | Required | Full transparency on what fed the score. | Derived | Operational | Same | No (available for internal debugging/support; result page shows the aggregate score and findings, not this level of raw detail, per §7 provenance design) |

## 7. OverallScore

| Field | Type | Req? | Description | Source | Privacy | Retention | Public? |
|---|---|---|---|---|---|---|---|
| score | integer 0–100 | Required | Per `scoring-matrix.md` §13. | Derived | Operational | Same as parent | Yes |
| band | enum (5 bands, `scoring-matrix.md` §14) | Required | | Derived | Operational | Same | Yes |
| categoryWeightsUsed | map of category → weight | Required | Reflects any category exclusion (§13 renormalization). | Derived | Operational | Same | Yes (transparency — lets the result page explain "Speed & Performance was not included in your overall score because performance testing could not be completed") |

## 8. Recommendation

| Field | Type | Req? | Description | Source | Privacy | Retention | Public? |
|---|---|---|---|---|---|---|---|
| findingId | string | Required | Links to `ObservedFinding`. | Derived | Operational | Same as parent | Yes |
| recommendedAction | string | Required | From `findings-catalog.md`. | Fixed per finding | Operational | Same | Yes |
| commercialDestinations | array of paths | Optional | May be empty — not every recommendation maps to a service (`recommendation-logic.md` §"Service Mapping"). | Fixed per finding | Operational | Same | Yes |
| priorityRank | integer, nullable | Optional | Position 1–5 if selected as a priority opportunity, else null. | Derived (`findings-catalog.md` §6) | Operational | Same | Yes |

## 9. AnalysisJob

| Field | Type | Req? | Description | Source | Privacy | Retention | Public? |
|---|---|---|---|---|---|---|---|
| jobId | UUID | Required | Operational job tracking, separate from the public-facing `assessmentId`. | Generated | Operational | Short — operational only, not part of the long-term assessment record | No |
| status | enum: `queued` / `crawling` / `scoring` / `complete` / `failed` | Required | | Operational | Operational | Same | Indirectly (drives frontend polling/loading state) |
| retryCount | integer | Required | Per `crawl-specification.md` §17 retry policy. | Operational | Operational | Same | No |
| errorCode | enum (closed set per `crawl-specification.md` §18 / `results-contract.md`) | Optional | Never raw exception text (`security-threat-model.md` §1.36). | Operational | Operational | Same | Yes, as the user-facing error state only (not the internal error code/message) |

## 10. Fields Requiring Privacy-Policy Disclosure

Per `legal-pages.md` §"Assessment Data": the Privacy Policy must be updated to disclose, at minimum:

- `contactName`, `businessEmail`, `phone` (AssessmentSubmission) — personal data collected and its purpose (results delivery, business follow-up).
- `sourceIp` (AssessmentSubmission) — collected for abuse prevention, short retention window, not used for marketing.
- That assessment answers (`UserAnswer`) are connected to identifiable contact information and are **not** anonymous, per `legal-pages.md` §"Assessment Data" ("Do not describe assessment answers as anonymous if they are connected to identifiable contact information").
- Use of a third-party performance-testing provider (`WebsiteAnalysis.performanceProviderStatus` and related fields) as a data processor, per `legal-pages.md` §"Privacy Policy" ("Do not claim that data is never shared with service providers if processors are used").

## 11. Data Minimization Note

Per `scanner-security-architecture.md` §"Data Storage": no field above is retained "because it can be." Every field's Retention column should map to an explicit, stated business purpose (results delivery, follow-up, abuse prevention, or the assessment record itself) — fields with no clear purpose (e.g., raw per-page HTML, full provider API responses beyond the specific metrics used) are intentionally excluded from this model and must not be added during implementation without a stated reason.
