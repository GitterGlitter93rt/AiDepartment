# Website Build Specification

Status: Draft
Version: 1.0
Launch Priority: Critical

---

# PROJECT

Your AI Department

Primary domain:

https://youraidepartment.ai/

Secondary marketing domain:

https://hireanaidepartment.com/

Primary production hosting:

SiteGround VPS / Cloud environment

Repository:

GitHub is the source of truth for website code, content specifications, assessment logic, and documentation.

---

# PURPOSE

This document defines the technical and structural requirements for building the V1 Your AI Department website.

The website should function as both:

1. A high-performance SEO-focused marketing website.
2. The frontend for the AI Department Assessment and future interactive business tools.

Do not treat this as a generic brochure website.

The architecture should support future expansion without unnecessarily complicating V1.

---

# PRIMARY BUSINESS OBJECTIVE

The primary website objective is to convert qualified business visitors into AI Department Assessment completions.

Primary CTA:

Get Your AI Department Score

Primary destination:

/ai-assessment/

Secondary conversion objective:

Strategy Call

The website should guide visitors toward one of these actions without making every section feel like an aggressive sales pitch.

---

# CORE FUNNEL

Traffic

↓

Website

↓

AI Department Assessment

↓

AI Department Score

↓

Personalized Opportunities

↓

Strategy Call

↓

Executive AI Strategy

↓

AI Implementation

↓

Managed AI Department

Not every prospect must follow every stage.

---

# DEVELOPMENT STACK

Do not use WordPress for V1.

Do not use:

- GeneratePress
- GenerateBlocks
- Elementor
- Divi
- WordPress plugins
- WordPress page builders

unless explicitly approved later.

Preferred V1 framework:

Astro

Preferred language:

TypeScript

Use client-side JavaScript only where interaction requires it.

---

# WHY ASTRO

The majority of the website consists of:

- Marketing pages
- Service pages
- Solution pages
- Industry pages
- Educational content
- SEO landing pages

These should render as static HTML wherever possible.

Astro should allow the site to remain:

- Fast
- Lightweight
- SEO friendly
- Portable
- Easy to deploy
- Easy to expand

Interactive components may use appropriate client-side JavaScript.

Do not hydrate components unnecessarily.

---

# FRAMEWORK FLEXIBILITY

Astro is the preferred architecture, not an ideological requirement.

If a specific application requirement cannot reasonably be implemented with Astro, document:

- The requirement
- Why Astro is insufficient
- Proposed alternative
- Hosting implications
- Performance implications
- SEO implications

before changing the primary framework.

Do not switch the entire project to Next.js merely because it is familiar.

---

# STYLING

Use a maintainable styling architecture.

Acceptable options include:

- Tailwind CSS
- Scoped Astro CSS
- Well-structured global CSS
- A combination where justified

Avoid:

- Massive CSS frameworks
- Bootstrap unless specifically justified
- Unused component libraries
- Theme dependencies

The final design system should use reusable tokens for:

- Typography
- Spacing
- Borders
- Radius
- Shadows
- Container widths
- Breakpoints
- Brand colors

---

# DESIGN SYSTEM

Before building all pages, establish reusable design primitives.

Potential components:

Button

Container

Section

SectionHeader

Card

ServiceCard

IndustryCard

OpportunityCard

ScoreCard

CTASection

FAQ

Accordion

FormField

Breadcrumbs

Header

Footer

MobileNavigation

AssessmentProgress

AssessmentQuestion

AssessmentResults

Do not independently style every page.

---

# VISUAL DIRECTION

The site should feel:

- Premium
- Executive
- Modern
- Sophisticated
- Trustworthy
- Technically capable
- Business-focused

It should NOT feel like:

- A crypto company
- A gaming website
- A generic AI startup template
- A cheap marketing agency
- A WordPress template
- A science-fiction interface

---

# AI VISUAL LANGUAGE

Avoid overused AI imagery such as:

- Humanoid robots
- Robot hands
- Glowing brains
- Circuit-board heads
- Random neural-network graphics
- Blue robot stock photos

Prefer visuals communicating:

- Business systems
- Data
- Workflow
- Growth
- Intelligence
- Transformation
- Connected operations
- Executive decision-making

Custom graphics and subtle abstract visuals are preferred over cliché stock imagery.

---

# ANIMATION

Animation should support the experience rather than become the experience.

Acceptable:

- Subtle entrance transitions
- Hover states
- Score animations
- Assessment progress
- Small interface transitions

Avoid:

