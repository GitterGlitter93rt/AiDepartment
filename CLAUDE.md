# CLAUDE.md

## Project

Your AI Department

Primary domain:

YourAIDepartment.ai

Marketing / campaign domain:

HireAnAIDepartment.com

This repository is the source of truth for company strategy, offers, assessment logic, website copy, SEO requirements, and build instructions.

---

# PRIMARY RULE

Do not invent:

- Offers
- Pricing
- Testimonials
- Case studies
- Company history
- Partnerships
- Credentials
- Revenue claims
- ROI
- Statistics
- Customer counts
- Team members
- Certifications

If information is missing, use a clearly marked placeholder or flag it for review.

---

# SOURCE OF TRUTH HIERARCHY

When documents conflict, use this order:

1. docs/00-company/launch-decisions.md
2. docs/00-company internal strategy documents
3. docs/04-assessment/
4. docs/03-products/
5. docs/02-website/
6. older planning or research documents

The file:

docs/00-company/launch-decisions.md

controls the V1 business model and launch architecture.

---

# WEBSITE BUILD DIRECTION

Do NOT build the V1 website in WordPress.

Do NOT assume:

- GeneratePress
- GenerateBlocks
- Elementor
- Divi
- ACF
- WordPress plugins
- WordPress themes

unless explicitly instructed later.

The V1 website should be custom coded.

---

# HOSTING

Production hosting:

SiteGround VPS / cloud environment.

The site should be deployable to SiteGround.

Do not assume Vercel, Netlify, Cloudflare Pages, or another platform is required.

Deployment should remain portable.

---

# PREFERRED TECHNICAL ARCHITECTURE

Preferred direction:

- TypeScript
- Modern component-based frontend
- Static or pre-rendered pages wherever practical
- Minimal client-side JavaScript
- Strong performance
- Accessible HTML
- Clean semantic markup
- Responsive design
- Reusable components
- Portable deployment

Preferred framework:

Astro is preferred for the marketing/content layer because the website is primarily content-driven and SEO-sensitive.

Next.js may be used instead if application requirements clearly justify it.

Do not introduce unnecessary framework complexity.

---

# STATIC-FIRST PRINCIPLE

Marketing and SEO pages should be pre-rendered or static wherever possible.

Examples:

- Homepage
- Solution pages
- Service pages
- Industry pages
- Method page
- About
- Contact
- SEO landing pages
- Blog content
- Resources

The website should not require a server-rendering framework simply to display normal marketing pages.

---

# ASSESSMENT APPLICATION

The AI Department Assessment is a core interactive application.

It may use client-side interactivity for:

- Branching questions
- Progress
- Category scoring
- Overall scoring
- ROI calculations
- Recommendation logic
- Results presentation

Assessment logic is defined primarily in:

docs/04-assessment/

Do not simplify or redesign the assessment architecture without approval.

---

# SECURE SERVER-SIDE OPERATIONS

Anything involving secrets or privileged actions must remain server-side.

Examples:

- AI API calls
- CRM writes
- Email delivery
- SMS delivery
- Persistent lead storage
- Private database operations
- API credentials
- Third-party secrets

Never expose:

- API keys
- Secret tokens
- CRM credentials
- Email credentials
- Private service credentials

inside frontend JavaScript.

---

# ASSESSMENT DATA

The public assessment should collect only information necessary for:

- Scoring
- Recommendations
- Qualification
- Contact
- Strategy follow-up

Do not request highly sensitive information through ordinary public forms.

Assessment implementation should follow:

docs/04-assessment/overview.md
docs/04-assessment/questions.md
docs/04-assessment/scoring.md
docs/04-assessment/recommendations.md
docs/04-assessment/report-template.md
docs/04-assessment/roi-calculator.md

---

# CORE COMMERCIAL FUNNEL

Primary funnel:

Traffic

↓

AI Department Assessment

↓

Personalized Score and Recommendations

↓

Strategy Call

↓

Executive AI Strategy

↓

AI Implementation

↓

Managed AI Department

Not every prospect must follow every step.

---

# PRIMARY CTA

Site-wide primary CTA:

Get Your AI Department Score

Recommended destination:

/ai-assessment/

Secondary CTA:

Schedule a Strategy Call

---

# CANONICAL CORE OFFERS

Use these names consistently:

AI Department Assessment

Executive AI Strategy

AI Consulting

AI Implementation

AI Growth Systems

Managed AI Department

AI Training

AI Workshops

Executive AI Coaching

Google Ads

Meta Ads

SEO

Do not revive deprecated offer names unless source documents explicitly require them.

---

# DESIGN DIRECTION

The website should feel:

- Premium
- Executive
- Modern
- Sophisticated
- Clean
- High trust
- Business-focused

Avoid:

- Generic agency templates
- Robot stock art
- Cyberpunk design
- Excessive neon
- Excessive gradients
- Overly futuristic visuals
- AI gimmicks
- Clutter
- Excessive animation

The visual quality should feel closer to a modern technology/advisory company than a typical local marketing agency.

