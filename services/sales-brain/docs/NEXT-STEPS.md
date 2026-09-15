# Sales Brain enrichment — next steps

Ranked by value to a sales rep on a call, which is not the same as engineering
interest.

## Closed in the second sprint (2026-09-15)

Live validation against the real sites changed three adapters, and in two cases the
finding was that the design was wrong rather than the code:

- **Texas Comptroller** — the account-status page posts to `/data-search/`, which
  `comptroller.texas.gov/robots.txt` disallows. The Comptroller publishes a documented
  public API instead (`api.comptroller.texas.gov/public-data/v1/public/`), which
  answers 403 without a registered `api-key`. Adapter rebuilt against the published
  schema; makes no request until `TX_COMPTROLLER_API_KEY` is set.
- **Florida DBPR** — the licensee search is a POST to a legacy ASP app with a session
  id and ~30 hidden fields. The adapter had been building a GET with invented
  parameters and would never have returned a record. Now snapshot-backed.
- **Texas TDLR** — the live result table broke the parser three ways (column headed
  "License Data Search Result", spaced licence numbers like `ACR - 4471`, and no status
  column at all). It returned zero licences against every real page. Rebuilt; an
  unread status is `UNKNOWN`, never assumed active.
- **Snapshot lifecycle** — CURRENT/DUE_REFRESH/STALE/MISSING, data date kept apart
  from download date, unmatchable rows rejected with counts, advisory lock so
  concurrent loads cannot leave a dataset with no current file.
- **Source health** — an operations view of every source in one query.
- **Structured service area** — ZIPs, cities, counties, regions, parsed only from
  explicit coverage statements and never from an address.
- **Best contact** — verified role and likely-best-contact as separate fields.

## Still open, most valuable first

## 1. Obtain the two datasets and the one API key
Three finished adapters are blocked on paperwork, not code: a TSBPE licensee extract, a
DBPR licensee file, and a Texas Comptroller `api-key`. `SNAPSHOT_POLICIES` in
`src/sources/snapshotPolicy.ts` carries the exact wording to send each agency.

## 2. Sunbiz access, or the published bulk download
Still HTTP 403 to an identified agent. Parser, identity rules and tests are complete and
fixture-tested. Florida is half our P0 market and this is its entity-verification
answer.

## 3. Vertical profile trigger signals for the new claim keys
The profiles drive hypotheses from `trigger_signals`. The new evidence keys (`tech_*`,
`route_*`, `site_*`, company-profile claims) are not referenced by any profile, so only
the hard-coded gap rules use them. Wiring them into profile YAML would let each vertical
express its own openings without code changes.

## 4. ZIP-to-place data for service-area filtering
`serviceAreaCoversZip` only matches an explicit ZIP, because expanding "Travis County"
into ZIPs would manufacture coverage the company never claimed. A real ZIP/city/county
table would make "serves 32095 but headquartered elsewhere" work for the majority of
sites, which state cities rather than ZIPs.

## 5. Size-aware decision-maker ranking
The ranking is deliberately conservative: evidence-only roles never outrank operational
ones. On a three-person LLC the officer on the filing usually *is* the decision maker.
A rule aware of company size, vertical, and whether the site names anyone would beat one
constant — worth doing with real data rather than by guessing.

## 6. Feed official verification into scoring
Completeness gained `official_entity` and `license_verified`; tier scoring is untouched,
so no account moves tier because of this branch. Whether an entity is verified and
licensed is plainly relevant to how good a prospect is.

## 7. Surface service area and best contact in Find Prospects
Both are on the Account page only. A rep triaging a list would benefit from "serves this
ZIP" and "named contact" as row-level chips — needs care to avoid an N+1 on the list
query.

## 8. Snapshot refresh automation
The lifecycle exists (cadence, staleness, dedupe, locking, history) but nothing schedules
a download. Deliberately not enabled: autonomous fetching of official datasets needs its
own governance decision.

## 9. Ad-evidence recency on the list view
Google Ads observations are dated and shown on the Account page. Find Prospects still
sorts on a boolean-ish advertiser state; "observed advertising in the last 14 days" is a
much better prospecting filter.

## 10. Live-fire validation of the remaining fixture-only parsers
Sunbiz and the State Bar parsers have never met a live page. The Comptroller parser is
built to a published schema but has never seen a real response, because the API refuses
without a key. Budget an hour per source on first contact and update the fixtures from
whatever real payloads are captured.

## Known limitations

- **Sunbiz and State Bar are fixture-tested only.** Their parsers have never seen a
  live page. Structure was inferred from public knowledge of the record layout, so
  expect to adjust selectors on first live contact.
- **TDLR parsing is table-shape dependent.** Two programmes present slightly different
  columns; columns are matched by meaning, but a layout change will need a fixture.
- **`officialPersonHighlight` prefers RMP then qualifying agent**, and deliberately
  never a registered agent. It does not consider officers, because officer seniority is
  not comparable across states — see 7.
- **Scoring was not changed.** Completeness gained two dimensions (`official_entity`,
  and `license_verified` where a state licenses the trade), but tier scoring is
  untouched, so no account's tier moves because of this branch. Feeding official
  verification into scoring is a deliberate follow-up, not an oversight.
- **Nothing is enabled.** Every live source sits behind a flag or a refusal, so on
  deployment this branch changes what the Account page *can* show, not what it does
  show, until a source is switched on.