- Excessive parallax
- Constant movement
- Large animation libraries
- Scroll hijacking
- Long loading animations
- Animation that delays content

Respect:

prefers-reduced-motion

---

# PAGE WIDTH

Use consistent content containers.

Suggested maximum content width:

Approximately 1200-1400px depending on layout.

Long-form reading content should use narrower text widths for readability.

---

# TYPOGRAPHY

Typography should communicate executive credibility.

Use:

- Strong readable headings
- Comfortable body text
- Clear hierarchy
- Reasonable line lengths

Avoid excessively futuristic display fonts.

Performance and licensing should be considered when choosing fonts.

---

# HEADER

Header requirements are defined in:

docs/02-website/navigation.md

The header should:

- Be responsive
- Support dropdown navigation
- Include the primary assessment CTA
- Remain usable on mobile
- Avoid excessive height
- Support sticky behavior where appropriate

---

# FOOTER

Footer requirements are defined in:

docs/02-website/footer.md

Do not automatically expose every repository page in the footer.

Only production-ready pages should be linked.

---

# CORE V1 ROUTES

Initial production routes should include:

/

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

Additional routes should only be enabled when their content is production ready.

---

# INDUSTRY ROUTES

Architecture should support:

/industries/[industry]/

Initial planned industries include:

/industries/collision-repair/

/industries/law-firms/

/industries/roofing/

/industries/hvac/

/industries/construction/

/industries/professional-services/

Do not publish empty routes.

---

# FUTURE CONTENT ARCHITECTURE

The site should support future:

- Blog articles
- Guides
- Case studies
- Industry pages
- Use-case pages
- Comparison pages
- AI tools
- Calculators
- Assessment variations

Potential route structures:

/resources/

/blog/

/guides/

/case-studies/

/industries/

/use-cases/

/tools/

Do not build all of these during V1 unless content exists.

---

# CONTENT SOURCE

Approved website content comes primarily from:

docs/02-website/

docs/03-products/

Assessment logic comes primarily from:

docs/04-assessment/

Do not substantially rewrite approved content during implementation without instruction.

Minor formatting changes for web presentation are acceptable.

---

# CONTENT IMPLEMENTATION

Do not place every page's entire content directly into large component files if a cleaner content architecture is practical.

Prefer structured content or reusable page templates where appropriate.

Potential options:

- Markdown
- MDX
- Astro content collections
- Typed content objects

The architecture should make future editing manageable.

---

# SEO

Technical SEO requirements are defined in:

docs/02-website/technical-seo-spec.md

That file is mandatory implementation guidance.

Every production page should be reviewed against it.

---

# PAGE METADATA

Each production page should support structured metadata such as:

title

description

canonical

ogTitle

ogDescription

ogImage

robots

schema

The implementation should make it difficult to accidentally launch an important page without basic metadata.

---

# BASE LAYOUT

Create a reusable base layout responsible for:

- HTML document structure
- Metadata
- Canonical
- Social metadata
- Header
- Main content
- Footer
- Global styles
- Structured data hooks

Do not duplicate these across pages.

---

# SITEMAP

Generate a production sitemap automatically where practical.

Only include:

- Production
- Canonical
- Indexable
- Meaningful

pages.

Do not include assessment result URLs or placeholders.

---

# ROBOTS

Provide a production robots.txt.

Staging deployments must not accidentally become indexed.

---

# STRUCTURED DATA

Create reusable structured-data helpers.

Potential schema:

Organization

WebSite

Service

WebPage

FAQPage

BreadcrumbList

Article

Do not duplicate conflicting schema across components.

---

# ASSESSMENT ARCHITECTURE

The AI Department Assessment is the most important interactive component in V1.

Assessment requirements are defined in:

docs/04-assessment/

The implementation should support:

- Multiple sections
- Branching logic
- Conditional questions
- Progress tracking
- Validation
- Back navigation
- Score calculation
- Category scores
- Recommendation generation
- ROI opportunity modeling
- Lead qualification
- Contact capture
- Results display

---

# ASSESSMENT STATE

Do not require a page reload after every question.

Assessment state should persist during the session.

Consider appropriate recovery if the visitor accidentally refreshes or closes the page.

Possible approaches include:

- sessionStorage
- localStorage
- Server-side session storage

Final architecture should consider privacy and data sensitivity.

---

# ASSESSMENT QUESTION CONFIGURATION

Questions should not be hard-coded into dozens of independent UI components.

Use structured question definitions.

Conceptually:

Assessment
  -> Sections
     -> Questions
        -> Options
        -> Branching
        -> Score Effects
        -> Recommendation Signals

