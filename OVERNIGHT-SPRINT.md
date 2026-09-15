# Overnight enrichment sprint — working notes

Base SHA: ef4d3431b0083913efe5ed5811ffe49bef81a6a0
Branch: feature/sales-brain-rep-enrichment

## Source reconnaissance (read-only, a handful of requests, 2026-09-15)

| Source | Probe | Verdict |
|---|---|---|
| FL Sunbiz `search.sunbiz.org` | **403** to an identified research UA | BLOCKED — access control, not bypassed. Fixture-only. |
| FL DBPR `myfloridalicense.com` | 200, no robots.txt | Live-capable, feature-flagged |
| TX Comptroller `mycpa.cpa.state.tx.us/coa/` | 200, no robots.txt; form takes `name`/`fileNumber`/`taxpayerId` | Live-capable, feature-flagged |
| TX TDLR `tdlr.texas.gov/LicenseSearch/` | 200; robots **disallows `/*.csv`** and `/ithelp/` | Live-capable (search pages only, no CSV), feature-flagged |
| TX TSBPE | verification lives at `vo.licensing.hpc.texas.gov/datamart` — session/JSP form app; no public bulk dataset found | Fixture-only, feature-flagged |
| TX State Bar | 200 | Fixture-first, feature-flagged |
| TX SOSDirect | ~$1/search | DISABLED_PAID_SOURCE — never called |

TDLR's robots disallowing `/*.csv` is respected: no CSV dataset downloads from TDLR.

## Architecture found (extend, do not replace)

- `resolver/fetcher.ts` — robots-aware, per-host rate-limited, wall-detecting, size-capped.
  **Gap found: no SSRF guard.** Fixing.
- `resolver/adapters/firstParty.ts` — Stage A; returns PersonObservation/EndpointObservation + pageText
- `resolver/types.ts` — SourceClass already has PUBLIC_COMPANY_REGISTRY(20)/PUBLIC_LICENSE_REGISTRY(30);
  EVIDENCE_ONLY_RELATIONSHIPS already encodes registered-agent/licence-holder != owner
- `resolver/reconcile.ts` + `persist.ts` — merge + persist
- `evidence_records` — generic, append-only, has source/confidence/expiry/precedence. Registry facts fit here.
- `research_runs.adapter_results` — per-stage record
- `dnc_snapshots` — proven precedent for download-once/index-locally bulk datasets
- `contactResearch.ts` — stages A, B(skipped), C(skipped), D(skipped), G, H

## Order of work
1. source framework: types, governance, licensing-requirement map, conservative matcher
2. SSRF guard (security)
3. adapters FL/TX with fixtures
4. snapshot infra + migration 053
5. wire stages B/C
6. first-party depth: company profile, services, tech, marketing, socials
7. Google Ads evidence audit
8. completeness / hypotheses / UI
