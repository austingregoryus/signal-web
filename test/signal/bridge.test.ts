import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { BrowserHub, type HubClient } from '../../src/api/hub'
import { LiveBridge } from '../../src/signal/bridge'
import * as fx from '../fixtures/envelopes'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swbr-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}
function fakeClient(): HubClient & { sent: string[] } {
  const sent: string[] = []
  return { id: 1, sent, send: (d) => sent.push(d) }
}

describe('LiveBridge.handleEnvelope', () => {
  it('ingests an inbound message and broadcasts it', () => {
    const s = open()
    const hub = new BrowserHub()
    const c = fakeClient()
    hub.add(c)
    const bridge = new LiveBridge({ store: s, hub, selfId: fx.SELF, now: () => 5000 })
    bridge.handleEnvelope(fx.inboundText)
    expect(s.messages.listByConversation('alice-uuid', 10)[0].body).toBe('hello from alice')
    const evs = c.sent.map((d) => JSON.parse(d))
    expect(evs.some((e) => e.type === 'message')).toBe(true)
  })

  it('broadcasts typing without storing it', () => {
    const s = open()
    const hub = new BrowserHub()
    const c = fakeClient()
    hub.add(c)
    const bridge = new LiveBridge({ store: s, hub, selfId: fx.SELF, now: () => 5000 })
    bridge.handleEnvelope(fx.typing)
    expect(s.conversations.list()).toHaveLength(0)
    expect(c.sent.map((d) => JSON.parse(d)).some((e) => e.type === 'typing')).toBe(true)
  })
})
