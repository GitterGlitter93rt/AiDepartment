# GA4 Operator Checklist — Sprint 15

**For:** whoever opens GA4 to configure this property.
**Property:** YourAiDepartment · `properties/550008854` · timezone America/New_York
**Measurement ID:** `G-GLSRPH43L4` · **GTM container:** `GTM-5G8Q7KKZ`
**Website state:** Sprint 15 branch, not deployed. Everything below is GA4-side and can be done against the currently-live site **except** where marked "after Sprint 15 deploys".

Work top to bottom. Each item says why, what it is now, what it should be, and how to check.

---

## The problem this fixes, in one line

GA4 reported **114 Key Events** in 28 days. **Zero** of them were bookings, because the events marked as Key Events are mostly button clicks.

---

## PART A — Key Event status, event by event

The website emits exactly these events. Nothing else. This list was produced by scanning every `dataLayer.push` in the codebase, not from documentation.

### A1. Mark as Key Event — real business conversions

| Event | Current | Action | Why |
|---|---|---|---|
| `booking_confirmed` | **not present in GA4** | **INVESTIGATE FIRST** (see Part B), then mark as Key Event once a real test booking makes it appear | The only booked-call fact this site produces |
| `qualified_lead` | listed in GA4 as `qualify_lead` | **LEAVE ALONE — do not mark** | Nothing emits it. It must come from the CRM server-side, never from a browser |

### A2. Keep as Key Event — genuine lead-level conversions

| Event | Current | Action | Why |
|---|---|---|---|
| `ai_assessment_lead_submit` | Key Event | **KEEP** | Fires only after confirmed lead delivery. 3 in 28 days. This is a real lead |
| `contact_form_submit` | Key Event | **KEEP** — but read Part D first | A real lead. 8 in 28 days. It may also drive a Google Ads conversion; do not touch until Part D is checked |

### A3. REMOVE Key Event status — these are clicks, not sales

Every one of these is a person clicking *toward* something. None is an outcome.

| Event | 28-day count | Action |
|---|---|---|
| `booking_click_enterprise` | 51 | **REMOVE Key Event status** |
| `booking_click_strategy` | 44 | **REMOVE Key Event status** |
| `booking_click_training` | 5 | **REMOVE Key Event status** |
| `booking_click_executive_advisory` | 4 | **REMOVE Key Event status** |
| `ai_assessment_start` | 22 | **REMOVE Key Event status** |
| `ai_assessment_complete` | 8 | **REMOVE Key Event status** |

That is 134 event occurrences currently able to read as conversions. `booking_click_enterprise` + `booking_click_strategy` alone is 95 — which is most of the 114.

**Removing Key Event status does not delete the events or their history.** They remain fully reportable. They stop being counted as conversions.

### A4. Investigate then retire — configured but never fired

| Event | Finding | Action |
|---|---|---|
| `appointment_booked` | **Zero occurrences in the entire repository.** No website code has ever emitted it | See Part B. Almost certainly legacy. Remove Key Event status once Part B confirms `booking_confirmed` is the live name |
| `purchase` | Zero occurrences. The site takes no payment — Stripe checkout happens inside Cal.com | **REMOVE Key Event status.** Nothing can ever fire it from this site |
| `close_convert_lead` | Zero occurrences. Not a GA4 standard event either | **REMOVE Key Event status.** Legacy or copied from another property |
| `qualify_lead` | Zero occurrences | **REMOVE Key Event status.** The intended future event is `qualified_lead`, server-side. See Part E |

**Do not delete these event definitions** — GA4 keeps historical event names and deleting is not reversible. Only un-mark them as Key Events.

### A5. Never mark as Key Events — diagnostics

These are useful and should keep flowing. They are not sales.

`cold_lp_view` · `cold_lp_engaged` · `outbound_cta_click` · `booking_click_comprehensive_audit` · `funnel_view` · `funnel_cta_click` · `vsl_play` · `vsl_progress` · `resource_cta_click` · `sms_consent_submit`

`sms_consent_submit` deserves a specific note: an SMS opt-in is a consent record, not a lead and not a sale. It must never be a Key Event.

### A6. Expected result

Key Events after this pass, for the same 28-day window:

```
ai_assessment_lead_submit      3
contact_form_submit            8
                              --
                              11    (was 114)
```

**That drop is the point.** The number was never 114 sales. It is now 11 leads and zero bookings, which is what actually happened.

---

## PART B — The `booking_confirmed` / `appointment_booked` mismatch

### The finding, stated without guessing

| Layer | State | Evidence |
|---|---|---|
| **Website code** | emits `booking_confirmed` | Verified: one emitter, `src/lib/bookingConfirmation.ts`, shipped in exactly one bundle |
| **GTM** | **unknown** | The container is not exported into this repository. Cannot be inspected from here |
| **GA4** | has `appointment_booked` configured as a Key Event; `booking_confirmed` does not appear in the 28-day event report at all | Supplied event list and report |
| **Cal.com** | **unknown** | Redirect settings live in the Cal.com dashboard |

