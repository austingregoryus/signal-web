export interface AppConfig {
  port: number
  signalNumber: string
  signalApiUrl: string
  signalWsUrl: string
  selfUuid: string
  dbPath: string
  dbKey: string
  publicUrl: string
  allowedOrigin: string
  allowedOrigins: string[]
  rpId: string
  rpOrigin: string
  attachmentDir: string
  secureCookies: boolean
  trustProxy: number | boolean
  sessionTtlDays: number
  sessionIdleDays: number
}

function parseTrustProxy(raw: string | undefined): number | boolean {
  if (raw === undefined) return 1
  if (raw === 'false') return false
  if (raw === 'true') return true
  const hops = Number(raw)
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error('TRUST_PROXY must be "false", "true", or a non-negative integer hop count')
  }
  return hops
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const signalNumber = env.SIGNAL_NUMBER
  if (!signalNumber) throw new Error('SIGNAL_NUMBER is required (E.164, e.g. +15551234567)')
  if (!/^\+[1-9]\d{6,14}$/.test(signalNumber)) {
    throw new Error('SIGNAL_NUMBER must be E.164 format, e.g. +15551234567')
  }
  const signalApiUrl = env.SIGNAL_API_URL ?? 'http://signal-cli-rest-api:8080'
  const publicUrl = env.PUBLIC_URL ?? 'http://localhost:8090'
  const rpOrigin = env.RP_ORIGIN ?? publicUrl
  const dbKey = env.DB_KEY ?? ''
  if (!dbKey) throw new Error('DB_KEY is required (encryption key for the SQLCipher store)')
  return {
    port: Number(env.PORT ?? 8090),
    signalNumber,
    signalApiUrl,
    signalWsUrl: signalApiUrl.replace(/^http/, 'ws'),
    selfUuid: env.SIGNAL_SELF_UUID ?? '',
    dbPath: env.DB_PATH ?? './data/signal-web.db',
    dbKey,
    publicUrl,
    allowedOrigin: env.ALLOWED_ORIGIN ?? publicUrl,
    allowedOrigins: (env.ALLOWED_ORIGIN ?? publicUrl).split(',').map((s) => s.trim()).filter(Boolean),
    rpId: env.RP_ID ?? new URL(rpOrigin).hostname,
    rpOrigin,
    attachmentDir: env.ATTACHMENT_DIR ?? './data/attachments',
    secureCookies: (env.SECURE_COOKIES ?? 'true') !== 'false',
    // Number of trusted reverse-proxy hops in front of us, counted from the
    // socket peer inward. Behind a Cloudflare Tunnel the only hop is the
    // cloudflared sidecar, so the default is 1 — this makes Fastify resolve
    // req.ip to cloudflared's reported client IP and IGNORE any attacker-
    // supplied X-Forwarded-For entries earlier in the chain. Setting a boolean
    // (TRUST_PROXY=true) would trust the entire forged chain and let clients
    // spoof req.ip to bypass the login rate limiter. TRUST_PROXY=false disables.
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
    sessionIdleDays: Number(env.SESSION_IDLE_DAYS ?? 7),
  }
}
