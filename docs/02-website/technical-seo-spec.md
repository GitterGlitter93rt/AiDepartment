# Technical SEO Specification

Status: Draft
Version: 1.0
Launch Priority: Critical

---

# Purpose

This document defines the technical SEO requirements for the V1 Your AI Department website.

SEO should be treated as part of the architecture, not added after launch.

The website should be:

- Crawlable
- Indexable
- Fast
- Mobile friendly
- Semantically structured
- Easy for search engines to understand
- Easy to expand with future service, industry, use-case, and content pages

---

# Primary Domain

Canonical production domain:

https://YourAIDepartment.ai

Preferred lowercase canonical representation in implementation:

https://youraidepartment.ai

HireAnAIDepartment.com should not operate as a competing duplicate content site.

It may redirect to:

- Homepage
- AI Department Assessment
- Campaign-specific landing pages

Use permanent redirects where appropriate.

---

# URL PRINCIPLES

URLs should be:

- Short
- Descriptive
- Lowercase
- Hyphen separated
- Stable
- Free of unnecessary parameters

Preferred examples:

/ai-assessment/

/ai-consulting/

/ai-implementation/

/ai-growth-systems/

/managed-ai-department/

/google-ads/

/meta-ads/

/seo/

/ai-training/

/ai-workshops/

/executive-ai-coaching/

/ai-department-method/

/about/

/contact/

/industries/law-firms/

/industries/collision-repair/

Avoid:

/page?id=123

/services/service1

/solutions/ai-consulting-services-company-best

Do not change established production URLs without a redirect plan.

---

# TRAILING SLASH POLICY

Choose one consistent trailing slash convention and use it across:

- Canonicals
- Internal links
- Sitemap
- Redirects

Preferred for this project:

Trailing slash URLs.

Example:

/ai-consulting/

not:

/ai-consulting

The web server should redirect inconsistent variants to the canonical version.

---

# HTTPS

Production must use HTTPS.

All HTTP traffic should redirect to HTTPS.

Avoid mixed-content resources.

---

# WWW POLICY

Choose one canonical host.

Preferred:

https://youraidepartment.ai/

Redirect:

https://www.youraidepartment.ai/

to the non-www version unless a different decision is intentionally approved.

---

# PAGE TITLES

Every indexable page must have a unique HTML title.

General guidance:

Approximately 45-65 characters where practical.

Prioritize:

Primary topic

Business relevance

Brand

Example:

AI Consulting Services for Business | Your AI Department

Avoid keyword stuffing.

Do not automatically reuse H1 text as the title if a stronger search title exists.

---

# META DESCRIPTIONS

Every important commercial page should have a unique meta description.

General guidance:

Approximately 140-165 characters where practical.

The description should communicate:

- What the page offers
- Who it is for
- Why the user should click

Do not stuff keywords.

Meta descriptions are not guaranteed to be displayed by search engines.

---

# H1 RULE

Every standard page should have one primary H1.

The H1 should clearly describe the primary topic.

Avoid:

- Multiple competing H1s
- Logo text marked as H1
- Navigation text marked as H1

---

# HEADING STRUCTURE

Use logical hierarchy.

Example:

H1 - AI Consulting Services

H2 - Where AI Can Create Business Value

H3 - Sales

H3 - Marketing

H3 - Operations

Do not choose heading levels solely for visual styling.

---

# SEMANTIC HTML

Use semantic elements where appropriate:

<header>

<nav>

<main>

<section>

<article>

<aside>

<footer>

Avoid building the entire site from generic div elements when semantic structure is available.

---

# CANONICAL TAGS

Every indexable page should have a self-referencing canonical URL unless there is a deliberate reason otherwise.

Example:

<link rel="canonical" href="https://youraidepartment.ai/ai-consulting/" />

Canonical URLs should:

- Use HTTPS
- Use preferred hostname
- Follow trailing slash policy
- Avoid tracking parameters

---

# ROBOTS.TXT

Production should include:

/robots.txt

It should allow crawling of production content unless specific sections need exclusion.

Do not accidentally block:

- CSS
- JavaScript required for rendering
- Images needed for indexing
- Core production pages

Staging or development environments should be prevented from indexing through appropriate controls.

Production robots.txt should reference the sitemap.

Example concept:

User-agent: *
Allow: /

