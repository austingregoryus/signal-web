import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { AttachmentBlobStore } from '../../src/store/attachmentsBlob'
import { hashPassword } from '../../src/auth/password'
import { authPlugin } from '../../src/auth/plugin'
import { registerRestApi } from '../../src/api/rest'

let store: Store
let path: string
let blobDir: string
let app: FastifyInstance
const sendCalls: unknown[] = []
const uuidByNumber: Record<string, string> = {}
const stubClient = {
  sendMessage: async (i: unknown) => { sendCalls.push(i); return { timestamp: 111 } },
  sendReaction: async () => {},
  sendTyping: async () => {},
  sendReceipt: async () => {},
  resolveUuid: async (number: string) => uuidByNumber[number] ?? null,
}

beforeEach(async () => {
  sendCalls.length = 0
  for (const k of Object.keys(uuidByNumber)) delete uuidByNumber[k]
  path = join(tmpdir(), `swrest-${Date.now()}-${Math.round(performance.now())}.db`)
  blobDir = join(tmpdir(), `swrest-blobs-${Date.now()}-${Math.round(performance.now())}`)
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
  registerRestApi(app, { store, client: stubClient as never, selfId: 'self', blobs: new AttachmentBlobStore(blobDir, 'k') })
  await app.ready()
})
afterEach(async () => {
  await app?.close(); store?.close()
  try { rmSync(path) } catch { /* ignore */ }
  try { rmSync(blobDir, { recursive: true, force: true }) } catch { /* ignore */ }
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

  it('persists sent attachments locally and forwards bare base64 to signal-cli', async () => {
    const { session, csrf } = await login()
    // Tiny 1x1 PNG; sent as a data URL so the server can keep the content type.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const res = await app.inject({
      method: 'POST', url: '/api/send',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { conversationId: 'c1', type: 'dm', message: 'look', base64Attachments: [png] },
    })
    expect(res.statusCode).toBe(200)
    // signal-cli receives the bare base64 (no data: prefix).
    expect(sendCalls[0]).toMatchObject({ base64Attachments: [png.split(',')[1]] })
    // The sender's local copy records the attachment so it renders in their own thread.
    const stored = store.messages.listByConversation('c1', 10).find((m) => m.direction === 'out' && m.timestamp === 111)
    const atts = store.attachments.listForMessage(stored!.authorId, stored!.timestamp)
    expect(atts).toHaveLength(1)
    expect(atts[0]).toMatchObject({ contentType: 'image/png', signalId: null, size: expect.any(Number) })
  })

  it('enforces CSRF on send', async () => {
    const { session } = await login()
    const res = await app.inject({
      method: 'POST', url: '/api/send', cookies: { sw_session: session },
      payload: { conversationId: 'c1', type: 'dm', message: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('starts a new conversation, preferring the resolved UUID as the conversation id', async () => {
    const { session, csrf } = await login()
    uuidByNumber['+15551234567'] = 'uuid-abc'
    const res = await app.inject({
      method: 'POST', url: '/api/start',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { recipient: '+15551234567', displayName: 'Bob', message: 'hi there' },
    })
    expect(res.statusCode).toBe(200)
    // Sent via signal-cli to the raw number (signal-cli resolves it itself).
    expect(sendCalls[0]).toMatchObject({ recipients: ['+15551234567'], message: 'hi there' })
    // Conversation is keyed by the UUID so inbound replies thread correctly.
    const conv = store.conversations.list().find((c) => c.id === 'uuid-abc')
    expect(conv).toMatchObject({ id: 'uuid-abc', type: 'dm', displayName: 'Bob' })
    expect(res.json().conversationId).toBe('uuid-abc')
  })

  it('falls back to the phone number when the recipient is not a known contact', async () => {
    const { session, csrf } = await login()
    const res = await app.inject({
      method: 'POST', url: '/api/start',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { recipient: '+15557654321', message: 'hello' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().conversationId).toBe('+15557654321')
    expect(store.conversations.list().some((c) => c.id === '+15557654321')).toBe(true)
  })

  it('rejects an invalid recipient number', async () => {
    const { session, csrf } = await login()
    const res = await app.inject({
      method: 'POST', url: '/api/start',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { recipient: 'not-a-number', message: 'hi' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an empty first message with no attachments (would 500 from signal-cli)', async () => {
    const { session, csrf } = await login()
    const res = await app.inject({
      method: 'POST', url: '/api/start',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { recipient: '+15551234567' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('empty_message')
    // signal-cli was never called.
    expect(sendCalls).toHaveLength(0)
  })
})
