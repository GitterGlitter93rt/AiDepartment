#!/usr/bin/env bash
#
# Backup/restore drill. Proves that a backup can be restored and that what comes
# back is the same data, not merely the same number of rows.
#
#   ./verify-restore.sh                      # back up the live database and verify
#   ./verify-restore.sh <backup.sql.gz>      # verify an existing backup
#   SOURCE_DB=yad_sales_scale ./verify-restore.sh
#
# Never touches the source database. The restore target is a scratch database that
# is dropped and recreated each run, and the script refuses to use the source as its
# own target.
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PACKAGE_DIR"
# shellcheck disable=SC1091
set -a; . ./.env; set +a

CONTAINER="${POSTGRES_CONTAINER:-yad-sales-postgres}"
SOURCE_DB="${SOURCE_DB:-${POSTGRES_DB}}"
TARGET_DB="${RESTORE_TARGET_DB:-yad_sales_restore_drill}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/yad-sales-backups}"
BACKUP_FILE="${1:-}"
FAILURES=0

if [ "$SOURCE_DB" = "$TARGET_DB" ]; then
  echo "Refusing to restore ${SOURCE_DB} over itself." >&2
  exit 2
fi

say() { printf '\n=== %s\n' "$1"; }
check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf '  PASS  %-46s %s\n' "$label" "$actual"
  else
    printf '  FAIL  %-46s %s (expected %s)\n' "$label" "$actual" "$expected"
    FAILURES=$((FAILURES + 1))
  fi
}
psql_source() { docker exec "$CONTAINER" psql -U "$POSTGRES_USER" -d "$SOURCE_DB" -tAc "$1"; }
psql_target() { docker exec "$CONTAINER" psql -U "$POSTGRES_USER" -d "$TARGET_DB" -tAc "$1"; }

# ------------------------------------------------------------------- 1. backup --
say "backup"
if [ -z "$BACKUP_FILE" ]; then
  mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
  BACKUP_FILE="$BACKUP_DIR/drill_${SOURCE_DB}_$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  docker exec "$CONTAINER" pg_dump --username="$POSTGRES_USER" --dbname="$SOURCE_DB" \
    --format=plain --no-owner --no-privileges | gzip -9 > "$BACKUP_FILE.partial"
  mv "$BACKUP_FILE.partial" "$BACKUP_FILE"
  chmod 600 "$BACKUP_FILE"
fi
echo "  file: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
gzip -t "$BACKUP_FILE" || { echo "  FAIL  the archive is not valid gzip" >&2; exit 1; }

# ------------------------------------------------------------------ 2. secrets --
say "the archive carries no credential"
# The dump contains business data, which legitimately includes email addresses. What
# must never be in it is a credential: a session token, an API key, a password hash
# that is not the scrypt hash we store on purpose, or a connection string.
LEAKS=0
for pattern in 'AC[0-9a-f]\{32\}' 'SK[0-9a-f]\{32\}' 'sk-ant-' 'postgres://[^ ]*:[^ @]*@' \
               'BEGIN [A-Z ]*PRIVATE KEY'; do
  if zgrep -q -- "$pattern" "$BACKUP_FILE" 2>/dev/null; then
    echo "  FAIL  the archive matches ${pattern}"
    LEAKS=$((LEAKS + 1))
  fi
done
check "credential-shaped strings in the archive" "0" "$LEAKS"

# ------------------------------------------------------------------ 3. restore --
say "restore into ${TARGET_DB}"
docker exec "$CONTAINER" psql -U "$POSTGRES_USER" -d postgres --quiet \
  -c "drop database if exists ${TARGET_DB};" \
  -c "create database ${TARGET_DB} owner ${POSTGRES_USER};" >/dev/null
gunzip -c "$BACKUP_FILE" | docker exec -i "$CONTAINER" \
  psql -U "$POSTGRES_USER" -d "$TARGET_DB" -v ON_ERROR_STOP=1 --quiet >/dev/null
echo "  restored"

# --------------------------------------------------------------- 4. row counts --
say "row counts match, table by table"
TABLES="accounts locations contacts contact_endpoints account_domains evidence_records
        opportunity_hypotheses canonical_scores activities follow_ups suppressions
        ownership_events opportunities opportunity_stage_events meeting_bookings
        prospect_statements call_packs voice_calls voice_call_turns hook_attempts
        email_campaigns email_enrollments email_events audit_log import_batches
        import_rows jobs saved_markets users"
