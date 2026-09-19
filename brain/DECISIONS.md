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
| DEC-009 | 2026-09-07 | Malformed configuration fails closed: a numeric or boolean environment value that cannot be interpreted stops the process, naming the variable and its value, rather than falling back to a default. Unset still means the documented default. | Engineering decision, proposed by implementation and open to Michael's reversal. The alternative silently removed a spend ceiling, a DNC staleness block and a webhook replay window, because `Number('$20')` is NaN and every comparison against NaN is false. See brain/CHANGELOG.md 2026-09-07. |
| DEC-010 | 2026-09-07 | One reader for each environment value. A flag is read by `flag()` and a number by `numeric()` everywhere, so the code that acts on a setting and the report that describes it cannot disagree. | Engineering decision. `OUTBOUND_DIAL_ENABLED=1` previously armed outbound dialling while the release manifest and the exposure preflight both reported it disabled. |
| DEC-011 | 2026-09-08 | A vertical profile may reference only signals the canonical registry defines. Profile validation fails on an unknown reference; a known signal whose data source we lack is reported and does not fail. | Engineering decision implementing the semantic contract. The two are different problems with different owners: a typo is fixed by editing a document, a missing source by buying one. |
| DEC-012 | 2026-09-08 | The runtime role taxonomy stays at fifteen canonical categories. Vertical-specific titles map to them explicitly in the profile, and the raw title is never rewritten. | Decision 1. The alternative was dozens of industry job titles in a check constraint; a title is not a category. |
| DEC-013 | 2026-09-08 | Vertical objection guidance supplements the generic engine: same intent means the vertical wins, unrelated generic answers survive, nothing is concatenated. | Decision 2. Two scripts for one objection is worse than either. |
| DEC-014 | 2026-09-08 | The global offer catalog is authoritative for what an offer is; a vertical profile is authoritative for relevance, positioning and priority. A vertical may specialise an offer and may not redefine it. | Decision 3. Every product entry traces to a document, because inventing an offer is forbidden outright. |
| DEC-015 | 2026-09-08 | `preferred_primary_hook_order` is the only authority for primary hook order. `hook_priorities` is the hook dimension and has one reader; hypothesis order is the author's declaration sequence. | Decision 4. The two never disagreed once base_priority was read as higher-is-more-important; the generator had been sorting it backwards. |
| DEC-016 | 2026-09-08 | A market signal and a company signal are separate claims about separate subjects, and neither may be evidence for the other. Storm activity is never a prerequisite for discovering or ranking an ordinary roofer. | Decision 5. Enforced by the contract's subject rules. |
| DEC-017 | 2026-09-08 | The hypothesis-category vocabulary is extended to hold what the profiles actually use rather than collapsing four meaningful problems into `other`. | Decision 6, migration 047, with a reconciliation for rows already collapsed. |

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

## 2026-09-07 — Operator truth and epistemics (Issue #3, items G–O)

### A diagnosis, not a dump

`npm run doctor` names which of eight layers the state looks like it broke in, and a cause is
reported before its symptoms -- a starved queue also looks like research that never ran, and
sending somebody to investigate research when no worker exists sends them to the wrong place.
Ingestion is judged per run, never database-wide. A state that explains nothing reports
healthy and says so rather than inventing a cause somebody would act on.

### Retention: the machinery, never the policy

`npm run retention:plan` ships with no periods set and **there is no code in the build that
deletes a retained row** -- not a guarded flag, no path at all. INPUT-006 is Michael's
decision. The protections are the substance: a stored score cites its evidence ids, so
pruning that evidence leaves every lineage pointing at nothing; how a claimed or suppressed
company was found answers "why did you call me"; a PENDING provider task is a search paid for
and unread.

### Coverage has no denominator, so it reports none

Nobody knows how many roofers are in a ZIP, so any percentage would be a fraction with an
invented denominator. Saturation carries its boundary in the value: saturated *for the terms
asked* is a different state from saturated for the vertical.

### A queue is finite only if its decisions stick

"Not a duplicate" is remembered against the pair, so no rule raises it again. Merging goes
through the manager gate rather than around it. Each candidate carries the case for **and
against**, because a shared phone is a strip mall as often as a duplicate.

### Contact confidence decays, and aged is not departed

`refresh_due_at` had been written on every contact and read by nothing, so a name resolved
eighteen months ago read as current and a rep asked for somebody who had left. AGED means
nobody has checked; HISTORICAL means somebody said they are gone. An aged name is still
handed over, hedged, with a fallback route -- withholding it throws away real information.
Sixty days of grace, because a warning that fires too easily is one a rep learns to ignore.

### Our own ceiling is not the market's failure

A budget refusal used to increment a market's failure count and push an exponential backoff
onto its next turn, so the markets we had refused became the least likely to be due when the
money came back. A search we declined is now re-dued in four hours with no failure recorded.
The distinction cuts both ways: a provider that genuinely could not answer still backs off.

### Measure before optimising, and measure the loop as well as the query