Sitemap: https://youraidepartment.ai/sitemap.xml

---

# XML SITEMAP

Production must generate:

/sitemap.xml

The sitemap should contain canonical indexable URLs only.

Do not include:

- Redirecting URLs
- 404 pages
- noindex pages
- Development URLs
- Duplicate parameter URLs
- Empty placeholders

Future large-scale content may use sitemap indexes.

---

# INDEXATION

Only pages with meaningful production content should be indexable.

Do not publish hundreds of thin placeholder pages merely because corresponding files exist in the repository.

Empty repository files should not become indexable website pages.

---

# NOINDEX

Use noindex when appropriate for pages such as:

- Internal tools
- Private assessment states
- Temporary campaign test pages
- Thank-you pages when appropriate
- Duplicate utility pages
- Staging environments

Do not use robots.txt alone as a substitute for noindex when the goal is removal from search results.

---

# 404 PAGE

Create a useful custom 404 page.

It should:

- Clearly state the page could not be found
- Link to the homepage
- Link to the AI Department Assessment
- Provide helpful navigation

The server must return an actual HTTP 404 status.

Do not return a 200 status for missing pages.

---

# REDIRECTS

Use 301 redirects for permanently moved URLs.

Avoid redirect chains.

Preferred:

Old URL
->
Final URL

Not:

Old URL
->
Intermediate URL
->
Another URL
->
Final URL

Maintain a redirect file or configuration that can be reviewed.

---

# INTERNAL LINKING

Internal linking should be intentional.

Core relationships:

Homepage -> Core Solutions

Homepage -> Assessment

Core Solutions -> Assessment

Core Solutions -> Related Services

Service Pages -> Relevant Solutions

Industry Pages -> Relevant Services

Industry Pages -> Assessment

Blog / Resources -> Commercial Pages

Method -> Assessment

Assessment -> Strategy Call

Use descriptive anchor text.

Avoid excessive exact-match keyword stuffing.

---

# BREADCRUMBS

Use breadcrumbs on deeper content such as:

Industry pages

Blog articles

Resources

Potential example:

Home > Industries > Law Firms

Breadcrumbs should:

- Be visible to users where appropriate
- Use BreadcrumbList structured data

Core top-level service pages may not require visible breadcrumbs depending on design.

---

# STRUCTURED DATA

Use JSON-LD where practical.

Potential schema.org types:

Organization

WebSite

WebPage

Service

ContactPage

BreadcrumbList

Article

FAQPage where valid

Do not use schema types simply because they exist.

Structured data must reflect content actually visible on the page.

---

# ORGANIZATION SCHEMA

Use Organization schema site-wide or on appropriate core pages.

Potential fields:

- Name
- URL
- Logo
- Contact information
- SameAs social profiles
- Description

Do not invent:

- Addresses
- Founding dates
- Social profiles
- Awards
- Credentials

Missing factual fields should be omitted until supplied.

---

# SERVICE SCHEMA

Commercial service pages may use Service schema.

Examples:

- AI Consulting
- AI Implementation
- Google Ads
- Meta Ads
- SEO
- AI Training

Schema should describe the actual service.

Avoid inserting fake reviews or aggregate ratings.

---

# FAQ SCHEMA

Use FAQPage schema only when:

- The page contains real FAQ content
- Questions and answers are visible to users
- Current search engine policies allow meaningful use

Do not generate hidden FAQ markup solely for SEO.

---

# ARTICLE SCHEMA

Blog and resource content may use:

Article

or

BlogPosting

when appropriate.

Include factual data such as:

- Headline
- Author if known
- Publication date
- Modification date
- Image

Do not invent authors.

---

# OPEN GRAPH

Important pages should provide:

og:title

og:description

og:url

og:type

og:image

Default social image should exist.

Important commercial pages may later receive page-specific social images.

---

# TWITTER / SOCIAL META

Support social sharing metadata.

At minimum:

twitter:card

twitter:title

twitter:description

twitter:image

Do not assume a company X/Twitter account exists.

---

# IMAGE SEO

Images should use:

- Descriptive filenames where practical
- Appropriate alt text
- Width and height attributes
- Responsive formats
- Lazy loading below the fold
- Modern compressed formats

Alt text should describe the image.

Do not stuff keywords into alt text.

