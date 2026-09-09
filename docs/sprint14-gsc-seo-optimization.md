# Sprint 14 — Search Console Optimization, Structured Data, Internal Linking

**Date:** 2026-09-09
**Branch:** `sprint14-gsc-seo-optimization`
**Branched from:** `sprint13-twilio-a2p-compliance` @ `4c1e01dabf0d2e47a5968cf5edec66483d49a893`
**Status:** implemented and verified. **Not deployed, not merged.**

---

## 1. Data source, and the timing that qualifies it

| | |
|---|---|
| Source | Google Search Console, property `sc-domain:youraidepartment.ai` |
| Data settled through | **2026-09-06** |
| Sprint 13 production deployment | **2026-09-09** |
| Sprint 14 work | 2026-09-09 |

**The baseline below predates the Sprint 13 deployment.** It describes a version of the site Google has since stopped seeing. It is used here as evidence of *demand* — which queries Google associates with which pages — and not as a verdict on anything shipped on 2026-09-09.

Nothing in this document should be read as "the September 9 release underperformed." Google has not yet recrawled it.

### Baseline — last 28 settled days

| Metric | Value |
|---|---|
| Clicks | 4 |
| Impressions | 435 |
| CTR | 0.92% |
| Average position | 41.2 |
| Sitemap | 119 URLs, 0 errors, 0 warnings |
| Brand query "your ai department" | ~47 impressions, position ~3 |

### Query evidence used

| Cluster | Page | Impressions | Notes |
|---|---|---|---|
| AI CRM | `/ai-crm-integration/` | 88 | `ai chatbot crm integratie` 23, `ai crm integration services` 17, `ai crm integration` 11, `integrate ai into crm` 10, `integrating ai into crm` 8 |
| Logistics documents | `/resources/ai-for-logistics-document-processing…/` | 15 | `ai document processing in logistics` 15 — a clean one-to-one intent match |
| Garage door | `/industries/garage-door-companies/` 40 · attribution resource 22 | 62 | `ai marketing services garage doors` splitting 21 (pos ~61) / 20 (pos ~47.7) — **real cannibalization** |
| CRM setup | `/crm-setup-automation/` | 16 | `crm automation setup` 10 |
| Process automation | `/resources/what-business-processes-should-not-be-automated/` | 21 | challenges / disadvantages / risks / problems of business process automation |
| Speed to lead | `/resources/why-speed-to-lead-matters/` | 13 | `ai speed to lead`, `speed to lead automation`, `speed to lead contractor` |
| Pest control | `/resources/how-pest-control-companies-can-track-marketing…/` | 13 | lead tracking, marketing automation, marketing ROI |
| Insurance | `/industries/insurance/` | 8 | `insurance ai consultant` |
| Professional services | `/industries/professional-services/` | 9 | `dept ai consultant` |
| Pool | `/resources/how-pool-companies-can-track-google-ads…/` | 3 | `google ads for pool companies`, position ~25.3 — closest non-brand page-two candidate |

---

## 2. Three figures in the brief did not match the repository

Recorded because the work was scoped around them, and because "fix the broken meta description" and "improve an adequate one" are different tasks:

| Page | Brief said | Actually rendered |
|---|---|---|
| `/resources/what-business-processes-should-not-be-automated/` | meta ~14 chars | **161 chars**, a reasonable description |
| `/resources/why-speed-to-lead-matters/` | meta ~45 chars | **138 chars** |
| `/resources/how-pool-companies-can-track-google-ads-to-signed-projects/` | meta ~15 chars | **159 chars** |

All three were still replaced — the new versions cover query intent better — but none was rescuing a broken tag. The brief's word-count estimates for two resource bodies were also high (it said ~1,150 words for the what-not-to-automate article; the source was 657).

---

## 3. Global structured-data fix

A live crawl reported two defects site-wide:

```
Article missing required "image"     — all 63 resource pages
Organization missing "logo"          — homepage, and the author/publisher
                                       objects inside every Article
```

