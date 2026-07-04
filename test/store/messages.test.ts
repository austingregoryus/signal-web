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
  path = join(tmpdir(), `swm-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

const base = {
  conversationId: 'conv-1',
  authorId: 'uuid-a',
  authorNumber: '+15551110000',
  quoteAuthorId: null,
  quoteTimestamp: null,
}

describe('MessageRepo', () => {
  it('upserts and lists a message', () => {
    const s = open()
    s.messages.upsert({ ...base, timestamp: 1000, direction: 'in', body: 'hi', receivedAt: 1 })
    const rows = s.messages.listByConversation('conv-1', 10)
    expect(rows).toHaveLength(1)
    expect(rows[0].body).toBe('hi')
    expect(rows[0].direction).toBe('in')
    expect(rows[0].deleted).toBe(0)
  })

  it('is idempotent on (authorId, timestamp) — no duplicate on re-ingest', () => {
    const s = open()
    const m = { ...base, timestamp: 1000, direction: 'in' as const, body: 'hi', receivedAt: 1 }
    s.messages.upsert(m)
    s.messages.upsert(m)
    expect(s.messages.listByConversation('conv-1', 10)).toHaveLength(1)
  })

  it('lists newest first', () => {
    const s = open()
    s.messages.upsert({ ...base, timestamp: 1000, direction: 'in', body: 'old', receivedAt: 1 })
    s.messages.upsert({ ...base, timestamp: 2000, direction: 'in', body: 'new', receivedAt: 2 })
    const rows = s.messages.listByConversation('conv-1', 10)
    expect(rows.map((r) => r.body)).toEqual(['new', 'old'])
  })

  it('markDeleted tombstones the row and clears the body', () => {
    const s = open()
    s.messages.upsert({ ...base, timestamp: 1000, direction: 'in', body: 'secret', receivedAt: 1 })
    s.messages.markDeleted('uuid-a', 1000)
    const row = s.messages.listByConversation('conv-1', 10)[0]
    expect(row.deleted).toBe(1)
    expect(row.body).toBeNull()
  })

  it('applyEdit updates body and editedTimestamp', () => {
    const s = open()
    s.messages.upsert({ ...base, timestamp: 1000, direction: 'in', body: 'typo', receivedAt: 1 })
    s.messages.applyEdit('uuid-a', 1000, 'fixed', 1500)
    const row = s.messages.listByConversation('conv-1', 10)[0]
    expect(row.body).toBe('fixed')
    expect(row.editedTimestamp).toBe(1500)
  })

  it('re-ingest after delete does not resurrect the body', () => {
    const s = open()
    const m = { ...base, timestamp: 1000, direction: 'in' as const, body: 'secret', receivedAt: 1 }
    s.messages.upsert(m)
    s.messages.markDeleted('uuid-a', 1000)
    s.messages.upsert(m) // redelivery
    const row = s.messages.listByConversation('conv-1', 10)[0]
    expect(row.deleted).toBe(1)
    expect(row.body).toBeNull()
  })

  it('re-ingest of the original after an edit does not reset the edited body', () => {
    const s = open()
    const m = { ...base, timestamp: 1000, direction: 'in' as const, body: 'typo', receivedAt: 1 }
    s.messages.upsert(m)
    s.messages.applyEdit('uuid-a', 1000, 'fixed', 1500)
    s.messages.upsert(m) // redelivery of the original envelope
    const row = s.messages.listByConversation('conv-1', 10)[0]
    expect(row.body).toBe('fixed')
    expect(row.editedTimestamp).toBe(1500)
  })
})
