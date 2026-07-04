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
