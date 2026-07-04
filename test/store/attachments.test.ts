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
  path = join(tmpdir(), `swa-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

describe('AttachmentRepo', () => {
  it('adds and lists attachment metadata for a message', () => {
    const s = open()
    s.attachments.add({
      id: 'att-1',
      messageAuthorId: 'uuid-a',
      messageTimestamp: 1000,
      contentType: 'image/jpeg',
      filename: 'photo.jpg',
      size: 2048,
      signalId: 'sig-xyz',
    })
    const list = s.attachments.listForMessage('uuid-a', 1000)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'att-1', contentType: 'image/jpeg', signalId: 'sig-xyz' })
  })
})
