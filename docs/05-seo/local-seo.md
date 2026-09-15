# Local SEO & Location Architecture

**Status:** Active. Established Sprint 17 (2026-09-15).
**Implementation:** `src/lib/locations.ts`, `src/pages/locations/`
**Enforced by:** `tests/sprint17LocalAuthority.test.ts`

This document governs how Your AI Department builds location pages. It exists because
location SEO is the single easiest area of this site to get wrong in a way that is expensive
and slow to undo — a doorway-page pattern, or a claimed office that does not exist.

---

## 1. The two hard rules

### RULE 1 — NO LOCATION PAGE MAY CLAIM AN OFFICE OR ADDRESS WITHOUT A REAL VERIFIED BUSINESS LOCATION.

Your AI Department has **one** verified business address, recorded in
`src/lib/businessIdentity.ts` and published on the Privacy, Terms and SMS Consent pages. It
is a mail-handling suite address in Northeast Florida. It is **not** a staffed office, and
there is **no** premises in Orlando, Winter Park, Miami or Fort Lauderdale.

Therefore:

- No location page repeats the street address. The legal pages are where it belongs.
- No page emits `LocalBusiness`, `PostalAddress`, `GeoCoordinates`, `address` or
  `openingHours` schema. Not on location pages, not anywhere on the site.
- No page says "our Orlando office", "headquarters", "visit us" or "walk-in".
- The correct phrasing is **"Serving Orlando businesses"**, never "Our Orlando office".
- `areaServed` on a `Service` node is the honest way to express coverage. It describes
  where a service is offered, not a place the company occupies.

The test suite fails the build on any of these, site-wide, including a negation check so
that "we do **not** operate a Jacksonville office" stays publishable while an unqualified
claim does not.

### RULE 2 — NO MASS CITY-PAGE GENERATION.

Location pages are added **one at a time, intentionally**, on commercial priority, real
demand, or genuine business presence. Never in bulk, never from a list of cities, never by
mapping a template over a data array.

`src/lib/locations.ts` holds the market registry and the schema builder. It deliberately
does **not** hold page copy, and must not start to. If a future change adds
`problems: string[]` or `industries: string[]` to a `Market` entry so pages can render them
generically, that change *is* the doorway-page refactor. Reject it.

---

## 2. Why the doorway rule matters

Google treats substantially similar city pages that exist mainly to funnel users to the same
destination as doorway abuse. It is a manual-action category, not a ranking nuance, and the
remedy is removal.

The test measures it rather than trusting reviewers. Every pair of market pages is compared
using 6-word shingle Jaccard similarity over the rendered `<main>` text, and any pair above
**0.18** fails.

Measured at implementation with seven pages: worst pair 0.019, median 0.016 — roughly ten
times under the limit. A city-variable template scores an order of magnitude higher. The
threshold is therefore loose enough for honest editing and an eighth market, and tight
enough that a template cannot pass.

Shared **components** are fine and expected — header, footer, hero, card grids, CTA bands,
FAQ styling. Shared **substantive copy** is not.

---

## 3. Required unique content per location page

Before a location page ships it must answer all six, in market-specific terms:

1. What kinds of businesses operate here?
2. What operational problems are common for those businesses?
3. Where can AI and automation realistically help?
4. Why would a local business choose Your AI Department?
5. What systems could we actually implement?
6. How does an engagement start?

And it must have its own **distinguishing spine** — one argument that is true of this market
and not simply reused. The first wave:

| Market | Spine — the argument this page owns |
|---|---|
| Jacksonville | Physical scale of the metro; territory, dispatch and routing as structural cost |
| St. Augustine | Owner-operator capacity inside a seasonal, visitor-driven economy |
| St. Johns County | Growth economics — adding capacity without adding admin overhead at the same rate |
| Orlando | Throughput; consistency across very high contact volume, shift-based teams |
| Winter Park | Low volume, very high value per enquiry; professional-judgment boundaries |
| Miami | Cross-border operation — time zones, channels, referral networks, long document cycles |
| Fort Lauderdale | Quoted, scheduled project work; the marine cluster; capacity-constrained scheduling |

Two pairs are deliberately watched by the test because they are the most plausible to
collapse into each other: **St. Augustine / St. Johns County** and **Orlando / Winter Park**.
Miami and Fort Lauderdale are watched for theme bleed in both directions.

Minimum bar: ~1,100 words of substantive body copy, a market-specific FAQ (no question may
appear on more than two of the seven pages), and full server-rendered copy — the page must
be useful with JavaScript disabled.

---

## 4. Approved first-wave markets

```
/locations/                        hub
/locations/st-augustine-fl/        Northeast Florida
/locations/jacksonville-fl/        Northeast Florida
/locations/st-johns-county-fl/     Northeast Florida
/locations/orlando-fl/             Central Florida
/locations/winter-park-fl/         Central Florida
/locations/miami-fl/               South Florida
/locations/fort-lauderdale-fl/     South Florida
```

URL pattern: `/locations/<city-or-area>-fl/`. Do not change it casually — it affects
redirects and existing indexing.

---

## 5. Future market candidates — documented, NOT built

Recorded so the next sprint does not have to rediscover the shortlist. **None of these has a
page, and none appears in the sitemap.** Creating an empty or templated page for any of them
violates Rule 2.

