# Sprint 15 — Analytics & Conversion Integrity

**Date:** 2026-09-09
**Branch:** `sprint15-analytics-conversion-integrity`
**Branched from:** `sprint14-gsc-seo-optimization` @ `fdff424aaeb84f1d9de18f907f280bd1e9e83d83`
**Status:** implemented and verified. **Not deployed, not merged.**

---

## 1. The problem, in one sentence

GA4 reported **114 Key Events** in 28 days and **zero** of them were bookings, because the events marked as conversions were mostly button clicks.

## 2. The finding, in one sentence

**The website was already right. GA4 was already wrong.** Sprint 15 is therefore one small code fix, a test suite that makes the honest taxonomy enforceable, and three operator runbooks.

---

## 3. Live GA4 baseline

**Property:** YourAiDepartment · `properties/550008854` · America/New_York
**Measurement ID:** `G-GLSRPH43L4` · **Container:** `GTM-5G8Q7KKZ`
**Window:** 2026-08-10 → 2026-09-06 (settled)

| Metric | Value |
|---|---|
| Sessions | 880 |
| Active users | 819 |
| Engagement rate | 40.8% |
| **Key Events** | **114** |
| Actual bookings | **0** |
| Actual leads (form + assessment) | **11** |

Event counts: `page_view` 1,408 · `session_start` 893 · `first_visit` 834 · `user_engagement` 763 · **`view_search_results` 299** · `scroll` 175 · `click` 108 · `booking_click_enterprise` 51 · `booking_click_strategy` 44 · `ai_assessment_start` 22 · `form_start` 17 · `ai_assessment_complete` 8 · `contact_form_submit` 8 · `booking_click_training` 5 · `funnel_view` 5 · `booking_click_executive_advisory` 4 · `ai_assessment_lead_submit` 3 · `resource_cta_click` 1.

**Where the 114 comes from:** `booking_click_enterprise` (51) + `booking_click_strategy` (44) = 95, plus assessment starts and completes. Almost the entire "conversion" count is people clicking toward a scheduler.

---

## 4. The actual website event taxonomy

Produced by scanning every `dataLayer.push` in the codebase — not from documentation. This is the complete list of what the site emits:

| Level | Events | Meaning |
|---|---|---|
| **L0 Traffic** | `cold_lp_view` | a browser rendered a cold-email page and ran JavaScript |
| **L1 Engagement** | `cold_lp_engaged`, `funnel_view`, `vsl_play`, `vsl_progress`, `resource_cta_click` | someone stayed or interacted |
| **L2 Intent** | `booking_click_strategy` · `_enterprise` · `_training` · `_executive_advisory` · `_comprehensive_audit` · `booking_click_plumbing_ai` · `_pi_ai` · `_divorce_ai` · `outbound_cta_click` · `funnel_cta_click` · `ai_assessment_start` · `ai_assessment_complete` | someone clicked **toward** something |
| **L3 Lead** | `contact_form_submit`, `ai_assessment_lead_submit` | real contact details, delivery confirmed |
| **L4 Booked call** | **`booking_confirmed`** | the only booked-call fact this site produces |
| **L5 Qualified** | `qualified_lead` | **not emitted.** CRM / server-side only |
| **L6 Revenue** | — | offline import only. Never fabricated in a browser |

Plus `sms_consent_submit` — a consent record, not a lead and never a conversion.

**Nothing else exists.** `appointment_booked`, `qualify_lead`, `close_convert_lead`, `purchase` and `view_search_results` have **zero occurrences in the entire repository.**

---

## 5. GA4 configuration drift

| Event | Website emits it? | GA4 has it as a Key Event? | Verdict |
|---|---|---|---|
| `booking_confirmed` | **yes** | **no — absent from the report entirely** | The real conversion is not configured |
| `appointment_booked` | **no — zero occurrences** | yes | Legacy or a GTM rename. See §7 |
| `qualify_lead` | no | yes | Legacy. Retire |
| `close_convert_lead` | no | yes | Legacy. Retire |
| `purchase` | no — the site takes no payment | yes | Legacy. Retire |
| `booking_click_enterprise` | yes | yes | **Remove Key Event status.** A click |
| `booking_click_strategy` | yes | yes | **Remove.** A click |
| `booking_click_training` | yes | yes | **Remove.** A click |
| `booking_click_executive_advisory` | yes | yes | **Remove.** A click |
| `ai_assessment_start` | yes | yes | **Remove.** Starting is not converting |
| `ai_assessment_complete` | yes | yes | **Remove.** Completion precedes the contact gate |
| `ai_assessment_lead_submit` | yes | yes | **Keep.** A real lead |
| `contact_form_submit` | yes | yes | **Keep** — check Google Ads overlap first (§9) |

