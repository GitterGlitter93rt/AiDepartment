# Your AI Department — 100-Point Google SEO Preflight

This checklist is the SEO acceptance standard for Sprint 12 and future releases.

Important:
- This is not a claim that Google exposes every ranking signal.
- No checklist guarantees rankings or indexing.
- Follow current Google Search Central guidance.
- Prioritize helpful, reliable, people-first content over scanner scores.
- Do not make changes merely to satisfy an arbitrary third-party SEO score.

---

# 1. Crawlability & Indexing

- [ ] 1. Every intended public landing page returns HTTP 200.
- [ ] 2. No intended indexable page is blocked by robots.txt.
- [ ] 3. No intended indexable page contains meta robots noindex.
- [ ] 4. Pages intentionally excluded from Google are explicitly noindex where appropriate.
- [ ] 5. Stateful/personalized assessment-result pages remain noindex.
- [ ] 6. robots.txt is publicly accessible.
- [ ] 7. robots.txt references the canonical XML sitemap.
- [ ] 8. XML sitemap is publicly accessible and valid.
- [ ] 9. Sitemap contains every intended canonical indexable URL.
- [ ] 10. Sitemap excludes noindex, redirecting, broken, duplicate, and stateful URLs.

# 2. HTTP, Redirects & Canonicals

- [ ] 11. Every sitemap URL returns 200 without unnecessary redirect chains.
- [ ] 12. HTTP permanently redirects to HTTPS.
- [ ] 13. www permanently redirects to the chosen non-www canonical host.
- [ ] 14. https://youraidepartment.ai/ is the preferred canonical host.
- [ ] 15. Trailing-slash behavior is consistent across the site.
- [ ] 16. Every indexable page contains a self-referencing canonical.
- [ ] 17. Canonical URLs match the final resolved URLs.
- [ ] 18. No canonical points to a 404, redirect, or noindex URL.
- [ ] 19. No duplicate URL variants are internally linked.
- [ ] 20. Old/deprecated URLs either intentionally 404 or permanently redirect when a replacement exists.

# 3. Titles

- [ ] 21. Every indexable page contains a title element.
- [ ] 22. Every important page has a unique title.
- [ ] 23. Titles accurately describe the actual page.
- [ ] 24. Primary search concept appears naturally in important titles.
- [ ] 25. Titles avoid keyword stuffing.
- [ ] 26. Titles avoid vague labels such as Home, Services, or Learn More.
- [ ] 27. Titles are concise enough to communicate the topic clearly.
- [ ] 28. Brand naming is consistent where included.
- [ ] 29. Page title and visible page topic are aligned.
- [ ] 30. No mass-generated title pattern produces near-duplicate titles across industries.

# 4. Meta Descriptions & Search Snippets

- [ ] 31. Every important indexable page has a meta description.
- [ ] 32. Every important meta description is unique.
- [ ] 33. Descriptions accurately summarize the specific page.
- [ ] 34. Descriptions are useful to a prospective searcher.
- [ ] 35. Descriptions avoid keyword stuffing.
- [ ] 36. Descriptions avoid generic boilerplate repeated across industries.
- [ ] 37. Existing five Resource descriptions are expanded from their current extremely short versions.
- [ ] 38. Roofing description is reviewed for additional specificity.
- [ ] 39. Homepage, Google Ads, Automotive, Healthcare, Insurance, and Privacy descriptions are reviewed for unnecessary length.
- [ ] 40. Description length is treated as an editorial consideration, not a rigid Google ranking requirement.

# 5. Heading Structure & Page Semantics

- [ ] 41. Every primary indexable landing page has one clear primary H1.
- [ ] 42. The current live-site H1 anomaly is identified and corrected.
- [ ] 43. H1 accurately describes the primary page topic.
- [ ] 44. H2 headings organize major concepts logically.
- [ ] 45. H3 headings are used as genuine subsections where appropriate.
- [ ] 46. Heading hierarchy is logical rather than chosen only for visual styling.
- [ ] 47. Primary visible title is prominent and unambiguous.
- [ ] 48. Heading text is descriptive rather than generic.
- [ ] 49. Industry pages do not reuse identical heading sequences mechanically.
- [ ] 50. Resource pages use headings that make the content easy to scan and understand.

# 6. Content Quality & Uniqueness

- [ ] 51. Every indexable page has a clear search/user intent.
- [ ] 52. Every industry page contains genuinely industry-specific analysis.
- [ ] 53. Every industry page identifies at least 3-5 workflows unusually important to that industry.
- [ ] 54. No page is created by merely replacing one industry noun with another.
- [ ] 55. New pages are compared against one another for repeated paragraphs.
- [ ] 56. Significant near-duplicate blocks are rewritten or consolidated.
- [ ] 57. Important landing pages provide sufficient substantive depth for the topic.
- [ ] 58. Content directly answers the likely business questions behind the search.
- [ ] 59. Content explains implementation realities rather than only describing benefits.
- [ ] 60. Content clearly distinguishes AI assistance from situations requiring human judgment.

# 7. Helpful / Reliable / People-First Content

