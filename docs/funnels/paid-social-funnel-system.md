# Paid-Social VSL Funnel System

The architecture behind `/plumbing-ai/`, `/personal-injury-ai/`, and `/divorce-law-ai/`, and how to add the next one.

These are **direct-response landing pages for paid video traffic**, not SEO pages. They are not linked from site navigation, they are excluded from search, and they exist to move a visitor from a UGC/VSL ad to a booked call.

---

## 0. Section budget — the rule that keeps these pages converting

These pages were reduced by roughly 50% in the conversion pass (from ~3,400 visible words and 16-17 sections each). The budgets below are enforced by `tests/paidSocialFunnels.test.ts`, not by good intentions:

| Funnel | Major sections | Visible-word ceiling |
|---|---|---|
| `/plumbing-ai/` | **6-8** | 2,100 |
| `/personal-injury-ai/` | **7-9** | 2,100 |
| `/divorce-law-ai/` | **7-9** | 2,000 |

Header and footer are not counted. The suite also caps leak points (max 4), capabilities (max 6), system pillars (exactly 4), deliverables (8-10), offer bullets (5-8), offer footnotes (max 2), process steps (3-4), demo slots (max 4), FAQs (5-6), fit items (4-5), not-fit items (2-3), hero bullets (max 3), cards per page (max 12), and per-card word count (max 48).

**Before adding anything, the question is:** does this materially increase the chance that a cold paid-social visitor books the next step? If not, it belongs in the sales call, not on the page. A funnel that genuinely needs another section needs a decision — which is exactly why the ceilings are assertions rather than comments.

### The flow

1. **Hero + VSL + CTA** — what is this and why should I care?
2. **The leak** — do I have this problem? (3-4 points; the attorney funnels show the acquisition chain here)
3. **The system** — how does this fix it? (a flow diagram plus either 6 capabilities or 4 pillars)
4. **What we build & manage** — attorney funnels only; an 8-10 item checklist
5. **Offer / investment** — what do I get and what does it cost?
6. **How it works** — 3-4 steps (family law merges this into proof)
7. **Proof** — can I believe this?
8. **Fit + objections** — what is stopping me? (qualification and FAQ merged)
9. **Close** — what do I do now?

Sections removed or merged in the conversion pass: the standalone cost-of-the-broken-process essay, the standalone acquisition-chain section, the separate capability grid, the standalone qualification section, the alternatives-comparison section, and all four repeated CTA band strips. `FunnelValue`, `FunnelBands`, `FunnelQualification`, `FunnelCost`, and `FunnelCapabilities` no longer exist in the type contract, and a test asserts they are not reintroduced.

### CTA placement

Four in-page CTAs — hero, offer, fit/FAQ, close — plus a mobile-only sticky bar. Not a strip after every section: the previous version had seven, which trains a reader to scroll past them. The sticky bar is hidden above 900px and hidden while either the hero or the final CTA is on screen, and is tracked as `cta_location="sticky"` so it can be removed on evidence.

### Visual system

