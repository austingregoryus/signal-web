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
  trustProxy: string | boolean
  sessionTtlDays: number
  sessionIdleDays: number
  /** Delete messages older than this many days; 0 = keep forever. */
  retentionDays: number
}

function parseRetentionDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 14
  const days = Number(raw)
  if (!Number.isFinite(days) || days < 0) {
    throw new Error('MESSAGE_RETENTION_DAYS must be a number of days >= 0 (0 = keep forever)')
  }
  return days
}

// Default: trust only proxies on loopback or private (RFC 1918 / ULA) addresses.
// The cloudflared sidecar reaches the app over the private Docker network, so
// its forwarded client IP is honoured; a public address in the chain is never
// trusted, so a forged X-Forwarded-For prefix can't move req.ip.
const DEFAULT_TRUST_PROXY = 'loopback,uniquelocal'

function parseTrustProxy(raw: string | undefined): string | boolean {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRUST_PROXY
  if (raw === 'false') return false
  if (raw === 'true') return true
  // Fastify >= 5.12 disables hop-count trust (it fails closed, so every request
  // would share the proxy's IP and one attacker could trip the login lockout for
  // everyone). Reject it loudly instead of silently degrading.
  if (/^\d+$/.test(raw.trim())) {
    throw new Error(
      `TRUST_PROXY=${raw} (a hop count) is no longer supported. Remove it to use the default ` +
        `("${DEFAULT_TRUST_PROXY}"), or set the proxy's IP/CIDR list, e.g. TRUST_PROXY=172.16.0.0/12`,
    )
  }
  return raw.trim()
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
    // Which proxy addresses may set X-Forwarded-For (IP/CIDR list or proxy-addr
    // names). req.ip resolves to the first untrusted address walking back from
    // the socket, i.e. the client IP cloudflared reported. TRUST_PROXY=true
    // would trust the entire forged chain and let clients spoof req.ip to
    // bypass the login rate limiter. TRUST_PROXY=false disables.
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
    sessionIdleDays: Number(env.SESSION_IDLE_DAYS ?? 7),
    retentionDays: parseRetentionDays(env.MESSAGE_RETENTION_DAYS),
  }
}
