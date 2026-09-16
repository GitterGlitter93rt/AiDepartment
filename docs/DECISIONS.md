# Decision record — Your AI Department (website line)

Compiled 2026-09-16 from `CLAUDE.md`, `PROJECT_RULES.md`, `docs/` and `git log`
on `sprint17-local-authority-proof`.

**This is not the only decision log.** `brain/DECISIONS.md` on `origin/main` and
on the Sales Brain line is the company-level approved-decision log (671 lines,
owner-maintained). This file records the decisions that are provable from the
website line's own code and history, and defers to `brain/DECISIONS.md` and
`docs/00-company/launch-decisions.md` wherever they overlap. Read it with
`git show origin/main:brain/DECISIONS.md`.

---

## 2026-08-08 — Custom-coded site on SiteGround, not WordPress

**Decision:** Replace the WordPress/GeneratePress build direction with a
custom-coded site deployed to a SiteGround VPS/cloud environment. Do not assume
Elementor, Divi, ACF, plugins or themes.

**Evidence:** commits `d38a88e` *Replace WordPress build instructions with custom
SiteGround architecture* and `a0354aa` *Define SiteGround website build
architecture*; `CLAUDE.md` §§ Website build direction, Hosting.

**Implications:** deployment stays portable — no Vercel/Netlify/Cloudflare Pages
assumption, and no platform lock-in.

## 2026-08-08 — The assessment is deterministic, and locked

**Decision:** Assessment scoring, branching, commercial scoring, opportunity
flags and recommendation eligibility are implemented from structured typed
configuration, exactly as specified in
`docs/04-assessment/implementation-spec.md`.

**Evidence:** commit `aeb390e` *Lock deterministic V1 assessment implementation
logic*; `src/lib/assessment/` (`runAssessment.ts`, `calculatePublicScore.ts`,
`calculateCommercialScore.ts`, `calculateROI.ts`, `evaluateFlags.ts`,
`getRecommendations.ts`, `optionVisibility.ts`); `CLAUDE.md` § Assessment
implementation authority.

**Implications:** do not infer assessment logic from prose, and do not hard-code
questions into separate UI components. **AI may later explain results but must
not determine scores or financial estimates.**

## UNKNOWN DATE (by 2026-08-13) — Astro, static-first

**Decision:** Astro is the framework for the marketing/content layer;
`output: 'static'`, pre-rendered pages, minimal client JavaScript. Next.js only
if application requirements clearly justify it.

