import { openStore } from './store/store'
import { hashPassword } from './auth/password'
import { loadConfig } from './config'

async function main(): Promise<void> {
  const password = process.env.NEW_PASSWORD
  if (!password || password.length < 8) throw new Error('NEW_PASSWORD is required (min 8 chars)')

  // Use the same config the app uses (DB_KEY required; DB_PATH defaults to ./data/...).
  const config = loadConfig()
  const store = openStore(config.dbPath, config.dbKey)
  store.authConfig.setPasswordHash(await hashPassword(password))
  store.close()
  console.log('[set-password] password updated')
}

main().catch((err: unknown) => {
  console.error(`[set-password] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
