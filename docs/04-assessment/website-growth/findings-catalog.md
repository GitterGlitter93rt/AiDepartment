# Website & Growth Assessment — Findings Catalog (V1)

Status: Architecture Draft — Pending Owner Approval
Every finding below traces directly to a rule defined in `scoring-matrix.md`. No finding exists without a corresponding scoring rule; no scoring rule with a defined finding trigger is missing from this catalog.

## 1. Total Count

**45 V1 findings**: 41 negative/opportunity findings (one per Fail-trigger declared in `scoring-matrix.md`) + 4 positive findings (defined in §4).

## 2. Confidence and Severity Definitions (Shared)

Confidence: `Verified` (Observed, directly detected) · `User-Reported` (User-Provided answer) · `Likely` (Derived from a combination of the above) · `Not Verified` (explicitly could not be determined — used only for findings that surface *despite* being Unknown, e.g., a category-level disclosure, never for a scored Fail).

Severity: `High` · `Medium` · `Low` — assigned per finding below, deterministically fixed (not computed from score magnitude alone), reflecting typical business impact of that specific condition.

## 3. Negative / Opportunity Findings

| Finding ID | Category | Trigger Rule | Evidence Type | Min. Confidence | Severity | User-Facing Text | Recommended Action | Destination(s) | Manual Verification |
|---|---|---|---|---|---|---|---|---|---|
| SV-F01 | Search Visibility | SV-01 Fail | Verified | Verified | High | "This site could not be confirmed as loading over a secure (HTTPS) connection." | "Move the site to HTTPS with a valid certificate — this affects both search visibility and visitor trust." | /seo/ | No |
| SV-F02 | Search Visibility | SV-02 Fail/Partial | Verified | Verified | Medium | "The homepage's page title is missing or falls outside the typical effective length." | "Write a homepage title tag that clearly states what the business does, within roughly 10–70 characters." | /seo/ | No |
| SV-F03 | Search Visibility | SV-03 Fail | Verified | Verified | Medium | "The homepage does not have a meta description." | "Add a homepage meta description summarizing the offer, within roughly 50–160 characters." | /seo/ | No |
| SV-F04 | Search Visibility | SV-04 ratio < 1.0 | Verified | Verified | Medium | "On the pages analyzed, multiple pages did not have unique page titles." | "Give each important page its own distinct, descriptive title tag." | /seo/ | No |
| SV-F05 | Search Visibility | SV-05 Partial/Fail | Verified | Verified | Low | "The homepage's main heading structure could not be clearly identified." | "Add a single, clear H1 heading that states the primary offer." | /seo/ | No |
| SV-F06 | Search Visibility | SV-06 Fail | Verified | Verified | Medium | "No XML sitemap could be found." | "Publish an XML sitemap and reference it in robots.txt to support search-engine discovery." | /seo/ | No |
| SV-F07 | Search Visibility | SV-07 Fail | Verified | Verified | High | "The site's robots.txt file appears to block search engines from crawling the homepage." | "Review robots.txt — this may be preventing the site from appearing in search results at all." | /seo/ | Yes |
| SV-F08 | Search Visibility | SV-08 Fail | Verified | Verified | Low | "The homepage does not have a canonical tag." | "Add a self-referencing canonical tag to the homepage." | /seo/ | No |
| SV-F09 | Search Visibility | SV-09 Fail | Verified | Verified | Low | "No structured data was detected on the pages analyzed." | "Add relevant structured data (e.g., Organization or LocalBusiness schema) to help search engines understand the business." | /seo/ | No |
| CV-F01 | Conversion | CV-01 Fail | Verified | Verified | High | "No clear primary call-to-action was detected on the homepage." | "Add a clear, prominent next step for visitors — request a quote, book a call, or start an inquiry." | /ai-growth-systems/ | Yes |
| CV-F02 | Conversion | CV-02 Fail | Verified | Verified | High | "No accessible phone or email contact was detected." | "Make a phone number or email address easy to find and tap/click on the site." | /ai-growth-systems/ | No |
| CV-F03 | Conversion | CV-03 Fail | Verified | Verified | Medium | "No contact form was detected." | "Add a contact form so visitors who prefer not to call or email can still reach the business." | /ai-growth-systems/ | No |
| CV-F05 | Conversion | CV-05 Fail | Verified | Verified | High | "The site does not appear to be configured for mobile devices." | "Add proper mobile viewport configuration — most visitors likely arrive on a phone." | /ai-implementation/ | Yes |
| CV-F06 | Conversion | CV-06 Fail | Verified | Verified | Medium | "The homepage does not clearly present more than one distinct offering." | "Clarify what the business offers with dedicated, clearly labeled sections or pages." | /ai-consulting/ | No |
| CV-F07 | Conversion | CV-07 Fail | Verified | Verified | Low | "The main way to contact the business could not be reached within two clicks of the homepage." | "Reduce the number of steps between arriving on the site and taking action." | /ai-growth-systems/ | No |
| LC-F01 | Lead Capture | LC-01 Fail | Verified | Verified | High | "No contact form was detected." | "Add a contact form as a low-friction way for visitors to reach the business." | /ai-growth-systems/ | No |
| LC-F02 | Lead Capture | LC-02 Fail | Verified | Verified | Medium | "No tap-to-call phone link was detected." | "Make the phone number a tappable link so mobile visitors can call with one tap." | /ai-growth-systems/ | No |
| LC-F05 | Lead Capture | LC-05 Fail | Verified | Verified | Low | "The contact form on this site requires a relatively high number of fields." | "Consider reducing required form fields to lower friction for new inquiries." | /ai-growth-systems/ | No |
| LC-F06 | Lead Capture | LC-06 Fail | Verified | Verified | High | "No clear way to submit an inquiry (form, phone, or booking) was detected." | "Add at least one clear lead-capture path — a form, phone link, or booking page." | /ai-growth-systems/ | Yes |
| LC-F07 | Lead Capture | LC-07 Fail (form present) | Verified | Verified | Low | "The contact form does not appear to capture how the visitor found the site." | "Add a hidden source-tracking field to the form to support attribution." | /ai-growth-systems/ | No |
| SP-F01 | Speed & Performance | SP-01 Low tier | Verified | Verified | High | "Mobile performance testing placed this site in the lower performance tier." | "Investigate mobile load performance — this can directly affect visitor drop-off." | /ai-implementation/ | Yes |
| SP-F01b | Speed & Performance | SP-01 Mid tier | Verified | Verified | Medium | "Mobile performance testing placed this site in the middle performance tier." | "There is room to improve mobile load performance." | /ai-implementation/ | Yes |
| SP-F02 | Speed & Performance | SP-02 Low tier | Verified | Verified | Medium | "Desktop performance testing placed this site in the lower performance tier." | "Investigate desktop load performance." | /ai-implementation/ | Yes |
| SP-F03 | Speed & Performance | SP-03 Low | Verified | Verified | Medium | "The largest visible content on mobile took longer than typical to load." | "Investigate what content is slow to render on mobile — likely a large image or blocking resource." | /ai-implementation/ | Yes |
| SP-F04 | Speed & Performance | SP-04 Low | Verified | Verified | Low | "The page layout shifted more than typical while loading." | "Reserve space for images/ads/embeds so the layout does not shift as the page loads." | /ai-implementation/ | Yes |
| SP-F05 | Speed & Performance | SP-05 Fail | Verified | Verified | Low | "Performance testing flagged resources that may be delaying the page from rendering." | "Review render-blocking resources flagged by the performance test." | /ai-implementation/ | Yes |
| TA-F01 | Tracking & Attribution | TA-01 Fail | Verified | Verified | High | "No analytics tracking was detected on the pages analyzed." | "Install analytics tracking so traffic and behavior can be measured at all." | /ai-growth-systems/ | No |
| TA-F03 | Tracking & Attribution | TA-03 Fail (Google Ads reported) | Verified | Verified | High | "Google Ads conversion tracking was not detected, even though you reported using Google Ads." | "Verify Google Ads conversion tracking is installed and firing correctly." | /google-ads/ | Yes |
| TA-F04 | Tracking & Attribution | TA-04 Fail (Meta Ads reported) | Verified | Verified | High | "The Meta Pixel was not detected, even though you reported using Meta Ads." | "Verify the Meta Pixel is installed and firing correctly." | /meta-ads/ | Yes |
| TA-F05 | Tracking & Attribution | TA-05 Fail | User-Reported | User-Reported | Medium | "Based on your answers, phone calls are not currently attributed back to a marketing source." | "Consider call tracking if phone leads are a meaningful part of your business." | /ai-growth-systems/ | No |
| TA-F06 | Tracking & Attribution | TA-06 Fail | User-Reported | User-Reported | High | "Based on your answers, you cannot currently identify which marketing source generated a lead once it enters your system." | "Preserve source/campaign information through the CRM so leads can be traced back to their origin." | /ai-growth-systems/ | No |
| TA-F07 | Tracking & Attribution | TA-07 Fail | User-Reported | User-Reported | High | "Based on your answers, closed sales are not currently connected back to the original marketing source." | "Connect closed-deal outcomes back to acquisition source to see which channels actually produce customers, not just leads." | /ai-growth-systems/, /google-ads/, /meta-ads/ | No |
| FU-F01 | Follow-Up Systems | FU-01 Fail | User-Reported | User-Reported | High | "Based on your answers, new leads primarily go to an inbox rather than a CRM or tracked system." | "Route new leads into a CRM so nothing depends on someone checking an inbox." | /ai-implementation/, /ai-growth-systems/ | No |
| FU-F02 | Follow-Up Systems | FU-02 Fail | User-Reported | User-Reported | Medium | "Based on your answers, new leads do not automatically receive an acknowledgment." | "Add an immediate automated acknowledgment so prospects know they were heard while they decide who else to contact." | /ai-growth-systems/ | No |
| FU-F03 | Follow-Up Systems | FU-03 Fail | User-Reported | User-Reported | Medium | "Based on your answers, new leads are not automatically routed to the right person or team." | "Automate lead routing/assignment so leads don't sit waiting for manual triage." | /ai-growth-systems/, /ai-implementation/ | No |
| FU-F04 | Follow-Up Systems | FU-04 Fail | User-Reported | User-Reported | High | "Based on your answers, uncontacted leads do not automatically generate reminders or follow-up." | "Create an automated follow-up sequence for leads who haven't responded." | /ai-growth-systems/ | No |
| FU-F05 | Follow-Up Systems | FU-05 Fail | User-Reported | User-Reported | High | "Based on your answers, new inquiries are not typically contacted within an hour." | "Speed-to-lead has a direct relationship with conversion — consider a faster, more consistent response workflow." | /ai-growth-systems/ | No |
| FU-F06 | Follow-Up Systems | FU-06 Fail | User-Reported | User-Reported | Medium | "Based on your answers, old leads and past customers are not systematically followed up with." | "A reactivation campaign can generate new opportunity from contacts you already have." | /ai-growth-systems/ | No |
| AI-F01 | AI & Automation Readiness | AI-01 Fail | Verified | Verified | Medium | "No structured way to capture a lead (form or booking page) was detected." | "Add a structured lead-capture mechanism as a foundation for future automation." | /ai-implementation/ | No |
| AI-F04 | AI & Automation Readiness | AI-04 Fail | User-Reported | User-Reported | Medium | "Based on your answers, leads are not currently entering a CRM." | "A CRM is typically the foundation that makes further automation possible." | /ai-implementation/ | No |
| AI-F06 | AI & Automation Readiness | AI-06 Fail | User-Reported | User-Reported | Medium | "Based on your answers, lead handling does not yet follow a consistent, automated workflow end to end." | "Document and automate the lead workflow from first contact through follow-up." | /ai-implementation/, /ai-consulting/ | No |

