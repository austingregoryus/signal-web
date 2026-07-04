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
3. `docker compose up --build`
4. In the startup logs you'll see a line like:
   ```
   [link] Open http://localhost:8090/link?t=XXXXXXXX to link your device.
   ```
   **Open that URL** (it carries a one-time bootstrap token). The page shows the QR code —
   scan it from the phone via **Signal → Settings → Linked Devices → Link New Device**.
   A live **✅ Connected** indicator appears once the server links (usually within ~30s — no
   restart needed, the app auto-reconnects). Use *Regenerate QR* if the code expires first.

That's it. Messages then flow into the encrypted store automatically. (The browser UI for
reading/sending — Milestone 5 — is not built yet; until then the app is API-only.)

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
