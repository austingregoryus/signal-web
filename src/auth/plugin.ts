import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import type { Store } from '../store/store'
import type { SessionPolicy } from '../store/sessions'
import { verifyPassword } from './password'
import { RateLimiter, type RateLimitConfig } from './rateLimiter'
import { issueCsrfToken, verifyCsrf } from './csrf'
import type { WebAuthnConfig } from './webauthn'
import {
  startRegistration,
  finishRegistration,
  startAuthentication,
  finishAuthentication,
} from './webauthn'

export interface AuthPluginOptions {
  store: Store
  sessionPolicy: SessionPolicy
  rateLimit: RateLimitConfig
  webauthn: WebAuthnConfig
  secureCookies: boolean
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

const SESSION_COOKIE = 'sw_session'
const CSRF_COOKIE = 'sw_csrf'

export async function authPlugin(app: FastifyInstance, opts: AuthPluginOptions): Promise<void> {
  const { store, sessionPolicy, webauthn, secureCookies } = opts
  const limiter = new RateLimiter(opts.rateLimit)
  await app.register(fastifyCookie)

  function setSessionCookies(reply: FastifyReply, token: string, csrf: string): void {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/',
      maxAge: Math.floor(sessionPolicy.ttlMs / 1000),
    })
    reply.setCookie(CSRF_COOKIE, csrf, {
      httpOnly: false, secure: secureCookies, sameSite: 'strict', path: '/',
      maxAge: Math.floor(sessionPolicy.ttlMs / 1000),
    })
  }

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[SESSION_COOKIE]
    if (!token || !store.sessions.validate(token, Date.now(), sessionPolicy)) {
      await reply.code(401).send({ error: 'unauthorized' })
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const headerToken = req.headers['x-csrf-token']
      const csrfHeader = Array.isArray(headerToken) ? headerToken[0] : headerToken
      if (!verifyCsrf(req.cookies[CSRF_COOKIE], csrfHeader)) {
        await reply.code(403).send({ error: 'csrf' })
        return
      }
    }
  })

  app.post<{ Body: { password?: string } }>('/auth/login', async (req, reply) => {
    const ip = req.ip
    const now = Date.now()
    const decision = limiter.check(ip, now)
    if (!decision.allowed) {
      return reply.code(429).send({ error: 'rate_limited', retryAfterMs: decision.retryAfterMs })
    }
    const password = req.body?.password ?? ''
    const hash = store.authConfig.getPasswordHash()
    const ok = hash ? await verifyPassword(hash, password) : false
    if (!ok) {
      limiter.recordFailure(ip, now)
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    limiter.recordSuccess(ip)
    const token = store.sessions.create(now, sessionPolicy)
    const csrf = issueCsrfToken()
    setSessionCookies(reply, token, csrf)
    return reply.send({ ok: true, webauthnRequired: store.webauthn.hasCredential() })
  })

  app.post('/auth/logout', { preHandler: app.requireAuth }, async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE]
    if (token) store.sessions.revoke(token)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    reply.clearCookie(CSRF_COOKIE, { path: '/' })
    return reply.send({ ok: true })
  })

  app.post('/auth/logout-all', { preHandler: app.requireAuth }, async (_req, reply) => {
    store.sessions.revokeAll()
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    reply.clearCookie(CSRF_COOKIE, { path: '/' })
    return reply.send({ ok: true })
  })

  app.get('/auth/status', async (req) => {
    const token = req.cookies[SESSION_COOKIE]
    const authenticated = token ? store.sessions.validate(token, Date.now(), sessionPolicy) : false
    return { authenticated }
  })

  // --- WebAuthn (registration requires a live session; login usable as 2FA) ---
  app.post('/auth/webauthn/register/options', { preHandler: app.requireAuth }, async () => {
    return startRegistration(store.webauthn, webauthn, 'signal-web-user', Date.now())
  })

  app.post('/auth/webauthn/register/verify', { preHandler: app.requireAuth }, async (req, reply) => {
    const ok = await finishRegistration(store.webauthn, webauthn, req.body as never, Date.now())
    return reply.code(ok ? 200 : 400).send({ ok })
  })

  app.post('/auth/webauthn/login/options', async () => {
    return startAuthentication(store.webauthn, webauthn, Date.now())
  })

  app.post('/auth/webauthn/login/verify', async (req, reply) => {
    const ok = await finishAuthentication(store.webauthn, webauthn, req.body as never, Date.now())
    if (!ok) return reply.code(401).send({ ok: false })
    const token = store.sessions.create(Date.now(), sessionPolicy)
    const csrf = issueCsrfToken()
    setSessionCookies(reply, token, csrf)
    return reply.send({ ok: true })
  })
}