**One cause.** The Organization object was typed by hand in two files — `BaseLayout.astro` and `resources/[slug].astro` — and neither copy had a logo. Identical failure mode to the nine industry pages that had no `BreadcrumbList` before Sprint 13: a schema object living in whichever file happened to be open.

**Fix:** `src/lib/schema.ts` builds `organizationSchema()`, `organizationRef()`, `websiteSchema()`, `articleSchema()` and `breadcrumbSchema()`. Both templates import.

| Change | Detail |
|---|---|
| Organization logo | `/icon-512.png` — the existing YAD mark already shipped for the favicon and manifest set. A real brand asset, not a graphic created for a validator. 512×512, clearing Google's 112×112 minimum. |
| Emitted as | `ImageObject` with explicit `width`/`height` and an **absolute** URL. Google resolves relative URLs inconsistently in JSON-LD; a relative logo is the same as no logo. |
| Article image | `/og-default.png`, the existing 1200×630 social image. The resource collection has no per-article image field, so `articleSchema()` takes an optional `image` and falls back — rather than adding a field nothing populates. |
| Article author + publisher | Both now carry the logo. |
| Preserved exactly | `Organization.name` = `Your AI Department`; `Organization.legalName` = `Catastrophic Solutions LLC`. |
| `SITE.logoImage` | Added to `src/lib/site.ts` alongside the existing `defaultSocialImage`. |

**Verified on the built output:** 63 Article nodes, 1 Organization node, **0 defects**.

Nothing invented: no person author, no `aggregateRating`, no `review`, no `offers`, no FAQ node added to farm rich results. A test fails if any appears.

---

## 4. Titles — before and after

Measured from **rendered HTML**, not from source, with entities decoded.

| Page | Before | | After | |
|---|---|---|---|---|
| | | len | | len |
| `/ai-crm-integration/` | AI CRM Integration Services \| Your AI Department | 48 | *unchanged* | 48 |
| `/resources/ai-for-logistics-document-processing…/` | AI Document Processing in Logistics \| Your AI Department | 56 | *unchanged* | 56 |
| `/resources/what-business-processes-should-not-be-automated/` | What Business Processes Should Not Be Automated? \| Your AI Department | 69 | *unchanged* | 69 |
| `/resources/why-speed-to-lead-matters/` | Why Speed-to-Lead Matters — and How to Build a Better Response System \| … | 90 | Why Speed to Lead Matters for Service Businesses \| Your AI Department | **69** |
| `/resources/how-garage-door-companies-can-track-advertising-leads-to-revenue/` | How Garage Door Companies Can Track Advertising Leads to Revenue \| … | 85 | Garage Door Marketing Attribution \| Your AI Department | **54** |
| `/conversion-tracking-analytics/` | Conversion Tracking & Revenue Attribution \| Your AI Department | 62 | AI Conversion Tracking & Attribution \| Your AI Department | **57** |
| `/resources/how-pool-companies-can-track-google-ads-to-signed-projects/` | How Pool Companies Can Track Google Ads Leads to Signed Projects \| … | 85 | Google Ads Tracking for Pool Companies \| Your AI Department | **59** |
| `/industries/insurance/` | AI Consulting & Automation for Insurance Companies \| Your AI Department | 71 | AI Consulting for Insurance Companies \| Your AI Department | **58** |
| `/industries/law-firms/` | AI for Law Firms \| Your AI Department | 37 | *unchanged* | 37 |
| `/industries/roofing/` | AI for Roofing Companies \| Your AI Department | 45 | *unchanged* | 45 |
| `/resources/how-pest-control-companies-can-track-marketing…/` | How Pest Control Companies Can Track Marketing to Recurring Customers \| … | 90 | Pest Control Marketing Attribution \| Your AI Department | **55** |
| `/resources/how-real-estate-teams-can-reactivate-old-leads/` | How Real Estate Teams Can Reactivate Old Leads \| Your AI Department | 67 | AI Lead Reactivation for Real Estate Teams \| Your AI Department | **63** |
| `/resources/how-ecommerce-brands-can-connect-ad-spend-to-customer-revenue/` | How E-commerce Brands Can Connect Ad Spend to Customer Revenue \| … | 83 | Ecommerce Ad Spend to Revenue Attribution \| Your AI Department | **62** |
| `/resources/how-electrical-contractors-can-automate-estimate-follow-up/` | How Electrical Contractors Can Automate Estimate Follow-Up \| … | 79 | Electrical Estimate Follow-Up Automation \| Your AI Department | **61** |

