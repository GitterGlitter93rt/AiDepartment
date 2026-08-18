# Sprint 12 SEO Fix Plan

This document records known SEO issues discovered before Sprint 12 implementation.

Do not apply source-code fixes against the stale Sprint 8 baseline.

Before implementation:
1. reconcile the latest Sprint 11 production source into Git,
2. confirm Automotive Dealers, current legal pages, current sitemap, 404 handling, GTM/GA4, and other Sprint 9-11 changes are present,
3. then apply these fixes to that latest source.

---

# Live Audit Summary

Live sitemap pages checked: 34

Current live audit results:

- Missing titles: 0
- Duplicate titles: 0
- Missing meta descriptions: 0
- Duplicate meta descriptions: 0
- Missing canonicals: 0
- Pages without exactly one H1: 1
- Meta descriptions under 110 characters: 6
- Meta descriptions over 170 characters: 6

Important:
Description length thresholds are editorial review ranges, not Google rules.

---

# Priority 1 — AI Assessment H1

Affected URL:

/ai-assessment/

Current live page contains zero H1 elements according to the live crawl.

Required fix:

- Add exactly one semantically correct visible H1 to the assessment page.
- Do not add a hidden H1 merely for SEO.
- H1 must accurately describe the page.
- Preserve the assessment UX and visual hierarchy.
- Verify no duplicate H1 is introduced.

Suggested concept:

AI Department Assessment

or a more compelling page-specific version consistent with current visible copy.

Claude should inspect the current production page before choosing final wording.

---

# Priority 2 — Existing Resource Meta Descriptions

These five existing Resources have descriptions that are far too minimal to be useful search snippets.

## High Value AI Opportunities

URL:
/resources/how-to-identify-high-value-ai-opportunities/

Current description length:
approximately 30 characters

Required direction:

Create a specific description explaining that the resource helps businesses identify and prioritize AI opportunities based on business value, workflow fit, feasibility, and implementation considerations.

Suggested draft:

Identify high-value AI opportunities by evaluating business impact, workflow fit, data readiness, implementation complexity, and where human judgment still matters.

Final wording should be reviewed against actual page content.

---

## Google Ads Leads to Revenue

URL:
/resources/how-to-track-google-ads-leads-to-revenue/

Current description length:
approximately 32 characters

Required direction:

Explain the closed-loop measurement journey from advertising through leads, CRM activity, sales outcomes, and revenue.

Suggested draft:

Learn how to connect Google Ads leads to CRM activity, sales outcomes, and revenue so marketing decisions are based on real business results.

Final wording should be reviewed against actual page content.

---

## What Should Not Be Automated

URL:
/resources/what-business-processes-should-not-be-automated/

Current description length:
approximately 14 characters

Required direction:

Explain when businesses should retain human judgment rather than automate a workflow.

Suggested draft:

Learn which business processes should remain human-led and how to evaluate risk, judgment, customer impact, and accountability before using automation.

Final wording should be reviewed against actual page content.

---

## Where Businesses Should Start With AI

URL:
/resources/where-should-a-business-start-with-ai/

Current description length:
approximately 50 characters

Required direction:

Explain the practical starting framework for business AI adoption.

Suggested draft:

A practical framework for deciding where your business should start with AI by focusing on high-value workflows, feasibility, risk, and measurable outcomes.

Final wording should be reviewed against actual page content.

---

## Why Speed to Lead Matters

URL:
/resources/why-speed-to-lead-matters/

Current description length:
approximately 45 characters

Required direction:

Explain why response workflows matter and how businesses can improve them with automation and human follow-up.

Suggested draft:

Learn why lead-response speed matters and how businesses can improve acknowledgment, routing, follow-up, scheduling, and human handoff with better systems.

Final wording should be reviewed against actual page content.

---

# Priority 3 — Roofing Meta Description

URL:
/industries/roofing/

Current description length:
approximately 108 characters

This is not automatically bad.

Required action:

- Review current wording for specificity.
- Rewrite only if a stronger search snippet can better explain:
  - roofing lead response
  - estimate follow-up
  - sales operations
  - marketing attribution
  - AI/automation systems
- Do not pad merely to increase character count.

---

# Priority 4 — Long Meta Description Review

Review, but do not automatically shorten solely because of character count.

Affected pages:

- /
- /google-ads/
- /industries/automotive-dealers/
- /industries/healthcare/
- /industries/insurance/
- /privacy/

Approximate current lengths:

Homepage:
171 characters

Google Ads:
177 characters

Automotive Dealers:
193 characters

Healthcare:
203 characters

Insurance:
192 characters

Privacy:
179 characters

Required review:

