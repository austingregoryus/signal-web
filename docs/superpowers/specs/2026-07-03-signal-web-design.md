# Signal Web — Design Spec

**Date:** 2026-07-03
**Status:** Approved design (rev. 2, post-review) — pending implementation plan
**Author:** Austin (with Claude)

> **Rev 2 changelog:** Incorporated two independent design reviews (security/privacy and
> architecture/feasibility). Added: linked-device sync (own-sent) message handling,
> message dedup + edit/delete handling, reconnect/replay semantics, concrete SQLCipher
> library choice, profile name/avatar work item, session hardening + login rate-limiting +
> CSRF, attachment-proxy hardening, log hygiene, device-revocation runbook, backup policy,
> security headers. Decisions: (a) custom login only, no Cloudflare Access; (b) YubiKey
> optional/default-on with password fallback; (c) auto-unlock at-rest keys with documented
> limitation.

## 1. Purpose

A self-hosted web client that lets a specific, single user (a family member) read and
send his Signal messages from a locked-down work browser — no application installs,
no phone access on-site. It works by linking a persistent server as a Signal
**linked device** and exposing a private, authenticated web UI over a plain HTTPS URL.

This is a personal, low-user-count, self-hosted tool — not a multi-tenant product.
Design decisions favor simplicity, privacy, and being easy to run on a home machine.

## 2. Non-negotiable constraints

- **No installs / no phone at the access point.** The work browser is the only
  client surface. Anything the user needs (including 2FA) must work in a plain
  browser with, at most, a USB security key.
- **Persistent service.** signal-cli holds a live connection and encryption state;
  this is a long-running daemon, **not** a serverless deployment. (Explicitly *not*
  Vercel, despite session tooling defaults.)
- **Linked device, not primary.** The server links to the user's existing phone via
  QR code. The phone remains the primary device. The server's account/key material
  is the security-critical asset.
- **Private by default.** Not indexed, not discoverable, always behind auth.

## 3. Account model

signal-cli registers as a **secondary (linked) device**, exactly like Signal Desktop:
the app generates a linking QR code, the user scans it once from
Settings → Linked Devices in the Signal app on his phone.

**Consequence — no history backfill:** a linked device only receives messages from
the moment of linking forward. Signal does not replay prior chat history onto a new
device. The conversation list therefore fills in over the first days of use as people
send messages and as the user replies. This is expected behavior, and it pairs well
with the short retention window (§7).

## 4. Architecture (two containers, Docker Compose)

```
        Work browser (user)
              │  HTTPS
     ┌────────▼─────────┐
     │ Cloudflare Tunnel│   plain public URL, TLS, origin hidden
     └────────┬─────────┘
              │
   ┌──────────▼────────────┐        private docker network
   │  signal-web-app        │◄──── WebSocket ────► browser
   │  (Fastify + React)     │
   │  - auth (Argon2+WebAuthn)      REST + WS
   │  - SQLCipher msg cache  ├───────────────────┐
   │  - 2-wk retention prune │                   │
   └──────────┬─────────────┘                    │
              │ localhost / unix socket           │
   ┌──────────▼────────────┐                     │
   │ signal-cli-rest-api    │  bbernhard, JSON-RPC mode
   │  - linked device        │
   │  - encrypted key volume │◄─ streams incoming msgs (WS)
   └──────────┬─────────────┘
              │ Signal E2E
       Signal servers ↔ family devices
```

**Selected approach:** offload the Signal-protocol details to a mature, widely-used
component (`bbernhard/signal-cli-rest-api`) and put essentially all custom effort into
the web experience. Rejected alternatives: talking to signal-cli's native JSON-RPC
daemon directly (more glue, less battle-tested surface) and a single all-in-one Node
process managing the JVM (fragile lifecycle, hardest to debug).

## 5. Components

Each component has one clear job, a well-defined interface, and can be understood and
tested independently.

