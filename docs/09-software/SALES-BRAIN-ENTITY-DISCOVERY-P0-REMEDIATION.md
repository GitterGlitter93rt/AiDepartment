# Sales Brain P0 — entity discovery and search planning remediation

**Baseline:** `8245bd9791f957cc56ea4533177363a1f13215a5` on `feature/outbound-sales-brain`
**Worktree:** `/home/roothecks/YAD-Sales-Brain-p0-entity-resolution`
**Status:** design — no production change, no provider traffic

Two architecture failures, both proven against the first real production canary
(`399fb73a-0a8e-4bac-b8a3-6c3831401f23`, Roofing / 32095, 5 paid tasks, ~$0.03).

---

## 1. Current failure path — entity resolution

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

Every gate is a *shape* test. None asks whether the row refers to an operating
business. A Yelp search page has a domain and a title, so it is a business. A
News4Jax article has a domain and a title, so it is a business.

Measured on the canary: 65 Accounts from **one** search, of which 19 (29%) are not
companies at all (8 with no domain, 11 third-party publishers/directories), and
**65 of 65** are named by their SERP result title rather than a business name —
including `500` (an HTTP error page on `southeasternroofers.com`) and
`An 82-year-old Vietnam veteran in St. Augustine says he's ...` (a news article).

Worse, `search_observations` is written *inside* the promotion loop, after
`upsertAccount`. A row that is rejected leaves **no provenance at all**.

### Cross-entity contamination

`Precision Roofing of North Florida Inc` was discovered via `freeroofquote.com`, a
lead-generation directory. Research then crawled that directory as the contractor's
official site and attributed its phone number, financing copy and quote form to the
contractor. The research pipeline worked correctly — on the wrong entity.

## 2. Current failure path — query planner

`searchTaxonomy.ts:144`

```ts
const all = [
  ...readGroup(definition, 'high_intent_queries'),   // listed first
  ...readGroup(definition, 'core_queries'),
];
```

then a single one-dimensional sort: `recommendedForPaidSerp` → `intentWeight` desc →
`priority` asc → **alphabetical**, and `slice(0, budget)`.

For Plumbing every core term is `intent_weight: 4` and every high-intent term is
`5`, so the entire core group sorts behind the entire service group, and
`drain cleaning` wins the intent-5 tie **alphabetically**. With `query_budget` 1 the
market is defined by one narrow service query.

The profiles already encode the distinction — `core_queries` vs
`high_intent_queries` — and the loader discards it. Four further groups
(`urgent_queries`, `high_ticket_queries`, `financing_queries`, `commercial_queries`)
exist in all 13 profiles and are never read at all.

**No profile needs inventing.** All 13 have usable core terms.

---

## 3. Target data flow

```
provider row
  → discovery observation        every row, always, account_id NULL
  → entity candidate             one per resolved identity per run
  → classification               source class + attribution evidence
  → promotion decision           VERIFIED | NEEDS_REVIEW | REJECTED
      REJECTED   → observation kept, no Account, no research
      NEEDS_REVIEW → candidate kept, no rep-facing Account, no research
      VERIFIED   → Account → account research → scoring → readiness
```

An observation is discovery evidence. It is never an Account.

## 4. Source classification (deterministic, no LLM)

`SourceClass` is derived from result type + domain + URL path + title:

| Class | May create a candidate | Example signal |
| --- | --- | --- |
| `BUSINESS_LISTING` | yes, strong | MAPS_LOCAL / LSA carrying name + phone or address |
| `OFFICIAL_SITE` | yes, needs corroboration | organic/paid root-domain page whose identity matches |
| `DIRECTORY` | no | `/biz/`, `/profile/`, many businesses on one domain |
| `MARKETPLACE` | no | lead-gen quote forms, "get matched" |
| `PUBLISHER` | no | `/news/`, article schema, author byline |
| `LISTICLE` | no | title `Best N…`, `Top N…`, `… near me` |
| `SOCIAL` / `VIDEO` / `FORUM` | no | `/watch`, `/posts/`, question-shaped title |
| `MANUFACTURER_LOCATOR` | no | "find a contractor", manufacturer root domain |
| `UNKNOWN` | quarantine only | nothing matched |

**A denylist is a secondary layer, not the architecture.** The load-bearing rules are
structural and catch a directory nobody has heard of:

