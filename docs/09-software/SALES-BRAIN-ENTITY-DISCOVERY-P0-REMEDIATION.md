# Sales Brain P0 — entity discovery and search planning remediation

**Baseline:** `8245bd9791f957cc56ea4533177363a1f13215a5` on `feature/outbound-sales-brain`
**Worktree:** `/home/roothecks/YAD-Sales-Brain-p0-entity-resolution`
**Branch:** `fix/sales-brain-p0-entity-resolution`
**Status:** implemented — no production change, no provider traffic, nothing deployed

This document describes what the code does. Where the first draft described an
intention that the implementation did not meet, the review said so and the
implementation changed; those places are marked **(review)** and say what was wrong.
It is an architecture contract, not an aspiration: if the code and this document
disagree, one of them is a defect.

Two architecture failures, both proven against the first real production canary
(`399fb73a-0a8e-4bac-b8a3-6c3831401f23`, Roofing / 32095, 5 paid tasks, ~$0.03).

---

## 1. Original failure path — entity resolution

```
provider row
  └─ dataForSeoAdapter.resultFromResponse()
       CANDIDATE_TYPES includes 'ORGANIC'
       filter: observedDomain OR (observedName AND observedPhone)
  └─ dedupeCandidates()  identity = observedDomain ?? observedPhone
  └─ marketMiner.isUsableBusiness()   name.length >= 2 AND (domain OR phone)
  └─ upsertAccount()                  ← an Account now exists
  └─ enqueueAccountResearch()         ← it is now researched as a prospect
```

Every gate was a *shape* test. None asked whether the row referred to an operating
business. A Yelp search page has a domain and a title, so it was a business. A
News4Jax article has a domain and a title, so it was a business.

Measured on the canary: 65 Accounts from **one** search, of which 19 (29%) are not
companies at all (8 with no domain, 11 third-party publishers/directories), and
**65 of 65** were named by their SERP result title rather than a business name —
including `500` (an HTTP error page on `southeasternroofers.com`) and
`An 82-year-old Vietnam veteran in St. Augustine says he's ...` (a news article).

`search_observations` was written *inside* the promotion loop, after `upsertAccount`.
A row that was rejected left **no provenance at all**.

### Cross-entity contamination

`Precision Roofing of North Florida Inc` was discovered via `freeroofquote.com`, a
lead-generation directory. Research then crawled that directory as the contractor's
official site and attributed its phone number, financing copy and quote form to the
contractor. The research pipeline worked correctly — on the wrong entity.

## 2. Original failure path — query planner

`searchTaxonomy.ts` flattened `high_intent_queries` and `core_queries` into one list
and applied a single one-dimensional sort, then `slice(0, budget)`. For Plumbing every
core term is `intent_weight: 4` and every high-intent term is `5`, so the entire core
group sorted behind the entire service group and `drain cleaning` won the intent-5 tie
**alphabetically**. With `query_budget` 1 the market was defined by one narrow service
query. Four further groups (`urgent_queries`, `high_ticket_queries`,
`financing_queries`, `commercial_queries`) were never read at all.

---

## 3. Data flow as built

```
provider row
  → ProviderObservation             normalized by the adapter; the adapter stops here
  → resolveObservations()           the orchestrator, once, for every provider
  → EntityCandidate                 one per resolved identity per run
  → promotion decision              VERIFIED | NEEDS_REVIEW | REJECTED
      REJECTED     → observation + candidate kept, no Account, no research
      NEEDS_REVIEW → observation + candidate kept, no Account, no research
      VERIFIED     → Account → account research → scoring → readiness
```

Every observation and every candidate is persisted **whether or not anything is
promoted**. An observation is discovery evidence. It is never an Account.

### 3a. Resolution is not optional **(review)**

The first implementation put `resolveCandidates()` inside the DataForSEO adapter and
left `businesses` on `DiscoveryResult`. That made the promotion rules that adapter's
private policy: any other adapter — a second provider, a fixture, the benchmark
harness — could hand finished companies to `ingestDiscoveries` and skip every check,
silently. A rule an implementer can decline is not a rule.

`DiscoveryResult` now carries `observations` and has no field on which a finished
company could arrive. `src/discovery/observation.ts` owns `ProviderObservation`,
`DiscoveredBusiness` and `resolveObservations()`; `marketMiner` calls it once per
provider answer; `benchmark.ts` calls it too, so yield is measured after promotion
rather than before. `dedupeCandidates()`, the old unresolved path, is deleted.