### 5.1 `signal-cli-rest-api` container (the Signal engine)
- Runs in **JSON-RPC mode**: exposes a WebSocket that streams inbound messages,
  receipts, typing indicators, and reactions, plus REST endpoints for sending,
  attachments, groups, contacts, receipts, typing, and reactions.
- Holds the linked-device key material on an **encrypted volume**.
- Treated as a black box behind its documented API. The only component that speaks
  the Signal protocol.

### 5.2 Backend — `signal-web-app` (Fastify + TypeScript)
- **Signal adapter** — the single module that knows signal-cli's API shape.
  Subscribes to its WebSocket; calls its REST. Everything else in the app depends on
  a clean internal interface, not on signal-cli directly. Responsibilities:
  - **Ingest ALL envelope types**, not just inbound `dataMessage`. Critically, because
    this is a *linked* device, messages the user sends **from his own phone** arrive as
    `syncMessage.sentMessage` and must be stored as **outgoing** messages. Without this,
    every thread renders one-sided — the single most likely "looks broken" bug. Also
    handle `receiptMessage`, `typingMessage`, reactions, `remoteDelete` (tombstone),
    and `editMessage` (Signal edits mutate an existing row).
  - **Auto-reconnect with exponential backoff + heartbeat/ping** on the signal-cli WS;
    exactly **one** consumer of that socket.
- **Auth** — password (Argon2id) + WebAuthn/YubiKey second factor, **default-on with an
  opt-out and password fallback** (per decision). Hardened session:
  `HttpOnly; Secure; SameSite=Strict` cookie backed by a **server-side, revocable**
  session store (not a self-contained token); absolute lifetime cap + idle timeout;
  "log out all sessions" / rotation path. **Login rate-limiting** (per-IP + global,
  exponential backoff/lockout). **CSRF** protection on all state-changing routes and an
  `Origin` check on the WebSocket upgrade.
- **Message store** — SQLCipher (AES-256) DB caching a rolling ~2-week window:
  conversations, messages, reactions, receipts, and attachment metadata. It is the
  **single source of truth** for browser replay. Key modeling rules:
  - Idempotent **upsert on `(author, timestamp)`** (WS reconnects can redeliver).
  - Reactions and receipts keyed by their target `(author, timestamp)`; **tolerate
    orphans** (target pruned or not-yet-arrived). Group receipts are **per-recipient
    rows**, not a single boolean.
  - Typing indicators are **memory-only** — never persisted or pruned.
  - A scheduled prune job enforces retention.
- **Profile/contact service** — names & avatars are historically the flakiest part of
  signal-cli-rest-api and have no single reliable source on a linked device. Explicit
  work item: fetch-and-cache profiles/contacts, store avatars as files, refresh
  periodically, and **fall back to phone-number display** when a name hasn't synced.
- **Web API** — REST for conversation list and history; a WebSocket that pushes live
  events (new message, receipt, typing, reaction) to the browser. Browser reconnect
  sends a **cursor**; backend replays from the DB (idempotent). Composer receives
  send success/failure feedback from the signal-cli REST call.
- **Attachment proxy** — fetches attachments from signal-cli, stores them encrypted at
  rest, serves them **only to the authenticated session**. Hardening: opaque internal
  IDs mapped through the DB (never client-supplied paths/URLs), verify the attachment
  belongs to a cached message, canonicalize + confine any filesystem path to the store
  dir, no public/guessable attachment URLs. Cap attachment size; **stream to disk** on
  receive rather than buffering large base64 blobs in memory.
- **No-index middleware** — sets `X-Robots-Tag` and standard security headers (CSP,
  HSTS, `X-Content-Type-Options: nosniff`, `frame-ancestors 'none'`,
  `Referrer-Policy: no-referrer`) on every response, and serves `robots.txt` (see §8).
- **Device-state monitor** — detect the "unlinked / errored" signal-cli state (phone
  revoked the device, or key state lost) and surface a re-link QR in the UI.