### The title-length rule applied

Shorten where it can be done **without losing the query**; leave long where the query needs the length.

- Four titles remain over 60: what-not-to-automate (69), speed-to-lead (69), real estate (63), ecommerce (62). In each case the keyword is front-loaded, so Google truncates the brand suffix and not the term. `What Business Processes Should Not Be Automated?` **is** the query — trimming it would discard the exact question people search.
- The ` | Your AI Department` suffix (20 chars) is kept on every page for consistency with the 57 resources this sprint does not touch. Dropping it on six pages would fragment how the resource library appears in search results.

---

## 5. Descriptions — before and after

| Page | Before | After |
|---|---|---|
| `/ai-crm-integration/` | 184 | **147** — "AI CRM integration services that connect chatbots, voice agents, intake, follow-up and automation to your existing CRM, with human review built in." |
| `/resources/ai-for-logistics-document-processing…/` | 218 | **147** — "Learn how logistics companies use AI document processing to automate freight documents, data entry, back-office workflows and operational handoffs." |
| `/resources/what-business-processes-should-not-be-automated/` | 161 | **143** — "Learn which business processes should stay human-led, where automation creates risk, and how to decide what should and should not be automated." |
| `/resources/why-speed-to-lead-matters/` | 138 | **131** — "See why faster lead response matters and how to build an automated speed-to-lead system for calls, forms and after-hours inquiries." |
| garage door attribution | 164 | **121** |
| `/conversion-tracking-analytics/` | 174 | **151** |
| pool Google Ads | 159 | **116** |
| `/industries/insurance/` | 148 | 148 *(unchanged — already good)* |
| `/industries/law-firms/` | 200 | **144** |
| `/industries/roofing/` | 191 | **150** |
| pest control | 140 | **150** |
| real estate | 180 | **142** |
| ecommerce | 168 | **140** |
| electrical | 160 | **145** |

Every one now lands in 116–151 characters. Meta description is treated here as CTR/snippet work, not as a ranking lever.

---

## 6. Content changes

Only two pages gained content, and only where a GSC intent had no honest answer.

### `/resources/what-business-processes-should-not-be-automated/` — 657 → ~1,120 words

Two sections added:

- **Good automation candidates vs poor ones.** Two characteristic lists — frequency and predictable inputs and a cheap, visible failure on one side; cost borne by the customer and discovered late, context that lives in someone's head, and decisions someone will later have to defend on the other. Closing point: the second list is not what technology cannot touch, it is what automation should *prepare* and a person should *finish*.
- **The real risks, and what they look like in practice.** Errors moving faster than they used to; a broken process getting quicker instead of fixed; ownership going missing; exception volume underestimated; customers noticing the seams.

That covers `challenges of`, `disadvantages of`, `risks of` and `problems business process automation can solve` by discussing them, not by listing the phrases.

### `/resources/why-speed-to-lead-matters/` — 718 → ~1,200 words

- **Three ways a lead arrives, and what each one needs** — the call nobody picked up (highest intent, recovery window in minutes), the web form (fails silently), and the after-hours inquiry (where the realistic goal is to capture honestly, not to close).
- **Speed-to-lead automation without losing the relationship** — the predictable failure of an obviously-automatic reply that says nothing specific, and five things that work instead.

The page previously had **zero** outbound contextual links; it now has four.

No statistic was invented in either. No response-rate percentage, no ROI figure, no "X% of leads" claim.

---

## 7. Internal links added

Contextual, inside `<main>`, placed in sentences that were already making the argument.

