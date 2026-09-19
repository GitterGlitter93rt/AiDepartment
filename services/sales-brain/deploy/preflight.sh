#!/usr/bin/env bash
# Pre-rollout check. Answers one question: is it safe to let two reps rely on this?
# Every line is a fact read from the running system, not a claim from a config file.
set -uo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PACKAGE_DIR"
# shellcheck disable=SC1091
set -a; . ./.env 2>/dev/null || true; set +a

PASS=0; FAIL=0; WARN=0
ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33mwarn\033[0m  %s\n' "$1"; WARN=$((WARN+1)); }

PORT="${SALES_PORTAL_PORT:-8080}"
BIND="${SALES_PORTAL_BIND:-127.0.0.1}"

echo "YAD Sales Brain — pre-rollout check"
echo
echo "Services"
systemctl --user is-active --quiet yad-sales-api.service \
  && ok "API service is running" || bad "API service is not running"
systemctl --user is-active --quiet yad-sales-worker.service \
  && ok "worker service is running" || bad "worker service is not running"
systemctl --user is-enabled --quiet yad-sales-api.service \
  && ok "API restarts after reboot" || bad "API is not enabled at boot"
systemctl --user is-enabled --quiet yad-sales-worker.service \
  && ok "worker restarts after reboot" || bad "worker is not enabled at boot"
[ "$(loginctl show-user "$USER" --property=Linger --value 2>/dev/null)" = "yes" ] \
  && ok "user services survive logout (linger enabled)" \
  || bad "linger is off: services stop when the user logs out"

echo
echo "Health"
HEALTH="$(curl -sf --max-time 5 "http://127.0.0.1:${PORT}/healthz" 2>/dev/null || echo '')"
if [ -n "$HEALTH" ]; then
  ok "health endpoint responds: ${HEALTH}"
  echo "$HEALTH" | grep -q '"database":"ok"' && ok "database reachable" || bad "database unreachable"
  echo "$HEALTH" | grep -q '"outboundDialEnabled":false' \
    && ok "autonomous outbound dialling is OFF" || bad "OUTBOUND DIALLING IS ENABLED"
else
  bad "health endpoint is not responding on port ${PORT}"
fi

echo
echo "Exposure"
if ss -tln 2>/dev/null | grep -qE "(127\.0\.0\.1|\[::1\]):${PORT}\b"; then
  ok "portal is bound to loopback only"
elif ss -tln 2>/dev/null | grep -qE "100\.[0-9.]+:${PORT}\b"; then
  warn "portal is bound to the tailnet address (WireGuard-encrypted, no browser TLS)"
elif ss -tln 2>/dev/null | grep -qE "0\.0\.0\.0:${PORT}\b"; then
  bad "portal is bound to 0.0.0.0 — reachable from the local network"
fi
ss -tln 2>/dev/null | grep -qE "0\.0\.0\.0:5432|\*:5432" \
  && bad "PostgreSQL is listening on all interfaces" \
  || ok "PostgreSQL is not publicly exposed"
[ "${SESSION_COOKIE_SECURE:-false}" = "true" ] \
  && ok "session cookie is marked Secure" \
  || warn "session cookie is not Secure — set SESSION_COOKIE_SECURE=true once HTTPS is in front"

echo
echo "Secrets"
git -C "$PACKAGE_DIR" check-ignore -q .env \
  && ok ".env is gitignored" || bad ".env is NOT gitignored"
[ "$(stat -c %a .env 2>/dev/null)" = "600" ] \
  && ok ".env is mode 600" || warn ".env permissions are $(stat -c %a .env 2>/dev/null), expected 600"
if curl -sf --max-time 5 "http://127.0.0.1:${PORT}/healthz" 2>/dev/null | grep -qiE 'password|secret|key'; then
  bad "health output contains something secret-looking"
else
  ok "health output leaks nothing"
fi

echo
echo "Backups"
BACKUP_DIR="${BACKUP_DIR:-$HOME/yad-sales-backups}"
systemctl --user is-enabled --quiet yad-sales-backup.timer \
  && ok "nightly backup timer is enabled" || bad "backup timer is not enabled"
LATEST="$(find "$BACKUP_DIR" -maxdepth 1 -name 'yad_sales_*.sql.gz' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
if [ -n "$LATEST" ]; then
  AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$LATEST") ) / 3600 ))
  [ "$AGE_H" -lt 48 ] && ok "most recent backup is ${AGE_H}h old" || warn "most recent backup is ${AGE_H}h old"
else
  bad "no backup has ever been taken"
fi

echo
echo "Data integrity"
COUNTS="$(docker exec yad-sales-postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tAc "
  select (select count(*) from accounts) || '|' ||
         (select count(*) from accounts where is_suppressed and ownership_state <> 'SUPPRESSED') || '|' ||
         (select count(*) from accounts where ownership_state in ('CLAIMED','MANAGER_ASSIGNED') and current_owner_user_id is null) || '|' ||
         (select count(*) from users where is_active)" 2>/dev/null)"
if [ -n "$COUNTS" ]; then
  IFS='|' read -r ACCOUNTS LEAKED ORPHANED USERS <<< "$COUNTS"
  ok "${ACCOUNTS} accounts, ${USERS} active users"
  [ "$LEAKED" = "0" ] && ok "no suppressed account is claimable" || bad "${LEAKED} suppressed accounts are still claimable"
  [ "$ORPHANED" = "0" ] && ok "no claimed account is missing an owner" || bad "${ORPHANED} claimed accounts have no owner"
else
  bad "could not read the database"
fi

echo
printf 'Result: %d passed, %d warnings, %d failures\n' "$PASS" "$WARN" "$FAIL"
[ "$FAIL" -eq 0 ] || { echo "NOT READY for rep rollout."; exit 1; }
[ "$WARN" -eq 0 ] && echo "Ready for rep rollout." || echo "Ready, with the warnings above understood."
