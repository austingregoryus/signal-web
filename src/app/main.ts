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
import { reconcileConversationAliases } from '../store/reconcile'
import { registerSecurityHeaders } from './securityHeaders'
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

  // One-time reconciliation: fold any number-keyed conversations into their
  // UUID-keyed canonical form (repairs duplicates from before the auto-merge
  // existed). Idempotent — a no-op on a clean store. Non-fatal on failure.
  try {
    const { merged, aliased } = reconcileConversationAliases(store)
    if (merged > 0) console.log(`[store] merged ${merged} duplicate conversation(s); ${aliased} alias(es) recorded`)
  } catch (err) {
    console.warn(`[store] reconcile failed: ${err instanceof Error ? err.message : String(err)}`)
  }

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

  // Default 1 MB body limit everywhere — unauthenticated routes (/auth/login)
  // must not accept huge bodies. The two send routes that carry attachments
  // raise their own limit (see UPLOAD_BODY_LIMIT in api/rest.ts).
  const app = Fastify({ trustProxy: config.trustProxy })

  // Baseline security headers on EVERY response. Per-route headers (attachment
  // CSP, /link harden()) override since the hook only sets a header the response
  // doesn't already carry.
  registerSecurityHeaders(app, config.publicUrl)

  await app.register(fastifyWebsocket)

  // Liveness probe for the Docker HEALTHCHECK + orchestrators. Unauthenticated
  // by design — it returns only a static status, no data.
  app.get('/health', async () => ({ status: 'ok' }))
  await authPlugin(app, {
    store,
    sessionPolicy: { ttlMs: config.sessionTtlDays * DAY, idleMs: config.sessionIdleDays * DAY },
    rateLimit: { maxPerKey: 5, windowMs: 60_000, lockoutMs: 15 * 60_000, maxGlobal: 200 },
    webauthn: { rpId: config.rpId, rpName: 'Signal Web', origin: config.rpOrigin },
    secureCookies: config.secureCookies,
  })
  registerRestApi(app, { store, client, selfId, blobs })
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
    store, hub, allowedOrigin: config.allowedOrigins,
    sessionPolicy: { ttlMs: config.sessionTtlDays * DAY, idleMs: config.sessionIdleDays * DAY },
  })

  // periodic maintenance
  setInterval(() => { void profile.refresh() }, 10 * 60_000).unref()
  setInterval(() => {
    const result = pruneOlderThan(store, Date.now())
    if (result.attachmentIds.length > 0) {
      void Promise.all(result.attachmentIds.map((id) => blobs.delete(id)))
    }
  }, 60 * 60_000).unref()
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
    // Don't print the full /link?t=TOKEN URL to stdout — container logs are
    // often shipped to aggregators and the token is the only thing gating
    // device linking before a password is set. Tell the operator where to look
    // and that they must supply the token themselves.
    const hint = process.env.LINK_BOOTSTRAP_TOKEN
      ? 'Set LINK_BOOTSTRAP_TOKEN in .env, then open this URL in a browser:'
      : 'Set LINK_BOOTSTRAP_TOKEN in .env to a value you choose, then open this URL in a browser:'
    console.log(`[link] Linking page is open (no password set yet). ${hint}`)
    console.log(`[link]   ${config.publicUrl}/link?t=<LINK_BOOTSTRAP_TOKEN>`)
    console.log('[link] Once linked, set a password (npm run set-password), then set ENABLE_LINK_PAGE=false.')
  }
}
