# Sprint 16 — GSC Search-Demand Expansion & Topical Authority

**Date:** 2026-09-14
**Branch:** `sprint16-gsc-demand-expansion`
**Branched from:** `sprint15-analytics-conversion-integrity` @ `01726450dae877c63e3883a9947b19bf22cf8f48`
**Status:** implemented and verified. **Not deployed, not merged.**

This sprint intentionally stacks on the approved Sprint 15 analytics branch. It does not
include the Sprint 16 Twilio 30923 work, which lives on a separate branch off a different
base.

---

## 1. Data source and window

| | |
|---|---|
| Source | Google Search Console, property `sc-domain:youraidepartment.ai` |
| Window used | **2026-09-07 → 2026-09-12** |
| Data settled through | **2026-09-12** |
| Excluded | 2026-09-13 — incomplete when the analysis was performed, and not treated as authoritative |

These are small numbers. A query with four impressions at position 90 means Google has
started *testing* the site for something; it is not a result. Everything below is read as
direction, not verdict.

---

## 2. Query evidence

### Garage doors — `/industries/garage-door-companies/`

23 impressions, average position ~66.3 (prior comparable period: 17 impressions, ~71).
Moving in the right direction.

| Query | Impressions | Avg position |
|---|---|---|
| `ai marketing services garage doors` | 12 | ~57 |
| `ai receptionist for garage door companies` | 4 | ~96.5 |
| `garage door company ai search optimization` | 4 | ~89.8 |
| `ai voice agent for door repair services` | 1 | ~87 |

### CRM

| Query | Impressions | Avg position |
|---|---|---|
| `crm automation setup` | 12 | ~73.8 |
| `ai chatbot crm integratie` | 6 | ~73.7 |
| `ai crm integration services` | 5 | ~89.6 |
| `integrate ai into crm` | 4 | ~86.3 |
| `integrating ai into crm` | 2 | — |
| `integration of ai to crm` | 1 | — |

### Automotive / DMS

| Query | Impressions | Avg position |
|---|---|---|
| `ai solutions dms compatibility large dealership groups` | 3 | ~81 |
| `dms-compatible ai solutions for automotive service departments` | 1 | ~69 |

### Estimate follow-up

| Query | Impressions | Avg position | Google currently associates it with |
|---|---|---|---|
| `unsold estimates follow up` | 1 | ~21 | `/resources/ai-follow-up-for-pool-estimates/` |

Position ~21 is the strongest non-brand position in the set. The page Google chose is the
pool-specific one, while the repository already contained a better-suited generic
home-service resource. That mismatch is what Section 6 below corrects.

---

## 3. What was created, and what deliberately was not

### Created — 3 new indexable resources

| Route | Owns |
|---|---|
| `/resources/ai-search-optimization-for-garage-door-companies/` | garage door company AI search optimization; AI search visibility; generative-search readiness; local organic visibility |
| `/resources/how-to-integrate-an-ai-chatbot-with-a-crm/` | how to integrate an AI chatbot with a CRM; chatbot-to-CRM architecture and data flow; implementation considerations |
| `/resources/ai-dms-integration-for-automotive-dealerships/` | DMS-compatible AI; AI + dealer management system integration; AI for automotive service departments |

### Upgraded — 2 existing resources

| Route | Change |
|---|---|
| `/resources/ai-phone-handling-for-garage-door-companies/` | Expanded into the authoritative AI receptionist / voice-agent resource. Retitled, re-described, `updatedDate: 2026-09-14`, original `publishDate: 2026-08-18` preserved. ~350 → ~2,200 words. |
| `/resources/how-home-service-companies-can-automate-estimate-follow-up/` | Made the explicit owner of generic unsold-estimate wording. Retitled, re-described, `updatedDate: 2026-09-14`, original `publishDate` preserved. |

### NOT created — existing pages already owned the topic

This is the part of the sprint that mattered most, and it is recorded deliberately.