The row counters (`providerRows`, `rejectedRows`, `duplicateRows`) are derived by the
orchestrator from the observations. An adapter can no longer assert a row count for
rows nobody can see.

### 3b. Nothing is dropped **(review)**

Persistence used to sit inside `if (result.businesses.length > 0)`. The run that most
needed explaining — eleven directories and no companies — recorded nothing at all.

`ingestDiscoveries` now writes one `search_observations` row per provider row, with
`account_id` null, *before* anything is promoted, and links the rows to an Account
afterwards if one is created. A run that promotes nothing still leaves: the exact
search recorded as executed, the rows, the candidates, and a reason for each refusal.

`resolveCandidates()` has no path that returns without a candidate for an identity.
An observation that produces no candidate is an observation an operator cannot see,
cannot review and cannot correct — and the search was still paid for.

## 4. Source classification (deterministic, no LLM)

`SourceClass` is derived from result type + domain + URL path + title:

| Class | May create a candidate | Example signal |
| --- | --- | --- |
| `BUSINESS_LISTING` | yes, strong | MAPS_LOCAL / LSA carrying name + phone or **observed** address |
| `OFFICIAL_SITE` | yes, needs corroboration | organic/paid root-domain page whose identity matches |
| `DIRECTORY` | no | `/biz/`, `/profile/`, many businesses on one domain |
| `MARKETPLACE` | no | lead-gen quote forms, "get matched" |
| `PUBLISHER` | no | `/news/`, article schema, author byline |
| `LISTICLE` | no | title `Best N…`, `Top N…`, `… near me` |
| `SOCIAL` / `VIDEO` / `FORUM` | no | `/watch`, `/posts/`, question-shaped title |
| `MANUFACTURER_LOCATOR` | no | "find a contractor", manufacturer root domain |
| `UNKNOWN` | quarantine only | nothing matched |

**Corroboration must be distinctive, and must come from somewhere else (review).**
Two false-positive paths survived the first pass:

- `brandMatchesDomain` accepted any token of four characters or more, so the *trade*
  name did the work: "ABC Plumbing LLC" matched `bestplumbingquotes.com` because both
  contain "plumbing", and a lead-generation domain passed as a company's own site.
  Only a *distinctive* word counts now. Generic business vocabulary is a static list
  ("services", "group", "experts", "quotes"); the trade words are not, because there
  are thirteen verticals and there will be more -- they are derived from the vertical's
  own search taxonomy, together with the geography being searched, so a new trade is
  generic on the day its profile is written.
- "two independent results agree" looked only at rows for the same domain, so an
  unknown directory listing one contractor on a profile page and a category page
  corroborated itself. Agreement among pages of one site is that site repeating
  itself. That basis is removed; what remains genuinely comes from elsewhere -- the
  provider's own entity listing for the domain, or name↔domain agreement on a word
  that is distinctive in this market.

**A denylist is a secondary layer, not the architecture.** The load-bearing rules are
structural and catch a directory nobody has heard of:

1. **Multiplicity** — two or more distinct candidate names on one registrable domain
   in one result set means that domain is serving *other people's* businesses. Names
   are compared on their identifying part only (`nameCore`), paid ad copy is excluded
   from the count, and one name that is a prefix of another is one company.
2. **Title shape** — a company is not called "Top 10 Best Roofers in Saint Augustine,
   FL", and a question is not a company.
3. **Path shape** — a business's own site does not describe it under `/biz/…`.
4. **Name↔domain divergence** — a title claiming company A on domain B is a page
   *about* A, not A.

### 4a. What counts as one identity

`registrableDomain` is the key every one of those rules groups on, so two things it
got wrong were worth fixing on their own:

- **A URL is accepted as well as a host.** Inventory stores a website as
  `https://acme.invalid` and the resolver stores an identity as `acme.invalid`. When
  those were different strings, every lookup that crossed them — linking an
  observation to the Account it became, finding the candidate a business came from —
  matched nothing silently and left the evidence unattached.
