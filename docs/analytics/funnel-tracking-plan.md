# Funnel Tracking Plan — GA4 / GTM Handoff

**Scope:** paid-social VSL funnels (`/plumbing-ai/`, `/personal-injury-ai/`, `/divorce-law-ai/`) plus the existing site events they interact with.
**Container:** GTM-5G8Q7KKZ (already installed site-wide in `src/layouts/BaseLayout.astro`).
**GA4 property:** G-GLSRPH43L4, managed through that container — do not add a second gtag.js snippet.
**Code source of truth:** `src/lib/funnels/analytics.ts` (pure builders, unit-tested in `tests/paidSocialFunnels.test.ts`).

---

## 1. Principles this plan enforces

1. **One event source.** Every event below is a first-party `dataLayer.push` from site code. GTM tags read those pushes. Meta tags, when the Pixel is configured, read the *same* pushes. There is never a second parallel tracking implementation.
2. **A click is not a conversion.** `booking_click_*` means someone clicked toward Cal.com. `booking_confirmed` means a booking actually exists, gated by a Cal.com booking UID. These must never be conflated, in GA4 or in Meta.
3. **No PII, ever.** Every parameter below is an ad-platform identifier, an internal campaign label, or a fixed enum. No name, email, phone, company, or free-text intake data reaches GA4. Enforced by `isPiiFreePayload()` and asserted in tests.
4. **Nothing existing is renamed.** The assessment event family and `booking_confirmed` are untouched. Retired `ai_quick_score*` names are not revived.

---

## 2. Event reference

Legend — **Tier:** `micro` = intent signal, `conversion` = real business outcome.

### `page_view`
| | |
|---|---|
| Trigger | Every pageview, including funnels |
| Funnel | All + site-wide |
| Parameters | `page_location`, `page_referrer`, `page_title` (GA4 automatic) |
| Emitted by site code? | **No** — the existing GA4 configuration tag in GTM |
| GTM work needed | None. Already working. |
| GA4 custom dimension | None |
| Key event? | No |
| Meta equivalent | `PageView` (Pixel base code, when configured) |
| Tier | micro |

> UTMs on the funnel landing URL are picked up by GA4 automatically through `page_location`. `utm_content` is therefore already in standard GA4 traffic-acquisition reporting — the funnel events below add it as an **event parameter** as well, so creative attribution survives onto later in-session events where the URL no longer carries it.

### `funnel_view`
| | |
|---|---|
| Trigger | Once per funnel pageview, on load |
| Funnel | plumbing_ai / personal_injury_ai / divorce_law_ai |
| Parameters | `vertical`, `funnel_id`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `creative_id` |
| dataLayer payload | `{event:'funnel_view', vertical:'plumbing', funnel_id:'plumbing_ai', utm_source:'meta', utm_medium:'paid_social', utm_campaign:'plumbing_ai', utm_content:'plumbing_ugc_vsl_01', creative_id:'plumbing_v1_missed_calls_hook'}` |
| Emitted by site code? | **Yes** — `src/components/funnel/FunnelAnalytics.astro` |
| GTM work needed | Custom Event trigger `funnel_view` → GA4 Event tag |
| GA4 custom dimensions | `vertical`, `funnel_id`, `creative_id`, `utm_content` |
| Key event? | **No** — a landing is not a conversion |
| Meta equivalent | `ViewContent` |
| Tier | micro |

### `vsl_play`
| | |
|---|---|
| Trigger | First playback start of the hero VSL, once per pageview |
| Funnel | Any funnel with a **self-hosted** video (`vsl.kind === 'file'`) |
| Parameters | `vertical`, `funnel_id`, creative params |
| Emitted by site code? | **Yes** |
| GTM work needed | Custom Event trigger `vsl_play` → GA4 Event tag |
| GA4 custom dimensions | as above |
| Key event? | No |
| Meta equivalent | Custom event `VSLPlay` |
| Tier | micro |

> **Availability caveat.** Play/progress events fire only for self-hosted `<video>`. For a third-party embed (`vsl.kind === 'embed'`) the browser cannot observe playback cross-origin without that vendor's SDK, so **no** engagement events are emitted. This is deliberate — a fabricated engagement signal is worse than a missing one. If a hosted player is chosen later, add that vendor's SDK and map its events to these same names.

### `vsl_progress`
| | |
|---|---|
| Trigger | Once per crossed threshold per pageview: 25 / 50 / 75 / 100 |
| Funnel | Self-hosted VSL only |
| Parameters | `vertical`, `funnel_id`, `vsl_progress` (**number**), creative params |
| dataLayer payload | `{event:'vsl_progress', vertical:'plumbing', funnel_id:'plumbing_ai', vsl_progress:50, utm_content:'plumbing_ugc_vsl_01'}` |
| Emitted by site code? | **Yes** |
| GTM work needed | Custom Event trigger `vsl_progress` → GA4 Event tag; forward `vsl_progress` as a number |
| GA4 custom dimension | `vsl_progress` is best registered as a **custom metric** or used in audience conditions with `>=` |
| Key event? | No |
| Meta equivalent | Custom event `VSLProgress` |
| Tier | micro |

