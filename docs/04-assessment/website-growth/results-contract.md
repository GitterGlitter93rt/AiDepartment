# Website & Growth Assessment — Results Contract (V1)

Status: Architecture Draft — Pending Owner Approval
Defines the deterministic object a future frontend receives. The frontend must never need generative AI to decide what score or finding to display — every field below is produced entirely by deterministic logic defined in `scoring-matrix.md`, `findings-catalog.md`, and this document.

## 1. Top-Level Shape (Conceptual)

```
AssessmentResult {
  assessmentId: string          // opaque public ID, distinct from internal submissionId/jobId (data-model.md §2/§9)
  analyzedDomain: string        // AssessmentSubmission.normalizedUrl, host portion only
  analyzedAt: ISO8601 timestamp
  overallScore: integer | null  // null only in the total-failure state (§7)
  overallBand: string | null    // one of the 5 band labels, scoring-matrix.md §14
  categoryScores: CategoryScoreEntry[7]   // always 7 entries, even if a category is unavailable
  priorityOpportunities: RecommendationEntry[0..5]
  findings: FindingEntry[]                 // full findings section, findings-catalog.md §5
  positiveFindings: FindingEntry[]         // the 4 POS-* findings, only those triggered
  unverifiedItems: UnverifiedEntry[]       // §6
  analysisCoverage: AnalysisCoverage        // §5
  partialFailure: PartialFailureInfo | null // §7
  recommendedNextSteps: RecommendationEntry[] // may overlap with priorityOpportunities; see §8
  commercialDestinations: string[]          // deduplicated union of every destination across recommendedNextSteps
  evidenceProvenance: ProvenanceLabel        // per-finding, see §9
  confidence: ConfidenceLabel                // per-finding, see §9
}
```

## 2. CategoryScoreEntry

```
CategoryScoreEntry {
  category: enum (7 fixed values, always the same order — see §3 Ordering)
  score: integer 0-100 | null   // null when status = "unavailable"
  status: "scored" | "unavailable"
  weightUsed: decimal            // the renormalized weight actually applied (scoring-matrix.md §13)
  unavailableReason: string | null  // e.g., "Performance testing could not be completed during this assessment." Only present when status = "unavailable."
}
```

## 3. Stable Ordering Behavior

- `categoryScores` is always ordered: Search Visibility, Conversion, Lead Capture, Speed & Performance, Tracking & Attribution, Follow-Up Systems, AI & Automation Readiness — the fixed order from `scoring-architecture.md` §"Public Score Categories," regardless of score value. Never re-sorted by score.
- `findings` is ordered by category (same fixed order above), then by severity (High → Medium → Low) within category, then alphabetically by `findingId` as the final deterministic tie-break.
- `priorityOpportunities` and `recommendedNextSteps` are ordered by `priorityRank` ascending (1 = highest), using the exact algorithm and tie-breaking rules in `findings-catalog.md` §6.
- `positiveFindings` follows the same category-then-alphabetical ordering as `findings`.

## 4. Tie-Breaking Behavior

Fully specified in `findings-catalog.md` §6 (priority opportunities) and §3 above (findings list). No other list in this contract requires tie-breaking, since category order and finding-ID order are both fixed, non-ambiguous sort keys.

## 5. AnalysisCoverage

```
AnalysisCoverage {
  pagesRequested: integer        // target, e.g. 8
  pagesAnalyzed: integer         // actual
  isPartial: boolean             // true if pagesAnalyzed < pagesRequested
  performanceProviderStatus: "succeeded" | "unavailable" | "timeout" | "malformed_response"
}
```

Missing-data / partial-crawl behavior: if `isPartial = true`, the frontend must display a disclosure (exact wording owned by the frontend implementation, but the underlying fact — "this assessment is based on N of M pages" — must always be derivable from this object). No score is invalidated by partial coverage; rules simply compute against whatever evidence exists (`scoring-matrix.md` §16).

## 6. UnverifiedEntry

```
UnverifiedEntry {
  relatedCategory: enum
  description: string   // e.g., "Whether inbound phone calls are attributed to marketing source could not be verified."
  reason: "user_answered_not_sure" | "rule_excluded_conditionally" | "performance_provider_unavailable"
}
```

