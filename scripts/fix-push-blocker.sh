#!/usr/bin/env bash
#
# Removes a fake Twilio SID literal from two historical commits on
# feature/twilio-ai-phone-agent so GitHub push protection stops
# rejecting the branch.
#
#   READ THIS BEFORE RUNNING. IT REWRITES HISTORY.
#
# What it touches:   ONLY refs/heads/feature/twilio-ai-phone-agent
# What it does NOT:  main, origin/main, any other branch, any remote
#                    except a later manual push of this one branch.
#
# The branch has never been pushed successfully, so no collaborator has
# these commits and nobody's clone will be broken by the rewrite. That
# is what makes this safe here and would NOT make it safe on main.
#
# Usage:
#   bash scripts/fix-push-blocker.sh --dry-run   # show what changes
#   bash scripts/fix-push-blocker.sh --apply     # do it
#
set -euo pipefail

BRANCH="feature/twilio-ai-phone-agent"
BACKUP="backup/twilio-agent-pre-rewrite"
FILE="services/ai-phone-agent/tests/guardrails.test.ts"
BAD='The account SID is AC0123456789abcdef0123456789abcdef.'
GOOD='The account SID is AC + 32 hex characters, assembled at runtime.'

cd "$(git rev-parse --show-toplevel)"

echo "=== current state ==="
echo "branch:        $(git branch --show-current)"
echo "backup ref:    $BACKUP -> $(git rev-parse --short "$BACKUP" 2>/dev/null || echo 'MISSING')"
echo "merge-base:    $(git merge-base main "$BRANCH")"
echo "commits ahead: $(git rev-list "$(git merge-base main "$BRANCH")..$BRANCH" --count)"
echo

echo "=== commits containing the flagged literal ==="
AFFECTED=$(git rev-list "$(git merge-base main "$BRANCH")..$BRANCH" | while read -r c; do
  if git show "$c:$FILE" 2>/dev/null | grep -qF "$BAD"; then echo "$c"; fi
done)
if [ -z "$AFFECTED" ]; then
  echo "None. Nothing to do."
  exit 0
fi
echo "$AFFECTED" | while read -r c; do echo "  $(git log -1 --format='%h %s' "$c")"; done
echo

echo "=== refs that would change ==="
echo "  refs/heads/$BRANCH   $(git rev-parse --short "$BRANCH")  ->  (new sha)"
echo "  nothing else"
echo
echo "  main stays at        $(git rev-parse --short main)"
echo "  $BACKUP stays at $(git rev-parse --short "$BACKUP")"
echo

if [ "${1:-}" != "--apply" ]; then
  echo "Dry run. Re-run with --apply to rewrite."
  exit 0
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ERROR: working tree has uncommitted changes. Commit or stash first." >&2
  exit 1
fi
if ! git rev-parse --verify "$BACKUP" >/dev/null 2>&1; then
  echo "ERROR: backup ref $BACKUP is missing. Create it first:" >&2
  echo "  git branch $BACKUP $BRANCH" >&2
  exit 1
fi

echo "Rewriting..."
# git filter-branch is deprecated but is present everywhere and needs no
# install. It rewrites ONLY the range given, which is the commits unique
# to this branch — main is untouched because it is excluded by the range.
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force \
  --tree-filter "if [ -f '$FILE' ]; then sed -i \"s|$BAD|$GOOD|g\" '$FILE'; fi" \
  -- "$(git merge-base main "$BRANCH")..$BRANCH"

echo
echo "=== verification ==="
git rev-list "$(git merge-base main "$BRANCH")..HEAD" | while read -r c; do
  if git show "$c:$FILE" 2>/dev/null | grep -qF "$BAD"; then
    echo "STILL PRESENT in $c" >&2; exit 1
  fi
done
echo "literal is gone from every commit on the branch"
echo "main is still at $(git rev-parse --short main)"
echo "backup is still at $(git rev-parse --short "$BACKUP")"
echo
echo "Now run the tests, then push:"
echo "  cd services/ai-phone-agent && npm test && npm run typecheck"
echo "  git push origin $BRANCH"
echo
echo "If anything looks wrong, restore with:"
echo "  git reset --hard $BACKUP"