### The most likely explanation, and how to tell

`booking_confirmed` is absent from the report. That means either it never fired, or GTM renamed it. Both are possible and they are distinguishable:

**Step 1 — has any real booking happened?** Open Cal.com and check whether any of the five event types received a genuine completed booking between 2026-08-10 and 2026-09-06.

- **If no bookings occurred:** the absence is correct and expected. `booking_confirmed` fires only on a real booking return. Nothing is broken. Proceed to the Cal.com configuration in Part C so it *can* fire.
- **If bookings did occur:** then the redirect is missing, or the redirect carries no booking UID, or GTM is not listening. Continue to step 2.

**Step 2 — is GTM listening?** In GTM, search the container for `booking_confirmed`. If there is no Custom Event trigger with that name, GTM is dropping it and the fix is Part F.

**Step 3 — is GTM renaming it?** If a GA4 Event tag exists whose *event name field* is `appointment_booked` but whose *trigger* is `booking_confirmed`, then GTM is renaming the event on the way through. That would explain both facts at once.

- If so: **change the GA4 tag's event name to `booking_confirmed`.** Do not rename the website event. The website name is the one referenced across the taxonomy, the tests, and the Cal.com documentation.

### `appointment_booked` — the recommendation

Once Part B identifies which case applies, **remove Key Event status from `appointment_booked`** and keep `booking_confirmed` as the single booked-call conversion. Two names for one commercial fact is how a booking gets counted twice.

Leave the historical `appointment_booked` definition in place.

---

## PART C — Cal.com (required before `booking_confirmed` can ever fire)

Full detail in `docs/analytics/conversion-event-taxonomy.md` §8. Summary:

For each event type, set **Redirect on booking**:

| Cal.com event | Redirect URL |
|---|---|
| AI Strategy Call | `https://youraidepartment.ai/booking-confirmed/?booking_type=strategy` |
| Enterprise Engagement Discussion | `…?booking_type=enterprise` |
| AI Training Consultation | `…?booking_type=training` |
| Executive AI Advisory Session | `…?booking_type=executive_advisory` |
| Comprehensive AI Business Audit | `…?booking_type=comprehensive_audit` |

Then enable **"Forward parameters on redirect"** so Cal.com appends the booking identifier.

**The UID parameter name has never been verified against production.** The page accepts `bookingUid`, `uid`, `booking_uid` and `bookingId` defensively. One real test booking settles which one actually arrives — see the live test checklist in `docs/analytics/sprint15-conversion-integrity.md`.

**This document does not guess Cal.com's placeholder syntax.** If the redirect field requires an explicit placeholder rather than automatic forwarding, read the exact token from the Cal.com UI at configuration time and record it here.

---

## PART D — Google Ads double-count check

**Before changing `contact_form_submit`.**

The website contains **no Google Ads code at all** — no `AW-` conversion ID, no `gtag('event', …)`, no `send_to`. Verified across `src/` and the built output. Every Ads tag lives in GTM.

That means the site cannot double-count. The risk is entirely in the GTM/GA4 configuration, and it looks like this:

```
one form submission
   → contact_form_submit on the dataLayer
       → GTM: GA4 Event tag        → GA4 conversion
       → GTM: Google Ads Conversion tag → Ads conversion   (documented as existing)
   → GA4 Key Event, if also imported into Ads → the SAME action counted twice in Ads
```

**Check in Google Ads → Goals → Conversions → Summary:**

1. Is there a conversion action fed by the **GTM Google Ads tag** for contact form submits?
2. Is there *also* a conversion action **imported from GA4** for `contact_form_submit`?

If both exist, one action is being counted twice. **Keep one and set the other to "Secondary".** Prefer keeping the GTM Ads tag if it is the one with conversion history, since switching sources resets learning.

Do the same check for `ai_assessment_lead_submit` once it is confirmed as a Key Event.

**Do not change Google Ads bidding or delete a conversion action in this pass.** Identify the overlap, mark one secondary, and let the data settle for two weeks.

---

## PART E — `qualified_lead`, when the CRM is ready

Do not create this in GA4 now. There is nothing to send it.

The path when it exists:

1. `ai_assessment_lead_submit` and `contact_form_submit` already emit a non-PII `lead_id`.
2. That same `lead_id` reaches the lead email, so a CRM record can carry it.
3. The attribution store already persists `gclid` / `gbraid` / `wbraid` and writes them onto the lead payload as `attribution_*` fields.
4. When a human marks the lead qualified, send the conversion **server-side** — GA4 Measurement Protocol, or a Google Ads offline conversion import keyed on the stored click ID.
5. **That import** is what gets marked as a Key Event.

Every ingredient except the server-side sender already exists. No website change is needed to prepare for it.