Decorative images should use appropriate empty alt attributes.

---

# IMAGE PERFORMANCE

Prefer:

AVIF

WebP

Optimized JPEG/PNG when required

Use responsive image sizes.

Avoid delivering a 3000-pixel image into a 500-pixel display area.

---

# LOGO

The logo should have:

- Optimized SVG where appropriate
- Accessible brand name
- Appropriate Organization schema reference

Do not use a giant raster logo.

---

# FAVICONS

Provide appropriate favicon assets.

Recommended coverage:

- favicon.ico
- Modern PNG icons
- Apple touch icon
- Web manifest if a manifest is implemented

---

# SITE SPEED

Performance is an SEO requirement.

Target strong Core Web Vitals.

Prioritize:

- Fast server response
- Static generation
- Minimal JavaScript
- Image optimization
- CSS efficiency
- Font optimization
- Caching
- Compression

---

# LCP

Largest Contentful Paint should be treated as a priority.

Avoid:

- Huge hero videos
- Large unoptimized images
- Delayed hero text rendering
- Render-blocking third-party scripts

Hero imagery should be appropriately sized and prioritized.

---

# CLS

Prevent layout shifts.

Set explicit dimensions or aspect ratios for:

- Images
- Video
- Embedded media
- Dynamic UI

Reserve space for components that load asynchronously.

---

# INP

Minimize interaction latency.

Avoid unnecessary JavaScript and heavy client-side frameworks for content pages.

Interactive assessment components should remain responsive.

---

# JAVASCRIPT

SEO-critical page content should exist in rendered HTML.

Do not depend on client-side JavaScript to inject the primary page content after load.

Marketing pages should be static or server/pre-rendered wherever practical.

---

# CSS

Avoid excessive unused CSS.

Prefer:

- Scoped styles
- Optimized production CSS
- Reusable design tokens
- Minimal framework overhead

---

# FONTS

Use a limited typography system.

Prefer:

- System fonts
- Self-hosted fonts when licensing allows
- Carefully optimized web fonts

Avoid loading many font families and weights.

Use font-display strategies that prevent invisible text.

---

# MOBILE

The website must be designed mobile-first.

Check:

- Navigation
- Forms
- Assessment
- Font sizing
- Tap targets
- Tables
- CTA visibility
- Hero layout
- Page speed

Desktop design should not simply shrink onto mobile.

---

# ASSESSMENT SEO

The public landing page:

/ai-assessment/

should be indexable.

The interactive assessment application may use a route such as:

/ai-assessment/start/

The exact application route can be decided during implementation.

Potential intermediate assessment pages should not create dozens of indexable thin URLs.

Prefer one application shell with client state or intentionally noindexed steps.

---

# ASSESSMENT RESULTS

Personalized assessment results should generally not be publicly indexable.

Reasons include:

- Personalization
- Business information
- Duplicate template content
- Privacy

Use private state, secure links, noindex, or other appropriate architecture.

Do not create public search-indexable result URLs containing prospect business information.

---

# INDUSTRY PAGE SEO

Industry pages should target actual industry-specific intent.

Examples:

AI Consulting for Law Firms

AI for Collision Repair Businesses

AI for Roofing Companies

Pages must contain:

- Industry-specific problems
- Industry workflows
- Relevant AI use cases
- Relevant marketing opportunities
- Relevant automation
- Relevant services
- Assessment CTA

Do not produce doorway pages where only the industry name changes.

---

# LOCATION SEO

Do not generate large numbers of city pages without meaningful unique content and real business relevance.

Local pages should only be created when there is a legitimate local marketing strategy.

---

# PROGRAMMATIC SEO

Programmatic page creation may be considered later.

Do not launch large-scale programmatic SEO during V1 without:

- Quality rules
- Unique value
- Search demand
- Indexation controls
- Internal linking plan

Quality is more important than page count.

---

# BLOG / RESOURCE SEO

Future articles should include:

- Clear search intent
- Useful original analysis
- Logical headings
- Internal links
- Relevant commercial pathways
- Author information when factual
- Publication date
- Modification date

Do not create generic AI articles simply to fill a blog.

---

# CONTENT DUPLICATION

Avoid substantially duplicate pages targeting the same intent.

Examples to monitor:

AI Consulting vs AI Strategy

AI Training vs AI Workshops

