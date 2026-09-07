# Your AI Department — Decision Log

**Last reviewed:** 2026-08-30

This file records material decisions that agents must not casually reverse. Detailed canonical specifications remain authoritative. A proposal is not a decision until Michael approves it.

## Approved decisions

| ID | Date | Decision | Source / implication |
|---|---|---|---|
| DEC-001 | 2026-07 | YourAIDepartment.ai is the authority domain; HireAnAIDepartment.com is a campaign/redirect domain, not a competing duplicate site. | docs/00-company/launch-decisions.md |
| DEC-002 | 2026-07/08 | V1 is custom coded with Astro/TypeScript, static-first, and deployable to SiteGround. The older WordPress/GeneratePress direction is superseded for V1. | CLAUDE.md; docs/02-website/website-build-spec.md; current code |
| DEC-003 | 2026-07 | The free AI Department Assessment is the primary public diagnostic; Executive AI Strategy, AI Implementation, AI Growth Systems, and Managed AI Department form the core commercial ladder. | docs/00-company/launch-decisions.md |
| DEC-004 | 2026-07 | Deterministic rules control assessment scores, flags, recommendation eligibility, and ROI prerequisites. AI may explain established results but may not invent or override them. | docs/04-assessment/implementation-spec.md |
| DEC-005 | 2026-08 | Calendly is the approved V1 scheduler. Stripe is approved for the $750 Executive AI Advisory Session. Exact URLs/embedding and several policies remain unresolved. | Scheduling addendum in docs/00-company/launch-decisions.md and docs/02-website/scheduling-and-booking.md |
| DEC-006 | 2026-08-30 | The assessment architecture now needs two experiences: a short, lower-friction assessment and a long, deeper diagnostic assessment. | Michael's project direction. Scope is approved; detailed routing remains open under ASM-001. |
| DEC-007 | 2026-08-30 | The GitHub AiDepartment repository is the durable shared project brain for ChatGPT/Codex, Claude Code, GLM/OX, and human collaborators. Chat threads and machine-local model memory are supporting context, not the task database. | brain/README.md and agent instructions |
| DEC-008 | 2026-08-30 | brain/TODO.md is the execution source of truth. A separate ChatGPT roadmap thread may display or discuss it, but does not replace it. | Operational decision |

## Approved source-of-truth order

1. docs/00-company/launch-decisions.md
2. Approved internal strategy under docs/00-company/
3. Assessment specifications under docs/04-assessment/
4. Product definitions under docs/03-products/
5. Public website specifications/copy under docs/02-website/
6. Operational state and approved newer decisions in brain/
7. Older planning/research and chat history

When a newer approved decision in this log changes an older canonical document—such as the short/long assessment split—the task is to reconcile the canonical document, not to leave two permanent truths.

## Proposed or unresolved — not approved implementation decisions

- Whether /ai-assessment/ becomes the short assessment, remains the long assessment, or becomes a chooser/landing route.
- Exact short-assessment questions, scoring, lead gate, result depth, and handoff.
- Exact long-assessment route and whether the existing assessment_v1 becomes an explicitly named long version.
- GTM container/account structure, consent platform, Meta CAPI architecture, CRM, and lead backend.
- First paid campaign vertical, geography, budget, audience, creative mix, and optimization event.
- Production deployment workflow and deployed commit.

Do not turn any item in this section into production behavior without approval and documentation.

## 2026-09-03 — Outbound Sales Brain implementation decisions

Decisions taken during gates T0–T8 that a future agent should not silently reverse. Each follows
from an approved specification; where a specification left a choice open, the reasoning is recorded.

### The sales portal is a separate package, not part of the Astro site

`services/sales-brain` is its own Node package. The marketing site is static-first and deploys to
SiteGround; the portal needs a long-running authenticated process, a database and background workers
on the EdgeXpert. Fusing them would break the marketing site's deployment model and put an internal
application behind a public build.
**Authority:** `CLAUDE.md` static-first principle; `CLAUDE-SALES-PORTAL-START-PROMPT.md` §8.2.

### PostgreSQL runs in Docker, not from apt

