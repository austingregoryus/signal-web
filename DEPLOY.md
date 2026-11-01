# Deploying Signal Web

A runbook for deploying to a small Ubuntu VM behind a Cloudflare Tunnel. The app
is a single user's self-hosted Signal client, so the threat model is "keep my
messages private on the public internet."

**Prerequisites:** a VM (2 GB RAM / 20 GB disk minimum — the app idles at
~500 MB; signal-cli's JVM is the bulk of it), Docker, a domain on Cloudflare,
and ~20 minutes.

---

## 1. VM provisioning

Spin up Ubuntu 22.04+ (any provider: Hetzner, DigitalOcean, Oracle free-tier,
Fly, your basement). Install Docker + compose:

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER   # log out/in after
```

Clone the repo and enter it:

```bash
git clone <your-repo-url> /opt/signal-web && cd /opt/signal-web
```

## 2. Configure `.env`

```bash
cp .env.example .env
```

Edit `.env`. **The values that matter:**

```bash
SIGNAL_NUMBER=+1yourphonenumber
DB_KEY=<run: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">

# Set these to your real public https URL (the hostname on Cloudflare):
PUBLIC_URL=https://signal.example.com
ALLOWED_ORIGIN=https://signal.example.com
RP_ID=example.com            # the registrable domain (for WebAuthn/passkeys)
SECURE_COOKIES=true          # cookies carry Secure behind HTTPS
# Leave TRUST_PROXY unset: the default trusts only private-network proxies (the
# cloudflared sidecar). Never use `true`; hop counts like `1` are rejected.

# During initial linking only (set false after):
ENABLE_LINK_PAGE=true
LINK_BOOTSTRAP_TOKEN=<a random value you choose, e.g. openssl rand -base64 24>
```

Save `DB_KEY` somewhere durable (password manager) — losing it loses all
messages. See `docs/ops/BACKUP.md`.

## 3. Bind-mount ownership

The app container now runs as **non-root** (uid 1000). The `./data` directory
must be owned by uid 1000:

```bash
mkdir -p data && sudo chown -R 1000:1000 data
```

## 4. First-time device linking

The app needs to link to your Signal account once. Use the linking override
compose (which flips signal-cli to `MODE=normal` so the QR endpoint works):

```bash
docker compose -f docker-compose.yml -f docker-compose.link.yml up -d --build
```

Then open the linking page **through the tunnel** (after step 5) OR temporarily
SSH-tunnel to the loopback port:

```bash
# From your laptop, tunnel to the VM's loopback app port:
ssh -L 8190:127.0.0.1:8190 user@your-vm
# Then locally open: http://localhost:8190/link?t=<LINK_BOOTSTRAP_TOKEN>
```

Scan the QR with your phone (**Settings → Linked Devices → Link a new device**).
Watch `docker compose logs app` for `[signal] connected to signal-cli`.

Once linked, **set a password** immediately:

```bash
docker compose exec -e NEW_PASSWORD='a-strong-password' app npm run set-password
```

Re-running `set-password` later also signs out every existing session, so use
it whenever a computer that was logged in is lost or retired.

Then **disable the linking page**: set `ENABLE_LINK_PAGE=false` in `.env`,
switch back to the normal compose, and rebuild:

```bash
docker compose up -d --build
```

## 5. Cloudflare Tunnel (public HTTPS)

The app is bound to `127.0.0.1:8190` only — it is **not** reachable on the VM's
public IP. External traffic arrives via a Cloudflare Tunnel, which gives you
HTTPS without exposing the origin.

### Option A — token-based (simplest, recommended)

1. In the Cloudflare dashboard: **One-click tunnels → Create tunnel**. Name it
   `signal-web`. Pick a public hostname (e.g. `signal.example.com`).
2. Point it at the app service: service = `http://app:8090` (the compose
   service name; cloudflared runs on the same network).
3. Copy the tunnel token.
4. Put it in `.env`: `TUNNEL_TOKEN=ey...`
5. Run cloudflared as a sidecar:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d
   ```

### Option B — config-file-based

```bash
# On the VM (one-time):
cloudflared tunnel create signal-web          # prints credentials JSON path
cloudflared tunnel route dns signal-web signal.example.com
```

Copy `cloudflared/config.yml` to the VM, edit the hostname + credentials path,
uncomment the volumes in `docker-compose.tunnel.yml`, then:

```bash
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d
```

### After the tunnel is up

Open `https://signal.example.com` — you should see the login page. Log in with
the password you set. Done.

## 6. Verification checklist

- [ ] `https://signal.example.com` loads the login page (no cert warning)
- [ ] Logging in works; cookies have the `Secure` flag (DevTools → Application)
- [ ] A test message sends and arrives on your phone
- [ ] A reply from your phone appears live in the browser (no refresh)
- [ ] `docker compose ps` shows both services healthy
- [ ] Rebooting the VM brings everything back up (`restart: unless-stopped`)
- [ ] `curl -I https://signal.example.com` shows `strict-transport-security`,
      `content-security-policy`, `x-frame-options: DENY`, `x-robots-tag: noindex`

## 7. Ongoing operations

- **Backups:** set up the restic cron in `docs/ops/BACKUP.md`. Do this before
  trusting the deployment with real messages.
- **Updates:** `git pull && docker compose up -d --build`. The signal-cli image
  is digest-pinned; bump it deliberately (re-pull the new digest, update
  `docker-compose.yml`, test linking on a staging box first if you can).
- **Logs:** `docker compose logs -f app signal-cli-rest-api`. The bootstrap
  link token is no longer printed to stdout.

## Troubleshooting

- **"Loading…" forever in the browser:** the WS origin check is rejecting the
  browser. Confirm `ALLOWED_ORIGIN` includes your exact public origin
  (`https://signal.example.com`, no trailing slash).
- **WebAuthn/passkey fails to register:** `RP_ID` must be the registrable
  domain (e.g. `example.com`, not `signal.example.com`), and `PUBLIC_URL` must
  be the exact HTTPS origin.
- **Can't send/receive after a signal-cli bump:** Signal's servers reject
  outdated clients. Check the `bbernhard/signal-cli-rest-api` version matches
  what the README expects.
- **App container fails to start with a permission error on `/app/data`:** the
  bind mount isn't owned by uid 1000 — re-run `chown -R 1000:1000 data`.
- **App exits with `TRUST_PROXY=1 (a hop count) is no longer supported`:** an
  older `.env` still carries `TRUST_PROXY=1`. Delete that line.
- **signal-cli container restarts after upgrading from 0.100:** 0.101 runs as
  uid 1000. A `signal-cli-data` volume created by the old root image may need
  `docker compose run --rm --user 0 --entrypoint chown signal-cli-rest-api -R 1000:1000 /home/.local/share/signal-cli`.
