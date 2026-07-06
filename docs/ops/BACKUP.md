# Backup & Recovery

What to back up, how, and what to do when something is lost.

## What needs backing up

| Item | Location | Why |
|---|---|---|
| **Encrypted message DB + attachment blobs** | `./data/` (the bind mount) | All your messages. SQLCipher-encrypted at rest; the `DB_KEY` is the only thing that can decrypt it. |
| **`DB_KEY`** | The value of `DB_KEY` in your `.env` | **Critical.** Without it the DB is unrecoverable. Store it in your password manager, NOT in the same place as the DB backup. |
| **signal-cli device identity** | The `signal-cli-data` Docker named volume (`/var/lib/docker/volumes/...`) | Holds the Signal device keys for your linked device. If lost, you must re-link (which invalidates the old device). |
| **`LINK_BOOTSTRAP_TOKEN`** (if set) | The value in `.env` | Only needed if you haven't set a password yet. After password setup, low value. |

## What does NOT need backing up

- The app code — it's in git.
- The built frontend (`web/dist`) — rebuilt from source on every deploy.
- The signal-cli-rest-api image — pulled from Docker Hub (digest-pinned).

## Recommended: restic to off-site storage

`restic` handles encryption, dedup, and incremental snapshots. Point it at any
S3-compatible bucket, B2, or a remote rsync target. Example cron:

```bash
# /etc/cron.d/signal-web-backup
# Back up the encrypted data dir nightly at 3am. The DB_KEY is NOT included —
# store it separately in your password manager.
0 3 * * * root RESTIC_REPOSITORY=s3:s3.amazonaws.com/your-bucket/signal-web \
            RESTIC_PASSWORD_FILE=/root/.restic-pass \
            restic backup /opt/signal-web/data
# Retention: keep 7 daily, 4 weekly, 6 monthly snapshots.
15 3 * * * root RESTIC_REPOSITORY=s3:s3.amazonaws.com/your-bucket/signal-web \
            RESTIC_PASSWORD_FILE=/root/.restic-pass \
            restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
```

The signal-cli volume needs `docker run --rm -v signal-cli-data:/data ...` style
backup; snapshot it less frequently (it rarely changes):

```bash
docker run --rm -v signal-cli-data:/data -v /opt/backups:/backup alpine \
  tar czf /backup/signal-cli-data-$(date +%F).tgz -C /data .
```

## Recovery

### Lost the VM / want to migrate
1. Provision a new VM, follow `DEPLOY.md` to install Docker + clone the repo.
2. Restore `./data/` from the restic snapshot.
3. Restore the `signal-cli-data` volume from the tarball:
   `docker volume create signal-cli-data && docker run --rm -v signal-cli-data:/data -v /opt/backups:/backup alpine tar xzf /backup/signal-cli-data-<date>.tgz -C /data`
4. Set `DB_KEY` in `.env` to the original value (from your password manager).
5. `docker compose up -d --build`.

### Lost `DB_KEY`
**The DB is unrecoverable.** Restore `DB_KEY` from your password manager. If you
genuinely lost it, you must re-link the device (which creates a new empty DB)
and accept that historical messages are gone — Signal servers don't re-deliver
history to a freshly-linked device beyond what's in the user's existing devices.

### Lost the signal-cli device keys (the named volume)
Re-link the device: temporarily set `ENABLE_LINK_PAGE=true`, run the linking
override compose (`docker-compose.link.yml`), scan the QR from your phone, set a
password, then `ENABLE_LINK_PAGE=false`. The old device is automatically
invalidated on your phone's "Linked Devices" list.

### Suspected compromise of the linked device
On your phone: **Settings → Linked Devices → [the device] → Revoke**. This
immediately cuts off the linked session. Then re-link a fresh device (above) and
rotate `DB_KEY` + password.
