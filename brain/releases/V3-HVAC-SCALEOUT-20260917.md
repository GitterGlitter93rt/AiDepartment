# V3 — HVAC scale-out, deep research, and full-estate revalidation

**Branch:** `feature/sales-brain-v3-hvac-scaleout`, cut from the deployed production SHA
`b34a07968ec158f0cd8a73b754f5a5f6a1b51cc9`.

## 1. Authorization

Michael, 2026-09-17:

> "IDC spend whatever is needed lets go! We want more HVAC companies and we want to
> re-research everything for data accuracy."

**Authorized:** paid DataForSEO market discovery; paid Stage-D contact search; whatever
paid research a large, accurate HVAC inventory needs. No fixed dollar cap.

**Conditions.** Authorized is not unaccounted. Every paid request must be purposeful,
deduplicated, attributable, logged, tied to a market or Account objective, protected
against duplicate provider billing, and measured for yield. A query family stops when its
marginal yield of new companies collapses, not when a budget line is reached.

**Not authorized, and unchanged:** email, SMS, calls, Smartlead, Twilio, auto-booking,
anything that reaches a prospect. Also unchanged: no CAPTCHA bypass, no robots bypass, no
scraping of prohibited or private systems, no automated restricted government access, no
changes to the public site, BodyShop Automate or unrelated infrastructure.

**This sprint creates and enriches prospects. It does not contact them.**

Two additions arrived mid-sprint and are part of the same authorization:

- **Durable website recovery.** One failed fetch must not end research. Retry hourly for
  up to ten attempts, durably, across restarts and deploys.
- **Actually read the search results.** A snippet is not research. Read up to five result
  pages, classify every result by source role, open what is relevant, and deep-crawl a
  company's own site rather than stopping at its homepage. Measure whether depth pays.

## 2. The baseline, captured before anything changed

`DEPLOYED_CODE_SHA` `b34a079` · schema **54** · `/healthz` **200** · queue drained.

| | |
|---|---|
| accounts total | 324 |
| verified | 267 |
| workable (verified, not suppressed) | 267 |
| suppressed | 12 |
| `legacy_unverified` | 45 |
| rejected | 12 |
| carrying a vertical | 189 |
| with a canonical domain | 304 |

**By trade:** HVAC **137**, Roofing **42**, Plumbing **10**. Every other vertical profile
is defined and empty.

**Research states:** READ 222, NO_WEBSITE 49, REFUSED 37, DISALLOWED 11, UNREACHABLE 5.

**Coverage:** 287 locations (219 physical, 221 with provenance) · 651 contacts, 141 named ·
447 phone endpoints, 180 email endpoints · 253 Accounts with a company phone · 101 with a
company email · 73 with a named decision maker.

**Endpoint roles:** MAIN_BUSINESS_LINE 447, UNKNOWN_EMAIL_TYPE 80, GENERAL_BUSINESS_EMAIL
54, ROLE_EMAIL 46, and **zero** DIRECT_PERSON_EMAIL — the V2 correction holding.

**Evidence and provenance:** 3,647 evidence records · 4,276 search observations · 3,006
discovery candidates · 648 research runs · 747 jobs, all SUCCEEDED, none queued or failed.

**Spend:** `$0.2760` across 106 provider calls (45 `task_post`, 35 `task_collect`, 26
`task_get`). **`PROVIDER_SPEND_START = $0.2760`.**

**Human sales activity:** 0 Accounts. **Suppressions:** 12 active. **Review queue:** 387
findings across 218 Accounts.

**Markets:** 0 saved markets, 0 mining jobs. The estate was built by ad-hoc runs; this
sprint needs a systematic geography plan instead.

## 3. Phase 1 — the scale blockers

Fixed before multiplying the estate, because both defects multiply bad data.

### A. `WORKER_CONCURRENCY` was fake configuration

Declared in `config.ts` as `numeric('WORKER_CONCURRENCY', 2)` and read by nothing, so the
worker leased one job at a time whatever the value said. Scaling the V2 rebuild meant
starting extra processes by hand and killing them by hand afterwards.

Now real: `runWorker` runs N lanes in one process. The queue was already built for this —
`for update skip locked` makes the claim atomic and a lease belongs to whoever holds it —
so what the lanes share is deliberately small: the stop flag, two counters, two timers.

Three things had to change with it:

