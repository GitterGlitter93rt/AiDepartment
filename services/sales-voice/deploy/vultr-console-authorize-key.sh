#!/usr/bin/env bash
#
# TYPE OR PASTE THIS INTO THE VULTR WEB CONSOLE for the voice VPS, as root.
#
# It authorizes one public key so the EdgeXpert can reach the box over SSH. It is
# written for a browser serial console, where paste is unreliable and long lines get
# mangled: everything is short, the key is read from a here-document you close
# yourself, and the fingerprint is printed back so you can compare it with the one
# edgexpert-keygen.sh showed you.
#
# It contains no private key and no secret. A public key is public by design.
#
# What it deliberately does NOT do:
#   * change sshd_config, PermitRootLogin or PasswordAuthentication -- a typo there
#     locks you out of a production host, and the web console is your only way back;
#   * restart sshd;
#   * remove an existing authorized key;
#   * touch the receptionist, nginx, or any Twilio setting.
#
# Usage in the console:
#
#   1. cat > /root/authorize-key.sh   (then type the body below, then Ctrl-D)
#   2. bash /root/authorize-key.sh
#   3. paste the ssh-ed25519 line when asked, then press Ctrl-D
#
# Or, if paste works in your console, paste this whole file and run it.

set -euo pipefail

USER_NAME="${USER_NAME:-root}"
HOME_DIR="$(getent passwd "$USER_NAME" | cut -d: -f6)"
[ -n "$HOME_DIR" ] || { echo "No such user: $USER_NAME" >&2; exit 1; }
AUTH="$HOME_DIR/.ssh/authorized_keys"

echo "Paste the public key line (it starts 'ssh-ed25519 AAAA'), then press Ctrl-D:"
KEY_LINE="$(cat)"
KEY_LINE="$(printf '%s' "$KEY_LINE" | tr -d '\r' | tr '\n' ' ' | sed 's/  */ /g; s/^ //; s/ $//')"

case "$KEY_LINE" in
  ssh-ed25519\ AAAA*|ssh-rsa\ AAAA*|ecdsa-sha2-*\ AAAA*) ;;
  "-----BEGIN"*) echo "That is a PRIVATE key. Stop. Destroy it and generate a new pair." >&2; exit 1 ;;
  *) echo "That does not look like an SSH public key. Nothing was written." >&2; exit 1 ;;
esac

# Validate before installing: a key mangled by the console must not become the one
# thing standing between you and the box.
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
printf '%s\n' "$KEY_LINE" > "$TMP"
if ! ssh-keygen -lf "$TMP" >/dev/null 2>&1; then
  echo "The key did not parse -- the console probably mangled it. Nothing was written." >&2
  exit 1
fi

install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR/.ssh"
touch "$AUTH"
chmod 600 "$AUTH"
chown "$USER_NAME":"$USER_NAME" "$AUTH"

if grep -qxF "$KEY_LINE" "$AUTH"; then
  echo "That key is already authorized. Nothing changed."
else
  printf '%s\n' "$KEY_LINE" >> "$AUTH"
  echo "Key appended to $AUTH"
fi

echo
echo "=== authorized keys now on this host ==="
ssh-keygen -lf "$AUTH" 2>/dev/null || cat "$AUTH"
echo
echo "Compare the fingerprint above with the one edgexpert-keygen.sh printed."
echo "If they match, try from the EdgeXpert:  ssh -i ~/.ssh/yad_voice_vps_ed25519 $USER_NAME@<vps-ip>"
echo
echo "KEEP THIS CONSOLE OPEN until that SSH login succeeds. sshd was not restarted and"
echo "nothing was disabled, so password login still works as it did -- but the console"
echo "is the only guaranteed way back in if something else on the host is wrong."