Four Key Events are configured for events **no code has ever emitted.** They cannot have contributed to the 114, but they are why the Key Event list reads like a funnel that does not exist.

---

## 6. `booking_confirmed` integrity — all 12 checks verified

Verified by executing the module, not by reading it:

| # | Check | Result |
|---|---|---|
| 1 | Event name is exactly `booking_confirmed` | PASS |
| 2 | Exactly one module emits it (`src/lib/bookingConfirmation.ts`) | PASS |
| 3 | No code emits `call_booked` | PASS — comment only |
| 4 | No booking click can cause it | **PASS — proven against built bundles** |
| 5 | No UID → does not fire (incl. empty and whitespace) | PASS |
| 6 | Same UID → does not count twice | PASS |
| 7 | Different UID → counts | PASS |
| 8 | `booking_type` rejects anything outside the five allowed values | PASS |
| 9 | Campaign attribution is a six-field allowlist | PASS |
| 10 | `rep_code` sanitized, omitted when absent | PASS |
| 11 | No PII possible in the payload | PASS |
| 12 | Page is `noindex` and absent from the sitemap | PASS |

**Check 4 is the important one.** Three components contain comments saying they do *not* emit `booking_confirmed`, so a source grep finds three false hits. The test instead reads the JavaScript each page actually ships:

```
/                      0 bundles contain booking_confirmed
/contact/              0
/go/roofing/           0
/go/law-firms/         0
/plumbing-ai/          0
/free-ai-assessment/   0
/booking-confirmed/    1   <- the emitter, exactly where it belongs
```

**Nothing was weakened.** No change was made to booking logic.

---

## 7. `booking_confirmed` vs `appointment_booked`

Stated by layer, without guessing:

```
CODE      website emits booking_confirmed
          verified: one emitter, one bundle

GTM       UNKNOWN — the container is not exported into this repository
          and cannot be inspected from here

GA4       appointment_booked is a configured Key Event
          booking_confirmed does not appear in the 28-day report at all

CAL.COM   UNKNOWN — redirect settings live in the Cal.com dashboard
```

Three explanations remain, and they are distinguishable:

1. **No real booking occurred in the window.** Then the absence is correct and nothing is broken — the event only fires on a genuine booking return. Check Cal.com for completed bookings between 2026-08-10 and 2026-09-06.
2. **Bookings occurred but the Cal.com redirect is missing or carries no UID.** Then §8 fixes it.
3. **GTM is renaming it** — a tag triggered by `booking_confirmed` whose event-name field says `appointment_booked`. That would explain both facts simultaneously.

**Action:** work Part B of `docs/analytics/ga4-operator-checklist.md` in order. It distinguishes the three in about five minutes. If case 3, change the GTM field — never the website event name.

---

## 8. Cal.com — required before any booking can be measured

Redirect targets are documented in `docs/analytics/conversion-event-taxonomy.md` §8, one per event type, each carrying `booking_type`.

**Two things are genuinely unverified and are not guessed here:**

- **The UID parameter name.** The page accepts `bookingUid`, `uid`, `booking_uid`, `bookingId` defensively. Which one Cal.com actually sends has never been confirmed against production.
- **The placeholder syntax**, if the redirect field needs an explicit token rather than "forward parameters on redirect".

Both are answered by one real test booking. No booking was created, cancelled or rescheduled during this sprint.

### Manual live test checklist — for Michael, one real booking