> Sent as a number specifically so ">= 50% watched" audiences work without string parsing. `ended` also backfills any thresholds a browser's final `timeupdate` tick skipped, so a full watch always registers 100.

### `funnel_cta_click`
| | |
|---|---|
| Trigger | Click on any primary CTA on a funnel page |
| Funnel | All three |
| Parameters | `vertical`, `funnel_id`, `cta_location` (`hero`\|`offer`\|`faq`\|`final`\|`sticky`), `cta_type` (`demo`\|`strategy_call`), creative params |
| Emitted by site code? | **Yes** |
| GTM work needed | Custom Event trigger `funnel_cta_click` → GA4 Event tag |
| GA4 custom dimensions | `cta_location`, `cta_type` + the funnel/creative set |
| Key event? | **No** — intent, not outcome |
| Meta equivalent | `AddToCart` (a mid-funnel intent signal) |
| Tier | micro |

> **`cta_type` values in production.** All three funnels currently emit `cta_type: "strategy_call"`. The plumbing funnel emitted `"demo"` until the CTA-correction pass: we build custom AI Front Desk implementations and have no generic AI voice demo to play, so the CTA, the proof section, and the parameter were all corrected together. No event was renamed or removed — this is a parameter **value** change only. `"demo"` remains valid in the enum for a future funnel that genuinely offers one.
>
> **CTA placements (conversion pass).** There are four in-page CTAs — `hero`, `offer`, `faq`, `final` — plus `sticky`, the mobile-only bar. The earlier version had seven CTAs across four repeated band strips; those bands were removed, so `problem` and `mechanism` no longer occur.
>
> `sticky` is the persistent mobile bar (hidden above 900px, and hidden while either the hero or the final CTA is on screen). It fires the **same** `funnel_cta_click` + `booking_click_*` pair as any other CTA — it is not a new event, only a new value of `cta_location` — so its contribution can be measured separately and the bar removed on evidence if it earns nothing.
>
> **Watch for:** if `sticky` dominates conversions, the in-page CTAs are too weak or too sparse. If it produces nothing, remove the bar.

### `booking_click_plumbing_ai` / `booking_click_pi_ai` / `booking_click_divorce_ai`
| | |
|---|---|
| Trigger | Same click as `funnel_cta_click` — every funnel CTA points at the Cal.com AI Strategy Call |
| Funnel | One event name per funnel |
| Parameters | Identical to `funnel_cta_click` |
| Emitted by site code? | **Yes** |
| GTM work needed | Three Custom Event triggers → GA4 Event tags (or one regex trigger `^booking_click_(plumbing_ai|pi_ai|divorce_ai)$`) |
| GA4 custom dimensions | funnel/creative set + `cta_location` |
| Key event? | **No.** See warning below. |
| Meta equivalent | `InitiateCheckout` |
| Tier | micro |

> ⚠️ **Relationship to `booking_click_strategy`.** The existing site-wide handler in `AnalyticsEvents.astro` still fires `booking_click_strategy` for every AI Strategy Call link, funnels included. So a funnel CTA click produces **three** pushes: `funnel_cta_click`, `booking_click_<funnel>`, and `booking_click_strategy`. This is intentional — `booking_click_strategy` is the site-wide superset, the funnel event is the narrower subset. Do **not** sum them. Do not mark either as a key event.

### `ai_assessment_start` / `ai_assessment_complete` / `ai_assessment_lead_submit`
| | |
|---|---|
| Trigger | Existing assessment funnels — unchanged by this work |
| Parameters | `assessment_type` (`free_opportunity`\|`comprehensive_audit`), `assessment_version` (`short_v1` for the free funnel), plus `lead_id` and `score_band` on lead submit |
| Emitted by site code? | **Yes** — `AnalyticsEvents.astro` and the assessment apps |
| GTM work needed | Already configured. Do not rename. |
| GA4 custom dimensions | `assessment_type`, `assessment_version` |
| Key event? | **`ai_assessment_lead_submit`: YES.** The other two: no. |
| Meta equivalent | `Lead` (on lead submit only) |
| Tier | `lead_submit` = conversion; start/complete = micro |

> A visitor who arrives on a funnel and then enters the free assessment keeps their creative attribution: it is stored first-party by `src/lib/attribution.ts` and travels onto the lead payload as `attribution_utm_content` / `attribution_creative_id`.

### `booking_confirmed`
| | |
|---|---|
| Trigger | `/booking-confirmed/` loaded with a Cal.com booking UID, once per UID |
| Funnel | All (site-wide) |
| Parameters | `booking_source: 'cal.com'`, `booking_type` |
| Emitted by site code? | **Yes** — `src/pages/booking-confirmed/index.astro` + `src/lib/bookingConfirmation.ts` |
| GTM work needed | Already configured. **Unchanged by this work.** |
| GA4 custom dimension | `booking_type` |
| Key event? | **YES — the primary conversion.** |
| Meta equivalent | `Schedule` |
| Tier | conversion |

