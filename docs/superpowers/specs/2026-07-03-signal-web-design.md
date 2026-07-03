# Signal Web — Design Spec

**Date:** 2026-07-03
**Status:** Approved design — pending implementation plan
**Author:** Austin (with Claude)

## 1. Purpose

A self-hosted web client that lets a specific, single user (Austin's dad) read and
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
        Work browser (dad)
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
  a clean internal interface, not on signal-cli directly.
- **Auth** — password (Argon2id) + optional WebAuthn/YubiKey second factor;
  long-lived encrypted session cookie.
- **Message store** — SQLCipher (AES-256) DB caching a rolling ~2-week window:
  conversations, messages, reactions, receipts, and attachment metadata. A scheduled
  prune job enforces retention.
- **Web API** — REST for conversation list and history; a WebSocket that pushes live
  events (new message, receipt, typing, reaction) to the browser.
- **Attachment proxy** — fetches attachments from signal-cli, stores them encrypted at
  rest, and serves them only to the authenticated session.
- **No-index middleware** — sets `X-Robots-Tag` on every response and serves
  `robots.txt` (see §8).

### 5.3 Frontend — React + TypeScript
- Conversation list: names, avatars, unread badges.
- Message thread view with reactions and read-receipt state.
- Composer: text, send attachment, add reaction.
- Live updates over the browser WebSocket; typing indicators.
- Background notifications (Web Notifications API + title/badge) when a message
  arrives while the tab is not focused.
- `<meta name="robots" content="noindex, nofollow">` in the document head.

## 6. Data flow

- **Inbound:** family sends → Signal → signal-cli decrypts → WS event to backend →
  backend writes to SQLCipher and pushes over the browser WS → UI updates + notify.
- **Outbound:** user composes → browser WS/REST → backend → signal-cli REST → Signal
  → family.
- **History:** UI requests a conversation → backend serves from SQLCipher (only ever
  the last ~2 weeks).

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

**Auth:**
- Password hashed with **Argon2id**.
- Optional **WebAuthn/YubiKey** second factor (works in-browser, no install).
- Encrypted, long-lived session cookie to minimize login friction.

**Documented limitation:** at-rest encryption defends against a stolen disk or
powered-off machine. It does **not** defend against compromise of the *running*
server, because keys are necessarily in memory to display messages. Mitigations:
minimal and patched host, strong auth, hidden origin (Cloudflare Tunnel), and the
short retention window.

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
- **Storage:** SQLCipher (encrypted SQLite)
- **Signal engine:** `bbernhard/signal-cli-rest-api` (JSON-RPC mode)
- **Packaging:** Docker Compose
- **Exposure:** Cloudflare Tunnel (VPS fallback)
