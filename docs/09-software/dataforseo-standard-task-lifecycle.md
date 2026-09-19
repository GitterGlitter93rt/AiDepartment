# DataForSEO Standard task lifecycle

**Status:** Current
**Applies to:** `services/sales-brain` discovery (market miner)
**Authority for:** how a paid Standard SERP task is bought, recorded, collected and given up on.

## The thing to understand first

DataForSEO Standard is **asynchronous**. `task_post` accepts the search, charges for it
immediately, and returns a task id — not results. The answer arrives later, and "later"
is measured in minutes.

These are real production turnarounds, all seven paid tasks bought by this system
between 2026-09-11 and 2026-09-15:

| Keyword | Turnaround |
|---|---|
| roofing contractor 32095 | 22s |
| drain cleaning 32095 | 56s |
| roof repair 32095 | 14m 39s |
| roofer 32095 | 14m 37s |
| roofing company 32095 | 15m 04s |
| plumber 32095 | 15m 14s |
| roof replacement 32095 | 16m 14s |

Every one of them completed successfully at the provider. Any design that assumes a
Standard result arrives in seconds is wrong about this product.

## Lifecycle

```
task_post  ──charged once, $0.006──►  provider_tasks row written immediately (PENDING)
                                      provider_usage row written once (OK, actual cost)
      │
      ▼
fast path: up to 10 polls, 3s apart (~27s)
      │
      ├── result arrives  ──► ingest ──► provider_tasks = COLLECTED
      │
      └── still 40602     ──► job ends PROVIDER_PENDING, row stays PENDING
                                      │
                                      ▼
                        background sweeper, every 3 minutes
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
        GET tasks_ready (one call,            direct task_get by known id
        free, all tasks at once)              for old unchecked tasks
                    │                                   │
                    └─────────────────┬─────────────────┘
                                      ▼
                        collect-only run (COLLECT_EXISTING)
                                      ▼
                        current entity resolution ──► inventory
                                      ▼
                            provider_tasks = COLLECTED
```

## Rules

**The 27-second poll is a fast path, not the collection mechanism.** It exists so a
quick task is in inventory before the operator navigates away. It is expected to expire,
and expiry is not a failure.

**`provider_tasks` is the ledger, and it is written at acceptance.** Every task the
provider accepts gets a row before we start waiting — including tasks that finish inside
the fast path. Writing the row only when the poll gave up meant a 22-second search was
bought, charged and never recorded at all, and it meant `submitted_at` was ~30 seconds
late on every row that did exist.

**A saved market is not required.** Collection used to live inside a future
`market_mine` job, and those were queued only from `saved_markets where enabled`. An
ad-hoc "Research this market" search creates no saved market, so its paid result was
unreachable for ever. The sweeper reads `provider_tasks` and nothing else.

**`task_get` is free.** The cost is charged once, at `task_post`. `task_get` echoes that
same figure back in its `cost` field, which reads exactly like a new charge and is not
one — verified against the account balance, which does not move across a retrieval.
Recording it again would bill every purchase twice, and a task collected three times
four times. There is exactly one authoritative charge per paid task.

**40602 is not a failure.** It means the task is in the provider's queue. It must never
be written as `provider_usage.status = FAILED`, and it must never count toward giving
up. Six of the seven production purchases were recorded as `FAILED / TASK_NOT_READY`,
and every one of them went on to complete.

**Abandonment is keyed to retrievability, not to effort.** A task is given up on when
its result can no longer be fetched — `PROVIDER_TASK_RETENTION_DAYS`, default 30, from
DataForSEO's documented Task GET retention — or on a terminal provider status. Never on
a poll count. `PROVIDER_TASK_MAX_POLLS` is retained only because the release manifest
reports it; it no longer decides anything.

**Nothing in recovery may buy.** The sweeper queues only `COLLECT_EXISTING` plans, and
in the `market_mine` handler a purchase is reachable only on the branch where no task is
outstanding. A collect-only plan cannot reach it. Replacement spend always requires a
new, explicitly approved search plan.

## Retention and the two collection paths

| | `tasks_ready` | direct `task_get` by id |
|---|---|---|
| Cost | free | free |
| Covers | completed **and uncollected**, last **3 days** | any known id, ~**30 days** |
| Drops a task when | anyone retrieves its result | — |
| Role | primary, one call for all tasks | fallback for old or already-listed tasks |

The fallback is not optional. A task leaves `tasks_ready` as soon as anybody fetches it
— including an operator investigating by hand, which has already happened to a task that
was still pending in production. Without the direct path that search would have been
unrecoverable despite being paid for, complete and retrievable.

## Cadence

| Setting | Default | Meaning |
|---|---|---|
| `PROVIDER_TASK_SWEEP_INTERVAL_MS` | 180000 (3m) | how often the sweeper looks |
| `PROVIDER_TASK_DIRECT_MIN_AGE_MS` | 600000 (10m) | how old before a direct check |
| `PROVIDER_TASK_DIRECT_RECHECK_MS` | 1800000 (30m) | backoff between direct checks |
| `PROVIDER_TASK_DIRECT_BATCH` | 5 | direct checks queued per pass |
| `PROVIDER_TASK_RETENTION_DAYS` | 30 | provider result retention |

The sweeper makes **no provider call at all** when nothing is outstanding, and **at most
one** `tasks_ready` call per pass per provider.

## Operating it

```
npm run audit:backlog                    # read-only: what is owed, and what to do
npm run audit:backlog -- --check-provider # also ask which tasks are ready (free)
```

The audit is read-only and has no `--recover-all`. A single flag acting on the whole
backlog is how one wrong assumption becomes a bulk mutation; recovery is the sweeper's
job, task by task, on evidence.

**After a provider outage**: nothing to do. Tasks stay PENDING, the sweeper resumes, and
`tasks_ready` being unreadable never abandons anything.

**After a worker restart**: nothing to do. The ledger is in the database, not in the
process that bought the task.

## What this does not claim

A SERP with no `paid` items means **no ad was observed in this SERP**. It does not mean
the businesses in it do not advertise, and it does not mean the search failed. All seven
production tasks returned zero paid items and zero provider-supplied addresses; the
search geography is not a business address, and an absent ad is not evidence of absence.