1. Deploy Sprint 15 (or run against production once the GA4/GTM work is done).
2. Configure the Cal.com redirect + parameter forwarding for **AI Strategy Call** first.
3. Open GTM **Preview**, and GA4 **DebugView** in a second tab.
4. Visit a tagged URL so attribution exists:
   `https://youraidepartment.ai/?utm_source=smartlead&utm_medium=email&utm_campaign=law_firms_outbound&utm_id=test_20260909&utm_content=law_e1_a`
5. Click **Schedule a Strategy Call**. Expect `booking_click_strategy` — **and not** `booking_confirmed`.
6. Complete a real booking.
7. On the return page, **read the address bar** and record the exact UID parameter name. → If it is not one of the four candidates, add it to `UID_PARAM_CANDIDATES`.
8. Confirm **one** `booking_confirmed` in DebugView, carrying `booking_type=strategy` and the five UTM fields from step 4.
9. Confirm **no** name, email, phone or attendee anywhere in the payload.
10. **Refresh.** Expect no second event.
11. **Close the tab, reopen the same URL.** Expect no second event.
12. Book a second test appointment. Expect a new `booking_confirmed`.
13. Cancel both test bookings in Cal.com.
14. Only then mark `booking_confirmed` as a GA4 Key Event.

---

## 9. Google Ads double-count risk

**The website contains no Google Ads code at all.** No `AW-` conversion ID, no `gtag('event', …)`, no `send_to` — verified across `src/` and the built output. Every Ads tag lives in GTM.

So the site cannot double-count. The risk is entirely configuration:

```
BUSINESS ACTION      dataLayer event         GTM                      GA4              Ads          Risk
contact form         contact_form_submit  →  GA4 Event tag         →  Key Event    →  imported?  ← DOUBLE
                                          →  Google Ads Conv. tag  ─────────────────→  direct
assessment lead      ai_assessment_lead_submit → GA4 Event tag     →  Key Event    →  imported?    low
booked call          booking_confirmed    →  tag unknown           →  absent       →  none         none yet
booking intent       booking_click_*      →  GA4 Event tags        →  Key Event ✗  →  none         mislabel
```

`contact_form_submit` is the live exposure: existing documentation records it as already wired to a Google Ads conversion. If GA4 *also* imports it as a conversion, one form submission is counted twice in Ads.

**Action:** Part D of the GA4 checklist. Identify the overlap, set one action to Secondary, keep the one with history. **Nothing was changed in Google Ads during this sprint.**

---

## 10. `view_search_results` — 299 events, no search feature

**Root cause:** GA4 Enhanced Measurement's Site search sub-event fires on the presence of a query parameter. Its default list includes `keyword`. Google Ads appends `keyword={keyword}` to landing URLs, so every paid click looks like a site search.

Confirmed: **no search input, no search route, no search library, and no built page that emits a `?q=` URL.**

The site captures `keyword` deliberately — it reaches the Cal.com handoff and the lead record so a lead can be traced to the ad keyword. It is **deliberately absent** from the GA4 event allowlist, which is also the proof that the site's own analytics are not producing these events.

**Fix:** GA4 → Data streams → Enhanced measurement → **Site search → OFF**. One toggle, zero risk, because the site has no search.

**Not fixed in code**, on purpose: Enhanced Measurement reads `window.location`, so no JavaScript here can prevent it; removing `keyword` would destroy real lead attribution to silence a reporting artefact.

Full evidence: `docs/analytics/view-search-results-investigation.md`.

---

## 11. Test and QA traffic

The baseline includes `tagassistant.google.com / referral` and `test / (not set)` sessions. Cause: **GTM loads identically on localhost, preview builds and production**, and nothing distinguished them. Our own QA was in the executive numbers.

**The one code change this sprint made.** A `traffic_type: 'internal'` value now goes onto the dataLayer before GTM initialises, on any hostname that is not `youraidepartment.ai`. On production the branch is skipped and the dataLayer is byte-identical to before.

Deliberately **not** done: gating GTM off production. Tag Assistant and GTM Preview are how this site is QA'd; a container that will not load outside production cannot be tested before it ships. Marking the traffic is the fix; hiding it is not.

Operator side: GTM variable + GA4 internal traffic rule + **filter in Testing mode first** (Part H of the checklist). Data filters apply at processing time and excluded data cannot be recovered — Testing is reversible, Active is not.

