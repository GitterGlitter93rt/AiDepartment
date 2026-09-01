# Smartlead Campaign Links — Canonical Reference

The authoritative list of tracked links used in Smartlead cold-email sequences, and the naming convention every future campaign must follow.

**Destination for all current campaigns:** `https://youraidepartment.ai/free-ai-assessment/`

---

## 1. Why this file exists

The first roofing sequence linked to `https://youraidepartment.ai/assessment/`, which has never been a route on this site. Every click 404'd. That path is now permanently redirected (see §5), but the underlying lesson is the reason for this document: **the destination URL must be verified against the live route list before a sequence sends.**

Live assessment routes:

| Route | Purpose | Status |
|---|---|---|
| `/ai-assessment/` | Chooser page — presents free vs. paid | Live, indexable. **Not a campaign destination.** |
| `/free-ai-assessment/` | Free 15-question assessment | **Campaign destination** |
| `/comprehensive-ai-business-audit/` | $495 comprehensive audit | Live, indexable |
| `/assessment/` | Legacy — 301s to `/free-ai-assessment/` | Repair only. Do not link to it in new sends. |

Point new sequences at `/free-ai-assessment/` directly. The redirect exists to rescue mail that has already gone out.

---

## 2. Naming convention

**Lowercase, underscores, no spaces.** Applied when links are *authored* — the site never rewrites or lower-cases the values it receives, because `utm_content` doubles as an ad-creative identifier elsewhere and normalising it would corrupt creative-level reporting.

| Field | Pattern | Notes |
|---|---|---|
| `utm_source` | `smartlead` | The sending platform, not the list |
| `utm_medium` | `email` | Fixed for all cold-email sends |
| `utm_campaign` | `{vertical}_{offer}_{type}_{yyyymm}` | e.g. `roofing_ai_assessment_cold_outreach_202608` |
| `utm_id` | `sl_{vertical}_{yyyymmdd}` | Identifies the specific send. Distinguishes two runs of the same campaign name. |
| `utm_content` | `step_1` … `step_4` | Which email in the sequence produced the click |
| `utm_term` | *(unused for cold email)* | Reserved for paid search |

`utm_id` is what makes a re-run of the same campaign separable in reporting. Always set it.

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

Attribution survives internal navigation — a visitor can land from a Smartlead link, browse an industry page, and start the assessment later while still being attributed to the campaign. Latest touch only updates when a pageview carries a genuine new acquisition signal, so ordinary clicking never erases it.

---

## 8. Pre-send checklist

- [ ] Destination is `/free-ai-assessment/` (not `/assessment/`, not `/ai-assessment/`)
- [ ] URL loads with a `200`, not a redirect, when pasted with the full query string
- [ ] All five parameters present and lowercase
- [ ] `utm_id` unique to this send
- [ ] `utm_content` differs per sequence step
- [ ] Verified in GA4 DebugView that `ai_assessment_start` carries the campaign fields