The EdgeXpert has no passwordless sudo, but the user is in the `docker` group. Postgres 16 runs as a
container bound to `127.0.0.1:5432` with a named volume and `restart: unless-stopped`. This was a
constraint of the machine, not a preference.

### Server-rendered HTML, not a SPA

The portal is dense but barely stateful. A React/Vite chain would add dependency surface on an
internal box for no user-visible gain. One 296-line vanilla file adds selection, claiming and the
drawer; every page and primary action works without it.

### Invariants live in the database, not only in application code

Ownership consistency, suppression propagation, evidence and ownership-history immutability, Call
Pack immutability, and the rule that a booking cannot be `CONFIRMED` without a provider event id are
all enforced by constraints and triggers. The hard-fail lists in the specs describe outcomes too
serious to depend on a code path staying correct.

### Systemd *user* services with linger, not system units

No passwordless sudo means no system units. User services with linger survive logout and reboot.
Revisit only if root access becomes routinely available.

### A discovery adapter must be BOTH credentialed AND governance-reviewed

`availableDiscoveryAdapters()` requires both. A configured but unreviewed source cannot run by
accident. This is stricter than "has an API key" on purpose.
**Authority:** `market-miner-source-governance-review-template.yaml`.

### An unreadable calendar offers zero slots

When availability cannot be read, the booking service returns no times and honest words, rather than
falling back to a default schedule. An offered time that has not been verified becomes a broken
promise made on a live call.

### An email unsubscribe is email-scoped by default

It does not silently become an account-wide phone DNC. Widening the scope is an explicit policy
decision, not a model's reading of a reply.
**Authority:** `outbound-sales-brain-smartlead-sync-spec.md` §8.

### `phone-agent/` was left intact and unreferenced

Its Twilio relay belongs to `voice.youraidepartment.ai`. Its flat `leads` schema and in-memory store
are superseded by the canonical model rather than forked into a second lead database. Nothing was
deleted; the voice track will be repointed at the canonical database when it resumes.

### Repository fix: `hvac.v1.yaml` did not parse

`primary_hook_template` contained an unquoted `": "`, which YAML read as a nested mapping. Quoting
the scalar changed no semantics. Every other `docs/**/*.yaml` was swept for the same shape.

### A rate is never shown without the population it came from

Analytics prints "50% (1 of 2)", not "50%". The same percentage off two calls and off
two hundred are different facts, and a table showing only the percentage makes them
look identical. Below the minimum-attempt floor the opener comparison names no
leader, prints no ranking and gives no ordering that could be read as one. Promotion
readiness is a separate, stricter question from comparability, because reading a
report is not the same as acting on it.

### Endpoint quality and permission to dial are separate axes, including visually

Struck-through means the value itself is wrong: a wrong number, a disconnection, a
hard bounce. A correct number that is merely waiting on an eligibility check is shown
plainly, with the block said by a badge, a note and a missing action. Defacing a
correct number invites a rep to "fix" it, which corrupts the data we were protecting.

### Not-yet-known is never styled as judged-and-found-poor

Unscored gets its own treatment rather than tier D's, and a claim our own sources
contradict gets its own rather than a neutral one. An unresearched advertiser is the
prospect worth looking at, and a contradicted owner name is the one thing that will
end a call in the first sentence.

### A booking that is not confirmed must be visible somewhere

"Confirmed only when the provider confirms" is half a rule. The other half is that a
booking stuck waiting on the provider appears on the attention tab once it is past
the in-flight window, because we may already have told the prospect an invite was
coming. Silently invisible is worse than either state.

### Ownership stays in its own ledger, and the audit view reads both

Claims, releases and reassignments are written to `ownership_events`, not duplicated
into `audit_log`. The audit page and the account history union the two for reading, so
"who took this Account" is answerable without a second write path that could drift
from the first.

### A queued provider task is not a result

An adapter that posts a task must collect it. DataForSEO Standard mode answers with a
task id; treating that acknowledgement as an empty result set is indistinguishable
from a market with no advertisers in it, and records the run as a success. The poll is
bounded by configuration and its outcome — collected, still queued, or errored — is
recorded either way.

### A provider webhook is authenticated by signature over the raw bytes