---

## 12. Scanner / Smartlead traffic

**Baseline context only. Not encoded in any business logic.**

- 2026-09-09: `smartlead / email` 14 sessions, all landing on `/free-ai-assessment`, 100% bounce, 0 key events — **after the campaigns were already paused.**
- 2026-09-07 → 09: ~81 sessions, same landing page, 0 key events.
- Heavily desktop, near-zero engagement in the burst.

This is consistent with automated link-checking, and it is exactly why the `/go/` diagnostics exist. **It is not proof**, and nothing here treats it as such.

The honest distinction is preserved:

- `cold_lp_view` — JavaScript executed. **Does not prove a human.**
- `cold_lp_engaged` — an interaction, or 15 seconds of *visible* dwell. Stronger. **Still not proof.**

**No bot blocking was added.** No user-agent rules, no fragile detection that could hide a real prospect. The architecture measures the far side of the click and lets the numbers be compared.

---

## 13. Attribution integrity

Verified end to end, unchanged:

| Layer | State |
|---|---|
| First-touch / latest-touch | intact, 90-day retention, internal navigation cannot erase it |
| Six UTM fields | fixed allowlist, reaches every tracker event |
| `gclid` / `gbraid` / `wbraid` / `fbclid` | captured and persisted for a future offline import |
| ValueTrack (`keyword`, `matchtype`, `device`, …) | captured → lead payload + Cal.com, **never GA4** |
| `rep_code` | sanitized to `[a-z0-9._-]`, omitted when absent |
| Cal.com forwarding | enriches the centralized scheduling links at click time |
| **Survives the Cal.com round trip** | **yes** — `booking_confirmed` restores all six UTM fields plus `rep_code` from first-party storage |

That last row is the one that matters: the visitor leaves for cal.com and returns on a URL Cal.com builds, so the campaign has to come from storage or it does not exist.

---

## 14. PII and secrets

Scanned `src/`, `public/`, `dist/`:

- **6 `dataLayer.push` sites. 0 with a PII-shaped key.**
- No `webhook_secret`, `measurement_api_secret`, `refresh_token`, service-account JSON, private key, or `AW-` ID anywhere.
- Personal data reaches the lead destination only, joined to analytics by the non-PII `lead_id`.

`tests/analyticsIntegrity.test.ts` now fails the build on any of these.

---

## 15. Changes made

### Code — one change

| File | Change |
|---|---|
| `src/layouts/BaseLayout.astro` | `traffic_type: 'internal'` on non-production hostnames, before GTM initialises. No effect on production |
| `src/components/assessment/assessmentApp.ts` | Use `ASSESSMENT_EVENTS.leadSubmit` instead of a string literal. **Behaviour-identical** — same value — but the literal was how two emitters of one event drift apart on the next rename |

### Tests — 36 added

`tests/analyticsIntegrity.test.ts`. Highlights in §6 and §14. The strongest assertion reads shipped bundles rather than source, because three components' *comments* mention `booking_confirmed`.

### Documentation

`sprint15-conversion-integrity.md` (this) · `ga4-operator-checklist.md` · `gtm-sprint15-operator-actions.md` · `view-search-results-investigation.md` · `executive-scorecard.md`

## 16. Changes deliberately NOT made

| Not done | Why |
|---|---|
| Added `call_booked` | `booking_confirmed` already is that conversion. Two names double-count one fact |
| Renamed `booking_confirmed` | It is referenced across the taxonomy, the tests and the Cal.com docs |
| Fired a booking event from a CTA click | A click toward a scheduler is not a booking |
| Client-side `qualified_lead` | Qualification is a human judgement. A browser cannot observe it |
| Suppressed `view_search_results` in JavaScript | Enhanced Measurement reads the URL; no page code can stop it, and the attempt would be unmaintainable |
| Removed `keyword` from attribution | It is real, useful lead attribution. Fixing GA4 is the correct layer |
| Bot / user-agent blocking | Brittle, and would hide real prospects |
| Any GA4, GTM, Cal.com or Google Ads change | Not repository-controlled. Documented as operator actions instead |
| Any new route, SEO, sitemap, robots, `.htaccess` or legal change | Out of scope, and all verified unchanged |

