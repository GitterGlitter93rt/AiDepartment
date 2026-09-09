# Conversion Event Taxonomy — What the Website Emits, and What Each Event Means

**Audience:** whoever configures GA4 and GTM, and whoever later reads a GA4 report and has to decide whether a number represents a sale.

**Scope boundary.** This document describes what the **website emits into `dataLayer`**. It does not configure GA4. Marking an event as a Key Event, building audiences, and wiring Google Ads conversion actions all happen in the GA4 and GTM interfaces, by an operator, and §7 lists exactly what that operator has to do.

**Container:** GTM-5G8Q7KKZ, loaded once in `src/layouts/BaseLayout.astro`. GA4 (G-GLSRPH43L4) is routed through that container. There is no second tag loader anywhere on the site.

---

## 1. The distinction this document exists to protect

In the 28 days before this was written, GA4 recorded roughly **114 Key Events and zero qualified leads.** Both numbers are correct. They measure different things, and the gap between them is the entire problem.

A Key Event in GA4 is whatever an operator ticked a box for. It is not a sale, and nothing on this site may be named or configured so that it reads like one.

So every event below is classified as exactly one of:

| Class | Meaning | May be reported as a sales conversion |
|---|---|---|
| **Diagnostic** | Someone did something on the way to a conversion | **No** |
| **Business conversion** | A real commercial outcome occurred | Yes |

There are exactly **two** business conversions on this site: `booking_confirmed` and — once the CRM can produce it — `qualified_lead`. Everything else is a diagnostic.

---

## 2. `call_booked` — a naming note

The sprint brief that produced these pages referred to the real booked-call conversion as `call_booked`.

**This site emits that conversion under the name `booking_confirmed`.** No `call_booked` event exists, and none should be added.

The reason is not preference. `booking_confirmed` was already implemented, already documented in `brain/TRACKING.md`, and already the name in the GTM configuration work in flight. Adding a second name for the same fact would either double-count every booking in GA4 (if both fire) or split the history at the changeover (if one replaces the other). Neither is worth a rename.

**When reading the brief or any external document: `call_booked` means `booking_confirmed`.**

---

## 3. Diagnostic events

None of these may be configured as a primary sales conversion.

### `cold_lp_view`

| | |
|---|---|
| **Fires** | Once per pageview on `/go/law-firms/` or `/go/roofing/`, as soon as the page renders and JavaScript runs |
| **Means** | A browser rendered a cold-email campaign landing page and executed JavaScript |
| **Does not mean** | A human read it |
| **Parameters** | `audience`, `campaign_id`, the six UTM fields, `rep_code` (when present) |
| **Source** | `src/components/outbound/OutboundAnalytics.astro` |

**Why it exists.** Smartlead reports a click count. In the August roofing sequence that count was ~227 against ~230 opens, with zero replies. A near-100% click rate with no human reply is not a click rate — something is fetching those URLs that is not a roofer, and security appliances, link scanners and privacy proxies all do exactly that.

We cannot inspect Smartlead's counter and must not assert what it is measuring. What we can do is measure the far side of the click ourselves. Comparing the two numbers is the diagnostic:

```
Smartlead clicks    a URL was fetched, by something
cold_lp_view        a browser rendered the page and ran JavaScript
cold_lp_engaged     that browser then stayed, or did something
```

`227 / 12 / 3` and `227 / 210 / 180` tell completely different stories. Today we cannot tell those two worlds apart at all.

**This does not prove humanity.** A determined headless scanner executes JavaScript. It narrows the question; it does not close it.

### `cold_lp_engaged`

| | |
|---|---|
| **Fires** | At most once per pageview on a `/go/` page, on whichever comes first: a real interaction (scroll, pointer, key, touch), or 15 seconds of **visible** time |
| **Means** | The browser that rendered the page then stayed on it or acted on it |
| **Parameters** | `audience`, `campaign_id`, `engagement_signal` (`interaction` \| `dwell`), the six UTM fields, `rep_code` |

Dwell is measured against visible time, not wall-clock, so a page opened in a background tab accrues nothing. `engagement_signal` is a parameter rather than two event names so that "engaged at all" stays one unsplit metric while the stronger signal (`interaction`) remains separable.

### `outbound_cta_click`

| | |
|---|---|
| **Fires** | On any tracked CTA click on a `/go/` page |
| **Parameters** | `audience`, `campaign_id`, `cta_location` (`hero` \| `mid` \| `faq` \| `final` \| `sticky`), `cta_type` (`strategy_call` \| `assessment`), UTMs, `rep_code` |

`cta_type` is the experiment: on a page that offers a cold reader both a call and an assessment, which do they take. It never emits a `booking_click_*` event, and an `assessment` click is never counted as booking intent.

