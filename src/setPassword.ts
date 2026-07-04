import { openStore } from './store/store'
import { hashPassword } from './auth/password'

async function main(): Promise<void> {
  const dbPath = process.env.DB_PATH
  const dbKey = process.env.DB_KEY
  const password = process.env.NEW_PASSWORD
  if (!dbPath || !dbKey) throw new Error('DB_PATH and DB_KEY are required')
  if (!password || password.length < 8) throw new Error('NEW_PASSWORD is required (min 8 chars)')

  const store = openStore(dbPath, dbKey)
  store.authConfig.setPasswordHash(await hashPassword(password))
  store.close()
  console.log('[set-password] password updated')
}

main().catch((err: unknown) => {
  console.error(`[set-password] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