---

## 17. Verification

Clean, from a removed `node_modules`:

```
npm ci            exit 0
npx astro check   331 files — 0 errors, 0 warnings, 10 hints
npm test          624 tests / 133 suites / 624 pass / 0 fail   (+36)
npm run build     129 pages, exit 0
```

Sitemap 119 · `/go/` noindex and excluded · `booking-confirmed` noindex and excluded · `.htaccess` byte-identical to production · legal entity `Catastrophic Solutions LLC` · 0 pages naming the future entity · Sprint 14 schema and titles intact.

---

## 18. Manual browser QA matrix

Run with the dataLayer visible (`console.table(window.dataLayer)`) in GTM Preview. **Use a local build for the synthetic UID cases — do not push fake conversions into production GA4.**

| # | Action | Expect | Must NOT see |
|---|---|---|---|
| A | Click a strategy-call CTA | `booking_click_strategy` with UTMs | `booking_confirmed` |
| B | Visit `/booking-confirmed/` with no query string | nothing | `booking_confirmed` |
| C | Local build, `/booking-confirmed/?bookingUid=TEST1&booking_type=strategy` | exactly one `booking_confirmed` | a second event |
| D | Reload C | nothing | a second `booking_confirmed` |
| E | Local build, `?bookingUid=TEST2&booking_type=strategy` | a new `booking_confirmed` | — |
| F | Load `/go/roofing/`, scroll | `cold_lp_view`, then `cold_lp_engaged` with `engagement_signal=interaction` | duplicates |
| G | Open `/go/roofing/` in a background tab, wait 20s | **no** `cold_lp_engaged` until visible | dwell accruing while hidden |
| H | Click the assessment link on a `/go/` page | `outbound_cta_click` with `cta_type=assessment` | any `booking_click_*` |
| I | Click the strategy CTA on a `/go/` page | `outbound_cta_click` (`cta_type=strategy_call`) **and** `booking_click_strategy` | `booking_confirmed` |
| J | Any page, inspect every payload | UTMs, `rep_code`, enum values | name, email, phone, company, message |

Case I is intentional overlap, not double-counting: `booking_click_strategy` is the site-wide superset. Report them separately; never add them.

---

## 19. Operator actions required

Nothing below is in the repository. Full steps in the linked runbooks.

| System | Action | Priority |
|---|---|---|
| **GA4** | Remove Key Event status from 6 click/step events | **High** — this is the 114 |
| **GA4** | Retire 4 Key Events nothing emits (`appointment_booked`, `qualify_lead`, `close_convert_lead`, `purchase`) | High |
| **GA4** | Enhanced Measurement → Site search → OFF | High |
| **GA4** | Register 6 custom dimensions | Medium |
| **GA4** | Internal traffic rule + filter in **Testing** mode | Medium — after deploy |
| **GTM** | Verify/create the `booking_confirmed` trigger + tag | **Critical** |
| **GTM** | Check for a tag renaming it to `appointment_booked` | **Critical** |
| **GTM** | Create cold-outbound diagnostic tags | High |
| **GTM** | Add UTM parameters to existing booking-click tags | Medium |
| **Cal.com** | Configure the redirect + parameter forwarding, then **one real test booking** | **Critical** |
| **Google Ads** | Check `contact_form_submit` double-count; set one action Secondary | High |

---

## 20. How to judge this sprint

Not by a number going up. By three numbers becoming true:

1. **Key Events drops from 114 to ~11.** That is the sprint working, not regressing.
2. **`booking_confirmed` appears at all** — after Cal.com is configured and a real booking happens. It may be 0 for a while. Zero honest bookings is better information than 114 fictional conversions.
3. **`view_search_results` goes to zero** on new traffic.

Then, and only then, is the paid-media question answerable. Google CPC currently looks strong on `/enterprise` (242 sessions, ~42% bounce, many booking-intent events) and paid social looks weak (`/personal-injury-ai`, ~94% bounce, 0 key events) — but **booking clicks are not booked calls**, and the key-event configuration those judgements rest on is the thing this sprint just found to be wrong. Both verdicts require post-Sprint-15 conversion validation before anyone moves budget.
