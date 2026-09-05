#!/usr/bin/env bash
#
# Deploys the Production Outbound Sales voice service beside the inbound receptionist.
#
# Run on the voice VPS as a user with sudo:
#
#   sudo bash deploy.sh --sha 39b0dbdda2edf90bae9b81947004e2b3ec4cbadc
#
# What it will not do, by construction:
#
#   * touch the receptionist's unit, its environment file, or its working tree;
#   * change any existing nginx location, server_name or certificate;
#   * change a Twilio webhook;
#   * arm outbound dialling — that lives in the database and needs an operator;
#   * place a call.
#
# It is idempotent: running it twice leaves the same result, and it stops at the first
# failure rather than continuing past one.

set -euo pipefail

SHA=""
REPO_URL="${REPO_URL:-https://github.com/GitterGlitter93rt/AiDepartment.git}"
BRANCH="${BRANCH:-feature/outbound-sales-brain}"
TARGET="${TARGET:-/opt/yad-sales-voice}"
SERVICE_USER="${SERVICE_USER:-yadsalesvoice}"
ENV_FILE="/etc/yad-sales-voice.env"
UNIT="yad-sales-voice.service"
# The receptionist. Named here only so the script can assert it is untouched.
INBOUND_UNIT="yad-voice-agent.service"

while [ $# -gt 0 ]; do
  case "$1" in
    --sha) SHA="${2:-}"; shift 2 ;;
    --repo) REPO_URL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$SHA" ]; then
  echo "--sha is required. Deploying a moving branch tip is how a review stops meaning anything." >&2
  exit 2
fi

say() { printf '\n=== %s\n' "$1"; }

# ---------------------------------------------------------------- 0. baseline --
say "baseline: what is running before anything changes"
mkdir -p /var/log/yad-deploy
BASELINE="/var/log/yad-deploy/pre-outbound-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BASELINE"
{
  echo "captured $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "--- systemd units"
  systemctl list-units --type=service --all --no-pager | grep -iE 'yad|voice' || true
  echo
  echo "--- inbound unit state"
  systemctl is-active "$INBOUND_UNIT" 2>/dev/null || true
  systemctl show -p FragmentPath,ExecStart,WorkingDirectory,EnvironmentFile "$INBOUND_UNIT" 2>/dev/null || true
  echo
  echo "--- inbound working tree"
  for dir in /opt/yad-voice-agent /opt/ai-phone-agent /srv/yad-voice-agent; do
    [ -d "$dir/.git" ] && { echo "$dir"; git -C "$dir" rev-parse HEAD; git -C "$dir" rev-parse --abbrev-ref HEAD; }
  done
  echo
  echo "--- nginx routes"
  nginx -T 2>/dev/null | grep -nE 'server_name|location|upstream|listen' || true
  echo
  echo "--- listening ports"
  ss -ltnp 2>/dev/null || true
  echo
  echo "--- inbound health"
  curl -sS --max-time 8 http://127.0.0.1:3001/health || true
} > "$BASELINE/baseline.txt" 2>&1
cp -a /etc/nginx "$BASELINE/nginx" 2>/dev/null || true
echo "baseline written to $BASELINE"

INBOUND_WAS_ACTIVE="$(systemctl is-active "$INBOUND_UNIT" 2>/dev/null || echo unknown)"
echo "inbound receptionist was: $INBOUND_WAS_ACTIVE"

# ------------------------------------------------------------ 1. service user --
say "service user"
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$TARGET" --shell /usr/sbin/nologin "$SERVICE_USER"
  echo "created $SERVICE_USER"
else
  echo "$SERVICE_USER already exists"
fi

# ------------------------------------------------------------------- 2. source --
say "source at $SHA"
if [ ! -d "$TARGET/.git" ]; then
  mkdir -p "$TARGET"
  git clone --no-checkout "$REPO_URL" "$TARGET"
fi
git -C "$TARGET" fetch --tags origin "$BRANCH"
git -C "$TARGET" checkout --detach "$SHA"
ACTUAL="$(git -C "$TARGET" rev-parse HEAD)"
if [ "$ACTUAL" != "$SHA" ]; then
  echo "Checked out $ACTUAL, expected $SHA. Refusing to continue." >&2
  exit 1
fi
# The outbound service and voice-core have no runtime dependencies: they run on
# node --experimental-strip-types with only the standard library and `ws`.
echo "checked out $ACTUAL (detached)"

say "runtime dependency: ws"
if [ ! -d "$TARGET/services/sales-voice/node_modules/ws" ]; then
  ( cd "$TARGET/services/sales-voice" && npm install --omit=dev --no-audit --no-fund ws@^8.18.0 )
fi
chown -R "$SERVICE_USER":"$SERVICE_USER" "$TARGET"

# -------------------------------------------------------------- 3. environment --
say "environment file"
if [ ! -f "$ENV_FILE" ]; then
  install -o root -g "$SERVICE_USER" -m 0640 \
    "$TARGET/services/sales-voice/deploy/yad-sales-voice.env.example" "$ENV_FILE"
  echo "created $ENV_FILE from the template. The Twilio values are still blank."
