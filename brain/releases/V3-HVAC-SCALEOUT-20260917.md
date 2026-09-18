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

## 4. What the estate taught us — the 2026-09-17 hand audit

Before any of the scale-out ran, a hand audit was made of the production snapshot. It is
the evidence base for everything in section 5, and it lives in the private repository
`GitterGlitter93rt/SalesBrain-Audit-Data`, `research-audits/claude-2026-09-17`, commit
`b5af52fedc1e09c448035dbb32382684a5b33b62`.

**Scope, stated honestly.** It is not the full 312-Account audit; ChatGPT Work owns that
and holds a checkpoint of 111 Accounts, 31 findings and four artifacts that does not exist
on this machine. Three passes were completed: every URL variant of 42 of the 53 unreadable
Accounts (the other 11 are robots-disallowed and were not fetched), all 135 named-person
records, and three official sites crawled page by page.

**The finding that reordered the sprint.** Of the 42 unreadable Accounts probed across
apex/www and http/https, **exactly one** became readable — `masterrepairplumbing.com`, a
www-only host. The other 41 refuse an ordinary honest client too: 37 behind a captcha
challenge, one parked, one deactivated by its website provider, one silent.

Sales Brain's `REFUSED` state is therefore **accurate**, and a better crawler recovers
almost none of these 52 Accounts. That inverts the expected conclusion and moves the work
from crawling to alternative sources.

| what the audit measured | number |
|---|---|
| unreadable Accounts probed | 42 of 53 |
| readable by an ordinary client where the miner failed | **1** |
| carrying `sg-captcha: challenge` in a response header | 37 (25 of 25 re-probed) |
| named-person records that are not people | **27 of 135 (20%)** |
| endpoints attributed to any person, estate-wide | **0 of 609** |
| Accounts on a reserved, non-resolvable domain | 1 |
| non-contractor product pages in workable inventory | ≥1 confirmed |

## 5. The six defects, and what each became

| | defect | measured | now |
|---|---|---|---|
| A | a name in a person-shaped place became a person | 27 of 135 | `judgePersonIdentity`, seven verdicts, only two hold authority |
| B | routes belong to nobody | `contact_id` null on 609 of 609 | `attributeEndpoint`, six ranked bases, role mailboxes never promote |
| C | a reserved domain was a website | `proofroof.invalid`, live | `judgeDomain`; recovery never opens a campaign, domain resolution never adopts one. A discovery-time guard is deferred: the fixture corpus is built on RFC 2606 names, and see DEC-038 |
| D | the block was inferred, not read | 37 of 42 | the `sg-captcha` header is read and kept as evidence |
| E | retrying was treated as the answer | 1 of 42 recovered | an exhausted campaign queues `alternative_source_research` |
| F | a product page was a contractor | "Tool # 32806" on harveytool.com | `PRODUCT_PAGE`, decided on shape before ownership |

Two behaviours were measured and found already correct, and are pinned so nobody
re-derives or "fixes" them: the form-field placeholder `xyz@123.com` that was never
ingested, and the 404 pages that return a full-size branded body and are declined on
status rather than on size.

**Qualification of this change.** 209 tests across the fifteen affected suites, run
serially because they share a database. `npm run check` clean, `npm run build` clean,
`npm audit --omit=dev` 0 vulnerabilities. Three defects were found in the fixes themselves
before they shipped: the person-identity rules were ordered so that a contractor's own name
read as somebody else's firm; the reserved-domain guard was in the wrong layer and fired on
test fixtures; and two of my own recovery fixtures still named `.invalid` hosts in escaped
regex form after the rest had moved.

**Not deployed.** V3 remains undeployed, no provider money has been spent beyond the
pre-existing `$0.2760`, and no paid HVAC acquisition has started. ChatGPT Work's full
312-Account audit merges before qualification and deployment.

## 6. Apollo — paid enrichment, last in the waterfall

Authorized by Michael on 2026-09-18 with roughly 1,200 credits. Built, tested and
documented on the branch. **Not deployed, not enabled, never called.**

### The API, as verified on 2026-09-18

Read from docs.apollo.io rather than assumed. Authentication is the `x-api-key` header.

| endpoint | method | credits |
|---|---|---|
| `/mixed_people/api_search` | POST | **0** — and returns `has_email` / `has_direct_phone` per person |
| `/people/match` | POST | 1 for demographics or email; **+8 if a mobile is returned**; 0 when `match_confidence` is `none` |
| `/people/bulk_match` | POST | up to 10 per call, same per person |
| `/organizations/enrich` | GET | 1 per organization |

Two documented behaviours shaped the whole design. Search is free and says whether an
address exists, so the paid decision is made on free information. And `reveal_phone_number`
makes the call asynchronous and requires a `webhook_url`, on top of costing nine times an
email — which is why it is off rather than merely discouraged.

Bulk result ordering is **not documented**, so results are correlated by Apollo person id
and never by array position.

### What was built

| piece | file |
|---|---|
| normalised types and the adapter contract | `src/providers/apollo/types.ts` |
| the only place that knows Apollo's JSON | `src/providers/apollo/client.ts` |
| eligibility: is this a business, and is anything still missing | `src/providers/apollo/eligibility.ts` |
| candidate scoring and selection | `src/providers/apollo/candidates.ts` |
| idempotency and the credit ledger | `src/providers/apollo/ledger.ts` |
| the worker and the daily due-sweep | `src/workers/apolloEnrichment.ts` |
| schema | `migrations/058_apollo_enrichment.sql` |

Apollo enters where the resolver already reserved a place for it —
`LICENSED_CONTACT_PROVIDER`, priority 70, below every first-party and public source — and
runs in Stage H, the paid slot that has always been skipped.

### Defaults

`APOLLO_ENABLED=false`. Phone enrichment off. Both waterfalls off. People search on,
because it is free. No outbound capability is touched, and none becomes enabled as a side
effect.

### Freshness

A daily sweep reads `next_check_at` and queues only the Accounts that are due, so a daily
sweep is not a daily bill. Missing decision maker or missing route: 30 days. No match: 60
days, doubling to a ceiling of four times. Complete: 90 days. A material change of
organisation identity — a different canonical domain — makes an Account eligible at once,
because a prior answer is about a company we are no longer asking about.

### Pilot — NOT RUN

`APOLLO_API_KEY` is present in the environment and empty. Nothing else blocks the live
capability check or the authorized ~20-Account pilot.

**To install it**, on the box that runs Sales Brain:

```
# Edit the worker's environment file and set the value, without echoing it:
#   /home/roothecks/YAD-Sales-Brain/services/sales-brain/.env
# Change the existing empty line
#   APOLLO_API_KEY=
# to
#   APOLLO_API_KEY=<the key from Apollo > Settings > Integrations > API>
chmod 600 /home/roothecks/YAD-Sales-Brain/services/sales-brain/.env
```

Do not paste the key into chat. Once it is in place, the capability check and the pilot can
run without deploying anything, because both read the snapshot and call the provider
directly.

## 7. Results

_Filled in when the scale-out runs._
