#!/usr/bin/env bash
# Nightly logical backup of the canonical sales database.
#
# Critical durable data (deployment spec §10): Accounts, Contacts, ownership,
# suppression/DNC, callbacks, opportunity state, evidence and the activity timeline.
# None of it exists anywhere else, so this is the only thing standing between a disk
# failure and losing every rep's book of business.
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PACKAGE_DIR"

# shellcheck disable=SC1091
set -a; . ./.env; set +a

BACKUP_DIR="${BACKUP_DIR:-$HOME/yad-sales-backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/yad_sales_${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Dump from inside the container so no client tooling is required on the host.
docker exec yad-sales-postgres pg_dump \
  --username="${POSTGRES_USER}" --dbname="${POSTGRES_DB}" \
  --format=plain --no-owner --no-privileges \
  | gzip -9 > "$TARGET.partial"

mv "$TARGET.partial" "$TARGET"
chmod 600 "$TARGET"

# A backup that cannot be read is not a backup: verify it decompresses and declares
# the tables that matter before rotating anything out.
#
# The verification lives in its own script so it can be pointed at any archived dump
# by hand, and so the regression suite exercises the same code this runs.
#
# Its output is captured and re-emitted from this process on purpose. In a systemd
# user unit only the main process's streams reach the journal: a child's stdout and
# stderr are both dropped, verified by experiment. Left uncaptured, a failed
# verification would appear in the journal as a bare non-zero exit with no reason --
# which is worse than the misleading "missing table accounts" this whole change
# exists to fix, because at least that named something.
if ! VERIFICATION="$("$PACKAGE_DIR/deploy/verify-backup.sh" "$TARGET" 2>&1)"; then
  printf '%s\n' "$VERIFICATION" >&2
  echo "BACKUP FAILED: verification of $TARGET failed; nothing was rotated" >&2
  exit 1
fi
printf '%s\n' "$VERIFICATION"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'yad_sales_*.sql.gz' -mtime "+${RETAIN_DAYS}" -delete

SIZE="$(du -h "$TARGET" | cut -f1)"
COUNT="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'yad_sales_*.sql.gz' | wc -l)"
echo "[backup] ${TARGET} (${SIZE}); ${COUNT} backups retained, ${RETAIN_DAYS}-day retention"
