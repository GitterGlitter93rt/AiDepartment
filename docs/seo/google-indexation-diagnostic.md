# Google Indexation Diagnostic — Search Console Exclusion Reasons

Status: Active internal process document — now incorporating REAL Search Console data
Version: 2.0 (previously 1.0, pre-Search-Console)

---

# AUTHORITATIVE SEARCH CONSOLE DATA (as of report date)

**Report last updated: August 20, 2026.**
**Validation started: August 20, 2026.**

| Metric | Count |
|---|---|
| Total known pages | **127** |
| Indexed | **24** |
| Not indexed | **103** |
| — Discovered – currently not indexed | **85** |
| — Crawled – currently not indexed | **16** |
| — Alternate page with proper canonical tag | **2** |

This data is authoritative. It is treated as ground truth for what Google
has actually decided — the local technical audit below explains what the
SITE does; it cannot and does not override what Search Console reports
Google did.

**The site-side technical audit did NOT find a broad robots/sitemap/
canonical blocker.** Every indexable page is self-canonical on HTTPS with
a consistent trailing slash, the sitemap contains exactly the 117
indexable URLs with no redirects/noindex/404s, robots.txt allows all
paths, and internal linking has no orphaned pages (see
`docs/seo/full-site-seo-audit.md`). Do not manufacture a technical-bug
narrative merely because 103 pages are not indexed — the evidence does
not support one, and the two exclusion categories below have very
different, well-documented, non-bug explanations.

## 127 known vs. 117 locally indexable — the reconciliation

**Update (this pass, verified live):** the live sitemap was checked
directly and contains exactly 117 URLs, matching this repo's indexable
count with zero drift. The most evidence-supported explanation for the
127-vs-117 gap: the prior pass confirmed live that
`https://www.youraidepartment.ai/` served every page with HTTP 200
**without redirecting** to the non-www host (mitigated only by a
self-referencing canonical tag). **That has since been fixed
externally at Cloudflare** — re-verified live this pass: `www.*` now
returns a proper `301` to the non-www host, with query strings
preserved. If Search Console had crawled or discovered pages under the
`www` host before this fix (report date 2026-08-20, before or at the
time of the fix), those would count as additional "known" URLs distinct
from their non-www canonical targets — a www/non-www pair reasonably
close to explaining a small gap like 10 URLs. This remains a plausible,
evidence-backed explanation for the count discrepancy in the existing
report; it should resolve on its own in subsequent crawls now that the
redirect exists, and can be confirmed with the actual export if one is
pulled after the next Search Console refresh. See the live-host
verification table in `docs/seo/full-site-seo-audit.md`.

---

# GROUP A vs. GROUP B — DO NOT TREAT THESE THE SAME WAY

## GROUP A: "Discovered – currently not indexed" (85 URLs)

**What the data shows:** these 85 URLs commonly show **Last crawled:
N/A** — Google knows the URLs exist (almost certainly via the sitemap
and internal links) but has not yet fetched them, and has not decided
to reject them. This is fundamentally a **discovery/crawl-priority**
category, not a content-quality verdict.

**"Not indexed" here does NOT mean Google rejected the content.** It
means Google has not looked at the content yet.

Plausible, evidence-supported interpretation for this specific site:
- A large batch of pages (28 industry pages, 62 resource articles, and
  supporting commercial pages) appears to have gone live in a
  concentrated period in mid-August 2026, based on the site's own sprint
  history and the Search Console graph's abrupt URL-discovery increase.
  Publishing ~100 URLs at once on a new, low-authority domain is a
  known trigger for exactly this "Discovered, N/A crawl date" pattern —
  Google paces how quickly it commits crawl budget to a domain it does
  not yet trust, especially after a sudden volume increase.
- This is a **plausible interpretation**, not confirmed Google behavior
  for this site. It is supported by (a) 85 URLs in this state, (b) N/A
  crawl dates across nearly all of them, and (c) the abrupt discovery
  increase — but it is not something Search Console states outright,
  and it should be revisited once the real per-URL export is available.

**What to prioritize for Group A:**
- Discovery strength: is the URL in the sitemap? (Yes for all 117 —
  verified.) Is it linked from somewhere other than the sitemap?
- Internal link quality: does it have genuine contextual (body-content)
  inbound links, or is it reachable only through nav/footer chrome
  repeated on every page? (See the "contextual inbound links" analysis
  in `docs/seo/full-site-seo-audit.md` — this pass found and fixed
  several real gaps: `/ai-workshops/` had zero contextual inbound links
  before this pass; 18 industry pages had zero links back to the
  resource articles that already reference them.)
- Site-wide authority signals: backlinks, domain age, prior Search
  Console history — none of this is visible locally and must come from
  Search Console / external tools.
- Whether too many pages were launched simultaneously (see above) —
  documented as a plausible factor, not proven.

**Do NOT rewrite entire pages solely because they are in Group A.** A
page with Last Crawled: N/A has not been judged on its content at all.

## GROUP B: "Crawled – currently not indexed" (16 URLs)

