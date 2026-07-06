import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { pruneOlderThan, DEFAULT_WINDOW_MS } from '../../src/store/prune'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swp-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

const NOW = 1_000_000_000_000
const OLD = NOW - DEFAULT_WINDOW_MS - 1
const RECENT = NOW - 1000

describe('pruneOlderThan', () => {
  it('deletes messages older than the window and keeps recent ones', () => {
    const s = open()
    s.conversations.ensure({ id: 'c', type: 'dm' })
    s.messages.upsert({ conversationId: 'c', authorId: 'a', timestamp: OLD, direction: 'in', body: 'old', receivedAt: OLD })
    s.messages.upsert({ conversationId: 'c', authorId: 'a', timestamp: RECENT, direction: 'in', body: 'new', receivedAt: RECENT })
    const res = pruneOlderThan(s, NOW)
    expect(res.messages).toBe(1)
    const remaining = s.messages.listByConversation('c', 10)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].body).toBe('new')
  })

  it('prunes orphaned reactions, receipts, and attachments by their target timestamp', () => {
    const s = open()
    s.reactions.apply({ targetAuthorId: 'a', targetTimestamp: OLD, reactorId: 'b', emoji: '👍', timestamp: OLD })
    s.receipts.record({ targetAuthorId: 'a', targetTimestamp: OLD, recipientId: 'b', type: 'read', timestamp: OLD })
    s.attachments.add({ id: 'att', messageAuthorId: 'a', messageTimestamp: OLD })
    const res = pruneOlderThan(s, NOW)
    expect(res).toMatchObject({ reactions: 1, receipts: 1, attachments: 1 })
    expect(s.reactions.listForMessage('a', OLD)).toHaveLength(0)
    // Pruned attachment ids are returned so the caller can delete their blobs.
    expect(res.attachmentIds).toEqual(['att'])
  })

  it('respects a custom window', () => {
    const s = open()
    s.conversations.ensure({ id: 'c', type: 'dm' })
    s.messages.upsert({ conversationId: 'c', authorId: 'a', timestamp: NOW - 2000, direction: 'in', body: 'x', receivedAt: NOW })
    expect(pruneOlderThan(s, NOW, 1000).messages).toBe(1)
  })
})
