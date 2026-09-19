#!/usr/bin/env bash
# Whether a dump is one we could actually restore from.
#
#   deploy/verify-backup.sh /path/to/yad_sales_....sql.gz
#
# Exits 0 when the archive decompresses and declares every table the deployment spec
# calls critical durable data. Exits 1, naming every table that is absent, when it
# does not.
#
# Its own script so it can be run against any archived dump by hand, and so the
# regression suite can exercise the real thing rather than a copy of it.
#
# HISTORY, because this failed silently for five nights. The check used to be
# `zgrep -q "CREATE TABLE public.${table}"` once per table. `grep -q` exits at the
# first match and closes the pipe; systemd runs services with IgnoreSIGPIPE=yes, so
# `gzip` receives EPIPE instead of dying quietly by signal, exits non-zero, and zgrep
# reports failure on a dump that plainly contains the table. The same command passed
# interactively, which is why it read as a database problem rather than a validator
# one. And because the loop stopped at the first failure, the message always named
# `accounts` -- the first entry in the list -- so five nights of valid backups were
# reported as a missing accounts table.
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "usage: $(basename "$0") <dump.sql.gz>" >&2
  exit 2
fi
if [ ! -f "$TARGET" ]; then
  echo "BACKUP FAILED: $TARGET does not exist" >&2
  exit 1
fi

# Critical durable data (deployment spec §10). None of it exists anywhere else.
REQUIRED_TABLES=(accounts contacts contact_endpoints suppressions ownership_events follow_ups)

if ! gzip -t "$TARGET"; then
  echo "BACKUP FAILED: $TARGET is not a valid gzip archive" >&2
  exit 1
fi

# Decompressed once, read to completion, then checked in memory. Reading the whole
# stream is what removes the early pipe close, so the result is identical whether a
# person runs this or systemd does. The command substitution keeps the pipeline's
# status under `set -o pipefail`, so a decompression or parse failure still fails the
# verification rather than being swallowed.
DUMPED_LIST="$(gzip -cd "$TARGET" \
  | sed -nE 's/^CREATE TABLE public\.([a-z_][a-z_0-9]*) \(.*$/\1/p' \
  | sort -u)"

declare -A DUMPED_TABLES=()
while IFS= read -r dumped_table; do
  [ -n "$dumped_table" ] && DUMPED_TABLES["$dumped_table"]=1
done <<< "$DUMPED_LIST"

MISSING_TABLES=()
for table in "${REQUIRED_TABLES[@]}"; do
  [[ -v DUMPED_TABLES["$table"] ]] || MISSING_TABLES+=("$table")
done

if [ "${#MISSING_TABLES[@]}" -gt 0 ]; then
  # Every missing table, not just the first. Naming one of six is how a validator
  # defect was mistaken for a missing table for five nights running.
  echo "BACKUP FAILED: $TARGET is missing ${#MISSING_TABLES[@]} of ${#REQUIRED_TABLES[@]} required tables: ${MISSING_TABLES[*]}" >&2
  echo "BACKUP FAILED: the dump declares ${#DUMPED_TABLES[@]} tables in total" >&2
  exit 1
fi

echo "[verify] $(basename "$TARGET"): ${#DUMPED_TABLES[@]} tables declared, all ${#REQUIRED_TABLES[@]} required present"
