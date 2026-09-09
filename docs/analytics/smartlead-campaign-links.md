# Smartlead Campaign Links — Canonical Reference

The authoritative list of tracked links used in Smartlead cold-email sequences, and the naming convention every future campaign must follow.

**Current destination for cold outbound:** the campaign landing page for the vertical — `/go/law-firms/` or `/go/roofing/` — which asks for a free 30-minute AI Strategy Call.

**Previous destination (August 2026 sends):** `https://youraidepartment.ai/free-ai-assessment/`. Those sequences are documented in §3 and §4 and are kept for reference; do not reuse them for new sends. See §9 for why the destination changed.

---

## 1. Why this file exists

The first roofing sequence linked to `https://youraidepartment.ai/assessment/`, which has never been a route on this site. Every click 404'd. That path is now permanently redirected (see §6), but the underlying lesson is the reason for this document: **the destination URL must be verified against the live route list before a sequence sends.**

Live routes a campaign might legitimately point at:

| Route | Purpose | Status |
|---|---|---|
| `/go/law-firms/` | Law-firm cold outbound landing page | **Campaign destination.** noindex, not in the sitemap |
| `/go/roofing/` | Roofing cold outbound landing page | **Campaign destination.** noindex, not in the sitemap |
| `/free-ai-assessment/` | Free 15-question assessment | Live, indexable. Destination of the August sequences; still the site-wide primary CTA |
| `/ai-assessment/` | Chooser page — presents free vs. paid | Live, indexable. **Never a campaign destination.** |
| `/comprehensive-ai-business-audit/` | $495 comprehensive audit | Live, indexable |
| `/assessment/` | Legacy — 301s to `/free-ai-assessment/` | Repair only. Do not link to it in new sends. |

Point new cold sequences at the vertical's `/go/` page (§4a). The `/assessment/` redirect exists only to rescue mail that has already gone out.

---

## 2. Naming convention

**Lowercase, underscores, no spaces.** Applied when links are *authored* — the site never rewrites or lower-cases the values it receives, because `utm_content` doubles as an ad-creative identifier elsewhere and normalising it would corrupt creative-level reporting.

| Field | Pattern | Notes |
|---|---|---|
| `utm_source` | `smartlead` | The sending platform, not the list |
| `utm_medium` | `email` | Fixed for all cold-email sends |
| `utm_campaign` | the campaign identifier | `law_firms_outbound`, `roofing_outbound` — see §4a. Older sends used `{vertical}_{offer}_{type}_{yyyymm}` |
| `utm_id` | `sl_{vertical}_{yyyymmdd}` | Identifies the specific send. Distinguishes two runs of the same campaign name. |
| `utm_content` | `{vertical}_e{n}_{variant}` | Which email in the sequence, and which variant, produced the click. Older sends used `step_1` … `step_4` |
| `utm_term` | *(unused for cold email)* | Reserved for paid search |

`utm_id` is what makes a re-run of the same campaign separable in reporting. Always set it.

§3 and §4 below record the August 2026 sends as they were actually configured. **§4a is the current standard.**

---

## 3. Roofing sequence — August 2026

```
utm_source   = smartlead
utm_medium   = email
utm_campaign = roofing_ai_assessment_cold_outreach_202608
utm_id       = sl_roofing_20260820
utm_content  = step_1 | step_2 | step_3 | step_4
```

```
https://youraidepartment.ai/free-ai-assessment/?utm_source=smartlead&utm_medium=email&utm_campaign=roofing_ai_assessment_cold_outreach_202608&utm_id=sl_roofing_20260820&utm_content=step_1
https://youraidepartment.ai/free-ai-assessment/?utm_source=smartlead&utm_medium=email&utm_campaign=roofing_ai_assessment_cold_outreach_202608&utm_id=sl_roofing_20260820&utm_content=step_2
https://youraidepartment.ai/free-ai-assessment/?utm_source=smartlead&utm_medium=email&utm_campaign=roofing_ai_assessment_cold_outreach_202608&utm_id=sl_roofing_20260820&utm_content=step_3
https://youraidepartment.ai/free-ai-assessment/?utm_source=smartlead&utm_medium=email&utm_campaign=roofing_ai_assessment_cold_outreach_202608&utm_id=sl_roofing_20260820&utm_content=step_4
```

---

## 4. Law firms sequence — August 2026

```
utm_source   = smartlead
utm_medium   = email
utm_campaign = law_firms_ai_assessment_cold_outreach_202608
utm_id       = sl_law_firms_20260820
utm_content  = step_1 | step_2 | step_3 | step_4
```