This is the mechanism by which the frontend can render a distinct "Could not verify" section, separate from both scored findings and the overall score — directly implementing the "Detected / Based on your answers / Could not verify" three-way distinction required by the sprint brief.

## 7. PartialFailureInfo (and Total-Failure State)

```
PartialFailureInfo {
  type: "homepage_unreachable" | "invalid_url" | "blocked_destination" | "analysis_timeout"
  userFacingMessage: string   // from the closed set in crawl-specification.md §18 / security-threat-model.md §1.36 — never raw exception text
}
```

- **Total failure** (homepage unreachable, per `crawl-specification.md` §18): `overallScore = null`, `overallBand = null`, all `categoryScores[i].status = "unavailable"`, `findings = []`, `priorityOpportunities = []`, and `partialFailure` is populated. The frontend must render a distinct "we could not analyze this website" state, never a zero score.
- **Partial success with some pages failing:** `partialFailure = null`, scoring proceeds normally per `AnalysisCoverage.isPartial`.

## 8. recommendedNextSteps vs. priorityOpportunities

- `priorityOpportunities` is exactly the top 3–5 findings selected by `findings-catalog.md` §6 — the "headline" opportunities.
- `recommendedNextSteps` is the same underlying `RecommendationEntry` objects (one per finding that has a `recommendedAction`), but is not capped at 5 — it is the complete actionable list, intended for a "full findings" section of the results page. `priorityOpportunities` is always a subset of `recommendedNextSteps`.
- This distinction exists so the frontend can render a short "top opportunities" summary and a longer "everything we found" section from one consistent data source, without the backend needing two separate selection passes.

## 9. Evidence Provenance and Confidence

```
ProvenanceLabel = "Detected" | "Based on your answers" | "Could not verify"
ConfidenceLabel = "Verified" | "User-Reported" | "Likely" | "Not Verified"
```

Every `FindingEntry` and `RecommendationEntry` carries both a `ProvenanceLabel` (frontend-facing, plain language) and a `ConfidenceLabel` (matches `findings-catalog.md` §2 exactly). Mapping: `Verified` and `Likely` evidence types render as "Detected"; `User-Reported` renders as "Based on your answers"; anything appearing in `unverifiedItems` renders as "Could not verify." This mapping is fixed and must not vary by category or finding — consistent language is part of the claim-guardrail requirement.

## 10. Missing-Data / User-Question-Not-Answered Behavior

- If a required question (Q1–Q6, Q8, Q9, Q10 — all except conditionally-skipped Q7) is left unanswered by the user (e.g., they abandon the flow partway and submit anyway, if the frontend ever allows that), every rule depending on that question is treated identically to "Not sure" for that specific question, per the per-question behavior defined in `question-specification.md` (some questions treat "Not sure" as Fail, others as excluded-Unknown — the same per-question rule applies to a truly-missing answer, since from the scoring engine's perspective an unanswered question and a "Not sure" answer carry the same evidentiary weight: the fact could not be established).
- The results-contract does not have a separate "unanswered" state distinct from "Not sure" for this reason — they are deliberately unified at the scoring layer, and the frontend requirement should instead be to *prevent* unanswered required questions from reaching submission in the first place (a UX decision, not a results-contract concern).

## 11. FindingEntry and RecommendationEntry (Shared Shape Reference)

```
FindingEntry {
  findingId: string
  category: enum
  severity: "High" | "Medium" | "Low"
  confidence: ConfidenceLabel
  provenance: ProvenanceLabel
  userFacingText: string
  whyItMatters: string | null   // present for a subset; not all findings-catalog.md entries define this separately from userFacingText
}

RecommendationEntry extends FindingEntry {
  recommendedAction: string
  commercialDestinations: string[]   // may be empty array
  priorityRank: integer | null
}
```

## 12. Non-Requirements (Explicitly Out of Scope for This Contract)

- No field in this contract is ever populated by a live LLM call at render time. Any future generative-AI polishing (per `recommendation-logic.md` §"Generative AI Use") operates as a pre-processing step that produces additional *display text* fields (not yet defined — deferred to a future sprint), never as a runtime dependency for the frontend to function. A frontend built against this exact contract must render a complete, correct result with zero AI availability, per the deterministic-fallback requirement in `recommendation-logic.md`.