**1. No new "AI receptionist for garage door companies" page.**
The query `ai receptionist for garage door companies` (4 impressions, ~96.5) looks like it
wants a dedicated page. It does not.
`/resources/ai-phone-handling-for-garage-door-companies/` already owned phone intake,
missed-call recovery, routing, booking and human escalation — the entire substance of the
query. A second page would have split the topic across two URLs, given Google a reason to
pick between them, and left both weaker. The existing page was expanded and retitled
instead, so all of the authority it has already accumulated since 2026-08-18 stays on one
URL.

**2. No new generic "unsold estimates follow up" page.**
`/resources/how-home-service-companies-can-automate-estimate-follow-up/` already covered
quoted work across HVAC, plumbing, electrical, roofing, pools, outdoor living, garage
doors, generators and restoration. Creating a generic unsold-estimate page alongside it
would have produced two near-identical cross-trade pages competing for the same query. The
existing page was made the explicit owner of the vocabulary instead, and the pool article —
the page Google currently surfaces for the query — now hands generic intent to it via a
contextual link while keeping pool-specific intent for itself.

**3. No third commercial CRM service page.**
`/ai-crm-integration/` and `/crm-setup-automation/` already own the commercial CRM queries,
both are Sprint 14 pages Google has not finished evaluating, and the demand that was
unserved was *informational* ("how do I integrate an AI chatbot with a CRM"), not another
service page. The new resource is a guide that supports both commercial pages and links to
each; neither commercial page's title, H1 or description was changed.

---

## 4. Intent ownership map

Treated as an SEO contract and enforced by `tests/sprint16Seo.test.ts`.

### Garage door cluster

| Page | Owns | Must NOT own |
|---|---|---|
| `/industries/garage-door-companies/` | AI for / systems for / automation for / **AI marketing services for** garage door companies; broad commercial implementation intent | receptionist, search optimization, attribution |
| `/resources/ai-phone-handling-for-garage-door-companies/` | AI receptionist, AI voice agent, AI phone answering, missed-call recovery, phone intake, call routing | `ai marketing services garage doors` |
| `/resources/ai-search-optimization-for-garage-door-companies/` | garage door AI search optimization, AI search visibility, generative-search readiness, local organic visibility | `ai marketing services garage doors` — explicitly |
| `/resources/how-garage-door-companies-can-track-advertising-leads-to-revenue/` | marketing attribution, advertising lead tracking, campaign-to-revenue | receptionist, search optimization |
| `/resources/automating-garage-door-replacement-estimate-follow-up/` | garage door estimate / replacement proposal follow-up | generic unsold-estimate wording |

Sprint 14 gave the industry page the broad `ai marketing services garage doors` query. That
ownership is untouched, and the new search resource is explicitly tested for *not* chasing
it.

### CRM cluster

| Page | Owns |
|---|---|
| `/ai-crm-integration/` | commercial AI CRM integration services, AI CRM implementation, connecting AI into an existing CRM |
| `/crm-setup-automation/` | CRM setup, CRM automation setup, CRM configuration, workflow foundation |
| `/resources/how-to-integrate-an-ai-chatbot-with-a-crm/` | how to integrate an AI chatbot with a CRM, chatbot-CRM architecture, data flow, implementation considerations |

The guide supports the commercial pages; it does not replace them. Its title is tested to
contain no "services" framing.

### Automotive

| Page | Owns |
|---|---|
| `/industries/automotive-dealers/` | broad AI systems / automation for dealer groups |
| `/resources/ai-dms-integration-for-automotive-dealerships/` | DMS-compatible AI, AI + DMS integration, AI for automotive service departments, enterprise dealership DMS considerations |

### Estimate follow-up

| Page | Owns |
|---|---|
| `/resources/how-home-service-companies-can-automate-estimate-follow-up/` | unsold estimates follow up, estimate follow-up automation, open estimates, quoted-job follow-up across trades |
| Vertical estimate pages (pool, garage door, electrical, plumbing, screen enclosure, outdoor living) | their vertical-specific variants only |

---

## 5. Final URLs, titles, H1s and descriptions

### New

**`/resources/ai-search-optimization-for-garage-door-companies/`**
- Title: `AI Search Optimization for Garage Door Companies | Your AI Department` (69)
- H1: `AI Search Optimization for Garage Door Companies`
- Description (160): *How garage door companies can improve visibility in Google and AI-assisted search through local signals, service content, reviews, structured data and tracking.*

