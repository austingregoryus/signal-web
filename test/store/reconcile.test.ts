import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { reconcileConversationAliases } from '../../src/store/reconcile'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
  try { rmSync(path + '-wal') } catch { /* ignore */ }
  try { rmSync(path + '-shm') } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swrec-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

describe('reconcileConversationAliases', () => {
  it('folds a number-keyed conversation into the UUID using message metadata', () => {
    // Reproduce the Dad bug: an outbound message keyed by number, an inbound
    // reply keyed by UUID — two conversations for one contact.
    const s = open()
    s.conversations.ensure({ id: '+15551234567', type: 'dm', displayName: 'Dad' })
    s.messages.upsert({ conversationId: '+15551234567', authorId: 'self', timestamp: 100, direction: 'out', body: 'hi', receivedAt: 1 })
    s.conversations.ensure({ id: 'uuid-dad', type: 'dm' })
    s.messages.upsert({ conversationId: 'uuid-dad', authorId: 'uuid-dad', authorNumber: '+15551234567', timestamp: 200, direction: 'in', body: 'reply', receivedAt: 2 })

    const result = reconcileConversationAliases(s)
    expect(result.merged).toBe(1)
    // One conversation remains, under the UUID, with the name carried over.
    const convs = s.conversations.list()
    expect(convs.map((c) => c.id)).toEqual(['uuid-dad'])
    expect(convs[0].displayName).toBe('Dad')
    // The alias is recorded so future number references resolve to the UUID.
    expect(s.conversations.resolveAlias('+15551234567')).toBe('uuid-dad')
    // Both messages live under the canonical conversation now.
    expect(s.messages.listByConversation('uuid-dad', 10)).toHaveLength(2)
  })

  it('is idempotent — running again is a no-op', () => {
    const s = open()
    s.conversations.ensure({ id: 'uuid-dad', type: 'dm', displayName: 'Dad' })
    s.messages.upsert({ conversationId: 'uuid-dad', authorId: 'uuid-dad', authorNumber: '+15551234567', timestamp: 200, direction: 'in', body: 'reply', receivedAt: 2 })
    // First run records the alias (nothing to merge — no separate number convo).
    const first = reconcileConversationAliases(s)
    const second = reconcileConversationAliases(s)
    expect(second.merged).toBe(0)
    expect(s.conversations.list()).toHaveLength(1)
  })

  it('does nothing on a clean store', () => {
    const s = open()
    const result = reconcileConversationAliases(s)
    expect(result.merged).toBe(0)
    expect(result.aliased).toBe(0)
  })
})
