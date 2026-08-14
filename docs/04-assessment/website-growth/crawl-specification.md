# Website & Growth Assessment — Crawl Specification (V1)

Status: Architecture Draft — Pending Owner Approval
Extends `scanner-security-architecture.md` §"Fetch Controls." Security validation itself is defined in `security-threat-model.md`; this document defines *scope and behavior* assuming a request has already passed security validation.

## 1. Objective

Define an intentionally small, deterministic crawl so that two independent implementations following this spec would analyze effectively the same set of pages for the same input URL. This is explicitly **not** a general-purpose crawler.

## 2. Submitted URL Normalization

1. Trim whitespace.
2. If no scheme is present, prepend `https://`.
3. Reject (do not normalize away) any scheme other than `http`/`https` — handled as a validation failure per `security-threat-model.md`.
4. Lowercase the scheme and host. Do not lowercase the path, query, or fragment.
5. Strip a URL fragment (`#...`) before use — fragments are never meaningful for server-side analysis.
6. Do not strip query strings from the submitted URL itself (the user may have pasted a specific landing page intentionally) — but see §9 for query-string handling during discovery.
7. Do not perform www/non-www normalization on the *submitted* URL. Whatever the user submitted is fetched as-is (after scheme defaulting). If it redirects to the other form, §7 (Redirects) governs.

## 3. Homepage Determination

- The "homepage" for analysis purposes is the final resolved URL after following redirects (§7) from the normalized submitted URL, **not** necessarily the root path `/`.
- Rationale: users may submit `example.com/home` or a URL that redirects to a different canonical homepage; the assessment should analyze what the business actually lands on.
- Exception: if the submitted URL's path is deep (more than 1 path segment) and does not redirect, also separately fetch the site root (`https://{host}/`) as a secondary reference point for site-wide checks (sitemap, robots.txt) — but the *primary* homepage-scoped rules (SV-02, SV-03, SV-05, CV-01, CV-05, etc.) always evaluate the resolved submitted URL, not the root.

## 4. Same-Origin Rules

- "Same origin" for discovery purposes (§10–§12) means same registrable domain (eTLD+1), not same subdomain and not same full origin.
- Example: if the submitted site resolves to `www.example.com`, pages on `shop.example.com` are considered same-origin for discovery; pages on `example-shop.com` or `example.net` are not.
- Rationale: many SMB sites split marketing and booking/shop subdomains; treating them as unrelated would understate legitimate site structure.

## 5. WWW / Non-WWW Normalization

- Not performed proactively. The crawler follows whatever the server actually does (§7 Redirects). If `example.com` redirects to `www.example.com`, that redirect is followed and validated like any other; the final form is simply "the homepage" per §3.
- If a page is discovered via internal links in both `www` and non-`www` form, they are treated as the same page for deduplication purposes (§13) after confirming same-origin per §4.

## 6. Subdomain Treatment

- Subdomains are in-scope for *discovery* (a link to `shop.example.com` may be counted toward CV-06 offering-clarity), but are **not** separately crawled/fetched in V1 unless the subdomain link was reached via on-page navigation from the primary domain and the total page budget (§8) has not been exhausted.
- V1 does not proactively enumerate subdomains via DNS or certificate transparency. This is discovery-by-link only.

## 7. Redirect Handling

- Maximum 5 redirects per fetch (matches `scanner-security-architecture.md` §"Redirect Controls").
- Every redirect target must independently pass URL and destination-IP validation (see `security-threat-model.md` §"Redirect-Chain Revalidation") before being followed.
- Exceeding the redirect limit is a fetch failure for that URL, not a security violation — recorded as Unknown/unreachable for any rule depending on that page.
- Redirect loops (a URL redirecting back to a previously-seen URL in the same chain) are detected and treated as a fetch failure immediately, without waiting to hit the numeric limit.

## 8. Maximum Page Count

**V1 maximum: 8 HTML pages per assessment**, selected by the prioritization order in §11.

Justification:
- Covers the realistic "does this business explain itself and let you contact it" question set (homepage, 2–3 service/offering pages, contact page, plus 2–3 additional navigation-discovered pages) without approaching general-purpose crawling.
- Keeps total analysis time and resource fetch volume small enough to bound cost and abuse surface even under concurrent public submissions.
- Matches the bounded page set already anticipated in `scanner-security-architecture.md` §"Fetch Controls" ("homepage, primary service pages... contact page... selected high-value internal pages").
- 8 is large enough that SV-04 (title-tag uniqueness) is meaningful across a genuine sample, but small enough to keep the crawl fast and deterministic.

## 9. Crawl Depth

- Maximum depth: 2 (homepage = depth 0; pages linked from homepage = depth 1; pages linked from depth-1 pages = depth 2).
- Depth-2 discovery is used only to fill remaining page-count budget after depth-0 and depth-1 pages are exhausted, and only for links matching the prioritization patterns in §11 (not arbitrary depth-2 links).

## 10. Non-HTML Handling

- Response `Content-Type` must start with `text/html` (or `application/xhtml+xml`) to be parsed as a page. Anything else is recorded as "non-HTML, not analyzed" and does not consume a page-count slot.
- File-extension exclusions applied *before* fetching (skip without a network request): `.pdf .doc .docx .xls .xlsx .ppt .pptx .zip .rar .7z .exe .dmg .mp4 .mov .avi .mp3 .wav .jpg .jpeg .png .gif .svg .webp .ico .css .js .woff .woff2 .ttf .eot .json .xml` (except the specific `robots.txt` and `sitemap.xml` fetches, which are handled by dedicated logic, not generic page discovery).