**`/resources/how-to-integrate-an-ai-chatbot-with-a-crm/`**
- Title: `How to Integrate an AI Chatbot With a CRM | Your AI Department` (62)
- H1: `How to Integrate an AI Chatbot With Your CRM`
- Description (156): *How AI chatbot CRM integration works: lead capture, record matching, conversation summaries, routing, tasks, follow-up triggers, security and human handoff.*

**`/resources/ai-dms-integration-for-automotive-dealerships/`**
- Title: `AI DMS Integration for Automotive Dealerships | Your AI Department` (66)
- H1: `AI & DMS Integration for Automotive Dealerships`
- Description (157): *How dealerships can connect AI workflows to a dealer management system for service intake, scheduling, declined-service follow-up, communication and handoff.*

### Upgraded

**`/resources/ai-phone-handling-for-garage-door-companies/`**
- Title: `AI Receptionist for Garage Door Companies | Your AI Department` (62)
- H1: `AI Receptionist & Phone Handling for Garage Door Companies`
- Description (156): *See how an AI receptionist can help garage door companies answer calls, recover missed leads, collect job details, route emergencies and support scheduling.*

**`/resources/how-home-service-companies-can-automate-estimate-follow-up/`**
- Title: `Unsold Estimate Follow-Up Automation for Home Services | Your AI Department` (75)
- H1: `How Home Service Companies Can Automate Unsold Estimate Follow-Up`
- Description (156): *How home service companies can automate unsold estimate follow-up: keep quoted work visible, prioritize open opportunities and route responses to your team.*

**Note on title length.** Five of these exceed the ~60-character band Sprint 14 applied to
its own priority pages. The titles are the ones the sprint brief specified, and the target
keyword is front-loaded in every case, so SERP truncation costs the brand suffix rather
than the query match. Sprint 14's ≤60 rule remains scoped to the pages it named; it was not
extended, because doing so would have required rewriting titles the brief set explicitly.

---

## 6. Internal links added

Editorial, in-body links only. No site-wide link block was created.

### Garage door cluster
- `/industries/garage-door-companies/` → receptionist resource — prose link, anchor *"AI receptionist for garage door companies"*
- `/industries/garage-door-companies/` → search resource — prose link, anchor *"AI search optimization for garage door companies"*
- `/industries/garage-door-companies/` cross-link row — receptionist anchor updated to *"AI receptionist and phone handling"*; search resource added as *"Getting found in Google and AI-assisted search"*
- Search resource → industry page, `/seo/`, `/conversion-tracking-analytics/`, `/google-ads/`, attribution resource, receptionist resource
- Receptionist resource → industry page, search resource, `/resources/why-speed-to-lead-matters/`, garage estimate resource, attribution resource, CRM guide, `/ai-agent-development/`, `/ai-implementation/`, `/ai-crm-integration/`
- `/seo/` → search resource (new contextual paragraph in the "SEO + AI Growth Systems" section)

### CRM cluster
- `/ai-crm-integration/` → CRM guide (prose, in the chatbot-to-CRM section)
- `/crm-setup-automation/` → CRM guide (prose, arguing sequencing)
- CRM guide → `/ai-crm-integration/`, `/crm-setup-automation/`, `/ai-agent-development/`, `/resources/why-speed-to-lead-matters/`, `/resources/what-business-processes-should-not-be-automated/`

### Automotive
- `/industries/automotive-dealers/` → DMS resource (prose, in the "Implementation Reality" section)
- DMS resource → `/industries/automotive-dealers/`, `/ai-crm-integration/`, `/ai-implementation/`, CRM guide, `/resources/what-business-processes-should-not-be-automated/`

### Estimate follow-up
- `/resources/ai-follow-up-for-pool-estimates/` → generic home-service resource, anchor *"broader unsold estimate follow-up workflow"*
- Generic resource → pool, garage door, electrical, plumbing, screen enclosure and outdoor living estimate resources; `/industries/home-services/`; `/ai-growth-systems/`; missed-call and speed-to-lead resources; home-service attribution resource