### 5.3 Frontend — React + TypeScript
- Conversation list: names, avatars, unread badges.
- Message thread view with reactions and read-receipt state.
- Composer: text, send attachment, add reaction.
- Live updates over the browser WebSocket; typing indicators.
- Background notifications (Web Notifications API + title/badge) when a message
  arrives while the tab is not focused. **Default to content-less notifications**
  ("New message") so message text doesn't leak into the work machine's OS notification
  history; showing content is an explicit opt-in.
- `<meta name="robots" content="noindex, nofollow">` in the document head.

## 6. Data flow

- **Inbound (from others):** family sends → Signal → signal-cli decrypts → WS event to
  backend → backend upserts to SQLCipher and pushes over the browser WS → UI + notify.
- **Inbound (own-sent from phone):** user sends from his phone → arrives at the linked
  device as `syncMessage.sentMessage` → backend stores as an **outgoing** message and
  pushes to the browser, so threads stay two-sided across devices.
- **Outbound (from web):** user composes → browser WS/REST → backend → signal-cli REST
  → Signal → family; send success/failure surfaced back to the composer.
- **History / replay:** UI requests a conversation (or reconnects with a cursor) →
  backend serves from SQLCipher (only ever the last ~2 weeks), idempotently.

## 7. Retention

- Rolling **~2-week** window is the maximum stored. A scheduled prune job deletes
  messages, reactions, receipts, and orphaned attachments older than the window.
- Retention is both a UX decision (history need not be long) and a security control
  (limits blast radius of any compromise).

## 8. Discoverability / no-indexing

Defense in depth so the app is never indexed or crawled:

- **`robots.txt`**: `User-agent: *` / `Disallow: /`.
- **`X-Robots-Tag: noindex, nofollow, noarchive`** HTTP header on every response.
- **`<meta name="robots" content="noindex, nofollow">`** in the HTML head.

The auth wall already means crawlers see only a login page; this makes non-indexing
explicit regardless.

## 9. Security & threat model (explicit, documented tradeoffs)

**Core truth:** the server is a Signal endpoint. To display messages it must decrypt
them, so it necessarily holds keys and sees plaintext in memory while running. A
readable web client where the server never sees plaintext is not possible. The design
therefore encrypts data everywhere *except* the moment of use, and minimizes exposure.

**In transit (every hop):**
- Browser ↔ app: HTTPS/TLS via Cloudflare Tunnel; origin never publicly exposed.
- App ↔ signal-cli: private Docker network only, over localhost/Unix socket; never on
  a public interface.
- Signal ↔ world: Signal's own end-to-end encryption, untouched.

**At rest (disk theft / powered-off box):**
- Message cache and attachment store: SQLCipher / encrypted storage (AES-256), key
  supplied at startup and not stored beside the data.
- signal-cli account/key material: encrypted volume (e.g., LUKS) with tight file
  permissions.
- Secrets and encryption keys injected via environment/secret files; never committed,
  never stored in the DB.

**Auth (decision: custom login only — no Cloudflare Access):**
- Password hashed with **Argon2id**.
- **WebAuthn/YubiKey** second factor, **default-on with opt-out and password fallback**
  (works in-browser, no install).
- **Hardened session:** `HttpOnly; Secure; SameSite=Strict` cookie backed by a
  **server-side revocable session store** (not a self-contained token); absolute
  lifetime cap + idle timeout; "log out all sessions" path.
- **Login rate-limiting:** per-IP + global throttle with exponential backoff/lockout
  (Argon2id alone does not stop online guessing).
- **CSRF protection** on all state-changing routes; **`Origin` check** on the WebSocket
  upgrade handshake.
- Since we chose custom-login-only, this app's login page IS internet-reachable, so the
  above hardening (rate-limit, session revocation, CSRF, default-on 2FA) is mandatory,
  not optional.

**Key management (decision: auto-unlock, documented limitation):**
- The SQLCipher key and the LUKS/volume passphrase are read at startup from a
  **protected secret file** on the box (tight perms, `env_file`/Docker `secrets:`,
  excluded from git — never in a committed compose file), so the machine reboots
  unattended after a power blip.
