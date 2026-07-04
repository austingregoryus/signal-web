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
  path = join(tmpdir(), `swrc-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

const t = { targetAuthorId: 'self', targetTimestamp: 1000 }

describe('ReceiptRepo', () => {
  it('records per-recipient rows (group receipts are not a single boolean)', () => {
    const s = open()
    s.receipts.record({ ...t, recipientId: 'uuid-b', type: 'read', timestamp: 1100 })
    s.receipts.record({ ...t, recipientId: 'uuid-c', type: 'read', timestamp: 1200 })
    expect(s.receipts.listForMessage('self', 1000)).toHaveLength(2)
  })

  it('is orphan-tolerant and keeps the latest timestamp per (recipient,type)', () => {
    const s = open()
    s.receipts.record({ ...t, recipientId: 'uuid-b', type: 'read', timestamp: 1100 })
    s.receipts.record({ ...t, recipientId: 'uuid-b', type: 'read', timestamp: 1300 })
    const rows = s.receipts.listForMessage('self', 1000)
    expect(rows).toHaveLength(1)
    expect(rows[0].timestamp).toBe(1300)
  })
})