At 100k Accounts the duplicate sweep's cost was round trips, not SQL -- and a name-length
prefilter I added admitted 80,858 of 97,009 rows and made it slower. `npm run
scale:bench:recent` exists so the next batch of queries is measured rather than assumed.

## 2026-09-07 — The keystone find: research never recorded that it ran

`accounts.last_researched_at` was written by seeds and fixtures and **by nothing in the
product**. The research worker crawled the site, wrote evidence, scored the company, and
left no mark saying it had run.

Everything downstream asks that column: the freshness projection marks an unstamped Account
THIN; completeness keys its label on it; the fact model uses it to tell "we looked and found
nothing" from "nobody has looked"; coverage counts researched companies with it; Find
Prospects filters on the label it produces. All of them read null and answered honestly
about the wrong thing.

It explains the live box reading zero rep-ready of twenty-five with forty-eight stale scores,
which is not only old data. Research freshness is thirty days -- how long before research
should be re-run, which is a different question from how long one piece of evidence stays
current. Ad evidence expires in forty-eight hours and using that here would call every
researched company stale two days later.

**The lesson worth keeping.** Every test written in this campaign that needed a researched
Account set that column by hand, four separate times, and I treated it as fixture
convenience. A fixture that has to fake a state the product should produce is evidence the
product does not produce it. That is now the first thing to check when a fixture needs a
suspicious amount of manual setup.

It had also been hiding two unrelated things: an under-drained golden market (drainQueue
stops at fifty jobs by default, so thirty-two of eighty-one companies were never researched)
and an email test asserting on row zero of an unordered endpoint query. A column nothing
wrote was propping up two test outcomes.

### Facts come from the profile, not from a list in code

The fact model surfaced three hard-coded signals while the extractor writes six and the
profiles declare thirteen. Anything that enumerates what matters must read the vertical
profile, which is the same correction this codebase has now needed for the search taxonomy,
the signal-to-score map, the business-model fields, the negative terms, and the observation
columns.


## 2026-09-15 — DataForSEO Standard: the collector that never ran

Seven paid tasks, $0.042, all seven completed at the provider, and `poll_attempts = 0,
last_polled_at = null` on every ledger row. **No collection attempt had ever been made
in this system's history.** Proven from `provider_tasks`, `jobs` and `provider_usage`,
and against the provider's own `id_list`, `tasks_ready` and `task_get` (all free).

The 27-second fast poll was never the defect. Collection lived inside a future
`market_mine` job; those are queued only by the saved-market scheduler, which reads
`saved_markets where enabled`; ad-hoc "Research this market" creates no saved market;
production has zero saved markets. So an ad-hoc Standard search could be **paid for,
completed by the provider, and PENDING for ever**.

Observed turnarounds: 22s, 56s, 14m37s, 14m39s, 15m04s, 15m14s, 16m14s. Only the
22-second one — `roofing contractor 32095` — landed inside the fast path, and job
`399fb73a` records it: *113 row(s) read, 65 business(es) identified*. **That single task
produced 65 of the 66 legacy Roofing Accounts.** The other four roofing searches plus
`drain cleaning 32095` are exactly the five rows later quarantined as
`SUPERSEDED_BY_P0_MINER_REMEDIATION`.

### Decisions taken (approved 2026-09-15)

1. **Spend is recorded at `task_post`, once.** It was recorded only when a *collection*
   succeeded, so seven purchases appeared as one $0.006 row — and the daily ceiling reads
   that table, so it was metering about a seventh of real spend. `task_get` is free; the
   cost it echoes back is the same historical charge, verified against the account
   balance, which does not move across a retrieval.
2. **Every accepted task goes on the ledger immediately.** Writing the row only when the
   poll gave up meant a fast search was bought, charged and never recorded at all, and
   made `submitted_at` ~30s late on every row that did exist.
3. **Abandonment is keyed to retrievability, not effort.** `40602` means the provider is
   working. A poll count tuned for a three-second loop would abandon a healthy task
   within an hour of a three-minute sweep. Terminal now means the result can no longer be
   fetched (`PROVIDER_TASK_RETENTION_DAYS`, 30) or a terminal provider status.
   `PROVIDER_TASK_MAX_POLLS` decides nothing and is kept only because the manifest prints it.
4. **`advertiser_first` is unchanged in this branch.** All seven SERPs returned **zero
   paid items and zero provider-supplied addresses**. That is real provider evidence: *no
   ad was observed in this SERP* — not "this business does not advertise", and not "the
   search failed". It also means the old address contamination did **not** come from
   DataForSEO address fields. Query-strategy redesign is a separate issue.

### The lesson worth keeping

A recovery path must not depend on a *product* concept — a saved market — to rescue a
*financial* one. The money was spent whether or not anybody saved the market afterwards,
so the ledger, and only the ledger, decides what is still owed.

---

## V1 shipped to production (2026-09-17)

`sales.youraidepartment.ai` moved from `d856bce` to **`3e4a282`** (tree `ba98139`) by
fast-forward on `feature/outbound-sales-brain`. Restart window 2.7 seconds; worker
restarted before the API. Backup taken first:
`~/yad-sales-backups/yad_sales_20260917T033912Z.sql.gz`.

### Release naming