**What this means:** Google actually fetched and rendered these 16
pages, then made an active decision not to index them. This is the more
diagnostically important category — it reflects Google's judgment of
the content itself (or its competitive position against similar URLs),
not merely a discovery lag.

**For this group, investigate aggressively for:** weak unique value,
duplicate/near-duplicate intent, excessive template similarity,
cannibalization, soft-404-like thinness, unclear primary topic, and weak
internal authority.

## ⚠️ THE EXACT 16 URLS ARE NOT AVAILABLE IN THIS REPOSITORY

`docs/seo/input/` contains only its own README — **no Search Console
CSV/export file is present** (verified by search: no `.csv` files exist
anywhere in this repository outside `node_modules`).

**This means: URL-level remediation of the 16 "Crawled – currently not
indexed" pages CANNOT be performed in this pass.** No list of the 16
URLs has been invented, guessed, or reconstructed from the site's
general architecture. Per-URL analysis (primary intent, word/content
depth, unique value, similarity risk, cannibalization risk, internal
links, and a specific recommended change for each) is described as a
required PROCESS in `docs/seo/search-console-action-plan.md`, ready to
run the moment the export is dropped into `docs/seo/input/` per that
folder's README (expected filename:
`search-console-indexing-export.csv`).

Until that export exists, the best available proxy is the site-wide
duplicate-intent and template-similarity audit already performed
locally (see `docs/seo/full-site-seo-audit.md`), which found zero
duplicate titles/descriptions/H1s and no thin (<350-word) pages — i.e.
no site-wide near-duplicate template problem broad enough to explain 16
specific exclusions. If the 16 URLs turn out to cluster inside a
specific group (e.g. several industry pages, or several resources on a
similar sub-topic), that clustering itself would be the diagnostic
signal — but it cannot be known without the export.

---

# THE MOST LIKELY OVERALL EXPLANATION (retained from v1.0, now cross-checked against real data)

The local technical audit (see full-site-seo-audit.md) found the site
technically clean: sitemap complete and valid, self-canonicals correct,
no accidental noindex, no thin/duplicate templates, healthy internal
linking. Cross-checked against the real Search Console counts above,
this remains consistent: 85 of the 103 "not indexed" URLs (82%) are in
the discovery-lag category (Group A), not the content-rejection
category (Group B). For a new domain with low authority and a recently
deployed, bulk-published site, this distribution is exactly what a
crawl-budget/site-authority explanation would predict — but this is a
hypothesis supported by the distribution, not proven by it.

---

# EXCLUSION STATUS REFERENCE

## Discovered – currently not indexed

What it means: Google discovered the URL (via sitemap, internal links,
or external links) but has not crawled it yet, and chose not to.

Likely site-side causes:
- New/low-authority domain; Google deprioritizes crawling
- Low crawl budget allocation to the domain
- Weak or missing external backlinks to the site or section
- Pages reachable only through long paths with little link equity

What to inspect:
- Confirm the URL is in the sitemap with correct canonical format
- Confirm it has real internal inbound links (see the audit scorecard)
- Check whether the *site as a whole* (not just the URL) has authority
  issues: few backlinks, recent domain, no Search Console improvements

Recommended next action:
- Do not mass-request indexing. Improve internal linking to the
  section, earn external links, and let crawl demand build. Request
  indexing only for the highest-priority Tier 1/2 URLs (see the audit's
  priority tiers) after structural checks pass.

## Crawled – currently not indexed

What it means: Google fetched and rendered the page but decided not to
index it.

Likely site-side causes:
- Content quality/value signals below Google's threshold (thin,
  templated, or duplicative content relative to what else it can serve)
- Page competes with another URL for the same intent and Google picked
  the other one
- New domain quality uncertainty — very common for entire new sites
- Slow response or render issues at crawl time (hosting side)

What to inspect:
- URL Inspection → view crawled HTML: confirm full content is present
  server-rendered (it is for this static site — verify anyway)
- Compare the page against its sibling pages: is it genuinely
  differentiated?
- Compare Google-selected canonical vs the declared canonical

Recommended next action:
- Differentiate or consolidate near-duplicate intent groups (the audit
  flags these). Request indexing for representative Tier 1/2 URLs after
  fixes.

## Duplicate without user-selected canonical

What it means: Google sees the URL as duplicating another and no
canonical was declared, so Google chose one itself.

Likely site-side causes:
- Missing canonical on one of the duplicates
- Same content reachable at multiple URL forms (trailing slash,
  http/https, www/non-www, query parameters)

**Update — RESOLVED this pass:** `www.youraidepartment.ai` previously
served every page at HTTP 200 without redirecting to the non-www host
(mitigated only by a self-referencing canonical tag). **This has been
fixed externally at Cloudflare and is re-verified live this pass**:
`www.*` now returns a proper `301 Moved Permanently` to the matching
non-www URL, confirmed on both the homepage and a path with query
parameters (query strings preserved exactly). No repo change was
needed — the app's canonical/OG/schema logic already always emitted
the non-www host regardless of which host served the request.