- ensure primary value/message appears early
- remove unnecessary filler
- maintain accurate page-specific wording
- target concise useful snippets where possible
- do not treat 170 characters as a hard technical limit
- Privacy may remain longer if clarity is better

Automotive, Healthcare, and Insurance deserve the most attention because their current descriptions are notably long.

---

# Priority 5 — www Canonicalization

Preferred canonical domain:

https://youraidepartment.ai/

Required behavior:

http://youraidepartment.ai/*
→ 301/308
→ https://youraidepartment.ai/*

http://www.youraidepartment.ai/*
→ 301/308
→ https://youraidepartment.ai/*

https://www.youraidepartment.ai/*
→ 301/308
→ https://youraidepartment.ai/*

Requirements:

- preserve the request path
- avoid redirect chains
- use one permanent redirect
- all internal links use non-www HTTPS URLs
- sitemap uses non-www HTTPS URLs
- canonicals use non-www HTTPS URLs

Because Cloudflare is authoritative DNS/proxy infrastructure, implementation may be best handled with Cloudflare redirect rules rather than application code.

Verify final production behavior with curl.

---

# Priority 6 — Favicon

Existing project historically contains:

/public/favicon.ico
/public/favicon.svg

Required action:

- verify both files still exist in latest production source
- verify favicon declarations exist in document head
- use valid rel/icon declarations
- verify browser request returns 200
- do not add unnecessary favicon packages

Example acceptable head declarations:

<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon.ico" sizes="any" />

Use current implementation conventions where possible.

---

# Priority 7 — HSTS / HTTPS Security

Current external report indicated no Strict-Transport-Security header.

Required action:

Verify current production headers first.

If absent and HTTPS is fully working across canonical/subdomains, consider:

Strict-Transport-Security: max-age=31536000; includeSubDomains

Do NOT add preload automatically.

Before enabling includeSubDomains:
- confirm every required subdomain supports HTTPS
- confirm there are no legacy HTTP-only dependencies

Cloudflare may be the appropriate place to configure HSTS.

This is security hardening, not a direct rankings hack.

---

# Priority 8 — Descriptive Internal Anchors

Existing external PageSpeed/SEO testing previously identified generic link text.

Sprint 12 rule:

Avoid generic anchors such as:

- Learn More
- Read More
- Click Here
- See More
- More

Use destination-specific anchors where practical.

Examples:

Explore AI for Collision Repair

Explore AI for Law Firms

Explore AI for Roofing Companies

Explore AI for HVAC Companies

Explore AI for Construction Companies

Explore AI for Professional Services

Explore AI Systems for Pool Companies

Explore AI Systems for Solar Companies

Explore AI for Automotive Dealer Groups

Requirements:

- anchors should sound natural
- avoid keyword stuffing
- card design may retain short CTA styling, but accessible/descriptive link text must communicate destination
- audit all new and existing commercial cards

Important:

The simple Git Bash live crawler reported zero generic links, but earlier PageSpeed testing found six generic links.

Therefore Claude must inspect source and rendered DOM manually rather than assuming this issue is resolved.

---

# Priority 9 — Page Depth

Word count is not a Google ranking requirement.

However, Sprint 12 pages must not be thin.

Editorial review ranges:

Major industry page:
approximately 1,400-2,200 substantive words when warranted

Enterprise/high-complexity industry:
approximately 1,600-2,500 substantive words when warranted

Supporting Resource:
approximately 1,000-1,700 substantive words normally

Major pillar Resource:
approximately 1,500-2,200+ substantive words when warranted

Do not pad.

Depth should come from:

- workflow explanation
- implementation realities
- business process analysis
- system architecture
- human decision boundaries
- data/integration considerations
- management/measurement considerations
- specific examples
- FAQs
- build-vs-buy considerations where relevant
- governance/risk where relevant

---

# Priority 10 — Industry Page Uniqueness

The planning briefs intentionally share a common structure.

Production pages must NOT simply reproduce that structure mechanically.

Every industry page must have:

- distinct argument flow
- industry-specific workflows
- industry-specific business economics
- distinct examples
- distinct primary visual/framework
- distinct FAQs
- distinct metadata
- distinct intro
- distinct CTA context
- meaningful differences in section structure where appropriate

Reject noun-swapped copy.

Examples of required differentiation:

Pool:
estimate cycles, design consultations, construction/service relationship

Restoration:
emergency intake, catastrophe surge, geographic routing, dispatch

Solar:
setter/closer workflows, field sales, consent-aware communication

Fiber:
territories, address/serviceability, field reps, installs, activation

Real Estate:
buyer/seller intent, portals, agent routing, showings, database reactivation

Pest:
recurring-service economics, retention, renewal, route communication

