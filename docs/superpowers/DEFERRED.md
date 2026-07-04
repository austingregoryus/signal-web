# Signal Web — Deferred Items (carry-forward across milestones)

Cross-milestone TODOs surfaced during reviews. Each names the milestone that should resolve it.

## For Milestone 4 (web API / live sync wiring)
- **Synced own-device edits.** signal-cli delivers edits made from the phone as
  `syncMessage.sentMessage.editMessage`, but `parseEnvelope` currently only handles
  top-level `envelope.editMessage`. Own-device edits won't apply until the sync path is
  modeled. (M2 T6 review.)

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
- **Must sit behind a trusted reverse proxy.** `trustProxy` defaults true; if the app were
  exposed directly, a client could spoof `X-Forwarded-For` to reset per-IP login lockout
  (bounded by the global cap). Our target IS behind a Cloudflare Tunnel, so this holds —
  document it and don't expose the origin directly.

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