---

## 3. Recommended GA4 key events

Mark **only** these two:

| Event | Why |
|---|---|
| `booking_confirmed` | A call was genuinely booked. The real business outcome. |
| `ai_assessment_lead_submit` | A real lead was submitted. |

Explicitly **not** key events: `funnel_view`, `vsl_play`, `vsl_progress`, `funnel_cta_click`, any `booking_click_*`, `ai_assessment_start`, `ai_assessment_complete`. Marking a CTA click as a conversion is how a campaign gets optimized toward clicking rather than booking.

---

## 4. GA4 custom dimensions to register

Admin → Custom definitions → Create custom dimension. All **event-scoped** unless noted.

| Dimension name | Event parameter | Scope | Why |
|---|---|---|---|
| Vertical | `vertical` | Event | Compare plumbing vs. PI vs. family law |
| Funnel ID | `funnel_id` | Event | Per-funnel reporting |
| Creative ID | `creative_id` | Event | Internal human-readable creative label |
| Ad Creative (utm_content) | `utm_content` | Event | **Primary** creative attribution, carried onto in-session events |
| CTA Location | `cta_location` | Event | Which placement produced the click (`hero`/`offer`/`faq`/`final`/`sticky`) |
| CTA Type | `cta_type` | Event | demo vs. strategy_call |
| Assessment Type | `assessment_type` | Event | Existing — register if not already |
| Assessment Version | `assessment_version` | Event | Existing — register if not already |
| Booking Type | `booking_type` | Event | Existing — register if not already |
| VSL Progress | `vsl_progress` | Event (metric) | Register as a custom **metric** for threshold audiences |

> `utm_content` is also available natively in GA4's traffic-acquisition reports via `page_location`. Registering it as an event parameter dimension is what lets you segment *funnel events* — not just sessions — by creative.

---

## 5. GTM configuration checklist

**Triggers to create** (Trigger type: Custom Event, exact event name):
- `funnel_view`
- `vsl_play`
- `vsl_progress`
- `funnel_cta_click`
- `booking_click_plumbing_ai`
- `booking_click_pi_ai`
- `booking_click_divorce_ai`

**Variables to create** (Data Layer Variable, Version 2):
`vertical`, `funnel_id`, `creative_id`, `utm_content`, `utm_campaign`, `utm_source`, `utm_medium`, `cta_location`, `cta_type`, `vsl_progress`

**Tags to create:** one GA4 Event tag per trigger above, event name matching the dataLayer event, with the relevant variables passed as event parameters. Reuse the existing GA4 Configuration tag — do not create a second one.

**When the Meta Pixel is configured:** add the base Pixel tag on All Pages and event tags on the same triggers, per the mapping in `src/lib/metaPixel.ts` (`META_EVENT_MAP`). See `docs/analytics/meta-pixel-and-capi.md`.

**Do not** attempt to configure GTM/GA4 accounts from repo code. Everything in this section is manual work in those consoles.

---

## 6. Answering "which video creative produced this booked call?"

Two independent paths, deliberately:

1. **Cal.com booking record (authoritative).** `AttributionCapture.astro` rewrites every centralized Cal.com link with the stored latest-touch attribution, which now includes `utm_content` and `creative_id`. The creative is therefore attached to the booking record itself, not inferred. This survives GA4 session expiry, consent changes, and cross-device gaps in analytics.
2. **GA4 (behavioral).** `booking_confirmed` fires in the same session; funnel events in that session carry `utm_content` / `creative_id`, and `page_location` on the landing pageview carries the UTMs.

Path 1 is the one to trust for revenue attribution. Path 2 is for behavioral analysis and audience building.

---

## 7. Reporting chain to build

For each creative (`utm_content`):

`funnel_view` → `vsl_play` → `vsl_progress ≥ 50` → `funnel_cta_click` → `booking_click_*` → `booking_confirmed` → (offline) signed client / booked job value

Compare creatives on **`booking_confirmed` per 1,000 funnel views**, not on CTR and not on CTA clicks. A creative that produces many clicks and no bookings is attracting the wrong buyer.

---

## 8. Verification

Before spending on any of these funnels:
1. Load a funnel with the full tagged URL. Confirm in GTM Preview: `funnel_view` fires once, carrying `utm_content` and `creative_id`.
2. Click a CTA. Confirm `funnel_cta_click` + `booking_click_<funnel>` + `booking_click_strategy` all fire, and that the outbound href carries `utm_content` and `creative_id`.
3. Complete a real test booking. Confirm the Cal.com booking record shows `utm_content` / `creative_id`, and that `booking_confirmed` fires exactly once on `/booking-confirmed/`.
4. Reload `/booking-confirmed/`. Confirm `booking_confirmed` does **not** fire again.