"Release 1 / Release 2 / Release 3" is retired. From here there is **V1** (the
rep-ready release now live) and **V2** (the next phase). The numbers had been reused
for a provider hotfix, a rep-readiness branch and a combined tree, and no longer said
what was being shipped.

Collapsing the two planned releases into one V1 also removed the deployment problem
the earlier plan was built around. The old sequence deployed the provider hotfix
`32abae6` first, and because that commit had been cherry-picked into the rep branch, a
second `--ff-only` to `3e4a282` would have been refused — the plan called for a merge
commit to repair the ancestry. Deploying `3e4a282` directly made that unnecessary:
`d856bce` is already its ancestor, so one fast-forward shipped everything. The reverse
qualification of the intermediate tree `c4234dc` was abandoned for the same reason —
that tree was never going to be deployed.

### How V1 was qualified

Against the exact tree `ba98139`, worktree clean, provenance recorded at each launch:

| Gate | Result |
|---|---|
| Forward full suite | 2171 / 2171, exit 0 |
| Reverse / isolation full suite | 2171 / 2171, exit 0 |
| Targeted gate, 32 files run one process each | 396 tests, 0 failures, every file exit 0 |
| `npm run check` | PASS |
| `npm run build` | PASS |
| `npm audit --omit=dev` | 0 vulnerabilities |

The targeted gate runs one process per file on purpose. The full-suite TAP is flat —
it carries test titles, not file names — so a single combined run cannot prove which
file a given assertion came from. Per-file runs make each required area attributable
and give each its own natural exit code.

Isolated ephemeral Postgres only: throwaway `postgres:16-alpine` on a private Docker
network, no published port, generated credentials, `DATAFORSEO_ENABLED=false`, no
provider credentials, outbound/Twilio/Smartlead unset. Forward, targeted and reverse
ran strictly sequentially — a previous session lost an entire "authoritative" run to
`deadlock detected` when two suites shared a database name.

### What the deploy cost

Nothing. `task_post` unchanged at 42, provider spend unchanged at $0.2580, Accounts
unchanged at 320, `saved_markets` still 0, jobs unchanged at 412 SUCCEEDED with none
queued or running, schema unchanged at 52 migrations / 78 tables. Deliberately no
historical remediation: `upsertAccount` uses `coalesce(existing, new)` for the vertical
and does not update `canonical_name` at all, so V1 cannot rewrite the 320 existing
Accounts. It changes only what new discovery creates.

### Validated against the deployed build, read-only

`PROVIDER_COLLECTION_PRIORITY` 30 / `contact_research` 40 / `account_research` 50 /
ordinary `market_mine` 80, with no `.env` override so the code default applies.
"Orlando, FL", "Miami, FL", "St. Augustine, FL" and "Fort Worth, TX" all normalize and
reach a paid-search preview; bare "Orlando" is refused with *"Which Orlando? Add the
state"*. The Orlando preview resolves to `locationName: "Orlando,Florida,United
States"` and is marked `BUY_NEW` / `chargeable: true` — built but never confirmed, so
nothing was bought. Markets renders 44 available-inventory cards with 0 saved markets.
Department mailboxes (`donations@`, `investor_relations@`, `credit_department@`,
`customer_care@`, `trucksales@`) classify as `ROLE_EMAIL`; a person-shaped address is
`UNKNOWN_EMAIL_TYPE` without attribution and `DIRECT_PERSON_EMAIL` only with it.
Company search finds an Account by canonical name, lowercased name, domain,
digits-only phone, formatted phone and email. SALES_REP holds exactly the eight rep
permissions and none of `request_market_refresh`, `manage_users`, `configure_markets`,
`run_imports`, `remove_dnc`, `assign_accounts`, `export_inventory`. Cameron was never
impersonated; permissions were read server-side.

### Two findings recorded rather than fixed

**Punctuation search looked like a 34/40 pass and is actually 34/34.** The six names
whose punctuation-stripped variant did not match are not findable by their *exact*
names either — a `todayshomeowner.com` listicle, a `local.yahoo.com` page, a news
article about a veteran, and SEO-title names. They sit outside the rep-searchable
inventory. V1 did not cause this: its diff removed only the old text-match block and
added broader matching, changing no filter clause. These rows are V2 remediation
candidates (class C and D).

**A provider business listing establishes the trade without consulting the category.**
`discoveryVerticalRelevance` returns SUPPORTED on `providerListing === true` before it
reads `resultType`, and the miner passes `providerCategory: null` at its only call
site, so the category never participates in production. V1 stops the measured failure
— an organic result at position 51 becoming an HVAC prospect — and stops a paid ad
alone establishing a trade. It does not stop a business listing categorised as another
trade. The tests pin the organic case (`verticalRelevance.test.ts:97`); the listing
case is an intentional, documented boundary. Roughly 51 existing Accounts took their
vertical from `local_result`. Carry into V2.

---

## SB-V2-1 — what the existing inventory actually contains (2026-09-17)

Read-only preview over all 320 production Accounts, run by
`npm run remediation:preview`. Nothing was written. The tool re-runs **today's** rules
over the **original** evidence rather than reading the stored value, because the stored
value is the thing under suspicion.