1. **Multiplicity** — if two or more distinct candidate identities in one result set
   resolve to the same registrable domain, that domain is serving *other people's*
   businesses. It is a directory by behaviour, whatever its name.
2. **Title shape** — a company is not called "Top 10 Best Roofers in Saint Augustine,
   FL", and a question is not a company.
3. **Path shape** — a business's own site does not describe it under `/biz/…`.
4. **Name↔domain divergence** — a title claiming company A on domain B is a page
   *about* A, not A.

## 5. Promotion policy

`VERIFIED` requires one of:

- a `BUSINESS_LISTING` observation carrying a business name **and** (phone or
  address); or
- an `OFFICIAL_SITE` observation **plus** corroboration: name↔domain consistency, or
  two independent observations of the same identity agreeing on the name.

`REJECTED` for any non-promotable source class. `NEEDS_REVIEW` for everything else.

The canonical name is **never** the raw page title unless it passes a company-name
shape test; a listing name is preferred, then a name derived from the domain.

## 6. Cross-entity attribution (Invariant B)

Research may read a domain only when `account_domains` records it for that account
with `domain_role = 'primary'` and a verification basis. Facts extracted from any
other domain are refused rather than guessed. A publisher's executive cannot become a
contractor's decision maker because the publisher's domain is never that
contractor's verified domain.

## 7. Location provenance (Invariant F)

Today `marketMiner.ts:1128` writes the searched ZIP into `locations.postal_code` when
the provider gave no address. That manufactures a physical location.

Three distinct facts, stored separately:

| Fact | Where | Meaning |
| --- | --- | --- |
| Discovery context | `account_market_membership` + observation | "found while researching 32095" |
| Verified location | `locations` | an observed address |
| Service area | service-area rows | "serves 32095" |

The fallback is removed. A business with no observed address has **no location**, and
the read model says "discovered while researching 32095", never "Location: 32095".

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
3. only then commercial intelligence, if budget was explicitly authorised
4. cause/event terms only when explicitly requested

Alphabetical order survives **only** as the final tie-break inside a phase. A vertical
with no entity-discovery term **fails closed** with
`This vertical has no configured market-discovery query.`

One authorised query is always PRIMARY entity discovery, and the run is reported as
incomplete coverage.

## 9. Paid plan, preview and execution (Invariants D, E)

A canonical plan is built server-side and hashed over every material field: vertical,
profile version, geography type/value/normalised, mode, causes, the exact ordered
queries with purpose and channel, provider, provider mode, chargeable task count,
per-query assumed cost ceiling. Secrets are never in the plan.

The plan is persisted with its hash and a short expiry. Confirmation sends the plan
id and hash only — never query text. The server recomputes the authoritative plan and
refuses when the hash differs:

> The research plan changed after you reviewed it. Review the updated plan before
> submitting paid searches.

Client-supplied queries are ignored entirely.

## 10. Provider idempotency

Unchanged and preserved: fingerprints stay deterministic, an outstanding task is
collected rather than re-bought, polling is never a purchase, the ceiling is checked
before each chargeable submission. The preview labels each query **new paid task** or
**already submitted — will collect**, so cost disclosure is honest.

## 11. Readiness (Invariant G)

Entity validity, research completion, research freshness, contactability, compliance
and sales readiness become independent. A freshly researched invalid entity is not
healthy inventory. Claim and pilot eligibility require a verified entity.

## 12. Migration strategy

Additive only. Existing Accounts are **not** marked verified and **not** marked
invalid: mined Accounts take a `legacy_unverified` entity status; imported and
manually created Accounts keep working, because their provenance is not a SERP row.
Nothing existing is deleted.

## 13. Canary reprocessing

`discovery:reprocess --job <id> --dry-run` classifies an existing run's Accounts under
the new rules and reports what *would* change. Apply mode is separate and is not run
during this remediation.

## 14. Design review

- *Can Yelp become an Account?* No. `DIRECTORY` never promotes, and the multiplicity
  rule catches an unknown directory.
- *Can News4Jax personnel become a contractor contact?* No. Research only reads a
  verified primary domain.
- *Can a search ZIP become a physical ZIP?* No. The fallback is deleted.
- *Can `drain cleaning` be the sole Plumbing discovery query?* No. One query is
  always PRIMARY entity discovery.
- *Can preview and execution differ?* No. The server recomputes and compares hashes.
- *Can a duplicate confirmation buy twice?* No. Fingerprint + open-task collection.