---

# PERFORMANCE

Performance is a core requirement.

Prioritize:

- Minimal JavaScript
- Optimized images
- Modern image formats
- Lazy loading
- Font efficiency
- Small bundles
- Static rendering
- Caching
- Compression
- Fast first render
- Low layout shift

Avoid unnecessary libraries.

---

# TECHNICAL SEO

SEO must be intentionally implemented.

Every indexable page should support:

- Unique title
- Meta description
- Canonical URL
- One clear H1
- Logical H2/H3 hierarchy
- Semantic HTML
- Internal linking
- Clean URL
- Open Graph metadata
- Social metadata
- Structured data where appropriate

The production build should include:

- sitemap.xml
- robots.txt
- canonical tags
- 404 page
- redirect strategy
- favicon
- social sharing image support

---

# STRUCTURED DATA

Use schema.org markup when appropriate.

Potential types:

- Organization
- WebSite
- WebPage
- Service
- FAQPage
- BreadcrumbList
- Article
- ContactPage

Do not add unsupported or misleading structured data.

---

# CORE WEB VITALS

Build with Core Web Vitals in mind.

Avoid:

- Large render-blocking scripts
- Heavy page builders
- Unnecessary client hydration
- Oversized hero media
- Layout shifts
- Excessive third-party scripts

---

# ACCESSIBILITY

The website should include:

- Semantic landmarks
- Keyboard accessibility
- Visible focus states
- Proper labels
- Appropriate alt text
- Accessible forms
- Reasonable contrast
- Correct heading hierarchy

Do not treat accessibility as an afterthought.

---

# CONTENT

Website copy is already being written in the repository.

Do not rewrite major messaging during development unless explicitly requested.

Use the appropriate files under:

docs/02-website/
docs/03-products/

as the basis for production copy.

Development should implement approved copy, not reinvent it.

---

# EMPTY FILE RULE

Many repository files are placeholders for future architecture.

An empty file does NOT mean:

"Generate this page automatically."

Do not create production pages from empty placeholders unless explicitly instructed.

---

# V1 PRIORITY

Focus first on launch-critical pages.

Core pages include:

- Homepage
- AI Department Assessment
- AI Consulting
- AI Implementation
- AI Growth Systems
- Managed AI Department
- Google Ads
- Meta Ads
- SEO
- AI Training
- AI Workshops
- Executive AI Coaching
- The AI Department Method
- About
- Contact

Initial industry pages will be added intentionally.

Do not delay launch to build every future SEO page in the repository.

---

# REUSABLE COMPONENTS

Use reusable components for:

- Header
- Footer
- CTA sections
- Service cards
- Score displays
- FAQ sections
- Industry cards
- Forms
- Assessment steps
- Results cards
- Opportunity cards
- Breadcrumbs
- SEO metadata

Avoid duplicating markup unnecessarily.

---

# URL CONSISTENCY

Preferred URLs include:

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

Do not change URL structure casually because it affects SEO and future redirects.

---

# ANALYTICS

The website architecture should allow later integration with:

- Google Analytics
- Google Search Console
- Google Ads conversion tracking
- Meta Pixel
- CRM
- Call tracking
- Consent tools

Do not hard-code production IDs until supplied.

Use environment/config variables where appropriate.

---

# FORMS

Forms should support:

- Validation
- Spam protection
- Accessible labels
- Clear success/error states
- Server-side handling for sensitive operations

Do not expose email credentials or other secrets in client code.

---

# DEPLOYMENT

The project should include clear deployment instructions for SiteGround.

The build process should produce predictable production output.

Avoid unnecessary hosting lock-in.

If static output is used, document which generated directory should be uploaded.

If a Node runtime is required, document:

- Required Node version
- Build command
- Start command
- Environment variables
- Reverse proxy requirements
- Process manager requirements

---

# DEVELOPMENT PHILOSOPHY

Prefer:

Simple

Fast

Maintainable

Portable

SEO-friendly

Accessible

Secure

over:

Over-engineered

Trendy

Complex

Dependency-heavy

The website exists to generate business.

Technology should support that objective.


---

# ENTERPRISE

Enterprise is part of V1.

Route:

/enterprise/

Canonical offer:

Enterprise AI Transformation

Primary Enterprise CTA:

Discuss an Enterprise Engagement

Do not force enterprise visitors through the public assessment funnel.

Do not invent enterprise clients, results, case studies, or logos.

---

# ASSESSMENT IMPLEMENTATION AUTHORITY

Before implementing the AI Department Assessment, read:

docs/04-assessment/implementation-spec.md

This is the canonical V1 implementation specification for:

- Question scoring
- Branching logic
- Internal commercial scoring
- Opportunity flags
- Recommendation eligibility

Do NOT infer or invent assessment logic from prose.

Do NOT hard-code each question into separate UI components.

Implement the assessment from structured typed configuration.

Deterministic scoring controls results.

AI may later explain results but must not independently determine scores or financial estimates.
