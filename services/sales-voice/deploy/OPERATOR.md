# Outbound Sales Voice — deployment handoff

**Status:** written and tested offline. Nothing here has been applied to the voice VPS.
**Blocker:** no SSH access to the VPS from the EdgeXpert. See §1.

This service runs *beside* the deployed receptionist. Every step below is written so
that a failure at any point leaves the receptionist answering calls. If you ever have
to choose between finishing this deployment and keeping the receptionist up, keep the
receptionist up — nothing in the outbound service is time-critical, and no prospect
can be dialled until an operator arms it in the database afterwards.

---

## 1. Access (the current blocker)

There is no key pair on the EdgeXpert and no password, so nothing can be run on the
VPS yet. The way in is the Vultr web console, which does not need SSH:

```bash
# On the EdgeXpert, as Michael:
bash services/sales-voice/deploy/edgexpert-keygen.sh
```

That creates `~/.ssh/yad_voice_vps_ed25519`, prints the **public** key and its
fingerprint, and never prints or copies the private half.

Then open the VPS's web console in the Vultr dashboard, log in as root, and follow
`deploy/vultr-console-authorize-key.sh`. It appends that one public key to
`authorized_keys`, checks the key parses before installing it, and prints the
fingerprint back so you can compare. It does not edit `sshd_config`, does not
restart sshd, and does not remove an existing key — a typo in any of those locks you
out of a production host with the console as the only way back.

Keep the console tab open until `ssh -i ~/.ssh/yad_voice_vps_ed25519 root@<ip>`
actually works.

---

## 2. Deploy

```bash
# On the VPS, as a user with sudo:
git clone https://github.com/GitterGlitter93rt/AiDepartment.git /tmp/yad-deploy-src
cd /tmp/yad-deploy-src/services/sales-voice/deploy
sudo bash deploy.sh --sha <exact-commit-sha>
```

`--sha` is required. Deploying a branch tip means the thing you reviewed and the thing
you shipped can differ.

