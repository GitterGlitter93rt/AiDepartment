# Website & Growth Assessment — Scoring Matrix (V1)

Status: Architecture Draft — Pending Owner Approval
Supersedes nothing. Extends `scoring-architecture.md`, which remains the conceptual authority. This document makes it deterministic and numeric.

## 1. Design Summary

- 7 public categories, each scored 0–100 internally (rule points per category sum to exactly 100).
- Overall score = weighted sum of the 7 category scores, weights sum to 100%.
- 48 deterministic V1 scoring rules total.
- Every rule has an explicit evidence type, pass/partial/fail condition, and unknown-handling behavior.
- No rule is scored by generative-AI judgment. All rule evaluation is boolean/threshold/enumeration-based on Observed or User-Provided evidence as defined in `scoring-architecture.md`.

## 2. Category Weights

| Category | Weight | Rationale |
|---|---|---|
| Conversion | 20% | Directly tied to whether the website turns visitors into inquiries — the site's core commercial purpose. Weighted highest. |
| Search Visibility | 15% | Foundational discoverability. Necessary but does not by itself produce revenue — weighted below Conversion. |
| Lead Capture | 15% | Table-stakes infrastructure (forms, phone, booking) that Conversion and Follow-Up depend on. |
| Tracking & Attribution | 15% | "You can't improve what you can't measure" — high strategic value, but many SMBs already accept some blind spots here, so weighted equal to Lead Capture rather than above it. |
| Follow-Up Systems | 15% | Repository-wide emphasis (see `docs/00-company/`) on speed-to-lead as a primary revenue lever. Weighted equal to Tracking rather than higher, because it is almost entirely User-Provided evidence (lower observability, see Section 6). |
| Speed & Performance | 10% | Real factor, but depends on an external provider that may be unavailable (see `performance-options.md`), and speed alone does not guarantee conversion. Weighted lowest of the observed-evidence categories. |
| AI & Automation Readiness | 10% | Forward-looking differentiator, not foundational table-stakes. Intentionally weighted lowest so the assessment does not read as "you need a chatbot." |
| **Total** | **100%** | |

## 3. Rule ID Scheme

`{CATEGORY}-{NN}` — `SV` Search Visibility, `CV` Conversion, `LC` Lead Capture, `SP` Speed & Performance, `TA` Tracking & Attribution, `FU` Follow-Up Systems, `AI` AI & Automation Readiness.

## 4. Search Visibility (SV) — 9 rules, sum 100

### SV-01 — HTTPS Present
- Evidence: Observed (final resolved URL scheme after redirect validation).
- Pass: Homepage loads over `https` with a valid certificate chain as reported by the fetcher. Points: 15.
- Fail: Loads only over `http`, or certificate error. Points: 0.
- Unknown: Fetch failed entirely → category-level unknown handling (Section 8), not this rule alone.
- Finding trigger: Fail → SV-F01. Recommendation: `/seo/`.

### SV-02 — Homepage Title Tag Present & Reasonable Length
- Evidence: Observed (`<title>` on homepage).
- Pass: Present, 10–70 characters. Points: 12.
- Partial: Present but outside 10–70 characters. Points: 6.
- Fail: Missing or empty. Points: 0.
- Finding trigger: Fail or Partial → SV-F02.

### SV-03 — Homepage Meta Description Present
- Evidence: Observed.
- Pass: Present, 50–160 characters. Points: 10.
- Partial: Present, outside range. Points: 5.
- Fail: Missing. Points: 0.
- Finding trigger: Fail → SV-F03.

### SV-04 — Title Tag Uniqueness Across Analyzed Pages
- Evidence: Observed, across the bounded page set defined in `crawl-specification.md`.
- Formula: `points = 15 × (unique titles / total analyzed pages with a title)`, rounded to nearest integer.
- Unknown: If fewer than 2 pages were successfully analyzed, this rule is excluded from the category denominator (Section 8) rather than scored.
- Finding trigger: Ratio < 1.0 → SV-F04.

### SV-05 — Homepage H1 Present (Singular, Non-Empty)
- Evidence: Observed.
- Pass: Exactly one non-empty `<h1>`. Points: 10.
- Partial: One or more H1s present but empty, or exactly 0 detected while other heading levels exist (ambiguous markup). Points: 4.
- Fail: No heading elements detected at all. Points: 0.
- Finding trigger: Partial or Fail → SV-F05.