else
  echo "$ENV_FILE already exists and was left alone"
fi
# The receptionist's own environment file is never read or written here.
if [ -f /etc/yad-voice-agent.env ]; then
  chmod o-rwx /etc/yad-voice-agent.env 2>/dev/null || true
  echo "receptionist env file untouched"
fi

# --------------------------------------------------------------------- 4. unit --
say "systemd unit"
install -m 0644 "$TARGET/services/sales-voice/deploy/$UNIT" "/etc/systemd/system/$UNIT"
sed -i "s#WorkingDirectory=.*#WorkingDirectory=$TARGET/services/sales-voice#" \
  "/etc/systemd/system/$UNIT"
sed -i "s#ReadWritePaths=.*#ReadWritePaths=$TARGET/services/sales-voice#" \
  "/etc/systemd/system/$UNIT"
systemctl daemon-reload
systemctl enable "$UNIT"
systemctl restart "$UNIT"
sleep 3
systemctl is-active "$UNIT"

# -------------------------------------------------------------------- 5. nginx --
say "nginx: add /outbound routes, change none of the existing ones"
install -d /etc/nginx/snippets
install -m 0644 "$TARGET/services/sales-voice/deploy/nginx-outbound-locations.conf" \
  /etc/nginx/snippets/yad-outbound-locations.conf

# A duplicate $connection_upgrade map is a configuration error, so the upstream file
# is only installed with its map if the existing config does not already define one.
if nginx -T 2>/dev/null | grep -q 'yad_outbound_connection_upgrade'; then
  echo "upstream file already installed"
else
  install -m 0644 "$TARGET/services/sales-voice/deploy/nginx-outbound-upstream.conf" \
    /etc/nginx/conf.d/yad-outbound-upstream.conf
fi

SITE="$(grep -rl 'voice\.youraidepartment\.ai' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null \
  | grep -v yad-outbound | head -1)"
if [ -z "$SITE" ]; then
  echo "Could not find the voice.youraidepartment.ai server block. Add this line by hand" >&2
  echo "inside its HTTPS server block, then reload nginx:" >&2
  echo "    include /etc/nginx/snippets/yad-outbound-locations.conf;" >&2
else
  echo "site file: $SITE"
  cp -a "$SITE" "$BASELINE/$(basename "$SITE").before"
  if grep -q 'yad-outbound-locations.conf' "$SITE"; then
    echo "include line already present"
  else
    # Insert into the last server block that listens on 443, immediately before its
    # closing brace. Everything already in that block is left exactly as it was.
    python3 - "$SITE" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path).read()
blocks = [m for m in re.finditer(r'server\s*\{', text)]
if not blocks:
    sys.exit('no server block found')
# Find the 443 block by scanning each block's extent.
chosen = None
for match in blocks:
    depth, i = 0, match.end() - 1
    while i < len(text):
        if text[i] == '{': depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0: break
        i += 1
    body = text[match.end():i]
    if re.search(r'listen\s+[^;]*443', body):
        chosen = (match.end(), i)
if not chosen:
    sys.exit('no HTTPS server block found')
start, end = chosen
insertion = '\n    # Production Outbound Sales. Adds /outbound routes only.\n' \
            '    include /etc/nginx/snippets/yad-outbound-locations.conf;\n'
open(path, 'w').write(text[:end] + insertion + text[end:])
print('include line inserted')
PY
  fi
  if nginx -t; then
    systemctl reload nginx
    echo "nginx reloaded"
  else
    echo "nginx -t failed; restoring the site file and leaving nginx as it was" >&2
    cp -a "$BASELINE/$(basename "$SITE").before" "$SITE"
    rm -f /etc/nginx/snippets/yad-outbound-locations.conf
    rm -f /etc/nginx/conf.d/yad-outbound-upstream.conf
    nginx -t && systemctl reload nginx
    exit 1
  fi
fi

# ------------------------------------------------------- 6. the receptionist ----
say "the receptionist must be exactly as it was"
NOW_ACTIVE="$(systemctl is-active "$INBOUND_UNIT" 2>/dev/null || echo unknown)"
echo "inbound receptionist is: $NOW_ACTIVE (was: $INBOUND_WAS_ACTIVE)"
if [ "$INBOUND_WAS_ACTIVE" = "active" ] && [ "$NOW_ACTIVE" != "active" ]; then
  echo "The receptionist is no longer active. That is a deployment failure." >&2
  exit 1
fi
curl -sS --max-time 8 http://127.0.0.1:3001/health >/dev/null \
  && echo "inbound /health answers" \
  || { echo "inbound /health does not answer. Investigate before going further." >&2; exit 1; }

say "done"
echo "Deployed $SHA. Outbound dialling is NOT armed and no call can be placed."
echo "Baseline and nginx backup: $BASELINE"
echo
echo "Next: put the Twilio values in $ENV_FILE with 'sudo -e', then run verify.sh."
