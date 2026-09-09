#!/usr/bin/env bash
# Refuses to let a Sales Brain service start from the wrong tree.
#
#   deploy/assert-runtime.sh            # runtime sanity only
#   deploy/assert-runtime.sh --built    # also require a build to run from
#
# WHY THIS EXISTS. The services used to run out of the general repository checkout at
# /home/roothecks/AiDepartment/services/sales-brain. That checkout was later switched
# to a website branch, which does not track services/ at all, so every tracked file
# under that path vanished: the source, the migrations, and `deploy/backup.sh` -- the
# backup unit's ExecStart. The API and worker kept running only because a stale
# `dist/` survived as an ignored directory, and they carried on for days pointing at a
# tree that no longer contained the code they came from.
#
# Nothing failed loudly at the moment it broke. That is the part worth preventing: a
# service should refuse to start from a tree that is not what it claims to be, rather
# than run something nobody can identify.
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECTED_BRANCH="feature/outbound-sales-brain"
REQUIRE_BUILT=0
[ "${1:-}" = "--built" ] && REQUIRE_BUILT=1

fail() {
  echo "RUNTIME REFUSED: $1" >&2
  echo "RUNTIME REFUSED: package dir is $PACKAGE_DIR" >&2
  echo "RUNTIME REFUSED: the Sales Brain runs from its own worktree on ${EXPECTED_BRANCH}." >&2
  echo "RUNTIME REFUSED: see docs/09-software/SALES-BRAIN-RUNTIME.md" >&2
  exit 1
}

cd "$PACKAGE_DIR"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || fail "this is not a git working tree, so nothing can say which code is running"

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
[ "$BRANCH" = "$EXPECTED_BRANCH" ] \
  || fail "checked out branch is '${BRANCH:-unknown}', not ${EXPECTED_BRANCH}"

# The tracked files a running service needs. Their absence is the exact shape of the
# failure this guard exists for: present as ignored artefacts, gone as tracked source.
for path in package.json src/bin/api.ts migrations deploy/backup.sh deploy/verify-backup.sh; do
  git ls-files --error-unmatch "$path" >/dev/null 2>&1 \
    || fail "$path is not tracked on this branch, so this tree is not the Sales Brain"
  [ -e "$path" ] || fail "$path is tracked but missing from disk"
done

[ -f .env ] || fail ".env is absent, so no database or provider configuration exists"
ENV_MODE="$(stat -c '%a' .env)"
[ "$ENV_MODE" = "600" ] || fail ".env mode is $ENV_MODE, expected 600"

if [ "$REQUIRE_BUILT" -eq 1 ]; then
  for path in dist/bin/api.js dist/bin/worker.js dist/bin/migrate.js; do
    [ -f "$path" ] || fail "$path is missing; run npm run build in this runtime"
  done
  # A dist older than its source is the other way a service runs code nobody meant.
  NEWEST_SRC="$(find src migrations -type f -newer dist/bin/api.js -print -quit 2>/dev/null || true)"
  [ -z "$NEWEST_SRC" ] \
    || fail "dist is older than $NEWEST_SRC; run npm run build before starting"
fi

echo "[runtime] $PACKAGE_DIR on $BRANCH at $(git rev-parse --short HEAD)$([ "$REQUIRE_BUILT" -eq 1 ] && echo ', built')"