Anchor text was deliberately varied — the test suite asserts that each new resource is
reached by at least two distinct anchor strings, so no exact-match anchor gets repeated
site-wide.

---

## 7. Cannibalization protections

`tests/sprint16Seo.test.ts` — 38 tests. It protects intent, routes, metadata and links, not
paragraphs.

- Garage door industry page still titled `AI Systems for Garage Door Companies`, and its
  title/description are asserted *not* to contain receptionist, search-optimization or
  attribution language.
- Receptionist resource must carry receptionist/voice metadata and must not carry
  "AI marketing services" or the industry page's `AI Systems for Garage Door` title form.
- Search resource must carry search-optimization metadata and is explicitly asserted not to
  chase "marketing services" in title or description.
- Attribution resource still owns attribution/revenue.
- No two pages in the garage door cluster may share a title or an H1.
- `/ai-crm-integration/` and `/crm-setup-automation/` keep their Sprint 14 titles and
  descriptions; the CRM guide's title may not contain "services".
- Automotive industry page stays broad; DMS article stays DMS-specific.
- Generic estimate page must contain unsold/open/quoted/stale/closed-lost vocabulary and
  must stay cross-trade; **no vertical estimate page's title may contain "unsold estimate"**.
- Pool article must link to the generic page with an anchor naming the generic intent.

### Claim discipline, also enforced
- The DMS article and the automotive industry page must name **no** DMS/CRM vendor
  (CDK, Reynolds, Dealertrack, Tekion, Xtime, DealerSocket, VinSolutions) — the simplest
  durable guard against an unproven compatibility claim.
- The DMS article must keep its access caveat (approved / permit / contract / OEM).
- No Sprint 16 page may make a promissory ranking claim (`we guarantee`,
  `guarantee your top…`, `rankings are guaranteed`, `Google prefers`,
  `ChatGPT ranks businesses`, `our proprietary algorithm`). The guard is scoped to
  promissory constructions on purpose: the search article *names* "guaranteed rankings" as a
  vendor red flag, and that sentence has to stay publishable.
- The search article must state plainly that rankings cannot be guaranteed.
- The receptionist article must keep its human-judgment boundary and its safety language.
- The estimate article must keep "not every unsold estimate is recoverable" and must
  contain **no percentage figure at all** — an invented close rate is the most likely
  fabrication on that topic.

---

## 8. Sitemap

| | URLs |
|---|---|
| Before (Sprint 15, approved) | 119 |
| Added | 3 |
| **After** | **122** |

`public/sitemap.xml` is a static file, not generated, so the three URLs were inserted by
hand in the existing alphabetical order. The diff is purely additive — three lines, no
reordering.

`/go/law-firms/` and `/go/roofing/` remain noindex and excluded. No redirect stubs added.
The two upgraded resources were already listed and did not move.

Two existing tests pinned the count at 119 and were updated to 122:
`tests/sprint14Seo.test.ts` and `tests/analyticsIntegrity.test.ts`. The assertions
themselves are unchanged in character — the count is still pinned, duplicates still
rejected, and every listed URL must still build and be indexable — so an *accidental* route
still fails rather than leaking into the sitemap.

---

## 9. Build and verification

| Check | Result |
|---|---|
| `npm ci` | clean |
| `npx astro check` | **0 errors, 0 warnings**, 10 hints (identical to the Sprint 15 baseline — all pre-existing) |
| `npm test` | **662 passing, 0 failing** (624 baseline + 38 new) |
| `npm run build` | **132 pages** (129 baseline + 3) |
| Sitemap | 122 URLs |
| `dist/.htaccess` | present, **unchanged** |
| `robots.txt`, `404.html`, `og-default.png`, `icon-512.png` | present |

Page count reconciles exactly: 129 → 132, three new resource routes, no other route added
or removed.

### Manual quality audit

Rendered HTML inspected for all three new resources, both upgraded resources, and all five
pages that gained links:

- One H1 each, unique across the site.
- Unique title and meta description; all descriptions 156–160 characters.
- Self-canonical, no `noindex`, no duplicate `<title>`.
- Valid `Article` JSON-LD on every new resource: headline, description, `datePublished`,
  absolute `mainEntityOfPage`, absolute `image`, author and publisher Organizations each
  carrying an absolute `logo` and `legalName: Catastrophic Solutions LLC`.
