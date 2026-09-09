# Where the Sales Brain runs, and why it is not in the main checkout

**Runtime:** `/home/roothecks/YAD-Sales-Brain/services/sales-brain`
**Branch:** `feature/outbound-sales-brain` (dedicated git worktree, locked)
**Database:** `yad_sales` in the `yad-sales-postgres` container, `127.0.0.1:5432`

Do not run the Sales Brain from `/home/roothecks/AiDepartment`. That checkout is the
general repository and gets switched between branches — website work, sprints,
anything. This document exists because that already happened and cost five nights of
backups.

## What went wrong, in the order it happened

1. The four systemd user units pointed at
   `/home/roothecks/AiDepartment/services/sales-brain`.
2. That checkout was switched to a website branch, which does not track `services/`
   at all. Every tracked file under that path disappeared: the source, the
   migrations, and `deploy/backup.sh` — the backup unit's `ExecStart`.
3. Nothing failed at that moment. `api` and `worker` kept running because an ignored
   `dist/` survived, so for days two services executed code from a tree that no
   longer contained it. `.env`, `dist/`, `logs/` and `node_modules/` were all that
   remained, and all four are gitignored.
4. Separately, the nightly backup had already been failing for five nights with
   `is missing table accounts` — a validator defect, not a database problem. See
   below.

Neither failure announced itself. A service running an unidentifiable build and a
backup job whose success message never arrives are both quiet, and quiet is the
problem.

## The backup validator defect (fixed)

`deploy/backup.sh` verified each dump with `zgrep -q "CREATE TABLE public.<table>"`,
once per required table. `grep -q` exits at the first match and closes the pipe.
**systemd runs services with `IgnoreSIGPIPE=yes`**, so `gzip` received `EPIPE`
instead of dying quietly by signal, exited non-zero, and `zgrep` reported failure on
a dump that plainly contained the table.

Run by hand the same command passed. That is why it read as a missing table for five
nights: the symptom only existed under systemd.

And because the loop stopped at the first failure, the message always named
`accounts` — first in the required list. Six tables were required; exactly one was
ever checked. Every dump from 4–8 September was valid, contained all seventy tables,
and was never rotated away only because validation exited before the retention sweep.

The verification now lives in `deploy/verify-backup.sh`: one decompression read to
completion, membership checked in memory, every missing table named, and identical
behaviour by hand and under systemd. `tests/backupValidator.test.ts` pins it,
including a fixture shaped so the historical `EPIPE` reproduces deterministically —
tables near the top and bulk after, because tables at the end produce no `EPIPE` and
would pin nothing.

## The guard

`deploy/assert-runtime.sh` runs before the services and refuses to start when the
tree is not what it claims to be: not a git worktree, wrong branch, a required
tracked file missing, `.env` absent or not mode 600, and with `--built`, a missing or
stale `dist`. It exists so the failure above becomes loud instead of silent.

It requires the runtime to be a *committed* state. A file that exists on disk but is
not tracked on this branch fails the guard, which is precisely the condition that
made the orphaned runtime look fine.

## Operating it

```
cd /home/roothecks/YAD-Sales-Brain/services/sales-brain
npm ci && npm run build            # after any pull
./deploy/assert-runtime.sh --built # what the services check before starting
./deploy/verify-backup.sh <dump>   # validate any archived dump by hand
systemctl --user start yad-sales-backup.service
```

`.env` lives only in the runtime directory, mode 600, and is gitignored. Copy it, do
not recreate it; it holds the database credential and provider configuration.

## Retiring the old runtime

`/home/roothecks/AiDepartment/services/sales-brain` still holds `.env`, `dist/`,
`logs/` and `node_modules/`. It is deliberately **not** deleted automatically: the
`.env` there is the original, and the logs are the only record of the services'
history. Retire it by hand once the new runtime has been serving long enough to trust,
and keep a copy of `.env` somewhere safe first.