- **Lease ownership is per lane.** `leased_by` is `host:pid#lane`, so an expired lease
  names the lane that stopped making progress rather than the process it was in.
- **The heartbeat had to stop lying.** One row now covers several jobs, and
  `current_job_id` can only name one. Migration 055 adds `concurrency` and
  `current_job_ids`; `current_job_id` keeps the lowest-numbered lane's job so read models
  written before concurrency existed still work.
- **The spend ceiling cannot be raced.** It reads what has been spent and then spends, so
  two lanes either side of that gap both see the same money as unspent. Rather than turn
  a precondition into a distributed reservation, paid job types are capped at one lane:
  `market_mine` and `zip_research` run singly, research runs N-wide. Mining is bounded by
  the provider anyway; research is bounded by other people's web servers, which is exactly
  what concurrency helps.

The cap is applied in the lease predicate rather than by handing a claimed job back,
because claiming and releasing increments `attempts` and spends a retry on every poll.

### B. `candidateSourceClasses` called everything a company's own site

`classifyObservation` ended with a fallthrough: a row matching none of its shape rules
became `OFFICIAL_SITE`. That one line is why production records **homeyou.com** (a
directory), **uhaul.com** (a moving company) and **myfloridalicense.com** (a state
licensing portal) as contractors' own websites — 2,002 of 3,006 discovery candidates carry
that class, and it is the reason V2 could not tell a directory from a contractor.

`src/discovery/sourceRole.ts` replaces the default with a conclusion. Thirteen roles, and
`COMPANY_OWNED_SITE` requires positive evidence: the company name agreeing with the
registrable domain, the site declaring an organisation that matches its own domain, the
site declaring itself to be this company, or the company's independently-known phone or
address published on the page. Two supporting signals — a self-canonical URL, navigation
to its own about/contact pages, one business seen across the domain — substitute for one
strong one. Nothing else is ownership, and what cannot be evidenced is `UNKNOWN`.

A licensing portal on a `.com` is still a licensing portal. A domain carrying three or
more distinct businesses is serving other people's businesses, whatever it calls itself —
the rule that found `theagentpages.com` and `nationalroofingdirectory.com` without anyone
naming them.

### C. Durable website recovery (migration 056)

V2 established that a site we could not read is never evidence against a company, and
then left those Accounts unreadable for ever, because research ran once. 53 Accounts sat
that way.

A campaign retries hourly, up to ten attempts, and lives in the database. The existing job
queue already provides durable scheduling through `run_after`, survives restarts and
deploys, and dedupes claims through for-update-skip-locked; an in-memory timer would lose
every campaign on the next deployment, which is the failure this exists to end. A unique
partial index allows one active campaign per Account, so two workers, two sweeps or two
deploys cannot run the same ten hours twice.

Each attempt probes a finite, deduplicated candidate set — the stored URL, then
apex/www over https and http — and records the requested URL, final URL, redirect chain,
status, source state, failure reason, DNS and TLS results, content type and bytes.

What it does not do: defeat a refusal. A 403, a challenge page and a robots disallow are
answers, and the answer to an answer is not to ask again wearing a different hat. No
identity rotation, no CAPTCHA solving, no WAF circumvention, no TLS verification disabled,
and `DISALLOWED` ends the campaign rather than authorising an hourly crawl of a blocked
path. The only mechanism relied on is that a site's own state may change.

A redirect landing on another registrable domain is held as `candidate_domain` and never
written to the Account: a company that moved, a parked domain and an acquisition all look
identical from a redirect. Two attempts agreeing on 404/410 ends the campaign as terminal
and routes to replacement-domain discovery, because ten hours of asking a 404 the same
question teaches nothing.

### D. The crawl reaches the pages that name people

`MAX_PAGES` was 8 — enough to find a contact route, not enough to find a person. The pages
that name an owner sit behind a submenu or on a location page, and a crawl that stops
before them reports accurately and uselessly that the company published no names. Now
`RESEARCH_MAX_PAGES_PER_SITE`, default 16, with `/who-we-are`, `/management`,
`/our-company`, `/meet-our-team` added to the candidate paths and `owner|founder|
president|principal` added to the anchors worth following. Raised rather than removed:
this is somebody else's web server and every extra page is another 1.5 seconds of it.

## 4. Results

_Filled in as the sprint proceeds._