Not by knowing the URL, and not over a re-serialised object: re-serialising changes
key order and whitespace, so the check then fails legitimate requests, and the first
response to that is to turn the check off. The timestamp is inside the signed material
and outside a tolerance window a captured request is refused, so a valid signature is
not a permanent credential. An unverified payload never reaches ingestion.

### A screening result that no policy reads is not a control

Twilio Lookup writes its answer onto the endpoint that channel eligibility actually
reads, only on success. A failed lookup writes nothing rather than overwriting a type
we had already established, because an outage must never become a line type.

### PostgreSQL JIT is off for this application

The read models join several lateral subqueries, which gives them a plan cost around
four million, so every one trips the default jit_above_cost of 100,000 and gets
LLVM-compiled before it runs. Measured at 25,000 accounts: 148 ms of compilation on a
count that then executed in 154, and 183 ms on a page fetch that executed in 149. JIT
earns its keep on analytic queries that run for seconds; nothing here does.

### The page of ids first, then the projection

`select * from prospect_inventory ... limit 50` evaluates seven lateral subqueries for
every Account before the sort can pick fifty. Selecting the page of ids first lets
Postgres prune the laterals no filter mentions, and the projection is then built for
fifty rows. A single query with the page as a CTE is *worse* than the original,
because the CTE is materialised and the view scanned again to join it.

### Lock order is Account first, then anything else

Every transaction that touches an Account and one of its children takes the Account
row first: the rep's row for the claim ceiling, the follow-up, the opportunity, the
endpoints. Two paths used to lock the child first and deadlocked against a
do-not-contact, which locks the Account and then cancels its follow-ups. There is no
exception to this rule; a new path that needs a child lock reads the account_id
without a lock, takes the Account, and then takes the child.

### Evidence and ownership are followed across a merge, never moved

Both are append-only ledgers and rewriting a row's account_id is editing history —
the triggers refuse it, correctly. A merged Account survives as a tombstone and the
reads follow the chain. This is also why the tombstone exists rather than the row
being deleted.

### There is no unmerge

Undoing a merge honestly would mean knowing which of the survivor's rows came from
which original after both have been worked, and a call logged tomorrow belongs to
neither. An unmerge would restore a fiction or silently drop the work done since.
What is offered instead is the record: the tombstone with its own name, the counts of
what moved, the reason a person gave, the actor and an audit row — enough to repair
by hand, deliberately.

### A contact route is checked for usability, not presence

An import row is accepted only if a website, phone or email *normalises*. Testing
presence let a column-shifted row through — an unquoted comma in a company name puts
a URL in the phone cell and a phone number in the email cell — and produced an
Account with a name and no way to reach it, counted as a success.

### Spreadsheet formulas are neutralised at the sink, never on the way in

A company can genuinely be called "+1 Plumbing", and a prospect's data is stored as
they wrote it. The CSV writer prefixes a leading formula character; the importer
does not touch it.

### Synthetic data is unreachable by construction

Every generated domain is under `.invalid`, which RFC 2606 reserves so it can never
resolve; every generated phone uses the 555 exchange with directory assistance
excluded; every provenance field says SYNTHETIC_FIXTURE or DEMO_FIXTURE. The
generator refuses a database whose name does not say it is a scale target. A
convincing demo company that nobody can tell from a real prospect is how a rep ends
up calling one.

### Commercial truth outranks doctrine, in the retriever

A question about price or what we sell is answered from launch-decisions.md, and is
scored against the company's own vocabulary for those things rather than only the
words the asker used — otherwise "how much do we charge", which shares no word with
that document, is answered from the manual's examples.


## 2026-09-04 — Sales Portal live QA (GitHub Issue #2)

Decisions taken while working the operator bug hunt. Each closed a defect that was
visible on Michael's screen during the first real walk-through.

### A job records what it achieved, separately from whether it ran

`jobs.status` is the queue's business. `jobs.outcome` is the operator's, and it
distinguishes a search that found nothing from a search that could not happen:
DISCOVERY_BLOCKED, PROVIDER_UNAVAILABLE, PARTIAL, ZERO_RESULTS, NOTHING_TO_DO. A
provider outage is never reported as an empty market — turning an outage into a zero
is the same lie in a different place.

### Every operator counter names what produced it

