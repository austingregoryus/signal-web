import { main } from './app/main'

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[app] fatal: ${message}`)
  process.exit(1)
})
