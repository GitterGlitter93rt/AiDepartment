#!/usr/bin/env bash
# Restores a backup into a NAMED TARGET DATABASE.
#
# Deliberately refuses to overwrite the live database without an explicit
# --force-live flag: a restore run by mistake destroys every rep's ownership and
# every DNC record. The safe default is to restore into a scratch database and
# inspect it first.
#
#   ./restore.sh <backup.sql.gz>                     -> restores into yad_sales_restore
#   ./restore.sh <backup.sql.gz> --force-live        -> overwrites the live database
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PACKAGE_DIR"
# shellcheck disable=SC1091
set -a; . ./.env; set +a

BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "Usage: $0 <backup.sql.gz> [--force-live]" >&2
  echo "Available backups:" >&2
  ls -1t "${BACKUP_DIR:-$HOME/yad-sales-backups}"/yad_sales_*.sql.gz 2>/dev/null | head -10 >&2 || true
  exit 1
fi

TARGET_DB="yad_sales_restore"
if [[ "${2:-}" == "--force-live" ]]; then
  TARGET_DB="${POSTGRES_DB}"
  echo "About to OVERWRITE the live database '${TARGET_DB}'."
  echo "This destroys current ownership, DNC records, callbacks and timeline."
  read -r -p "Type the database name to confirm: " CONFIRM
  [[ "$CONFIRM" == "${TARGET_DB}" ]] || { echo "Aborted."; exit 1; }
fi

echo "[restore] target database: ${TARGET_DB}"
docker exec yad-sales-postgres psql -U "${POSTGRES_USER}" -d postgres \
  -c "drop database if exists ${TARGET_DB};" \
  -c "create database ${TARGET_DB} owner ${POSTGRES_USER};"

gunzip -c "$BACKUP_FILE" | docker exec -i yad-sales-postgres \
  psql -U "${POSTGRES_USER}" -d "${TARGET_DB}" -v ON_ERROR_STOP=1 --quiet

echo "[restore] row counts in ${TARGET_DB}:"
docker exec yad-sales-postgres psql -U "${POSTGRES_USER}" -d "${TARGET_DB}" -c "
  select 'accounts' as t, count(*) from accounts
  union all select 'contacts', count(*) from contacts
  union all select 'contact_endpoints', count(*) from contact_endpoints
  union all select 'suppressions', count(*) from suppressions
  union all select 'ownership_events', count(*) from ownership_events
  union all select 'follow_ups', count(*) from follow_ups
  union all select 'activities', count(*) from activities;"
echo "[restore] done. Inspect ${TARGET_DB} before promoting it."
