# Signal Web — Implementation Roadmap

Maps the approved spec (`docs/superpowers/specs/2026-07-03-signal-web-design.md`) into
milestones. Each milestone is an independently testable slice with its own detailed
plan file. Built in dependency order; each one leaves the system in a working state.

| # | Milestone | Delivers | Plan file |
|---|-----------|----------|-----------|
| 1 | **Skeleton & device linking** | Monorepo scaffold, Docker Compose (signal-cli-rest-api + app), Fastify `/health`, config loader, QR link flow, a WS consumer that logs real inbound envelopes. Proof: link the phone, send a message, see it logged. | `2026-07-03-signal-web-01-skeleton-linking.md` |
| 2 | **Signal adapter & encrypted store** | SQLCipher store (`better-sqlite3-multiple-ciphers`), data model (conversations/messages/reactions/receipts/attachments), the adapter that ingests **all** envelope types incl. `syncMessage` own-sent, dedup upsert on `(author,timestamp)`, `remoteDelete`/`editMessage`. Fixture-replay tests. | *(written at M2)* |
| 3 | **Auth & session hardening** | Argon2id password, WebAuthn/YubiKey default-on + fallback, server-side revocable sessions, login rate-limiting, CSRF, WS `Origin` check. | *(written at M3)* |
| 4 | **Web API & real-time bridge** | REST (conversation list, history), browser WebSocket with cursor replay, profile/contact service (names+avatars w/ number fallback), hardened attachment proxy, device-state monitor. | *(written at M4)* |
| 5 | **React frontend** | Conversation list, thread view, composer (text/attachment/reactions), typing indicators, receipts, content-less notifications, re-link QR screen. | *(written at M5)* |
| 6 | **Hardening & deployment** | Cloudflare Tunnel, security headers, `robots.txt`/no-index, retention prune job, key-management secret files, image pinning, backup + revocation runbooks. | *(written at M6)* |

## Milestone ordering rationale

- **M1 before all**: nothing can be built or tested without the containers running and a
  real envelope stream to develop against.
- **M2 before M3/M4**: the store and adapter are the substrate the API and auth attach to.
- **M3 before M4's browser-facing routes**: routes must be auth-gated from first exposure.
- **M5 after M4**: the frontend consumes the M4 API/WS contract.
- **M6 last**: deployment hardening wraps a working app; retention/prune needs the M2 store.

## Cross-cutting invariants (every milestone honors)

- TDD: failing test → minimal impl → passing test → commit.
- No message bodies / phone numbers / QR tokens in logs (§9 log hygiene).
- Secrets via `env_file`/Docker `secrets:`, never committed.
- signal-cli-rest-api image pinned to a digest.
- App image built on Debian-slim (not Alpine) for native module prebuilds.