- No malformed JSON-LD anywhere in `dist/`.
- No raw markdown or MDX expression leakage into rendered output.
- No duplicate paragraph blocks on any modified page.
- Every internal link destination resolves to a built route.

### Responsive

No browser automation is configured in this repository, so responsive behaviour was audited
statically rather than by screenshot. Every CSS rule added this sprint uses `max-width`
(never fixed `width`), sets no `min-width`, and adds no fixed horizontal padding; all new
article content uses `GroupedFlow` and standard prose elements already used across the
existing 63 resources. There is no new mechanism by which a narrow viewport could overflow.

---

## 10. Other changes, and why

Three small changes outside the content itself. Each is recorded because none was requested
by the brief.

**1. H3 support in the resource template** (`src/pages/resources/[slug].astro`).
The brief asks for clear H2/H3 structure, and the longer guides genuinely need a second
heading level. No resource in the collection had ever used `###`, so the template styled
`h2, p, ul, ol` into the 760px reading column and left `h3` unstyled — an h3 would have
rendered at the full 1120px article-body width, breaking the reading column. Added `h3` to
the shared max-width rule plus a size/weight rule that reads as subordinate to the h2
above it. No existing page renders differently, because none uses h3.

**2. `.prose-p a` styling on `/ai-crm-integration/` and `/crm-setup-automation/`.**
The global reset is `a { color: inherit; text-decoration: none }`, so an in-prose link is
invisible unless the page defines a colour. Every other page carrying an in-prose link
(`/industries/hvac/`, `/industries/law-firms/`, `/industries/roofing/`,
`/conversion-tracking-analytics/`) already had `.prose-p a { color: electric-blue;
font-weight: 600 }`. `/ai-crm-integration/` did not — which means the `/crm-setup-automation/`
link Sprint 14 added to that page has been rendering in the same slate-gray as the
surrounding body text since it shipped. The rule was added to both pages, matching the
existing convention exactly. This fixes a pre-existing accessibility defect as a side
effect; no copy changed.

**3. New `/resources/` hub category: "CRM & Systems Integration".**
The hub's taxonomy is a hard-coded `{name, slugs}` array and every resource must be
assigned to exactly one category or it does not appear. The garage door search resource
went into the existing "Home Service Trades" group alongside the other garage door
articles. The CRM guide and the DMS article had no existing home — both are cross-industry
systems-integration content supporting a commercial page. One new category holding both was
preferable to two orphan single-item categories, or to filing them under a vertical where a
reader would not look. This uses the existing convention; no new content system was
introduced.

---

## 11. Deliberately deferred

Per the brief, no pages were created for query clusters with signals too small to act on:

- pest control
- property management
- restoration
- insurance
- landscaping
- screen enclosures

Relevant pages already exist for each. Let more Search Console data accumulate.

Also untouched, because Google has not finished evaluating Sprint 14 and a few days of
post-deploy data is not evidence: `/ai-crm-integration/`, `/crm-setup-automation/`,
`/industries/insurance/`, `/resources/what-business-processes-should-not-be-automated/`,
`/resources/why-speed-to-lead-matters/`, `/conversion-tracking-analytics/`. The first two
gained one contextual link each, explicitly permitted by the brief; no copy, title, H1 or
description on any of the six was changed.

Nothing in the sprint scope was left incomplete.

---

## 12. Regression protection verified

| Sprint | Protected | Verified by |
|---|---|---|
| 15 | `traffic_type` marker, analytics event taxonomy, `booking_confirmed`, attribution, GTM hooks, dataLayer privacy | `tests/analyticsIntegrity.test.ts`, plus a Sprint 16 assertion that no analytics/GTM/consent code was touched |
| 14 | SEO metadata, Organization schema, Article schema, internal links, garage-door attribution split | `tests/sprint14Seo.test.ts` |
| 13 | Twilio A2P compliance, SMS consent, privacy, terms, legal identity, footer disclosures | `tests/twilioA2pCompliance.test.ts` |
| — | Assessments, `rep_code`, UTM storage, Cal.com forwarding, Web3Forms, GA/GTM, Meta integration point, `.htaccess`, redirects, 404, robots, campaign funnel noindex | full suite, 662 passing |