```
https://youraidepartment.ai/free-ai-assessment/?utm_source=smartlead&utm_medium=email&utm_campaign=law_firms_ai_assessment_cold_outreach_202608&utm_id=sl_law_firms_20260820&utm_content=step_1
https://youraidepartment.ai/free-ai-assessment/?utm_source=smartlead&utm_medium=email&utm_campaign=law_firms_ai_assessment_cold_outreach_202608&utm_id=sl_law_firms_20260820&utm_content=step_2
https://youraidepartment.ai/free-ai-assessment/?utm_source=smartlead&utm_medium=email&utm_campaign=law_firms_ai_assessment_cold_outreach_202608&utm_id=sl_law_firms_20260820&utm_content=step_3
https://youraidepartment.ai/free-ai-assessment/?utm_source=smartlead&utm_medium=email&utm_campaign=law_firms_ai_assessment_cold_outreach_202608&utm_id=sl_law_firms_20260820&utm_content=step_4
```

---

## 4a. Cold outbound campaigns — current standard (from September 2026)

These are the sequences that point at the `/go/` campaign landing pages. **Use these for all new cold outbound.**

### Law firms

```
utm_source   = smartlead
utm_medium   = email
utm_campaign = law_firms_outbound
utm_id       = sl_law_firms_{yyyymmdd}
utm_content  = law_e1_a | law_e1_b | law_e2_a | law_e2_b | law_e3_a ...
```

```
https://youraidepartment.ai/go/law-firms/?utm_source=smartlead&utm_medium=email&utm_campaign=law_firms_outbound&utm_id=sl_law_firms_20260909&utm_content=law_e1_a
https://youraidepartment.ai/go/law-firms/?utm_source=smartlead&utm_medium=email&utm_campaign=law_firms_outbound&utm_id=sl_law_firms_20260909&utm_content=law_e1_b
https://youraidepartment.ai/go/law-firms/?utm_source=smartlead&utm_medium=email&utm_campaign=law_firms_outbound&utm_id=sl_law_firms_20260909&utm_content=law_e2_a
https://youraidepartment.ai/go/law-firms/?utm_source=smartlead&utm_medium=email&utm_campaign=law_firms_outbound&utm_id=sl_law_firms_20260909&utm_content=law_e3_a
```

### Roofing

```
utm_source   = smartlead
utm_medium   = email
utm_campaign = roofing_outbound
utm_id       = sl_roofing_{yyyymmdd}
utm_content  = roof_e1_a | roof_e1_b | roof_e2_a | roof_e2_b | roof_e3_a ...
```

```
https://youraidepartment.ai/go/roofing/?utm_source=smartlead&utm_medium=email&utm_campaign=roofing_outbound&utm_id=sl_roofing_20260909&utm_content=roof_e1_a
https://youraidepartment.ai/go/roofing/?utm_source=smartlead&utm_medium=email&utm_campaign=roofing_outbound&utm_id=sl_roofing_20260909&utm_content=roof_e1_b
https://youraidepartment.ai/go/roofing/?utm_source=smartlead&utm_medium=email&utm_campaign=roofing_outbound&utm_id=sl_roofing_20260909&utm_content=roof_e2_a
https://youraidepartment.ai/go/roofing/?utm_source=smartlead&utm_medium=email&utm_campaign=roofing_outbound&utm_id=sl_roofing_20260909&utm_content=roof_e3_a
```

Replace `20260909` with the date the sequence actually starts sending. That is the only field that changes between two runs of the same campaign.

### Two things changed from the §2 convention, and why

**`utm_campaign` no longer carries `_{yyyymm}`.** It is now exactly the campaign identifier the site itself uses (`campaignId` in `src/data/outbound/*.ts`), so a GA4 report grouped by `campaign_id` and one grouped by `utm_campaign` line up without a lookup table. Separating two runs of the same campaign is what `utm_id` is for, and §2 already said so — the date in the campaign name was doing that job twice.

**`utm_content` carries the vertical.** `step_1` is ambiguous the moment two sequences run at once: a report grouped by `utm_content` alone shows one `step_1` row containing both. `law_e1_a` and `roof_e1_a` never collide. The structure is `{vertical}_e{email number}_{variant}`.

`tests/outboundLanding.test.ts` checks these campaign values and content prefixes against the page configuration, so the document and the code cannot drift apart.

---

## 4b. The reply-first control (no tracked link)

The control arm of the September experiment sends **email #1 with no link at all** and asks for a reply. There is no URL to tag, and that is the point: it measures whether the click is the bottleneck or the offer is.

Do not add a tracking pixel or a "read receipt" to make it measurable. The measurement for that arm is the reply count in Smartlead, and a reply is a far stronger signal than anything a pixel would produce.

