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
| RC commit | _recorded below once frozen_ |
| RC tree | _recorded below once frozen_ |
| `services/` subtree under qualification | `154b047e` |
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

## 4. Results

_Filled in as the run proceeds._

## 5. Morning handoff

_Filled in at the end._