`LEGAL_ENTITY` remains `Catastrophic Solutions LLC`. No page in `dist/` contains
"Your AI Department LLC". `dist/.htaccess` is byte-identical to the Sprint 15 baseline.

---

## 13. Release package

`youraidepartment-production-20260914-fa57c05.zip` — 3,222,607 bytes (3.07 MiB), 250 files.

SHA-256: `5ef08967afdad28739fb5dda6055ae01bc295ada4e1ec9c1cfa1fc1ae565fb9c`

Built from the verified `dist/`, with the website files at the ZIP root and no `dist/`
wrapper directory. Verified four ways:

- `unzip -t` — no errors detected.
- Top-level entries are the site's own files (`404.html`, `_astro/`, `about/`, …), not a
  `dist/` directory.
- Extracted to a temporary directory and `diff -r` against `dist/` — identical, 250 files
  each side, `.htaccess` and the other dotfiles included.
- Round-tripped: downloaded back from Dropbox after upload, SHA-256 matches the local file
  exactly.

Uploaded to `dropbox:/YourAiDepartment-Website/` per the runbook in
`docs/10-operations/website-deployment.md`. `rclone check` against the Dropbox content hash
reports 0 differences. The folder went from 12 files to 13 — the upload was purely
additive, and no historical release package was deleted, replaced or overwritten.

**Not deployed.** The handoff point is a verified ZIP in Dropbox; SiteGround upload and
extraction remain Michael's step.

---

## NEXT GSC REVIEW

Check these query clusters approximately **7 days** and **14 days** after deployment. Give
Google time to recrawl — the pages below are new or materially changed, and any reading
before a recrawl describes the old site.

| Cluster | Watch | Expected owner |
|---|---|---|
| garage door AI services | `ai marketing services garage doors`, `ai services for garage door companies` | `/industries/garage-door-companies/` |
| garage door AI receptionist | `ai receptionist for garage door companies`, `ai phone answering garage door` | `/resources/ai-phone-handling-for-garage-door-companies/` |
| garage door AI voice agent | `ai voice agent for door repair services` | `/resources/ai-phone-handling-for-garage-door-companies/` |
| garage door AI search optimization | `garage door company ai search optimization` | `/resources/ai-search-optimization-for-garage-door-companies/` |
| AI chatbot CRM integration | `ai chatbot crm integratie`, `integrate ai into crm`, `integrating ai into crm` | `/resources/how-to-integrate-an-ai-chatbot-with-a-crm/` (informational) |
| AI CRM integration services | `ai crm integration services` | `/ai-crm-integration/` (commercial) |
| AI DMS integration | `ai solutions dms compatibility large dealership groups`, `dms-compatible ai solutions for automotive service departments` | `/resources/ai-dms-integration-for-automotive-dealerships/` |
| unsold estimates follow up | `unsold estimates follow up` | `/resources/how-home-service-companies-can-automate-estimate-follow-up/` |

**What would count as a problem:**

- `ai marketing services garage doors` starts returning the search-optimization resource
  instead of the industry page — that is the cannibalization this sprint was designed to
  prevent, and it would mean the resource drifted.
- `unsold estimates follow up` still returns `/resources/ai-follow-up-for-pool-estimates/`
  after 14 days and a confirmed recrawl — the contextual link did not shift the signal, and
  the next step would be strengthening the generic page's inbound links rather than
  weakening the pool page.
- `ai crm integration services` starts returning the new guide instead of
  `/ai-crm-integration/` — the guide would be reading as commercial and its framing would
  need tightening.
- Impressions on `/industries/garage-door-companies/` fall while the new resources rise.
  The cluster should lift the industry page, not replace it.

**What is not yet meaningful:** clicks. At the current impression volumes, single-digit
click changes are noise. Judge this sprint on impressions, average position and which URL
Google associates with each query — not on conversions, for at least a month.