- **A site builder's apex names nobody.** `salazarroofing.wixsite.com` and
  `coastalair.wixsite.com` are two companies. Collapsing both to `wixsite.com` would
  merge them into one identity carrying two names — which the multiplicity rule then
  reads as a directory, so two real small businesses would reject each other for
  sharing a host. `normalize.ts` had already made this decision for account identity;
  the resolver now makes the same one, from the same list.

## 5. Promotion policy

`VERIFIED` requires one of:

- a `BUSINESS_LISTING` observation carrying a business name **and** (a phone or an
  address the provider observed **for that business**); or
- an `OFFICIAL_SITE` observation **plus** corroboration.

**Corroboration is enforced (review).** The first implementation promoted any
company-shaped title on any domain, so an unknown lead-generation site presenting one
contractor's name — one row, too few for the multiplicity rule — became that
contractor. Three bases are accepted, in descending strength:

1. a provider listing for the same registrable domain;
2. the company name and the domain agree on an identifying word
   (`brandMatchesDomain`: "Burchfield Roof Services LLC" ↔ `burchfieldroofing.com`;
   legal suffixes and stop words identify nobody and are excluded);
3. two independent non-paid results agreeing on the same name for that domain.

With none of the three, the candidate is `NEEDS_REVIEW`: kept, not promoted, not
researched, not rep-visible.

**A paid placement is not on its own evidence of an operating business (review).**
Somebody bought an ad; an aggregator, a lead-generation marketplace and a franchise
portal all buy the same keywords. A paid row promotes only with a listing for the same
domain. A phone-only identity promotes only when a **non-paid** row names it.

The canonical name is **never** a paid ad's title, and never a raw page title unless
it passes the company-name shape test. A listing name is preferred, then an own-site
title, then the domain — and `nameBasis` records which, so no surface implies more
than is known.

## 6. Cross-entity attribution (Invariant B)

Research may read a domain only when the account's own verified domain matches.
Facts extracted from any other domain are refused rather than guessed. A directory the
resolver has rejected is refused by name for every later account
(`mayResearchDomainWithHistory`), so the system learns each directory once — including
ones on no list, which is how `freeroofquote.com` is caught without naming it.

## 7. Location provenance (Invariant F)

The fallback that wrote the searched ZIP into `locations.postal_code` is deleted. A
business with no observed address has **no location**.

**A search target is not an address (review).** The adapter's observation carried
`observedLocation: result.location_name ?? item.address` — two different facts with the
search target winning, on every row of every response, so a business's own address
could never win the coalesce and the classifier read the geography we typed as evidence
that the provider had identified a business. The two are now separate fields:
`observedBusinessAddress` (from `item.address`) and `searchLocationName` (from
`result.location_name`). Only the first is ever stored as an address or read as
identification.

**An observed address is kept (review).** Separating `observedBusinessAddress` from
`searchLocationName` stopped the search target being written as an address, and then
threw the real one away: `city`, `state` and `postalCode` were hard-coded null, so a
provider could give us an address, the resolver could use it to verify the entity, and
the Account still showed no location. Now the discrete fields are carried when the
provider resolved them itself (`address_info`), and a free-form line is stored as an
observed address with no city or postcode invented from it. The account page tells the
three facts apart: an observed business address, the market a company was discovered
for, and a service area.

| Fact | Where | Meaning |
| --- | --- | --- |
| Discovery context | `accounts.discovered_for_geography`, `account_market_membership` | "found while researching 32095" |
| Verified location | `locations` | an address the provider observed |
| Service area | service-area rows | "serves 32095" |

Discovery context is read by search and by coverage planning, so a company found in a
ZIP still appears in that market without claiming to be located in it.

## 8. Query architecture (Invariant C)

Taxonomy groups map to an explicit purpose — generic, data-driven, no per-vertical
logic:

| Group | Purpose | Coverage role |
| --- | --- | --- |
| `core_queries` | `ENTITY_DISCOVERY` | PRIMARY |
| `high_intent_queries`, `urgent_queries`, `high_ticket_queries`, `financing_queries`, `commercial_queries` | `COMMERCIAL_INTELLIGENCE` | SECONDARY |

Phase-aware selection:

1. mandatory PRIMARY entity-discovery coverage
2. remaining entity-discovery breadth
3. only then commercial intelligence
4. cause/event terms only when explicitly requested

Alphabetical order survives **only** as the final tie-break inside a phase. A vertical
with no entity-discovery term **fails closed** with
`This vertical has no configured market-discovery query.`

