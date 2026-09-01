# Full-Site SEO & Indexability Audit

Status: Complete local audit — now cross-checked against real Search Console data
Version: 2.0 (previously 1.0, pre-Search-Console)
Generated: 2026-08-29 (against the current production build of https://youraidepartment.ai)

---

# REAL SEARCH CONSOLE DATA (authoritative — report updated 2026-08-20)

| Metric | Count |
|---|---|
| Total known pages | 127 |
| Indexed | 24 |
| Not indexed | 103 (85 discovered-not-indexed, 16 crawled-not-indexed, 2 alternate-canonical) |

Full interpretation, the Group A/Group B distinction, and why the exact
16 "crawled — not indexed" URLs cannot be analyzed individually in this
repo (no export present) live in
`docs/seo/google-indexation-diagnostic.md`. Deployment/action sequence
lives in `docs/seo/search-console-action-plan.md`. **This local audit
did not find a broad robots/sitemap/canonical blocker** — that finding
is preserved and is consistent with 82% of the "not indexed" set being
in the discovery-lag category, not the content-rejection category.

## Live-host verification (this pass — verified via curl, not speculated)

The prior pass could only say hosting-level URL normalization "must be
checked on the live host." This pass had live network access and
checked it directly:

| Check | Result |
|---|---|
| `http://` → `https://` | ✅ 301 redirect confirmed |
| non-trailing-slash → trailing-slash (e.g. `/about` → `/about/`) | ✅ 301 redirect confirmed |
| `www.youraidepartment.ai` → non-www | ✅ **FIXED (re-verified live this pass, 2026-08-29):** `https://www.youraidepartment.ai/*` now returns `301 Moved Permanently` → `location: https://youraidepartment.ai/*`, confirmed via curl on both the homepage and a path with query parameters (`/about/?utm_source=test&utm_campaign=verify`) — the query string is preserved exactly. This was fixed externally at the Cloudflare layer; no repo change was needed or made, since the app's canonical/schema/OG logic already always emitted the non-www host regardless of which host served the request. |
| Live `robots.txt` vs. repo's `public/robots.txt` | They differ, but not as a bug: Cloudflare injects a "Managed content" block (confirmed present — `# BEGIN Cloudflare Managed content`) that blocks known AI-training crawlers (GPTBot, CCBot, Bytespider, ClaudeBot, Google-Extended, etc. — note `Google-Extended` is Google's AI-training token, distinct from `Googlebot`) while explicitly declaring `Content-Signal: search=yes` and preserving `Allow: /` for normal search crawling. **Googlebot's search-indexing crawl is not blocked.** This confirms Cloudflare sits in front of production, consistent with `docs/cal-booking-webhook.md`'s earlier speculation about the DNS/CDN layer. |
| Live sitemap URL count | ✅ 117 — matches this repo's indexable count exactly; no drift between deployed and local build. |
| Retired redirect stub (`/ai-department-audit/`) | Confirmed: HTTP 200 with `<meta http-equiv="refresh">` + `<meta name="robots" content="noindex">` — expected for static hosting (no server-side 301 capability without an adapter); this was already documented behavior, now confirmed live. |

**Risk assessment of the www finding (now resolved):** the www
duplicate was likely a minor contributor at most, not the primary
explanation for 103 non-indexed pages — 85 of those show Last Crawled:
N/A (never fetched at all), which a www/non-www canonical duplicate
does not explain for pages Google hasn't crawled under either host
yet. **The fix is now live and verified** (see table above). No further
action needed on this item; it remains in the action plan only as a
"monitor for reclassification" note — Google may take a subsequent
crawl cycle to update any www URLs it had indexed/discovered from
"Alternate page with proper canonical" to "Page with redirect."

---

# EXECUTIVE SUMMARY

## Totals

- **Total routes audited (built):** 122
- **Indexable pages:** 117
- **Intentionally noindex pages:** 5
- **Redirects:** 1
- **Error/utility (404):** 1

## Duplicate/quality counts

- Duplicate titles: **0** (before: 0)
- Duplicate meta descriptions: **0** (before: 0)
- Duplicate H1s: **0** (before: 1 — homepage duplicated the full engine's H1; fixed this pass)
- Thin indexable pages (<350 words): **0**
- Orphan/weak-discovery indexable pages: **0** (before: 1 — `/ai-assessment/` had zero internal inbound links; fixed via footer link)

## Canonical / sitemap / robots problems found and fixed this pass

1. `/404.html` emitted a canonical pointing at the nonexistent `/404/` URL — fixed: noindex pages no longer emit canonicals.
2. `/ai-assessment/` was a true orphan (sitemap-only, zero internal links) — fixed: footer "Assessment Options" link.
3. Five titles lacked the consistent brand suffix — fixed (construction, healthcare, insurance, manufacturing, method pages).
4. Homepage title/description/H1 were assessment-generic and duplicated the full engine's H1 — rewritten (see below).

## Why ~100 pages may not be indexing — now cross-checked against real data

**Real Search Console data now exists** (see the block at the top of this
document and `docs/seo/google-indexation-diagnostic.md`): 85 of 103
non-indexed URLs are "Discovered — currently not indexed" with Last
Crawled: N/A (Google has not yet fetched them — a discovery/crawl-
priority state, not a rejection), and 16 are "Crawled — currently not
indexed" (Google fetched them and chose not to index — the
diagnostically meaningful category). The local technical audit's
original conclusion is preserved and is consistent with this
distribution: sitemap complete and valid, self-canonical HTTPS with
consistent trailing slash, robots.txt allows all paths, no orphans, no
duplicate/thin templates. See the indexation-diagnostic doc for the
full Group A/B analysis, and `docs/seo/search-console-action-plan.md`
for the recommended action sequence. **The exact 16 "crawled — not
indexed" URLs are not available in this repo** (no Search Console
export present) — per-URL remediation for that group is pending.

## Pages materially rewritten this pass

**SEO Copy Completion pass (first pass, same day):**
- Homepage: title, meta description, H1, hero eyebrow, hero copy.
- `/industries/construction/`, `/industries/healthcare/`, `/industries/insurance/`,
  `/industries/manufacturing/`, `/ai-department-method/`: title brand-suffix fixes.
- 25 meta descriptions rewritten (12 commercial, 13 industry) — see
  `docs/seo/metadata-before-after.md` for the full record.

**Search Console + Final SEO Quality pass (this pass):**
- 7 further meta descriptions rewritten after a second editorial
  review of every money page: `/ai-implementation/`,
  `/managed-ai-department/`, `/enterprise/`, `/crm-setup-automation/`,
  `/industries/healthcare/`, `/industries/manufacturing/`,
  `/industries/insurance/` (the last three had shared an identical
  "Practical AI and automation for [industry]" template opener).
- Internal linking: added reciprocal "Related Resources" links from 18
  industry pages back to the resource articles that already reference
  them; added a link from the homepage's "AI Department Method" section
  to `/ai-department-method/` (previously zero contextual links despite
  the section describing that exact page); added a 3-way "Related
  Services" cross-link between `/ai-training/`, `/ai-workshops/`, and
  `/executive-ai-coaching/` (previously zero cross-links among them —
  `/ai-workshops/` had zero contextual/body-content inbound links
  sitewide before this fix). See "Internal crawl-priority analysis"
  below.

## Internal crawl-priority analysis (this pass)

Raw "inbound link" counts are not a meaningful crawl-priority signal on
this site, because the site header (nav) and footer are identical on
every page — any page linked from either shows an inflated ~120
inbound-link count regardless of actual topical relevance. This pass
instead computed **contextual inbound links**: links appearing in page
BODY content only (excluding `<header>` and `<footer>`), which is a
truer signal of what a crawler would treat as a genuine editorial
endorsement of a page's relevance.

