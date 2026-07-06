# Signal Web

A self-hosted Signal web client. Link it as a secondary device to your Signal
account and read/send messages from any browser — your messages stay on
infrastructure you control, encrypted at rest with SQLCipher.

Built for a single user who wants Signal on the web without trusting a third-party
host. Runs as two Docker containers (a Fastify app + signal-cli) behind a reverse
proxy, sized for a $6/month VM.

## Features

**Messaging**
- Send and receive text, images, and file attachments
- Quote-reply, edit, and delete messages
- Emoji picker, message reactions, typing indicators
- Live updates over WebSocket (no refresh needed)
- Read receipts with graduated status (Sent → Delivered → Read)
- Group support: member list, sender labels, group rename
- Start new conversations by phone number
- Desktop notifications with sender + preview

**UX**
- Warm light/dark theme (auto-follows OS preference)
- Responsive layout — works on phone, tablet, desktop
- Image lightbox, conversation search-friendly list
- Unread badges, connection-status indicator
- Toast error feedback, error boundary

**Security & privacy**
- SQLCipher-encrypted message store (key never leaves the host)
- Password auth with Argon2id, optional WebAuthn/passkey 2FA
- CSRF protection, secure cookies, per-IP login rate limiting
- Content-Security-Policy, HSTS, and hardening headers on every response
- Runs as a non-root container user
- No third-party analytics, scripts, or trackers
- Attachment blobs encrypted at rest; metadata-only served through auth

## How it works

```
┌────────────┐     HTTPS      ┌─────────────────┐     json-rpc      ┌─────────────────────────┐
│  Browser   │ ─────────────▶ │   signal-web    │ ────────────────▶ │   signal-cli-rest-api   │
│ (React SPA)│ ◀──WebSocket── │  (Fastify app)  │ ◀────messages──── │   (bbernhard image)     │
└────────────┘                └─────────────────┘                   └────────────┬────────────┘
                                     │                                            │
                                     │  SQLCipher DB + encrypted blobs            │  Signal servers
                                     ▼                                            ▼
                              ./data/signal-web.db                              (E2E with phone)
```

The app links to your Signal account as a secondary device (like Signal Desktop).
signal-cli bridges between Signal's protocol and a REST/WS API the app consumes.
Your phone stays the primary device; the linked device receives messages from
the moment of linking forward (no history backfill).

## Quick start (local)

**Prerequisites:** Docker + Docker Compose, a phone with Signal installed.

1. **Clone and configure:**
   ```bash
   git clone <your-repo-url> signal-web && cd signal-web
   cp .env.example .env
   # Edit .env: set SIGNAL_NUMBER and generate a DB_KEY
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

2. **Link the device (one-time).** signal-cli needs `normal` mode to link, so use
   the override compose:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.link.yml up --build
   ```
   Wait ~60–90s for signal-cli to boot, then open the `/link?t=...` URL the
   startup log points you to and scan the QR from
   **Signal → Settings → Linked Devices → Link New Device**.

3. **Set a password** (in a new terminal):
   ```bash
   docker compose exec -e NEW_PASSWORD='your-password' app npm run set-password
   ```

4. **Stop (Ctrl-C), then run the normal stack:**
   ```bash
   docker compose up -d --build
   ```
   Open `http://localhost:8190`, log in, done.

For **local UI development** with hot reload, run the Vite dev server in parallel:
```bash
npm --prefix web run dev   # http://localhost:5173 (proxies API to :8190)
```

## Deploying to the internet

The app binds to `127.0.0.1` only — public access is via a Cloudflare Tunnel (or
any reverse proxy). **See [`DEPLOY.md`](./DEPLOY.md)** for the full runbook:

- VM provisioning (2 GB Ubuntu)
- `.env` production values (`PUBLIC_URL`, `SECURE_COOKIES=true`, `RP_ID`, …)
- Cloudflare Tunnel setup (token-based or config-based)
- Verification checklist + troubleshooting