**Purpose reaches the run (review).** The planner made the distinction and then threw
it away at the adapter boundary: every search, whatever its purpose, created Accounts
from whatever it found, so "roof financing st augustine" could define the market.
`DiscoveryQuery.search` now carries `purpose` and `coverageRole`, and
`ingestDiscoveries` takes the purpose:

- `ENTITY_DISCOVERY` may create Accounts.
- `COMMERCIAL_INTELLIGENCE` may **only** match companies already held. A company it
  finds that we do not hold is counted as `notInMarket`, kept as a candidate with a
  reason, and never promoted.

`SearchPlan` reports `partialDiscoveryCoverage` when the budget did not cover the
vertical's primary terms, and the paid preview prints it.

## 9. Paid plan, preview and execution (Invariants D, E)

**Implemented (review).** `POST /api/mining/jobs` used to take a vertical and a
geography and submit chargeable provider tasks immediately.

`POST /api/mining/plan` builds a plan server-side, calls no provider, and returns it
with a `planId` and a `planHash`. The plan is persisted in `search_plan_previews` with
a short expiry (`SEARCH_PLAN_TTL_SECONDS`, default 15 minutes).

The hash covers every field that changes what is bought: vertical, geography type,
value and normalised value, market, mining mode, causes, provider, provider mode, the
ordered queries with their keyword, location, purpose, coverage role, fingerprint and
whether each is chargeable, the chargeable count, the per-task cost and the estimate.
It is a canonical string rather than `JSON.stringify`, so key insertion order cannot
change it. No secret is in the plan or the hash.

`POST /api/mining/jobs` accepts **only** `planId` and `planHash`. There is no field
through which a query could arrive. The server rebuilds the plan from the stored
request and refuses unless the rebuilt hash matches both the stored hash and the
submitted one:

> The research plan changed after you reviewed it. Review the updated plan before
> submitting paid searches.

A plan is also refused when it has expired, when it was reviewed by somebody else,
when it has already been used (one review buys one run), when the stored row no longer
hashes to its own hash, and when the planner refused the vertical.

Each query is labelled **new paid task** or **already submitted — will collect**, so
the cost shown is the cost charged.

## 9a. The confirmed plan is the execution authority **(review)**

Hashing the plan proved it had not changed *at confirmation time*, and then guarded
nothing. The route verified the hash, threw the plan away, and handed the worker a
vertical, a geography and a budget; the worker called the planner again, minutes or
hours later, against a taxonomy anybody could have edited in between. For a manual
purchase the invariant has to reach further:

```
previewed exact plan == confirmed exact plan == queued exact plan == executed exact plan
```

So a confirmed job carries `confirmed_plan_id` and `confirmed_plan_hash`, and the
worker:

1. loads the stored plan;
2. recomputes its hash and compares it against both the stored hash and the job's;
3. executes those exact searches -- keyword, place, purpose, coverage role and
   fingerprint as approved -- without consulting the planner;
4. restricts execution to the single provider the plan names;
5. refuses, before any provider call, when the linkage is missing, half-present,
   unreadable, tampered with, or authorises no searches.

The refusal is enforced structurally rather than by a check somebody could move: an
invalid plan empties the adapter list, and every provider call in the handler is
inside a loop over adapters.

**What the plan does not override.** It says *which* searches run. It does not say
whether they may be bought: the daily ceiling, the collect-before-submit rule and the
paused-market check all still run per submission, and a confirmed run that would cross
the ceiling is refused like any other.

**Unattended runs are unchanged.** A scheduled saved-market refresh has no preview and
plans server-side exactly as before. Forcing every automatic pass through a human
confirmation was never the requirement.

### 9b. One vocabulary for the mining mode **(review)**

The mode is part of every search fingerprint, so two spellings are two identities.
`planPreview` defaulted to `advertisers_first`; `enqueue`, `marketMiner` and
`searchPlan` defaulted to `advertiser_first`; and Find Prospects sends no mode at all
-- so the ordinary path previewed under one identity and executed under another. Both
happened to order queries identically, which is exactly why it went unnoticed.

`miningMode.ts` is the single vocabulary. Absence means the default; an unrecognised
value is refused (`UNKNOWN_MINING_MODE`) rather than guessed into the nearest spelling.

