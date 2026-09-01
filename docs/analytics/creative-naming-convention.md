# Creative Naming Convention — Paid Social VSL Funnels

Every ad, every time. Inconsistent naming here is unrecoverable later: if two creatives share a `utm_content` value, no amount of analysis will separate them after the fact.

**Rule zero:** lowercase, underscores only, no spaces, no dates, no personal names.

---

## 1. The three identifiers

| Field | Owner | Required | Purpose |
|---|---|---|---|
| `utm_campaign` | Meta campaign | Yes | Which funnel/offer |
| `utm_content` | Meta ad (creative) | **Yes — primary** | **Which exact video creative.** This is the field all creative reporting depends on. |
| `creative_id` | Us (internal) | Optional | A human-readable label describing the *hook*, so reporting is readable without a lookup table |

`utm_content` is the primary creative identifier. `creative_id` is a secondary internal convenience — never required, and never a substitute.

---

## 2. Naming patterns

### Campaign — `utm_campaign`
Use the funnel's `campaignName` from `src/data/funnels/`:

| Funnel | Campaign |
|---|---|
| `/plumbing-ai/` | `plumbing_ai` |
| `/personal-injury-ai/` | `personal_injury_ai` |
| `/divorce-law-ai/` | `divorce_law_ai` |

### Ad set
`{vertical}_{audience}_{geo}` — e.g. `plumbing_owners_us`, `pi_firm_owners_us`, `divorce_firm_owners_us`

Ad set naming is for Meta's UI only; it is not carried in the URL. Keep it consistent anyway.

### Creative — `utm_content`
`{prefix}_{nn}` using the funnel's `creativePrefix`, with a zero-padded two-digit sequence:

| Funnel | Prefix | Examples |
|---|---|---|
| plumbing | `plumbing_ugc_vsl` | `plumbing_ugc_vsl_01`, `plumbing_ugc_vsl_02` |
| personal injury | `pi_ugc_vsl` | `pi_ugc_vsl_01`, `pi_ugc_vsl_02` |
| divorce / family law | `divorce_ugc_vsl` | `divorce_ugc_vsl_01`, `divorce_ugc_vsl_02` |

**Never reuse a number.** A re-edit is a new number, not the same one. If `plumbing_ugc_vsl_03` gets a new hook, it becomes `plumbing_ugc_vsl_07` — not `plumbing_ugc_vsl_03_v2`.

### Internal creative label — `creative_id`
`{vertical}_v{n}_{hook}` — describes the angle, not the file:

| Funnel | Examples |
|---|---|
| plumbing | `plumbing_v1_missed_calls_hook`, `plumbing_v1_after_hours_hook`, `plumbing_v2_estimate_followup_hook` |
| personal injury | `pi_v1_paid_leads_hook`, `pi_v1_intake_speed_hook`, `pi_v2_attribution_hook` |
| divorce / family law | `divorce_v1_slow_intake_hook`, `divorce_v1_after_hours_hook` |

Allowed characters: `a-z 0-9 . _ -`. Max 64 characters. Anything else is stripped on capture (`sanitizeCreativeId()` in `src/lib/attribution.ts`).

---

## 3. Full URL templates

Copy these into the Meta ad's website URL field and change only the creative values.

**Plumbing**
```
https://youraidepartment.ai/plumbing-ai/?utm_source=meta&utm_medium=paid_social&utm_campaign=plumbing_ai&utm_content=plumbing_ugc_vsl_01&creative_id=plumbing_v1_missed_calls_hook
```

**Personal injury**
```
https://youraidepartment.ai/personal-injury-ai/?utm_source=meta&utm_medium=paid_social&utm_campaign=personal_injury_ai&utm_content=pi_ugc_vsl_01&creative_id=pi_v1_paid_leads_hook
```

**Divorce / family law**
```
https://youraidepartment.ai/divorce-law-ai/?utm_source=meta&utm_medium=paid_social&utm_campaign=divorce_law_ai&utm_content=divorce_ugc_vsl_01&creative_id=divorce_v1_slow_intake_hook
```

`utm_source=meta` and `utm_medium=paid_social` are fixed for all Meta / Facebook / Instagram placements. `creative_id` may be omitted — `utm_content` alone is a complete creative signal.

> **Do not** use Meta's dynamic URL parameters (`{{ad.name}}`) for `utm_content`. Ad names get renamed in the UI, which silently rewrites history. Hardcode the value.

---

## 4. Creative register

Maintain this table as creatives ship. It is the lookup that makes reporting readable a year from now.

| utm_content | creative_id | Funnel | Hook / angle | Format | Live since | Status |
|---|---|---|---|---|---|---|
| _(none yet — first creatives pending from the ad production workflow)_ | | | | | | |

---

## 5. What we compare creatives on

For each `utm_content`, in this order:

1. `funnel_view` — sessions delivered
2. `vsl_play` — did the hook earn a play
3. `vsl_progress ≥ 50` — did the body of the VSL hold
4. `funnel_cta_click` — did the offer land
5. `booking_click_*` — did they go to the calendar
6. `booking_confirmed` — did a call actually get booked
7. Offline outcome — signed client / booked job value

**The decision metric is `booking_confirmed` per 1,000 `funnel_view`.** Not CTR, not CPC, not CTA clicks. A creative with a strong hook and weak booking rate is attracting the wrong buyer and should be cut even if its click metrics look excellent.

Do not judge a creative before it has produced enough `funnel_view` volume for the booking rate to mean anything.

---

## 6. Checklist before publishing an ad

- [ ] `utm_campaign` matches the funnel's campaign name exactly
- [ ] `utm_content` uses the correct prefix and an unused number
- [ ] `creative_id` describes the hook (or is omitted entirely)
- [ ] The URL is hardcoded, not built from Meta dynamic parameters
- [ ] The creative is added to the register table above
- [ ] The URL loads the correct funnel and `funnel_view` fires with the right `utm_content` in GTM Preview