"Accounts added today" counted every Account created by any means and sat on the
Mining page, where it read as mining output; all of them were demo seed rows.
Provenance now comes from the DISCOVERED activity written at creation, and the
Analytics page says in words how many of the accounts in scope are fixture data.
A number whose source is not stated is not a measurement.

### Worker liveness is asserted, not inferred

A queue with nobody serving it has no stranded jobs, because a job nobody picked up
has no lease to expire. Workers write a heartbeat on their own timer, so a worker
inside a long job still reports, and the operations panel reads that rather than
inferring health from the absence of a symptom.

### Each detail view answers the same question as the list it is reached from

The meetings list hid other reps' meetings; the meeting page showed any of them to
anyone holding the id. Same for opportunities and the prep brief. A record a rep
cannot see in a list is not readable by guessing its URL, and "not yours" reads as
"not found", because being told the difference teaches an attacker that an id is
real.

### Input the server cannot read produces a 4xx in the product's own words

A malformed id used to reach PostgreSQL and come back as 'invalid input syntax for
type uuid' with a 500 attached — a database error message in a browser, and a genuine
outage made invisible among them. Ids are shape-checked at the route, and one error
handler turns anything that still escapes into a sentence.

### A tombstone is a redirect, never a row in a count

A merged Account keeps its id so old links still work. Lists already dropped them;
the counters did not, so the search total disagreed with the rows beneath it and the
analytics funnel was inflated by the number of merges the team had done. Global
search resolves every hit forward through the merge chain, so a company that was
merged appears once, with the state it has now.

### The sign-in form counts wrong passwords

Durably, per address and per source, before the portal goes behind a public hostname.
The counters live in the database rather than in process memory: two workers behind a
proxy must count the same attempts, and a restart must not clear a lockout.

### A wall clock is read in the business timezone, never the server's

`<input type="datetime-local">` submits a time with no zone. Reading it with
`new Date()` made the meaning of a callback depend on the timezone of the box the
API runs on -- correct on the EdgeXpert by accident, five hours early on a UTC VPS.
It is read in `BOOKING_TIMEZONE`, the same zone the pages format times in. A value
carrying a Z or an offset is already an instant and is left alone. On the two DST
days the resolution favours late over early, because an hour late is a missed call
and an hour early is a call the prospect did not agree to.

### The build says whether it matches the schema it is running on

`schemaState()` compares the migrations in this build against the ones the database
has run, in both directions. Research Health carries it, `stack.sh status` exits
non-zero on a mismatch, and the API logs it at startup and starts anyway: a portal
that runs and says what is wrong is more use than one that refuses and tells nobody.
This is the generalisation of the failure already seen here -- an active worker unit
with no heartbeat, because the unit was running an older build.

### A discovery adapter reports why it came back empty, not just that it did

Every adapter failure -- no credential, a 401, a timeout, a task still in the
provider's queue, an exhausted budget -- used to return an empty array, and the
orchestrator counted that as "the provider was asked and this market has nothing in
it". That is the same lie the job outcome field was built to stop, one layer further
down. `discover()` returns a `DiscoveryResult` with a status, the funnel counters and
the provider task id. A provider that could not answer is never a market with nothing
in it, and a search that returned only companies we already hold is a completed
search, not a zero-result one.

### The ingestion funnel is four numbers, not one

"Provider returned 50 rows" is not "50 new businesses discovered". Rows, duplicates,
unusable rows, matched-existing and created are counted separately and printed on the
Mining page, because a single number cannot be checked: fifty rows becoming
twenty-five Accounts is either good dedupe or a broken filter, and only the numbers in
between say which.

### A discovered business is queued for research and located where it was found

Discovery used to create an Account and stop, leaving a name and a phone number that
no research would ever touch. Newly created Accounts are enqueued for research. They
are also given the searched geography as a service area when the provider gave no
address -- a fact about how we found them, not a claim about their mailing address --
because without it the business was invisible to the very search that discovered it.

## 2026-09-05 — Overnight miner hardening decisions (GitHub Issue #3)

Taken during the overnight execution of the Issue #2 campaign. Each follows from a defect found
rather than from a preference, and the defect is recorded with it so the reasoning survives.

### A score records the ruleset that produced it

