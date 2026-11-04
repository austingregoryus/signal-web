import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swc-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

describe('ConversationRepo', () => {
  it('ensures and lists a conversation', () => {
    const s = open()
    s.conversations.ensure({ id: 'c1', type: 'dm', displayName: 'Alice' })
    const list = s.conversations.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'c1', type: 'dm', displayName: 'Alice', lastActivity: 0 })
  })

  it('reports a phone number for DMs so unnamed contacts can show it', () => {
    const s = open()
    s.conversations.ensure({ id: 'bob-uuid', type: 'dm' })
    s.conversations.ensure({ id: '+15551110004', type: 'dm' })
    s.conversations.ensure({ id: 'stranger-uuid', type: 'dm' })
    s.conversations.ensure({ id: 'grp', type: 'group' })
    s.conversations.linkAlias('+15551110003', 'bob-uuid')
    s.conversations.linkAlias('+15559990000', 'grp') // never applies to a group
    const byId = Object.fromEntries(s.conversations.list().map((c) => [c.id, c.number]))
    expect(byId).toEqual({
      'bob-uuid': '+15551110003',
      '+15551110004': '+15551110004',
      'stranger-uuid': null,
      grp: null,
    })
  })

  it('ensure does not overwrite an existing name with null', () => {
    const s = open()
    s.conversations.ensure({ id: 'c1', type: 'dm', displayName: 'Alice' })
    s.conversations.ensure({ id: 'c1', type: 'dm', displayName: null })
    expect(s.conversations.list()[0].displayName).toBe('Alice')
  })

  it('touch raises lastActivity only when greater', () => {
    const s = open()
    s.conversations.ensure({ id: 'c1', type: 'dm' })
    s.conversations.touch('c1', 5000)
    s.conversations.touch('c1', 3000)
    expect(s.conversations.list()[0].lastActivity).toBe(5000)
  })

  it('lists by lastActivity DESC', () => {
    const s = open()
    s.conversations.ensure({ id: 'a', type: 'dm' })
    s.conversations.ensure({ id: 'b', type: 'dm' })
    s.conversations.touch('a', 100)
    s.conversations.touch('b', 200)
    expect(s.conversations.list().map((c) => c.id)).toEqual(['b', 'a'])
  })

  it('counts unread inbound messages and resets on markRead', () => {
    const s = open()
    s.conversations.ensure({ id: 'c1', type: 'dm' })
    // Two inbound messages (unread) + one outbound (never counts).
    s.messages.upsert({ conversationId: 'c1', authorId: 'bob', timestamp: 100, direction: 'in', body: 'hi', receivedAt: 1 })
    s.messages.upsert({ conversationId: 'c1', authorId: 'bob', timestamp: 200, direction: 'in', body: 'yo', receivedAt: 2 })
    s.messages.upsert({ conversationId: 'c1', authorId: 'self', timestamp: 150, direction: 'out', body: 'hey', receivedAt: 3 })
    expect(s.conversations.list().find((c) => c.id === 'c1')?.unreadCount).toBe(2)
    // Mark read up to now — both are at-or-before now, so unread clears.
    s.conversations.markRead('c1', 300)
    expect(s.conversations.list().find((c) => c.id === 'c1')?.unreadCount).toBe(0)
  })

  it('resolveAlias returns the uuid for a known number and passes others through', () => {
    const s = open()
    s.conversations.linkAlias('+15551234567', 'uuid-abc')
    expect(s.conversations.resolveAlias('+15551234567')).toBe('uuid-abc')
    // Unknown number and already-uuid ids come back unchanged.
    expect(s.conversations.resolveAlias('+15559999999')).toBe('+15559999999')
    expect(s.conversations.resolveAlias('uuid-xyz')).toBe('uuid-xyz')
  })

  it('linkAlias is idempotent', () => {
    const s = open()
    s.conversations.linkAlias('+15551234567', 'uuid-abc')
    s.conversations.linkAlias('+15551234567', 'uuid-abc')
    expect(s.conversations.resolveAlias('+15551234567')).toBe('uuid-abc')
  })

  it('mergeInto repoints messages, carries the display name, and deletes the obsolete row', () => {
    const s = open()
    // Number-keyed conversation (created by /api/start) with a name and a message.
    s.conversations.ensure({ id: '+15551234567', type: 'dm', displayName: 'Sam' })
    s.messages.upsert({ conversationId: '+15551234567', authorId: 'self', timestamp: 100, direction: 'out', body: 'hi', receivedAt: 1 })
    // UUID-keyed conversation (created when Sam replied) — no name, one inbound message.
    s.conversations.ensure({ id: 'uuid-sam', type: 'dm' })
    s.messages.upsert({ conversationId: 'uuid-sam', authorId: 'uuid-sam', authorNumber: '+15551234567', timestamp: 200, direction: 'in', body: 'hello', receivedAt: 2 })

    s.conversations.mergeInto('uuid-sam', '+15551234567')

    const convs = s.conversations.list()
    expect(convs.map((c) => c.id)).toEqual(['uuid-sam'])
    expect(convs[0].displayName).toBe('Sam') // name carried over from the number-keyed row
    // Both messages now live under the canonical uuid conversation.
    const msgs = s.messages.listByConversation('uuid-sam', 10)
    expect(msgs.map((m) => m.body).sort()).toEqual(['hello', 'hi'])
    expect(s.messages.listByConversation('+15551234567', 10)).toHaveLength(0)
  })

  it('mergeInto is a no-op when the obsolete conversation does not exist', () => {
    const s = open()
    s.conversations.ensure({ id: 'uuid-sam', type: 'dm' })
    s.conversations.mergeInto('uuid-sam', '+15550000000') // never created
    expect(s.conversations.list().map((c) => c.id)).toEqual(['uuid-sam'])
  })
})
