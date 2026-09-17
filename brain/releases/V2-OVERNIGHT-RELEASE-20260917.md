# V2 overnight release and historical inventory rebuild — 2026-09-17

**Status:** IN PROGRESS. This document is written before the work, updated during it, and
finished at the end. If the agent session is lost, this file and the git log are the
project memory; nothing important lives only in a terminal.

**Why this file is in `brain/releases/` and not under `services/sales-brain/docs/`:** a
full qualification run was already in flight against the exact `services/` subtree
`154b047e` when this document was written. Adding a file under `services/` changes that
subtree and destroys the provenance of the run. Operational release records belong in
`brain/` anyway, which is the versioned operating context.

---

## 1. Authorization of record

Given by Michael on 2026-09-17 before going offline for 4–6 hours. This section is the
durable copy; the agent's context is not.

### Authorized tonight

- Deploy V2 code to production **after its qualification gates pass**.
- Apply the V2 database migrations to production after qualification.
- First-party website re-research of **all** historical Accounts.
- Any research path already implemented that incurs **no new paid spend**.
- Recomputation of historical classifications under V2 rules.
- **High-confidence** historical remediation: suppression/reclassification of bad
  inventory, canonical-name correction, endpoint reclassification, research-state
  correction, wrong-vertical removal or suppression.
- Re-evaluation of all 66 legacy Roofing Accounts.
- Creation of evidence, provenance and relationship records under V2 rules.
- Ordinary git commits and pushes; production database backups; worker/API restarts
  required for the release; automatic rollback if release health fails.

### Not authorized tonight

- Paid Stage-D DataForSEO contact searches, including the 100-Account experiment.
- Any new paid contact provider: Apollo, Hunter, ZoomInfo or similar.
- Outbound anything: phone calls, SMS, email sends, Smartlead, Twilio.
- Saved-market activation.
- Force pushes.
- Destructive deletion of evidence.
- CAPTCHA bypass, robots bypass, paid SOSDirect automation.

**Stage D stays DISABLED. Stage-D `task_post` caused tonight must remain 0 and Stage-D
spend $0.00.**

### A correction to the durable record

Agent-generated documentation cannot authorize provider spend. Nothing written by an
agent in `brain/` — including a line recommending a measured Stage-D batch — is
authorization for it. `brain/TODO.md` has been reworded so that the Stage-D item reads as
a proposal awaiting Michael, and so that tonight's actual grant (historical remediation)
is distinguishable from it.

### The ten points Michael asked to see written down

1. V2 is authorized for deployment **after** its qualification gates pass.
2. All historical Accounts are authorized for re-research once V2 is live.
3. High-confidence historical remediation is authorized where **all** of: no human sales
   activity on the Account; the evidence is decisive; provenance is retained; the action
   is auditable; and the action is reversible or non-destructive where possible.
4. Ambiguous records go to review rather than being forced into a clean answer.
5. Paid Stage-D searches are **not** authorized tonight.
6. No outbound activation is authorized.
7. Raw provider, search and research evidence must survive remediation.
8. U-Haul-style wrong-vertical records must not remain workable in the wrong vertical.
9. Non-company pages must not remain rep-visible companies.
10. GitHub is the durable handoff. Claude's context is not.

---

## 2. Release candidate

| | |
|---|---|
| V2 branch | `feature/sales-brain-v2` |
| **FINAL RC commit** | `b34a07968ec158f0cd8a73b754f5a5f6a1b51cc9` |
| **FINAL RC tree** | `3c48239282ad48d467bdb266ff4ab25d82022919` |
| **FINAL `services/` subtree** | `74d7690adae3b14da1b4fee6c5c366fc39a5b111` |
| superseded RC 2 | `f28971c` / tree `fba0d05` / services `bdeef04` — the broken-website fix, before the hard guard |
| superseded RC 1 | `6261a71` / tree `887c5b0` / services `154b047e` — qualified 2250/2254, four failures classified, none a product defect |

Each RC was superseded for a stated reason, and the qualification evidence for each is
kept rather than discarded: RC1's forward run is what identified the four failures, and
RC2 was never deployed because the hard guard changed remediation code before it could be.
| Previous production SHA | `3e4a2820afdaf2ef3b1490bad99e849bb08372ef` |
| Production branch | `feature/outbound-sales-brain` |

## 3. Migration hygiene

Production runs schema **52**. V2 adds:

- `053_location_provenance.sql` — `basis`, `source_reference`, `first_observed_at`,
  `last_verified_at` on `locations`, plus a `not valid` check that a `physical` row has a
  street.
- `054_account_relationships.sql` — the relationship table with its two-signal check, and
  the extended `contacts.company_relationship` vocabulary.

