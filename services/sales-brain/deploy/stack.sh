#!/usr/bin/env bash
#
# The whole local stack, supervised: PostgreSQL, the API and the worker.
#
#   ./deploy/stack.sh install     install and enable the user services
#   ./deploy/stack.sh start       start everything
#   ./deploy/stack.sh status      what is actually running, and what the queue thinks
#   ./deploy/stack.sh restart     restart API and worker
#   ./deploy/stack.sh stop        stop API and worker (PostgreSQL is left alone)
#   ./deploy/stack.sh logs        follow both logs
#
# Why this exists: the portal ran with no worker, jobs queued for ever, and the
# operator had to know to start `npm run worker` in another terminal. A stack where
# one half can be missing without anybody being told is a stack that will be missing
# that half at the worst moment. Nothing here spawns a process per click; the worker
# is a supervised service that restarts on its own.
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PACKAGE_DIR"
UNITS_SRC="$PACKAGE_DIR/deploy/systemd"
UNITS_DIR="$HOME/.config/systemd/user"
CONTAINER="${POSTGRES_CONTAINER:-yad-sales-postgres}"
API_UNIT="yad-sales-api.service"
WORKER_UNIT="yad-sales-worker.service"

say() { printf '\n=== %s\n' "$1"; }
have_systemd() { command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; }

case "${1:-status}" in

install)
  say "user services"
  if ! have_systemd; then
    echo "systemd --user is not available here." >&2
    echo "Run the two processes under whatever supervisor this box has, and keep" >&2
    echo "'stack.sh status' as the check: it reads the database, not the process table." >&2
    exit 2
  fi
  mkdir -p "$UNITS_DIR" logs
  install -m 0644 "$UNITS_SRC/$API_UNIT" "$UNITS_DIR/$API_UNIT"
  install -m 0644 "$UNITS_SRC/$WORKER_UNIT" "$UNITS_DIR/$WORKER_UNIT"
  install -m 0644 "$UNITS_SRC/yad-sales-backup.service" "$UNITS_DIR/yad-sales-backup.service"
  install -m 0644 "$UNITS_SRC/yad-sales-backup.timer" "$UNITS_DIR/yad-sales-backup.timer"
  systemctl --user daemon-reload
  systemctl --user enable "$API_UNIT" "$WORKER_UNIT" yad-sales-backup.timer
  # Without lingering, the services stop when the operator logs out and the queue
  # silently stops being served -- which is the failure this script exists to end.
  if ! loginctl show-user "$USER" 2>/dev/null | grep -q 'Linger=yes'; then
    echo "Enabling linger so the services survive logout:"
    echo "  sudo loginctl enable-linger $USER"
  fi
  echo "installed and enabled. Start with: $0 start"
  ;;

start)
  say "database"
  docker start "$CONTAINER" >/dev/null 2>&1 || echo "  (container already running or not managed here)"
  say "services"
  if have_systemd; then
    systemctl --user start "$API_UNIT" "$WORKER_UNIT"
    systemctl --user is-active "$API_UNIT" "$WORKER_UNIT" || true
  else
    echo "systemd --user unavailable; start these yourself:"
    echo "  npm run api"
    echo "  npm run worker"
  fi
  ;;

stop)
  if have_systemd; then systemctl --user stop "$WORKER_UNIT" "$API_UNIT"; fi
  echo "stopped. PostgreSQL was left running."
  ;;

restart)
  if have_systemd; then systemctl --user restart "$API_UNIT" "$WORKER_UNIT"; fi
  "$0" status
  ;;

logs)
  if have_systemd; then journalctl --user -u "$API_UNIT" -u "$WORKER_UNIT" -f
  else tail -f logs/*.log; fi
  ;;

status)
  say "processes"
  if have_systemd; then
    for unit in "$API_UNIT" "$WORKER_UNIT"; do
      printf '  %-28s %s\n' "$unit" "$(systemctl --user is-active "$unit" 2>/dev/null || echo absent)"
    done
  else
    echo "  systemd --user unavailable; process state not checked here"
  fi
  printf '  %-28s %s\n' "$CONTAINER" \
    "$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo absent)"

  # The check that matters. A process table says a worker exists; the heartbeat says
  # a worker is serving *this database*, which is the question.
  say "what the database says"
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
  docker exec "$CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "
    select 'workers online:      ' || count(*) filter (
             where stopped_at is null and last_heartbeat_at > now() - interval '45 seconds')
      from worker_instances
    union all
    select 'last heartbeat:      ' || coalesce(
             extract(epoch from (now() - max(last_heartbeat_at)))::int || 's ago', 'never')
      from worker_instances
    union all
    select 'jobs queued:         ' || count(*) from jobs where status = 'QUEUED'
    union all
    select 'jobs running:        ' || count(*) from jobs where status = 'RUNNING'
    union all
    select 'oldest queued:       ' || coalesce(
             extract(epoch from (now() - min(run_after)))::int || 's', 'none')
      from jobs where status = 'QUEUED' and run_after <= now()
    union all
    select 'failed today:        ' || count(*) from jobs
      where status = 'FAILED' and completed_at > now() - interval '1 day'
    union all
    select 'discovery blocked:   ' || count(*) from jobs
      where outcome = 'DISCOVERY_BLOCKED' and completed_at > now() - interval '1 day'
  " 2>/dev/null | sed 's/^/  /' || echo "  (could not reach the database)"

  say "verdict"
  ONLINE="$(docker exec "$CONTAINER" psql -U "${POSTGRES_USER:-yad_sales}" \
    -d "${POSTGRES_DB:-yad_sales}" -tAc "select count(*) from worker_instances
      where stopped_at is null and last_heartbeat_at > now() - interval '45 seconds'" 2>/dev/null || echo 0)"
  QUEUED="$(docker exec "$CONTAINER" psql -U "${POSTGRES_USER:-yad_sales}" \
    -d "${POSTGRES_DB:-yad_sales}" -tAc "select count(*) from jobs where status = 'QUEUED'" 2>/dev/null || echo 0)"
  if [ "$ONLINE" -gt 0 ]; then
    echo "  A worker is serving the queue."
  elif [ "$QUEUED" -gt 0 ]; then
    echo "  NO WORKER IS RUNNING and $QUEUED job(s) are queued. They will not move." >&2
    echo "  Start it:  $0 start" >&2
    exit 1
  else
    echo "  No worker is running. Nothing is queued, so nothing is stuck yet." >&2
    exit 1
  fi
  ;;

*)
  echo "Usage: $0 {install|start|stop|restart|status|logs}" >&2
  exit 2
  ;;
esac
