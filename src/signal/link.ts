import { writeFile } from 'node:fs/promises'
import { loadConfig } from '../config'

async function main(): Promise<void> {
  const config = loadConfig()
  const deviceName = process.env.DEVICE_NAME ?? 'signal-web'
  const url = `${config.signalApiUrl}/v1/qrcodelink?device_name=${encodeURIComponent(deviceName)}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`qrcodelink failed: ${res.status} ${res.statusText}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile('link-qr.png', buf)

  console.log('[link] wrote link-qr.png — open it and scan from your phone:')
  console.log('[link] Signal → Settings → Linked Devices → Link New Device')
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[link] error: ${message}`)
  process.exit(1)
})
