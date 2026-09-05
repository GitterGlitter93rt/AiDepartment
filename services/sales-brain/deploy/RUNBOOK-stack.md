# Running the Sales Portal stack

Three processes: PostgreSQL, the API, and the worker. All three have to be running,
and the one that goes missing quietly is the worker.

## The failure this exists to end

The portal ran with the API up and no worker. A market search was accepted, a job
was written, and it sat in the queue for ever. Research Health stayed green, because
health was inferred from the absence of stranded jobs — and a job nobody has picked
up has no expired lease, because it has no lease at all.

Two things changed. The worker now writes a heartbeat, so "is anything serving this
queue" is answered by a fact rather than an inference. And `stack.sh status` reads
that heartbeat from the database rather than the process table, because a running
process is not the same as a process serving *this* database.

## Install and run

```bash
cd services/sales-brain
./deploy/stack.sh install     # user services, enabled
./deploy/stack.sh start
./deploy/stack.sh status
```

`install` will tell you if lingering is off. Without it the services stop when you
log out and the queue silently stops being served:

```bash
sudo loginctl enable-linger "$USER"
```

## Checking it

```bash
./deploy/stack.sh status
```

It prints the process state, then what the database says, then a verdict. The verdict
is the part that matters, and it exits non-zero when no worker is serving the queue.

A status that reads

```
  yad-sales-worker.service     active
  workers online:      0
  last heartbeat:      never
```

means a worker process is running but it is not this build — the units run
`dist/bin/worker.js`, so a worker started before the heartbeat existed reports
nothing. Rebuild and restart:

```bash
npm run build
systemctl --user restart yad-sales-worker
```

## Restart and recovery

- The worker restarts on its own (`Restart=always`, 10s).
- A job the worker was holding when it died is picked up again once its lease
  expires; nothing is lost, so handlers are written to be safe to re-run.
- A clean stop marks the worker stopped rather than leaving it looking crashed.
- After a reboot with lingering enabled, both services come back without a login.

## Signing in

The sign-in form counts wrong passwords: eight for one address, thirty from one
source, inside a fifteen-minute window. Past that it answers 429 with a
`Retry-After` header and stops checking passwords at all, so a locked form is not
a timing oracle and spends no hashing time on an attacker's behalf.

A correct password clears that address's budget, so a rep who mistyped a few
times and then signed in is not locked out by another typo later.

To clear a lockout for somebody who is genuinely stuck, without waiting:

```bash
docker exec yad-sales-postgres psql -U "$POSTGRES_USER" -d yad_sales -c \
  "delete from login_attempts where email_normalized = 'them@example.com' and not succeeded"
```

The counters live in the database, not in process memory, so restarting the API
does not clear a lockout and two API processes count the same attempts.

## Housekeeping

The worker runs three cleanups hourly, on its own timer: expired sessions,
abandoned import uploads, and sign-in attempts older than a day. Nothing else
owned them, so all three tables only ever grew. A stopped worker means they stop;
`stack.sh status` is the check for that.

## Do not

Do not start a worker per click, and do not run `npm run worker` in a terminal as
the permanent arrangement: it dies with the terminal, and the queue stops with it.
