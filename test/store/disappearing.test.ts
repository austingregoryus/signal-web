import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { ingestEnvelope } from '../../src/signal/ingest'
import { parseEnvelope } from '../../src/signal/parse'
import { pruneExpired } from '../../src/store/prune'
import type { RawEnvelope } from '../../src/signal/envelopes'
import * as fx from '../fixtures/envelopes'

let store: Store | undefined
let path: string
afterEach(() => {
  store?.close()
  store = undefined
  try { rmSync(path) } catch { /* ignore */ }
})
function tmp(): string {
  path = join(tmpdir(), `swdis-${Date.now()}-${Math.round(performance.now())}.db`)
  return path
}
function open(): Store {
  store = openStore(tmp(), 'k')
  return store
}

const inboundDisappearing: RawEnvelope = {
  envelope: {
    sourceUuid: 'alice-uuid',
    sourceNumber: '+15551110001',
    timestamp: 1000,
    dataMessage: { message: 'secret', timestamp: 1000, expiresInSeconds: 60 },
  },
}
const ownSentDisappearing: RawEnvelope = {
  envelope: {
    sourceUuid: fx.SELF,
    timestamp: 2000,
    syncMessage: { sentMessage: { destination: 'alice-uuid', message: 'mine', timestamp: 2000, expiresInSeconds: 30 } },
  },
}
const timerOff: RawEnvelope = {
  envelope: {
    sourceUuid: 'alice-uuid',
    timestamp: 3000,
    dataMessage: { timestamp: 3000, expiresInSeconds: 0, isExpirationUpdate: true },
  },
}

describe('disappearing messages', () => {
  it('parses the timer on messages and timer-change notices', () => {
    expect(parseEnvelope(inboundDisappearing, fx.SELF)[0]).toMatchObject({ kind: 'message', expiresInSeconds: 60 })
    expect(parseEnvelope(timerOff, fx.SELF)).toEqual([
      { kind: 'timer', conversationId: 'alice-uuid', conversationType: 'dm', expiresInSeconds: 0 },
    ])
    // A message without the field doesn't claim a timer.
    expect(parseEnvelope(fx.inboundText, fx.SELF)[0]).not.toHaveProperty('expiresInSeconds')
  })

  it('starts inbound timers on arrival and outbound timers at send time', () => {
    const s = open()
    ingestEnvelope(s, inboundDisappearing, fx.SELF, 5000)
    ingestEnvelope(s, ownSentDisappearing, fx.SELF, 5000)
    const byBody = Object.fromEntries(s.messages.listByConversation('alice-uuid', 10, undefined, 0).map((m) => [m.body, m.expiresAt]))
    expect(byBody).toEqual({ secret: 5000 + 60_000, mine: 2000 + 30_000 })
  })

  it('tracks the conversation timer, including a "timer off" notice', () => {
    const s = open()
    ingestEnvelope(s, inboundDisappearing, fx.SELF, 5000)
    expect(s.conversations.getExpireTimer('alice-uuid')).toBe(60_000)
    ingestEnvelope(s, timerOff, fx.SELF, 6000)
    expect(s.conversations.getExpireTimer('alice-uuid')).toBe(0)
    expect(s.messages.listByConversation('alice-uuid', 10, undefined, 0)).toHaveLength(1) // notice isn't a message
  })

  it('a redelivered envelope cannot push back the expiry', () => {
    const s = open()
    ingestEnvelope(s, inboundDisappearing, fx.SELF, 5000)
    ingestEnvelope(s, inboundDisappearing, fx.SELF, 50_000)
    expect(s.messages.listByConversation('alice-uuid', 10, undefined, 0)[0].expiresAt).toBe(65_000)
  })

  it('hides expired messages and the sweep deletes them with their reactions, receipts and attachments', () => {
    const s = open()
    s.conversations.ensure({ id: 'c', type: 'dm' })
    s.messages.upsert({ conversationId: 'c', authorId: 'a', timestamp: 100, direction: 'in', body: 'gone', receivedAt: 100, expiresAt: 1000 })
    s.messages.upsert({ conversationId: 'c', authorId: 'a', timestamp: 200, direction: 'in', body: 'kept', receivedAt: 200 })
    s.reactions.apply({ targetAuthorId: 'a', targetTimestamp: 100, reactorId: 'me', emoji: '👍', timestamp: 150 })
    s.receipts.record({ targetAuthorId: 'a', targetTimestamp: 100, recipientId: 'b', type: 'read', timestamp: 150 })
    s.attachments.add({ id: 'att1', messageAuthorId: 'a', messageTimestamp: 100, contentType: 'image/png', size: 3, signalId: null })

    expect(s.messages.listByConversation('c', 10, undefined, 999).map((m) => m.body)).toEqual(['kept', 'gone'])
    expect(s.messages.listByConversation('c', 10, undefined, 1000).map((m) => m.body)).toEqual(['kept'])

    expect(pruneExpired(s, 999).messages).toBe(0)
    const res = pruneExpired(s, 1000)
    expect(res).toMatchObject({ messages: 1, reactions: 1, receipts: 1, attachments: 1, attachmentIds: ['att1'] })
    expect(s.messages.listByConversation('c', 10, undefined, 0).map((m) => m.body)).toEqual(['kept'])
  })

  it('adds the expiry columns when opening a DB created before they existed', () => {
    const p = tmp()
    const legacy = new Database(p)
    legacy.pragma("key = 'k'")
    legacy.exec(`
      CREATE TABLE schema_meta (version INTEGER NOT NULL);
      INSERT INTO schema_meta (version) VALUES (6);
      CREATE TABLE conversations (id TEXT PRIMARY KEY, type TEXT NOT NULL, display_name TEXT, avatar_path TEXT,
        last_activity INTEGER NOT NULL DEFAULT 0, last_read_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, author_id TEXT NOT NULL,
        author_number TEXT, timestamp INTEGER NOT NULL, received_at INTEGER NOT NULL, direction TEXT NOT NULL, body TEXT,
        quote_author_id TEXT, quote_timestamp INTEGER, edited_timestamp INTEGER, deleted INTEGER NOT NULL DEFAULT 0,
        UNIQUE(author_id, timestamp, conversation_id));
      INSERT INTO conversations (id, type) VALUES ('c', 'dm');
      INSERT INTO messages (conversation_id, author_id, timestamp, received_at, direction, body) VALUES ('c', 'a', 1, 1, 'in', 'old row');
    `)
    legacy.close()
    store = openStore(p, 'k')
    expect(store.messages.listByConversation('c', 10)[0]).toMatchObject({ body: 'old row', expiresAt: null })
    expect(store.conversations.list()[0].expireTimerMs).toBe(0)
  })
})
