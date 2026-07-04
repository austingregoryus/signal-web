import Fastify from 'fastify'
import { loadConfig } from '../config'
import { openStore } from '../store/store'
import { SignalClient } from '../signal/client'
import { resolveSelfId } from '../signal/selfId'
import { SignalReceiver } from '../signal/receiver'
import { BrowserHub } from '../api/hub'
import { LiveBridge } from '../signal/bridge'
import { authPlugin } from '../auth/plugin'
import { registerRestApi } from '../api/rest'
import { registerBrowserWs } from '../api/wsRoute'
import { registerAttachmentRoute } from '../api/attachments'
import { AttachmentBlobStore } from '../store/attachmentsBlob'
import { ProfileService } from '../profile/service'
import { pruneOlderThan } from '../store/prune'
import fastifyWebsocket from '@fastify/websocket'

const DAY = 24 * 3600_000

export async function main(): Promise<void> {
  const config = loadConfig()
  const store = openStore(config.dbPath, config.dbKey)
  const client = new SignalClient({ apiUrl: config.signalApiUrl, number: config.signalNumber })
  const selfId = await resolveSelfId(client, config.signalNumber, config.selfUuid)
  const hub = new BrowserHub()
  const bridge = new LiveBridge({ store, hub, selfId })
  const blobs = new AttachmentBlobStore(config.attachmentDir, config.dbKey)
  const profile = new ProfileService({ store, client, avatarDir: config.attachmentDir })

  const receiver = new SignalReceiver({
    wsBaseUrl: config.signalWsUrl,
    signalNumber: config.signalNumber,
    onEvent: (ev) => bridge.handleEnvelope(ev.raw),
    onOpen: () => console.log('[signal] connected to signal-cli'),
    onClose: (code) => console.log(`[signal] disconnected (code=${code})`),
    onError: (err) => console.error(`[signal] receiver error: ${err.message}`),
    reconnect: { minDelayMs: 1000, maxDelayMs: 30_000 },
    heartbeatMs: 30_000,
  })
  receiver.start()

  const app = Fastify({ trustProxy: config.trustProxy })
  await app.register(fastifyWebsocket)
  await authPlugin(app, {
    store,
    sessionPolicy: { ttlMs: config.sessionTtlDays * DAY, idleMs: config.sessionIdleDays * DAY },
    rateLimit: { maxPerKey: 5, windowMs: 60_000, lockoutMs: 15 * 60_000, maxGlobal: 200 },
    webauthn: { rpId: config.rpId, rpName: 'Signal Web', origin: config.rpOrigin },
    secureCookies: config.secureCookies,
  })
  registerRestApi(app, { store, client, selfId })
  registerAttachmentRoute(app, { store, client, blobs })
  await registerBrowserWs(app, {
    store, hub, allowedOrigin: config.allowedOrigin,
    sessionPolicy: { ttlMs: config.sessionTtlDays * DAY, idleMs: config.sessionIdleDays * DAY },
  })

  // periodic maintenance
  setInterval(() => { void profile.refresh() }, 10 * 60_000).unref()
  setInterval(() => { pruneOlderThan(store, Date.now()) }, 60 * 60_000).unref()
  void profile.refresh()

  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`[app] listening on :${config.port}`)
}
