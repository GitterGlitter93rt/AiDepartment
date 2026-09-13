# Backup and restore — Sales Brain PostgreSQL

The canonical database is the only copy of every rep's book of business: ownership,
suppression and DNC, promised callbacks, opportunity state, the evidence ledger and
the activity timeline. None of it exists anywhere else. A restore that half works is
worse than none, because it looks like it worked.

Everything below runs from `services/sales-brain` and reads `.env` for the container
and credentials. Nothing here writes to the live database.

---

## Back up

```bash
./deploy/backup.sh
```

Writes `~/yad-sales-backups/yad_sales_<timestamp>.sql.gz`, mode 600 in a 700
directory, then verifies the archive decompresses and contains the tables that
matter before rotating anything out. Fourteen-day retention by default
(`BACKUP_RETAIN_DAYS`).

Run it nightly. A backup nobody takes is the commonest cause of losing everything.

## Verify — the drill

```bash
./deploy/verify-restore.sh                 # back up the live database and verify it
./deploy/verify-restore.sh <backup.sql.gz> # verify an archive you already have
SOURCE_DB=yad_sales_scale ./deploy/verify-restore.sh
```

This is the check that matters. It restores into a scratch database
(`yad_sales_restore_drill`, dropped and recreated each run) and then proves the
restore is the same *data*, not the same number of rows:

- the archive is valid gzip and contains no credential-shaped string;
- every one of 29 tables has the same row count as the source;
- nine content checksums match — the ownership ledger, the suppression ledger, the
  evidence ledger, prospect statements, call packs, opportunity state, meeting
  state, the audit log, and each Account's ownership and suppression flags;
- the invariants are still *enforced*, not merely satisfied: the confirmed-booking
  constraint, the append-only triggers on evidence and ownership, the suppression
  sync trigger, and the schema-migration count;
- no owned Account lacks an owner, no suppressed Account has one, and no confirmed
  booking lacks a provider event id;
- `prospect_inventory` exists and returns one row per Account.

Exit code 0 and a `PASS` line means the backup is trustworthy. Anything else means
do not rely on it.

Run the drill monthly, and after any schema migration.

## Restore to scratch

```bash
./deploy/restore.sh ~/yad-sales-backups/yad_sales_<timestamp>.sql.gz
```

Restores into `yad_sales_restore` and prints row counts. Inspect it before doing
anything else.

## Restore over the live database

```bash
./deploy/restore.sh <backup.sql.gz> --force-live
```

Asks you to type the database name. This destroys current ownership, DNC records,
callbacks and timeline and replaces them with the archive's. Stop the API and worker
first:

```bash
systemctl --user stop yad-sales-api yad-sales-worker
./deploy/restore.sh <backup.sql.gz> --force-live
systemctl --user start yad-sales-api yad-sales-worker
```

---

## Integrity checks, by hand

If you want to look rather than trust the script:

```bash
docker exec yad-sales-postgres psql -U "$POSTGRES_USER" -d yad_sales_restore -c "
  select 'accounts' as t, count(*) from accounts
  union all select 'ownership_events', count(*) from ownership_events
  union all select 'suppressions', count(*) from suppressions where is_active
  union all select 'open follow-ups', count(*) from follow_ups where status = 'OPEN'
  union all select 'confirmed meetings', count(*) from meeting_bookings where status = 'CONFIRMED'
  union all select 'evidence', count(*) from evidence_records;"
```

The three that would hurt most to lose, in order: `suppressions` (calling someone
who asked us not to), `ownership_events` (whose book is whose), and
`prospect_statements` (what the prospect actually said, in their words).

## Size

Measured against the 100,000-account synthetic dataset:

| Accounts | Database | Compressed dump |
|---|---|---|
| 25,000 | ~184 MB | ~25 MB |
| 100,000 | 737 MB | 99 MB |
| 1,000,000 | ~7.2 GB | ~1 GB |

A nightly gzipped dump of a hundred-thousand-account database is about 99 MB, so
fourteen days of retention is about 1.4 GB. `npx tsx src/bin/storage-report.ts`
prints the current numbers and the per-table breakdown.
