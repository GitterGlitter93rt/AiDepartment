# Sales Brain rep enrichment — handoff

Branch: `feature/sales-brain-rep-enrichment`
Base: `ef4d3431b0083913efe5ed5811ffe49bef81a6a0` (production at the time)
Schema: 52 + migration **053** (additive; not applied to production)

This document exists so the next engineer does not need the conversation that produced
the code. It says what was built, why each decision went the way it did, and what is
deliberately unfinished.

## The problem this addresses

Discovery was substantially built: the miner finds real businesses and the read model
tells the truth about coverage. What a rep got afterwards was a name, a domain, a phone
and an ad observation. Everything else a rep needs before dialling — is this a real
company, who do I ask for, are they licensed, what do they run, what can I pitch — was
either absent or sitting unread in the database.

## What was built

### 1. An official-source framework (`src/sources/`)

| File | What it is |
|---|---|
| `types.ts` | Adapter contract, six match statuses, `OfficialFact` |
| `match.ts` | Conservative identity: `decideMatch`, `corroborate`, `distinctByEntity` |
| `requirements.ts` | State × vertical licensing map |
| `governance.ts` | Per-source written review + the two gates on live calls |
| `registry.ts` | Adapter instances, fetcher injected |
| `run.ts` | Stage execution: per-source timeout and isolation |
| `snapshots.ts` | Bulk dataset load/index/read |
| `html.ts` | Table and `<pre>` readers for tabular records |
| `adapters/` | flSunbiz, flDbpr, txComptroller, txTdlr, txTsbpe |

**The design decision everything else follows from:** a name match is a *candidate*,
never an identification. `decideMatch` requires one corroborating signal beyond the
name — address, phone, domain, city or ZIP — unless the name carries its own identity
and nothing competes with it. A conflicting city or state disqualifies a record however
well the name matches, because two companies of one name in two cities is the ordinary
case in any register. Two survivors is `AMBIGUOUS`, and **AMBIGUOUS writes nothing**:
attaching another company's officers to a prospect is worse than attaching none.

**Six match statuses, not a record-or-null.** `NOT_APPLICABLE_STATEWIDE` and `NO_MATCH`
both produce no licence and mean opposite things. Collapsing them is how the product
would tell a rep that a Texas roofer failed a licence check that does not exist.

### 2. Stages B and C now run

`contactResearch.ts` skipped them from the day it was written, reason: *"source
governance review not signed off"*. That refusal was correct. It was not deleted — what
changed is that the review it was waiting for now exists per source in
`governance.ts`. A `BLOCKED` or `DISABLED_PAID_SOURCE` entry **cannot** be switched on
by any environment flag; `liveCallsPermitted()` refuses before it looks at one.

Each source runs inside its own timeout and its own try/catch. A thrown adapter becomes
a recorded `SOURCE_UNAVAILABLE`, never a failed research run — a Texas plumbing licence
is no less true because the Comptroller timed out.

### 3. Roles are never promoted

A registered agent, a qualifying agent, a licence holder and a Responsible Master
Plumber are each recorded at the role the record gives them. The resolver's existing
`EVIDENCE_ONLY_RELATIONSHIPS` keeps all of them from standing in for an owner.

They are usually a principal. "Usually" is a sales heuristic, not a fact, and the
distinction is the whole point of the system.

### 4. First-party depth (`src/resolver/`)

`techSignals.ts` and `companyProfile.ts` read technology, socials, contact routes and
stated claims from the pages the crawl **already downloaded**, inside the loop, so
nothing is retained.

Technology detection requires a vendor artefact — a script host, a documented global —
never a word in the copy. A blog post comparing ServiceTitan and Jobber is not a
customer of either.

### 5. Business snapshot (`src/domain/businessSnapshot.ts`)

Every row says how sure it is. **Verified** = an official register says so.
**They say** = the company states it on its own site and nobody checked. Expired
evidence is dated, not dropped, because a blank reads as "no".

