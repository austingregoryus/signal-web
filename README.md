# Signal Web

Self-hosted web client that links to Signal (via signal-cli) so a single user can read
and send messages from a browser. See the design spec in
`docs/superpowers/specs/` and the roadmap in `docs/superpowers/plans/`.

## Prerequisites
- Docker + Docker Compose
- A phone with Signal installed (stays the primary device)

## First-time setup
1. Create `.env` (set `SIGNAL_NUMBER` to the phone's number in E.164, e.g. `+15551234567`,
   and keep the generated `DB_KEY`). An `.env` is created for you on first run if missing.
2. Enable the linking page for bootstrap: set `ENABLE_LINK_PAGE=true` in `.env`
   (it is **off by default** so a public deployment isn't exposed).
3. **Link the device (one-time), using the linking override.** `signal-cli-rest-api`'s
   normal `json-rpc` mode can't link a device, so this override runs it in `normal` mode
   just for linking:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.link.yml up --build
   ```
   Wait ~60–90s for signal-cli to finish booting. In the app logs you'll see:
   ```
   [link] Open http://localhost:8090/link?t=XXXXXXXX to link your device.
   ```
   **Open that URL** (it carries a one-time bootstrap token). Scan the QR from
   **Signal → Settings → Linked Devices → Link New Device**, and wait until the phone
   shows the new `signal-web` device. (The app's receiver will log errors here — expected
   in `normal` mode; you only need the QR.)
4. **Stop (Ctrl-C) and run the normal stack** (`json-rpc`, for the live message stream):
   ```bash
   docker compose up -d
   ```
   Within ~30s the app logs `[signal] connected to signal-cli` and messages start flowing
   into the encrypted store automatically.

(The browser UI for reading/sending — Milestone 5 — is not built yet; until then the app
is API-only.)

## Notes
- A linked device only receives messages from the moment of linking forward; there is no
  history backfill.
- **The linking page is locked down by default.** It is only registered when
  `ENABLE_LINK_PAGE=true`; before a password is set it requires the one-time token from the
  startup log; once a password is set it requires a full admin session. Bootstrap on
  localhost, then set a password (`docker compose exec -e NEW_PASSWORD=… app npm run set-password`)
  before exposing the app publicly. You can set `ENABLE_LINK_PAGE=false` again after linking.
- For production behind HTTPS, set `PUBLIC_URL` to your https URL and `SECURE_COOKIES=true`.
- To unlink: Signal → Settings → Linked Devices → remove `signal-web`.
- Logs never contain message bodies or phone numbers by design.