| From | To | Anchor |
|---|---|---|
| `/ai-growth-systems/` | `/conversion-tracking-analytics/` | conversion tracking and revenue attribution |
| `/ai-growth-systems/` | `/ai-crm-integration/` | connecting AI to your CRM |
| `/managed-ai-department/` | `/ai-crm-integration/` | AI-assisted CRM workflows |
| `/managed-ai-department/` | `/conversion-tracking-analytics/` | attribution |
| `/meta-ads/` | `/conversion-tracking-analytics/` | conversion tracking and revenue attribution |
| `/meta-ads/` | `/ai-growth-systems/` | AI Growth Systems |
| `/google-ads/` | `/resources/what-is-ai-conversion-tracking/` | what AI actually contributes to conversion tracking |
| `/google-ads/` | `/resources/how-pool-companies-can-track-google-ads-to-signed-projects/` | pool companies track Google Ads leads through to signed projects |
| `/resources/where-logistics-companies-should-start-with-ai/` | logistics document processing | AI document processing in logistics |
| logistics document processing | `/industries/logistics-transportation/` | AI for logistics and transportation |
| `/resources/why-speed-to-lead-matters/` | `/ai-agent-development/` | AI phone and voice agents |
| `/resources/why-speed-to-lead-matters/` | `/ai-crm-integration/` | AI CRM integration |
| `/resources/why-speed-to-lead-matters/` | `/conversion-tracking-analytics/` | conversion tracking and attribution |
| `/resources/why-speed-to-lead-matters/` | `/industries/home-services/` | home services |

### Two stale anchors repaired

| Page | Was | Now |
|---|---|---|
| `/industries/logistics-transportation/` | "AI for Logistics Document Processing and Back-Office Automation" (the old article title) | "AI document processing in logistics" |
| `/industries/pool-companies/` | "How Pool Companies Can Track Google Ads Leads to Signed Projects" | "Google Ads tracking for pool companies" |

### Contextual inbound counts

| Target | Before | After |
|---|---|---|
| `/ai-crm-integration/` | 10 | **12** |
| `/conversion-tracking-analytics/` | 11 | **14** |
| pool Google Ads resource | 4 | **5** |
| `/resources/what-is-ai-conversion-tracking/` | 2 | **3** |

Anchor diversity for `/ai-crm-integration/` is asserted by test: at least three distinct editorial anchor strings, so the same exact-match phrase cannot be repeated into a pattern.

---

## 8. Garage door cannibalization — how it was resolved

`ai marketing services garage doors` was splitting across two of our own pages, 21 impressions at ~61 and 20 at ~47.7. Neither ranked; both diluted.

**Intent ownership was made explicit rather than one page being suppressed.**

| Page | Owns | Enforced by |
|---|---|---|
| `/industries/garage-door-companies/` | Broad commercial intent — AI systems, answering, automation for garage door companies | Title kept as `AI Systems for Garage Door Companies`; a test fails if it starts using attribution language in its title |
| attribution resource | Marketing attribution, lead tracking, ads → completed jobs → revenue | Title changed from the generic article headline to `Garage Door Marketing Attribution`; a test fails if it starts reading as generic AI marketing |

Reciprocal links already existed both ways; the industry page's anchor now names the attribution intent instead of repeating the article title, which is the signal that tells Google which page answers which question.

**Not touched:** the multiple pages ranking for `your ai department`. That is normal branded behaviour, the homepage already owns it at position ~3, and noindexing About/Enterprise/Method to "fix" it would be self-harm.

---

## 9. What was deliberately not done

