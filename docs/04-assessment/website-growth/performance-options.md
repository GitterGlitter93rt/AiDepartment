# Website & Growth Assessment — Performance Provider Options (V1)

Status: Architecture Draft — Pending Owner Approval

## 1. Candidates Compared

1. **PageSpeed Insights API** (Google's hosted Lighthouse-as-a-service)
2. **Controlled Lighthouse execution** (self-hosted, e.g., running `lighthouse` in a headless-Chrome container as part of the analysis job)

## 2. Evaluation Table

| Criterion | PageSpeed Insights API | Controlled Lighthouse Execution |
|---|---|---|
| Reliability | Generally reliable, but subject to Google's own API uptime and occasional slow responses; no infrastructure to maintain on our side. | Reliability depends entirely on our own infrastructure staying healthy — headless Chrome is a known source of operational flakiness (memory leaks, crashed renderer processes) if not carefully managed. |
| Complexity | Low — a single authenticated HTTP request, parse JSON response. | High — requires running and maintaining a headless-Chrome environment, which is exactly the kind of "isolated hardened browser service" that `security-threat-model.md` §1.19 flags as a separate, more complex security surface if ever introduced. |
| Reproducibility | Uses Google's real-world CrUX field data when available, blended with lab data — results can vary run-to-run due to real network conditions, similar to how an actual visitor would experience the site, but this means two consecutive assessments of the same site are not guaranteed to be numerically identical. | Running Lighthouse in a controlled, consistent environment (fixed CPU/network throttling profile) produces more consistent lab-only results, closer to true determinism — but only lab data, no real-world field-data signal. |
| Mobile testing | Native, first-class support — request `strategy=mobile`. | Native, first-class support via Lighthouse's built-in mobile emulation profile. |
| Desktop testing | Native, `strategy=desktop`. | Native, via Lighthouse's desktop configuration. |
| Latency | Typically several seconds per request (Google's backend does real analysis work) — must fit within the 60s total-analysis budget (`crawl-specification.md` §17) alongside the crawl itself. | Comparable latency for the Lighthouse run itself, plus the added latency/complexity of spinning up (or maintaining warm) a headless-Chrome instance. |
| Rate/API limits | Free tier has a daily quota (historically in the range of tens of thousands of requests/day, subject to change) — needs a Google Cloud API key; quota should comfortably exceed realistic V1 assessment volume, but this must be monitored, not assumed. | No external quota — limited only by our own infrastructure's capacity, which is directly tied to cost (§Cost below). |
| Cost | Free at V1-realistic volume (within Google's free quota); paid tiers exist if volume grows significantly. | Requires paying for compute (a container/VM capable of running headless Chrome reliably) continuously or on-demand — real infrastructure cost even at low volume, since headless Chrome is resource-heavy per invocation. |
| Operational burden | Minimal — no infrastructure of our own dedicated to this. | Significant — headless-Chrome infrastructure needs monitoring, occasional restarts, dependency updates (Chrome version drift), and is the type of component most likely to be a recurring maintenance burden. |
| Infrastructure needs | None beyond an API key and outbound HTTPS access from the backend. | A container or serverless-with-Chrome-layer setup (e.g., a dedicated Lambda with a Chrome layer, or a small persistent service) — meaningfully more infrastructure than the rest of this feature requires otherwise. |
| Failure behavior | Well-defined HTTP error responses (rate limit, timeout, invalid URL) — easy to map to the "performance analysis could not be completed" result state (`crawl-specification.md` §18, `results-contract.md`). | Failure modes are more varied and less cleanly categorized (browser crash, out-of-memory, hung render) — harder to map cleanly to a small set of defined error states without significant defensive engineering. |
| Secret/API-key handling | One Google Cloud API key, stored as a backend secret (never client-side, per `scanner-security-architecture.md` §"Performance Testing") — simple to manage. | No comparable third-party secret, but the infrastructure itself becomes a thing to secure and patch (e.g., ensuring the headless-Chrome environment cannot be abused as an SSRF/execution vector in its own right — effectively reintroducing a version of the exact risk `security-threat-model.md` §1.19 says V1 should avoid). |
| Susceptibility to external variance | Higher — real-world CrUX field data blending means results reflect actual internet conditions, which is arguably *more* honest but less numerically stable for a "same input, same score" deterministic-scoring goal. | Lower — a controlled environment with fixed throttling profiles produces more stable, reproducible numbers, better aligned with the "deterministic and reproducible" scoring principle in `scoring-architecture.md`. |
| Deterministic score mapping | The score-banding logic in `scoring-matrix.md` SP-01–SP-05 maps cleanly onto PageSpeed Insights' existing 0–100 Lighthouse performance score and Core Web Vitals metrics (LCP, CLS) — no extra mapping work needed, since PSI *is* Lighthouse under the hood. | Also maps cleanly, since this is literally running Lighthouse — the underlying metric set is identical either way; the difference is entirely in *how* Lighthouse is invoked (Google's hosted service vs. our own), not in what it measures. |
| Suitability for public assessments | Well-suited — this is exactly the kind of use case (occasional, public, one-off analysis) PageSpeed Insights is designed for. | Better suited to high-volume, tightly-controlled internal testing (e.g., a company monitoring its own site continuously) than to bursty, public, arbitrary-URL analysis. |
| Scalability | Scales via Google's infrastructure, not ours — effectively unlimited relative to V1 needs, bounded only by API quota. | Scaling requires scaling our own headless-Chrome infrastructure, which is the more expensive and operationally heavier path to scale. |

## 3. Recommendation

**RECOMMENDED — PENDING OWNER APPROVAL: PageSpeed Insights API.**

Rationale: for a V1 feature whose primary design goals are low operational complexity, bounded security surface (explicitly avoiding self-hosted headless-Chrome execution per `security-threat-model.md` §1.19), and reasonable cost at low-to-moderate volume, PageSpeed Insights is the clearly better fit. Controlled Lighthouse execution would only become the better choice at a scale or reproducibility requirement well beyond V1's actual needs, and would reintroduce exactly the kind of browser-execution security surface the rest of this architecture deliberately avoids.

## 4. Performance-Provider Failure Behavior

Per `recommendation-logic.md` §"Technical Failure" and `scoring-architecture.md` §"Missing Evidence": if PageSpeed Insights is unavailable, times out, or returns a malformed response for a given assessment, **the entire Speed & Performance category (SP-01 through SP-05) is excluded from the overall-score denominator** (`scoring-matrix.md` §12–13), not scored as a failure. The result page must display "Performance testing could not be completed during this assessment" (verbatim guardrail language from `website-growth-assessment.md` §"Recommendations") rather than any score or finding for this category. This is a hard requirement, not an implementation suggestion — performance-provider failure must never automatically become a negative website score.

## 5. Approval Required

Provider selection above must be confirmed by the owner before `implementation-plan.md` Phase A/C begins. If usage volume or reproducibility needs change materially post-launch, this decision should be revisited rather than assumed permanent.
