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
2. `docker compose up --build`
3. **Open the linking page in your browser: <http://localhost:8090/link>**
   It shows the QR code directly — scan it from the phone via
   **Signal → Settings → Linked Devices → Link New Device**.
   The page shows a live **✅ Connected** indicator once the server links (usually within
   ~30 seconds — no restart needed, the app auto-reconnects). Use *Regenerate QR* if the
   code expires before you scan it.

That's it. Messages then flow into the encrypted store automatically. (The browser UI for
reading/sending — Milestone 5 — is not built yet; until then the app is API-only.)

## Notes
- A linked device only receives messages from the moment of linking forward; there is no
  history backfill.
- The linking page is a bootstrap convenience and is unauthenticated. On a public
  deployment, set `ENABLE_LINK_PAGE=false` in `.env` once the device is linked.
- For production behind HTTPS, set `PUBLIC_URL` to your https URL and `SECURE_COOKIES=true`.
- To unlink: Signal → Settings → Linked Devices → remove `signal-web`.
- Logs never contain message bodies or phone numbers by design.
