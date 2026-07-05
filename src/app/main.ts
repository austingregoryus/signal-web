import { randomBytes } from 'node:crypto'
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
import { registerLinkRoute } from '../api/linkRoute'
import { registerStaticSite } from '../api/static'
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

  // Live connection state of the signal-cli receiver, surfaced on the linking page.
  const signalState = { connected: false }
  const receiver = new SignalReceiver({
    wsBaseUrl: config.signalWsUrl,
    signalNumber: config.signalNumber,
    onEvent: (ev) => bridge.handleEnvelope(ev.raw),
    onOpen: () => { signalState.connected = true; console.log('[signal] connected to signal-cli') },
    onClose: (code) => { signalState.connected = false; console.log(`[signal] disconnected (code=${code})`) },
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

  // Linking page (/link) — OFF by default; opt in with ENABLE_LINK_PAGE=true.
  // Before a password is set it requires a one-time bootstrap token (printed below);
  // once a password exists it requires a full admin session.
  const linkEnabled = (process.env.ENABLE_LINK_PAGE ?? 'false') === 'true'
  const bootstrapToken = process.env.LINK_BOOTSTRAP_TOKEN ?? randomBytes(16).toString('base64url')
  const sessionPolicy = { ttlMs: config.sessionTtlDays * DAY, idleMs: config.sessionIdleDays * DAY }
  registerLinkRoute(app, {
    client,
    deviceName: process.env.DEVICE_NAME ?? 'signal-web',
    status: () => signalState.connected,
    enabled: linkEnabled,
    passwordIsSet: () => store.authConfig.getPasswordHash() != null,
    sessionIsFull: (token) =>
      token != null && store.sessions.validate(token, Date.now(), sessionPolicy) && store.sessions.getLevel(token) === 'full',
    bootstrapToken,
  })
  await registerBrowserWs(app, {
    store, hub, allowedOrigin: config.allowedOrigin,
    sessionPolicy: { ttlMs: config.sessionTtlDays * DAY, idleMs: config.sessionIdleDays * DAY },
  })

  // periodic maintenance
  setInterval(() => { void profile.refresh() }, 10 * 60_000).unref()
  setInterval(() => { pruneOlderThan(store, Date.now()) }, 60 * 60_000).unref()
  void profile.refresh()

  const webDir = process.env.WEB_DIR ?? './web/dist'
  try {
    await registerStaticSite(app, { dir: webDir })
  } catch (err) {
    console.warn(`[app] static site not served (${err instanceof Error ? err.message : String(err)})`)
  }

  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`[app] listening on :${config.port}`)
  if (linkEnabled && store.authConfig.getPasswordHash() == null) {
    console.log(`[link] Open ${config.publicUrl}/link?t=${bootstrapToken} to link your device.`)
  }
}
