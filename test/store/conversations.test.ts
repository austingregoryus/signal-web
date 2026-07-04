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
})