### 6. Gap hypotheses (`src/domain/gapHypotheses.ts`)

The sellable openings live between a signal and an absence: paying for clicks with
nowhere to book, advertising 24/7 with no after-hours intake. Both halves must be
observed, and an absence only counts when the site was actually read — otherwise "no
booking page" is a fact about our crawler.

### 7. Site quality (`src/resolver/siteQuality.ts`)

Front page only. Deliberately not an SEO crawler — the question is narrow and
commercial: would a rep open a conversation differently knowing this? No mobile
viewport, no LocalBusiness markup, a footer copyright three years stale. Nothing is
scored out of a hundred, because a number invites an argument and a fact invites a
question.

These are the only deliberate `no` this worker records. A home page either declares a
viewport or it does not; that is a fact about the page. Contrast "no booking page",
which is only meaningful once the site was actually read.

### 8. Where we looked (`src/domain/sourceAudit.ts`)

`research_runs.adapter_results.official_sources` recorded every source attempt and
nothing read it back. An empty licence panel has four possible meanings — we looked and
there is none; we could not look; this state issues none; we found several and could
not tell them apart — and an empty panel says all four at once.

### 9. Contact routes told apart

Toll-free vs local vs a number the company invites you to text (which requires an
actual invitation, not a number near the word "text"). Role inboxes are classified so a
rep writes to `sales@` rather than the dispatch queue at `service@`.

### 10. An SSRF hole, closed

`politeFetch` fetched whatever host it was handed, and every URL comes from outside. A
site recorded as `169.254.169.254` would have had the worker read cloud metadata and
file it as evidence about a prospect. Literal and resolved addresses are both checked,
IPv4-mapped IPv6 included, and redirects are followed by hand because a 302 to
localhost is otherwise unobserved.

## Source enablement

See `docs/09-software/SALES-BRAIN-SOURCE-GOVERNANCE.md`. Summary: **nothing is on**.
Sunbiz and the State Bar are `BLOCKED`; SOSDirect is `DISABLED_PAID_SOURCE`; the other
four are `FEATURE_FLAGGED` behind `SOURCE_*_ENABLED`.

## Traps worth knowing about

1. **`stripTags` flattens tables.** It puts every `<td>` on its own line and collapses
   runs of spaces. Parsing a results table through it mixes one licensee's name with
   another's licence number. Tabular records go through `sources/html.ts`.
2. **`collected_at` is set on every provider-task close**, not just successful ones. On
   a FAILED or ABANDONED row it is when we gave up. Always filter to `COLLECTED`.
3. **DNS in the crawler must stay cached.** The SSRF guard resolves before fetching; an
   uncached lookup against reserved `.invalid` fixture names cost one integration test
   **255 seconds**.
4. **One company holds several licences.** A register returns one row per licence, so
   candidates must be distinct *entities* (`distinctByEntity`), not distinct records.
5. **Never overlap DB-backed suites** — they share `yad_sales_test` and will corrupt
   each other's fixtures. A `pgrep -f "tsx --test"` guard does **not** work for this:
   the waiting shell's own command line contains that string, so it matches itself and
   waits forever. Run DB suites sequentially in one command instead.
6. **`search_observations.source_type` must be `'discovery'`.** That is what the miner
   writes and what the Account page filters on; any other value produces a row nothing
   will ever show a rep.
7. **`getAccountDetail` needs a viewer** (`{ userId, role }`) and returns null for an
   invisible account.
8. **Never let a test run DDL against the shared test database.** A test here dropped
   `source_snapshots` to simulate a fault and restored it by calling `runMigrations` --
   which skipped it, because 053 was already recorded as applied. `resetDatabase()`
   truncates that table, so every subsequent test *file* then failed on setup: roughly
   600 unrelated failures from one `drop table`. Simulate faults with injection, not
   with schema changes.

## What is deliberately not done

See `docs/NEXT-STEPS.md`.