### Human activity, reverified

**0 Accounts have human sales activity.** All 320 are `system_activity_only`: 320
`DISCOVERED` and 320 `CONTACT_ENRICHED` rows, every one with `actor_user_id` null, no
notes and no disposition. `ownership_events`, `follow_ups`, `opportunities`,
`contact_attempts`, `meeting_bookings`, `suppressions` and `duplicate_reviews` are all
empty, every Account is UNCLAIMED with no owner, and the 15 `audit_log` rows are logins
and integration settings. Remediation is therefore as safe as it will ever be.

**The trap worth writing down:** `accounts.manual_score` and `accounts.manual_tier` are
set on all 320 Accounts, and they are *not* human input. `src/scoring/score.ts` writes
them — the column names are older than the automated scorer that now fills them. Reading
them as a human signal would mark the entire estate untouchable and stop remediation
before it began. `HumanActivityEvidence` deliberately has no field for them.

### Findings

| Class | Accounts | Rows | What it is |
|---|---|---|---|
| A | 43 | | valid company, trade supported by a provider listing |
| B | 227 | | trade asserted from the question the search asked, not from the business |
| C | 189 | | display name is page copy, not a company name |
| D | 32 | | not a company: listicle, article, category or directory page |
| E | 66 | | legacy unverified; entity resolution never ran |
| F | 37 | 98 | endpoint role predates the rule that now governs it |
| G | 94 | | research state claims more than the run behind it supports |
| H | 196 | | at least one finding rests on a single signal |

199 Accounts need human review; 78 have a mechanical proposed action. By primary
(worst) class: B 162, E 47, A 43, D 32, G 22, C 8, F 6.

Three of these reconcile exactly with independently known facts, which is the check that
the classifier is measuring and not inventing: E = 66 is the known 66 legacy Roofing
Accounts; G = 94 is the 94 `research_runs` with status `partial`; F = 98 rows is every
`DIRECT_PERSON_EMAIL` endpoint in the database — **all 98**, because not one email
endpoint is linked to a contact, so not one has a person attributed.

### Two facts that change later work

**No `search_observation` has ever carried a provider `category`.** All 582 observation
rows have `category` null. SB-V2-7 cannot be fixed by "use the category when it is
available" against historical data, because it never is; the category has to start being
captured before it can be consulted, and every historical vertical decision has to be
settled some other way.

**226 of 320 Accounts have organic-only evidence.** 93 have a `local_result` listing and
1 has no observation at all. That is the shape of class B: the trade on two thirds of the
inventory came from the question, and under today's rules nothing we hold supports it.

### Rules the preview follows

A proposed name may only ever **trim** the name on the row, never introduce a new one:
the alternative must already be contained in the displayed name once punctuation is
ignored. This exists because the resolver's stored names are not reliably better —
production holds an Account displayed as "Orlando HVAC Services" whose candidate name is
"HVAC Service Areas Near Orlando, FL", and one in Winter Park whose candidate names
Tampa. Replacing a bad name with a wrong one is worse than leaving it: a rep can see that
a name reads like a page title and cannot see that it belongs to a different company. A
test caught this against the real "Comfort Pro" row before the rule was tightened.

Nothing with human sales activity is ever proposed for a mechanical change, whatever the
evidence says. Non-companies are proposed for suppression and quarantine, never deletion.
`--apply` is refused explicitly and exits before it opens a database connection.

---

## SB-V2-2 — the Mining page reads a ledger, not a job's memory (2026-09-17)

The page was a list of `jobs` rows. A job row is a snapshot of what one worker believed
at the moment it stopped, and a market search is bought from an asynchronous provider:
the run that buys it ends minutes before the answer exists, records `PROVIDER_PENDING`,
and never speaks again. A different run collects the answer and writes its own row.

Production, at the time of this work: **92 `market_mine` job rows for 49 paid searches**,
**40** of them still saying *Provider still working* about searches DataForSEO finished
days earlier whose businesses are already in inventory. Every `provider_tasks` row is
`COLLECTED` (44) or `ABANDONED` (5); not one is pending.

### What is now authoritative for what

**`provider_tasks` is the only thing asked what the provider did.** Provider state and
Sales Brain state are separate columns, because "the provider has not answered" and "we
have not collected the answer" are different problems with different owners. The second
had no way of being seen at all before: a paid, answered, uncollected search was
indistinguishable from one the provider was still running.

**The unit of the Market Discovery table is one paid search, not one job.** Several job
rows about the same search collapse into the row that describes it, and the numbers come
from the run that heard the answer rather than from the run that gave up waiting. On
production data the page goes from 92 rows to 54: 45 ingested, 5 abandoned, 4 never
searched.

**The counts above the tabs are tallied from the same rows the table lists.** They were
first derived separately — the counts in SQL over `provider_tasks`, the rows in
TypeScript over searches — and they disagreed on production by exactly the one search
made in live mode, which therefore never created a task row. A count an operator cannot
reconcile with the table under it is worse than no count, so there is one classification
and `summarizeMiningView` counts its output.

