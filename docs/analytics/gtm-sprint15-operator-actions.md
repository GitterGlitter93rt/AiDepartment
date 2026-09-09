# GTM Operator Actions — Sprint 15

**Container:** `GTM-5G8Q7KKZ` · **GA4 destination:** `G-GLSRPH43L4`

**Why this document exists:** the GTM container is not exported into this repository, so its current contents cannot be inspected from here. Every item below therefore begins with *check whether this already exists* rather than assuming it does not.

Nothing here requires a website change. The site already pushes every event named below.

---

## How to check what already exists

Before creating anything:

1. GTM → **Tags** → search for the event name.
2. GTM → **Triggers** → search for the event name.
3. GTM → **Variables** → check the Data Layer Variables list.

If a trigger and tag already exist for an event, skip that section and move on.

---

## 0. Ground rules

- Work in a **new workspace**, not the default, so the change set is reviewable.
- Use **Preview** before publishing, every time.
- Publish once at the end with a version name and description, not after each tag.
- If an existing tag conflicts with something below, **stop and read Part B of the GA4 checklist** before editing it — particularly anything named `appointment_booked`.

---

## 1. Data Layer Variables

Create any that are missing. Each is `Variable Type: Data Layer Variable`, Version 2, no default value.

| Variable name | Data Layer Variable Name | Used by |
|---|---|---|
| `DLV - booking_source` | `booking_source` | booking_confirmed |
| `DLV - booking_type` | `booking_type` | booking_confirmed |
| `DLV - audience` | `audience` | cold_lp_* , outbound_cta_click |
| `DLV - campaign_id` | `campaign_id` | cold_lp_* , outbound_cta_click |
| `DLV - engagement_signal` | `engagement_signal` | cold_lp_engaged |
| `DLV - cta_location` | `cta_location` | outbound_cta_click |
| `DLV - cta_type` | `cta_type` | outbound_cta_click |
| `DLV - rep_code` | `rep_code` | most events |
| `DLV - lead_id` | `lead_id` | lead events |
| `DLV - score_band` | `score_band` | ai_assessment_lead_submit |
| `DLV - consent_version` | `consent_version` | sms_consent_submit |
| `DLV - source_page` | `source_page` | sms_consent_submit |
| `DLV - traffic_type` | `traffic_type` | **GA4 config tag** — see §5 |
| `DLV - utm_id` | `utm_id` | all campaign-enriched events |
| `DLV - utm_source` | `utm_source` | " |
| `DLV - utm_medium` | `utm_medium` | " |
| `DLV - utm_campaign` | `utm_campaign` | " |
| `DLV - utm_content` | `utm_content` | " |
| `DLV - utm_term` | `utm_term` | " |

**Do not create a variable for anything not on this list.** The website's allowlists mean no other key ever appears, and a variable for a key that never arrives just produces empty parameters.

---

## 2. `booking_confirmed` — the critical one

This is the booked-call conversion. If GTM is not listening, no booking will ever reach GA4.

### 2.1 Trigger

```
Name:            CE - booking_confirmed
Trigger Type:    Custom Event
Event name:      booking_confirmed
This trigger fires on: All Custom Events
```

Do **not** add a page-path condition. The event only fires on `/booking-confirmed/` and only with a valid UID; the page already guards it, and a second gate here can only break it.

### 2.2 Tag

```
Name:            GA4 - Booking Confirmed
Tag Type:        Google Analytics: GA4 Event
Measurement ID:  G-GLSRPH43L4   (or your GA4 Configuration tag)
Event Name:      booking_confirmed
```

**Event Parameters:**

| Parameter Name | Value |
|---|---|
| `booking_source` | `{{DLV - booking_source}}` |
| `booking_type` | `{{DLV - booking_type}}` |
| `rep_code` | `{{DLV - rep_code}}` |
| `utm_id` | `{{DLV - utm_id}}` |
| `utm_source` | `{{DLV - utm_source}}` |
| `utm_medium` | `{{DLV - utm_medium}}` |
| `utm_campaign` | `{{DLV - utm_campaign}}` |
| `utm_content` | `{{DLV - utm_content}}` |
| `utm_term` | `{{DLV - utm_term}}` |

```
Triggering:      CE - booking_confirmed
Exceptions:      none
```

> **The event name field must read exactly `booking_confirmed`.** If an existing tag fires on this trigger but sends `appointment_booked`, that single field is the reason GA4 shows one name and the website emits another. Change the field, not the website.

### 2.3 Verify

GTM Preview → complete a real Cal.com test booking → on the `/booking-confirmed/` return, the Tag Assistant timeline should show `booking_confirmed` **once**, with the parameters above populated and **no** name, email, phone or attendee field anywhere in the payload.

