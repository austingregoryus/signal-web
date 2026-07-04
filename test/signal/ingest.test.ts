import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { ingestEnvelope } from '../../src/signal/ingest'
import * as fx from '../fixtures/envelopes'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swi-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

describe('ingestEnvelope', () => {
  it('stores an inbound message and its conversation', () => {
    const s = open()
    ingestEnvelope(s, fx.inboundText, fx.SELF, 5000)
    expect(s.conversations.list().map((c) => c.id)).toContain('alice-uuid')
    const msgs = s.messages.listByConversation('alice-uuid', 10)
    expect(msgs[0]).toMatchObject({ body: 'hello from alice', direction: 'in' })
  })

  it('stores an own-sent message as outgoing in the destination conversation', () => {
    const s = open()
    ingestEnvelope(s, fx.ownSentText, fx.SELF, 5000)
    const msgs = s.messages.listByConversation('alice-uuid', 10)
    expect(msgs.find((m) => m.direction === 'out')?.body).toBe('reply from my phone')
  })

  it('applies a reaction to the target message', () => {
    const s = open()
    ingestEnvelope(s, fx.ownSentText, fx.SELF, 5000)      // creates self@2000
    ingestEnvelope(s, fx.inboundReaction, fx.SELF, 5100)  // reacts to self@2000
    expect(s.reactions.listForMessage(fx.SELF, 2000)[0].emoji).toBe('👍')
  })

  it('applies an own-sent (sync) reaction from the store owner', () => {
    const s = open()
    ingestEnvelope(s, fx.inboundText, fx.SELF, 5000)       // alice@1000 exists
    ingestEnvelope(s, fx.ownSentReaction, fx.SELF, 5100)   // we react to it from our phone
    const list = s.reactions.listForMessage('alice-uuid', 1000)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ emoji: '🎉', reactorId: fx.SELF })
  })

  it('tombstones on remoteDelete', () => {
    const s = open()
    ingestEnvelope(s, fx.inboundText, fx.SELF, 5000)       // alice@1000
    ingestEnvelope(s, fx.remoteDelete, fx.SELF, 5100)      // deletes alice@1000
    expect(s.messages.listByConversation('alice-uuid', 10)[0].deleted).toBe(1)
  })

  it('applies an edit', () => {
    const s = open()
    ingestEnvelope(s, fx.inboundText, fx.SELF, 5000)
    ingestEnvelope(s, fx.editMessage, fx.SELF, 5100)
    expect(s.messages.listByConversation('alice-uuid', 10)[0].body).toBe('hello (edited)')
  })

  it('records a read receipt about our sent message', () => {
    const s = open()
    ingestEnvelope(s, fx.ownSentText, fx.SELF, 5000)
    ingestEnvelope(s, fx.readReceipt, fx.SELF, 5100)
    const rows = s.receipts.listForMessage(fx.SELF, 2000)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'read', recipientId: 'alice-uuid' })
  })

  it('ignores typing without writing anything', () => {
    const s = open()
    ingestEnvelope(s, fx.typing, fx.SELF, 5000)
    expect(s.conversations.list()).toHaveLength(0)
  })

  it('is idempotent — re-ingesting the same message does not duplicate', () => {
    const s = open()
    ingestEnvelope(s, fx.inboundText, fx.SELF, 5000)
    ingestEnvelope(s, fx.inboundText, fx.SELF, 5001)
    expect(s.messages.listByConversation('alice-uuid', 10)).toHaveLength(1)
  })
})