**Backup & recovery:** [`docs/ops/BACKUP.md`](./docs/ops/BACKUP.md) covers what
to back up (encrypted DB, `DB_KEY`, device keys), a restic sample, and the
key-loss / compromise recovery paths.

## Configuration

All config is via environment variables (`.env`). See
[`.env.example`](./.env.example) for the full list with comments. The essentials:

| Variable | Required | Description |
|---|---|---|
| `SIGNAL_NUMBER` | yes | Your Signal phone number (E.164, e.g. `+15551234567`) |
| `DB_KEY` | yes | SQLCipher encryption key — **keep it stable**, losing it loses all messages |
| `PUBLIC_URL` | prod | The public HTTPS origin (e.g. `https://signal.example.com`) |
| `ALLOWED_ORIGIN` | prod | Comma-separated origins allowed to open the live WebSocket |
| `SECURE_COOKIES` | prod | `true` behind HTTPS so session cookies carry the `Secure` flag |
| `RP_ID` | prod | The registrable domain (for WebAuthn/passkeys) |
| `ENABLE_LINK_PAGE` | link | `true` only during device linking; `false` in production |

## Development

**Stack:** Fastify 5, better-sqlite3-multiple-ciphers (SQLCipher), React 19 + Vite,
signal-cli-rest-api. TypeScript throughout, no framework magic.

```bash
npm install              # backend deps
npm --prefix web install # frontend deps

npm test                 # backend tests (176)
npm --prefix web test    # frontend tests (37)
npm run typecheck        # backend tsc
npm --prefix web run typecheck
npm run dev              # backend with watch (tsx)
npm --prefix web run dev # frontend Vite dev server
```

### Project layout

```
src/
  app/           composition root, security headers, link bootstrap
  api/           Fastify routes (REST, WebSocket, attachments, static, linking)
  auth/          password (Argon2id), sessions, CSRF, WebAuthn, rate limiting
  signal/        signal-cli client, envelope parser, ingest, live bridge
  store/         SQLite repos (messages, conversations, attachments, …) + migrations
  profile/       contact/group name sync
web/
  src/           React SPA (components, hooks, API client)
docs/
  ops/BACKUP.md  backup & recovery runbook
DEPLOY.md        deployment runbook (Cloudflare Tunnel)
```

## Security model & threat model

- **At rest:** the SQLite store is SQLCipher-encrypted with `DB_KEY`; attachment
  blobs are AES-256-GCM encrypted on disk. The `DB_KEY` is the single most
  sensitive secret — back it up separately (see BACKUP.md).
- **In transit:** the app expects to sit behind HTTPS (the tunnel). Cookies are
  `Secure` + `HttpOnly` + `SameSite=Strict`. CSRF is double-submit cookie + header.
- **Auth:** password (Argon2id) gates a session; optional WebAuthn steps up to
  `full`. Login attempts are per-IP rate-limited with a global backstop.
- **Trust boundary:** the app trusts signal-cli (same Docker network) and the
  reverse proxy (`trustProxy` on, so `X-Forwarded-For` is honored — never expose
  the app port directly). Everything else is untrusted.
- **What's NOT protected against:** an attacker with your `DB_KEY` + the DB can
  read everything; an attacker who compromises your linked device's Signal keys
  can read live traffic. Treat both as full-account compromise.

## Limitations

- A linked device receives messages **from the moment of linking forward** — no
  history backfill from Signal's servers.
- Single-user by design — there's no multi-account or user management.
- Voice notes, video, and stickers are not yet supported (text + images + files).
- MFM (text formatting) isn't rendered — styled text from other clients shows plain.

## Credits

Built on [signal-cli](https://github.com/AsamK/signal-cli) and the
[signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) Docker
image by bbernhard. Signal is a trademark of the Signal Foundation; this project
is independent and not affiliated.

## License

Specify your license here (e.g. MIT, AGPL-3.0). If you don't want to publish the
source, keep this repo private.
