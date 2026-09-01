# VPS Deployment — voice.youraidepartment.ai

Copy-pasteable runbook for the 4 CPU / 8 GB Ubuntu VPS that already serves the static site.

**The website is not touched by any step here.** New subdomain, new Nginx server block, new systemd service, new DNS record. The existing Astro site keeps its own config and deployment flow.

```
youraidepartment.ai        ──▶ Nginx ──▶ static Astro files      (unchanged)
voice.youraidepartment.ai  ──▶ Nginx ──▶ 127.0.0.1:3001 (Node)   (new)
```

---

## 0. Before you start

You need:

- **Anthropic API key** — without it calls connect and route, but the specialist cannot converse.
- **Twilio account SID, auth token, and a voice-capable number.**
- **VPS public IP** — `curl -4 ifconfig.me` on the box.
- Where DNS is actually controlled (§3).

---

## 1. Node

The service runs TypeScript directly via `--experimental-strip-types`, so there is no build step. Requires **Node ≥ 22.12**.

```bash
node -v    # if < 22.12 or missing:
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

## 2. Get the code

```bash
ssh you@YOUR_VPS_IP

sudo useradd --system --create-home --shell /usr/sbin/nologin yadvoice
sudo mkdir -p /opt/yad-voice-agent
sudo chown yadvoice:yadvoice /opt/yad-voice-agent

sudo -u yadvoice git clone https://github.com/GitterGlitter93rt/AiDepartment.git /opt/yad-voice-agent
cd /opt/yad-voice-agent
sudo -u yadvoice git checkout feature/twilio-ai-phone-agent

cd services/ai-phone-agent
sudo -u yadvoice npm ci --omit=dev
```

## 3. DNS

**First find out who is actually authoritative** — do not assume:

```bash
dig NS youraidepartment.ai +short
```

- `*.ns.cloudflare.com` → **Cloudflare** is authoritative. Add the record there. GoDaddy/SiteGround panels will have no effect.
- `*.domaincontrol.com` → GoDaddy.
- `ns1.siteground.net` etc. → SiteGround.

Add **one** record. Change nothing else:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `voice` | `YOUR_VPS_IP` | Auto / 300 |

**Start DNS-only (grey cloud) if on Cloudflare.** Certbot's HTTP-01 challenge needs to reach your origin directly, and debugging is far easier without a proxy in the path. Turn the orange cloud on afterwards if you want it (§5).

Verify:

```bash
dig voice.youraidepartment.ai +short          # expect YOUR_VPS_IP
dig @1.1.1.1 voice.youraidepartment.ai +short # check a public resolver too
```

## 4. Firewall

```bash
sudo ufw status

# Allow SSH FIRST — this order matters, or you lock yourself out.
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

**Do not open 3001.** The service binds `127.0.0.1` and is reachable only through Nginx. Confirm:

```bash
sudo ss -ltnp | grep 3001    # must show 127.0.0.1:3001, never 0.0.0.0:3001
```

## 5. TLS

**Recommended for V1: Let's Encrypt on the origin, DNS-only during setup.** Simplest thing that gives valid origin TLS and works identically whether or not Cloudflare is proxying later.

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d voice.youraidepartment.ai
```

Certbot installs a renewal timer automatically. Verify:

```bash
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

**If you later switch Cloudflare to proxied (orange cloud):**

- Set SSL/TLS mode to **Full (strict)**. "Flexible" breaks WebSockets and sends plaintext to your origin.
- Cloudflare proxies WebSockets on all plans — no setting to enable.
- Keep port 80 reachable so HTTP-01 renewal keeps working, or move to DNS-01.

**Alternative — Cloudflare Origin Certificate:** a 15-year cert, no renewal timer, but only valid *behind* Cloudflare. Choose it only if you are certain the record stays proxied forever. For V1, Let's Encrypt is less to go wrong.

## 6. Environment file

```bash
sudo tee /etc/yad-voice-agent.env > /dev/null <<'EOF'
NODE_ENV=production
PORT=3001
HOST=127.0.0.1
PUBLIC_BASE_URL=https://voice.youraidepartment.ai

ANTHROPIC_API_KEY=sk-ant-REPLACE_ME
CLAUDE_MODEL=claude-sonnet-5

TWILIO_ACCOUNT_SID=ACREPLACE_ME
TWILIO_AUTH_TOKEN=REPLACE_ME
TWILIO_PHONE_NUMBER=+1REPLACE_ME

MOCK_CALENDAR_MODE=true
MOCK_SMS_MODE=true
LOG_TRANSCRIPTS=false
EOF

sudo chown root:yadvoice /etc/yad-voice-agent.env
sudo chmod 640 /etc/yad-voice-agent.env
```