### `booking_click_strategy`, `_enterprise`, `_training`, `_executive_advisory`, `_comprehensive_audit`

| | |
|---|---|
| **Fires** | Site-wide, on a click of the corresponding centralized Cal.com link |
| **Means** | Someone clicked **toward** a scheduler |
| **Does not mean** | A booking happened |
| **Parameters** | `link_url`, the six UTM fields, `rep_code` |
| **Source** | `src/components/AnalyticsEvents.astro` |

**`booking_click_strategy` is not a booked call.** It is the strongest micro-conversion the site has, it is worth optimising against, and it must not be the number anyone reports as sales. The site deliberately does not fire a completion event when someone merely clicks a Cal.com link, and that principle is not up for revision.

These fire on the `/go/` pages too, so `booking_click_strategy` remains the **site-wide superset** of `outbound_cta_click` with `cta_type=strategy_call`. Do not add the two together.

### `funnel_view`, `funnel_cta_click`, `booking_click_plumbing_ai`, `booking_click_pi_ai`, `booking_click_divorce_ai`, `vsl_play`, `vsl_progress`

The paid-social funnel family (`/plumbing-ai/`, `/personal-injury-ai/`, `/divorce-law-ai/`). Same rules: the `booking_click_*` variants are narrower subsets of `booking_click_strategy`, never bookings. Documented in `docs/analytics/funnel-tracking-plan.md`.

### `ai_assessment_start`

| | |
|---|---|
| **Fires** | When a visitor intentionally starts either assessment engine |
| **Means** | An assessment was started |
| **Does not mean** | A lead |
| **Parameters** | `assessment_type`, `assessment_version` (short flow), UTMs, `rep_code` |

### `ai_assessment_complete`

Questions were completed and a result was calculated. A useful funnel milestone. **Not a delivered lead** — completion happens before the contact gate resolves.

### `ai_assessment_lead_submit`

| | |
|---|---|
| **Fires** | Only after lead delivery actually succeeds |
| **Parameters** | `assessment_type`, `assessment_version`, `lead_id`, `score_band` (`low` \| `medium` \| `high`), UTMs, `rep_code` |

This is the strongest pre-sales signal on the site and is a reasonable GA4 Key Event. It is still **not** a qualified sales lead: it means a real person gave real contact details and the delivery succeeded, not that they are a fit, reachable, or interested in buying.

### `resource_cta_click`

A meaningful CTA click inside a resource article. `link_url`, `link_text`, UTMs, `rep_code`.

### `contact_form_submit`

A contact-form submission. Currently also used by a Google Ads conversion tag; confirm the parameters on that tag before launch.

---

## 4. Business conversions

### `booking_confirmed` — the real booked call

| | |
|---|---|
| **Fires** | On `/booking-confirmed/`, only when the URL carries an accepted booking UID, and only once per UID |
| **Means** | A visitor's browser landed on our success page with what looks like a real Cal.com booking |
| **Parameters** | `booking_source` (`cal.com`), `booking_type`, the six UTM fields, `rep_code` |
| **Source** | `src/pages/booking-confirmed/index.astro`, `src/lib/bookingConfirmation.ts` |

**This is the site's `call_booked`.** It is the strongest booking signal the current architecture can produce, and it is the correct primary sales conversion for GA4 today.

**What it is not.** It is a browser-side signal, not a server-verified booking record. Someone could reach that URL by hand without booking. Real server-side confirmation requires a signature-verified Cal.com `BOOKING_CREATED` webhook, which a fully static site cannot host — a webhook secret cannot live in client-side JavaScript. The design for that is written up in `docs/cal-booking-webhook.md` and is not implemented.

**Deduplication.** The list of already-counted booking UIDs lives in `localStorage` under `yai_booking_confirmed_seen`, capped at the 20 most recent. `localStorage` rather than `sessionStorage` because the rule is "one booking UID counts once" and a UID outlives a session: bookmark the confirmation URL, reopen it from the Cal.com email tomorrow, restore the tab after a restart — `sessionStorage` has forgotten it while the booking is still the same booking. A genuinely different UID still fires, because the gate is the UID and never the session.

**Attribution.** The six UTM fields are read from the first-party attribution store, not from the page URL. The visitor left the site for cal.com and returned on a URL Cal.com constructed, so the acquisition query string is gone and the referrer is cal.com. Without this restoration, the only real conversion on the site would be the one event that cannot say which campaign paid for it.

**Requires external configuration.** Cal.com must be told to redirect to `/booking-confirmed/` after a successful booking, per event type. See §8.

### `qualified_lead` — prepared, deliberately not implemented

**No code on this site emits `qualified_lead`, and none should.**

