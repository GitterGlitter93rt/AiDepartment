#!/usr/bin/env bash
#
# Run this on the EdgeXpert (the machine that will do the deploying), as Michael, NOT
# as root and NOT on the VPS.
#
#   bash edgexpert-keygen.sh
#
# It creates an SSH key pair for reaching the voice VPS if one does not already exist,
# and prints the PUBLIC half and its fingerprint. The private half never leaves
# ~/.ssh, is never printed, and is never committed. If you see anything beginning
# "-----BEGIN" in this script's output, stop and treat the key as compromised.

set -euo pipefail

KEY="${KEY:-$HOME/.ssh/yad_voice_vps_ed25519}"

if [ -f "$KEY" ]; then
  echo "A key already exists at $KEY. Reusing it."
else
  mkdir -p "$(dirname "$KEY")"
  chmod 700 "$(dirname "$KEY")"
  # ed25519: short enough to type into a serial console by hand if it comes to that.
  # No passphrase prompt is suppressed -- you are asked, and a passphrase is the
  # right answer for a key that can reach a production host.
  ssh-keygen -t ed25519 -C "yad-voice-vps-$(hostname -s)-$(date -u +%Y%m%d)" -f "$KEY"
fi

chmod 600 "$KEY"
chmod 644 "$KEY.pub"

echo
echo "=== fingerprint (compare this on the VPS after installing the key) ==="
ssh-keygen -lf "$KEY.pub"
echo
echo "=== public key: this line is what goes into the Vultr console ==="
cat "$KEY.pub"
echo
echo "Next:"
echo "  1. Open the voice VPS's web console in the Vultr dashboard."
echo "  2. Log in as root."
echo "  3. Follow deploy/vultr-console-authorize-key.sh -- it is written to be typed"
echo "     or pasted into that console, and it checks the fingerprint above so a"
echo "     mistyped key is caught before you rely on it."
echo "  4. Then, back here:  ssh -i $KEY root@<vps-ip>"
echo
echo "The private key stays at $KEY. Do not copy it anywhere, do not add it to git,"
echo "do not paste it into a chat message."