The question engine should render from structured configuration where practical.

---

# SCORING ENGINE

Scoring logic should be separated from visual presentation.

Do not calculate important scoring logic inside UI markup.

The scoring engine should be:

- Testable
- Predictable
- Documented
- Easy to adjust

Reference:

docs/04-assessment/scoring.md

---

# RECOMMENDATION ENGINE

Recommendation logic should also be separated from presentation.

Reference:

docs/04-assessment/recommendations.md

Assessment answers may trigger opportunities such as:

- AI Consulting
- Executive AI Strategy
- AI Implementation
- AI Agents
- Workflow Automation
- CRM Automation
- AI Phone Agent
- Google Ads
- Meta Ads
- SEO
- AI Training
- Managed AI Department

Recommendations should be based on defined signals.

Do not simply recommend every service.

---

# ROI ENGINE

Reference:

docs/04-assessment/roi-calculator.md

ROI calculations should:

- Use clearly defined assumptions
- Avoid fake precision
- Avoid guarantees
- Allow ranges where appropriate
- Clearly distinguish estimates from actual results

Calculation logic should be isolated from UI components.

---

# RESULTS

Assessment results should be designed to feel valuable.

Potential structure:

AI Department Score

Category Scores

Strongest Areas

Highest-Priority Opportunities

Potential Business Impact

Recommended Next Steps

CTA to Strategy Call

Results should not simply say:

"Thanks, we'll contact you."

The prospect should receive meaningful value.

---

# INTERNAL COMMERCIAL SCORE

The assessment may generate an internal Commercial Opportunity Score.

This score is for:

- Lead qualification
- Follow-up priority
- Sales routing

It should NOT be displayed to the prospect.

Do not confuse:

AI Department Score

with:

Commercial Opportunity Score

---

# CONTACT CAPTURE

The assessment may collect:

- First name
- Last name
- Business email
- Phone
- Company
- Website
- Industry
- Role
- Employee count
- Revenue range

Do not collect unnecessary sensitive data.

---

# CRM INTEGRATION

The architecture should allow future CRM integration.

Do not tightly couple the entire assessment to one CRM before the final CRM is selected.

Create an abstraction or server endpoint that can later route leads appropriately.

---

# EMAIL

The architecture should allow assessment results or follow-up emails to be sent.

Do not place SMTP credentials or API secrets in frontend code.

---

# AI API INTEGRATION

Future assessment reports may use AI to generate personalized narrative analysis.

If implemented:

- API calls must occur server-side
- Prompts should use structured assessment data
- Outputs should be constrained
- Scores should come from deterministic scoring logic
- AI should not invent financial facts
- AI should not override core scoring

AI may explain results.

AI should not be the sole scoring engine.

---

# ANALYTICS

Prepare an event architecture.

Potential events:

assessment_started

assessment_section_completed

assessment_contact_submitted

assessment_completed

strategy_call_clicked

contact_form_submitted

service_cta_clicked

industry_cta_clicked

Do not hard-code analytics vendor IDs until supplied.

---

# PERFORMANCE

Marketing pages should ship minimal JavaScript.

Do not hydrate:

- Static headings
- Static cards
- Static copy
- Static FAQ content

unless interaction requires it.

Assessment JavaScript should be code-split where practical.

---

# THIRD-PARTY SCRIPTS

Minimize third-party scripts.

Potential future scripts:

- Analytics
- Ads
- Meta
- Call tracking
- Scheduling
- Chat

Every script has a performance and privacy cost.

Do not install scripts merely because they are commonly used.

---

# SECURITY

Minimum requirements:

- No secrets in client code
- Validate server inputs
- Sanitize user-provided content where required
- Rate-limit sensitive endpoints where appropriate
- Protect forms from spam
- Keep dependencies current
- Use HTTPS
- Use secure environment variables

---

# FORMS

Forms should include:

- Client validation
- Server validation where applicable
- Accessible labels
- Useful error messages
- Loading state
- Success state
- Spam mitigation

Do not rely only on client-side validation for server operations.

---

# ACCESSIBILITY

Meet practical WCAG-oriented standards.

Requirements include:

- Keyboard navigation
- Visible focus
- Semantic structure
- Form labels
- Alt text
- Appropriate contrast
- Reduced-motion support
- Accessible menus
- Accessible assessment controls

---

# SITEGROUND DEPLOYMENT

The project must contain deployment documentation.

If Astro produces static output, clearly document:

Build command

Example:

npm run build

Output directory

Example:

dist/

Deployment should be possible by uploading the contents of the production output directory to the appropriate SiteGround web root.