**No secret for that sender may ever reach the browser.** `tests/analyticsIntegrity.test.ts` fails the build if a Measurement Protocol API secret, webhook secret, service-account key or `AW-` ID appears in `src/` or `dist/`.

---

## PART F — Missing GTM listeners

The website emits these; if GTM has no Custom Event trigger for them, they never reach GA4. Check each and create what is missing. Full tag/trigger/variable spec in `docs/analytics/gtm-sprint15-operator-actions.md`.

| Event | Priority |
|---|---|
| `booking_confirmed` | **Critical** — this is the booked-call conversion |
| `cold_lp_view` | High — the cold-email click-quality diagnostic |
| `cold_lp_engaged` | High — same |
| `outbound_cta_click` | Medium |
| `sms_consent_submit` | Low |
| `booking_click_comprehensive_audit` | Low |

The 28-day report shows no `cold_lp_view` or `cold_lp_engaged`, which is consistent with the `/go/` pages having deployed on 2026-09-09 — after the window closed. Recheck once traffic has run.

---

## PART G — Site search (see the dedicated investigation)

299 `view_search_results` events. **This site has no search feature.** GA4 Enhanced Measurement is reading the `keyword=` Google Ads ValueTrack parameter off paid landing URLs and calling it a search.

```
GA4 → Admin → Data streams → youraidepartment.ai
  → Enhanced measurement (gear)
  → Site search → OFF → Save
```

Confirm the cause first by adding `search_term` as a secondary dimension: the values will be advertising keywords. Full evidence and the alternatives in `docs/analytics/view-search-results-investigation.md`.

---

## PART H — Test and developer traffic

The baseline contains sessions from `tagassistant.google.com / referral` and `test / (not set)`. That is our own QA in the executive numbers.

**Sprint 15 adds the marker the fix needs.** Once deployed, every non-production page load pushes `traffic_type: 'internal'` to the dataLayer before GTM initialises. Production pushes nothing.

### After Sprint 15 deploys

**1. GTM** — create a Data Layer Variable `DLV - traffic_type` (variable name `traffic_type`), and add it to the GA4 Configuration tag as a field named `traffic_type`. Spec in the GTM runbook.

**2. GA4** — define the internal traffic rule:

```
Admin → Data collection and modification → Data streams → youraidepartment.ai
  → Configure tag settings → Show more → Define internal traffic
  → Create rule
      Rule name:        Internal / developer traffic
      traffic_type:     internal
      Match type:       matches exactly
  → Create
```

**3. Then, and only then, the filter:**

```
Admin → Data collection and modification → Data filters
  → Internal Traffic filter
  → Filter state: TESTING        <- start here, NOT Active
```

**Leave it in Testing for at least a week.** In Testing mode GA4 tags the traffic without excluding it, so you can confirm in a report (dimension: `Test data filter name`) that it is catching QA sessions and nothing else. Only then switch to **Active**.

**Do not create a broad permanent filter now.** Data filters apply at processing time and excluded data cannot be recovered. Testing mode is reversible; Active is not.

**Do not filter by IP** unless the office has a static address. A dynamic IP silently stops matching and the filter quietly does nothing.

---

## PART I — Custom dimensions

GA4 collects these parameters but will not report on them until each is registered. Register only what answers a real question — every dimension is permanent and the property has a cap.

### Register these (event-scoped)

| Parameter | Answers |
|---|---|
| `booking_type` | Which of the five call types actually get booked |
| `audience` | Whether law-firm or roofing cold outbound performs better |
| `campaign_id` | Cold-outbound performance without relying on UTM parsing |
| `engagement_signal` | Whether cold-email engagement is real interaction or just dwell — the scanner question |
| `cta_type` | Whether cold readers choose the call or the assessment |
| `score_band` | Whether assessment leads that score high convert better |

### Register only if the question comes up

| Parameter | Why it can wait |
|---|---|
| `cta_location` | Placement optimisation, not a business question yet |
| `assessment_type` / `assessment_version` | Only two flows and one version; the event names already separate them |
| `rep_code` | No QR/business-card campaign is running |
| `booking_source` | Constant (`cal.com`) — a dimension with one value answers nothing |

### Do NOT register

`utm_id`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` — GA4 already exposes these as built-in acquisition dimensions. Duplicating them creates two numbers that disagree.

`lead_id` — high cardinality, one value per lead. It is a join key for CRM work, not a reporting dimension.

---

## Final state

After all parts:

- Key Events: `booking_confirmed` (once verified), `ai_assessment_lead_submit`, `contact_form_submit`.
- Everything else diagnostic and clearly labelled as such.
- No event in GA4 that no code emits.
- No site-search noise.
- QA traffic identifiable and excluded in Testing mode.
- Six custom dimensions that answer six real questions.

The reporting number for bookings will then be small and true, instead of 114 and meaningless.
