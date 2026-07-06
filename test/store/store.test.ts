import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore } from '../../src/store/store'

const paths: string[] = []
function tmpDb(): string {
  // Unique per call (not per index) so reopened-with-a-different-key tests get
  // a fresh file — reusing a path across tests leaks the WAL/SHM and confuses
  // SQLCipher's wrong-key detection.
  const p = join(tmpdir(), `signal-web-test-${Date.now()}-${Math.round(performance.now())}-${process.pid}.db`)
  paths.push(p)
  return p
}

afterEach(() => {
  for (const p of paths.splice(0)) {
    try { rmSync(p) } catch { /* ignore */ }
  }
})

describe('openStore', () => {
  it('creates the schema and records the version', () => {
    const store = openStore(tmpDb(), 'test-key-123')
    const tables = (
      store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[]
    ).map((r) => r.name)
    expect(tables).toContain('messages')
    expect(tables).toContain('conversations')
    expect(tables).toContain('reactions')
    expect(tables).toContain('receipts')
    expect(tables).toContain('attachments')
    expect(tables).toContain('contact_aliases')
    const version = store.db.prepare('SELECT version FROM schema_meta').get() as { version: number }
    expect(version.version).toBe(5)
    store.close()
  })

  it('encrypts at rest — opening with the wrong key fails', () => {
    const path = tmpDb()
    const store = openStore(path, 'correct-key')
    store.close()

    expect(() => {
      const bad = openStore(path, 'wrong-key')
      // force a read; the wrong key surfaces as a "file is not a database" error
      bad.db.prepare('SELECT version FROM schema_meta').get()
    }).toThrow()
  })
})