for table in $TABLES; do
  SOURCE_COUNT="$(psql_source "select count(*) from ${table}" 2>/dev/null || echo missing)"
  TARGET_COUNT="$(psql_target "select count(*) from ${table}" 2>/dev/null || echo missing)"
  check "${table}" "$SOURCE_COUNT" "$TARGET_COUNT"
done

# ------------------------------------------------------------- 5. content, not just counts --
say "content checksums match"
# A count can match while the rows differ. These hash the columns that carry the
# facts nobody can reconstruct: who owns what, who said not to call, what was
# observed, and what was agreed.
checksum() {
  local db="$1" sql="$2"
  docker exec "$CONTAINER" psql -U "$POSTGRES_USER" -d "$db" -tAc \
    "select coalesce(md5(string_agg(t.row_text, '|' order by t.row_text)), 'empty') from (${sql}) t"
}
declare -A LEDGERS=(
  ["ownership ledger"]="select account_id::text || event_type || coalesce(new_owner_user_id::text,'') || coalesce(reason,'') || occurred_at::text as row_text from ownership_events"
  ["suppression ledger"]="select scope || coalesce(account_id::text,'') || suppression_type || coalesce(normalized_value,'') || is_active::text as row_text from suppressions"
  ["evidence ledger"]="select account_id::text || claim_key || claim_text || confidence || can_state_as_fact::text as row_text from evidence_records"
  ["prospect statements"]="select account_id::text || statement_text || source_class as row_text from prospect_statements"
  ["call packs"]="select call_pack_id::text || account_id::text || context_version || coalesce(primary_hypothesis,'') as row_text from call_packs"
  ["opportunity state"]="select opportunity_id::text || stage || problem_summary || coalesce(close_reason,'') as row_text from opportunities"
  ["meeting state"]="select booking_id::text || status || attended_state || coalesce(provider_event_id,'') as row_text from meeting_bookings"
  ["audit log"]="select action || coalesce(subject_id,'') || coalesce(reason,'') || occurred_at::text as row_text from audit_log"
  ["account ownership"]="select account_id::text || ownership_state || coalesce(current_owner_user_id::text,'') || is_suppressed::text as row_text from accounts"
)
for label in "${!LEDGERS[@]}"; do
  check "$label" "$(checksum "$SOURCE_DB" "${LEDGERS[$label]}")" \
                 "$(checksum "$TARGET_DB" "${LEDGERS[$label]}")"
done

# ------------------------------------------------------- 6. invariants survive --
say "the invariants the schema enforces are still enforced"
# A restore that dropped the constraints would pass every count check above and then
# let the first bad write through.
check "confirmed booking needs a provider id" "1" \
  "$(psql_target "select count(*) from pg_constraint where conname = 'meeting_bookings_confirmation_requires_provider'")"
check "evidence is append-only" "1" \
  "$(psql_target "select count(*) from pg_trigger where tgname = 'evidence_records_append_only'")"
check "ownership events are append-only" "1" \
  "$(psql_target "select count(*) from pg_trigger where tgname = 'ownership_events_no_update'")"
check "suppression sync trigger" "1" \
  "$(psql_target "select count(*) from pg_trigger where tgname = 'suppressions_sync'")"
check "an owned Account has an owner" "0" \
  "$(psql_target "select count(*) from accounts where ownership_state in ('CLAIMED','MANAGER_ASSIGNED') and current_owner_user_id is null")"
check "a suppressed Account is unowned" "0" \
  "$(psql_target "select count(*) from accounts where is_suppressed and current_owner_user_id is not null")"
check "no confirmed booking without a provider event" "0" \
  "$(psql_target "select count(*) from meeting_bookings where status = 'CONFIRMED' and provider_event_id is null")"
check "migrations recorded" "$(psql_source 'select count(*) from schema_migrations')" \
  "$(psql_target 'select count(*) from schema_migrations')"

# ---------------------------------------------------------------- 7. it works --
say "the restored database answers the questions the product asks"
check "prospect_inventory view present" "1" \
  "$(psql_target "select count(*) from pg_views where viewname = 'prospect_inventory'")"
check "inventory rows equal account rows" \
  "$(psql_target 'select count(*) from accounts')" \
  "$(psql_target 'select count(*) from prospect_inventory')"

say "result"
if [ "$FAILURES" -eq 0 ]; then
  echo "PASS — ${BACKUP_FILE} restores to a database identical to ${SOURCE_DB}."
  echo "Scratch database ${TARGET_DB} left in place for inspection."
  exit 0
fi
echo "FAIL — ${FAILURES} check(s) failed. Do not trust this backup." >&2
exit 1