| Item | Why |
|---|---|
| Rewriting `/ai-crm-integration/` | ~2,500 words, substantially upgraded in Sprint 13. Metadata shortened and inbound links strengthened; body untouched. |
| Rewriting `/conversion-tracking-analytics/` | Same. One title change, one description, three new inbound links. |
| Site-wide title-length cleanup | Sprint 13 measured 82 of 118 titles over 60 characters and deliberately left them, citing an earlier metadata pass. Broadening this sprint into that would be churn against pages that already rank. |
| Any change to `/industries/professional-services/` | `dept ai consultant` (9 impressions) reads as a truncated or mistyped query, not a stable intent. Nothing to align to without guessing. |
| Forcing indexation of `/sms-consent/` and `/resources/what-is-ai-conversion-tracking/` | Both are in the sitemap with contextual inbound links, and both were deployed on 2026-09-09. The correct action is to wait for a crawl. No homepage link was added to force it. |
| Any robots, canonical, or trailing-slash change | The `/x` → `/x/` 301s and the http/www redirects are correct canonical behaviour. Search Console's "Page with redirect" on those is the expected result. |
| Any new route | Sitemap deliberately unchanged at 119. |
| FAQ schema | Would be added only to chase rich results, and the content does not warrant it. |

---

## 10. Verification

Clean, from a removed `node_modules`:

```
npm ci            exit 0
npx astro check   331 files — 0 errors, 0 warnings, 11 hints
npm test          588 tests / 130 suites / 588 pass / 0 fail   (+33)
npm run build     129 pages, exit 0
```

| Check | Result |
|---|---|
| Build pages | 129 — unchanged, no new routes |
| Sitemap URLs | 119 — unchanged |
| `/go/` in sitemap | 0 |
| `/go/` robots | `noindex, follow` on both |
| `dist/.htaccess` | present, byte-identical to production |
| `dist/og-default.png` | present |
| `dist/icon-512.png` | present, 512×512 confirmed from the PNG header |
| `robots.txt` | unchanged |
| Schema defects | 0 across 63 Article + 1 Organization nodes |
| `Your AI Department LLC` in rendered output | 0 pages |
| `Organization.legalName` | `Catastrophic Solutions LLC` |

### Tests added — 33

Structured data completeness across every Article node · logo asset exists and its real dimensions match the schema claim · builders emit no rating, review, offer or person author · `dateModified` advances without overwriting `publishDate` · per-page title and description assertions with front-loading enforced · titles and descriptions unique site-wide · garage-door intent ownership · every expected contextual link exists and every destination builds · anchor diversity · Sprint 13 invariants (sitemap 119, `/go/` noindex and excluded, legal entity, no PII in analytics, deployment artefacts).

One production change was required to make the schema chain testable: `src/lib/site.ts` used extensionless imports that Astro resolves but Node's test runner does not. It now uses explicit `.ts` extensions, matching `attribution.ts` and `bookingConfirmation.ts`.

---

## 11. Sprint 13 preserved

Verified unchanged: Twilio legal disclosures, `Catastrophic Solutions LLC` as the active entity, `/sms-consent/`, privacy and terms, both footer disclosures, Smartlead attribution, first/latest touch, `rep_code`, Cal.com forwarding, booking confirmation, GA4/GTM, Meta Pixel, `/go/law-firms/`, `/go/roofing/`, noindex rules, assessment flows, Web3Forms, `.htaccess`, redirects, caching and compression.

`Your AI Department LLC` was **not** activated. That remains a future cutover — `docs/legal-entity-cutover.md`.

---

## 12. How to evaluate this

**Do not compare against the 2026-09-06 baseline until Google has recrawled.** That baseline describes the pre-Sprint-13 site.

Sequence:

1. **Now → recrawl.** Watch Search Console Coverage for `/sms-consent/` and `/resources/what-is-ai-conversion-tracking/` moving from unknown to indexed. Neither is a ranking signal; both confirm crawling resumed.
2. **~2 weeks after deployment.** Re-run the Rich Results Test on the homepage and any resource page — the Article-image and Organization-logo warnings should be gone. That is the one change with a deterministic outcome.
3. **~4 weeks.** Impressions and average position for the query clusters in §1, per page. Position movement leads; clicks lag. The garage-door split is the specific thing to watch: the two pages should begin separating rather than trading the same query.
4. **Do not judge CTR before position moves.** At position 41 the description rewrites cannot show an effect; a snippet nobody sees cannot be clicked.

At 435 impressions over 28 days this property does not yet have the volume to resolve small differences. Expect direction, not significance.