- Tampa
- West Palm Beach / Palm Beach County
- Boca Raton
- Naples
- Sarasota
- Fort Myers

The test asserts that no page or sitemap entry exists for these slugs, so a stub added
without content fails the build.

### How to select the next market

In priority order:

1. **Real business presence or a repeatable referral source** in that market.
2. **Commercial priority** — a vertical we already serve is concentrated there.
3. **Demonstrated demand** — Search Console impressions for that geography, read the way
   `docs/sprint16-gsc-demand-expansion.md` reads query demand: as direction, over weeks.

Never "it is a big city in Florida." That reasoning produces doorway pages.

---

## 6. Schema rules

Location pages emit exactly two JSON-LD nodes:

- **`Service`** — `name`, `description`, `serviceType`, `provider` (the shared
  `organizationRef()`), `areaServed`, `url`. Built by `locationServiceSchema()` in
  `src/lib/locations.ts`; never hand-typed on a page.
- **`BreadcrumbList`** — via the shared `BreadcrumbSchema` component.

The hub emits `WebPage` + `BreadcrumbList`.

`areaServed` uses `City` for a city and `AdministrativeArea` for a county, each with
`containedInPlace: { "@type": "State", name: "Florida" }`.

Never emitted, anywhere: `LocalBusiness`, `PostalAddress`, `GeoCoordinates`, `openingHours`,
`aggregateRating`, `review`, `offers`, `priceRange`. The first four would imply premises;
the last four would fabricate results or pricing.

`Service` was added to the allowed-type set in `tests/seoQuality.test.ts` for this purpose.
`LocalBusiness` remains disallowed by omission there, and explicitly banned in
`tests/sprint17LocalAuthority.test.ts`.

---

## 7. Internal linking strategy

- The hub links to all seven markets, grouped by region.
- Every market page links back to the hub, to at least three service pages, and to the
  relevant industry pages.
- Markets link laterally only where it genuinely helps a reader (Northeast Florida pages to
  each other; Orlando ↔ Winter Park; Miami ↔ Fort Lauderdale).
- `/ai-consulting/` and `/ai-implementation/` link back to the hub.
- The homepage carries a small location teaser linking to the hub.
- The footer exposes the seven markets in **one compact row**, with the place name as anchor
  text.

Explicitly avoided:

- **Locations is not in the header.** `PRIMARY_NAV` already carries seven items; an eighth
  top-level entry for a seven-page section costs more in clutter than it returns. Revisit
  only if the section grows substantially.
- **No large keyword-heavy city-link block.** The footer row is the maximum. Anchor text is
  the place name — the test fails any footer anchor containing "AI consulting".

---

## 8. Page SEO conventions

- Title: `AI Consulting <City> FL | Your AI Department`. Natural, keyword front-loaded.
  Never `BEST #1 AI CONSULTING COMPANY <CITY>`; the test rejects "best", "#1", "number one",
  "top rated" and exclamation marks in a location title.
- H1: `AI Consulting & Automation for <City> Businesses`, or a natural equivalent.
- Meta description: market-specific, 110–165 characters, unique.
- One H1, self-referencing canonical, no `noindex`, in the sitemap.
- Terms used naturally: AI consulting, AI automation, AI implementation, AI agents, workflow
  automation, business automation. Do not repeat exact keywords unnaturally.

---

## 9. Proof-content sourcing rules

These govern the homepage "Real Systems. Real Business Problems." section
(`src/components/ProofSection.astro`) and any future proof content.

**What may be published:**

- System *types* the company genuinely builds, each corresponding to a capability this site
  already sells on a dedicated page. The link to that page is the evidence.
- The problem a system addresses and what the system does, in operational terms.

**What may NOT be published, absent approved source material:**

- Client names, logos, or identifying details.
- Case studies of specific engagements.
- Performance figures — percentages, currency amounts, multipliers, hours or dollars saved.
- Testimonials.
- Confidential project names, internal architecture, or private metrics.

`docs/02-website/case-studies.md` already forbids fictional case studies. As of this sprint
`docs/02-website/about.md` still records **Founder, Leadership and Headquarters as
"[TO BE PROVIDED]"**, so there is no approved founder biography to publish and none was
invented — the About page gained a regional location statement only.

The editing rule: *if a sentence would need a customer's permission or a number to be true,
it does not belong.* The test asserts the proof section contains no percentage, currency
figure or multiplier, and that "case study" and "testimonial" appear only inside a negation.

When real case studies are approved, they belong in a new section with its own sourcing
record — not retrofitted into these cards.

---

## 10. Pre-ship checklist for a new location page

- [ ] Distinguishing spine identified and written; not a reworded neighbour
- [ ] All six required questions answered in market-specific terms
- [ ] Market-specific FAQ, ≥4 entries, ≤2 shared with any other market page
- [ ] ~1,100+ words of substantive copy, fully server-rendered
- [ ] Title / H1 / meta description unique and within convention
- [ ] `Service` + `BreadcrumbList` schema via the shared builders
- [ ] No address, no office claim, no banned schema type
- [ ] Added to `MARKETS` in `src/lib/locations.ts`
- [ ] Added to `public/sitemap.xml` (static file — not generated)
- [ ] Linked from the hub; links back to hub + ≥3 services
- [ ] `npm test` green, including the similarity threshold
