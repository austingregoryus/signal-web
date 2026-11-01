import { openStore } from './store/store'
import { loadConfig } from './config'

// Key-loss recovery: removes every registered security key / passkey so login
// falls back to password-only, and signs out all sessions. Run on the server:
//   docker compose exec app npm run reset-security-keys
function main(): void {
  const config = loadConfig()
  const store = openStore(config.dbPath, config.dbKey)
  const removed = store.webauthn.clearAll()
  store.sessions.revokeAll()
  store.close()
  console.log(`[reset-security-keys] removed ${removed} security key(s); all sessions signed out`)
}

try {
  main()
} catch (err: unknown) {
  console.error(`[reset-security-keys] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
