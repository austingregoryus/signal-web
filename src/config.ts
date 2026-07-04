export interface AppConfig {
  port: number
  signalNumber: string
  signalApiUrl: string
  signalWsUrl: string
  dbPath: string
  dbKey: string
  publicUrl: string
  allowedOrigin: string
  rpId: string
  rpOrigin: string
  attachmentDir: string
  secureCookies: boolean
  trustProxy: boolean
  sessionTtlDays: number
  sessionIdleDays: number
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
    dbPath: env.DB_PATH ?? './data/signal-web.db',
    dbKey,
    publicUrl,
    allowedOrigin: env.ALLOWED_ORIGIN ?? publicUrl,
    rpId: env.RP_ID ?? new URL(rpOrigin).hostname,
    rpOrigin,
    attachmentDir: env.ATTACHMENT_DIR ?? './data/attachments',
    secureCookies: (env.SECURE_COOKIES ?? 'true') !== 'false',
    trustProxy: (env.TRUST_PROXY ?? 'true') !== 'false',
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
    sessionIdleDays: Number(env.SESSION_IDLE_DAYS ?? 7),
  }
}