### SV-06 — XML Sitemap Discoverable
- Evidence: Observed (`robots.txt` sitemap directive, or `/sitemap.xml` direct check per `crawl-specification.md` §3).
- Pass: Found and returns valid XML. Points: 12.
- Fail: Not found or invalid. Points: 0.
- Finding trigger: Fail → SV-F06.

### SV-07 — Robots.txt Present and Not Disallowing All
- Evidence: Observed.
- Pass: `robots.txt` present and does not contain a blanket `Disallow: /` for `User-agent: *`. Points: 10.
- Partial: `robots.txt` absent (default-allow, not necessarily a problem). Points: 7.
- Fail: Present and blocks all crawling of the homepage. Points: 0.
- Finding trigger: Fail → SV-F07 (high severity — site may be invisible to search engines).

### SV-08 — Canonical Tag Present on Homepage
- Evidence: Observed.
- Pass: `<link rel="canonical">` present and self-referential or otherwise valid. Points: 8.
- Fail: Absent. Points: 0.
- Finding trigger: Fail → SV-F08 (low severity, informational).

### SV-09 — Structured Data Detected on Homepage or Key Pages
- Evidence: Observed (`application/ld+json`, microdata, or RDFa detected anywhere in the analyzed set).
- Pass: At least one valid structured-data block detected. Points: 8.
- Fail: None detected. Points: 0.
- Finding trigger: Fail → SV-F09 (low severity).

## 5. Conversion (CV) — 7 rules, sum 100

### CV-01 — Primary CTA Visible on Homepage
- Evidence: Observed (a link or button matching CTA heuristics — see `findings-catalog.md` for exact detection heuristic — pointing to a contact/quote/booking/assessment-style destination, present without scrolling assumptions removed; V1 checks presence anywhere in the rendered-equivalent static HTML above the footer).
- Pass: At least one CTA-pattern element detected. Points: 20.
- Fail: None detected. Points: 0.
- Finding trigger: Fail → CV-F01 (high severity).

### CV-02 — Contact Information Visible (Phone or Email)
- Evidence: Observed (`tel:` or `mailto:` link, or a phone-number-pattern text match, anywhere in analyzed pages).
- Pass: At least one present. Points: 15.
- Fail: Neither present. Points: 0.
- Finding trigger: Fail → CV-F02.

### CV-03 — Contact Form Present and Reachable
- Evidence: Observed (`<form>` element on a contact-labeled page, or homepage).
- Pass: Present. Points: 15.
- Fail: Absent. Points: 0.
- Finding trigger: Fail → CV-F03.

### CV-04 — Booking/Scheduling Path Detected
- Evidence: Observed (link to a known scheduling-tool domain pattern, or a `/book/`, `/schedule/`, `/appointment/`-style internal path).
- Pass: Detected. Points: 10.
- Fail: Not detected. Points: 0. (Not every business needs this — see Section 8 category-specific note.)
- Finding trigger: None (informational only — absence is not penalized as a "finding," only as unclaimed points).

### CV-05 — Mobile Viewport Configured
- Evidence: Observed (`<meta name="viewport">` present with a `width=device-width`-style value).
- Pass: Present and correctly configured. Points: 15.
- Fail: Missing or misconfigured. Points: 0.
- Finding trigger: Fail → CV-F05 (high severity — majority of traffic is typically mobile).

### CV-06 — Service/Offering Clarity
- Evidence: Observed (homepage links to 2 or more distinct internal pages that are not Home/Contact/Blog — i.e., evidence the site explains more than one distinct offering, OR a single clearly-labeled services section with 2+ named services).
- Pass: Met. Points: 15.
- Partial: Only one distinct offering identifiable. Points: 7.
- Fail: No distinguishable offering beyond the homepage itself. Points: 0.
- Finding trigger: Fail → CV-F06.

### CV-07 — Low Friction to Primary Conversion Path
- Evidence: Observed (a contact/quote/CTA destination reachable within 2 link-hops from the homepage, per the crawl graph).
- Pass: ≤2 hops. Points: 10.
- Fail: >2 hops or unreachable within the bounded crawl. Points: 0.
- Finding trigger: Fail → CV-F07 (low severity).

## 6. Lead Capture (LC) — 7 rules, sum 100

### LC-01 — Contact Form Present
- Evidence: Observed. Pass: 25. Fail: 0. (Same detection as CV-03; intentionally double-counted across categories because the underlying fact matters to both business questions — see `data-model.md` for how one Observed fact can back two rules.)
- Finding trigger: Fail → LC-F01.

### LC-02 — Phone Number in Accessible Format
- Evidence: Observed (`tel:` link specifically, not just visible text — a `tel:` link is required for the mobile "tap to call" behavior this rule is checking for).
- Pass: 15. Fail: 0.
- Finding trigger: Fail → LC-F02.

