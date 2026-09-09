# Executive Scorecard — Weekly

**For:** Michael, once a week, in about ten minutes.
**Purpose:** one page that cannot be misread as more than it says.

The rule this page exists to enforce: **a click toward a scheduler is not a booking, and a booking is not revenue.** Every row below states which of those it is.

---

## The one-line summary

Fill this in first. If it cannot be filled in honestly, the rest of the page will not save you.

```
Week of ____________

Leads: ____    Booked calls: ____    Qualified: ____    Closed: ____    Revenue: $____
```

Four of those five come from the CRM and the calendar, not from GA4. That is deliberate.

---

## 1. TRAFFIC — how many arrived

| Metric | Source | Read it as |
|---|---|---|
| Sessions by channel | GA4 → Acquisition → Traffic acquisition | Volume. Nothing more |
| `cold_lp_view` | GA4 event, by `campaign_id` | A browser rendered a cold-email page and ran JavaScript. **Not a human** |
| Sessions excluded as internal | GA4 → internal traffic filter | Our own QA, correctly removed |

> **Do not report raw sessions as reach for cold email.** See §5.

## 2. ENGAGEMENT — how many stayed

| Metric | Source | Read it as |
|---|---|---|
| Engagement rate | GA4 | Site-wide health |
| `cold_lp_engaged` | GA4 event, by `engagement_signal` | Interaction, or 15s of *visible* dwell. **Stronger, still not proof of a human** |
| `resource_cta_click` | GA4 event | Someone finished an article and moved |

`engagement_signal = interaction` is the stronger half. Watch it separately from `dwell`.

## 3. INTENT — how many reached for the next step

**None of these is a sale. This section exists so nobody reports it as one.**

| Metric | Source |
|---|---|
| `booking_click_strategy`, `_enterprise`, `_training`, `_executive_advisory`, `_comprehensive_audit` | GA4 events |
| `outbound_cta_click`, split by `cta_type` | GA4 event |
| `ai_assessment_start` | GA4 event |

> In the 28 days to 2026-09-06 there were **95 booking clicks and 0 bookings**. That gap is the single most important number on this page. It is not a failure — it is the difference between intent and outcome, and it was previously being reported as conversions.

## 4. LEADS — how many gave us contact details

| Metric | Source | Read it as |
|---|---|---|
| `contact_form_submit` | GA4 Key Event | A real person, real details, delivery confirmed |
| `ai_assessment_lead_submit` | GA4 Key Event | Same, plus a `score_band` |
| Replies / positive replies | **Smartlead, joined by hand** | The only cold-email signal a scanner cannot fake |

Smartlead replies are not in GA4 and should not be. Add them manually — a reply is worth more than any click number on this page.

## 5. BOOKINGS — how many actually booked

| Metric | Source | Read it as |
|---|---|---|
| **`booking_confirmed`** | GA4 Key Event | **The booked call.** The only event that may be called one |
| Split by `booking_type` | GA4 dimension | Which of the five call types people take |
| Bookings in Cal.com | **Cal.com calendar** | Ground truth. Reconcile monthly |
| Booking rate | `booking_confirmed` ÷ delivered campaign leads | Per campaign, not site-wide |

**Reconcile GA4 against Cal.com monthly.** A gap in either direction is a measurement bug worth finding while the numbers are small enough to trace by hand.

> `booking_confirmed` is a strong browser-side signal, not a server-verified record. Until the signed Cal.com webhook in `docs/cal-booking-webhook.md` exists, Cal.com is the authority and GA4 is the estimate.

## 6. SALES — the numbers that pay for everything

**None of this comes from GA4 today. All of it comes from the CRM.**

| Metric | Source |
|---|---|
| Qualified opportunities | CRM |
| Proposals sent | CRM |
| Clients won | CRM |
| Revenue | CRM / invoicing |

When the CRM can emit `qualified_lead` server-side, that row moves into GA4. Until then, **write the CRM number here by hand and leave GA4 out of it.**

## 7. DIAGNOSTICS — is the measurement itself honest

| Check | Healthy | Investigate if |
|---|---|---|
| Recipient bounce (Smartlead) | < 3% | > 5% |
| **Sender bounce** (Smartlead) | < 2% | **> 5% — was ~8%, threatens domain reputation** |
| Smartlead clicks vs `cold_lp_view` | roughly comparable | clicks ≫ views → most "clicks" are not browsers |
| `cold_lp_view` vs `cold_lp_engaged` | a real fraction engages | views ≫ engaged → arriving and leaving instantly |
| Booking clicks vs `booking_confirmed` | some ratio | clicks with **zero** bookings for weeks → check Cal.com redirect before blaming the offer |
| `view_search_results` | **0** | any → Site search got re-enabled |
| Key Events total | ≈ leads + bookings | far higher → a click event got marked as a conversion again |

That last row is the tripwire for this entire sprint. If Key Events drifts back toward 114, something was re-marked as a conversion.

---

## The cold-email scoreboard

For a Smartlead campaign, in this order. **Each line is weaker evidence than the line below it.**

```
1.  Delivered                    Smartlead
2.  Recipient bounces            Smartlead
3.  Sender bounces               Smartlead        <- deliverability health
4.  Replies                      Smartlead        <- first human-proof signal
5.  Positive replies             Smartlead        <- the number that matters most
6.  cold_lp_view                 GA4              <- a browser ran JS
7.  cold_lp_engaged              GA4              <- it stayed or interacted
8.  outbound_cta_click           GA4              <- intent
9.  booking_click_strategy       GA4              <- intent, site-wide superset
10. booking_confirmed            GA4 + Cal.com    <- the outcome
11. Qualified opportunity        CRM
12. Closed revenue               CRM
```

**Deliberately absent: open rate and tracked click rate.** Both are inflated by email security scanners, which is why lines 6–7 exist. A campaign with a 50% click rate and zero replies is not a 50% click rate.

Lines 8 and 9 overlap by design — clicking the primary CTA on a `/go/` page fires both. **Never add them together.**

---

## Reporting rules

1. **Never report a `booking_click_*` count as bookings.** 95 clicks, 0 bookings.
2. **Never report the GA4 Key Event total as sales.** It is whatever someone ticked a box for.
3. **Never report `cold_lp_view` as people.** It is browsers that ran JavaScript.
4. **Never report `sms_consent_submit` as a lead.** It is a consent record.
5. **State zero when it is zero.** Zero honest bookings is better information than 114 fictional conversions.
6. **Say which layer a number came from** — GA4, Smartlead, Cal.com, or the CRM. They disagree, and knowing which one you quoted is half the value.

---

## Monthly, not weekly

- Reconcile GA4 `booking_confirmed` against the Cal.com calendar.
- Reconcile CRM qualified leads against `ai_assessment_lead_submit` + `contact_form_submit` via `lead_id`.
- Re-check that no diagnostic event has been marked a Key Event.
- Review `search_term` is still empty (Site search off).