Four scoring recognizers landed that changed what the same evidence is worth: an HVAC advertiser
that scored eight now scores fourteen. Every score written before that was produced under rules
that no longer exist and looked exactly like a current one, so a rep comparing two prospects was
comparing two policies without being told. `SCORE_VERSION` travels on both the `canonical_scores`
row and the `accounts` projection, a pinned fingerprint of rule ids and point values fails the
suite if the rules change without a version bump, and a bounded worker sweep recomputes anything
older. A score under a superseded ruleset says so in those words.

The fingerprint covers ids and points only. A recognizer growing stricter about the evidence it
accepts changes scores without changing it, and the comment says so rather than implying more.

### A provider's id for a search is not an identity for a business

Account resolution matches on provider identity before domain or phone. The DataForSEO adapter
fell back to the *task* id when a SERP row carried no id of its own -- which every real organic and
paid row does, because `advertiser_id` is an Ads Transparency field. Every business in one search
resolved onto the first, and the run reported the rest as "already in inventory". A twenty-result
market search would have produced one prospect. No id for the business now means no identity
claimed.

### A paid ad's title is ad copy, not a company name

The Account was being named "Same-Day AC Repair St. Augustine -- 24/7 Emergency Service". Nothing
in a SERP row distinguishes a headline from a name, so the name comes from the highest-placed
non-paid observation, then the domain, then the ad text only when there is nothing else. Local
Services ads are outside the rule because Google shows the business name there. The headline is
kept as ad copy either way.

### The daily provider ceiling stops buying, not collecting

The ceiling gated the whole adapter loop, so a run that could not buy also refused to collect a
task it had already bought. The provider charges on submission and answers for free: the money was
gone, the answer was waiting, and we declined to fetch it. The ceiling now sits on the branch that
spends.

### A market with an outstanding provider task is queued, not skipped

The scheduler skipped any market with a task still owed, to avoid buying the same search twice.
But collection happens inside the `market_mine` job, so the task was never collected, never
abandoned, and the market never refreshed again -- one PENDING answer retired a saved market
permanently. The job is queued precisely because a task is outstanding; not buying twice is
enforced in the handler, which collects before it submits.

### Spend accounting is not left to the adapter's honesty

`provider_usage` is written by adapters and the ceiling reads it, so an adapter that forgets to
record has no ceiling at all. That is the failure mode of the next adapter somebody writes. The
orchestrator now records the row when the adapter did not, charging the assumed worst case when no
cost came back.

### Never researched and researched-a-while-ago are different states

`researchedCount` counted every Account in scope, so a market discovered an hour ago fell through
to STALE and Find Prospects said "81 researched prospects, but the research has aged past its
freshness window. Treat advertising signals as historical." All three clauses false, and the last
invites a rep to believe we once saw advertising we have never looked for. `NOT_YET_RESEARCHED`
now says the true thing.

### A preflight that cannot check something says so rather than passing it

`npm run preflight` refuses to report the portal safe to expose while four checks are unchecked --
TLS termination, whatever authenticates in front, what else a tunnel exposes, whether the last
backup restores. All are facts about the machine and the proxy. A preflight that turns green on
the subset it can run is how somebody opens a firewall on a partial answer.

### A growth projection declines to project from data that cannot support one

The first version printed "fills in about 13,592,230 days" from bytes-per-row measured on a table
that is almost entirely empty pages. `npm run growth` now gives no rate below a thousand rows or a
day of history, and names what it is waiting for.

## Proposed — needs Michael, not decided

### Retention policy for provenance and machine exhaust

`search_observations.retention_class` is written `'transient'` on every row and read by nothing.
Nothing prunes `jobs`, `search_observations`, `provider_usage`, `provider_tasks`, `research_runs`
or `canonical_scores`; housekeeping clears sessions, abandoned uploads and sign-in attempts only.
`search_observations` is the fastest grower -- one row per business per search, for ever -- and it
carries the unread class.

How long to keep the record of how a company was found, which is the provenance behind "you are
running this ad", is a decision about what is worth keeping. It has deliberately not been taken;
`npm run growth` names the gap.

## 2026-09-06 — Offline execution queue (Issue #3, items A–E)

### A count of searches is a count of searches