### `providerAnswered` has one definition, in `src/miner/discoveryStatus.ts`

The page first read "any status that is not PENDING" as "the provider answered". On
production that turned two runs our *own* daily ceiling had refused — `BUDGET_EXHAUSTED`,
nothing bought, no task — into searches whose results had been ingested. The miner's
rule (`OK` or `ZERO_RESULTS`) now lives in its own module that both the worker and the
web process import; importing the miner itself would register the job handlers inside
the API process, which is why the rule was copied in the first place.

Separately, the entry a row takes its numbers from is a wider question than whether the
provider answered — `MALFORMED` is an answer we could not read, and the run that received
it is still the run that knows what happened. The two questions have two functions.

### Website research aggregates before it enumerates

A hundred rows each saying "Researching website" is not something an operator can act
on. Six counts drill down into one list. The counts come from `research_runs`, not from
job outcomes: production holds **320 `account_research` jobs that all report COMPLETED**
over **226 runs that read a site, 59 that were refused a page, and 35 that read nothing
and were refused nothing**. A finished job is not a site that was read.

### A dash is not a zero, and a stale sentence is still a stale sentence

A search nobody bought reports `—` for provider rows, resolved businesses and new
businesses, never `0`: zero is a measurement of a market and nobody measured it. And the
explanation under a row is taken from the run that answered, because falling back to the
submitting run's words put *"the provider accepted the search and its results are not
ready yet"* under a row whose results were ingested an hour later — the same lie in
smaller type.

### Test runs no longer inherit the operator's spending ceiling

`src/config.ts` loads the whole `.env` into the process, so a box with
`DISCOVERY_DAILY_BUDGET_USD=0.30` set for production gave the suite a real ceiling: the
sixth market mined inside one test exhausted it, and a test asserting how a *provider*
refusal is reported read `DISCOVERY_BLOCKED` — our own refusal — instead. The same suite
passed on a box with no ceiling configured. `tests/setup.ts` now pins it to 0 unless a
test sets its own, which is how the spend-control tests already work.

---

## SB-V2-3 — a physical address is something a company published (2026-09-17)

Three claims are now kept apart in the data model, and none may be derived from
another:

| | what it means | where it lives |
|---|---|---|
| PHYSICAL LOCATION | a street address the company puts on its own site | `locations`, type `physical`, with a basis and a source URL |
| MAILING ADDRESS | a PO box or mail drop | `locations`, type `mailing` |
| SERVICE AREA | where the company says it will travel | `evidence_records`, claim key `service_area` |
| DISCOVERY GEOGRAPHY | the ZIP or city we typed into a provider | never a location |

### What production actually holds

**66 `locations` rows, one per legacy Roofing Account, every one carrying ZIP 32095** —
the ZIP the canary searched. No street, no source, nothing any company ever said, and
typed `service_area`, which reads as a claim the business made. V1 stopped writing them;
they are still there. The remediation preview now reports them as
`LOCATION_WITHOUT_PROVENANCE` — 66 accounts, matching the known 66 exactly, which is the
same reconciliation check the other classes pass.

They are deliberately **not** relabelled or deleted: that is a production data rewrite
and mass remediation is not authorised. A null basis is the honest description of a row
whose provenance was never recorded.

### The rules the extractor follows

A street address needs a number, a street name with a recognised suffix, a city, a state
and a ZIP. Each is load-bearing: without the ZIP the matcher eats "Serving Winter Park,
FL"; without the suffix it eats phone numbers and dates; without the number it eats the
name of a road in a sentence about driving down it.

A schema.org address of a locality and a region **with no street is refused**. "Orlando,
FL" is a place name, and a place name is exactly what the 66 rows are. Accepting it would
rebuild them out of structured data instead of a ZIP.

Service-area wording in the 90 characters before a candidate disqualifies it, because the
sentence a place name sits in is what says whether the company is *in* it: "Proudly
serving Winter Park, FL 32789" is a service area with a ZIP in it.

`areaServed` is read rather than ignored. The two claims sit next to each other in the
same JSON-LD node, and the way they get confused is one of them being invisible.

A `Person` node's address is not the company's address — the Sunbright fixture's whole
point, one step earlier than the relationship graph.

### Enforced below the code

Migration 053 adds `basis`, `source_reference`, `first_observed_at` and
`last_verified_at` to `locations`, and a `not valid` check constraint: a row typed
`physical` must have a street. `not valid` governs every future write without rewriting
the history it inherits; validating it belongs with the remediation authorisation, not
with the migration.

`recordEvidence` can finally write `evidence_records.location_id`. The column has existed
since migration 003 and nothing could set it, so a location's evidence floated free of
the location it was about.

### What the rep is shown

"Where they are" on the Account page now reads in order of what the claim is worth: the
address the company publishes (with the URL it was read from and the date), then a
mailing address labelled as a mail drop and not a place of business, then where the
company *says it serves* — labelled as travel — then the line a provider printed, then
last the discovery geography with its existing "where we looked, not where they are".

Four claims about place, four different sentences. The rep can see which is which, which
is the whole point: the 66 legacy rows are indistinguishable from a real address until
somebody says where each one came from.