### 9c. Causes survive to execution **(review)**

The preview accepted `causes`, `buildPaidPlan` used them and the hash covered them --
and the route did not pass them to the job, the job did not persist them, and the
worker did not give them back to the planner. An operator could approve a
hail-qualified plan and get a neutral one. Carrying the plan itself makes this true by
construction; `causes` are also persisted on the job so an unattended run that was
given them does not lose them either.

### 9d. A confirmed plan is its own identity **(review)**

`discoveryFingerprint` excludes the budget on purpose: a market is a market however
many searches it runs. That was right for a scheduler and wrong for a purchase. A
person approving one search would join a queued five-search job and be charged for
five; approving five could silently join a one-search run; and joining an unattended
job also stamps it with a requester, which changes whether a paused market may buy.

A confirmed job is keyed by its plan hash, so two confirmations of the same plan are
one job and a different plan can never be absorbed by it. A confirmation while a
materially different run is already in flight is refused with `ACTIVE_RUN_DIFFERS` and
a 409 rather than queued beside it. The plan is claimed atomically at confirmation, so
a double-click cannot confirm the same plan twice.

### 9e. One provider per confirmed plan **(review)**

The preview quoted `availableDiscoveryAdapters()[0]` and reported DataForSEO's mode
whichever adapter it had picked; the worker looped over every registered adapter. Two
configured providers meant twice the tasks and twice the cost, disclosed nowhere. The
plan names one provider and its own mode, and the worker executes only that provider.
A plan whose provider is no longer configured buys nothing from anybody else.

### 9f. A preview nothing can execute is refused **(review)**

With no adapter configured the plan was still built, with provider `none` and a page
of chargeable-looking searches; the worker would later find no adapter and spend
nothing. Safe, and a lie: it asks somebody to approve a purchase that cannot happen.
`NO_PROVIDER` refuses before a confirmation is offered.

## 10. Provider idempotency

Unchanged and preserved: fingerprints stay deterministic, an outstanding task is
collected rather than re-bought, polling is never a purchase, and the ceiling is
checked before each chargeable submission.

## 11. Readiness and the entity gate (Invariant G)

Entity validity, research completion, research freshness, contactability, compliance
and sales readiness are independent. A freshly researched invalid entity is not
healthy inventory.

`entityGate()` (`src/domain/entityStatus.ts`) is the single rule, used by claiming, by
the pilot, by readiness and by the cold-inventory read model:

- `verified` → workable.
- `rejected`, `quarantined`, `needs_review` → refused, with a sentence saying why.
- `legacy_unverified` → refused **if a machine found it**; workable if it was imported
  or entered by a person.

That last line is the whole of the migration strategy in one rule. Everything in the
table predates the promotion gate, so the status alone cannot separate the 65 canary
SERP rows from companies somebody imported. How it was found can, and
`automatedDiscoveryPredicate` already names the sources that mean "a machine found
this".

**An unverified entity receives no sales intelligence, whatever found it (review).**
The commercial-intelligence rule refused to *create* an Account but then matched on
`resolveAccountIdentity` alone, so Phase 2 could attach advertiser and service
evidence to one of the legacy records nothing has established to be a company. The
same hole existed for a plain discovery query that re-found one of them. The gate now
runs for every purpose: a matched record that is not workable is left alone, the
observation and the candidate are still written, and the run reports it. A junk record
that looks researched is worse than one that looks empty, because the next person to
read it has no reason to doubt it.

**Consequences (review):**

- Claiming refuses with `ENTITY_UNVERIFIED` and a message.
- `addCandidate` (pilot) refuses before any call pack is built.
- `readinessFor` adds a blocking `entity` requirement, separate from the weaker
  textual `identity` check.
- Cold inventory (`ownership: UNCLAIMED`) does not list what cannot be claimed, so a
  rep is never shown a row that will be refused when they click it. A record somebody
  already holds stays visible to them — you cannot hide what is already in their hands.
- `coverageFor` reports `unverifiedExcluded`, and the page says so. A market whose
  inventory falls from 65 to 3 has to say where the other 62 went.
- `ingestListings()` marks what it creates `verified`: a listings provider resolved the
  entity itself, which is the same basis `BUSINESS_LISTING` promotes on. Without this
  the gate would have made real companies unclaimable.

## 12. Migration strategy