`query_budget` meant "plan this many and buy the first one", so an operator asking for
twenty-five got one and the job called it a completed market search. N now means N
independent searches with their own keywords, provider tasks, fingerprints, accounting and
outcomes. Planning moved from the adapter to the orchestrator, which owns those things.

**The default is one, not twenty-five.** Making the count real without moving the default
would have turned every scheduled market refresh into twenty-five paid searches. Raising it
is an operator's decision, per run.

### Six ways of not knowing, kept apart

Every research fact resolves through one model: observed, absent, looked-and-not-found,
never-checked, aged-out, sources-disagree. `NO` is a state we essentially never earn -- we
can prove a company advertises and cannot prove it does not. Data nothing collects (ratings,
review counts) is `NOT_CHECKED` with the reason stated, never a zero.

### Found is not researched, and researched is not workable

Nine machine-evaluable readiness requirements, each explaining itself. Readiness is
deliberately **not a score**: a rep needs to know which requirement is missing, because the
next step differs in every case. `NOT_WORKABLE` (suppressed, DNC-listed, a merge tombstone)
is separate from `RESEARCH_NEEDED`, because no amount of research fixes the first kind and
mixing them costs a rep a morning.

A named decision-maker is not required; **having looked** is.

### A vertical, a service and an event are three different things

The live `hail damage roof 32095` came from an alphabetical tie-break among equal-intent
roofing queries. The distinction that fixes it is not "does the query mention an event" --
"water damage restoration" is a year-round service line -- but whether the query still makes
sense in a week with no weather. `cause` is explicit on the query; `inherent_causes` on the
vertical says when the event is the trade. Cause-neutral by default, event terms opt-in and
named rather than silently dropped.

### Exclusions are applied to the answer, not the question

Every profile's `negative_terms` had been written and never read, so roofing searches handed
supply houses and trade schools to reps. Now filtered at ingestion rather than pushed into
the provider query, which would change what the engine ranks. Whole-word matching, because
rejecting a real prospect is worse than admitting a supply house: nobody ever learns it
happened.

## 2026-09-06 — Source architecture and identity (Issue #3, items D and F onward)

### Listings discover who exists; SERP discovers who pays

A SERP row's identity is weak -- a domain or a phone and nothing that stably names the
business -- and that weakness already caused a mass collapse when the adapter fell back to
the provider's search-task id. A business listing carries an id that means the same business
tomorrow, so **a listing id is legitimate source identity and a search task id is not.**

Listings, SERP, first-party research and imports all converge on one canonical Account.
Whichever source arrives first creates it; the rest fill it in. Arrival order is an accident
of scheduling, so rep ownership, suppression, call history, contacts, opportunities and
meetings all survive a company being re-found. Mining may enrich a suppressed Account and
may never unsuppress it.

A structured-listing row without a stable id is not promoted to strong identity just because
it arrived through that adapter.

### A canary is a description before it is a run

`npm run miner:canary` is dry by default. Live requires `--live` **and**
`--confirm-spend-cents` repeating the ceiling, so a runbook command that somebody copies can
never spend money. The live path enqueues an ordinary `market_mine` job: a canary with its
own fast path would prove the canary works and say nothing about the system that will run.

A cost no provider declared is reported as unknown, never as zero. A market where every
result is a company we already hold is coverage, not `ZERO_RESULTS`.

### Two companies are not one because they share a word or a platform

A one-token name must match exactly. Overlap measured against the smaller name let "roofing"
merge with "salazar roofing and repair" on a shared answering-service number.

Platform domains -- social, directories, marketplaces, site-builder apexes -- are refused
for identity and never stored as `canonical_domain`, because path stripping turns
`facebook.com/salazarroofing` into `facebook.com`. A distinctive subdomain
(`salazarroofing.wixsite.com`) is still identity; only the bare apex is refused.

### One list of what counts as automated discovery

`src/domain/discoverySources.ts` owns it and builds the SQL predicate. Three separate copies
of this idea had each been wrong at some point: an exact-match list that matched none of the
miner's output, a sweep that could not rescue listings-discovered Accounts, and KPIs that
reported provider discoveries as typed in by hand. A new source is now counted, swept and
reported the day it is added.