- [ ] 61. Content is written primarily to help real business decision-makers.
- [ ] 62. Pages demonstrate business-process understanding rather than generic AI knowledge.
- [ ] 63. No fake clients are presented.
- [ ] 64. No fake testimonials are presented.
- [ ] 65. No fake case studies are presented.
- [ ] 66. No unsupported ROI promises are presented.
- [ ] 67. No invented industry statistics are presented.
- [ ] 68. High-stakes claims include appropriate limitations and human-review language.
- [ ] 69. Regulated-industry content avoids presenting Your AI Department as legal, medical, financial, insurance, or compliance counsel.
- [ ] 70. AI-generated content receives editorial review for usefulness, accuracy, originality, and repetition before publication.

# 8. Internal Links, Anchors & Site Architecture

- [ ] 71. Every important commercial page is reachable through internal links.
- [ ] 72. Every important Resource is reachable through the Resources architecture.
- [ ] 73. New Resources contextually link to their relevant industry pages.
- [ ] 74. New industry pages contextually link to useful Resources.
- [ ] 75. Service pages receive contextual internal links where genuinely relevant.
- [ ] 76. Internal anchor text describes the destination.
- [ ] 77. Generic anchors such as Learn More, Read More, Click Here, and See More are avoided where descriptive wording is practical.
- [ ] 78. Internal links do not point to 404 URLs.
- [ ] 79. Internal links do not unnecessarily route through redirects.
- [ ] 80. Site architecture avoids orphan pages.

# 9. Structured Data & Search Appearance

- [ ] 81. Structured data uses only types appropriate to the visible page content.
- [ ] 82. Structured data matches what users can actually see on the page.
- [ ] 83. Structured data contains no fabricated ratings, reviews, organizations, people, or claims.
- [ ] 84. Organization/business identity markup is accurate.
- [ ] 85. WebSite structured data is evaluated on the homepage for site-name clarity.
- [ ] 86. Relevant breadcrumb structured data is considered where breadcrumb navigation exists.
- [ ] 87. Supported structured-data implementations validate without critical errors.
- [ ] 88. Rich Results Test is run on representative supported page types.
- [ ] 89. Search Console enhancement reports are reviewed after deployment.
- [ ] 90. Structured data is not added merely to chase unsupported rich-result types.

# 10. Mobile, Performance, Security & UX

- [ ] 91. Every important template is visually tested at approximately 390px mobile width.
- [ ] 92. Every important template is tested at tablet and desktop widths.
- [ ] 93. No horizontal overflow exists on supported layouts.
- [ ] 94. Main content remains easily usable and readable on mobile.
- [ ] 95. LCP is monitored with a target of good Core Web Vitals performance.
- [ ] 96. INP is monitored with a target of good Core Web Vitals performance.
- [ ] 97. CLS is monitored with a target of good Core Web Vitals performance.
- [ ] 98. HTTPS is enforced and security/header configuration is reviewed, including HSTS where appropriate.
- [ ] 99. Intrusive interstitials and distracting overlays do not obstruct primary content.
- [ ] 100. Final release is inspected in Google Search Console using URL Inspection, sitemap/indexing reports, Core Web Vitals, enhancements, security/manual-action reports, and actual query/performance data.

---

# Sprint 12 Editorial Depth Standard

Word count is NOT a Google ranking requirement.

Use these only as editorial review ranges:

Major industry pages:
approximately 1,400-2,200 substantive words when justified by the topic.

Enterprise/high-complexity pages:
approximately 1,600-2,500 substantive words when justified.

Supporting Resources:
approximately 1,000-1,700 substantive words normally.

Major pillar Resources:
approximately 1,500-2,200+ substantive words where warranted.

Never pad a page merely to hit a word-count target.

Search intent, completeness, originality, usefulness, specificity, and clarity matter more.

---

# Industry Uniqueness Gate

Before approving any new industry page:

- identify its distinct customer journey
- identify its distinct operational workflow
- identify at least 3-5 industry-specific problems
- identify industry-specific human decision points
- identify industry-specific systems/integrations where appropriate
- identify industry-specific measurement outcomes
- create a distinct framework/diagram where useful
- use unique examples
- use unique FAQs
- use unique metadata
- compare page copy against every other new industry page
- reject noun-swapped or mechanically templated copy

Examples:

Pool Companies:
design consultation, long estimate cycles, construction/service relationship, unsold quote follow-up.

Restoration:
24/7 emergencies, catastrophe surge, triage, routing, documentation, dispatch.

Solar:
setter/closer model, D2D capture, permissioned communications, financing and appointment workflows.

Fiber:
territories, address/serviceability, D2D reps, installation, activation.

Real Estate:
buyer/seller intent, portal leads, database reactivation, agent routing, showings, transactions.

Pest Control:
recurring service, booking, route communication, retention, renewal.

Plumbing:
urgent inbound calls, dispatch, service vs replacement opportunities, after-hours demand.

E-commerce:
customer/order data, lifecycle marketing, support, returns, merchandising, repeat purchases.

---

# Release Rule

Sprint 12 is not complete until:

1. the entire production site has been audited,
2. critical technical SEO failures have been corrected,
3. metadata has been reviewed site-wide,
4. duplicate/templated content has been checked,
5. all new pages pass the same standard,
6. a production crawl after deployment confirms the fixes,
7. Search Console is checked after deployment.