See `docs/analytics/smartlead-experiment-plan.md` for the full structure of both arms and what to compare.

---

## 5. A/B testing within a step

When two subject lines or bodies are tested for the same sequence position, suffix `utm_content` with the variant:

```
step_1_a
step_1_b
step_3_a
step_3_b
```

Keep `utm_campaign` and `utm_id` identical across variants — only `utm_content` changes, so the variants roll up to the same campaign while remaining separable.

---

## 6. Legacy link repair

`/assessment` and `/assessment/` → `301` → `/free-ai-assessment/`, query string preserved.

Two layers:

1. **`public/.htaccess`** — `RewriteRule ^assessment/?$ /free-ai-assessment/ [R=301,QSA,L]`. A genuine HTTP 301 from Apache on SiteGround. `QSA` carries the UTMs through.
2. **`src/pages/assessment/index.astro`** — a static stub that only renders if `mod_rewrite` is unavailable. Redirects from the `<head>` with `location.replace(path + search + hash)` before the GTM container loads, so GA4 records one page_view (for the destination) rather than two. `noindex, follow`, canonical → `/free-ai-assessment/`.

Do not use `/assessment/` in new sends.

---

## 7. What gets captured, and where it lands

Capture is handled by the existing `src/lib/attribution.ts` (first-touch and latest-touch, 90-day retention, `localStorage`).

| Field | GA4 assessment events | Lead email (Web3Forms) |
|---|---|---|
| `utm_id` | ✅ | `attribution_utm_id` |
| `utm_source` | ✅ | `attribution_utm_source` |
| `utm_medium` | ✅ | `attribution_utm_medium` |
| `utm_campaign` | ✅ | `attribution_utm_campaign` |
| `utm_content` | ✅ | `attribution_utm_content` |
| `utm_term` | ✅ | `attribution_utm_term` |

Campaign fields are attached to `ai_assessment_start`, `ai_assessment_complete`, and `ai_assessment_lead_submit` through the single allowlist in `withCampaignParams()` (`src/lib/assessment/ga4Events.ts`). Nothing outside the six UTM fields can reach GA4 through that path.

**Never in GA4 or the dataLayer:** name, email, phone, company, or assessment answers. The lead's identity travels only in the Web3Forms email, correlated to analytics by the non-PII `lead_id`.

**Never in a UTM value:** anything that identifies a person. No `{{email}}`, no `{{first_name}}`, no `{{phone}}`, no per-recipient hash. UTM values end up in GA4, in referrer headers, and in browser history. Campaign, sequence step and variant are the correct granularity; the individual prospect belongs in Smartlead and the CRM, not in a URL.

On the `/go/` campaign pages the same six fields additionally reach `cold_lp_view`, `cold_lp_engaged` and `outbound_cta_click`, and — because they are restored from the first-party attribution store rather than the URL — `booking_confirmed`. See `docs/analytics/conversion-event-taxonomy.md`.

Attribution survives internal navigation — a visitor can land from a Smartlead link, browse an industry page, and start the assessment later while still being attributed to the campaign. Latest touch only updates when a pageview carries a genuine new acquisition signal, so ordinary clicking never erases it.

---

## 8. Pre-send checklist

- [ ] Destination is the vertical's `/go/` page (not `/assessment/`, not `/ai-assessment/`, and — for new sends — not `/free-ai-assessment/`)
- [ ] URL loads with a `200`, not a redirect, when pasted with the full query string
- [ ] All five parameters present and lowercase
- [ ] `utm_campaign` exactly matches the page's `campaignId`
- [ ] `utm_id` unique to this send (the date is the only part that changes between runs)
- [ ] `utm_content` differs per sequence step and variant, and carries the vertical prefix
- [ ] No prospect identifier anywhere in the query string
- [ ] Verified in GA4 DebugView that `cold_lp_view` carries the campaign fields

---

## 9. Why the destination changed

The August sequences pointed at `/free-ai-assessment/`. A free assessment is a good offer for someone who arrived from search already thinking about the problem. It is the wrong first ask for someone who was interrupted at work by an email from a stranger: it asks them to answer fifteen questions before a human has said anything to them, and the effort lands entirely on the side of the person who did not ask to be contacted.

The `/go/` pages ask for a 30-minute conversation instead and keep the assessment available as a clearly secondary option, for the reader who genuinely prefers to look before they talk.

The assessment is not retired and nothing about it changed. It remains the site-wide primary CTA (`PRIMARY_CTA` in `src/lib/site.ts`), which is correct for organic and paid-search traffic arriving with intent. Only the **cold outbound** destination changed.
