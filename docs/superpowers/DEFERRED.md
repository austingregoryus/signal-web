# Signal Web — Deferred Items (carry-forward across milestones)

Cross-milestone TODOs surfaced during reviews. Each names the milestone that should resolve it.

## For Milestone 6 (deploy hardening)
- **Native prebuild in Docker/CI.** The dev box's global `~/.npmrc` has
  `ignore-scripts=true`, which skips `better-sqlite3-multiple-ciphers`' prebuilt-binary
  download. The Docker image / CI must allow install scripts (or run `prebuild-install`)
  so the native binary is fetched. (M2 T1 review.)
- **Dockerfile hardening.** Runs as root, no `HEALTHCHECK`, uses `npm install --omit=dev`
  rather than `npm ci`. (M1 T6 + M2 T1 reviews.)
- **link.ts config source.** Reads `DEVICE_NAME` via `process.env` directly rather than
  through `loadConfig`. (M1 T6 review.)

## Minor / opportunistic (any milestone touching the area)
- **Prune window uses sender `timestamp`, not `received_at`.** A message with an old
  sender clock but recent receipt is pruned immediately. Matches spec wording; revisit if
  clock-skew causes surprises. (M2 final review.)
- **Test temp-DB cleanup** removes the main `.db` file but not WAL `-wal`/`-shm` sidecars
  (harmless tmpdir leakage). (M2 T1 review.)
- **`messages.upsert` named-param `.run(obj)` coupling** — would throw if `MessageInput`
  gains fields not in the SQL. Style/robustness only. (M2 T2/T4 reviews.)
- **`loadConfig` empty-string env** (`SIGNAL_API_URL=""`/`PORT=""`) bypasses defaults via
  `??`. (M1 T2 review.)

## Added after Milestone 3 (auth)

### For Milestone 4 (web API / WS)
- **Wire the WS origin guard.** `isAllowedOrigin` (src/auth/csrf.ts) is defined + tested but
  not yet used — enforce it on the WebSocket upgrade handshake when the WS route lands.
- **`trustProxy`.** The auth rate limiter keys on `req.ip`. Behind the Cloudflare Tunnel,
  Fastify must be configured with `trustProxy` (or an explicit forwarded-header parse) or
  per-IP lockout degrades to global-only. Set this when the app server is wired.

### For Milestone 5 (frontend) / auth UX
- **`GET /auth/status` and pending sessions.** It currently reports `authenticated:true` for a
  pending (password-only, 2FA-not-completed) session. The frontend must treat only a `full`
  session as logged-in; consider returning the session `level` explicitly.

### Recovery / ops
- **WebAuthn key-loss recovery.** Once a credential is registered, login requires the key
  (pending→full step-up). If the physical key is lost, the user is locked out. Add an admin
  CLI path (like set-password) to clear registered credentials and fall back to password-only.

### Minor / opportunistic
- **Rate-limiter key eviction** (unbounded `keys` map) and **global-cap self-DoS** (a burst of
  failures across many IPs can lock out the real user) — both low-risk for a single-user tunnel.
- **Unused `SessionRow` type** in src/store/sessions.ts.
- **Global-cap `retryAfterMs`** is a fixed `windowMs`; no test for global-window pruning.
- **`store.test.ts`** tests lack try/finally around `close()` (test-isolation fragility).

## Added after Milestone 4 (web API & bridge)

### Deployment (M6)
- **~~Must sit behind a trusted reverse proxy.~~ RESOLVED (security review 2026-07-07).**
  `trustProxy` previously defaulted to the boolean `true`, which trusts the *entire*
  `X-Forwarded-For` chain — a client could inject a forged leftmost entry to make `req.ip`
  arbitrary and reset per-IP login lockout (bounded only by the global cap), *even behind the
  tunnel*. Being behind Cloudflare does not fix this: the bug is trusting attacker-injected hops
  earlier than cloudflared's own. `TRUST_PROXY` is now a trusted-hop **count** (default `1` = the
  cloudflared sidecar), so Fastify resolves `req.ip` to cloudflared's reported client IP and
  ignores forged prefixes. Still don't expose the origin port directly.
  **Superseded (review 2026-11-01):** Fastify ≤5.12.0 let hop-count trust be spoofed
  (GHSA-3m5p-2c4r-xxw2), and Fastify 5.12.x now ignores numeric `trustProxy` entirely
  (fails closed: every request shares the proxy's IP, so one attacker could lock out the
  real user). `TRUST_PROXY` is now an IP/CIDR list defaulting to `loopback,uniquelocal`;
  a numeric value is rejected at startup.

### Frontend / client contract (M5)
- **Live events are "pokes."** The bridge broadcasts minimal live events
  (`{type:'message', timestamp}`, reaction/receipt without conversationId) — the browser must
  REST-refetch the affected conversation on a poke. Cursor replay, by contrast, sends full
  message rows. The M5 client must handle both shapes.
- **Replay is not exhaustive.** `hub.replay` fetches the newest N (200) per conversation then
  filters `> cursor`; after a long, busy disconnect (>200 new msgs in one conversation), the
  gap isn't fully replayed. The client should reconcile via REST history, not rely on replay
  alone.

### Correctness / robustness (opportunistic)
- **selfId auto-detection** still depends on the real `/v1/accounts` shape; the reliable path
  is the `SIGNAL_SELF_UUID` override. Consider capturing selfId from the first sync-sent
  envelope's sourceUuid at runtime as a fully-automatic alternative.
- **Send-timestamp fallback** (`Date.now()` when `/v2/send` returns none) can create a
  duplicate row vs the later sync-sent envelope (different timestamp keys).
- **Receiver `start()`** should `clearHeartbeat()` + close any prior socket at the top
  (latent double-heartbeat if start() is called twice without an intervening close).
- **Heartbeat has no pong/liveness timeout** — a half-open socket relies on TCP/close.
- **Attachment blob store** derives its key as `sha256(dbKey)`; prefer HKDF with a distinct
  context string for independent key material.
- **No test asserts** the attachment blob file is ciphertext on disk (round-trip is tested).

## Added after Milestone 5 (frontend) — all Minor, deferred

- **`useAuth` probe treats any error as `anon`** (incl. backend-down/500), and has a no-op
  ternary. Should distinguish "not logged in" from "backend unreachable" (retry/error state).
- **`Message.module.css` missing `.body`/`.edited`** classes referenced in Message.tsx →
  `class="undefined"` (no dedicated styling for the body span / "edited" marker). Cosmetic.
- **Typing indicator not conversation-scoped:** any `typing` poke shows "…" in whatever
  thread is open, even if the typist is in another conversation.
- **Stale `conv` race** in Chat.onSend could default a group to `'dm'` if the conversation
  list is transiently empty while a selection persists (very low likelihood).
- **Bare `FormEvent`/`KeyboardEvent`/`ChangeEvent` imports** from 'react' (React 19 prefers
  `React.*`). Cosmetic.
- **No outbound read receipts / typing:** `/api/read` and `/api/typing` exist on the backend
  but the frontend doesn't call them (display-only was the planned M5 scope). Wire outbound
  read receipts + typing when desired.
