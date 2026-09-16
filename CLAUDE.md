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

# ORIENTATION FOR A FRESH SESSION

Verified 2026-09-16 against the source tree. Detail lives in
`docs/PROJECT_STATE.md`, `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.

## Repository role

One repository for Your AI Department: the public website, the assessment
engine, all company/offer/SEO documentation — and, on a separate branch line,
the Sales Brain application and the phone agent.

## Two branch lines, not merged

| | Website line (**you are probably here**) | Sales Brain line |
|---|---|---|
| Branches | `sprint13-*` … `sprint17-local-authority-proof` | `feature/outbound-sales-brain`, `feature/sales-brain-rep-enrichment`, `fix/sales-brain-*`, `fix/dataforseo-standard-collector` |
| Split from `main` | `648da9d`, 2026-08-14 | `f031ac7`, 2026-09-01 |
| Extra top-level directories | — | `brain/`, `services/sales-brain`, `services/sales-voice`, `phone-agent/`, `AGENTS.md` |
| Working copy | `/home/roothecks/AiDepartment` | `/home/roothecks/YAD-Sales-Brain*` (seven worktrees) |

**`brain/` is not on the website branches.** The operational brain —
`brain/TODO.md`, `DECISIONS.md`, `PROJECT.md`, `WEBSITE.md`, `TRACKING.md`,
`MARKETING.md`, `WORKFLOWS.md` — is on `origin/main` and on the Sales Brain
line. Read it without switching branches:

```bash
git show origin/main:brain/README.md
git show origin/main:brain/TODO.md
git show origin/main:brain/DECISIONS.md
```

Its start-of-work protocol (read `brain/TODO.md`, then the subject file, then
the canonical spec under `docs/`, then the code) applies here too.

Before working in any `YAD-Sales-Brain*` worktree, check for a live session:
another agent may be running the suite, and the Sales Brain API and worker may
be running from `/home/roothecks/YAD-Sales-Brain/services/sales-brain`.

## Important paths (website line)

| Path | What it is |
|---|---|
| `src/pages/` | 75 Astro routes |
| `src/layouts/` | `BaseLayout`, `FunnelLayout`, `OutboundLayout` |
| `src/components/` | Shared UI, plus `assessment/`, `funnel/`, `interior/`, `outbound/` |
| `src/lib/assessment/` | The deterministic scoring/recommendation engine |
| `src/lib/` | `site.ts`, `schema.ts`, `attribution.ts`, `repAttribution.ts`, `businessIdentity.ts`, `locations.ts`, `industries.ts`, `scheduling.ts` |
| `src/data/` | Structured assessment, funnel and outbound configuration |
| `src/content/` | MDX collections, typed by `src/content.config.ts` |
| `tests/` | 20 suites, run after a build |
| `docs/00-company/launch-decisions.md` | Controls the V1 commercial model |
| `docs/04-assessment/implementation-spec.md` | Canonical assessment logic |
| `dist/` | Build output, gitignored — upload target |

## Development commands

Node `>=22.12.0`, npm, Astro `^7.2.0`.

```bash
npm install
npm run dev        # astro dev
npm run build      # static output into dist/
npm run preview    # serve the build locally
npm test           # builds first, then node --experimental-strip-types --test tests/*.test.ts
```

There is no separate lint or typecheck script; `@astrojs/check` is available as
a dev dependency and type errors surface during `astro build`.

Sales Brain (other line, from `services/sales-brain/`): `npm run migrate`,
`npm run api`, `npm run worker`, `npm test`, `npm run check`, `npm run build`,
`npm run doctor`, `./deploy/stack.sh status`.

## Environment

- **Production website:** `https://youraidepartment.ai`, static output uploaded
  to a **SiteGround** VPS/cloud environment. No adapter, no Node runtime at
  deploy time, no platform lock-in. Campaign domain: `hireanaidepartment.com`.
- **There is no staging tier in this repository.** `npm run preview` is the
  local approximation.
- **Production may be ahead of Git** — `brain/TODO.md` `WEB-003` says so.
  Verify the deployed commit before overwriting website code.
- Analytics/ads identifiers are configuration, recorded in `brain/TRACKING.md`,
  and never hard-coded as product values.
- Sales Brain runs on this machine (the EdgeXpert box) as systemd user services
  with PostgreSQL in Docker; its variable *names* are listed in
  `docs/ARCHITECTURE.md` §8 and in `services/sales-brain/.env.example`.

## External integrations (evidence-backed)

Website: Google Analytics 4 and Google Tag Manager, Google Ads conversion
tracking, Meta Pixel, Google Search Console, Cal.com booking, Twilio (A2P/SMS
registration — the site carries the consent language and sender identity).
Sales Brain: DataForSEO (market mining), Apollo (optional paid contact
enrichment, disabled by default), Cal.com (booking authority), Microsoft Graph
(calendar/mail fallback), PostgreSQL.

## Deployment (documented, not executed)

`npm run build`, then upload the generated static directory to SiteGround;
prefer a real 301 in `.htaccess` for retired routes over the meta-refresh page
Astro emits in static mode. Sales Brain deploys via
`services/sales-brain/deploy/stack.sh` with `RUNBOOK-stack.md` and
`RUNBOOK-backup-restore.md`.

**Do not deploy, upload, restart a service or push to GitHub unless the owner
asks for it in this session.**

## Git conventions

Branches are `sprintNN-<theme>` for website work and `feature/…` or `fix/…` for
Sales Brain work. Commit subjects are lower-case Conventional Commits that state
the change in product terms — *"a phone number is not SMS consent, and the forms
now say so"*. Do not commit or push without being asked; never force-push;
preserve unrelated uncommitted work (there is currently an untracked
`design-system/` directory here that is not part of this work).

## Testing and validation

`npm test` builds and then asserts routes, SEO content and quality, structured
data, analytics taxonomy, attribution, lead submission, funnels, outbound
landings and the Twilio A2P compliance claims. A copy change that breaks
`tests/twilioA2pCompliance.test.ts` or `tests/analyticsIntegrity.test.ts` is a
compliance or measurement change, not a broken test.

## Session safety rules

1. Never deploy, upload to SiteGround, or restart a running service.
2. Never send email or SMS, never place a call, never enable
   `OUTBOUND_DIAL_ENABLED` or `OUTBOUND_EMAIL_ENABLED`.
3. Never spend money on a paid provider — DataForSEO and Apollo cost real money
   per request; `npm run miner:canary` is dry by default and the live path
   requires the ceiling to be stated twice.
4. Never put lead data, assessment submissions, customer lists or exports into
   Git, docs or `brain/`.
5. Never put a secret value anywhere in the repository — names only.
6. Never publish an indicative internal price as a fixed promise.
7. Do not rewrite approved messaging while implementing.

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