Plumbing:
urgent calls, dispatch, after-hours response, service vs replacements

E-commerce:
customer/order data, lifecycle, merchandising, support, returns

Recruiting:
application intake, screening, scheduling, human employment decisions

Financial Services:
data governance, access controls, regulated human judgment

Defense/Aerospace:
security boundaries, controlled information, enterprise knowledge workflows

---

# Priority 11 — Duplicate Content QA

Before release:

- compare every new industry page against every other industry page
- compare Resource pages covering similar concepts
- identify repeated paragraphs
- identify repeated introductions
- identify repeated H2/H3 sequences
- identify repeated FAQ wording
- identify identical CTA paragraphs
- identify templated metadata

Common structural language may be reused where necessary.

Substantive explanatory content should be unique.

No arbitrary percentage threshold should override editorial judgment.

---

# Priority 12 — Technical SEO QA

After latest source reconciliation and implementation:

Check every indexable page for:

- HTTP 200
- one appropriate H1
- unique title
- useful meta description
- self-referencing canonical
- indexability
- correct robots behavior
- valid internal links
- sitemap inclusion
- HTTPS canonical host
- structured-data validity where present

Check intentional noindex pages separately.

---

# Priority 13 — Structured Data

Audit existing structured data before adding new markup.

Potential valid types may include:

- Organization
- WebSite
- BreadcrumbList where breadcrumbs exist
- appropriate page/article markup where supported and accurate

Rules:

- visible page content must support markup
- never fabricate reviews
- never fabricate ratings
- never fabricate people
- never fabricate business facts
- do not use unsupported schema solely to try to create rich results
- validate representative pages

---

# Priority 14 — Image SEO

For meaningful content images and diagrams:

- use descriptive filenames where practical
- use meaningful alt text when image conveys content
- decorative imagery should not receive spammy alt text
- set width/height or otherwise avoid layout shift
- compress appropriately
- use modern formats where sensible
- avoid adding stock imagery solely for SEO

Framework diagrams should be understandable in surrounding text even if images fail.

---

# Priority 15 — Core Web Vitals / Performance

Do not destroy the site's current strong performance to chase theoretical SEO gains.

Review:

- LCP
- INP
- CLS
- render-blocking resources
- font loading
- image sizing
- JavaScript execution
- third-party tags

Existing GTM/GA4 is business-critical and should not be removed simply to improve a synthetic score.

Test both mobile and desktop.

---

# Priority 16 — Accessibility Supporting SEO/UX

Audit:

- meaningful link names
- button names
- heading structure
- form labels
- keyboard usability
- contrast
- focus states
- alt text
- landmark structure
- mobile readability

Accessibility improvements should not be treated as keyword placement opportunities.

---

# Priority 17 — Sitemap

After Sprint 12:

Rebuild sitemap to include every new canonical indexable route.

Exclude:

- assessment results/stateful pages
- 404
- noindex pages
- redirect URLs
- duplicate URL variants

Validate:

- XML syntax
- 200 status for every sitemap URL
- canonical match
- no stale paths

Then resubmit the existing sitemap URL in Google Search Console.

---

# Priority 18 — Robots

Confirm:

- robots.txt returns 200
- intended public content is crawlable
- sitemap declaration is correct
- no accidental broad Disallow exists
- robots.txt is not being used as a substitute for noindex

---

# Priority 19 — 404 / Broken Links

Crawl all internal links after build.

Requirements:

- zero unintended internal 404 links
- branded 404 page remains functional
- real removed URLs may intentionally return 404
- links to future routes must not be published before those routes exist
- unnecessary redirecting internal links should be corrected

---

# Priority 20 — Final Google Validation

After deployment:

Google Search Console:

- resubmit sitemap
- inspect homepage
- inspect representative service page
- inspect representative industry page
- inspect representative Resource
- check Page Indexing
- check Core Web Vitals
- check Enhancements
- check Manual Actions
- check Security Issues
- monitor Performance queries/impressions/CTR/positions

Do not expect immediate ranking changes.

Use actual Search Console query data for ongoing optimization.

---

# Acceptance Gate

Sprint 12 SEO work is complete only when:

- latest production source is reconciled into Git
- all planned pages are implemented
- metadata audit passes
- H1 audit passes
- canonical audit passes
- sitemap audit passes
- broken-link crawl passes
- duplicate-content review passes
- descriptive-anchor review passes
- mobile QA passes
- structured-data validation passes where applicable
- Core Web Vitals remain healthy
- production crawl confirms results
- Search Console is resubmitted/reviewed

Reference checklist:

docs/06-industry-expansion/seo-audit/google-seo-100-point-checklist.md