A qualified lead is a judgement made by a person or by a CRM workflow after a conversation: is this a real business, with a real problem, a budget, and authority to decide. A website cannot observe any of that. Any client-side event named `qualified_lead` would be a page view wearing a suit, and it would be the number someone eventually reports to a bank.

**The honest path when it is wanted:**

1. The CRM (or the sales workflow) is the system of record for qualification.
2. `ai_assessment_lead_submit` already emits a non-PII `lead_id`. That identifier is the join key — it reaches the lead email alongside the contact details, so a CRM record can carry it.
3. When a lead is marked qualified in the CRM, send the conversion **server-side**: GA4 Measurement Protocol, or a Google Ads offline conversion import keyed on the stored `gclid`/`gbraid`/`wbraid`. Both already have the identifiers they need from `src/lib/attribution.ts`.
4. That import — not a browser event — is what may be marked as a Key Event.

Until step 3 exists, the correct number of qualified leads to report is the one the CRM says, and GA4 should not claim to know it.

---

## 5. Parameters — the full allowlist

| Parameter | Values | Notes |
|---|---|---|
| `utm_id`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | as authored | The **only** campaign fields permitted on any event. A fixed allowlist in code (`CAMPAIGN_PARAM_KEYS`), not a pass-through |
| `rep_code` | `[a-z0-9._-]`, ≤64 chars | Sales-rep / QR attribution. Can only originate from a `?rep=` URL we publish; sanitized at capture |
| `audience` | `law_firms` \| `roofing` | Outbound pages |
| `campaign_id` | `law_firms_outbound` \| `roofing_outbound` | Deliberately identical to the recommended `utm_campaign` |
| `vertical`, `funnel_id` | fixed enums | Paid-social funnels |
| `cta_location` | `hero` \| `offer` \| `mid` \| `faq` \| `final` \| `sticky` | |
| `cta_type` | `strategy_call` \| `demo` \| `assessment` | |
| `engagement_signal` | `interaction` \| `dwell` | |
| `assessment_type` | `free_opportunity` \| `comprehensive_audit` | |
| `assessment_version` | `short_v1` | Short flow only |
| `lead_id` | UUID | Non-PII correlation ID. Not derived from anything personal |
| `score_band` | `low` \| `medium` \| `high` | Coarse deliberately — never the numeric score |
| `booking_source` | `cal.com` | |
| `booking_type` | `strategy` \| `enterprise` \| `training` \| `executive_advisory` \| `comprehensive_audit` | |
| `link_url`, `link_text` | | |

### Never, on any event, in any parameter

First name, last name, email, phone, company, website, street address, message or note text, assessment answers, the numeric assessment score, booking title, attendee details.

This is enforced mechanically, not by convention: `isPiiFreePayload()` / `isPiiFreeOutboundPayload()` reject any payload whose **key names** look like they could carry personal data, and every campaign enrichment path copies from a fixed six-field allowlist rather than spreading a wider object. `tests/attribution.test.ts`, `tests/campaignAttribution.test.ts`, `tests/outboundLanding.test.ts` and `tests/repAttributionAndFormPreservation.test.ts` assert it.

A visitor's identity travels only in the lead email, joined to analytics by `lead_id`.

---

## 6. Recommended GA4 treatment

| Event | Key Event? | Reasoning |
|---|---|---|
| `booking_confirmed` | **Yes — primary sales conversion** | After a real test booking confirms the Cal.com redirect actually carries a UID (§8) |
| `qualified_lead` | **Yes — when it exists** | Server-side only. Do not create it in GTM |
| `ai_assessment_lead_submit` | Yes | Strongest pre-sales signal. Report it as a lead, never as a sale |
| `booking_click_strategy` | **No** | Diagnostic. Optimise against it; never report it as a booking |
| `booking_click_comprehensive_audit` | **No** | Useful micro-conversion, not a paid booking |
| `ai_assessment_start` | No | Diagnostic |
| `ai_assessment_complete` | No | Funnel milestone |
| `cold_lp_view` | **No** | Diagnostic — its entire purpose is to be compared against Smartlead's click count |
| `cold_lp_engaged` | No | Diagnostic |
| `outbound_cta_click` | No | Diagnostic |
| `resource_cta_click` | No | Diagnostic |
| `funnel_view`, `funnel_cta_click`, `vsl_*` | No | Diagnostic |
| `contact_form_submit` | Operator's call | Already wired to a Google Ads conversion; confirm its parameters |

If the Key Event count needs to fall to make the dashboard honest, that is the correct outcome, not a problem to solve.

---

## 7. What a GA4/GTM operator must do — website work is complete

The site already emits everything below. None of it requires a code change.

**Custom Event triggers to create** (if not already present):

