import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { hashPassword } from '../../src/auth/password'
import { authPlugin } from '../../src/auth/plugin'
import { registerRestApi } from '../../src/api/rest'

let store: Store
let path: string
let app: FastifyInstance
const sendCalls: unknown[] = []
const stubClient = {
  sendMessage: async (i: unknown) => { sendCalls.push(i); return { timestamp: 111 } },
  sendReaction: async () => {},
  sendTyping: async () => {},
  sendReceipt: async () => {},
}

beforeEach(async () => {
  sendCalls.length = 0
  path = join(tmpdir(), `swrest-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  store.authConfig.setPasswordHash(await hashPassword('hunter2hunter2'))
  store.conversations.ensure({ id: 'c1', type: 'dm', displayName: 'Alice' })
  store.messages.upsert({ conversationId: 'c1', authorId: 'a', timestamp: 1000, direction: 'in', body: 'hi', receivedAt: 1 })
  app = Fastify()
  await authPlugin(app, {
    store,
    sessionPolicy: { ttlMs: 1e9, idleMs: 1e9 },
    rateLimit: { maxPerKey: 5, windowMs: 60_000, lockoutMs: 1000, maxGlobal: 100 },
    webauthn: { rpId: 'localhost', rpName: 'x', origin: 'http://localhost' },
    secureCookies: false,
  })
  registerRestApi(app, { store, client: stubClient as never, selfId: 'self' })
  await app.ready()
})
afterEach(async () => {
  await app?.close(); store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})

async function login(): Promise<{ session: string; csrf: string }> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'hunter2hunter2' } })
  const raw = res.headers['set-cookie']
  const arr = Array.isArray(raw) ? raw : [String(raw)]
  const pick = (n: string) => arr.find((c) => c.startsWith(`${n}=`))!.split(';')[0].split('=')[1]
  return { session: pick('sw_session'), csrf: pick('sw_csrf') }
}

describe('REST API', () => {
  it('rejects unauthenticated access', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conversations' })
    expect(res.statusCode).toBe(401)
  })

  it('lists conversations when authenticated', async () => {
    const { session } = await login()
    const res = await app.inject({ method: 'GET', url: '/api/conversations', cookies: { sw_session: session } })
    expect(res.statusCode).toBe(200)
    expect(res.json()[0]).toMatchObject({ id: 'c1', displayName: 'Alice' })
  })

  it('returns conversation history', async () => {
    const { session } = await login()
    const res = await app.inject({ method: 'GET', url: '/api/conversations/c1/messages?limit=10', cookies: { sw_session: session } })
    expect(res.statusCode).toBe(200)
    expect(res.json().messages[0].body).toBe('hi')
  })

  it('sends a message via the client and stores it optimistically', async () => {
    const { session, csrf } = await login()
    const res = await app.inject({
      method: 'POST', url: '/api/send',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { conversationId: 'c1', type: 'dm', message: 'hello back' },
    })
    expect(res.statusCode).toBe(200)
    expect(sendCalls).toHaveLength(1)
    const stored = store.messages.listByConversation('c1', 10).find((m) => m.direction === 'out')
    expect(stored?.body).toBe('hello back')
  })

  it('enforces CSRF on send', async () => {
    const { session } = await login()
    const res = await app.inject({
      method: 'POST', url: '/api/send', cookies: { sw_session: session },
      payload: { conversationId: 'c1', type: 'dm', message: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })
})
