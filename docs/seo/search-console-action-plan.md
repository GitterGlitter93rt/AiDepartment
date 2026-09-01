# Search Console Action Plan

Status: Active — current as of the 2026-08-20 Search Console report,
updated after the live www→non-www fix and final pre-deployment verification
Version: 1.1

This is the action-oriented companion to `docs/seo/google-indexation-diagnostic.md`
(status reference) and `docs/seo/full-site-seo-audit.md` (local scorecard).

---

# 1. AUTHORITATIVE COUNTS (Search Console, report updated 2026-08-20; validation started 2026-08-20)

| Metric | Count |
|---|---|
| Total known pages | 127 |
| Indexed | 24 |
| Not indexed | 103 |
| — Discovered – currently not indexed | 85 |
| — Crawled – currently not indexed | 16 |
| — Alternate page with proper canonical tag | 2 |

The site-side technical audit did **not** find a broad robots/sitemap/
canonical blocker. Live-host checks confirm:

- ✅ http→https redirect: working
- ✅ non-trailing-slash→trailing-slash redirect: working
- ✅ **www→non-www redirect: NOW FIXED and re-verified live this pass**
  (`https://www.youraidepartment.ai/*` → `301` →
  `https://youraidepartment.ai/*`, query strings preserved exactly —
  fixed externally at Cloudflare; no repo change was needed since the
  app's canonical/OG/schema logic already always emitted the non-www
  host)
- ✅ Live sitemap: exactly 117 URLs, zero drift from this repo
- ✅ Cloudflare confirmed in front of production; blocks known
  AI-training crawlers while explicitly allowing Googlebot's search
  indexing (`Content-Signal: search=yes`, `Allow: /` preserved)

Full detail: `docs/seo/full-site-seo-audit.md` "Live-host verification."
**No remaining hosting-level redirect gaps are known.**

---

# 2. CRAWL vs. INDEX — WHY THESE TWO GROUPS NEED DIFFERENT RESPONSES

**Discovered – currently not indexed (85 URLs, Last Crawled: N/A for
most):** Google knows the URL exists but has not fetched it yet. This
is a discovery/crawl-priority state — it says nothing about content
quality, because the content has not been evaluated. Do not rewrite
pages in this group based on their membership in it alone. Plausible
contributing factors, none confirmed as THE cause: a large batch of
~100 pages went live in a concentrated period, and Google paces crawl
budget on a new/low-authority domain, especially after a sudden volume
increase. This is a hypothesis supported by the pattern (85 URLs, N/A
crawl dates, abrupt discovery increase), not something Search Console
states outright.

**Crawled – currently not indexed (16 URLs):** Google fetched the page
and actively chose not to index it. This is the diagnostically
meaningful group — it reflects a real judgment about the content or its
competitive position. **The exact 16 URLs are not available in this
repository** (no Search Console export exists — verified again this
pass: no `.csv` files anywhere outside `node_modules`). No list has
been invented. Individual remediation is BLOCKED on obtaining the
export. See §7.

**Alternate page with proper canonical (2 URLs):** healthy/expected for
deliberate variants. Most likely explained by (a) the retired
`/ai-department-audit/` redirect stub, and/or (b) a www-host URL
crawled/discovered before this pass's confirmed www→non-www fix went
live — which should reclassify to "Page with redirect" on Google's next
crawl now that a real 301 exists. Not confirmed without the export.

---

# 3. SEARCH CONSOLE DEPLOYMENT CHECKLIST (post-deployment sequence)

Items 2-7 were pre-verified live during this pass against the current
production site; re-verify after each subsequent deploy since a bad
deploy could regress any of them.

1. ⬜ **Upload the fresh production build** — `~/youraidepartment-production.zip`
   (created this pass; see §9 of the final report for path/size).
2. ✅ **Verify the live homepage** — loads, correct title/H1/content.
   Verified this pass via live fetch.
3. ✅ **Verify `robots.txt`** — live version allows `Googlebot` (Cloudflare
   adds an AI-training-crawler block layer on top, which does not
   affect search indexing — see `docs/seo/full-site-seo-audit.md`
   "Live-host verification"). `Allow: /` and the sitemap directive are
   both present.
4. ✅ **Verify `sitemap.xml`** — live version has exactly 117 URLs,
   matching this repo's indexable set with zero drift.
