import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { BrowserHub, type HubClient } from '../../src/api/hub'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swhub-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

function fakeClient(id: number): HubClient & { sent: string[] } {
  const sent: string[] = []
  return { id, sent, send: (d) => sent.push(d) }
}

describe('BrowserHub', () => {
  it('broadcasts an event to all clients as JSON', () => {
    const hub = new BrowserHub()
    const a = fakeClient(1)
    const b = fakeClient(2)
    hub.add(a); hub.add(b)
    hub.broadcast({ type: 'message', body: 'hi' })
    expect(JSON.parse(a.sent[0])).toMatchObject({ type: 'message', body: 'hi' })
    expect(b.sent).toHaveLength(1)
  })

  it('drops a client that throws on send', () => {
    const hub = new BrowserHub()
    const bad: HubClient = { id: 9, send: () => { throw new Error('closed') } }
    hub.add(bad)
    hub.broadcast({ type: 'typing' })
    expect(hub.size()).toBe(0)
  })

  it('replays messages newer than the cursor from the store', () => {
    const s = open()
    s.conversations.ensure({ id: 'c1', type: 'dm' })
    s.messages.upsert({ conversationId: 'c1', authorId: 'a', timestamp: 1000, direction: 'in', body: 'old', receivedAt: 1 })
    s.messages.upsert({ conversationId: 'c1', authorId: 'a', timestamp: 2000, direction: 'in', body: 'new', receivedAt: 2 })
    const hub = new BrowserHub()
    const c = fakeClient(1)
    hub.replay(c, s, 1500, 100)
    const bodies = c.sent.map((d) => JSON.parse(d)).filter((e) => e.type === 'message').map((e) => e.message.body)
    expect(bodies).toContain('new')
    expect(bodies).not.toContain('old')
  })
})
