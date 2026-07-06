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

  it('folds a group.-prefixed group conversation into its raw canonical form', () => {
    // Reproduce the split: inbound under raw (named via profile would be on
    // prefixed, but here inbound is unnamed), outbound under prefixed (named).
    const s = open()
    const RAW = 'GxH1JWjt6ejZYUjRwdyIRjqgip+u4i6cMziREZmGJhg='
    const PREFIXED = 'group.R3hIMUpXanQ2ZWpaWVVqUndkeUlSanFnaXArdTRpNmNNemlSRVptR0poZz0='
    s.conversations.ensure({ id: RAW, type: 'group' })
    s.messages.upsert({ conversationId: RAW, authorId: 'bob', timestamp: 100, direction: 'in', body: 'inbound group msg', receivedAt: 1 })
    s.conversations.ensure({ id: PREFIXED, type: 'group', displayName: 'Testing Group' })
    s.messages.upsert({ conversationId: PREFIXED, authorId: 'self', timestamp: 200, direction: 'out', body: 'outbound', receivedAt: 2 })

    const result = reconcileConversationAliases(s)
    expect(result.merged).toBeGreaterThanOrEqual(1)
    // One group conversation remains, under the RAW id, with the name carried over.
    const groups = s.conversations.list().filter((c) => c.type === 'group')
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe(RAW)
    expect(groups[0].displayName).toBe('Testing Group')
    // Both messages live under the canonical RAW conversation now.
    expect(s.messages.listByConversation(RAW, 10)).toHaveLength(2)
    expect(s.messages.listByConversation(PREFIXED, 10)).toHaveLength(0)
  })

  it('rewrites a prefixed-only group conversation id to raw', () => {
    const s = open()
    const RAW = 'GxH1JWjt6ejZYUjRwdyIRjqgip+u4i6cMziREZmGJhg='
    const PREFIXED = 'group.R3hIMUpXanQ2ZWpaWVVqUndkeUlSanFnaXArdTRpNmNNemlSRVptR0poZz0='
    s.conversations.ensure({ id: PREFIXED, type: 'group', displayName: 'Only Prefixed' })
    s.messages.upsert({ conversationId: PREFIXED, authorId: 'self', timestamp: 1, direction: 'out', body: 'x', receivedAt: 1 })

    reconcileConversationAliases(s)
    // The id is now raw; messages repointed; name preserved.
    expect(s.conversations.list().some((c) => c.id === PREFIXED)).toBe(false)
    const g = s.conversations.list().find((c) => c.id === RAW)
    expect(g?.displayName).toBe('Only Prefixed')
    expect(s.messages.listByConversation(RAW, 10)).toHaveLength(1)
  })
})
