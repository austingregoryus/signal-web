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
let blobs: AttachmentBlobStore
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
  editMessage: async (i: unknown) => { sendCalls.push(i) },
  resolveUuid: async (number: string) => uuidByNumber[number] ?? null,
  getGroup: async () => ({ name: 'Test Group', description: '', members: ['+15550000001', '+15550000002'], admins: ['+15550000001'] }),
  updateGroup: async () => {},
}

beforeEach(async () => {
  sendCalls.length = 0
  for (const k of Object.keys(uuidByNumber)) delete uuidByNumber[k]
  path = join(tmpdir(), `swrest-${Date.now()}-${Math.round(performance.now())}.db`)
  blobDir = join(tmpdir(), `swrest-blobs-${Date.now()}-${Math.round(performance.now())}`)
  blobs = new AttachmentBlobStore(blobDir, 'k')
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
  registerRestApi(app, { store, client: stubClient as never, selfId: 'self', blobs })
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
  it('keeps the 1 MB body limit on login but allows large attachment sends', async () => {
    const big = 'A'.repeat(2 * 1024 * 1024)
    const loginRes = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: big } })
    expect(loginRes.statusCode).toBe(413)

    const { session, csrf } = await login()
    const sendRes = await app.inject({
      method: 'POST', url: '/api/send',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { conversationId: 'c1', type: 'dm', base64Attachments: [`data:image/png;base64,${big}`] },
    })
    expect(sendRes.statusCode).toBe(200)
  })

  it("applies the conversation's disappearing timer to a sent message", async () => {
    store.conversations.setExpireTimer('c1', 60_000)
    const { session, csrf } = await login()
    const res = await app.inject({
      method: 'POST', url: '/api/send',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { conversationId: 'c1', type: 'dm', message: 'poof' },
    })
    expect(res.statusCode).toBe(200)
    const sent = store.messages.listByConversation('c1', 10, undefined, 0).find((m) => m.body === 'poof')
    expect(sent?.expiresAt).toBe(111 + 60_000) // stub send timestamp + timer
  })

  it('rejects an unauthenticated upload before reading its body', async () => {
    // Over the 25 MB route limit: if auth ran after body parsing this would be 413.
    const huge = 'A'.repeat(26 * 1024 * 1024)
    for (const url of ['/api/send', '/api/start']) {
      const res = await app.inject({ method: 'POST', url, payload: { conversationId: 'c1', type: 'dm', recipient: '+15551234567', message: huge } })
      expect(res.statusCode).toBe(401)
    }
  })

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

  it('searches message text across conversations, newest first', async () => {
    store.conversations.ensure({ id: 'c2', type: 'group', displayName: 'Family' })
    store.messages.upsert({ conversationId: 'c2', authorId: 'b', timestamp: 3000, direction: 'in', body: 'Dinner at Six?', receivedAt: 1 })
    store.messages.upsert({ conversationId: 'c1', authorId: 'a', timestamp: 2000, direction: 'in', body: 'dinner was great', receivedAt: 1 })
    store.messages.upsert({ conversationId: 'c1', authorId: 'a', timestamp: 2500, direction: 'in', body: '100% dinner', receivedAt: 1 })
    store.messages.upsert({ conversationId: 'c1', authorId: 'a', timestamp: 2600, direction: 'in', body: 'dinner gone', receivedAt: 1, expiresAt: 1 })
    store.messages.markDeleted('a', 2500)
    const { session } = await login()
    const get = (q: string) => app.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent(q)}`, cookies: { sw_session: session } })

    const res = await get('DINNER')
    expect(res.statusCode).toBe(200)
    expect(res.json().results.map((r: { body: string; conversationName: string }) => [r.body, r.conversationName])).toEqual([
      ['Dinner at Six?', 'Family'],
      ['dinner was great', 'Alice'],
    ])
    // LIKE wildcards in the query are literal, and very short queries return nothing.
    expect((await get('%%')).json().results).toEqual([]) // unescaped, this would match everything
    expect((await get('d')).json().results).toEqual([])
    // Case folding covers more than ASCII (SQLite's LIKE alone would miss this).
    store.messages.upsert({ conversationId: 'c1', authorId: 'a', timestamp: 2700, direction: 'in', body: 'École demain', receivedAt: 1 })
    expect((await get('école')).json().results.map((r: { body: string }) => r.body)).toEqual(['École demain'])
    // An empty limit falls back to the default rather than clamping to 1.
    const empty = await app.inject({ method: 'GET', url: '/api/search?q=dinner&limit=', cookies: { sw_session: session } })
    expect(empty.json().results).toHaveLength(2)
  })

  it('requires auth to search', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/search?q=hi' })
    expect(res.statusCode).toBe(401)
  })

  it('returns conversation history', async () => {
    const { session } = await login()
    const res = await app.inject({ method: 'GET', url: '/api/conversations/c1/messages?limit=10', cookies: { sw_session: session } })
    expect(res.statusCode).toBe(200)
    expect(res.json().messages[0].body).toBe('hi')
  })

  it('pages older messages with a before cursor (newest-first per page)', async () => {
    const { session } = await login()
    // Seed 4 more messages at ts 1001..1004; the fixture already has 'hi' at ts 1000.
    for (let i = 1; i <= 4; i++) {
      store.messages.upsert({ conversationId: 'c1', authorId: 'a', timestamp: 1000 + i, direction: 'in', body: `m${i}`, receivedAt: i })
    }
    // First page (limit 2): newest two messages.
    const p1 = await app.inject({ method: 'GET', url: '/api/conversations/c1/messages?limit=2', cookies: { sw_session: session } })
    const p1bodies = p1.json().messages.map((m: { body: string }) => m.body)
    expect(p1bodies).toEqual(['m4', 'm3']) // newest-first
    // Second page: messages strictly older than the oldest in page 1 (ts=1003).
    const p2 = await app.inject({ method: 'GET', url: '/api/conversations/c1/messages?limit=2&before=1003', cookies: { sw_session: session } })
    const p2bodies = p2.json().messages.map((m: { body: string }) => m.body)
    expect(p2bodies).toEqual(['m2', 'm1']) // ts 1002, 1001
  })

  it('deletes a conversation and cascades to its messages, reactions, receipts, attachments', async () => {
    const { session, csrf } = await login()
    // Seed a second conversation with a message, a reaction, a receipt, an attachment.
    store.conversations.ensure({ id: 'c2', type: 'dm' })
    store.messages.upsert({ conversationId: 'c2', authorId: 'bob', timestamp: 1000, direction: 'in', body: 'hi', receivedAt: 1 })
    store.reactions.apply({ targetAuthorId: 'bob', targetTimestamp: 1000, reactorId: 'self', emoji: '👍', timestamp: 1500 })
    store.receipts.record({ targetAuthorId: 'bob', targetTimestamp: 1000, recipientId: 'self', type: 'read', timestamp: 1200 })
    store.attachments.add({ id: 'self:1000:0', messageAuthorId: 'bob', messageTimestamp: 1000, contentType: 'image/png' })
    await blobs.put('self:1000:0', Buffer.from('pngbytes'))

    const res = await app.inject({
      method: 'DELETE', url: '/api/conversations/c2',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
    })
    expect(res.statusCode).toBe(200)
    // The conversation and all its data are gone.
    expect(store.conversations.list().some((c) => c.id === 'c2')).toBe(false)
    expect(store.messages.listByConversation('c2', 10)).toHaveLength(0)
    expect(store.reactions.listForMessage('bob', 1000)).toHaveLength(0)
    expect(store.receipts.listForMessage('bob', 1000)).toHaveLength(0)
    expect(store.attachments.listForMessage('bob', 1000)).toHaveLength(0)
    // The blob file was deleted too.
    expect(await blobs.get('self:1000:0')).toBeNull()
    // The unrelated c1 conversation is untouched.
    expect(store.conversations.list().some((c) => c.id === 'c1')).toBe(true)
  })

  it('enforces CSRF on delete', async () => {
    const { session } = await login()
    const res = await app.inject({
      method: 'DELETE', url: '/api/conversations/c1', cookies: { sw_session: session },
    })
    expect(res.statusCode).toBe(403)
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

  it('passes quote fields to signal-cli and stores them on the outgoing message', async () => {
    const { session, csrf } = await login()
    const res = await app.inject({
      method: 'POST', url: '/api/send',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { conversationId: 'c1', type: 'dm', message: 'a reply', quoteTimestamp: 9999, quoteAuthor: 'alice-uuid' },
    })
    expect(res.statusCode).toBe(200)
    // signal-cli receives the quote params.
    expect(sendCalls[0]).toMatchObject({ quoteTimestamp: 9999, quoteAuthor: 'alice-uuid' })
    // The local copy records the quote so the sender's view renders it.
    const stored = store.messages.listByConversation('c1', 10).find((m) => m.direction === 'out' && m.body === 'a reply')
    expect(stored).toMatchObject({ quoteAuthorId: 'alice-uuid', quoteTimestamp: 9999 })
  })

  it('edits an own message via signal-cli and applies the edit locally', async () => {
    const { session, csrf } = await login()
    // Seed an outgoing message owned by selfId to edit.
    store.messages.upsert({ conversationId: 'c1', authorId: 'self', timestamp: 5000, direction: 'out', body: 'original', receivedAt: 1 })
    const res = await app.inject({
      method: 'POST', url: '/api/edit',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { conversationId: 'c1', type: 'dm', targetTimestamp: 5000, message: 'edited text' },
    })
    expect(res.statusCode).toBe(200)
    // signal-cli got the edit (recipient + target timestamp + new text).
    expect(sendCalls[0]).toMatchObject({ recipient: 'c1', targetTimestamp: 5000, message: 'edited text' })
    // The local copy reflects the edit + an edited_timestamp marker.
    const stored = store.messages.listByConversation('c1', 10).find((m) => m.timestamp === 5000)
    expect(stored).toMatchObject({ body: 'edited text' })
    expect(stored?.editedTimestamp).not.toBeNull()
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

  it('falls back to the phone number when the contact exists but has no UUID', async () => {
    // signal-cli can return a contact with an empty uuid (unregistered number);
    // that must not produce a conversation with an empty id.
    const { session, csrf } = await login()
    uuidByNumber['+15559990000'] = ''
    const res = await app.inject({
      method: 'POST', url: '/api/start',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { recipient: '+15559990000', message: 'hello' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().conversationId).toBe('+15559990000')
    const ids = store.conversations.list().map((c) => c.id)
    expect(ids).not.toContain('')
    expect(ids).toContain('+15559990000')
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

  it('returns group info with members resolved to display names', async () => {
    const { session } = await login()
    store.conversations.ensure({ id: 'g1', type: 'group', displayName: 'Test Group' })
    // Seed a named conversation for one member so the resolver finds a name.
    store.conversations.ensure({ id: 'uuid-alice', type: 'dm', displayName: 'Alice' })
    store.conversations.linkAlias('+15550000001', 'uuid-alice')
    const res = await app.inject({
      method: 'GET', url: '/api/conversations/g1/info',
      cookies: { sw_session: session },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.type).toBe('group')
    expect(body.name).toBe('Test Group')
    const alice = body.members.find((m: { number: string }) => m.number === '+15550000001')
    expect(alice).toMatchObject({ number: '+15550000001', displayName: 'Alice', isAdmin: true })
    const bob = body.members.find((m: { number: string }) => m.number === '+15550000002')
    expect(bob.displayName).toBeNull() // unknown -> bare number, no name
  })

  it('returns DM info with just the display name', async () => {
    const { session } = await login()
    const res = await app.inject({
      method: 'GET', url: '/api/conversations/c1/info',
      cookies: { sw_session: session },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ type: 'dm', displayName: 'Alice' })
  })

  it('renames a DM locally and a group via signal-cli + locally', async () => {
    const { session, csrf } = await login()
    // DM rename — local only.
    const dm = await app.inject({
      method: 'POST', url: '/api/conversations/c1/rename',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { name: 'Alice Renamed' },
    })
    expect(dm.statusCode).toBe(200)
    expect(store.conversations.list().find((c) => c.id === 'c1')?.displayName).toBe('Alice Renamed')

    // Group rename — signal-cli updateGroup + local.
    store.conversations.ensure({ id: 'g1', type: 'group', displayName: 'Old Group Name' })
    const grp = await app.inject({
      method: 'POST', url: '/api/conversations/g1/rename',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { name: 'New Group Name' },
    })
    expect(grp.statusCode).toBe(200)
    expect(store.conversations.list().find((c) => c.id === 'g1')?.displayName).toBe('New Group Name')
  })

  it('rejects a rename with an empty name', async () => {
    const { session, csrf } = await login()
    const res = await app.inject({
      method: 'POST', url: '/api/conversations/c1/rename',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { name: '   ' },
    })
    expect(res.statusCode).toBe(400)
  })
})