---

## 3. Cold-outbound diagnostics

These measure whether Smartlead's click counts represent browsers. They are **diagnostics** — never mark them as Key Events in GA4.

### 3.1 `cold_lp_view`

```
Trigger:  CE - cold_lp_view     (Custom Event, event name: cold_lp_view)
Tag:      GA4 - Cold LP View    (GA4 Event, Event Name: cold_lp_view)
Parameters:  audience, campaign_id, rep_code, and the six utm_* variables
Triggering:  CE - cold_lp_view
```

### 3.2 `cold_lp_engaged`

```
Trigger:  CE - cold_lp_engaged
Tag:      GA4 - Cold LP Engaged
Parameters:  audience, campaign_id, engagement_signal, rep_code, six utm_*
Triggering:  CE - cold_lp_engaged
```

`engagement_signal` is the one that matters — it separates a real interaction from 15 seconds of visible dwell.

### 3.3 `outbound_cta_click`

```
Trigger:  CE - outbound_cta_click
Tag:      GA4 - Outbound CTA Click
Parameters:  audience, campaign_id, cta_location, cta_type, rep_code, six utm_*
Triggering:  CE - outbound_cta_click
```

`cta_type` distinguishes the strategy call from the assessment. That comparison is the whole cold-email experiment.

> **Note on overlap, not double-counting:** clicking the primary CTA on a `/go/` page produces *both* `outbound_cta_click` and the site-wide `booking_click_strategy`. That is by design — `booking_click_strategy` is the site-wide superset. Report them separately; never add them together.

---

## 4. Smaller gaps

### 4.1 `booking_click_comprehensive_audit`

Probably missing alongside the other booking-click tags.

```
Trigger:  CE - booking_click_comprehensive_audit
Tag:      GA4 - Comprehensive Audit Booking Click
Parameters:  link_url, rep_code, six utm_*
```

**Diagnostic. Not a Key Event.** A click on a $495 audit booking link is not a purchase.

### 4.2 `sms_consent_submit`

```
Trigger:  CE - sms_consent_submit
Tag:      GA4 - SMS Consent Submit
Parameters:  consent_version, source_page
```

Only those two. The event carries nothing else, deliberately — the phone number and name go to the lead destination, never to analytics. **Never a Key Event.**

### 4.3 Add UTM parameters to the existing booking-click tags

The site-wide tracker now attaches the six UTM fields to every event it emits, including all `booking_click_*`. Existing GA4 tags for those events probably predate that and forward only `link_url`.

For each of `booking_click_strategy`, `_enterprise`, `_training`, `_executive_advisory`: add the six `utm_*` parameters. That is what makes "which campaign produced booking intent" answerable at the event level.

---

## 5. Developer traffic

**After Sprint 15 deploys.** The site then pushes `traffic_type: 'internal'` on every non-production page load, before the container initialises.

Add to the **GA4 Configuration tag** (the one firing on Initialization — All Pages):

```
Fields to Set:
   Field Name:  traffic_type
   Value:       {{DLV - traffic_type}}
```

On production the variable is undefined and the field is simply absent — no change to live data.

Then complete the GA4 side: Part H of `docs/analytics/ga4-operator-checklist.md`. **Start the filter in Testing mode.**

---

## 6. What NOT to do

| Do not | Why |
|---|---|
| Create a `call_booked` tag | `booking_confirmed` is already that conversion. Two names for one fact double-counts it |
| Fire a booking conversion from a `booking_click_*` trigger | A click toward a scheduler is not a booking. This is the single most damaging change available in this container |
| Create a `qualified_lead` tag | Nothing emits it, and nothing browser-side should. It belongs server-side from the CRM |
| Add name, email, phone or attendee to any parameter | Prohibited by the site's contract and by Google's policy. The site never puts them on the dataLayer; do not add them here |
| Rename a website event inside a GA4 tag | It creates exactly the `booking_confirmed` / `appointment_booked` confusion this sprint exists to resolve |
| Publish without Preview | — |

---

## 7. Publish

1. Preview and walk the QA matrix in `docs/analytics/sprint15-conversion-integrity.md`.
2. Confirm no tag fires twice on one action.
3. Confirm no payload contains personal data.
4. Publish with a version name — e.g. `Sprint 15 — booking_confirmed, cold outbound diagnostics, internal traffic`.
5. Note the version number in the sprint document, so a rollback target exists.

GTM keeps every published version. Reverting is one click, which makes this the safest layer in the stack to change — and the reason none of it belongs in website code.