AI Growth Systems vs Marketing Automation

Managed AI Department vs Fractional AI Department

Canonical offer naming is defined by:

docs/00-company/launch-decisions.md

---

# KEYWORD CANNIBALIZATION

Each commercial page should have a distinct primary search intent.

Example:

/ai-consulting/

Primary intent:

AI consulting services

/ai-implementation/

Primary intent:

AI implementation services

/managed-ai-department/

Primary intent:

managed/fractional AI leadership

Avoid creating multiple pages optimized for the same primary phrase without a clear reason.

---

# SEARCH INTENT

Before creating a new SEO page, define:

Primary keyword

Secondary keywords

Search intent

Target audience

Business objective

Primary CTA

Related internal links

If those are unclear, the page may not need to exist yet.

---

# GOOGLE SEARCH CONSOLE

After launch:

Verify the primary domain in Google Search Console.

Submit sitemap.

Monitor:

- Index coverage
- Crawling
- Search queries
- Page performance
- Core Web Vitals
- Manual actions
- Structured data issues

---

# BING WEBMASTER TOOLS

Consider verifying the site in Bing Webmaster Tools after launch.

---

# ANALYTICS

Analytics should not break performance.

Recommended future integration:

Google Analytics 4

Potential event tracking:

- Assessment start
- Assessment progress
- Assessment completion
- Strategy call click
- Contact form submission
- Phone click
- Google Ads inquiry
- Meta Ads inquiry
- SEO inquiry
- Training inquiry

Final measurement architecture should be documented separately.

---

# GOOGLE ADS CONVERSION TRACKING

If paid search launches, define important conversions such as:

- Assessment completion
- Strategy call booked
- Qualified form submission
- Qualified phone call

Avoid treating every low-value page interaction as a primary conversion.

---

# META TRACKING

If Meta advertising launches, support appropriate Meta event tracking.

Consent and privacy requirements must be addressed before production tracking is enabled.

---

# CONSENT AND PRIVACY

Tracking architecture should consider applicable privacy requirements.

Do not automatically load every advertising or analytics script without considering consent obligations.

Final legal implementation requires review appropriate to the company's jurisdiction and marketing activities.

---

# SERVER RESPONSE CODES

Ensure:

Successful pages -> 200

Permanent redirect -> 301

Temporary redirect -> appropriate temporary redirect

Missing page -> 404

Server error -> 5xx

Do not mask broken pages with 200 responses.

---

# DUPLICATE HOST AND PROTOCOL REDIRECTS

Canonical redirect structure should resolve variants such as:

http://youraidepartment.ai

http://www.youraidepartment.ai

https://www.youraidepartment.ai

to:

https://youraidepartment.ai/

Use as few redirect hops as possible.

---

# SITEGROUND DEPLOYMENT

SEO behavior must remain correct after deployment to SiteGround.

Verify production server configuration for:

- HTTPS redirects
- WWW redirects
- Trailing slash behavior
- Custom 404
- Compression
- Cache headers
- Redirect rules
- Correct MIME types

Do not assume behavior that only works on Vercel.

---

# PRE-LAUNCH SEO QA

Before launch, check every indexable page for:

- Correct URL
- HTTP 200
- Unique title
- Meta description
- Canonical
- One H1
- Heading hierarchy
- Internal links
- Image alt text
- Mobile layout
- Structured data
- Open Graph metadata
- No accidental noindex
- Sitemap inclusion
- Page speed
- Broken links

---

# POST-LAUNCH QA

After deployment:

1. Crawl the production site.

2. Verify redirects.

3. Verify canonical tags.

4. Verify sitemap.

5. Verify robots.txt.

6. Test structured data.

7. Test mobile pages.

8. Check Core Web Vitals.

9. Verify Search Console.

10. Monitor indexation.

---

# SEO DEVELOPMENT RULE

Claude or any developer implementing the site should not interpret "SEO friendly" as sufficient instruction.

Technical SEO requirements in this file are part of the production specification.

If implementation requires deviating from this specification, document the reason before launch.

---

# FINAL PRINCIPLE

The best technical SEO architecture is one that makes it easy to publish:

Useful pages

Fast pages

Clear pages

Unique pages

Well-linked pages

The objective is not to manipulate search engines.

The objective is to make the website easy for users and search engines to understand.