**V2 legitimately owns production migration 053**, because it is the next migration after
the 52 that production is running and V2 is the branch being deployed.

The branch `feature/sales-brain-rep-enrichment` also has a file numbered 053
(`053_official_source_snapshots.sql`). That branch is **not production** and has never
been deployed. **Any future port of that work must renumber it**; it must not be assumed
to own 053. This is recorded here and in `brain/DECISIONS.md` so the collision is caught
before it reaches a database rather than after.

## 4. Pre-deploy production capture (2026-09-17 08:15 UTC)

Verified before anything was touched, not assumed from the brief.

| | |
|---|---|
| production SHA (worker heartbeat) | `3e4a282`, migrations_expected 52, heartbeat 8s old |
| `/healthz` | 200, `database: ok`, `outboundDialEnabled: false` |
| services | `yad-sales-api` active, `yad-sales-worker` active |
| schema | 52 applied, latest `052_search_plan_preview.sql` |
| tables | 77 |
| Accounts | 320 total, 320 not suppressed, 0 merged |
| `provider_tasks` | 44 COLLECTED, 5 ABANDONED, **0 PENDING** |
| jobs | 412 SUCCEEDED, 0 queued, 0 running |
| saved markets | 0 total, 0 enabled |
| `provider_usage` | 97 calls, $0.2580 lifetime spend |
| human sales activity | **0** (activities with an actor: 0; 320 DISCOVERED + 320 CONTACT_ENRICHED, all system) |

**Pre-deploy backup:** `/home/roothecks/yad-sales-backups/yad_sales_20260917T081538Z.sql.gz`,
985,350 bytes, taken with the project's own `deploy/backup.sh` and verified by
`deploy/verify-backup.sh`: *77 tables declared, all 6 required present*.

## 5. Migration rehearsal against production-shaped data

The backup was restored into a throwaway database (`yad_sales_rehearsal`) and the V2
migrations run against it. This is the check that matters more than a fresh-install test:
it is production's own rows, at schema 52, meeting the new constraints.

| check | result |
|---|---|
| applies from schema 52 | ✅ `053` and `054` applied, 52 → 54 |
| idempotent per the runner | ✅ second run: *0 applied, 54 already present* |
| enrichment-only tables needed | ✅ none |
| tables | 77 → 78 (`account_relationships`) |
| data preserved | ✅ 320 Accounts, 66 locations |
| `locations_physical_needs_street` | present, **NOT VALID as designed** — the 66 legacy rows are governed going forward, not rejected retroactively |
| constraint bites | ✅ physical-with-no-street refused, one-signal relationship refused, self-relationship refused |
| `evidence_records.location_id` | present |
| V2 tooling at schema 54 | ✅ `remediation:preview` produces identical counts on production data |

## 6. What the preview says tonight, and why re-research comes before remediation

Read against production before any change, to see what the authorization would actually
act on. It found the reason the order in Michael's instructions is the right one.

The junk class is mostly **LOW confidence and marked for review**, not because the records
are defensible but because the classifier requires two independent signals and a listicle
*with* a domain currently produces one:

| record | domain | confidence |
|---|---|---|
| `An 82-year-old Vietnam veteran in St. Augustine says he's ...` | — | HIGH |
| `10 Best Roofers in St. Augustine, FL` | todayshomeowner.com | LOW, review |
| `Best roofers in St. Augustine, Fla.` | local.yahoo.com | LOW, review |
| `Apartments for Rent in 33133 - Miami, FL` | apartments.com | LOW, review |
| `Construction & Skilled Trades Jobs in Ybor City, FL 33605, USA` | miamijobs.com | LOW, review |

Two candidate "second signals" were measured against production rather than assumed, and
one of them failed:

- **distinct business names seen on the same domain** — local.yahoo.com carries 17 and
  buildzoom.com 9, but `mechanicalone.com` carries 7 and is a real HVAC company whose
  pages simply ranked under different titles. At any threshold low enough to catch the
  aggregators it catches real companies, so it is not used as a gate.
- **absence of any business-listing evidence** — true of the junk and equally true of real
  companies like `energyair.com` and `alvarezplumbing.com`. Not discriminating.

The signal that does separate them is one this estate does not have yet: **what the site
says it is**. A page titled "10 Best Roofers in St. Augustine, FL" sits on a site whose own
identity is "Today's Homeowner", and a record whose stored name is page copy *and* whose
own site identifies a different company is not a company record — it is a page on somebody
else's site. That evidence is produced by first-party research, which is exactly why the
authorization puts re-research before remediation.

So tonight's order is: deploy, re-research the estate, then judge with the evidence the
re-research produced. Records that still rest on one signal go to review, as instructed.