What to inspect:
- Both URLs' canonical tags and robots directives
- Hosting-level redirects: does the host force a single scheme/host?
  This site declares `https://youraidepartment.ai/` with trailing
  slash. **All three checked this pass: http→https,
  non-trailing-slash→trailing-slash, and www→non-www are ALL confirmed
  working via live curl checks.** No hosting-level redirect gaps remain
  identified.

Recommended next action:
- None required — canonicals are declared consistently and the www
  redirect is now live. Monitor Search Console over the next crawl
  cycle(s) for any residual www-host entries to clear on their own.

## Alternate page with proper canonical

What it means: the URL is a duplicate and its declared canonical points
elsewhere — Google agrees. Healthy and expected for deliberate
variants.

**2 URLs are in this state per the August 20, 2026 report.** The exact
URLs remain unavailable (no export). Two plausible, non-exclusive
explanations, neither confirmed:
1. The retired `/ai-department-audit/` redirect (declares a canonical
   to `/comprehensive-ai-business-audit/`).
2. A `www.youraidepartment.ai` URL crawled/discovered before this
   pass's confirmed www→non-www 301 fix went live — before the fix,
   the www version returned 200 with a canonical pointing to the
   non-www URL, which is exactly this status's definition. **Now that
   a real 301 exists, any such URL should reclassify to "Page with
   redirect" on Google's next crawl of it** — worth checking in the
   next export rather than assuming it is still in this bucket.

Action: none required if the canonical target is correct (it is, for
the one known case, `/ai-department-audit/`). Reconcile the second URL
once the export is available; expect it may have already moved to a
different status by then given the www fix.

## Excluded by noindex

What it means: the page carries a robots noindex directive.

Expected on this site for exactly:
- `/ai-assessment/full/` (internal comprehensive engine)
- `/ai-assessment/results/` (personal results utility)
- `/booking-confirmed/` (booking success utility)
- `/404.html` (error page)
- `/ai-department-audit/` (retired redirect stub)

Action: none — these are intentional. If any OTHER URL appears here,
the local audit's "accidental noindex" test will have caught it
locally; investigate immediately.

## Blocked by robots.txt

What it means: robots.txt prevents crawling. NOTE: combined with
noindex this can leave a URL indexed without content.

Site-side: `public/robots.txt` allows all paths and declares the
sitemap. No intentional blocks exist.

Action: if URLs appear here, compare the deployed robots.txt with the
repo's `public/robots.txt` — a hosting-layer or CDN-layer robots file
may have replaced it.

## Not found (404)

What it means: the URL returned 404 at crawl time.

Site-side: the static build contains all intended routes. Genuine 404s
are external/stale links.

What to inspect: whether the intended page moved (then add a redirect
in `astro.config.mjs` or hosting .htaccess).

## Soft 404

What it means: the URL returns 200 but Google judges the content
thin/empty/not matching what a real page on that topic should contain.

Site-side: the local audit measured every indexable page at >350 words
with unique titles/descriptions/H1s; soft-404 risk is low. Watch pages
that fail to differentiate from siblings.

Action: strengthen or consolidate the specific pages Google flags.

## Page with redirect

What it means: the URL redirects. Google follows the redirect and
indexes the target.

Expected on this site for: `/ai-department-audit/` →
`/comprehensive-ai-business-audit/`.

Action: none, unless a redirect chain (more than one hop) appears —
check with `curl -sIL https://youraidepartment.ai/ai-department-audit/`
and confirm a single hop.

## Server error (5xx)

What it means: crawl-time server errors.

Action: hosting-side investigation (SiteGround). Not diagnosable from
the static build; requires hosting logs.

## Indexed

The URL is indexed. Baseline for comparison: check the indexed set
against the audit's indexable inventory — any indexed URL that is NOT
in our inventory (e.g. `/ai-assessment/full/`) indicates the deployed
build differs from this repo and must be reconciled.

---

# SAMPLE AUDIT PROCESS

**Status: not yet run — no Search Console export exists in this repo.**
See `docs/seo/search-console-action-plan.md` for the deployment/
indexation action sequence this feeds into.

1. Export the **Pages → Indexing** report from Search Console
   (Coverage-style export, "Page indexing" report → Export button).
   Save it into `docs/seo/input/` using the filename conventions in
   that folder's README.
2. Group URLs by exclusion reason.
3. Sample 10-20 URLs from each major group (prioritize Discovered and
   Crawled groups).
4. Compare each sampled URL against the local indexability scorecard
   in `docs/seo/full-site-seo-audit.md` (route present? canonical?
   sitemap? inbound links? verdict).
5. Run URL Inspection on representative pages.
6. Compare Google-selected canonical vs the declared canonical.
7. Inspect the crawled HTML for rendering completeness (all server-
   rendered content present — this static site renders fully).
8. Inspect referring/internal pages for the URL.
9. Request indexing ONLY AFTER structural issues are fixed, and only
   for the priority tiers listed in the audit doc (start with Tier 1).
10. Resubmit the sitemap after each deploy that changes indexable
    URLs, titles, or canonicals.