5. ✅ **Verify canonical on homepage** — `<link rel="canonical"
   href="https://youraidepartment.ai/">`, confirmed on both the
   non-www and www hosts (www still emits the correct non-www
   canonical even before its redirect fires, and now also redirects).
6. ✅ **Verify paid/free assessment routes** — `/free-ai-assessment/`
   and `/comprehensive-ai-business-audit/` both build, are indexable,
   canonical to themselves, and the paid page's CTA resolves to the
   centralized `SCHEDULING.comprehensiveAudit.url`
   (`https://cal.com/youraidepartment/comprehensive-ai-business-audit`,
   $495, 45 minutes) — verified this pass by reading the built output
   and source config directly (see §11 of the final report).
7. ✅ **Verify www redirects to non-www with 301** — confirmed live this
   pass, including query-string preservation.
8. ⬜ **Resubmit the sitemap** in Search Console after deploy (Sitemaps
   → resubmit `https://youraidepartment.ai/sitemap.xml`).
9. ⬜ **URL Inspect Tier 1 pages** (§4 below) one at a time.
10. ⬜ **Request indexing for Tier 1 pages individually** via URL
    Inspection → Request Indexing.
11. **Do NOT request all 117 pages manually.** Mass-requesting indexing
    on a new/low-authority domain does not increase crawl budget and
    can look like abuse of the tool.
12. ⬜ **Monitor the "Discovered – currently not indexed" count** over
    the following 1-4 weeks. A shrinking count alongside a growing
    Indexed count is the expected healthy pattern.
13. ⬜ **Monitor the "Crawled – currently not indexed" count** — a
    shrinking count here (as opposed to Discovered) reflects Google
    actively re-judging content favorably, a stronger positive signal.
14. ⬜ **Watch impressions and indexed count over subsequent crawls** —
    re-run this checklist's monitoring steps after each new Search
    Console export; obtain the actual "crawled — not indexed" export
    as soon as possible (§7) to unblock per-URL remediation.

---

# 4. MANUAL INDEXING PRIORITY LIST — TIER 1 (20 URLs, request first after deploy)

Selected by commercial importance and site architecture. For each: primary
intent, why it deserves manual priority, and its actual contextual
(body-content) internal-link sources in the current build (raw
nav/footer-inflated counts are not shown here — see
`docs/seo/full-site-seo-audit.md` for why those are not meaningful on
this site).

