#!/usr/bin/env bash
#
# Removes the Production Outbound Sales voice service and puts nginx back the way
# deploy.sh found it. The inbound receptionist is never touched.
#
#   sudo bash rollback.sh                     # uses the newest baseline
#   sudo bash rollback.sh --baseline /var/log/yad-deploy/pre-outbound-20260904T101500Z
#
# Safe to run when the service was never installed, when it is half-installed, and
# twice in a row.

set -euo pipefail

BASELINE=""
TARGET="${TARGET:-/opt/yad-sales-voice}"
UNIT="yad-sales-voice.service"
INBOUND_UNIT="yad-voice-agent.service"
KEEP_ENV=1   # the environment file holds a hand-entered Auth Token; see --purge-env
PURGE_SOURCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --baseline) BASELINE="${2:-}"; shift 2 ;;
    --purge-env) KEEP_ENV=0; shift ;;
    --purge-source) PURGE_SOURCE=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n=== %s\n' "$1"; }

INBOUND_WAS_ACTIVE="$(systemctl is-active "$INBOUND_UNIT" 2>/dev/null || echo unknown)"
say "before rollback"
echo "inbound receptionist: $INBOUND_WAS_ACTIVE"

if [ -z "$BASELINE" ]; then
  BASELINE="$(ls -1d /var/log/yad-deploy/pre-outbound-* 2>/dev/null | sort | tail -1 || true)"
fi
if [ -n "$BASELINE" ] && [ -d "$BASELINE" ]; then
  echo "baseline: $BASELINE"
else
  echo "no baseline directory found; nginx will be cleaned by removing what deploy.sh added"
  BASELINE=""
fi

# ------------------------------------------------------------------ 1. service --
say "stop and disable the outbound service"
systemctl stop "$UNIT" 2>/dev/null || true
systemctl disable "$UNIT" 2>/dev/null || true
rm -f "/etc/systemd/system/$UNIT"
systemctl daemon-reload
systemctl reset-failed "$UNIT" 2>/dev/null || true
echo "$UNIT removed"

# -------------------------------------------------------------------- 2. nginx --
say "nginx"
# Remove the include line from whichever site file carries it, then remove the files
# deploy.sh installed. Nothing else in the site file is edited.
SITES="$(grep -rl 'yad-outbound-locations.conf' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null || true)"
for site in $SITES; do
  BEFORE="$BASELINE/$(basename "$site").before"
  if [ -n "$BASELINE" ] && [ -f "$BEFORE" ]; then
    cp -a "$site" "$site.rollback-was"
    cp -a "$BEFORE" "$site"
    echo "restored $site from the deployment baseline"
  else
    cp -a "$site" "$site.rollback-was"
    sed -i '/yad-outbound-locations\.conf/d' "$site"
    sed -i '/# Production Outbound Sales\. Adds \/outbound routes only\./d' "$site"
    echo "removed the include line from $site"
  fi
done
rm -f /etc/nginx/snippets/yad-outbound-locations.conf
rm -f /etc/nginx/conf.d/yad-outbound-upstream.conf

if nginx -t; then
  systemctl reload nginx
  echo "nginx reloaded"
else
  echo "nginx -t failed AFTER removing the outbound configuration. This is not something" >&2
  echo "the rollback caused by itself; the previous site file is beside each site as" >&2
  echo "*.rollback-was. Do not leave nginx unreloaded: fix the config and reload." >&2
  exit 1
fi

# ---------------------------------------------------------------- 3. leftovers --
say "leftovers"
if [ "$KEEP_ENV" -eq 1 ]; then
  echo "/etc/yad-sales-voice.env kept (holds a hand-entered token; --purge-env removes it)"
else
  shred -u /etc/yad-sales-voice.env 2>/dev/null || rm -f /etc/yad-sales-voice.env
  echo "/etc/yad-sales-voice.env shredded"
fi
if [ "$PURGE_SOURCE" -eq 1 ]; then
  rm -rf "$TARGET"
  echo "$TARGET removed"
else
  echo "$TARGET kept (--purge-source removes it)"
fi
# The service user is left in place: removing it is not needed to undo the deploy and
# a system account with nologin is not a risk.

# ------------------------------------------------------- 4. the receptionist ----
say "the receptionist must be exactly as it was"
NOW_ACTIVE="$(systemctl is-active "$INBOUND_UNIT" 2>/dev/null || echo unknown)"
echo "inbound receptionist is: $NOW_ACTIVE (was: $INBOUND_WAS_ACTIVE)"
if [ "$INBOUND_WAS_ACTIVE" = "active" ] && [ "$NOW_ACTIVE" != "active" ]; then
  echo "The receptionist is no longer active. Investigate immediately." >&2
  exit 1
fi
curl -sS --max-time 8 http://127.0.0.1:3001/health >/dev/null \
  && echo "inbound /health answers" \
  || { echo "inbound /health does not answer. Investigate immediately." >&2; exit 1; }

say "rolled back"
echo "The outbound service is gone. The receptionist is serving. No Twilio webhook changed."