### LC-03 — Email Contact in Accessible Format
- Evidence: Observed (`mailto:` link).
- Pass: 10. Fail: 0.
- Finding trigger: None (low value alone; folded into LC-06).

### LC-04 — Scheduling/Booking Path Present
- Evidence: Observed. Same detection as CV-04.
- Pass: 15. Fail: 0.
- Finding trigger: None (informational).

### LC-05 — Form Field Count Reasonable
- Evidence: Observed (count of `required` input fields on the detected contact form).
- Pass: ≤7 required fields, or no form detected (excluded, see below). Points: 10.
- Fail: >7 required fields. Points: 3.
- Unknown: If LC-01 is Fail (no form), this rule is excluded from the denominator — friction cannot be measured on a form that does not exist.
- Finding trigger: Fail → LC-F05 (low severity).

### LC-06 — Multiple Lead Capture Paths Present
- Evidence: Derived (deterministic combination of LC-01, LC-02, LC-04; count how many of {form, tel: phone, booking path} are present).
- Pass: 2 or more present. Points: 15.
- Partial: Exactly 1 present. Points: 7.
- Fail: 0 present. Points: 0.
- Finding trigger: Fail → LC-F06 (high severity).

### LC-07 — Lead Source Capture Indicator
- Evidence: Observed (hidden form field matching common UTM/source-capture naming patterns, e.g. `utm_source`, `lead_source`, `referrer`, present in form markup).
- Pass: Detected. Points: 10.
- Fail: Not detected, or no form present (excluded from denominator per Section 8 if LC-01 is Fail).
- Finding trigger: Fail (when a form exists but no source field) → LC-F07 (low severity, cross-linked to TA-06/TA-07).

## 7. Speed & Performance (SP) — 5 rules, sum 100

All five rules depend on the external performance provider defined in `performance-options.md`. If the provider is unavailable for a given assessment, **the entire category is excluded from the overall-score denominator** (Section 8) — it is never scored as zero.

### SP-01 — Mobile Performance Score Tier
- Evidence: Observed (approved provider, mobile score 0–100).
- Pass (score ≥ 90): 40. Mid (50–89): 24. Low (<50): 10.
- Finding trigger: Low tier → SP-F01 (high severity). Mid tier → SP-F01b (medium severity).

### SP-02 — Desktop Performance Score Tier
- Evidence: Observed (approved provider, desktop score 0–100).
- Pass (≥90): 25. Mid (50–89): 15. Low (<50): 5.
- Finding trigger: Low tier → SP-F02.

### SP-03 — Largest Contentful Paint (Mobile) Threshold
- Evidence: Observed (provider LCP metric, seconds).
- Pass (≤2.5s): 15. Mid (2.5–4.0s): 8. Low (>4.0s): 0.
- Finding trigger: Low → SP-F03.

### SP-04 — Cumulative Layout Shift Threshold
- Evidence: Observed (provider CLS metric).
- Pass (≤0.1): 10. Mid (0.1–0.25): 5. Low (>0.25): 0.
- Finding trigger: Low → SP-F04.

### SP-05 — No Major Blocking Render Resources Flagged
- Evidence: Observed (provider-reported render-blocking-resources audit).
- Pass (none flagged, or minor only): 10. Fail (provider flags significant blocking resources): 0.
- Finding trigger: Fail → SP-F05 (low severity).

## 8. Tracking & Attribution (TA) — 7 rules, sum 100

### TA-01 — Analytics Tag Detected
- Evidence: Observed (known analytics-script pattern, e.g. GA4 `gtag`/`analytics.js`, in page source).
- Pass: 20. Fail: 0.
- Finding trigger: Fail → TA-F01.

### TA-02 — Tag Manager Detected
- Evidence: Observed (GTM container pattern or equivalent).
- Pass: 10. Fail: 0.
- Finding trigger: None alone (informational, folded into TA-01/TA-06 narrative).

### TA-03 — Google Ads Conversion Tag Detected
- Evidence: Observed. **Conditional rule** — only included in the denominator if the user answers "Google Ads" or "Both" to the Paid Media question (`question-specification.md` Q9).
- Pass: 15. Fail: 0.
- Unknown: If Q9 unanswered or "No" for Google Ads specifically → excluded from denominator entirely (not scored, not failed).
- Finding trigger: Fail (when included) → TA-F03.