Content width is 1160px (the funnels own `.fnl-container`; they do not inherit the site's 1280px marketing `Container`). Body copy is 17px, stepping to 18px at 900px. Prices render at display size. Tone alternation is capped at six switches per page, with adjacent related sections sharing a background and the offer as the only mid-page dark block, so it reads as the page's centre of gravity.

---

## 1. Architecture

Content is data. Structure is one component. A route is three lines.

```
src/lib/funnels/types.ts        The FunnelConfig contract (what a funnel may contain)
src/lib/funnels/analytics.ts    Pure GA4 payload builders + the PII guard
src/data/funnels/<slug>.ts      ALL copy, pricing, offers, FAQs for one funnel
src/data/funnels/index.ts       Registry (FUNNELS, FUNNELS_BY_ID)
src/components/funnel/
  FunnelPage.astro              Renders an entire funnel from one config
  FunnelCTA.astro               The single tracked CTA button
  FunnelVSL.astro               The video player
  FunnelAnalytics.astro         The only analytics source on the page
  FunnelHeader.astro            Minimal header (branding only)
  FunnelFooter.astro            Minimal footer (legal links only)
  FunnelStyles.astro            All .fnl-* styles, token-based
src/layouts/FunnelLayout.astro  BaseLayout with chrome="minimal"
src/pages/<slug>/index.astro    Three-line route
```

**Why config-driven.** The direct-response *sequence* — hook, problem, cost, mechanism, capability, offer, process, proof, qualification, value, objections, close — is the same argument in every vertical. What must differ is every word inside it. Fixing the structure in one component and putting the words in data means a new vertical can't accidentally ship a half-built page, and copy changes never touch markup.

**What is deliberately NOT shared:** hooks, headlines, pain points, offers, pricing, objections, examples, CTA labels, qualification criteria, and the copy on all four repeated CTA bands. `tests/paidSocialFunnels.test.ts` asserts CTA labels and band copy are unique across funnels — the guard against a funnel degrading into a keyword substitution of another one.

---

## 2. Adding a new funnel (roofing, HVAC, another legal niche)

1. Add the vertical and funnel id to the `FunnelVertical` / `FunnelId` unions in `src/lib/funnels/types.ts`.
2. Add the booking-click event name to `FUNNEL_BOOKING_CLICK_EVENTS` in `src/lib/funnels/analytics.ts`.
3. Write `src/data/funnels/<slug>.ts` — the whole funnel, as a `FunnelConfig`.
4. Register it in `src/data/funnels/index.ts`.
5. Create `src/pages/<slug>/index.astro`:
   ```astro
   ---
   import FunnelLayout from '../../layouts/FunnelLayout.astro';
   import { yourFunnel } from '../../data/funnels/<slug>';
   ---
   <FunnelLayout funnel={yourFunnel} />
   ```
6. Add the route to the noindex inventory in `tests/seoQuality.test.ts` (an exact-list assertion — this is intentional, so a new noindex page is always a deliberate decision).
7. Add the campaign and creative prefix to `docs/analytics/creative-naming-convention.md`.
8. Add the new `booking_click_*` event to `docs/analytics/funnel-tracking-plan.md` and create its GTM trigger.

Never copy a page template.

---

## 3. VSL assets — where the video gets configured

**Currently: no VSL asset is configured on any funnel.** `vsl` is `undefined` in all three configs, so the hero renders as a clean copy-led layout. There is no empty player well and no "video coming soon" placeholder — an obviously unfinished page destroys the credibility the copy is building.

VSL/UGC assets are produced in a separate workflow. When one is ready:

### Self-hosted (recommended — full analytics)
1. Put the file in `public/video/` — e.g. `public/video/plumbing-ugc-vsl-01.mp4`
2. Put a poster frame alongside it — e.g. `public/video/plumbing-ugc-vsl-01.jpg`
3. In `src/data/funnels/plumbing-ai.ts`, replace `vsl: undefined,` with:
   ```ts
   vsl: {
     kind: 'file',
     src: '/video/plumbing-ugc-vsl-01.mp4',
     poster: '/video/plumbing-ugc-vsl-01.jpg',
     captions: '/video/plumbing-ugc-vsl-01.vtt', // optional but recommended
     aspectRatio: '9 / 16',   // vertical UGC; use '16 / 9' for landscape
     autoplayMuted: false,    // audio NEVER autoplays
     label: 'How an AI front desk handles a plumbing call',
   },
   ```
4. Rebuild. The hero switches to a two-column layout at ≥960px automatically.

**Encoding guidance:** H.264 MP4, web-optimized (`faststart`), under ~15 MB where possible. `preload="none"` means nothing downloads until the visitor presses play, so the page stays fast, but a large file still hurts the people who do play it.

**Always supply a poster.** Without one the player is a black box and both LCP and perceived quality suffer.

### Third-party embed
```ts
vsl: {
  kind: 'embed',
  embedUrl: 'https://player.vimeo.com/video/XXXXXXXX',
  aspectRatio: '16 / 9',
  label: 'How an AI front desk handles a plumbing call',
},
```

**Analytics caveat:** an embed emits **no** `vsl_play` and **no** `vsl_progress`. A cross-origin iframe cannot be observed without that vendor's SDK, and inventing an engagement signal is worse than having none. If you need VSL engagement audiences — and for creative testing you do — use the self-hosted path, or add the vendor's SDK and map its events to the same names.

---

## 4. Indexation decision: `noindex, follow`

**All three funnels are `noindex, follow` and excluded from `sitemap.xml`.**

**Why noindex.** These pages materially overlap existing organic pages — `/industries/plumbing/` and `/industries/law-firms/` — which are indexed, in the sitemap, and internally linked. Two pages competing for the same intent split ranking signals, and the paid landing page is the wrong one to win: it is written for a visitor who has already seen a video ad, not for someone searching cold.

**Why `follow` rather than the site's default `noindex, nofollow`.** The funnels link back to `/`, `/about/`, `/contact/`, `/privacy/`, and `/terms/`. `follow` lets that equity flow. There is no reason to strand it. (`SEO.astro` gained an optional `robots` prop for exactly this; every other page still uses the `noindex` boolean and its unchanged `noindex, nofollow` default.)

**No canonical is emitted.** This follows the site's existing rule: a noindex page has no indexable URL to consolidate, and emitting a canonical from an excluded page creates a canonical-to-excluded anomaly in Search Console. Google treats a noindex page without a canonical as exactly what it is.

**The existing SEO industry pages are untouched.** A test asserts they remain indexable, self-canonical, and in the sitemap.

**If this is revisited:** if a funnel is ever wanted in organic search, the correct move is to fix or replace the overlapping industry page — not to index both.

---

## 5. Scheduling

All three funnels point at the existing free **AI Strategy Call** Cal.com event (`SCHEDULING.strategyCall`). No new Cal.com event was invented, and no Cal.com URL is hardcoded anywhere in the funnel code — a test asserts both.

Because the href is the plain centralized URL, the site-wide machinery already applies to it:
- `AttributionCapture.astro` rewrites it with UTMs, click IDs, `creative_id`, and the rep code
- `AnalyticsEvents.astro` still fires `booking_click_strategy`
- `/booking-confirmed/` still fires the UID-gated `booking_confirmed`

### Recommended dedicated Cal.com events (not blocking)
Worth creating when volume justifies separate calendars and confirmation copy:

| Event | For | Why |
|---|---|---|
| **Plumbing AI Front Desk Demo** | `/plumbing-ai/` | The CTA promises a demo, not a strategy call. Matching the calendar to the promise reduces no-shows. |
| **Law Firm AI Growth Strategy Call** | `/personal-injury-ai/` and `/divorce-law-ai/` | Attorney-appropriate duration and intake questions; likely a longer slot. |

To adopt one: add it to `SCHEDULING` in `src/lib/scheduling.ts`, add its URL to the enriched list in `AttributionCapture.astro`, add a `booking_click_*` branch in `AnalyticsEvents.astro`, add the type to `ALLOWED_BOOKING_TYPES` in `src/lib/bookingConfirmation.ts`, and point the funnel's CTAs at it. Until then the strategy call is a correct, fully-instrumented destination.

---

## 6. Proof standard

We do not have published client results in these verticals, so the funnels build credibility without them:

1. **Offer specificity** — exact deliverable lists, not adjectives
2. **Process proof** — the six implementation steps, stated concretely
3. **Capability proof** — what the system does, and explicitly what it does not
4. **Demo proof** — `proof.demoSlots` describes what will be shown live
5. **Defensible company experience** — attribution and tracking are genuinely standing service lines
6. **Labeled hypotheticals** — the one numeric block (plumbing `cost.scenario`) renders a visible "Illustrative example — not a result, not a promise" badge and a mandatory disclaimer, and uses the reader's own figures as inputs
7. **Boundary honesty** — `mechanism.boundaries` states the limits up front, which is itself a credibility mechanism
8. **An empty testimonial slot** — `proof.note` says plainly that we have no published results yet and will not invent any

**No** testimonials, reviews, client names, logos, case studies, statistics, ROI figures, conversion-rate claims, countdown timers, or fake scarcity appear on any funnel. Tests assert the absence of each, including a blanket rule that **no percentage may appear in visible funnel copy** — any percentage would be an unsourced statistic.

When a real, permissioned client result exists, it goes in `proof.note` / a new proof block — and not before.

---

## 7. Attribution and analytics

Both extend the existing architecture rather than competing with it.

- `src/lib/attribution.ts` gained two fields: `fbclid` (Meta click ID, needed for any future CAPI matching) and `creative_id` (optional internal creative label, sanitized on capture). Both inherit first-touch/latest-touch semantics, Cal.com link enrichment, and lead-payload inclusion automatically. `utm_content` was already captured and remains the **primary** creative identifier.
- A test asserts no new storage keys were introduced — the funnels reuse `yai_attribution_first`, `yai_attribution_latest`, and `yai_rep_attribution`.
- Funnel events (`funnel_view`, `vsl_play`, `vsl_progress`, `funnel_cta_click`, `booking_click_*`) are documented in `docs/analytics/funnel-tracking-plan.md`.
- Creative naming rules are in `docs/analytics/creative-naming-convention.md`.
- Meta Pixel / CAPI status and setup are in `docs/analytics/meta-pixel-and-capi.md`.

---

## 8. Design and performance constraints

- Minimal header (branding only) and minimal footer (legal only). A visitor from a video ad chooses between reading on and booking — not between twenty navigation destinations.
- Exactly one primary CTA, at four in-page placements plus the mobile sticky bar.
- Existing brand tokens only — midnight navy, electric blue, signal cyan. A test enforces a small allowlist of non-token colors.
- No client framework, no animation library, no third-party script beyond the existing GTM container. Tests assert all three.
- Mobile-first: 58px CTA tap targets (52px in the sticky bar), flow diagrams scroll inside their own container so the body never scrolls sideways, decorative gradients are clipped, and every grid stacks to one column by default.