What it does, in order: captures a baseline (systemd units, inbound health, the whole
of `/etc/nginx`, the receptionist's HEAD, listening ports) into
`/var/log/yad-deploy/pre-outbound-<timestamp>/`; creates the `yadsalesvoice` system
user; checks out the exact SHA detached at `/opt/yad-sales-voice`; installs `ws`;
creates `/etc/yad-sales-voice.env` from the template with the Twilio values **blank**;
installs and starts `yad-sales-voice.service` on port 3002; adds an `/outbound`
location block to the existing nginx site without editing anything already in it; then
asserts the receptionist is still active and still answering `/health`.

Every step that could duplicate is guarded, so running it twice is safe.

---

## 3. Credentials — on the server only

The Auth Token goes into one file, on the box, by hand. Not into git, not into a
GitHub secret, not into a chat message, not into a source file.

```bash
sudo -e /etc/yad-sales-voice.env
```

Fill in exactly three values:

```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
OUTBOUND_APPROVED_CALLER_IDS=+19046829345
```

Leave `TWILIO_VALIDATE_SIGNATURES=true`. Do not add `OUTBOUND_DIAL_ENABLED` or a mode
variable — dialling is armed in the database by an operator, deliberately not in a
file a restart could re-read.

```bash
sudo systemctl restart yad-sales-voice
sudo bash verify.sh
```

The file is `0640`, owned by root, group `yadsalesvoice`. Confirm nothing else can
read it:

```bash
sudo -u yadsalesvoice cat /etc/yad-voice-agent.env   # must be Permission denied
sudo -u yad-voice-agent cat /etc/yad-sales-voice.env # must be Permission denied
```

To confirm the caller ID is one Twilio will let us present, without placing a call:

```bash
curl -sS -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/IncomingPhoneNumbers.json?PhoneNumber=%2B19046829345"
```

Run that on the VPS where the values already live, so the token never appears in your
own shell history.

---

## 4. Verify

```bash
sudo bash verify.sh
```

It prints PASS/FAIL per check and exits non-zero if any failed. It changes nothing,
places no call, and prints no secret. It checks that the receptionist's `/health`
still reports its own branch and its own relay path, that the outbound service reports
`yad-sales-core-v1` and enforced signature validation, that each process is refused by
the other's routes, that neither can read the other's environment file, and that
outbound has the lower CPU weight.

A green run means the service is installed and isolated. It does **not** mean a call
can be placed: no Twilio webhook points at `/outbound/twilio/*` yet, and dialling is
not armed.

---

## 5. ROLLBACK

Undo everything this deployment added. The receptionist is not touched.

```bash
sudo bash rollback.sh
# or against a specific baseline:
sudo bash rollback.sh --baseline /var/log/yad-deploy/pre-outbound-20260904T101500Z
```

It stops and disables `yad-sales-voice`, removes the unit, restores the nginx site file
from the deployment baseline (falling back to deleting only the include line it added),
removes the two nginx files, reloads nginx after `nginx -t` passes, and then asserts
the receptionist is still active and still answering. Each site file it edits is
copied to `<site>.rollback-was` first.

It keeps two things on purpose:

- `/etc/yad-sales-voice.env`, because the Auth Token in it was entered by hand and
  you will want it again. `--purge-env` shreds it.
- `/opt/yad-sales-voice`, because the checkout is evidence of what ran.
  `--purge-source` removes it.

Safe when the service was never installed, when it is half-installed, and twice in a
row.

**Manual rollback**, if the script itself is the problem:

```bash
sudo systemctl stop yad-sales-voice && sudo systemctl disable yad-sales-voice
sudo rm -f /etc/systemd/system/yad-sales-voice.service && sudo systemctl daemon-reload
sudo cp -a /var/log/yad-deploy/pre-outbound-<ts>/nginx/. /etc/nginx/
sudo rm -f /etc/nginx/snippets/yad-outbound-locations.conf \
           /etc/nginx/conf.d/yad-outbound-upstream.conf
sudo nginx -t && sudo systemctl reload nginx
curl -sS http://127.0.0.1:3001/health
```

The last line is the one that matters. If it does not answer, the receptionist is
down and that is the only problem worth working on.

---

## 6. When a step fails

| Symptom | What it means | Do this |
|---|---|---|
| `--sha is required` | you passed a branch | pass the exact commit |
| `Checked out X, expected Y` | the SHA is not on the fetched branch | check the SHA is pushed |
| `npm install` fails | no network, or npm registry down | fix the network; the deploy has changed nothing yet beyond the checkout |
| `systemctl is-active` fails after restart | the service will not start | `journalctl -u yad-sales-voice -n 50`; usually a blank required env value |
| `Could not find the voice.youraidepartment.ai server block` | the site file is named differently | add the include line by hand as the script prints, then `nginx -t && systemctl reload nginx` |
| `nginx -t failed` | the inserted include broke the config | the script has already restored the site file and removed its own files; nginx is as it was |
| `The receptionist is no longer active` | the deployment broke production | run `rollback.sh` immediately, then `journalctl -u yad-voice-agent -n 100` |
| `inbound /health does not answer` | same | as above |
| verify.sh: `outbound /health status none` | nginx is not routing `/outbound`, or the service is down | check the include line is present, then the unit |
| verify.sh: `inbound still on its own branch` FAIL | the receptionist's checkout moved | you deployed over production. Roll back and restore from the baseline HEAD |

## 7. Redeploying a later SHA

Run `deploy.sh --sha <new>` again. It fetches, checks out detached, reinstalls the
unit, and restarts. The environment file is left alone. A new baseline is captured
each run, so the rollback target is always the state immediately before the run you
are undoing.

Restarting drops any call in progress. During a pilot, check
`/outbound/health` → `activeSessions` is `0` first.