- **Documented consequence:** at-rest encryption therefore protects a disk removed from
  a **powered-off** machine, but does **not** protect a box stolen while running or
  mid-reboot (the key is available on the same disk). Accepted tradeoff in exchange for
  unattended uptime.

**Log hygiene:** app and signal-cli-rest-api log levels set to avoid message bodies,
phone numbers, attachment contents, and the linking QR/token; scrub PII from request
logs and error handlers; do not persist logs unencrypted long-term.

**Backups:** back up **ciphertext only** (encrypted volume / SQLCipher file); the key is
**never co-located** with a backup. If that can't be guaranteed, the policy is
explicitly **no backups** (retention is short anyway).

**Linked-device revocation (blast radius + recovery):** the signal-cli key material is
the critical asset; its compromise allows reading forward messages and sending as the
user until revoked. Because the phone stays primary, recovery is always available:
revoke the device from the phone (Settings → Linked Devices) and re-link a fresh device
(no history backfill). This runbook ships with the deployment docs.

**Documented limitation (running server):** at-rest encryption defends against a stolen
disk or powered-off machine. It does **not** defend against compromise of the *running*
server, because keys are necessarily in memory to display messages. Mitigations:
minimal and patched host (pin the signal-cli-rest-api image to a digest; enable
unattended security updates; periodic image refresh), strong auth, hidden origin
(Cloudflare Tunnel), short retention.

## 10. Hosting & access

- Primary target: a home machine that is on 24/7 (mini-PC, Pi, old desktop).
- Exposure: **Cloudflare Tunnel** for a plain `https://…` URL with real TLS, no
  port-forwarding, and nothing for the user to install. Hides the origin IP.
- Fallback: a small cloud VPS if a home machine proves impractical. The app is
  agnostic to which; only the deployment wrapper changes.

## 11. Scope

**v1 — in:**
- 1:1 and group messaging
- Real-time send/receive of text
- View attachments
- Send attachments *(may drop to v1.1 if it complicates the first build)*
- Reactions (view + send)
- Read receipts
- Typing indicators
- Contact/group names & avatars
- Background notifications
- Rolling ~2-week message store

**Deferred:**
- Message search

## 12. Testing approach

- **Signal adapter:** unit-tested against a mocked signal-cli API (both WS events and
  REST calls).
- **Auth:** password and WebAuthn flows tested in isolation.
- **Retention:** prune job tested deterministically against seeded timestamps.
- **End-to-end smoke path:** link device → receive a message → see it in the UI →
  reply successfully.

## 13. Tech stack

- **Frontend:** React + TypeScript
- **Backend:** Node + TypeScript (Fastify), WebSocket
- **Storage:** SQLCipher via **`better-sqlite3-multiple-ciphers`** (synchronous,
  prebuilt binaries, SQLCipher-compatible). Build the app image on **Debian-slim**
  (not Alpine/musl) so prebuilds resolve; otherwise include `python3`/`build-essential`
  for node-gyp.
- **Signal engine:** `bbernhard/signal-cli-rest-api` in **json-rpc mode**; WS at
  `/v1/receive/{number}` for streaming envelopes, REST for send/attachments/groups/
  contacts/reactions/receipts/typing and QR linking (`/v1/qrcodelink`). Pin to a digest.
- **Packaging:** Docker Compose (private network; app↔engine over localhost/socket).
- **Exposure:** Cloudflare Tunnel (VPS fallback).

## 14. Dev loop & fixtures

signal-cli needs a real linked phone, so CI cannot link a device. To keep the dev loop
fast: during one linking session, **record a handful of real WS envelopes** (inbound
message, reaction, receipt, typing, `syncMessage` sent-from-phone, group update) and
replay them through a fake WS server against the mocked adapter. Use a **dedicated
burner Signal number** — never the real account — for the manual end-to-end smoke test.
The single real-container E2E path stays manual/nightly, not in CI.
