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
  path = join(tmpdir(), `swr-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

const t = { targetAuthorId: 'uuid-a', targetTimestamp: 1000 }

describe('ReactionRepo', () => {
  it('applies a reaction even when the target message is absent (orphan-tolerant)', () => {
    const s = open()
    s.reactions.apply({ ...t, reactorId: 'uuid-b', emoji: '👍', timestamp: 1100 })
    const list = s.reactions.listForMessage('uuid-a', 1000)
    expect(list).toHaveLength(1)
    expect(list[0].emoji).toBe('👍')
  })

  it('replaces the reactor’s previous emoji', () => {
    const s = open()
    s.reactions.apply({ ...t, reactorId: 'uuid-b', emoji: '👍', timestamp: 1100 })
    s.reactions.apply({ ...t, reactorId: 'uuid-b', emoji: '❤️', timestamp: 1200 })
    const list = s.reactions.listForMessage('uuid-a', 1000)
    expect(list).toHaveLength(1)
    expect(list[0].emoji).toBe('❤️')
  })

  it('remove deletes the reactor’s reaction', () => {
    const s = open()
    s.reactions.apply({ ...t, reactorId: 'uuid-b', emoji: '👍', timestamp: 1100 })
    s.reactions.remove('uuid-a', 1000, 'uuid-b')
    expect(s.reactions.listForMessage('uuid-a', 1000)).toHaveLength(0)
  })

  it('a stale reaction redelivery does not revert a newer reaction', () => {
    const s = open()
    s.reactions.apply({ ...t, reactorId: 'uuid-b', emoji: '👍', timestamp: 1100 })
    s.reactions.apply({ ...t, reactorId: 'uuid-b', emoji: '❤️', timestamp: 1200 })
    s.reactions.apply({ ...t, reactorId: 'uuid-b', emoji: '👍', timestamp: 1100 }) // stale redelivery
    const list = s.reactions.listForMessage('uuid-a', 1000)
    expect(list).toHaveLength(1)
    expect(list[0].emoji).toBe('❤️')
  })
})