**Evidence:** `astro.config.mjs` (with the comment "no adapter, no SSR, no
Node.js runtime required at deploy time"); `CLAUDE.md` §§ Preferred technical
architecture, Static-first principle; commit `ea71038` *Add production Astro
website through Sprint 6.1*.

**Implications:** anything needing a secret is server-side or third-party by
construction; performance and SEO are structural rather than bolted on.

## 2026-08-13 → superseded — Booking moved from Calendly to Cal.com

**Decision:** V1 booking was specified on Calendly (`7f22fc0`, `eb76ab6`), and
the live architecture now uses **Cal.com**.

**Evidence:** `docs/cal-booking-webhook.md`; `src/lib/scheduling.ts`;
`src/lib/bookingConfirmation.ts`; `services/sales-brain/.env.example` on the
Sales Brain line names Cal.com as the booking authority with Microsoft Graph as
a fallback.

**Implications:** Calendly-era documents under `docs/` are stale. `brain/TODO.md`
item `ASM-001` exists to reconcile them; do not treat an unreconciled document
as current.

## 2026-08-28 → 2026-09-01 — Two assessment paths, not one

**Decision:** A free short assessment as the public entry point, plus a paid
comprehensive audit ($495) backed by the internal long engine, replacing the
single-assessment funnel.

**Evidence:** commit `989ee8a` *Add free AI assessment and comprehensive audit
funnel*; `src/lib/assessment/quickScore.ts`, `quickPersistence.ts`,
`quickLeadSubmission.ts`; `src/pages/free-ai-assessment/` and
`src/pages/comprehensive-ai-business-audit/`; the retired
`/ai-department-audit` redirect in `astro.config.mjs`.

**Status:** approved and deployed; the canonical single-assessment documents are
**not yet reconciled** (`brain/TODO.md` `ASM-001`, `ASM-002`).

## 2026-09-09 — A phone number is not SMS consent

**Decision:** SMS consent is collected explicitly, with legal sender identity
and SMS terms, and the claim is asserted by tests.

**Evidence:** commits `3b4885c` *a phone number is not SMS consent, and the forms
now say so*, `2cc16ec` *add SMS terms and legal sender identity*, `4c1e01d`
*the assertions that keep the A2P claims true*;
`tests/twilioA2pCompliance.test.ts`; `docs/twilio-a2p-resubmission.md`.

**Implications:** the A2P registration rests on what the forms actually say. A
copy change that breaks the compliance test is a compliance change, not a test
failure.

## 2026-09-09 — One centralized active business identity

**Decision:** The legal/business identity shown on the site comes from one
module rather than being repeated per page.

**Evidence:** commit `f146c07` *centralize the active business identity*;
`src/lib/businessIdentity.ts`; `docs/legal-entity-cutover.md`.

**Reason:** an entity cutover was coming, and an identity repeated across 75
pages is an identity that changes incompletely.

## 2026-09-09 — Honest conversion taxonomy, and developer traffic is marked

**Decision:** Analytics events distinguish what actually happened — a view is
not a lead, a lead is not a booking — and QA/developer traffic is marked so it
stops counting as customers.

**Evidence:** commits `c46e9bb` *enforce honest conversion taxonomy*, `4333317`
*mark developer traffic so QA stops counting as customers*, `0172645` *record
the GA4 baseline, the drift, and the operator runbooks*;
`tests/analyticsIntegrity.test.ts`; `docs/analytics/`.

## 2026-09-09 — Structured data is parsed, not regex-sliced

**Decision:** SEO tests parse JSON-LD as JSON; schema is generated from
`src/lib/schema.ts` with complete Organization and Article nodes.

**Evidence:** commits `9dcf96a` *parse JSON-LD nodes instead of regex-slicing
them*, `a791896` *add complete organization and article schema*;
`tests/seoQuality.test.ts`.

## 2026-09-15 — A locations architecture built to survive a doorway audit

**Decision:** The local/location cluster is built to a written rule set and the
doorway-page risk is measured by a test, not judged by a reviewer.

**Evidence:** commits `3fa3906`, `9aea31d`, `9527d3c` *measure the doorway risk
instead of trusting the reviewer*, `a11bd95` *write down the location rules
before they get rediscovered*; `src/lib/locations.ts`;
`tests/sprint17LocalAuthority.test.ts`; `docs/05-seo/`.

## Standing — Do not invent

**Decision:** Never invent offers, pricing, testimonials, case studies, company
history, partnerships, credentials, revenue claims, ROI, statistics, customer
counts, team members or certifications. Missing information gets a clearly
marked placeholder or a flag for review.

**Evidence:** `CLAUDE.md` § PRIMARY RULE; `AGENTS.md` on `origin/main`;
`brain/README.md` § Truth and safety rules.

**Implications:** this outranks copy quality, conversion rate and deadline. An
indicative internal price range is not a published promise.

## Standing — Source-of-truth hierarchy

**Decision:** When documents conflict: `docs/00-company/launch-decisions.md`,
then other approved `docs/00-company/` strategy, then `docs/04-assessment/`,
then `docs/03-products/`, then `docs/02-website/`, then older planning or
research documents.

**Evidence:** `CLAUDE.md` § Source of truth hierarchy; `brain/README.md`
§ Authority map, which adds `brain/TODO.md` for current status and
`brain/DECISIONS.md` for decisions made after older documents.

## Standing — URL structure is not changed casually

**Decision:** The canonical route list (`/ai-assessment/`, `/ai-consulting/`,
`/ai-implementation/`, `/ai-growth-systems/`, `/managed-ai-department/`,
`/google-ads/`, `/meta-ads/`, `/seo/`, `/ai-training/`, `/ai-workshops/`,
`/executive-ai-coaching/`, `/ai-department-method/`, `/about/`, `/contact/`)
is stable, with `trailingSlash: 'always'`.

**Evidence:** `CLAUDE.md` § URL consistency; `astro.config.mjs`;
`tests/routes.test.ts`.

**Implications:** a retired route gets a redirect, never a 404 — see the
`/ai-department-audit` entry in `astro.config.mjs`.

## Standing — Enterprise is part of V1 and bypasses the SMB funnel

**Decision:** `/enterprise/` exists in V1 with its own CTA ("Discuss an
Enterprise Engagement"). Enterprise visitors are not forced through the public
assessment.

**Evidence:** `CLAUDE.md` § Enterprise; `src/pages/enterprise/`.

## Standing — An empty file is not a work order

**Decision:** Many repository files are placeholders. An empty file does not
mean "generate this page".

**Evidence:** `CLAUDE.md` § Empty file rule. `CHANGELOG.md`, `ROADMAP.md`,
`TODO.md`, `VISION.md` and `LICENSE.md` at the repository root are all zero
bytes on this branch — that is the rule's own illustration.
