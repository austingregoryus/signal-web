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
