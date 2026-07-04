import { loadConfig } from './config'
import { buildServer } from './server'
import { SignalReceiver } from './signal/receiver'

async function main(): Promise<void> {
  const config = loadConfig()
  const app = buildServer()

  const receiver = new SignalReceiver({
    wsBaseUrl: config.signalWsUrl,
    signalNumber: config.signalNumber,
    onEvent: (ev) => {
      // Log hygiene (spec §9): kind + timestamp only. Never bodies or numbers.
      const ts = ev.raw.envelope?.timestamp ?? 'n/a'
      console.log(`[signal] envelope kind=${ev.kind} ts=${ts}`)
    },
    onError: (err) => console.error(`[signal] receiver error: ${err.message}`),
  })
  receiver.start()

  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`[app] listening on :${config.port}`)
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[app] fatal: ${message}`)
  process.exit(1)
})