Root-owned, group-readable by the service user only. Never in the repo.

## 7. Start the service

**systemd is the recommendation** — already on the box, starts on boot with no extra step, and journald gives log rotation for free.

```bash
sudo cp /opt/yad-voice-agent/services/ai-phone-agent/deploy/yad-voice-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now yad-voice-agent
sudo systemctl status yad-voice-agent
```

```bash
curl -s localhost:3001/health | head -20
```

Expect `"anthropicKey": "present"` and `"twilioSignatureValidation": "enforced"`.

## 8. Nginx

```bash
sudo cp /opt/yad-voice-agent/services/ai-phone-agent/deploy/nginx-voice.youraidepartment.ai.conf \
        /etc/nginx/sites-available/voice.youraidepartment.ai
sudo ln -s /etc/nginx/sites-available/voice.youraidepartment.ai /etc/nginx/sites-enabled/

sudo nginx -t          # MUST pass before reloading
sudo systemctl reload nginx
```

> If `nginx -t` reports a duplicate `map` for `$connection_upgrade`, the existing config already defines it at `http` level — delete the `map` block from the new file and re-test.

`reload` never drops existing connections. The static site is unaffected: it has its own server block on a different `server_name`.

```bash
curl -s https://voice.youraidepartment.ai/health
```

## 9. Twilio console

Console → Phone Numbers → Manage → Active numbers → *your number* → **Voice Configuration**:

| Field | Value |
|---|---|
| A call comes in | **Webhook** |
| URL | `https://voice.youraidepartment.ai/twilio/incoming` |
| HTTP | **POST** |
| Primary handler fails | *(leave blank)* |
| Call status changes | `https://voice.youraidepartment.ai/twilio/status` · POST |

Save. Confirm ConversationRelay is enabled for the account (Voice → Settings); it is GA but region-restricted.

## 10. First live call

```bash
sudo journalctl -u yad-voice-agent -f
```

Call the number and say: **"I'm going through a nasty divorce and my wife is trying to take the house."**

Expected in the logs:

```json
{"event":"call.started","callSid":"CA…","from":"***4567"}
{"event":"router.decision","industry":"attorneys","specialty":"family_law","intent":"divorce","confidence":0.86,"source":"heuristic"}
{"event":"specialist.selected","specialty":"family_law"}
```

You should hear the family-law opening within about a second. Hang up, call again, say **"water is pouring out from under my kitchen sink"** — same number, plumbing dispatcher.

## 11. Update procedure

```bash
cd /opt/yad-voice-agent
sudo -u yadvoice git pull
cd services/ai-phone-agent
sudo -u yadvoice npm ci --omit=dev
sudo systemctl restart yad-voice-agent
sudo systemctl status yad-voice-agent
curl -s https://voice.youraidepartment.ai/health
```

`restart` sends SIGTERM; the service stops accepting connections and lets calls in progress finish (up to `SHUTDOWN_GRACE_MS`, default 25s) before exiting.

## 12. Operations

```bash
sudo systemctl start|stop|restart|status yad-voice-agent
sudo journalctl -u yad-voice-agent -f              # live
sudo journalctl -u yad-voice-agent --since "1 hour ago"
sudo journalctl -u yad-voice-agent | grep router.decision
```

Bound journald disk use:

```bash
sudo sed -i 's/^#SystemMaxUse=.*/SystemMaxUse=500M/' /etc/systemd/journald.conf
sudo systemctl restart systemd-journald
```

## 13. Troubleshooting

| Symptom | Check |
|---|---|
| Call connects then drops instantly | Relay path mismatch — `/health` `relayUrl` must end `/twilio/conversation` and match the Nginx `location` |
| Twilio returns 403 | Signature validation on but `PUBLIC_BASE_URL` does not match the URL Twilio called |
| Call drops after ~60s of silence | `proxy_read_timeout` missing from the WebSocket location |
| Agent answers but never converses | `ANTHROPIC_API_KEY` absent — check `/health` |
| 502 from Nginx | Service down: `systemctl status yad-voice-agent` |
| Certbot fails | Record proxied on Cloudflare — set to DNS-only, retry, re-proxy after |