## 11. Page Prioritization Order

Discovered candidate URLs are ranked and fetched in this order until the 8-page budget (§8) is exhausted:

1. Homepage (always page 1, per §3).
2. `robots.txt` and `sitemap.xml` (fetched via dedicated logic, not counted against the 8-page HTML budget — see §12).
3. Contact-page candidates: links whose anchor text or path matches `contact`, `contact-us`, `get-in-touch`, `reach-us` (case-insensitive).
4. Service/offering-page candidates: links whose anchor text or path matches `services`, `solutions`, `products`, `pricing`, or repeated link patterns suggesting a services index.
5. Remaining primary navigation links (links present in the homepage's `<nav>` or header-region markup, in document order), up to the remaining budget.
6. If budget remains after 3–5, depth-2 links discovered from pages already fetched, prioritized by the same contact/service pattern matching.

## 12. Sitemap and Robots Handling

- `robots.txt` fetched at `https://{host}/robots.txt` (using the resolved homepage's host). Parsed for: blanket disallow (SV-07), and any `Sitemap:` directive (feeds into sitemap discovery).
- If no `Sitemap:` directive found, fall back to checking `https://{host}/sitemap.xml` directly.
- Sitemap fetch is used only for SV-06 (existence check) and to supplement page discovery (§11 step 6 candidate pool) — V1 does not parse a sitemap index recursively beyond one level (a sitemap index pointing to child sitemaps: fetch and check the first child sitemap only, do not recurse further).
- **Robots.txt crawl-directive compliance decision (required by `scanner-security-architecture.md` §"Robots"):** V1 respects `Disallow` directives for the specific pages the crawler would otherwise fetch. If a candidate page is disallowed for `User-agent: *`, it is skipped and not fetched, and does not count toward the page budget. This is a deliberate, consistent policy choice — the assessment tool identifies itself via a distinct user-agent string (§17) and behaves as a well-behaved crawler would.

## 13. Canonical Handling

- Canonical tags are recorded as Observed evidence (SV-08) but do **not** cause the crawler to substitute the canonical URL for the fetched URL, and do not affect deduplication. V1 treats canonicalization as a signal to evaluate, not as a redirect to follow.

## 14. Duplicate URL Handling

- A URL (after normalization: strip fragment, strip trailing slash equivalence — `/about` and `/about/` are treated as the same page) is fetched at most once per assessment.
- If the same normalized URL is discovered via multiple links, it is queued once.

## 15. Query-String Handling

- URLs discovered with query strings are normalized by **stripping the query string** for deduplication and page-count purposes, unless the query string is the *only* differentiator from an otherwise-identical path and appears to represent a distinct content view (V1 does not attempt this distinction — always strip). Rationale: prevents tracking-parameter variations (`?utm_source=...`) or session parameters from being treated as distinct pages and consuming budget.
- Exception: the originally *submitted* URL's query string is preserved for the initial fetch only (§2), since the user may have intentionally submitted a specific parameterized page.

## 16. Trailing Slash Handling

- `/path` and `/path/` are treated as equivalent for deduplication (§14). The first-fetched form is what gets recorded; no preference is enforced.

## 17. Response Content-Type Validation, Size, Timeouts, Concurrency

| Control | V1 Value |
|---|---|
| Maximum response body size | 5 MB per page (stream-checked; abort fetch if exceeded before completing download) |
| Connection timeout | 5 seconds |
| Read timeout (per page) | 10 seconds |
| Total analysis timeout (whole assessment) | 60 seconds |
| Concurrency | Maximum 2 concurrent page fetches per assessment |
| User-Agent | `YourAIDepartment-WebsiteAssessment/1.0 (+https://youraidepartment.ai/website-assessment-bot)` — distinct, identifiable, links to an explanation page |
| Retry policy | 1 retry maximum per page, only on connection-level failure (not on HTTP 4xx/5xx), with a 1-second backoff |
| Caching | Assessment results for the same normalized homepage URL may be served from cache for up to 24 hours to reduce abuse surface and load (see `security-threat-model.md` §"Repeated Submissions") — exact cache-key and invalidation policy is a backend implementation decision, not a crawl-behavior decision |

If the total analysis timeout (60s) is reached before all budgeted pages are fetched, the crawl stops immediately and proceeds to scoring with whatever pages were successfully analyzed (§18 Partial-Results Behavior).

## 18. Failure Behavior and Partial-Results Behavior

- **Homepage fetch fails entirely** (after retry): the assessment cannot proceed. Return a distinct "could not analyze this website" result state (see `results-contract.md` §"Partial Failure Information") rather than a scored result. This is the only failure mode that blocks scoring entirely.
- **Homepage succeeds, some subsequent pages fail:** proceed with scoring using only the successfully analyzed pages. `analysisCoverage` (see `results-contract.md`) must report the actual number of pages analyzed vs. the 8-page target, so the result page can disclose this transparently.
- A failed page fetch is recorded as Unknown for any rule that would have depended on that specific page, never as a Fail for that rule.

## 19. Summary Table

| Parameter | V1 Value |
|---|---|
| Max HTML pages | 8 |
| Max crawl depth | 2 |
| Max redirects per fetch | 5 |
| Max response size | 5 MB |
| Connect timeout | 5s |
| Read timeout | 10s |
| Total timeout | 60s |
| Concurrency | 2 |
| Retries | 1 |
| Robots.txt | Respected for crawl-directive compliance |
| Same-origin scope | eTLD+1 (subdomains included for discovery, not proactively enumerated) |