- `CE - ai_assessment_lead_submit`
- `CE - booking_click_comprehensive_audit`
- `CE - booking_confirmed`
- `CE - cold_lp_view`
- `CE - cold_lp_engaged`
- `CE - outbound_cta_click`

**Data Layer Variables to create** (if not already present):

`assessment_type`, `assessment_version`, `lead_id`, `score_band`, `link_url`, `link_text`, `booking_source`, `booking_type`, `rep_code`, `audience`, `campaign_id`, `cta_location`, `cta_type`, `engagement_signal`, and the six `utm_*` fields.

**GA4 Event tags:** one per trigger above, forwarding only the parameters listed for that event in §3–§5. Never forward contact fields or assessment answers.

**Existing tags to revisit:** every GA4 tag already in the container now has UTM fields available on its event. Add the six `utm_*` parameters to the booking-click tags so campaign is answerable at the event level.

**GA4 custom dimensions** (Admin → Custom definitions), event-scoped: `audience`, `campaign_id`, `cta_type`, `engagement_signal`, `score_band`, `booking_type`, `rep_code`. Without these, the parameters are collected but not reportable.

**Key Events:** set exactly as §6 recommends.

---

## 8. What a Cal.com operator must do

**Still required. The website half is complete; this half is not, and until it is, `booking_confirmed` will never fire.**

For each Cal.com event type, set **"Redirect on booking"** to the confirmation route, with the booking type appended so the event can say which booking it was:

| Cal.com event | Redirect URL |
|---|---|
| AI Strategy Call | `https://youraidepartment.ai/booking-confirmed/?booking_type=strategy` |
| Enterprise Engagement Discussion | `https://youraidepartment.ai/booking-confirmed/?booking_type=enterprise` |
| AI Training Consultation | `https://youraidepartment.ai/booking-confirmed/?booking_type=training` |
| Executive AI Advisory Session | `https://youraidepartment.ai/booking-confirmed/?booking_type=executive_advisory` |
| Comprehensive AI Business Audit | `https://youraidepartment.ai/booking-confirmed/?booking_type=comprehensive_audit` |

Cal.com must also be set to **forward booking parameters on redirect**, so the booking UID arrives in the query string. The page checks `bookingUid`, `uid`, `booking_uid` and `bookingId` defensively, but **which one actually arrives has not been verified against production.**

**Verification (one real test booking, not a guess):**

1. Book a real test appointment on the AI Strategy Call event.
2. On the confirmation page, read the address bar. Note the exact UID parameter name.
3. Confirm one `booking_confirmed` in GA4 DebugView, carrying `booking_type` and the UTM fields.
4. Reload the page. Confirm **no** second event.
5. Close the tab, reopen the same URL. Confirm **no** second event. (This is the case the `localStorage` change fixed.)
6. Book a second test appointment. Confirm a new `booking_confirmed` does fire.

If the UID parameter name is not one of the four candidates, add it to `UID_PARAM_CANDIDATES` in `src/lib/bookingConfirmation.ts`. Until step 3 passes, treat `booking_confirmed` as unverified.

---

## 9. Why there is no Cal.com inline embed

An inline embed was considered for the `/go/` pages, so the calendar would sit on the page rather than one click away, and rejected. Three reasons, in order of weight:

1. **It would put the only real conversion signal inside an iframe.** Cal.com's post-booking redirect fires *within the embed*, so `/booking-confirmed/` would load framed. GTM, GA4 page context and the dedupe store all behave differently there, and the risk of silently breaking `booking_confirmed` is not worth the convenience.
2. **It would bypass the site's attribution enrichment.** `AttributionCapture.astro` rewrites `<a href>` attributes on the centralized Cal.com links so UTMs, click IDs and the rep code travel with the click. An embed uses `data-cal-*` attributes instead — a second, parallel mechanism would have to be built and kept in sync.
3. **It is a third-party script on a mobile-first cold landing page**, where performance is a stated requirement and the JavaScript budget is currently near zero.

The centralized strategy-call link appears at four placements plus the mobile sticky bar instead. If an embed is ever wanted, it needs its own sprint, starting with items 1 and 2.

---

## 10. Related documents

- `docs/analytics/smartlead-campaign-links.md` — the exact URLs to paste into Smartlead
- `docs/analytics/smartlead-experiment-plan.md` — the reply-first / call-first test
- `docs/analytics/funnel-tracking-plan.md` — paid-social funnel events
- `docs/analytics/meta-pixel-and-capi.md` — Meta, not yet installed
- `docs/cal-booking-webhook.md` — the server-verified booking design, not implemented
- `brain/TRACKING.md` (on the `feature/outbound-sales-brain` branch) — production GTM/GA4 identifiers and the verification gate