Findings (before this pass's fixes):
- **4 indexable pages had zero contextual inbound links:** `/about/`,
  `/contact/` (both expected — they are top-level PRIMARY_NAV items, one
  click from every page via nav, and do not need in-body contextual
  links), `/ai-assessment/` (the legacy chooser page — acceptable;
  footer-only discovery was an intentional design decision in an
  earlier pass), and **`/ai-workshops/`** (a real gap — a paid
  commercial service page reachable only through the Services
  mega-menu dropdown and footer, with no page anywhere linking to it
  contextually). Fixed: `/ai-workshops/` now has contextual inbound
  links from `/ai-training/` and `/executive-ai-coaching/`.
- **18 industry pages had 3 dedicated resource articles that already
  link TO them** (via each resource's `primaryDestination` frontmatter
  field) **but did not link back** — a real, evidence-based reciprocal-
  linking gap, not a hypothesis. Fixed for all 18: defense-aerospace,
  ecommerce, electrical-contractors, energy, fiber-broadband,
  financial-services, garage-door-companies, home-services,
  landscaping-outdoor-living, logistics-transportation, pest-control,
  plumbing, pool-companies, property-management, real-estate,
  restoration-emergency-services, screen-enclosure-companies, solar.
- **10 industry pages have no dedicated resource articles at all**
  (automotive-dealers, collision-repair, construction, healthcare,
  hvac, insurance, law-firms, manufacturing, professional-services,
  roofing) — a genuine resource-cluster gap, documented here rather
  than "fixed" by fabricating placeholder articles (explicitly
  forbidden this pass).
- The homepage's "AI Department Method" section named and described
  that exact page's content with zero link to it. Fixed with one
  contextual link.

## Homepage before/after

- Title BEFORE: `Your AI Department | AI Consulting, Implementation & Growth`
- Title AFTER: `AI Consulting & Automation Services | Your AI Department`
- Description BEFORE: `Identify and implement high-value AI opportunities across marketing, sales, operations, employee productivity, automation, and customer experience with Your AI Department.`
- Description AFTER: `An AI consulting and implementation company building practical AI systems, workflow automation, AI agents, and CRM and marketing systems. Start with a free AI assessment.`
- H1 BEFORE: `Find Out Where AI Can Actually Improve Your Business.` (duplicated the full engine page)
- H1 AFTER: `AI Consulting, Implementation & Automation for Real Business Value.`

## Keyword mapping decisions (cannibalization guardrails)

- Homepage owns **"AI consulting company / AI consulting & automation services"**.
- `/ai-consulting/` owns **"AI consulting services"** (service-depth page; homepage
  stays brand/overview-level — different intent, no cannibalization).
- `/ai-implementation/` owns **"AI implementation services"**.
- `/ai-agent-development/` owns **"AI agent development (company/services)"**.
- `/ai-growth-systems/` owns **"AI marketing automation / growth systems"**;
  `/google-ads/`, `/meta-ads/`, `/seo/` own their channel-specific terms.
- `/crm-setup-automation/` owns **"CRM setup and automation"**;
  `/ai-crm-integration/` owns **"AI CRM integration"** — distinct intents
  (platform implementation vs AI connection to an existing CRM).
- `/managed-ai-department/` owns **"managed AI services / outsourced AI department"**.
- `/enterprise/` owns **"enterprise AI consulting/transformation"**.
- `/free-ai-assessment/` owns **"free AI assessment"**; `/comprehensive-ai-business-audit/`
  owns **"AI business audit"**; `/ai-assessment/` is the comparison page only.
- Each industry page owns **"AI for/consulting for each industry"**; resources own
  long-tail how-to phrasing. No two pages share a primary keyword.

## Indexation priority tiers (for manual URL Inspection / request indexing)

- **Tier 1 (request indexing first, after deploy):** /, /ai-consulting/, /ai-implementation/, /ai-growth-systems/, /managed-ai-department/, /free-ai-assessment/, /comprehensive-ai-business-audit/, /enterprise/, /contact/, /ai-department-method/
- **Tier 2:** `/industries/` hub + priority industry pages: /industries/collision-repair/, /industries/law-firms/, /industries/roofing/, /industries/hvac/, /industries/construction/, /industries/professional-services/
- **Tier 3:** remaining commercial pages + remaining industry pages
- **Tier 4:** `/resources/` hub + cornerstone resources (how-to-identify-high-value-ai-opportunities, where-should-a-business-start-with-ai, why-speed-to-lead-matters, what-business-processes-should-not-be-automated, how-to-track-google-ads-leads-to-revenue)
- **Tier 5:** remaining long-tail resources

Do NOT mass-request indexing. Request Tier 1 first; expand only as those index.

## Known intentional non-indexation (do NOT "fix")

`/ai-assessment/full/` (internal comprehensive engine), `/ai-assessment/results/`,
`/booking-confirmed/`, `/404.html`, `/ai-department-audit/` (redirect stub).

## Remaining manual work

1. **Still pending:** drop the Search Console "Page indexing" export
   into `docs/seo/input/` and run the process in
   `docs/seo/google-indexation-diagnostic.md` and
   `docs/seo/search-console-action-plan.md` — this is the only way to
   get the exact 16 "crawled — not indexed" URLs for individual review.
2. ~~Verify live-host 301 behavior (http→https, www, trailing slash) with curl.~~
   **Done.** All three confirmed live and working this pass: http→https,
   non-trailing-slash→trailing-slash, and www→non-www (the last one
   fixed externally at Cloudflare since the prior pass, re-verified live
   here with query-string preservation confirmed).
3. Earn first external links to Tier 1 pages (directories, partners, profiles) —
   the highest-leverage action for a "Discovered – not indexed" pattern.
4. og:image is not set on any page (no social sharing image exists in the repo).
   A branded OG image is a flagged improvement, not fabricated here.
5. Google's displayed favicon updates only after recrawl/recache — expect days to
   weeks; do not change favicon URLs again this cycle. Implementation verified
   intact and unchanged this pass (see Favicon status below).

## Favicon / search appearance status

favicon.ico (16/32/48), favicon.svg, favicon-16x16.png, favicon-32x32.png,
apple-touch-icon.png (180), icon-192.png, icon-512.png, site.webmanifest all
exist in `public/`, are copied to `dist/`, and are centrally referenced from
BaseLayout (stable URLs at `/favicon.ico` etc., robots allowed, ≥48px sources
available for Google's crawler). No broken references (test-verified).

---

# PER-PAGE SCORECARD

Verdict legend: Strong index candidate / Orphan-weak discovery / Thin-soft-404 risk /
Intentionally noindex / Redirect (correctly excluded). "Inbound" = internal pages
linking to the route (crawl discovery signal).

## TIER 1 — Homepage & highest-value commercial

| Route | Type | Primary keyword | Title | Meta description (truncated) | Canonical | Sitemap? | Inbound | H1 | Schema | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| / | Commercial (homepage) | AI consulting company | AI Consulting & Automation Services \| Your AI Department | An AI consulting and implementation company building AI agents, workflow automation, and CRM systems that spee… | self ✓ | Yes | 120 | AI Consulting, Implementation & Automation for Real Business Value. | Organization, WebSite | Strong index candidate |
| /ai-consulting/ | Commercial | AI consulting services | AI Consulting Services for Business \| Your AI Department | Practical AI consulting that finds where AI, automation, and better systems will actually pay off in your busi… | self ✓ | Yes | 120 | Stop Guessing Where AI Fits in Your Business | — | Strong index candidate |
| /ai-department-method/ | Commercial | AI strategy framework | The AI Department Method — AI Strategy & Implementation Framework \| Your AI Department | Discover a practical framework for identifying, prioritizing, implementing, and measuring AI opportunities acr… | self ✓ | Yes | 120 | A Practical System for Turning AI Into Business Results | — | Strong index candidate |
| /ai-growth-systems/ | Commercial | AI marketing automation | AI Growth Systems \| Marketing, Sales & Conversion \| Your AI Department | One connected growth system: ads, landing pages, AI lead response, follow-up automation, and revenue attributi… | self ✓ | Yes | 120 | One Connected System for Acquiring and Converting Customers | — | Strong index candidate |
| /ai-implementation/ | Commercial | AI implementation services | AI Implementation Services for Business \| Your AI Department | Turn AI opportunities into working systems — we design, build, and integrate AI agents, automation, and custom… | self ✓ | Yes | 120 | Turn AI Opportunities Into Working Business Systems | — | Strong index candidate |
| /comprehensive-ai-business-audit/ | Conversion | AI business audit | Comprehensive AI Business Audit — $495 \| Your AI Department | A $495 fixed-price deeper diagnostic across AI readiness, marketing, sales follow-up, and operations — with a … | self ✓ | Yes | 120 | Comprehensive AI Business Audit — $495 | — | Strong index candidate |
| /contact/ | Commercial | contact AI consultant | Contact Your AI Department | Talk to our team about AI strategy, implementation, automation, or training — or book a free strategy call and… | self ✓ | Yes | 120 | Tell Us What You Want to Improve | — | Strong index candidate |
| /enterprise/ | Commercial | enterprise AI consulting | Enterprise AI Transformation \| Your AI Department | Enterprise AI transformation for large organizations: coordinated strategy, governance, and implementation ove… | self ✓ | Yes | 120 | Turn AI Experimentation Into an Enterprise Capability | — | Strong index candidate |
| /free-ai-assessment/ | Conversion | free AI assessment | Free AI Opportunity Assessment — Get Your AI Department Score \| Your AI Department | Take the free AI Opportunity Assessment — 15 questions, about 3-4 minutes — and get your AI Department Score, … | self ✓ | Yes | 120 | Get Your AI Department Score. | — | Strong index candidate |
| /managed-ai-department/ | Commercial | managed AI services | Managed AI Department \| Ongoing AI Strategy & Implementation \| Your AI Department | Your outsourced AI department: ongoing AI strategy, implementation oversight, governance, and optimization — w… | self ✓ | Yes | 120 | Your Outsourced AI Department, Not Another One-Time Project | — | Strong index candidate |

## TIER 2 — Core industry pages

| Route | Type | Primary keyword | Title | Meta description (truncated) | Canonical | Sitemap? | Inbound | H1 | Schema | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| /industries/collision-repair/ | Industry | AI for collision repair | AI for Collision Repair Businesses \| Your AI Department | Stop losing unsold estimates: consistent follow-up, standardized shop workflows, and customer status updates t… | self ✓ | Yes | 120 | Help Your Body Shop Capture More Jobs, Reduce Administrative Work, and Improve Customer Communication | — | Strong index candidate |
| /industries/construction/ | Industry | AI for construction companies | AI Systems for Construction Companies \| Your AI Department | Keep construction bids from slipping: connected CRM, automated estimate follow-up, document workflows, and rep… | self ✓ | Yes | 120 | Help Your Construction Company Reduce Administrative Work, Improve Follow-Up, and Scale More Efficiently | — | Strong index candidate |
| /industries/hvac/ | Industry | AI consulting for HVAC companies | AI for HVAC Companies \| Your AI Department | Answer every HVAC call, book more jobs, and protect your reputation with AI-assisted intake, scheduling, and f… | self ✓ | Yes | 120 | Help Your HVAC Company Capture More Calls, Book More Jobs, and Improve Operational Efficiency | — | Strong index candidate |
| /industries/law-firms/ | Industry | AI consulting for law firms | AI for Law Firms \| Your AI Department | Never let an unanswered call cost your firm a case: AI-assisted intake, consultation scheduling, and client co… | self ✓ | Yes | 120 | Help Your Law Firm Respond Faster, Reduce Administrative Work, and Build a Smarter Growth System | — | Strong index candidate |
| /industries/professional-services/ | Industry | AI for professional services firms | AI for Professional Services Firms \| Your AI Department | Free capacity in a knowledge-intensive firm: AI-assisted knowledge systems, document workflows, client intake,… | self ✓ | Yes | 120 | Help Your Firm Increase Employee Capacity, Improve Client Service, and Grow More Efficiently | — | Strong index candidate |
| /industries/roofing/ | Industry | AI consulting for roofing companies | AI for Roofing Companies \| Your AI Department | Roofing is a lead-speed business. Handle storm-season demand spikes, follow up every estimate, and keep multip… | self ✓ | Yes | 120 | Help Your Roofing Company Capture More Leads, Respond Faster, and Scale Without Adding Unnecessary Overhead | — | Strong index candidate |

## TIER 3 — Supporting commercial + industry pages

| Route | Type | Primary keyword | Title | Meta description (truncated) | Canonical | Sitemap? | Inbound | H1 | Schema | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| /404.html | Error/utility |  | Page Not Found \| Your AI Department | The page you're looking for could not be found. | — | No | 0 | We Couldn't Find That Page | — | Intentionally noindex |
| /about/ | Commercial | AI consulting company background | About Your AI Department \| Practical AI for Business | Meet the team behind Your AI Department — an external AI department combining strategy, implementation, market… | self ✓ | Yes | 120 | Practical AI for Real Business Problems | — | Strong index candidate |
| /ai-agent-development/ | Commercial | AI agent development services | AI Agent Development for Real Business Workflows \| Your AI Department | We build AI agents for lead response, customer service, and internal knowledge — connected to your systems, wi… | self ✓ | Yes | 120 | AI Agents Built for Real Business Workflows | BreadcrumbList, ListItem | Strong index candidate |
| /ai-assessment/ | Conversion | AI assessment options | AI Department Assessment — Choose Your Assessment \| Your AI Department | Two ways to assess your business: the free 3-4 minute AI Opportunity Assessment for a fast score, or the $495 … | self ✓ | Yes | 120 | Choose Your Assessment | — | Strong index candidate |
| /ai-assessment/full/ | Intentionally noindex (internal engine) |  | Full AI Department Assessment — 64-Question Business Diagnostic \| Your AI Department | Take the complete free AI Department Assessment: a 64-question diagnostic across leadership, marketing, sales,… | — | No | 0 | Find Out Where AI Can Actually Improve Your Business. | — | Intentionally noindex |
| /ai-assessment/results/ | Intentionally noindex (private utility) |  | Your AI Department Score \| Your AI Department | Your personalized AI Department Score, category breakdown, and recommended next steps. | — | No | 0 | MISSING | — | Intentionally noindex |
| /ai-crm-integration/ | Commercial | AI CRM integration services | AI + CRM Integration \| Your AI Department | Connect AI-assisted intake, summaries, and follow-up to your existing CRM — without replacing it. Human review… | self ✓ | Yes | 120 | Connect AI Tools to the CRM You Already Use | BreadcrumbList, ListItem | Strong index candidate |
| /ai-department-audit/ | Redirect (retired) |  | Redirecting to: /comprehensive-ai-business-audit/ |  | — | No | 0 | MISSING | — | Redirect (correctly excluded) |
| /ai-recruiting-automation/ | Commercial | AI recruiting automation | Build a Better Recruiting System With AI \| Your AI Department | AI-assisted applicant intake, screening, and interview scheduling that reduces recruiting friction — while hir… | self ✓ | Yes | 120 | Build a Better Recruiting System With AI | BreadcrumbList, ListItem | Strong index candidate |
| /ai-training/ | Commercial | AI training for employees | AI Training for Businesses \| Your AI Department | Role-specific AI training that helps employees use AI safely and productively inside real workflows — so tools… | self ✓ | Yes | 120 | Help Your Team Use AI Safely, Practically, and Productively | — | Strong index candidate |
| /ai-workshops/ | Commercial | AI workshops for business | AI Workshops for Business Teams \| Your AI Department | Practical AI workshops built around your business for executives, departments, and teams that want to identify… | self ✓ | Yes | 120 | Practical AI Workshops Built Around Your Business | — | Strong index candidate |
| /booking-confirmed/ | Intentionally noindex (private utility) |  | Booking Confirmed \| Your AI Department | Your appointment with Your AI Department is confirmed. | — | No | 0 | You're All Set | — | Intentionally noindex |
| /conversion-tracking-analytics/ | Commercial | conversion tracking and attribution | Conversion Tracking & Revenue Attribution \| Your AI Department | Connect Google Tag Manager, GA4, Google Ads, your CRM, and completed revenue into one measurable system — with… | self ✓ | Yes | 120 | Connect Marketing Activity to Actual Business Outcomes | BreadcrumbList, ListItem | Strong index candidate |
| /crm-setup-automation/ | Commercial | CRM setup and automation | CRM Setup & Automation \| Your AI Department | CRM automation built around how you actually sell: pipeline architecture, lifecycle stages, and task automatio… | self ✓ | Yes | 120 | A CRM Architecture Built for How You Actually Sell | BreadcrumbList, ListItem | Strong index candidate |
| /executive-ai-coaching/ | Commercial | executive AI coaching | Executive AI Coaching \| Your AI Department | One-on-one AI coaching for business owners, CEOs, and senior leaders who want to understand AI, make better te… | self ✓ | Yes | 120 | Become the AI Leader Your Company Needs | — | Strong index candidate |
| /google-ads/ | Commercial | Google Ads management | Google Ads Management for Growth-Focused Businesses \| Your AI Department | Turn Google Ads into a measurable revenue system with better tracking, stronger landing pages, faster lead res… | self ✓ | Yes | 120 | Turn Google Ads Into a Measurable Revenue System | — | Strong index candidate |
| /industries/ | Industry | AI by industry | Industries We Serve \| Your AI Department | Explore AI and automation systems built for your industry, from home services and real estate to enterprise se… | self ✓ | Yes | 120 | Industries We Serve | — | Strong index candidate |
| /industries/automotive-dealers/ | Industry | AI for automotive dealers | AI Systems for Automotive Dealer Groups \| Your AI Department | For multi-rooftop dealer groups: one coordinated AI-assisted operation connecting CRM, DMS, phone, scheduling,… | self ✓ | Yes | 120 | AI Systems for Modern Automotive Dealer Groups | BreadcrumbList, ListItem | Strong index candidate |
| /industries/defense-aerospace/ | Industry | AI for defense and aerospace | Enterprise AI Systems for Defense and Aerospace Operations \| Your AI Department | Practical AI for legitimate defense and aerospace enterprise operations — internal knowledge, training, and do… | self ✓ | Yes | 120 | Enterprise AI Systems for Defense and Aerospace Operations | BreadcrumbList, ListItem | Strong index candidate |
| /industries/ecommerce/ | Industry | AI for e-commerce brands | AI Systems for E-commerce Brands \| Your AI Department | Connect the full e-commerce lifecycle — acquisition, lifecycle marketing, support, and merchandising — with AI… | self ✓ | Yes | 120 | AI Systems for E-commerce Brands | BreadcrumbList, ListItem | Strong index candidate |
| /industries/electrical-contractors/ | Industry | AI for electrical contractors | AI Systems for Growing Electrical Contractors \| Your AI Department | Urgent service calls and quoted projects need different systems. Classify electrical leads fast, follow up eve… | self ✓ | Yes | 120 | AI Systems for Growing Electrical Contractors | BreadcrumbList, ListItem | Strong index candidate |
| /industries/energy/ | Industry | AI for energy companies | Enterprise AI Systems for Energy Organizations \| Your AI Department | Practical AI for energy organizations across internal knowledge, field operations support, document workflows,… | self ✓ | Yes | 120 | Enterprise AI Systems for Energy Organizations | BreadcrumbList, ListItem | Strong index candidate |
| /industries/fiber-broadband/ | Industry | AI for fiber and broadband providers | AI Systems for Fiber and Broadband Growth \| Your AI Department | Territory launches, door-to-door lead capture, installation scheduling, and rep attribution for fiber and broa… | self ✓ | Yes | 120 | AI Systems for Fiber and Broadband Growth | BreadcrumbList, ListItem | Strong index candidate |
| /industries/financial-services/ | Industry | AI consulting for financial services | Responsible AI Systems for Financial Services \| Your AI Department | Design AI systems for financial-services organizations around business value, data controls, human oversight, … | self ✓ | Yes | 120 | Responsible AI Systems for Financial Services | BreadcrumbList, ListItem | Strong index candidate |
| /industries/garage-door-companies/ | Industry | AI for garage door companies | AI Systems for Garage Door Companies \| Your AI Department | Improve call handling, missed-call recovery, and same-day scheduling for garage door service and installation … | self ✓ | Yes | 120 | AI Systems for Garage Door Companies | BreadcrumbList, ListItem | Strong index candidate |
| /industries/healthcare/ | Industry | AI consulting for healthcare organizations | AI Consulting & Business Transformation for Healthcare Organizations \| Your AI Department | Free up healthcare administrative staff — not clinical judgment — with AI-assisted scheduling, documentation, … | self ✓ | Yes | 120 | Practical AI for Healthcare Administrative and Operational Systems | — | Strong index candidate |
| /industries/home-services/ | Industry | AI for home service companies | AI Systems for Home Service Companies \| Your AI Department | A shared operating-system view of lead response, booking, dispatch, and attribution across home-service trades… | self ✓ | Yes | 120 | AI Systems for Home Service Companies | BreadcrumbList, ListItem | Strong index candidate |
| /industries/insurance/ | Industry | AI consulting for insurance companies | AI Consulting & Automation for Insurance Companies \| Your AI Department | Support policyholder communication, claims workflows, and document processing with AI — while every judgment c… | self ✓ | Yes | 120 | AI-Assisted Workflows for Insurance Operations | — | Strong index candidate |
| /industries/landscaping-outdoor-living/ | Industry | AI for landscaping companies | AI Systems for Landscaping and Outdoor Living Companies \| Your AI Department | Connect lead response, design consultations, estimate follow-up, and marketing attribution for landscaping, ha… | self ✓ | Yes | 120 | AI Systems for Landscaping and Outdoor Living Companies | BreadcrumbList, ListItem | Strong index candidate |
| /industries/logistics-transportation/ | Industry | AI for logistics companies | AI Systems for Logistics and Transportation Operations \| Your AI Department | Dispatch support, customer communication, document processing, and reporting for transportation operations — w… | self ✓ | Yes | 120 | AI Systems for Logistics and Transportation Operations | BreadcrumbList, ListItem | Strong index candidate |
| /industries/manufacturing/ | Industry | AI consulting for manufacturing companies | AI Consulting & Automation for Manufacturing Companies \| Your AI Department | Speed up manufacturing RFQ response and quoting with AI-assisted document workflows and reporting — while engi… | self ✓ | Yes | 120 | AI-Assisted Workflows for Manufacturing Sales and Operations | — | Strong index candidate |
| /industries/pest-control/ | Industry | AI for pest control companies | AI Systems for Growing Pest Control Companies \| Your AI Department | Recurring revenue starts with the first call: AI-assisted booking, retention reminders, and reactivation built… | self ✓ | Yes | 120 | AI Systems for Growing Pest Control Companies | BreadcrumbList, ListItem | Strong index candidate |
| /industries/plumbing/ | Industry | AI for plumbing companies | AI Systems for Modern Plumbing Companies \| Your AI Department | Every missed call is a booked job for a competitor. Capture more plumbing calls, recover missed ones, dispatch… | self ✓ | Yes | 120 | AI Systems for Modern Plumbing Companies | BreadcrumbList, ListItem | Strong index candidate |
| /industries/pool-companies/ | Industry | AI for pool companies | AI Systems for Growing Pool Companies \| Your AI Department | Connect lead response, estimate follow-up, scheduling, and marketing attribution for pool builders and service… | self ✓ | Yes | 120 | AI Systems for Growing Pool Companies | BreadcrumbList, ListItem | Strong index candidate |
| /industries/property-management/ | Industry | AI for property management companies | AI Systems for Modern Property Management Companies \| Your AI Department | Improve leasing response, maintenance intake, vendor coordination, and resident communication for property man… | self ✓ | Yes | 120 | AI Systems for Modern Property Management Companies | BreadcrumbList, ListItem | Strong index candidate |
| /industries/real-estate/ | Industry | AI for real estate teams | AI Systems for Modern Real Estate Organizations \| Your AI Department | Turn portal leads, database contacts, and past clients into a coordinated lead-response, follow-up, and market… | self ✓ | Yes | 120 | AI Systems for Modern Real Estate Organizations | BreadcrumbList, ListItem | Strong index candidate |
| /industries/restoration-emergency-services/ | Industry | AI for restoration companies | AI Systems for Restoration and Emergency Response \| Your AI Department | 24/7 intake, catastrophe routing, dispatch coordination, and marketing attribution for restoration and emergen… | self ✓ | Yes | 120 | AI Systems for Restoration and Emergency Response | BreadcrumbList, ListItem | Strong index candidate |
| /industries/screen-enclosure-companies/ | Industry | AI for screen enclosure companies | AI Systems for Screen Enclosure Companies \| Your AI Department | Connect lead response, site-visit scheduling, estimate follow-up, and marketing attribution for screen enclosu… | self ✓ | Yes | 120 | AI Systems for Screen Enclosure Companies | BreadcrumbList, ListItem | Strong index candidate |
| /industries/solar/ | Industry | AI for solar companies | AI Systems for Modern Solar Companies \| Your AI Department | Connect field sales, lead response, appointment setting, and marketing attribution for solar companies with co… | self ✓ | Yes | 120 | AI Systems for Modern Solar Companies | BreadcrumbList, ListItem | Strong index candidate |
| /meta-ads/ | Commercial | Meta Ads management | Meta and Facebook Ads Management \| Your AI Department | Turn Meta advertising into a complete customer acquisition system with better creative, tracking, landing page… | self ✓ | Yes | 120 | Turn Meta Advertising Into a Complete Customer Acquisition System | — | Strong index candidate |
| /privacy/ | Commercial | privacy policy | Privacy Policy \| Your AI Department | How Your AI Department LLC collects, uses, and protects information submitted through this website, including … | self ✓ | Yes | 120 | Privacy Policy | — | Strong index candidate |
| /seo/ | Commercial | SEO services | SEO Services for Business \| Your AI Department | SEO that generates qualified leads rather than vanity rankings — technical foundations, content strategy, and … | self ✓ | Yes | 120 | Build Long-Term Search Visibility That Generates Qualified Leads | — | Strong index candidate |
| /terms/ | Commercial | terms of use | Terms of Use \| Your AI Department | Terms governing use of the Your AI Department website, the AI Department Assessment, and scheduling requests m… | self ✓ | Yes | 120 | Terms of Use | — | Strong index candidate |

## TIER 4 — Resources hub + cornerstone resources

| Route | Type | Primary keyword | Title | Meta description (truncated) | Canonical | Sitemap? | Inbound | H1 | Schema | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| /resources/ | Informational/resource | resources | Resources \| Your AI Department | Practical guides on identifying AI opportunities, lead response, marketing attribution, and where automation d… | self ✓ | Yes | 120 | Practical Guides for Business Leaders Evaluating AI | — | Strong index candidate |

## TIER 5 — Long-tail resources

| Route | Type | Primary keyword | Title | Meta description (truncated) | Canonical | Sitemap? | Inbound | H1 | Schema | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| /resources/ai-assisted-phone-screening-for-job-applicants/ | Informational/resource | ai-assisted phone screening for job applicants | AI-Assisted Phone Screening for Job Applicants \| Your AI Department | Can AI conduct an initial phone screening with job applicants? Here's what that actually looks like when it's … | self ✓ | Yes | 3 | AI-Assisted Phone Screening for Job Applicants | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-customer-service-for-ecommerce/ | Informational/resource | ai customer service for e-commerce: what should be automated | AI Customer Service for E-commerce: What Should Be Automated? \| Your AI Department | AI can handle many repetitive e-commerce support interactions. Here's how to distinguish routine information f… | self ✓ | Yes | 4 | AI Customer Service for E-commerce: What Should Be Automated? | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-follow-up-for-fiber-door-to-door-sales/ | Informational/resource | ai follow-up for fiber door-to-door sales | AI Follow-Up for Fiber Door-to-Door Sales \| Your AI Department | Door-to-door fiber interest needs to become structured customer data immediately. Here's how to build follow-u… | self ✓ | Yes | 4 | AI Follow-Up for Fiber Door-to-Door Sales | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-follow-up-for-pool-estimates/ | Informational/resource | ai follow-up for pool estimates and unsold quotes | AI Follow-Up for Pool Estimates and Unsold Quotes \| Your AI Department | A sent pool estimate isn't a closed deal or a lost one — it's an open decision. Here's how to build follow-up … | self ✓ | Yes | 4 | AI Follow-Up for Pool Estimates and Unsold Quotes | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-follow-up-for-solar-leads/ | Informational/resource | ai follow-up for solar leads | AI Follow-Up for Solar Leads \| Your AI Department | High solar lead volume creates little value if follow-up is inconsistent. Here's how AI can support structured… | self ✓ | Yes | 4 | AI Follow-Up for Solar Leads | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-for-24-7-restoration-lead-intake/ | Informational/resource | ai for 24/7 restoration lead intake | AI for 24/7 Restoration Lead Intake \| Your AI Department | Emergency restoration calls don't wait for business hours. Here's how AI-assisted intake can capture urgent in… | self ✓ | Yes | 4 | AI for 24/7 Restoration Lead Intake | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-for-door-to-door-solar-sales-follow-up/ | Informational/resource | ai for door-to-door solar sales follow-up | AI for Door-to-Door Solar Sales Follow-Up \| Your AI Department | Field canvassing loses value when interested homeowners are captured inconsistently. Here's how to connect doo… | self ✓ | Yes | 4 | AI for Door-to-Door Solar Sales Follow-Up | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-for-energy-document-and-field-workflow-automation/ | Informational/resource | ai for energy document and field-workflow automation | AI for Energy Document and Field-Workflow Automation \| Your AI Department | AI can reduce the repetitive administrative work around field operations by organizing documents and status in… | self ✓ | Yes | 4 | AI for Energy Document and Field-Workflow Automation | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-for-energy-knowledge-management-and-internal-operations/ | Informational/resource | ai for energy knowledge management and internal operations | AI for Energy Knowledge Management and Internal Operations \| Your AI Department | Energy organizations hold critical knowledge across manuals, procedures, and experienced employees. Here's how… | self ✓ | Yes | 4 | AI for Energy Knowledge Management and Internal Operations | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-for-fiber-installation-scheduling/ | Informational/resource | ai for fiber installation scheduling and no-show recovery | AI for Fiber Installation Scheduling and No-Show Recovery \| Your AI Department | Fiber customer acquisition doesn't end at the signed agreement. Here's how to manage installation scheduling, … | self ✓ | Yes | 4 | AI for Fiber Installation Scheduling and No-Show Recovery | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-for-financial-services-document-and-knowledge-workflows/ | Informational/resource | ai for financial services document and knowledge workflows | AI for Financial Services Document and Knowledge Workflows \| Your AI Department | Financial-services organizations spend significant time locating information and reviewing documents. Here's h… | self ✓ | Yes | 4 | AI for Financial Services Document and Knowledge Workflows | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-for-logistics-document-processing-and-back-office-automation/ | Informational/resource | ai for logistics document processing and back-office automation | AI for Logistics Document Processing and Back-Office Automation \| Your AI Department | Transportation operations involve constant document handling. Here's how AI can reduce the repetitive administ… | self ✓ | Yes | 4 | AI for Logistics Document Processing and Back-Office Automation | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-for-pest-control-call-handling-and-booking/ | Informational/resource | ai for pest control call handling and booking | AI for Pest Control Call Handling and Booking \| Your AI Department | Pest control calls are often repetitive and high-intent at once. Here's what AI-assisted intake can handle saf… | self ✓ | Yes | 4 | AI for Pest Control Call Handling and Booking | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-for-property-management-customer-communication/ | Informational/resource | ai for property management customer communication | AI for Property Management Customer Communication \| Your AI Department | Property management involves huge amounts of repetitive communication. Here's how to automate the routine part… | self ✓ | Yes | 4 | AI for Property Management Customer Communication and Human Escalation | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-for-property-management-maintenance-request-intake/ | Informational/resource | ai for property management maintenance request intake | AI for Property Management Maintenance Request Intake \| Your AI Department | Maintenance automation works best when AI organizes information and coordinates the workflow, rather than tryi… | self ✓ | Yes | 4 | AI for Property Management Maintenance Request Intake | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-for-screen-enclosure-lead-qualification-and-scheduling/ | Informational/resource | ai for screen enclosure lead qualification and scheduling | AI for Screen Enclosure Lead Qualification and Scheduling \| Your AI Department | Not every screen enclosure inquiry needs the same next step. Here's how AI-assisted intake can organize projec… | self ✓ | Yes | 4 | AI for Screen Enclosure Lead Qualification and Site-Visit Scheduling | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-for-transportation-dispatch-and-operational-communication/ | Informational/resource | ai for transportation dispatch and operational communication | AI for Transportation Dispatch and Operational Communication \| Your AI Department | Dispatch teams spend enormous time moving information between drivers, customers, and business systems. Here's… | self ✓ | Yes | 4 | AI for Transportation Dispatch and Operational Communication | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-governance-for-financial-services-organizations/ | Informational/resource | ai governance for financial services organizations | AI Governance for Financial Services Organizations \| Your AI Department | AI governance isn't a policy document that sits on a shelf. Here's the operating system that actually defines … | self ✓ | Yes | 4 | AI Governance for Financial Services Organizations | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-knowledge-management-for-aerospace-and-defense-organizations/ | Informational/resource | ai knowledge management for aerospace and defense organizations | AI Knowledge Management for Aerospace and Defense Organizations \| Your AI Department | Large technical organizations often struggle to make approved knowledge easy to find. Here's how AI-assisted r… | self ✓ | Yes | 4 | AI Knowledge Management for Aerospace and Defense Organizations | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-lead-follow-up-for-landscaping-companies/ | Informational/resource | ai lead follow-up for landscaping companies | AI Lead Follow-Up for Landscaping Companies \| Your AI Department | High-value landscaping and outdoor-living leads require consultation, design, and multiple conversations. Here… | self ✓ | Yes | 4 | AI Lead Follow-Up for Landscaping and Outdoor Living Companies | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-lead-response-for-electrical-contractors/ | Informational/resource | ai lead response for electrical contractors | AI Lead Response for Electrical Contractors \| Your AI Department | Electrical contractors field very different kinds of opportunities through the same intake. Here's how to sepa… | self ✓ | Yes | 4 | AI Lead Response for Electrical Contractors | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-lead-response-for-real-estate-teams/ | Informational/resource | ai lead response for real estate teams | AI Lead Response for Real Estate Teams \| Your AI Department | Real estate lead response quality often depends on which agent happens to be free. Here's how AI can support f… | self ✓ | Yes | 4 | AI Lead Response for Real Estate Teams | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-phone-answering-and-missed-call-recovery-for-plumbers/ | Informational/resource | ai phone answering and missed-call recovery for plumbers | AI Phone Answering and Missed-Call Recovery for Plumbers \| Your AI Department | Plumbing demand is immediate, and an unanswered call often just means the next company gets the job. Here's ho… | self ✓ | Yes | 4 | AI Phone Answering and Missed-Call Recovery for Plumbing Companies | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/ai-phone-handling-for-garage-door-companies/ | Informational/resource | ai phone handling for garage door companies | AI Phone Handling for Garage Door Companies \| Your AI Department | Garage door calls are often high-intent and time-sensitive. Here's how AI-assisted answering and missed-call r… | self ✓ | Yes | 4 | AI Phone Handling and Missed-Call Recovery for Garage Door Companies | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/automating-estimate-follow-up-for-outdoor-living-projects/ | Informational/resource | automating estimate follow-up for outdoor living projects | Automating Estimate Follow-Up for Outdoor Living Projects \| Your AI Department | Outdoor living projects involve long consideration cycles and competing bids. Here's how to keep follow-up con… | self ✓ | Yes | 4 | Automating Estimate Follow-Up for Outdoor Living Projects | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/automating-garage-door-replacement-estimate-follow-up/ | Informational/resource | automating garage door replacement estimate follow-up | Automating Garage Door Replacement Estimate Follow-Up \| Your AI Department | Replacement estimates involve style, material, and budget decisions that take time. Here's how structured foll… | self ✓ | Yes | 4 | Automating Garage Door Replacement Estimate Follow-Up | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/automating-leasing-inquiry-response-and-showing-scheduling/ | Informational/resource | automating leasing inquiry response and showing scheduling | Automating Leasing Inquiry Response and Showing Scheduling \| Your AI Department | Leasing inquiries arrive at any hour, while leasing teams have limited availability. Here's how to improve res… | self ✓ | Yes | 4 | Automating Leasing Inquiry Response and Showing Scheduling | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/building-governed-ai-systems-for-defense-and-aerospace/ | Informational/resource | building governed ai systems for defense and aerospace | Building Governed AI Systems for Defense and Aerospace \| Your AI Department | In sensitive operating environments, successful AI implementation depends as much on architecture and governan… | self ✓ | Yes | 4 | Building Governed AI Systems for Defense and Aerospace Operations | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-ai-can-recover-missed-calls-for-home-service-companies/ | Informational/resource | how ai can recover missed calls for home service companies | How AI Can Recover Missed Calls for Home Service Companies \| Your AI Department | Home service companies can spend heavily generating calls and still lose jobs when staff can't answer every on… | self ✓ | Yes | 4 | How AI Can Recover Missed Calls for Home Service Companies | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-brokerages-can-track-lead-sources-to-closings/ | Informational/resource | how brokerages can track lead sources to closings | How Brokerages Can Track Lead Sources to Closings \| Your AI Department | Real estate organizations often know where a lead started but lose that attribution long before closing. Here'… | self ✓ | Yes | 4 | How Brokerages Can Track Lead Sources to Closings | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-ecommerce-brands-can-connect-ad-spend-to-customer-revenue/ | Informational/resource | how e-commerce brands can connect ad spend to customer revenue | How E-commerce Brands Can Connect Ad Spend to Customer Revenue \| Your AI Department | E-commerce acquisition should be evaluated beyond a single front-end conversion. Here's how to connect adverti… | self ✓ | Yes | 4 | How E-commerce Brands Can Connect Ad Spend to Customer Revenue | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-electrical-companies-can-track-marketing-to-closed-jobs/ | Informational/resource | how electrical companies can track marketing to closed jobs | How Electrical Companies Can Track Marketing to Closed Jobs \| Your AI Department | Not all electrical leads are equal. Here's how to measure marketing performance by the jobs and projects it ac… | self ✓ | Yes | 4 | How Electrical Companies Can Track Marketing to Closed Jobs | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-electrical-contractors-can-automate-estimate-follow-up/ | Informational/resource | how electrical contractors can automate estimate follow-up | How Electrical Contractors Can Automate Estimate Follow-Up \| Your AI Department | Quoted electrical work stalls when follow-up depends entirely on memory. Here's how to build a consistent proc… | self ✓ | Yes | 4 | How Electrical Contractors Can Automate Estimate Follow-Up | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-garage-door-companies-can-track-advertising-leads-to-revenue/ | Informational/resource | how garage door companies can track advertising leads to revenue | How Garage Door Companies Can Track Advertising Leads to Revenue \| Your AI Department | A garage door company should distinguish between ad clicks, booked service, and completed repair or replacemen… | self ✓ | Yes | 4 | How Garage Door Companies Can Track Advertising Leads to Revenue | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-home-service-companies-can-automate-estimate-follow-up/ | Informational/resource | how home service companies can automate estimate follow-up | How Home Service Companies Can Automate Estimate Follow-Up \| Your AI Department | Many home service companies generate significant quoted work but lack a consistent follow-up process. Here's h… | self ✓ | Yes | 4 | How Home Service Companies Can Automate Estimate Follow-Up | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-home-service-companies-can-track-marketing-leads-to-revenue/ | Informational/resource | how home service companies can track marketing leads to revenue | How Home Service Companies Can Track Marketing Leads to Revenue \| Your AI Department | Home service marketing should be measured beyond clicks, calls, and form fills. Here's how to build a measurem… | self ✓ | Yes | 4 | How Home Service Companies Can Track Marketing Leads to Revenue | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-landscaping-companies-can-track-marketing-to-signed-projects/ | Informational/resource | how landscaping companies can track marketing to signed projects | How Landscaping Companies Can Track Marketing to Signed Projects \| Your AI Department | A landscaping business should know which marketing sources actually produce serious consultations and signed p… | self ✓ | Yes | 4 | How Landscaping Companies Can Track Marketing to Signed Projects | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-pest-control-companies-can-improve-retention-with-automation/ | Informational/resource | how pest control companies can improve retention with automation | How Pest Control Companies Can Improve Retention With Automation \| Your AI Department | Recurring pest-control economics depend on more than the first appointment. Here's how automation can support … | self ✓ | Yes | 4 | How Pest Control Companies Can Improve Customer Retention With Automation | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-pest-control-companies-can-track-marketing-to-recurring-customers/ | Informational/resource | how pest control companies can track marketing to recurring customers | How Pest Control Companies Can Track Marketing to Recurring Customers \| Your AI Department | A pest control lead becomes far more valuable once it turns into a recurring account. Here's how to measure ma… | self ✓ | Yes | 4 | How Pest Control Companies Can Track Marketing to Recurring Customers | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-plumbing-companies-can-automate-estimate-follow-up/ | Informational/resource | how plumbing companies can automate estimate follow-up | How Plumbing Companies Can Automate Estimate Follow-Up \| Your AI Department | Water heaters, repipes, and remodels often need more than one conversation to close. Here's how structured fol… | self ✓ | Yes | 4 | How Plumbing Companies Can Automate Estimate Follow-Up | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-plumbing-companies-can-track-google-ads-leads-to-revenue/ | Informational/resource | how plumbing companies can track google ads leads to revenue | How Plumbing Companies Can Track Google Ads Leads to Revenue \| Your AI Department | Google Ads reporting for a plumbing company should connect all the way to booked, dispatched, and completed wo… | self ✓ | Yes | 4 | How Plumbing Companies Can Track Google Ads Leads to Revenue | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-pool-companies-can-respond-to-leads-faster/ | Informational/resource | how pool companies can respond to leads faster | How Pool Companies Can Respond to Leads Faster \| Your AI Department | Pool companies lose signed projects to slow response, not just weak marketing. Here's how to build a faster, m… | self ✓ | Yes | 4 | How Pool Companies Can Respond to Leads Faster | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-pool-companies-can-track-google-ads-to-signed-projects/ | Informational/resource | how pool companies can track google ads leads to signed projects | How Pool Companies Can Track Google Ads Leads to Signed Projects \| Your AI Department | Lead counts don't tell you which Google Ads campaigns actually produce signed pool projects. Here's how to bui… | self ✓ | Yes | 4 | How Pool Companies Can Track Google Ads Leads to Signed Projects | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-real-estate-teams-can-reactivate-old-leads/ | Informational/resource | how real estate teams can reactivate old leads | How Real Estate Teams Can Reactivate Old Leads \| Your AI Department | Brokerages often sit on years of poorly-segmented contacts. Here's how to organize and prioritize re-engagemen… | self ✓ | Yes | 4 | How Real Estate Teams Can Reactivate Old Leads | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-restoration-companies-can-improve-emergency-lead-response/ | Informational/resource | how restoration companies can improve emergency lead response | How Restoration Companies Can Improve Emergency Lead Response \| Your AI Department | Restoration response failures usually happen between systems and teams, not inside one department. Here's how … | self ✓ | Yes | 4 | How Restoration Companies Can Improve Emergency Lead Response | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-restoration-companies-can-track-leads-to-jobs-and-revenue/ | Informational/resource | how restoration companies can track leads to jobs and revenue | How Restoration Companies Can Track Leads to Jobs and Revenue \| Your AI Department | Restoration marketing should be evaluated by qualified jobs and revenue, not calls or form fills alone. Here's… | self ✓ | Yes | 4 | How Restoration Companies Can Track Marketing Leads to Jobs and Revenue | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-screen-enclosure-companies-can-automate-estimate-follow-up/ | Informational/resource | how screen enclosure companies can automate estimate follow-up | How Screen Enclosure Companies Can Automate Estimate Follow-Up \| Your AI Department | An estimate doesn't create revenue by itself. Here's how screen enclosure contractors can build follow-up that… | self ✓ | Yes | 4 | How Screen Enclosure Companies Can Automate Estimate Follow-Up | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-screen-enclosure-companies-can-track-google-ads-to-projects/ | Informational/resource | how screen enclosure companies can track leads to signed projects | How Screen Enclosure Companies Can Track Leads to Signed Projects \| Your AI Department | A form fill or phone call isn't the final business outcome. Here's how to connect Google Ads spend to site vis… | self ✓ | Yes | 4 | How Screen Enclosure Companies Can Track Google Ads Leads to Signed Projects | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-solar-companies-can-track-marketing-to-closed-customers/ | Informational/resource | how solar companies can track marketing spend to closed customers | How Solar Companies Can Track Marketing Spend to Closed Customers \| Your AI Department | Cost per lead doesn't tell a solar company which campaigns actually produce closed customers. Here's how to bu… | self ✓ | Yes | 4 | How Solar Companies Can Track Marketing Spend to Closed Customers | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-to-automate-candidate-interview-scheduling/ | Informational/resource | how to automate candidate interview scheduling | How to Automate Candidate Interview Scheduling \| Your AI Department | Interview scheduling is operational work that can be automated without automating the hiring decision itself. … | self ✓ | Yes | 3 | How to Automate Candidate Interview Scheduling | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-to-identify-high-value-ai-opportunities/ | Informational/resource | how to identify high-value ai opportunities in your business | How to Identify High-Value AI Opportunities in Your Business \| Your AI Department | The best AI opportunities aren't the most technically impressive ones. Here's a practical framework for findin… | self ✓ | Yes | 4 | How to Identify High-Value AI Opportunities in Your Business | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-to-track-fiber-sales-by-territory-rep-and-campaign/ | Informational/resource | how to track fiber sales by territory, rep, and campaign | How to Track Fiber Sales by Territory, Rep, and Campaign \| Your AI Department | Fiber expansion creates overlapping acquisition channels. Here's how to build reporting that shows which terri… | self ✓ | Yes | 4 | How to Track Fiber Sales by Territory, Rep, and Campaign | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/how-to-track-google-ads-leads-to-revenue/ | Informational/resource | how to track google ads leads all the way to revenue | How to Track Google Ads Leads All the Way to Revenue \| Your AI Department | Clicks and form submissions aren't the final business outcome. Here's how to connect Google Ads activity to qu… | self ✓ | Yes | 14 | How to Track Google Ads Leads All the Way to Revenue | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/what-business-processes-should-not-be-automated/ | Informational/resource | what business processes should not be automated | What Business Processes Should Not Be Automated? \| Your AI Department | Automation isn't automatically beneficial. Here's how to think about which parts of a process should stay with… | self ✓ | Yes | 3 | What Business Processes Should Not Be Automated? | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/where-ai-fits-in-recruiting-and-where-humans-must-decide/ | Informational/resource | where ai fits in recruiting and where humans must decide | Where AI Fits in Recruiting and Where Humans Must Decide \| Your AI Department | AI can help with the repetitive coordination in recruiting. Here's exactly which parts of the workflow it can … | self ✓ | Yes | 3 | Where AI Fits in Recruiting and Where Humans Must Decide | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/where-defense-and-aerospace-companies-should-start-with-enterprise-ai/ | Informational/resource | where defense and aerospace companies should start with ai | Where Defense and Aerospace Companies Should Start With AI \| Your AI Department | Defense and aerospace organizations should begin with approved business and knowledge workflows, never the hig… | self ✓ | Yes | 4 | Where Defense and Aerospace Companies Should Start With Enterprise AI | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/where-ecommerce-brands-should-start-with-ai/ | Informational/resource | where e-commerce brands should start with ai | Where E-commerce Brands Should Start With AI \| Your AI Department | E-commerce has dozens of possible AI use cases. Here's a practical framework for choosing where to actually st… | self ✓ | Yes | 4 | Where E-commerce Brands Should Start With AI | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/where-energy-companies-should-start-with-ai/ | Informational/resource | where energy companies should start with ai | Where Energy Companies Should Start With AI \| Your AI Department | Energy organizations should start with controlled business workflows, not safety-critical operations. Here's a… | self ✓ | Yes | 4 | Where Energy Companies Should Start With AI | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/where-financial-services-firms-should-start-with-ai/ | Informational/resource | where financial services firms should start with ai | Where Financial Services Firms Should Start With AI \| Your AI Department | Financial-services AI adoption shouldn't start with picking a model. Here's how to identify a business workflo… | self ✓ | Yes | 4 | Where Financial Services Firms Should Start With AI | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/where-logistics-companies-should-start-with-ai/ | Informational/resource | where logistics companies should start with ai | Where Logistics Companies Should Start With AI \| Your AI Department | Logistics companies should start with high-friction administrative workflows, not autonomous operations. Here'… | self ✓ | Yes | 4 | Where Logistics Companies Should Start With AI | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/where-should-a-business-start-with-ai/ | Informational/resource | where should a business start with ai | Where Should a Business Start With AI? \| Your AI Department | Most companies start with the wrong question. Here's a practical framework for identifying where AI actually b… | self ✓ | Yes | 4 | Where Should a Business Start With AI? | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |
| /resources/why-speed-to-lead-matters/ | Informational/resource | why speed-to-lead matters — and how to build a better response system | Why Speed-to-Lead Matters — and How to Build a Better Response System \| Your AI Department | Generating a lead is only the beginning. Here's how to think about building a lead-response system that doesn'… | self ✓ | Yes | 17 | Why Speed-to-Lead Matters — and How to Build a Better Response System | Article, BreadcrumbList, ListItem, Organization | Strong index candidate |

## NOINDEX / REDIRECT / UTILITY (intentionally excluded)

| Route | Type | Primary keyword | Title | Meta description (truncated) | Canonical | Sitemap? | Inbound | H1 | Schema | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| /404.html | Error/utility |  | Page Not Found \| Your AI Department | The page you're looking for could not be found. | — | No | 0 | We Couldn't Find That Page | — | Intentionally noindex |
| /ai-assessment/full/ | Intentionally noindex (internal engine) |  | Full AI Department Assessment — 64-Question Business Diagnostic \| Your AI Department | Take the complete free AI Department Assessment: a 64-question diagnostic across leadership, marketing, sales,… | — | No | 0 | Find Out Where AI Can Actually Improve Your Business. | — | Intentionally noindex |
| /ai-assessment/results/ | Intentionally noindex (private utility) |  | Your AI Department Score \| Your AI Department | Your personalized AI Department Score, category breakdown, and recommended next steps. | — | No | 0 | MISSING | — | Intentionally noindex |
| /ai-department-audit/ | Redirect (retired) |  | Redirecting to: /comprehensive-ai-business-audit/ |  | — | No | 0 | MISSING | — | Redirect (correctly excluded) |
| /booking-confirmed/ | Intentionally noindex (private utility) |  | Booking Confirmed \| Your AI Department | Your appointment with Your AI Department is confirmed. | — | No | 0 | You're All Set | — | Intentionally noindex |

---

# DUPLICATE-INTENT CLUSTERS (watchlist — do not merge without strategy)

No cannibalizing duplicate intent was found. Adjacent-intent pairs to keep
differentiated:

1. `/ai-consulting/` vs `/` — homepage stays brand-level; consulting page stays
   service-depth. Homepage H1 no longer competes with the assessment pages.
2. `/crm-setup-automation/` vs `/ai-crm-integration/` — platform build vs AI-layer
   integration; distinct titles/descriptions/H1s confirmed.
3. `/free-ai-assessment/` vs `/comprehensive-ai-business-audit/` vs `/ai-assessment/` —
   free tool vs paid audit vs comparison page; distinct intent and copy.
4. `/ai-agent-development/` vs `/ai-implementation/` — agents vs broader
   implementation; watch H2 overlap during future edits.
5. Industry pages vs their trade-specific resources (e.g. `/industries/plumbing/`
   vs `/resources/ai-phone-answering-and-missed-call-recovery-for-plumbers/`) —
   commercial page = service offer; resource = how-to education. Intentional
   cluster pairing, not duplication; linked both directions.

# INTERNAL LINK GRAPH SUMMARY

- Zero indexable pages are true orphans (0 raw inbound links). Using the
  more meaningful **contextual (body-content-only) inbound link**
  metric introduced this pass, one real gap was found and fixed
  (`/ai-workshops/`) — see "Internal crawl-priority analysis" above.
- 18 industry pages now link back to the resource articles that already
  reference them (previously one-directional); 10 industry pages have
  no dedicated resource articles yet (documented, not fabricated).
- Every resource has ≥3 contextual inbound links (hub category cluster +
  reciprocal industry/service link + related-resources card); every
  industry page has ≥2 contextual inbound links (hub card + FAQ/cross-
  link block), on top of nav/footer/mega-menu discovery.
- Crawl depth: Tier 1 pages are 0-1 hops from the homepage (several now
  additionally reinforced by contextual, on-topic links rather than
  chrome alone); industries and services are 1 hop; resources are 2 hops
  (hub) with contextual cross-links from relevant industry/service pages.

# SEARCH INTENT / AI-SEARCH READINESS NOTES

All pages state concrete, factual capabilities (faster lead response, missed-call
recovery, estimate follow-up, CRM automation, attribution) without fabricated
outcomes — consistent with AI-overview citability: clear definitions,
first-person process descriptions, structured H2s, no hype claims.