Additive only. `051_entity_resolution.sql` adds `discovery_candidates`,
`accounts.entity_status` (default `legacy_unverified`, **not** verified),
`entity_status_basis`, `entity_status_at`, `discovered_for_geography{,_type}`.
`052_search_plan_preview.sql` adds `search_plan_previews`. No existing row is deleted
and no existing Account is declared valid or invalid by either.

## 13. Canary reprocessing

`npm run discovery:reprocess -- --job <id> --dry-run` re-reads a run's observations,
runs today's resolver over them, and prints: how many observations exist, what they
resolve to now, which Accounts the run created that would not be promoted today and
why, and which identities would promote that have no Account.

`--dry-run` is **mandatory**, not a default: a flag that defaults to safe is one
somebody can forget is there. **There is no apply mode in this file.** Nothing is
created, edited, merged, suppressed or deleted, no research is queued and no provider
is called. Apply is separate work with its own review, because changing 65 Accounts on
the strength of a rule change needs a person who has read the output first.

## 14. Transparency

The operator surfaces report the funnel rather than a single number, because "113
rows and nothing new" reads as a thin market and the same run is honestly "113 rows,
47 identities, 11 directories and 34 pages about companies":

- job progress carries `providerRows`, `rejectedRows`, `duplicateRows`,
  `entitiesRejected`, `entitiesNeedingReview`, `notInMarket`, and `perSearch`;
- `discoveryCoverageFor` exposes the entity counters, and the coverage note on Find
  Prospects prints what was refused and why;
- the account page shows the entity status, the basis, the resolver's own sentences,
  the source class, and "found while searching 32095" as provenance rather than as an
  address;
- the doctor's `INGESTION_DROPPED` rule excludes runs that refused promotion, so the
  most common honest outcome of the resolver is no longer reported as a fault.

## 15. Proving the tests are not decoration

A passing suite proves nothing on its own: a test that asserts what the code happens
to do passes whatever the code does. Each guarantee was removed in turn and the suite
re-run, and each removal is caught:

| Mutation | Caught by |
| --- | --- |
| Persist only when something promotes | ALL_JUNK_RESPONSE, refused-row provenance, second-adapter bypass |
| The orchestrator promotes every observation (the Finding 2 defect) | the same three |
| Any query may create Accounts | B: a commercial query may not introduce a company |
| The search target wins the address coalesce | an observed address is never masked |
| A company-shaped title is enough | UNKNOWN_DIRECTORY_SINGLE_ENTRY |
| Confirm without comparing the plan | plan-changed refusal, invented-hash refusal |
| An unverified mined record is workable | claiming fails closed, the pilot fails closed |

One mutation was rejected as not a real weakening: dropping the `status === 'VERIFIED'`
filter in `resolveObservations` changes nothing, because a refused candidate has no
`resolvedName` and `businessesFromCandidates` skips it. Two independent conditions
enforce the same rule, which is why the mutation that *does* represent the Finding 2
defect — the orchestrator building businesses straight from the rows — is the one in
the table.

## 16. Design review

- *Can Yelp become an Account?* No. `DIRECTORY` never promotes, and the multiplicity
  rule catches an unknown directory.
- *Can a second adapter skip the rules?* No. There is no `businesses` field to put a
  company on, and resolution runs in the orchestrator.
- *Can a run that promotes nothing leave no trace?* No. Observations and candidates
  are written before promotion, not inside it.
- *Can News4Jax personnel become a contractor contact?* No. Research only reads a
  verified domain, and a rejected directory is refused for every later account.
- *Can a search ZIP become a physical ZIP?* No. The fallback is deleted and the two
  fields are separate all the way from the provider response.
- *Can a paid ad on an unknown domain become a company?* No. It needs a listing for
  the same domain.
- *Can `drain cleaning` be the sole Plumbing discovery query?* No. One query is always
  PRIMARY entity discovery, and a financing query cannot create an Account at all.
- *Can preview and execution differ?* No. The server recomputes and compares hashes,
  and the submission carries no queries.
- *Can a duplicate confirmation buy twice?* No. One plan buys one run, and the
  fingerprint plus open-task collection stops the rest.
- *Can the canary's 65 records reach a rep?* No. They are `legacy_unverified` and were
  found by a machine, so the gate refuses them in the list, in the claim and in the
  pilot.