**Also settled by this reading:** `Apartments for Rent in 33133 - Miami, FL` is a real
company's page (Apartments.com), and the honest action for it is the U-Haul action —
clear the unsupported trade so it leaves HVAC inventory — rather than pretending the
company does not exist.

## 7. The release candidate was refrozen, twice-over reasons

### A. The "Broken Website" defect (reported live by Michael)

Research Health was labelling live company sites **Broken Website** over the sentence
"no page could be read on the last attempt". Michael opened three in a browser and found
three working HVAC businesses. The audit found **three separate defects** behind that one
label.

| site | what actually happened | what we said |
|---|---|---|
| energyair.com | HTTP **200**, 634 KB, title *"Energy Air - Trusted HVAC & Commercial AC Services in Florida"* | discarded — the word `captcha` appears at byte 3634, inside a **script manifest** (`"businesslogger","captcha","clickhandlerregistrar"`) |
| airmotionshvac.com | HTTP **403** from a WAF | classified `login_required` |
| airworthac.com | HTTP **403** from a WAF | classified `login_required` |

And the run recorded only `pages_fetched: 0`, so nothing downstream could tell a refusal
from a dead domain.

**Fixed:** the content test now matches only the sentences a challenge page writes for a
human, and ignores a page the size of a real website; `403` is `access_denied` and `401`
stays `login_required`, with the crawl still stopping at both; a research run stores
`source_state` — READ / REFUSED / UNREACHABLE / HTTP_ERROR / DISALLOWED / NO_WEBSITE —
with per-page reasons behind it. The exception is now `website_research_unavailable`,
reading *"Sales Brain could not read this website on the last attempt: the site refused
our crawler (access_denied). That is a fact about our research, not about the company."*

**Verified against the three sites after the fix:**

| site | before | after |
|---|---|---|
| energyair.com | 0 pages, "Broken Website" | **READ** — 2 pages, 14 contact endpoints, 2 addresses |
| airmotionshvac.com | "Broken Website" | **REFUSED** (`access_denied`) |
| airworthac.com | "Broken Website" | **REFUSED** (`access_denied`) |

Nine regression tests cover every case Michael listed, including the last one: **an
Account never loses its trade or its place in inventory because our crawler was refused.**

### B. The four forward-qualification failures, classified

The first forward run on `6261a71` was 2250/2254. The four:

| test | class | resolution |
|---|---|---|
| `F1 nothing in this build can reach DataForSEO` | HARNESS_ENVIRONMENT | the suite inherited production's `.env`, so it ran with live credentials and a signed governance review |
| `a connection test reports what is actually usable` | HARNESS_ENVIRONMENT | the same — it authenticated against the real API and read an account balance of 50.745 |
| `a company with a branch in the ZIP is in that market` | STALE_EXPECTATION | fixture writes a `physical` location with no street, which migration 053 refuses |
| `two locations of one company are one company` | STALE_EXPECTATION | same fixture shape |

Neither product defect. `tests/setup.ts` now starts a run from no provider, no credential
and no signed review — and only the discovery provider, because pinning the outbound keys
too broke four unrelated tests that configure those themselves. Application code never
writes a physical location without a street (`upsertLocation` types such a row
`service_area`), so the two fixtures were given addresses.

## 8. Blast radius of the false "Broken Website"

Measured with the fixed fetcher against every Account whose last research run read
nothing, read-only, writing nothing. **75 Accounts** hold a website and had read nothing.

| what the fixed fetcher finds | count | what it means |
|---|---|---|
| **READABLE** | **19** | live company sites that were being reported as broken |
| `access_denied` (403 / WAF) | 36 | the site refuses our crawler. Honest, and not a claim about the company |
| `robots_disallow` | 11 | the site asks us not to read it. We do not |
| `tls_error` | 7 | we could not negotiate TLS. Not weakened to make it pass |
| `anti_bot` | 1 | a genuine challenge page |
| `dns_error` | 1 | one failed lookup, which is not a dead domain |

**19 live businesses** were carrying a false claim about their website, and the other 56
now carry an accurate reason instead of a wrong one. Among the 19: Energy Air, English Air
Inc., Ferran Air Conditioning, Bob Heinmiller Air Conditioning, Miami Mechanical, Air Flow
Designs, Certified Climate Control.

This also changes what the estate re-research is worth. Every one of those 19 will now
yield first-party evidence — contact routes, published addresses, site identity — that the
pre-fix estimate assumed was unavailable. Energy Air alone produced 14 contact endpoints
and 2 addresses in the verification run.

## 9. Results

_Filled in as the run proceeds._

## 10. Morning handoff

_Filled in at the end._
