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

# A backup that cannot be read is not a backup: verify it decompresses and contains
# the tables that matter before rotating anything out.
if ! gzip -t "$TARGET"; then
  echo "BACKUP FAILED: $TARGET is not a valid gzip archive" >&2
  exit 1
fi
for table in accounts contacts contact_endpoints suppressions ownership_events follow_ups; do
  if ! zgrep -q "CREATE TABLE public.${table}" "$TARGET"; then
    echo "BACKUP FAILED: $TARGET is missing table ${table}" >&2
    exit 1
  fi
done

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'yad_sales_*.sql.gz' -mtime "+${RETAIN_DAYS}" -delete

SIZE="$(du -h "$TARGET" | cut -f1)"
COUNT="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'yad_sales_*.sql.gz' | wc -l)"
echo "[backup] ${TARGET} (${SIZE}); ${COUNT} backups retained, ${RETAIN_DAYS}-day retention"
