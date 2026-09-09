# `view_search_results` — Investigation and Remediation

**Date:** 2026-09-09
**Evidence window:** 2026-08-10 → 2026-09-06 (settled GA4)
**Status:** root cause identified with high confidence. **Remediation is a GA4 setting, not a code change.**

---

## 1. The observation

GA4 recorded **299 `view_search_results` events** across roughly **278 users** in 28 days — the fifth most common event on the property, ahead of `scroll` (175) and `click` (108).

Concentration, from the session filter:

| Source / medium | Sessions containing the event |
|---|---|
| google / cpc | ~274 |

| Landing page | Sessions |
|---|---|
| `/enterprise` | 232 |
| `/ai-consulting` | 20 |
| `/ai-implementation` | 16 |
| `/ai-assessment` | 8 |
| everything else | trace |

Two things stand out. The event is almost entirely paid search, and it is concentrated on `/enterprise` — the primary Google Ads landing page.

---

## 2. Does this site have an internal search?

**No.** Verified exhaustively against the repository at `fdff424`:

| Check | Result |
|---|---|
| `type="search"` or `role="search"` anywhere in `src/` | none |
| A `/search` route | does not exist |
| Search dependency (`pagefind`, `algoliasearch`, `fuse.js`, `lunr`) | none in `package.json` |
| "search" in header, footer or nav config | none |
| Any built page linking to a `?q=` / `?s=` / `?search=` / `?query=` URL | none across all 129 pages |

There is no feature that could produce a legitimate site-search event. Every one of those 299 events is measuring something that did not happen.

`tests/analyticsIntegrity.test.ts` now asserts all of the above, so a future search feature cannot be added without the assertion failing and forcing this document to be revisited.

---

## 3. Root cause

**GA4 Enhanced Measurement's "Site search" sub-event fires on the presence of a query parameter, and one of its defaults collides with a Google Ads ValueTrack parameter this site legitimately uses.**

GA4's Site search measurement watches a default list of query parameters. That list includes **`q`, `s`, `search`, `query`, `keyword`**.

`src/lib/attribution.ts` captures `keyword` as part of its Google Ads ValueTrack set:

```ts
const URL_PARAM_KEYS = [
  'gclid', 'gbraid', 'wbraid', 'fbclid',
  'utm_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'creative_id',
  'campaignid', 'adgroupid', 'keyword', 'matchtype', 'device', 'network', 'creative', 'targetid',
];
```

The site captures `keyword` because it is genuinely valuable: it is forwarded to the Cal.com booking URL and written onto the lead payload (`attribution_keyword`), so a lead can be traced to the ad keyword that produced it.

For the site to *see* that parameter, the Google Ads final URL suffix or tracking template must be appending `keyword={keyword}` to landing URLs. When it does, every paid-search click arrives at a URL like:

```
https://youraidepartment.ai/enterprise/?gclid=…&campaignid=…&keyword=ai%20consulting%20firm&matchtype=b&device=c
```

GA4 Enhanced Measurement sees `keyword=` in the URL, concludes the visitor performed a site search, and emits `view_search_results` with the ad keyword as `search_term`.

### Why this explanation fits every observation

| Observation | Explained |
|---|---|
| ~274 of ~299 events are google / cpc | only paid-search URLs carry `keyword=` |
| Concentrated on `/enterprise` (232) | the main Google Ads landing page |
| 299 events across 278 users | roughly one per paid landing, as a per-pageview URL check would produce |
| The site has no search | the events are not describing user behaviour at all |
| Website code emits no such event | Enhanced Measurement reads the URL directly, not the dataLayer |

### What is *not* the cause

| Candidate | Ruled out because |
|---|---|
| Website JavaScript | No code emits `view_search_results`; zero occurrences in the entire repository |
| GTM | The container would have to define a tag for it; the event is an Enhanced Measurement built-in |
| `utm_term` | Not in GA4's site-search default list, and the site does not populate it on paid search |
| A real user searching | There is nothing to search |

### Confidence, stated honestly

**High that the mechanism is Enhanced Measurement site-search matching a URL parameter. High that the site has no search and these events are meaningless.**

Not directly verified from this environment: the exact Google Ads final URL suffix, and the exact parameter list configured on the GA4 data stream. Both live in external UIs. The remediation in §4 is safe either way, because turning off a feature the site does not have cannot lose real data — and §4.3 gives the one-minute confirmation.

---

## 4. Remediation

### 4.1 Do NOT fix this in website code

Three reasons:

1. **The code is not wrong.** `keyword` is captured deliberately and reaches the lead record and the Cal.com handoff, where it is useful. Removing it would destroy real attribution to silence a reporting artefact.
2. **It would not work.** Enhanced Measurement reads `window.location`, not the dataLayer. No amount of JavaScript in this repository prevents GA4 from reading the URL bar.
3. **Suppressing GA4 events from page code is the wrong architecture**, and the kind of change that is impossible to reason about two sprints later.

### 4.2 The fix — GA4 Admin, one toggle

**Preferred: turn Site search measurement off entirely.**

```
GA4 → Admin → Data collection and modification → Data streams
  → youraidepartment.ai
  → Enhanced measurement → (gear icon)
  → Site search  →  OFF
  → Save
```

This is correct rather than merely convenient: the site has no search, so the measurement has nothing legitimate to record. Turning it off cannot lose real data.

**Alternative, if Site search is ever wanted later:** leave it on and remove `keyword` from the stream's query-parameter list, keeping only parameters the site would genuinely use. This is fiddlier, leaves a feature enabled for no current purpose, and re-breaks the moment someone restores the default list.

**Do not** change the Google Ads final URL suffix to drop `keyword={keyword}`. That would fix the symptom by destroying the lead-level keyword attribution the business actually uses.

### 4.3 Verify — before and after

**Confirm the cause first (one minute, no changes):**

1. GA4 → Reports → Engagement → Events → `view_search_results`.
2. Add `search_term` as a secondary dimension.
3. If the values are **advertising keywords** (`ai consulting firm`, `enterprise ai`), the diagnosis is confirmed — nobody typed those into a search box this site does not have.

**After turning it off:**

4. Load a paid-style URL in a private window:
   `https://youraidepartment.ai/enterprise/?keyword=test-term&gclid=TEST123`
5. GA4 → Realtime (or DebugView): a `page_view` should appear, and **no** `view_search_results`.
6. After 24–48h, the event count should fall to zero on new traffic.

### 4.4 Historical data

Events already recorded cannot be removed and should not be. They are a known artefact of a known cause, now documented.

**Do not create a GA4 data filter to exclude them.** A filter would be permanent, would apply to processing rather than reporting, and carries far more risk than an event that is simply understood and ignored.

When reporting on the baseline window, state that `view_search_results` in that period is a paid-search URL artefact and not user behaviour.

---

## 5. Impact on the numbers already reported

`view_search_results` was **not** among the GA4 Key Events, so it did not contribute to the 114 Key Event count. Its practical harm was narrower but real:

- It made the property look like a search-heavy site to anyone scanning the events report.
- It is the third-largest event by volume, which distorts any "top events" view.
- `search_term` was silently accumulating advertising keywords in a dimension nobody had reason to inspect — not a privacy problem (ad keywords are not personal data), but not something anyone intended either.

None of that changes a lead, a booking, or a conversion count.
