# Sales Brain — official public source governance

The machine-readable record is `services/sales-brain/src/sources/governance.ts`, which
the research worker consults at runtime. This document is the human summary and the
record of how each verdict was reached.

Reconnaissance was done on 2026-09-15 with a handful of read-only requests from an
identified research user-agent. No source was bulk-downloaded, no access control was
worked around, and no paid source was contacted.

## Live validation, 2026-09-15 (second pass)

The first pass established reachability. The second pass drove the actual request each
adapter would make, and corrected three of them. Two findings were design errors rather
than bugs.

### Texas Comptroller — the scraping path is the one robots forbids

The account-status search at `comptroller.texas.gov/taxes/franchise/account-status/search`
is a JavaScript form posting to `comptroller.texas.gov/data-search/franchise-tax`. That
host's robots.txt is `Disallow: /*/` with an explicit allow-list which does **not**
include `/data-search/`.

The Comptroller publishes a documented public API instead:
`api.comptroller.texas.gov/public-data/v1/public/` — `franchise-tax-list` for search,
`franchise-tax/{id}` for account and officer detail, schema `FranchiseAccountWithOfficers`
(`AGNT_NM`, `AGNT_TITL_TX`, `TAXPAYER_ID`, `RIGHT_TO_TRANSACT`, …). It answers **403
without an `api-key` header**.

The adapter now targets the API and makes **no request at all** until
`TX_COMPTROLLER_API_KEY` is set. Obtaining a key is a registration step for a human.

### Florida DBPR — a session-bearing POST, not a GET

`wl11.asp` is a legacy ASP application. The licensee search is a **POST** to
`wl11.asp?mode=1&SID=&brd=&typ=` with a `SearchType` radio (Name | LicNbr | City |
LicTyp) and ~30 hidden fields (`hOrgName`, `hLastName`, `hSearchType`, `hLicNbr`,
`hCity`, `hDivision`, `hBoard`, `hSearchOpt`, `hRecsPerPage`), threading a session id
through `SID`.

The adapter had been building a GET with invented query parameters — it could never have
returned a record. DBPR is now snapshot-backed, like TSBPE.

### Texas TDLR — the parser returned nothing against every real page

One query to `SearchResultsListBrowse.asp` found three mismatches:

- the licence column is headed **`License Data Search Result`**, not "License #"
- licence numbers print **spaced**: `ACR - 4471`
- the browse view has **no status column at all**, and the parser required one

Any one of them returned zero licences. Rebuilt from the captured shape; an unread
status is `UNKNOWN`, never assumed active. robots still disallows `/*.csv`, so the
published CSVs remain undownloaded.

## Status at a glance

| Source | Status | Live calls | Why |
|---|---|---|---|
| Florida Sunbiz | `BLOCKED` | never | Returned **HTTP 403** to an identified research agent |
| Florida DBPR | `FEATURE_FLAGGED` | `SOURCE_FL_DBPR_ENABLED` | Reachable, no robots restriction; awaiting sign-off |
| Texas Comptroller | `FEATURE_FLAGGED` | `SOURCE_TX_COMPTROLLER_ENABLED` | Reachable, no robots.txt; free alternative to SOSDirect |
| Texas TDLR | `FEATURE_FLAGGED` | `SOURCE_TX_TDLR_ENABLED` | Reachable; robots **disallows `/*.csv`**, respected |
| Texas TSBPE | `FEATURE_FLAGGED` | `SOURCE_TX_TSBPE_ENABLED` | Snapshot-only; no free bulk dataset located |
| State Bar of Texas | `BLOCKED` | never | Firm↔attorney identity cannot be established conservatively |
| Texas SOSDirect | `DISABLED_PAID_SOURCE` | **never** | ~$1 per search; no spending authorised |

Nothing is enabled by default. A `BLOCKED` or `DISABLED_PAID_SOURCE` entry cannot be
switched on by any environment flag — `liveCallsPermitted()` refuses before it looks at
one, and there is a test that asserts it.

## The two refusals worth reading

**Sunbiz answered 403.** That is an access control. The parser, the identity rules,
the persistence and the tests are complete and run against sanitized fixtures, so if
access is arranged with the Department of State — or a published bulk download is used
— the only thing that changes is where the HTML comes from. It was not retried with a
browser user-agent, because that is the thing we do not do.

**TDLR's robots.txt disallows `/*.csv`.** TDLR publishes licence data as CSV and it
would be the efficient way to do this. We use the search pages instead. The disallow is
recorded in the governance entry so a future change cannot quietly ignore it.

## Why TSBPE is snapshot-shaped

Texas plumbing licence verification lives in a session-based JSP application at
`vo.licensing.hpc.texas.gov/datamart`. Querying it once per account would be fragile,
slow and rude to a state system, and it would make every account's licence freshness
depend on when that account happened to be researched.

So the adapter reads a locally indexed snapshot (`source_snapshots`, migration 053) and
one dataset serves every account. This is also the only way the freshness can be stated
honestly: `capturedAt` is the snapshot's download time, never now.

**Before live use, the dataset must be obtained through an official TSBPE data
request.** The loader, parser, index, matcher and tests are ready for it.

## What every source guarantees

- One lookup per account, at the shared polite fetcher's rate, honouring robots.
- A failure is `SOURCE_UNAVAILABLE`, never "unlicensed" and never "not a real company".
- An ambiguous match writes **nothing** — not facts, not people.
- Every fact stores its source reference, capture time and expiry.
- Status and licence facts expire in 30–90 days, because they change silently.
- Identifiers with no sales use are parsed past rather than stored: the Florida
  FEI/EIN and the Texas taxpayer number are both public and both omitted, because
  "public" is not the same test as "necessary".

## Roles are never promoted

A registered agent, a qualifying agent, a licence holder and a Responsible Master
Plumber are each recorded at the role the record gives them. The resolver's
`EVIDENCE_ONLY_RELATIONSHIPS` keeps all of them from standing in for an owner. They are
usually a principal; "usually" is a sales heuristic, not a fact.
