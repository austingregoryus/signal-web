import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { hashPassword } from '../../src/auth/password'
import { authPlugin } from '../../src/auth/plugin'

let store: Store
let path: string
let app: FastifyInstance

const opts = () => ({
  store,
  sessionPolicy: { ttlMs: 30 * 24 * 3600_000, idleMs: 7 * 24 * 3600_000 },
  rateLimit: { maxPerKey: 3, windowMs: 60_000, lockoutMs: 300_000, maxGlobal: 100 },
  webauthn: { rpId: 'localhost', rpName: 'Signal Web', origin: 'http://localhost' },
  secureCookies: false,
})

beforeEach(async () => {
  path = join(tmpdir(), `swp-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  store.authConfig.setPasswordHash(await hashPassword('hunter2hunter2'))
  app = Fastify()
  await authPlugin(app, opts())
  // a protected route to exercise requireAuth
  app.get('/protected', { preHandler: app.requireAuth }, async () => ({ secret: 42 }))
  app.post('/protected', { preHandler: app.requireAuth }, async () => ({ ok: true }))
  await app.ready()
})

afterEach(async () => {
  await app?.close()
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})

function cookieFrom(res: { headers: Record<string, unknown> }, name: string): string | undefined {
  const raw = res.headers['set-cookie']
  const arr = Array.isArray(raw) ? raw : raw ? [String(raw)] : []
  const hit = arr.find((c) => c.startsWith(`${name}=`))
  return hit?.split(';')[0].split('=')[1]
}

describe('authPlugin', () => {
  it('rejects a protected route without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' })
    expect(res.statusCode).toBe(401)
  })

  it('logs in with the correct password and sets an HttpOnly session cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'hunter2hunter2' } })
    expect(res.statusCode).toBe(200)
    const setCookie = res.headers['set-cookie']
    const flat = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie)
    expect(flat).toContain('sw_session=')
    expect(flat).toContain('HttpOnly')
    expect(flat).toContain('SameSite=Strict')
  })

  it('rejects a wrong password', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'wrong' } })
    expect(res.statusCode).toBe(401)
  })

  it('allows a protected GET once authenticated', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'hunter2hunter2' } })
    const session = cookieFrom(login, 'sw_session')
    const res = await app.inject({ method: 'GET', url: '/protected', cookies: { sw_session: session! } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ secret: 42 })
  })

  it('enforces CSRF on a protected POST', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'hunter2hunter2' } })
    const session = cookieFrom(login, 'sw_session')
    const csrf = cookieFrom(login, 'sw_csrf')
    // without the header → blocked
    const blocked = await app.inject({ method: 'POST', url: '/protected', cookies: { sw_session: session!, sw_csrf: csrf! } })
    expect(blocked.statusCode).toBe(403)
    // with matching header → allowed
    const ok = await app.inject({
      method: 'POST', url: '/protected',
      cookies: { sw_session: session!, sw_csrf: csrf! },
      headers: { 'x-csrf-token': csrf! },
    })
    expect(ok.statusCode).toBe(200)
  })

  it('logout invalidates the session', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'hunter2hunter2' } })
    const session = cookieFrom(login, 'sw_session')
    const csrf = cookieFrom(login, 'sw_csrf')
    await app.inject({ method: 'POST', url: '/auth/logout', cookies: { sw_session: session!, sw_csrf: csrf! }, headers: { 'x-csrf-token': csrf! } })
    const res = await app.inject({ method: 'GET', url: '/protected', cookies: { sw_session: session! } })
    expect(res.statusCode).toBe(401)
  })

  it('requires the second factor when a credential is registered', async () => {
    store.webauthn.addCredential({
      id: 'c1',
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0,
      transports: ['usb'],
      createdAt: 1,
    })
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'hunter2hunter2' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().webauthnRequired).toBe(true)
    const session = cookieFrom(res, 'sw_session')
    const protectedRes = await app.inject({ method: 'GET', url: '/protected', cookies: { sw_session: session! } })
    expect(protectedRes.statusCode).toBe(401)
  })

  it('locks out after repeated wrong passwords', async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'wrong' } })
    }
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'hunter2hunter2' } })
    expect(res.statusCode).toBe(429)
  })
})