---

# SITEGROUND VPS CAPABILITY

Because SiteGround hosting may support server-side capabilities depending on the specific environment, do not assume the site must remain entirely client-side forever.

However:

Do not require a persistent Node application for ordinary marketing pages unless justified.

Prefer static delivery for public content.

Backend functionality may be implemented separately where required.

---

# SERVER-SIDE BACKEND OPTIONS

When assessment functionality requires secure server operations, evaluate the actual SiteGround environment before implementation.

Possible approaches may include:

- Supported Node runtime
- PHP endpoints
- Separate API service
- Serverless endpoint hosted elsewhere

Do not choose one until hosting capabilities and requirements are confirmed.

The marketing site should remain portable regardless.

---

# ENVIRONMENT VARIABLES

Use environment variables for:

- API keys
- CRM credentials
- Email service credentials
- Analytics configuration where appropriate
- External service configuration

Provide:

.env.example

Never commit production secrets.

---

# GIT

Do not commit:

node_modules

dist

.env

secret files

local editor files

temporary build files

unless a specific deployment workflow intentionally requires otherwise.

Maintain an appropriate:

.gitignore

---

# README

The final project README should explain:

- What the project is
- Framework
- Requirements
- Installation
- Local development
- Production build
- Deployment
- Environment variables
- Repository structure

---

# LOCAL DEVELOPMENT

Expected workflow should be simple.

Conceptually:

git clone

npm install

npm run dev

Development environment should not require unnecessary services merely to view marketing pages.

---

# BUILD

Production build should be reproducible.

Conceptually:

npm run build

The build should fail visibly when critical implementation problems occur.

---

# DEPENDENCIES

Use as few dependencies as reasonably practical.

Before adding a dependency, ask:

Can the platform/framework already do this?

Is the package maintained?

Does it materially improve development or reliability?

What does it add to client bundle size?

Avoid installing packages for trivial functionality.

---

# BROWSER SUPPORT

Support current mainstream versions of:

- Chrome
- Safari
- Edge
- Firefox

Mobile Safari and Chrome should receive particular attention.

---

# QA

Before production launch test:

Desktop

Mobile

Tablet

Navigation

Forms

Assessment

Scoring

Branching

Results

Internal links

External links

404 behavior

Redirects

SEO metadata

Structured data

Sitemap

Robots

Page speed

Accessibility

---

# ASSESSMENT TESTING

Create test cases for important scoring paths.

Examples:

Low AI adoption + high employee workload

High ad spend + weak tracking

High lead volume + slow response

High missed-call rate

Disconnected systems + high administrative workload

Strong AI maturity + low immediate need

The assessment should produce logically consistent recommendations.

---

# NO FAKE CONTENT

During implementation do not fabricate:

- Testimonials
- Customer logos
- Case studies
- Team members
- Certifications
- Awards
- Client counts
- Revenue results
- Review scores

Use clearly marked placeholders only when absolutely necessary.

Prefer omitting the section until legitimate content exists.

---

# BUILD ORDER

Recommended implementation order:

1. Project foundation
2. Design system
3. Global layout
4. Header
5. Footer
6. Homepage
7. Assessment landing page
8. Core solution pages
9. Service pages
10. Method page
11. About
12. Contact
13. Assessment application
14. Assessment scoring
15. Recommendation engine
16. Results experience
17. Industry pages
18. Analytics
19. Final SEO
20. Performance optimization
21. Accessibility QA
22. Production deployment

---

# DO NOT BEGIN FULL BUILD UNTIL

Before full production development begins, confirm:

- Core website copy is approved
- Assessment questions are approved
- Scoring architecture is approved
- Recommendation engine is approved
- Navigation is approved
- Design direction is approved
- Contact information is supplied
- Required legal decisions are identified

Development may begin on foundational architecture before every final content detail exists, but avoid building major functionality around unresolved assumptions.

---

# FINAL DEVELOPMENT PRINCIPLE

Build the simplest architecture that can reliably support the business.

The goal is not to demonstrate how much technology can be used.

The goal is to create:

A very fast website

A very strong SEO foundation

A valuable assessment

A high-converting sales funnel

A maintainable codebase

A platform capable of growing with Your AI Department.

---

# ENTERPRISE ROUTE ADDENDUM

The V1 production build must include:

/enterprise/

Use:

docs/02-website/enterprise.md

and:

docs/15-offers/enterprise-ai-transformation.md

as source material.

Enterprise uses a direct executive-inquiry conversion path rather than requiring the free assessment.