| # | URL | Primary intent | Why Tier 1 | Key internal-link source(s) |
|---|---|---|---|---|
| 1 | `/` | AI consulting company / broad brand intent | Homepage — highest commercial value by definition; entry point for every funnel | Linked from every page (nav+footer); 63 contextual body-content links from resources/industries alone |
| 2 | `/ai-consulting/` | AI consulting services | Core service page owning the site's primary commercial keyword | 33 contextual links incl. homepage `BusinessSection`, `/ai-recruiting-automation/`, multiple industry pages |
| 3 | `/ai-implementation/` | AI implementation services | Second core service page; highest contextual-link count of any service page (65) | `/ai-agent-development/`, `/ai-consulting/`, `/ai-crm-integration/`, `/ai-growth-systems/`, plus many industry "Strategy, Implementation, and Ongoing Support" cross-links |
| 4 | `/ai-agent-development/` | AI agent development services | High-commercial-value, differentiated offer | `/ai-crm-integration/`, `/ai-implementation/` — **weakest contextual linking of the core service pages (2)**; a real candidate for a future additional contextual link, not fabricated here |
| 5 | `/managed-ai-department/` | Managed AI / outsourced AI department | Recurring-revenue flagship offer | Homepage `ManagedSection`, `/ai-agent-development/`, `/ai-consulting/`, `/ai-recruiting-automation/`, 51 contextual links total |
| 6 | `/ai-growth-systems/` | AI marketing automation / growth systems | Core revenue-generation offer | `/crm-setup-automation/`, multiple industry cross-link blocks, 43 contextual links total |
| 7 | `/enterprise/` | Enterprise AI transformation | Distinct high-value audience/offer | Multiple enterprise-adjacent industry pages (automotive-dealers, defense-aerospace, energy, fiber-broadband), 20 contextual links |
| 8 | `/crm-setup-automation/` | CRM setup and automation | Distinct commercial intent from `/ai-crm-integration/` (no cannibalization) | `/ai-agent-development/`, `/ai-crm-integration/`, `/ai-implementation/`, `/conversion-tracking-analytics/` |
| 9 | `/conversion-tracking-analytics/` | Conversion tracking and revenue attribution | Differentiated, honest-positioning offer ("no fabricated ROI claims") | `/ai-crm-integration/`, `/ai-implementation/`, `/crm-setup-automation/`, `/google-ads/` |
| 10 | `/google-ads/` | Google Ads management | Channel-specific growth offer | `/conversion-tracking-analytics/`, multiple industry pages, 28 contextual links |
| 11 | `/seo/` | SEO services | Channel-specific growth offer | Industry pages (ecommerce, home-services, real-estate), 1 resource cross-link |
| 12 | `/free-ai-assessment/` | Free AI assessment (primary lead magnet) | Site-wide primary CTA target — highest contextual-link count in Tier 1 (113) | Every page's primary CTA button, homepage FinalCTA, industries/resources CTABand |
| 13 | `/comprehensive-ai-business-audit/` | Paid $495 AI business audit | Direct-revenue paid offer, Cal.com-integrated | `/`, `/ai-assessment/`, `/ai-department-audit/` (redirect stub) |
| 14 | `/industries/law-firms/` | AI consulting for law firms | Strong, well-differentiated industry copy (stakes-first hook) | `/`, `/industries/` hub |
| 15 | `/industries/roofing/` | AI for roofing companies | Strong storm-season/lead-speed differentiation | `/`, `/industries/`, `/industries/home-services/` |
| 16 | `/industries/hvac/` | AI for HVAC companies | Strong speed-driven-business differentiation | `/`, `/industries/`, `/industries/home-services/` |
| 17 | `/industries/plumbing/` | AI for plumbing companies | Strongest resource-cluster support of the four trade pages (3 dedicated articles + reciprocal links) | `/industries/`, `/industries/home-services/`, 2 dedicated resource articles |
| 18 | `/ai-department-method/` | AI strategy/implementation framework | Differentiated methodology page, now contextually linked from homepage | `/`, `/ai-training/`, `/ai-workshops/`, `/enterprise/` |
| 19 | `/contact/` | Contact / talk to the team | Core conversion utility page | Top-level `PRIMARY_NAV` item (0 in-body contextual links is expected — one click from every page via nav) |
| 20 | `/industries/` | Industries hub | Discovery hub for 28 industry pages | `/` (homepage `IndustriesSection`) |

Expand to Tier 2/3 (remaining commercial + industry pages) only after
these show movement toward Indexed, per the monitoring steps in §3.

---

# 5. METADATA EDITORIAL STATUS (no changes this pass — spot-check only)

Full record: `docs/seo/metadata-before-after.md`. This pass spot-checked
the 17 highest-value pages named in the deployment brief (homepage +
16 commercial/industry pages) against the standard (natural sentences,
service+problem+value framing, no comma-chain robotic copy, no keyword
stuffing, sells the click). **All 17 passed with no remaining quality
issue** — zero further rewrites made this pass. Cumulative across all
three passes: 32 descriptions changed, 6 titles changed.

---

# 6. INTERNAL LINK STATUS (no changes this pass)

Full record: `docs/seo/full-site-seo-audit.md` "Internal crawl-priority
analysis." All fixes from the prior pass remain in place and were
re-verified this pass with fresh contextual-inbound-link data (§4
table above uses that fresh data). No new internal-link gaps were
introduced or found requiring a fix this pass.

---

# 7. PAGES NEEDING THE EXACT SEARCH CONSOLE EXPORT BEFORE FURTHER DIAGNOSIS

- The 16 "Crawled — currently not indexed" URLs (§2) — cannot be
  individually analyzed without the export. **Re-confirmed this pass:
  still not present anywhere in this repository.**
- The 2 "Alternate page with proper canonical" URLs — plausibly the
  retired redirect stub and/or a pre-fix www URL (§2), not confirmed
  without the export, and may have already changed status given the
  www fix.
- The 10-page gap between Search Console's 127 "known" and this repo's
  117 indexable pages — plausibly explained by pre-fix www-duplicate
  discovery, not confirmed without the export.

**No Search Console data has been invented, guessed, or simulated
anywhere in this repository's documentation.** Drop the export into
`docs/seo/input/` (filename convention in that folder's README) to
unblock all three items above.