### The preview keeps running against production

`basis` arrives with migration 053, and production runs 52. The remediation preview asks
`information_schema` whether the column exists and treats its absence as "no row can
account for itself", which is the answer the column would give anyway. A read-only tool
whose whole purpose is asking production what it contains cannot require the schema of
the branch asking.

---

## SB-V2-4 — the official-source relationship graph (2026-09-17)

### What was reused, and what was left behind

`feature/sales-brain-rep-enrichment` already holds a source framework that was built and
qualified against sanitized fixtures of the real registry pages. Four files came across
**unchanged**, each carrying a note saying where it came from:

- `src/sources/types.ts` — the six-outcome `MatchStatus`. Worth taking whole because
  "the state does not license this trade" and "we searched and found nothing" both
  produce no licence and mean opposite things to a rep.
- `src/sources/match.ts` — "no identity on a name alone", which is the V2 invariant
  already written down, implemented and tested.
- `src/sources/adapters/flDbpr.ts`, `flSunbiz.ts` — the parsing and mapping halves.

Left behind deliberately: the Texas adapters (no Texas market exists), the snapshot
lifecycle, the governance runner and the live lookup paths. Stage B and Stage C stay
disabled and **nothing ported makes a network request**.

**A numbering hazard found on the way:** that branch also has a migration numbered 053
(`053_official_source_snapshots.sql`) and V2's is `053_location_provenance.sql`. The
filenames differ so both can apply, but anybody porting the snapshot work later must
renumber it. The shared test database had the other branch's table left in it, which is
what made `migrationHistory` report schema drift until the database was recreated.

### What did not exist anywhere, and is new

**A company-to-company relationship.** The schema could say two rows are the same company
(`account_merges`) and could say nothing about two companies that are genuinely separate
and share a person, an address, a licence or a phone. That is precisely the design case:

> A Florida HVAC company holds a certified air-conditioning licence; the public record
> names the person who qualifies it. A public contractor profile lists that same person,
> at that same address, for a second company, with a phone number.

Four wrong conclusions are available from those facts, and `account_relationships` exists
to make all four unavailable:

| tempting conclusion | what is recorded instead |
|---|---|
| the two companies are one | two Accounts, one `RELATED_BUSINESS` row between them |
| the qualifier owns either | `QUALIFIER`, with "a regulatory role, not evidence of ownership" |
| the other company's phone reaches this one | `RELATED_BUSINESS_PHONE` and "verify it is current" |
| a shared address links them | refused: one signal is a building with many tenants |

**Two signals minimum, enforced in the database.** `basis` names what agreed, joined by
`+`, and a check constraint requires the separator — so a row that cannot say what agreed
cannot be written, whatever the caller believes. A shared licence number or a shared legal
entity identifies one entity and stands alone; a shared address or a shared person's name
never does.

**Person roles extended rather than collapsed.** `founder`, `authorized_member`,
`responsible_master_licensee`, `license_holder` and `related_business_contact` join the
existing eight. An authorised member of an LLC, a founder and a responsible master
licensee are three different claims, and folding them into `officer` loses exactly the
distinction a rep needs when deciding who to ask for.

**`ownershipEstablished` is one function with one list.** QUALIFIER, LICENSE_HOLDER,
REGISTERED_AGENT, OFFICER and MEMBER never establish ownership. The list lives beside the
rule rather than at the call sites, because the call sites are where it gets forgotten: a
qualifier on a licence and an agent on a filing both read like "the person in charge" to
anybody who has not been told otherwise.

---

## SB-V2-5 and SB-V2-6 — Stage D priced, and the free stages measured (2026-09-17)

### Stage D ships planned, priced and disabled

`npm run stage-d:preview` says what would be asked and what it would cost. There is no
executor: `--run` is refused explicitly rather than being an unrecognised flag, and
`stageDRunnable()` returns false twice over — once because the flag is off, and once
because turning the flag on still finds nothing to run.

A query is built only from facts already established: a person's name from first-party
or official evidence, a street and city from what the company published, never from the
geography we searched. A query built from where we looked returns results about where we
looked. The budget is 3 decision-maker queries plus 2 contact queries, 5 absolute, and
the plan stops early rather than filling the ceiling.

**The price comes from the ledger, not from a constant.** `provider_tasks.cost_usd`
holds the highest price actually charged across production's 44 collected tasks:
$0.0060. The worst observed price is used rather than the average, because an estimate
that is right on the cheap day and wrong on the expensive one is the wrong way round for
a spending decision.

### What running the preview against production found

The first plan it produced was:

> `"HVAC Tune-Up in Saint Petersburg, FL 33703 - AGNI" owner OR president OR "general manager"`

Nobody calls the company that. It is a page title this system stored as a name, and
**189 of the 320 Accounts carry a name of that shape**. Paying to search for our own bad
data is the one expense with no possible upside, so the planner now refuses it, reading
the rule from the remediation classifier rather than restating it. The effect on a
100-Account batch:

| | before the gate | after |
|---|---|---|
| queries planned | 275 | 123 |
| accounts needing nothing | 3 | 57 (56 of them blocked by their name) |
| estimated cost per 100 | $1.65 | $0.74 |

That ties SB-V2-1b directly to the value of Stage D: **more than half the inventory
cannot be usefully searched until its names are fixed.**

### What the free stages have actually produced (SB-V2-6)

`npm run contact:yield`, measured over all 320 production Accounts:

| measure | value |
|---|---|
| research runs | 320, of which 226 read the site and 94 read nothing |
| pages read per run | 3.43; median run 18.4s |
| named decision maker | **21% (67 of 320)** |
| a role standing in for a person | 79% (253 of 320) |
| accounts with a named email | **0% (0 of 320)** |
| accounts with a direct phone route | **0% (0 of 320)** |
| phone endpoints | 404, every one of them a main business line |

The email figure is the one worth reading twice. 98 endpoints carry the role
`DIRECT_PERSON_EMAIL` and **not one is linked to a contact**, so not one has a person
attributed: the role was assigned from the shape of the mailbox before the rule that now
governs it existed. The report counts a named email as one attributed to a person and
prints the difference rather than hiding it.

Stages B and C are reported as `NOT_RUN`, never as nothing found. Nothing has been asked
of them, and that is not the same as their having nothing to say.

### What this does not decide

It does not say a paid contact provider is unnecessary and it does not say one is
needed, and the report says so in its own last paragraph. The measured order of work it
does suggest: fix the names, then run the free official sources, then price Stage D
again against inventory that a search can actually help.

**No paid batch has been run. Stage-D spend still needs Michael's authorisation.**

---

## SB-V2-7 — the provider's category is captured, and it outranks the listing (2026-09-17)

The V1 residual, stated exactly: `discoveryVerticalRelevance` returned SUPPORTED on
`providerListing === true` before anything read the result type or the category, and the
miner passed `providerCategory: null` as a literal. So a business the provider had
classified as one trade, returned in the local pack for another trade's query, inherited
the trade of the question.

The reason the obvious fix — "consult the category when it is available" — was not a fix:
**no `search_observation` in production has ever carried a category.** All 582 rows are
null, because the adapter never read `item.category` from the response and the miner
never wrote the column. A rule that consults a field nothing populates has never run.

### What changed

**The category is captured.** `item.category` is read from local pack items, carried
through the observation, the resolver candidate and into the call site, and written to
`search_observations.category` — a column that has existed since migration 003 with
nothing ever writing it.

**A category settles the question both ways.** One that agrees supports the trade. One
that disagrees refuses it, *whatever the listing says*. That is the half that did not
exist: the listing proves a business exists, and the category is the only thing either
of them says about which trade it is in.

**A listing with no category still supports the trade.** This was measured rather than
assumed. Of 93 production Accounts found through a business listing, 21 do not contain
any word from their trade's discovery queries — and reading them shows "Mills Air Inc",
"English Air Inc.", "Air Masters of Tampa Bay", "I Know A Guy AC": real HVAC companies
whose names use the trade's vocabulary rather than its search queries. Demoting a
category-less listing would have thrown those away to fix a problem they do not have.

### A profile's own vocabulary, read at last

`service_aliases` has been declared by every vertical profile since they were written and
**nothing has ever read it** — the same shape as `negative_terms` before SB-QA3 wired it
up. It matters here because Google's real HVAC categories are "Furnace repair service",
"Heating contractor", "Air conditioning repair service", and none of those match an HVAC
discovery query. Without the aliases the new category check would have been right to fire
and wrong about the answer, rejecting real HVAC companies on the strength of their own
category. `serviceAliasesFor()` now reads it, and both the miner and the remediation
preview pass it.

### What did not change

The remediation preview reports exactly the same counts on production as before —
227 / 196 / 189 / 94 / 66 / 66 / 43 / 37 / 32 — because every historical observation's
category is null. The new rule can only act where a category exists, which is the correct
blast radius for it.

---

## 2026-09-17 — Overnight authorization: deploy V2, re-research the estate, clean it

Given by Michael before going offline. The full text, including the limits, is in
`brain/releases/V2-OVERNIGHT-RELEASE-20260917.md`; this is the decision-log entry that
must not be casually reversed.

| ID | Decision |
|---|---|
| DEC-018 | V2 may be deployed to production once its qualification gates pass: targeted suites, `check`, `build`, `audit`, full forward, full reverse, all at zero failures against one frozen tree. |
| DEC-019 | The entire historical Account estate is authorized for re-research under V2 rules once V2 is live, using implemented research paths that incur no new paid spend. |
| DEC-020 | High-confidence historical remediation is authorized, and "high-confidence" is a conjunction, not a mood: no human sales activity on the Account, decisive evidence, retained provenance, an auditable action, and a reversible or non-destructive one where possible. Anything short of all five goes to review. |
| DEC-021 | Paid Stage-D searches are not authorized. Stage D stays disabled, Stage-D `task_post` stays 0 and Stage-D spend stays $0.00 until Michael says otherwise in person. |
| DEC-022 | **Agent-generated documentation cannot authorize provider spend.** A sentence written by an agent recommending a paid batch is a recommendation. Where durable documentation could be skim-read as a grant, it is reworded. |
| DEC-023 | V2 owns production migration 053, because it is the next migration after the 52 production runs. The undeployed enrichment branch's own 053 must be renumbered before any future port; the release is not contorted to preserve a number on a branch nobody runs. |