**Count check:** SV 9 + CV 6 + LC 5 + SP 6 + TA 6 + FU 6 + AI 3 = 41. Matches §1.

## 4. Positive Findings

Included only where they provide genuine standalone value (a business should know when something is working, not only when it isn't), per the requirement to avoid flooding the report with low-value findings.

| Finding ID | Category | Trigger | User-Facing Text |
|---|---|---|---|
| POS-01 | Lead Capture | LC-06 Pass (2+ paths) | "Multiple ways to reach the business were detected (form, phone, and/or booking) — this is a strong foundation for lead capture." |
| POS-02 | Follow-Up Systems | FU-05 Pass at top tier ("Within 5 minutes" or "Within 15 minutes") | "Based on your answers, new inquiries are typically contacted quickly — this is a meaningful competitive advantage." |
| POS-03 | Tracking & Attribution | TA-06 Pass AND TA-07 Pass | "Based on your answers, you can trace both leads and closed revenue back to their original marketing source — this is a strong attribution foundation." |
| POS-04 | Search Visibility | SV-01, SV-06, SV-07 all Pass | "The core technical foundations for search visibility — secure connection, sitemap, and crawlability — are all in place." |

## 5. Full Findings Section vs. Priority Opportunities

- **Full findings section:** every negative finding whose trigger condition is met for a given assessment, plus every positive finding whose trigger condition is met. No arbitrary cap — the full section is meant to be a complete, honest record, bounded naturally by the 45-finding universe and the reality that most assessments will trigger well under all 41 negative findings.
- **Priority opportunities:** capped at **5 maximum, 3 minimum** (when fewer than 3 qualify, show only what qualifies rather than padding). Selection method defined in §6.

## 6. Deterministic Priority Opportunity Selection

For each triggered negative finding, compute a priority score:

```
priorityScore = (severityWeight × 3) + (confidenceWeight × 2) + (categoryWeight × 10) + userRelevanceBonus
```

Where:
- `severityWeight`: High = 3, Medium = 2, Low = 1.
- `confidenceWeight`: Verified = 2, User-Reported = 2, Likely = 1, Not Verified = 0 (Not Verified findings never surface as priority opportunities — see §7).
- `categoryWeight`: the category's weight from `scoring-matrix.md` §2, expressed as a decimal (e.g., Conversion = 0.20).
- `userRelevanceBonus`: +2 if the finding's underlying rule was directly gated by a user answer indicating relevance (e.g., TA-03 only applies if the user reported using Google Ads — its relevance is user-confirmed, not assumed) — 0 otherwise.

Sort all triggered findings by `priorityScore` descending. Take the top 5 (or fewer if fewer than 5 findings triggered, or fewer if a `priorityScore` tie-breaking rule below results in exclusion).

**Tie-breaking (deterministic, applied in order until resolved):**
1. Higher `severityWeight` wins.
2. Lower rule's max-point value in `scoring-matrix.md` loses less — i.e., prefer the finding tied to the rule with the *larger* point value (bigger scoring impact) — higher max-point rule wins.
3. Alphabetical by Finding ID (final deterministic tie-break, guarantees a total order).

This is explicitly not an LLM-ranked list — it is a fixed arithmetic formula over already-deterministic inputs, satisfying the "must not use an LLM to rank priorities" requirement.

## 7. Manual Verification Flag

A finding is flagged "manual verification recommended" (rightmost column above) when the underlying condition has real business consequences if wrong, but the automated check has a plausible false-positive/negative mode (e.g., SV-07 robots.txt blocking — could theoretically be an intentional staging-site block; SP findings — provider variance; CV-01/CV-05/LC-06 — heuristic pattern matching rather than exhaustive markup analysis). Findings with `No` in this column are considered reliable enough from direct, unambiguous markup presence/absence that manual verification adds little value.
