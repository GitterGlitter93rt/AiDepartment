# Meta Pixel & Conversions API — Current Status and Setup

**Status: NOT INSTALLED.** No Meta Pixel existed anywhere in this repository before the paid-social funnel work, and none is active now. What exists is a clean, inert integration point.

Nothing in this document has been done yet. It is the instruction set for doing it.

---

## 1. What is in the repo today

| Item | File | State |
|---|---|---|
| Pixel configuration reader | `src/lib/metaPixel.ts` | Reads `PUBLIC_META_PIXEL_ID` from the build environment. Returns `null` today. |
| Pixel base component | `src/components/MetaPixel.astro` | Renders **nothing** without a valid ID. Included once from `BaseLayout.astro`, so it is site-wide the moment it is switched on. |
| Event mapping design | `META_EVENT_MAP` in `src/lib/metaPixel.ts` | Design only — no tags exist. |
| CAPI status | `META_CAPI_STATUS` in `src/lib/metaPixel.ts` | `implemented: false`, with the reason recorded in code. |

**No Pixel ID is hardcoded and none is invented.** An invalid Pixel ID is worse than none: it produces silent data loss that looks exactly like working tracking. `getMetaPixelId()` validates the format (10–20 digits) and refuses anything else rather than shipping a broken snippet.

**No access token appears anywhere in this repository**, and a test asserts that.

---

## 2. What is needed to activate the Pixel

### Required from you
- **The Meta Pixel ID** from Events Manager → Data Sources → your pixel. A 15–16 digit number.

That is the only blocker. Everything else is already built.

### Steps
1. Create or locate the pixel in Meta Events Manager.
2. Set the environment variable at **build time** (Astro inlines `PUBLIC_` variables during the build, so this must be set wherever `npm run build` runs — not on the web server at runtime):
   ```
   PUBLIC_META_PIXEL_ID=123456789012345
   ```
   Locally that is a `.env` file at the repo root; for the SiteGround deploy it is the environment of whatever machine produces `dist/`.
3. `npm run build`, then verify with the Meta Pixel Helper browser extension that PageView fires.
4. Deploy.

> A Pixel ID is not a secret — it is visible in the page source of every site that uses one. That is why it is a `PUBLIC_` variable. An **access token** is a secret and must never be committed or exposed client-side.

### Alternative: install through GTM instead
The container is already on every page. If you prefer to manage the pixel in GTM, add the base Pixel tag there on All Pages and leave `PUBLIC_META_PIXEL_ID` unset. Do **both** and you will double-count every event — pick one.

---

## 3. Event mapping

Implement each of these as a GTM tag triggered by the **existing first-party dataLayer event**, so the site keeps one event source of truth. Source: `META_EVENT_MAP` in `src/lib/metaPixel.ts`.

| dataLayer event | Meta event | Standard? | Tier | Purpose |
|---|---|---|---|---|
| `funnel_view` | `ViewContent` | Yes | micro | Retargeting + exclusion audiences by vertical / funnel / creative |
| `vsl_play` | `VSLPlay` | Custom | micro | Separates a scroller from someone who started the video |
| `vsl_progress` | `VSLProgress` | Custom | micro | High-intent audiences at ≥25% / ≥50%. Self-hosted video only. |
| `funnel_cta_click` | `AddToCart` | Yes | micro | Mid-funnel intent. Not a lead, not a booking. |
| `booking_click_plumbing_ai` / `_pi_ai` / `_divorce_ai` | `InitiateCheckout` | Yes | micro | Clicked through to the calendar. They may never book. |
| `ai_assessment_lead_submit` | `Lead` | Yes | **conversion** | A real submitted lead. Valid optimization event. |
| `booking_confirmed` | `Schedule` | Yes | **conversion** | A genuinely booked call. **The primary optimization target.** |