### The semantics this remediation may not regress

Recorded here because a cleanup is exactly the moment they get traded away for a tidier
looking database: search geography is not a physical location; a search vertical is not a
business vertical; a SERP title is not a company name; a paid ad headline is not a company
name; a business listing is not automatic proof of the searched trade; a company-domain
email is not a named person; a licence qualifier, a registered agent and an officer are
not owners without evidence that says so; a related business's phone is not a current
direct phone; a search result is not a verified fact; an observed ad is not a timeless
advertiser state and no ad observed is not "does not advertise"; a service area and a
mailing address are not physical locations.

**Raw evidence survives remediation.** Suppression, rejection and reclassification are the
instruments; deleting the observation that produced a record is not.

## 2026-09-18 — FIT refresh and global inventory browsing

| ID | Decision |
|---|---|
| DEC-028 | FIT remains the Module 4C v3 score, separate from Apollo contact-quality tiers. Its eleven documented rules total at most 18 points: Google paid +4, Meta +3, multi-channel +1, high-value economics +2, operational lead volume +2, emergency/after-hours +1, appointment/estimate/consultation +1, multiple locations/service territories +1, visible growth/hiring +1, strong phone dependence +1, and prominent forms/booking/quote CTA +1. Tiers are A 9+, B 6–8, C 3–5, D 0–2. Contact names/emails never contribute points. |
| DEC-029 | FIT refresh is read-only preview/apply through the existing recognizer and scorer. The worker sweep recomputes current-policy scores whose scoring evidence is newer or expired, while ignoring contact-only evidence; it is bounded, idempotent, and does not create provider work. |
| DEC-030 | `/find` treats blank industry, location, and saved market as unrestricted inventory browsing. It always reads the existing active researched inventory with the existing server-side pagination and deterministic score/contact/research ordering; it never starts discovery or provider work. |

---

## 2026-09-17 — A fetch failure is not a broken website (DEC-024 … DEC-027)

Michael opened three Accounts that Research Health was labelling **Broken Website** and
found three live HVAC businesses. The label was one defect; three more were behind it.

| ID | Decision |
|---|---|
| DEC-024 | **Sales Brain failing to read a website is a fact about Sales Brain.** TLS errors, DNS errors, timeouts, refused connections, WAF and bot blocks, HTTP errors, protocol mismatches and robots disallows are all source-access states. None of them is evidence that a website is broken, that a company is junk, that a trade is unsupported, or that a record should be suppressed. A true dead-site state requires strong, repeated, terminal evidence, and nothing in the product asserts one today. |
| DEC-025 | **A research run records what happened to the source.** `source_state` — READ, REFUSED, UNREACHABLE, HTTP_ERROR, DISALLOWED, NO_WEBSITE — plus the per-page reasons behind it. "Zero pages fetched" alone is not a diagnosis, and for the 94 production runs that carry only that number, the honest reading is "we do not know why", which behaves like a refusal and never like an empty site. |
| DEC-026 | **The remediation hard guard.** An Account whose site could not be read is exempt from every negative instrument: no suppression, no trade removal, no name replacement, no legacy rejection, no endpoint reclassification. It goes to review instead. The guard sits before the instruments rather than inside each one, so an instrument added later inherits it. An Account with no website at all is not shielded — nothing failed there. |
| DEC-027 | **We do not get around a wall.** 401 is a login wall, 403 is a refusal, 429 and challenge pages are bot protection, and a meta refresh to a challenge path is a challenge whatever status it carries. All of them stop the crawl. TLS validation is not weakened and no protection is bypassed to make a state disappear. |

### What the audit actually found

- **energyair.com** answers **HTTP 200 with 634 KB** of its own content, titled *"Energy Air
  - Trusted HVAC & Commercial AC Services in Florida"*. The crawler discarded it because
  the word `captcha` appears at byte 3634 — inside a **script manifest** listing the
  modules a site platform loads. Any site whose bundler ships a captcha module was being
  thrown away and reported as broken.
- **airmotionshvac.com** and **airworthac.com** answer **403**, which the fetcher called
  `login_required`. A WAF refusing a crawler is not a login wall.
- **airworthac.com** is also host-asymmetric: the apex answers 403 while `www` answers
  **202 Accepted** with 167 bytes — a meta refresh to `/.well-known/sgcaptcha/`. Status
  said yes and there was no site in it, so a naive fix would have recorded a successful
  read of nothing. That is now detected on its shape, not on the vendor's name.

### Deliberately not done

A `www`/apex fallback in the crawler would help sites that only serve `www`. It would not
have helped the case that motivated it — both Air Worth hosts challenge — and new crawl
behaviour that cannot be qualified against the real estate tonight is not worth shipping
in a release. Recorded as follow-up rather than added at four in the morning.