### TA-04 — Meta Pixel Detected
- Evidence: Observed. Conditional on Q9 = "Meta Ads" or "Both", same handling as TA-03.
- Pass: 15. Fail: 0.
- Finding trigger: Fail (when included) → TA-F04.

### TA-05 — Call Attribution
- Evidence: Derived (Observed call-tracking-number pattern OR User-Provided answer to Q8 = "Yes"/"Partially").
- Pass (Observed OR User "Yes"): 15. Partial (User "Partially"): 8. Fail (User "No"): 0.
- Unknown: If Q8 = "Phone calls are not a meaningful lead source" → excluded from denominator.
- Finding trigger: Fail → TA-F05.

### TA-06 — Marketing-Source Attribution Capability
- Evidence: User-Provided (Q6).
- Pass ("Yes, reliably"): 15. Partial ("Partially"): 8. Fail ("No"): 0.
- Unknown: Q6 = "Not sure" → excluded from denominator.
- Finding trigger: Fail → TA-F06 (high severity).

### TA-07 — Revenue Attribution Capability
- Evidence: User-Provided (Q7).
- Pass ("Yes, reliably"): 10. Partial ("Partially"): 5. Fail ("No"): 0.
- Unknown: Q7 = "Not sure" → excluded from denominator.
- Finding trigger: Fail → TA-F07 (high severity).

**Denominator note:** when TA-03/TA-04/TA-05/TA-06/TA-07 are conditionally excluded, the category score is computed as `(earned points from included rules / sum of max points of included rules) × 100`, never against the full 100-point nominal total. See Section 9.

## 9. Follow-Up Systems (FU) — 6 rules, sum 100

All User-Provided (Q1–Q5, Q10 in `question-specification.md`). This category is the least directly observable and is intentionally almost entirely User-Provided rather than Observed, per `scoring-architecture.md` §6.

### FU-01 — Leads Enter a CRM
- Evidence: User-Provided (Q1).
- Pass ("CRM" or "Multiple systems" selected): 20. Partial ("Scheduling system" or "Call center / team" only): 10. Fail ("Email inbox" only, or "Not sure"): 0.
- Finding trigger: Fail → FU-F01 (high severity).

### FU-02 — Automated Immediate Acknowledgment
- Evidence: User-Provided (Q3).
- Pass ("Yes"): 15. Partial ("Sometimes"): 7. Fail ("No"/"Not sure"): 0.
- Finding trigger: Fail → FU-F02.

### FU-03 — Automated Lead Routing/Assignment
- Evidence: User-Provided (Q4).
- Pass ("Yes"): 15. Partial ("Partially"): 7. Fail ("No"/"Not sure"): 0.
- Finding trigger: Fail → FU-F03.

### FU-04 — Automated Follow-Up Reminders/Sequences
- Evidence: User-Provided (Q5).
- Pass ("Yes"): 15. Partial ("Partially"): 7. Fail ("No"/"Not sure"): 0.
- Finding trigger: Fail → FU-F04 (high severity).

### FU-05 — Fast Human Response Time
- Evidence: User-Provided (Q2).
- Pass ("Within 5 minutes" or "Within 15 minutes"): 20. Mid ("Within 1 hour" or "Same business day"): 10. Fail ("Next business day or later" or "Varies / not tracked" or "Not sure"): 0.
- Finding trigger: Fail → FU-F05 (high severity).

### FU-06 — Systematic Lead/Customer Reactivation
- Evidence: User-Provided (Q10).
- Pass ("Yes, automated"): 15. Partial ("Yes, mostly manual" or "Occasionally"): 7. Fail ("No"/"Not sure"): 0.
- Finding trigger: Fail → FU-F06.

## 10. AI & Automation Readiness (AI) — 7 rules, sum 100

### AI-01 — Structured Lead Capture
- Evidence: Derived from LC-01/LC-04 (Observed).
- Pass (form or booking path present): 15. Fail (neither): 0.
- Finding trigger: Fail → AI-F01.

### AI-02 — Scheduling/Booking Integration Detected
- Evidence: Observed (same as CV-04/LC-04).
- Pass: 15. Fail: 0.
- Finding trigger: None (informational, folded into AI-01 narrative).

### AI-03 — Chat/Messaging System Detected
- Evidence: Observed (known chat-widget script pattern).
- Pass: 10. Fail: 0.
- Finding trigger: None. This category must not simply reward having a chatbot (per `scoring-architecture.md` §7) — accordingly this rule carries the lowest point value in the category and has no standalone finding.

### AI-04 — CRM Usage Reported
- Evidence: User-Provided (Q1, same evidence as FU-01).
- Pass: 20. Fail: 0.
- Finding trigger: Fail → AI-F04 (shares evidence with FU-F01; findings-catalog.md defines de-duplication so this does not double-surface as two near-identical findings).