> ⚠️ **Never map `booking_click_*` to `Schedule`.** It would train Meta's delivery to find people who click calendars rather than people who book calls. The distinction between the click and the confirmed booking is the single most important thing in this mapping.

Pass `vertical`, `funnel_id`, `utm_content`, and `creative_id` as custom properties on every event so audiences can be segmented by creative.

---

## 4. Audiences to build (after the Pixel is live)

None of these exist yet. They become available once the pixel has been collecting for long enough to populate.

**Plumbing**
- All `/plumbing-ai/` visitors (`funnel_view`, `funnel_id = plumbing_ai`)
- Visitors by exact creative (`utm_content = plumbing_ugc_vsl_01`, `_02`, …)
- Watched ≥25% (`vsl_progress ≥ 25`)
- Watched ≥50% (`vsl_progress ≥ 50`)
- CTA clickers (`funnel_cta_click`)
- Booking clickers (`booking_click_plumbing_ai`)
- **Exclusion:** confirmed bookings (`booking_confirmed`) — stop paying to retarget people who already booked

**Personal injury** — the same set on `funnel_id = personal_injury_ai`, plus per-creative segments on `pi_ugc_vsl_*`.

**Divorce / family law** — the same set on `funnel_id = divorce_law_ai`, plus per-creative segments on `divorce_ugc_vsl_*`.

**Lookalikes** — build only from the conversion-tier audiences (`booking_confirmed`, then `ai_assessment_lead_submit`). Seeding a lookalike from `funnel_view` teaches Meta to find people who land on pages, which it is already very good at and which is worth nothing.

Do not describe any of these audiences as active until the Pixel is configured and populating.

---

## 5. Conversions API — not implemented, and why

**`META_CAPI_STATUS.implemented === false`.**

CAPI requires a server-side HTTPS request signed with a Meta access token. This site is a static Astro build (`output: 'static'`, no adapter, no Node runtime at deploy time — see `astro.config.mjs`). There is nowhere to hold a token. Implementing "CAPI" from the browser would expose the token to anyone who views source, which is a credential leak, not a tracking improvement.

### What a real implementation would require

1. **A server-side runtime.** Options, roughly in order of least disruption:
   - A small serverless function on a separate host (Cloudflare Worker, Vercel/Netlify function, or a minimal Node service on the SiteGround VPS) that the site calls. The marketing site itself stays static.
   - Cal.com webhook → your endpoint → Meta CAPI. This is the highest-value one: it fires `Schedule` from a genuinely confirmed booking, server-side, immune to ad blockers.
   - Meta's Conversions API Gateway, if you would rather not maintain code.
2. **A secret store** for the access token — environment variables on the server, never in this repo.
3. **Event deduplication.** Send the same `event_id` from both the Pixel and CAPI so Meta merges them instead of double-counting. This is the step most implementations get wrong.
4. **`fbclid` capture** — already done. `src/lib/attribution.ts` captures and persists `fbclid`, which CAPI needs (as `fbc`) for click matching.
5. **A decision on customer-data hashing.** CAPI matches on hashed email/phone. That is a privacy decision, not just a technical one, and it needs the privacy policy reviewed before it happens.

### Recommended first step when there is appetite for this
Do the **Cal.com webhook → CAPI `Schedule`** path first. It carries the only event that reflects real revenue, it is server-side by nature, and it does not require touching the static site at all.

---

## 6. Verification checklist

Once a Pixel ID is configured:

- [ ] Meta Pixel Helper shows PageView firing on the homepage and all three funnels
- [ ] Events Manager → Test Events shows `ViewContent` on a funnel load, carrying `funnel_id` and `utm_content`
- [ ] A CTA click produces `AddToCart` **and** `InitiateCheckout` — and does **not** produce `Schedule`
- [ ] A real test booking produces exactly one `Schedule`
- [ ] Reloading `/booking-confirmed/` does **not** produce a second `Schedule`
- [ ] No duplicate PageView (confirms the pixel is installed once, not both directly and via GTM)
