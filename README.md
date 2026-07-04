# Signal Web

Self-hosted web client that links to Signal (via signal-cli) so a single user can read
and send messages from a browser. See the design spec in
`docs/superpowers/specs/` and the roadmap in `docs/superpowers/plans/`.

## Prerequisites
- Docker + Docker Compose
- A phone with Signal installed (stays the primary device)

## First-time setup
1. `cp .env.example .env` and set `SIGNAL_NUMBER` (E.164, e.g. `+15551234567`).
2. `docker compose up -d --build`
3. Generate and scan the linking QR:
   ```bash
   docker compose exec app npx tsx src/signal/link.ts
   docker compose cp app:/app/link-qr.png ./link-qr.png
   ```
   Open `link-qr.png` and scan: **Signal → Settings → Linked Devices → Link New Device**.
4. `docker compose logs -f app` — send a test message; you should see
   `envelope kind=data` (inbound) and `envelope kind=sync-sent` (sent from your phone).

## Notes
- A linked device only receives messages from the moment of linking forward; there is no
  history backfill.
- To unlink: Signal → Settings → Linked Devices → remove `signal-web`.
- Logs never contain message bodies or phone numbers by design.
