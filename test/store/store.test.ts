import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import Database from 'better-sqlite3-multiple-ciphers'
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
    expect(version.version).toBe(6)
    store.close()
  })

  it('migrates a v5 messages table to the widened v6 unique key, preserving data', () => {
    const path = tmpDb()
    const key = 'migrate-key'

    // Build a v5-shaped DB: old narrow UNIQUE(author_id, timestamp) + version 5.
    const legacy = new Database(path)
    legacy.pragma(`key = '${key}'`)
    legacy.pragma('journal_mode = WAL')
    legacy.exec(`
      CREATE TABLE schema_meta (version INTEGER NOT NULL);
      INSERT INTO schema_meta (version) VALUES (5);
      CREATE TABLE messages (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id  TEXT NOT NULL,
        author_id        TEXT NOT NULL,
        author_number    TEXT,
        timestamp        INTEGER NOT NULL,
        received_at      INTEGER NOT NULL,
        direction        TEXT NOT NULL,
        body             TEXT,
        quote_author_id  TEXT,
        quote_timestamp  INTEGER,
        edited_timestamp INTEGER,
        deleted          INTEGER NOT NULL DEFAULT 0,
        UNIQUE(author_id, timestamp)
      );
      INSERT INTO messages (conversation_id, author_id, timestamp, received_at, direction, body)
        VALUES ('group-1', 'alice', 1000, 1000, 'in', 'hello group');
    `)
    legacy.close()

    // Reopen through openStore — the migration should fire.
    const store = openStore(path, key)
    const version = store.db.prepare('SELECT version FROM schema_meta').get() as { version: number }
    expect(version.version).toBe(6)

    // Existing row survived.
    const rows = store.db.prepare('SELECT conversation_id, body FROM messages').all() as {
      conversation_id: string
      body: string
    }[]
    expect(rows).toEqual([{ conversation_id: 'group-1', body: 'hello group' }])

    // The widened key now allows a same-(author,timestamp) message in a
    // different conversation instead of overwriting the group message.
    store.messages.upsert({
      conversationId: 'dm-alice',
      authorId: 'alice',
      timestamp: 1000,
      receivedAt: 2000,
      direction: 'in',
      body: 'sneaky dm',
    })
    const after = store.db
      .prepare('SELECT conversation_id, body FROM messages ORDER BY conversation_id')
      .all() as { conversation_id: string; body: string }[]
    expect(after).toEqual([
      { conversation_id: 'dm-alice', body: 'sneaky dm' },
      { conversation_id: 'group-1', body: 'hello group' },
    ])
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
