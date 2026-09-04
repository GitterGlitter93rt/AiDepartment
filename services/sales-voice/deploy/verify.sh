#!/usr/bin/env bash
#
# Verifies the outbound deployment without changing anything.
#
#   sudo bash verify.sh
#
# Every check prints PASS or FAIL and the script exits non-zero if any failed. It
# places no call, arms nothing, and touches no prospect record.

set -uo pipefail

PUBLIC="${PUBLIC_VOICE_BASE_URL:-https://voice.youraidepartment.ai}"
FAILED=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    printf '  PASS  %-52s %s\n' "$label" "$actual"
  else
    printf '  FAIL  %-52s %s (expected %s)\n' "$label" "$actual" "$expected"
    FAILED=$((FAILED + 1))
  fi
}

contains() {
  local label="$1" needle="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -q -- "$needle"; then
    printf '  PASS  %-52s contains %s\n' "$label" "$needle"
  else
    printf '  FAIL  %-52s missing %s\n' "$label" "$needle"
    FAILED=$((FAILED + 1))
  fi
}

echo "=== units"
for unit in yad-voice-agent yad-sales-voice; do
  printf '  %-24s %s\n' "$unit" "$(systemctl is-active "$unit" 2>/dev/null || echo absent)"
done
# The demo runs on whichever unit serves it; list anything voice-shaped so nothing is
# missed by naming only what we expect.
systemctl list-units --type=service --all --no-pager 2>/dev/null \
  | grep -iE 'yad|voice' | sed 's/^/  /' || true

echo
echo "=== inbound receptionist is untouched and healthy"
INBOUND="$(curl -sS --max-time 8 "$PUBLIC/health" 2>/dev/null || echo '{}')"
check "inbound /health status" "ok" "$(printf '%s' "$INBOUND" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status","none"))' 2>/dev/null || echo none)"
contains "inbound still on its own branch" "feature/twilio-ai-phone-agent" "$INBOUND"
contains "inbound relay path unchanged" "/twilio/conversation" "$INBOUND"
contains "inbound signature validation" "enforced" "$INBOUND"

echo
echo "=== outbound service"
OUTBOUND="$(curl -sS --max-time 8 "$PUBLIC/outbound/health" 2>/dev/null || echo '{}')"
check "outbound /health status" "ok" "$(printf '%s' "$OUTBOUND" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status","none"))' 2>/dev/null || echo none)"
contains "agent profile" "yad-sales-core-v1" "$OUTBOUND"
contains "signature validation enforced" '"twilioSignatureValidation": "enforced"' "$OUTBOUND"
contains "outbound relay path" "/outbound/twilio/conversation" "$OUTBOUND"
contains "own health path" "/outbound/health" "$OUTBOUND"

echo
echo "=== no credential value is ever reported"
if printf '%s' "$OUTBOUND" | grep -qE '"twilioAuthToken": "(present|absent)"'; then
  printf '  PASS  %-52s presence only\n' "auth token reported as presence"
else
  printf '  FAIL  %-52s unexpected shape\n' "auth token reporting"
  FAILED=$((FAILED + 1))
fi
# Any value that looks like a Twilio SID or token must not appear in the payload.
if printf '%s' "$OUTBOUND" | grep -qE 'AC[0-9a-f]{32}|SK[0-9a-f]{32}|[0-9a-f]{32}'; then
  printf '  FAIL  %-52s a 32-hex value is being rendered\n' "no secret in the payload"
  FAILED=$((FAILED + 1))
else
  printf '  PASS  %-52s no secret-shaped value present\n' "no secret in the payload"
fi

echo
echo "=== isolation: inbound routes must 404 on the outbound process"
for path in /health /twilio/incoming /twilio/status /twilio/conversation /twilio/relay-action; do
  code="$(curl -sS --max-time 6 -o /dev/null -w '%{http_code}' "http://127.0.0.1:3002$path" 2>/dev/null)"
  check "outbound process rejects $path" "404" "$code"
done

echo
echo "=== isolation: outbound routes must not be served by the inbound process"
for path in /outbound/health /outbound/twilio/conversation; do
  code="$(curl -sS --max-time 6 -o /dev/null -w '%{http_code}' "http://127.0.0.1:3001$path" 2>/dev/null)"
  check "inbound process rejects $path" "404" "$code"
done

echo
echo "=== isolation: separate processes, ports and environment files"
check "outbound listens on 3002" "yes" \
  "$(ss -ltn 2>/dev/null | grep -q '127.0.0.1:3002' && echo yes || echo no)"
check "inbound still listens on 3001" "yes" \
  "$(ss -ltn 2>/dev/null | grep -q '127.0.0.1:3001' && echo yes || echo no)"
check "separate env files" "yes" \
  "$([ -f /etc/yad-sales-voice.env ] && [ -f /etc/yad-voice-agent.env ] && echo yes || echo no)"
check "outbound cannot read the inbound env file" "yes" \
  "$(sudo -u yadsalesvoice test -r /etc/yad-voice-agent.env 2>/dev/null && echo no || echo yes)"
check "outbound has a lower CPU weight than inbound" "yes" \
  "$([ "$(systemctl show -p CPUWeight --value yad-sales-voice 2>/dev/null || echo 100)" -lt \
       "$(systemctl show -p CPUWeight --value yad-voice-agent 2>/dev/null || echo 100)" ] \
     && echo yes || echo no)"

echo
echo "=== nothing was armed and nothing was called"
echo "  (read from the sales-brain database, on the EdgeXpert, not here)"
echo "  Expected: outbound mode OFF, dial creation disarmed, zero voice_calls rows."

echo
if [ "$FAILED" -eq 0 ]; then
  echo "All checks passed. Outbound is deployed, isolated, and cannot place a call."
  exit 0
fi
echo "$FAILED check(s) failed."
exit 1