### AI-05 — Marketing Automation / Tag Manager Detected
- Evidence: Observed (same as TA-02).
- Pass: 10. Fail: 0.
- Finding trigger: None.

### AI-06 — Documented/Systematic Lead Workflow
- Evidence: Derived (User-Provided; ALL of FU-02, FU-03, FU-04 = "Yes").
- Pass: 20. Partial (2 of 3 "Yes"): 10. Fail (fewer than 2): 0.
- Finding trigger: Fail → AI-F06.

### AI-07 — Machine-Readable Site Structure
- Evidence: Derived (Observed; SV-06 Pass AND SV-09 Pass).
- Pass (both): 10. Partial (one): 5. Fail (neither): 0.
- Finding trigger: None (informational).

## 11. Total Rule Count

**48 deterministic V1 scoring rules** across 7 categories (SV 9, CV 7, LC 7, SP 5, TA 7, FU 6, AI 7).

## 12. Category Score Formula

```
categoryScore = round( (Σ earned points for included rules / Σ max points for included rules) × 100 )
```

"Included rules" excludes any rule whose Unknown/conditional-exclusion condition was met for this specific assessment (see per-rule Unknown notes above). This is the mechanism by which missing evidence is kept neutral rather than penalized — see Section 14.

If **zero** rules in a category are included (all excluded — e.g., Speed & Performance when the provider is fully unavailable AND somehow no rule could be evaluated), the category is marked `unavailable` and excluded entirely from the overall score (Section 13), not scored as 0.

## 13. Overall Score Formula

```
overallScore = round( Σ (categoryScore_i × weight_i) / Σ weight_i-for-available-categories )
```

- Normally `Σ weight_i-for-available-categories = 100%` and the formula is simply the weighted sum.
- If a category is `unavailable` (Section 12), its weight is excluded from both numerator and denominator, and the remaining weights are treated as summing to 100% for that assessment only. This is the "unavailable-provider behavior" required by `architecture-checklist.md`.
- Rounding: standard round-half-up to the nearest integer, applied once at the category level and once at the overall level (no repeated rounding within a single calculation).

## 14. Score Bands

| Band | Range | Label | Guardrail |
|---|---|---|---|
| 1 | 0–39 | Significant Opportunity | Does not imply the business is failing — only that multiple foundational systems were not detected or reported as in place. |
| 2 | 40–59 | Foundational Improvements Needed | Core systems exist but have material gaps. |
| 3 | 60–74 | Good Foundation | Most foundational elements are in place; opportunity remains in specific categories. |
| 4 | 75–89 | Strong Digital Growth System | Most categories score well. Not a guarantee of continued performance or a competitive ranking. |
| 5 | 90–100 | Advanced | Reserved for assessments with strong Observed and User-Provided evidence across nearly all categories. Not a certification, compliance mark, or guarantee of future results. |

Every band label and every result page must avoid implying certification, compliance, guaranteed ranking, or guaranteed revenue outcome, per `website-growth-assessment.md` §"Recommendations."

## 15. Missing-Evidence Denominator Rules (Global)

Three behaviors exist, and every rule above declares which one applies:

1. **Neutral / excluded from denominator** — used when absence of evidence is genuinely uninformative (e.g., a conditional rule for a channel the business doesn't use). Default behavior unless a rule says otherwise.
2. **Partial credit** — used when a weaker-but-nonzero condition is well-defined (e.g., "Partially" answers, mid-tier performance bands).
3. **Explicit zero** — used only when absence itself is a verifiable weakness with no ambiguity (e.g., no contact form detected at all). Never used for "we could not check this."

A rule is never scored as a failure solely because the *scanner* could not reach a page or the *provider* was unavailable — that is always Unknown/excluded, not Fail. Failing to reach a resource and the resource genuinely lacking a feature are different facts and must be distinguished by the implementation (see `crawl-specification.md` §"Failure Behavior" and `data-model.md`'s `ObservedFinding.evidenceState`).

## 16. Partial-Crawl Behavior

If the crawler successfully analyzes at least the homepage but fewer than the target page count (see `crawl-specification.md`), all page-count-dependent rules (e.g., SV-04) compute their ratio against the pages actually analyzed, and the result page must disclose `analysisCoverage` (see `results-contract.md`) so the user knows the assessment was based on a partial page set. Category scores are still computed normally from whatever rules could be evaluated; no additional penalty is applied for partial coverage itself.
