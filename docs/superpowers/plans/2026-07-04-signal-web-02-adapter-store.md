# Signal Web — Milestone 2: Signal Adapter & Encrypted Store — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Signal conversations, messages, reactions, receipts, and attachment metadata in an encrypted (SQLCipher) store, and build the ingestion adapter that turns raw signal-cli envelopes — including own-sent sync messages, edits, and deletes — into idempotent store writes.

**Architecture:** A thin encrypted-SQLite layer (`better-sqlite3-multiple-ciphers`) exposes focused repositories (messages, conversations, reactions, receipts, attachments). A pure `parseEnvelope` normalizes a `RawEnvelope` into typed domain events; an `ingestEnvelope` router applies those events to the repositories. Message identity is `(author_id, timestamp)`, upserted idempotently so WS redelivery never duplicates. Typing is memory-only and never stored. A pure `pruneOlderThan` enforces the rolling window.

**Tech Stack:** Node 24 / TypeScript / `better-sqlite3-multiple-ciphers` (synchronous SQLCipher) / Vitest.

## Global Constraints

- **ESM + `moduleResolution: "Bundler"`** — imports need no `.js` extension.
- **SQLCipher binding:** `better-sqlite3-multiple-ciphers` (synchronous). Set the key with `PRAGMA key = ...` immediately after opening, before any other statement. Never log the key.
- **Message identity / dedup:** `(author_id, timestamp)` UNIQUE. `author_id` = source UUID when present, else source number. Writes are idempotent upserts — re-ingesting the same envelope must not create a duplicate or throw.
- **Own-sent (spec §5.2):** a `sync-sent` envelope is stored as a message with `direction = 'out'`; an inbound `data` envelope is `direction = 'in'`.
- **Orphan tolerance:** reactions and receipts may reference a target message that was pruned or has not arrived. Store them anyway; never require the target to exist.
- **Typing is memory-only** — never written to the store.
- **Retention:** everything is prunable by timestamp; `pruneOlderThan(now, windowMs)` deletes messages, reactions, receipts, and attachments older than the cutoff. Default window = 14 days.
- **Log hygiene (spec §9):** no message bodies, phone numbers, or keys in logs.
- All new code under `src/store/` and `src/signal/`. Tests mirror under `test/`.

## File Structure

- `src/store/schema.ts` — SQL schema + `SCHEMA_VERSION`, applied on open.
- `src/store/store.ts` — `openStore(path, key)` → `Store` (wraps the DB + repositories).
- `src/store/identity.ts` — `authorId(uuid?, number?)` shared identity helper.
- `src/store/messages.ts` — `MessageRepo`.
- `src/store/conversations.ts` — `ConversationRepo`.
- `src/store/reactions.ts` — `ReactionRepo`.
- `src/store/receipts.ts` — `ReceiptRepo`.
- `src/store/attachments.ts` — `AttachmentRepo`.
- `src/store/prune.ts` — `pruneOlderThan`.
- `src/signal/parse.ts` — `parseEnvelope` (RawEnvelope → domain events).
- `src/signal/ingest.ts` — `ingestEnvelope` (domain events → repositories).
- `test/fixtures/envelopes.ts` — recorded/representative envelope fixtures.

---

### Task 1: Encrypted store bootstrap + schema

**Files:**
- Create: `src/store/schema.ts`, `src/store/identity.ts`, `src/store/store.ts`
- Test: `test/store/store.test.ts`, `test/store/identity.test.ts`
- Modify: `package.json` (add dependency)

**Interfaces:**
- Produces:
  - `authorId(uuid?: string | null, number?: string | null): string` — returns `uuid` if truthy, else `number`, else throws `Error('authorId requires uuid or number')`.
  - `SCHEMA_VERSION: number` and `SCHEMA_SQL: string` from `schema.ts`.
  - `interface Store { db: Database; close(): void }` (repositories are attached in later tasks; for now `Store` wraps the raw DB). `openStore(path: string, key: string): Store` — opens the DB, applies `PRAGMA key`, applies schema, sets `schema_meta.version`.

- [ ] **Step 1: Add the dependency**

Run: `npm install better-sqlite3-multiple-ciphers` and `npm install -D @types/better-sqlite3`
Expected: installs a prebuilt binary (no compiler needed on supported platforms). If it tries to compile and fails, report BLOCKED with the error — do not hand-roll a build.

- [ ] **Step 2: Write the failing test** — `test/store/identity.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { authorId } from '../../src/store/identity'

describe('authorId', () => {
  it('prefers uuid when present', () => {
    expect(authorId('uuid-1', '+15551234567')).toBe('uuid-1')
  })
  it('falls back to number when uuid is missing', () => {
    expect(authorId(null, '+15551234567')).toBe('+15551234567')
    expect(authorId(undefined, '+15551234567')).toBe('+15551234567')
  })
  it('throws when neither is present', () => {
    expect(() => authorId(null, null)).toThrow(/requires uuid or number/)
  })
})
```

- [ ] **Step 3: Run it — expect FAIL** (`npm test test/store/identity.test.ts`) — cannot resolve module.

- [ ] **Step 4: Implement** — `src/store/identity.ts`

```ts
export function authorId(uuid?: string | null, number?: string | null): string {
  if (uuid) return uuid
  if (number) return number
  throw new Error('authorId requires uuid or number')
}
```

- [ ] **Step 5: Run it — expect PASS.**

- [ ] **Step 6: Write the schema** — `src/store/schema.ts`

```ts
export const SCHEMA_VERSION = 1

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,           -- group id (base64) or contact author_id
  type          TEXT NOT NULL,              -- 'dm' | 'group'
  display_name  TEXT,                       -- resolved in a later milestone; may be null
  avatar_path   TEXT,                       -- resolved in a later milestone
  last_activity INTEGER NOT NULL DEFAULT 0  -- ms timestamp of newest message
);

CREATE TABLE IF NOT EXISTS messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  TEXT NOT NULL,
  author_id        TEXT NOT NULL,           -- uuid preferred, else number
  author_number    TEXT,
  timestamp        INTEGER NOT NULL,        -- Signal message timestamp (ms) — identity
  received_at      INTEGER NOT NULL,        -- when we stored it (ms)
  direction        TEXT NOT NULL,           -- 'in' | 'out'
  body             TEXT,
  quote_author_id  TEXT,
  quote_timestamp  INTEGER,
  edited_timestamp INTEGER,                 -- set when the message was edited
  deleted          INTEGER NOT NULL DEFAULT 0,  -- tombstone (remoteDelete)
  UNIQUE(author_id, timestamp)
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id, timestamp);

CREATE TABLE IF NOT EXISTS reactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  target_author_id TEXT NOT NULL,
  target_timestamp INTEGER NOT NULL,
  reactor_id       TEXT NOT NULL,
  emoji            TEXT NOT NULL,
  timestamp        INTEGER NOT NULL,
  UNIQUE(target_author_id, target_timestamp, reactor_id)
);

CREATE TABLE IF NOT EXISTS receipts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  target_author_id TEXT NOT NULL,
  target_timestamp INTEGER NOT NULL,
  recipient_id     TEXT NOT NULL,
  type             TEXT NOT NULL,           -- 'delivery' | 'read' | 'viewed'
  timestamp        INTEGER NOT NULL,
  UNIQUE(target_author_id, target_timestamp, recipient_id, type)
);

CREATE TABLE IF NOT EXISTS attachments (
  id                TEXT PRIMARY KEY,       -- opaque internal id
  message_author_id TEXT NOT NULL,
  message_timestamp INTEGER NOT NULL,
  content_type      TEXT,
  filename          TEXT,
  size              INTEGER,
  signal_id         TEXT,                   -- signal-cli attachment id (fetch later)
  stored_path       TEXT                    -- set when downloaded+encrypted (later milestone)
);
CREATE INDEX IF NOT EXISTS idx_attachments_message
  ON attachments(message_author_id, message_timestamp);
`
```

- [ ] **Step 7: Write the failing store test** — `test/store/store.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore } from '../../src/store/store'

const paths: string[] = []
function tmpDb(): string {
  const p = join(tmpdir(), `signal-web-test-${paths.length}-${process.pid}.db`)
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
    const tables = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: { name: string }) => r.name)
    expect(tables).toContain('messages')
    expect(tables).toContain('conversations')
    expect(tables).toContain('reactions')
    expect(tables).toContain('receipts')
    expect(tables).toContain('attachments')
    const version = store.db.prepare('SELECT version FROM schema_meta').get() as { version: number }
    expect(version.version).toBe(1)
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
```

- [ ] **Step 8: Run it — expect FAIL** (`openStore` missing).

- [ ] **Step 9: Implement** — `src/store/store.ts`

```ts
import Database from 'better-sqlite3-multiple-ciphers'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'

export interface Store {
  db: Database.Database
  close(): void
}

export function openStore(path: string, key: string): Store {
  const db = new Database(path)
  // Key MUST be set before any other statement.
  db.pragma(`key = '${key.replace(/'/g, "''")}'`)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA_SQL)

  const existing = db.prepare('SELECT version FROM schema_meta').get() as
    | { version: number }
    | undefined
  if (!existing) {
    db.prepare('INSERT INTO schema_meta (version) VALUES (?)').run(SCHEMA_VERSION)
  }

  return {
    db,
    close: () => db.close(),
  }
}
```

- [ ] **Step 10: Run both store tests — expect PASS.** (`npm test test/store/`)

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json src/store/schema.ts src/store/identity.ts src/store/store.ts test/store/
git commit -m "feat: encrypted SQLCipher store bootstrap and schema"
```

---

### Task 2: Message repository (upsert / dedup / list / edit / delete)

**Files:**
- Create: `src/store/messages.ts`
- Modify: `src/store/store.ts` (attach `messages` repo to `Store`)
- Test: `test/store/messages.test.ts`

**Interfaces:**
- Consumes: `Store.db`, `authorId`.
- Produces (attach `messages: MessageRepo` to `Store`):
  - `interface MessageInput { conversationId: string; authorId: string; authorNumber?: string | null; timestamp: number; direction: 'in' | 'out'; body?: string | null; quoteAuthorId?: string | null; quoteTimestamp?: number | null; receivedAt: number }`
  - `interface StoredMessage extends MessageInput { id: number; editedTimestamp: number | null; deleted: 0 | 1 }`
  - `class MessageRepo`:
    - `upsert(m: MessageInput): void` — idempotent on `(authorId, timestamp)`; on conflict updates mutable fields (body, quote, conversationId) but never resets `deleted`/`editedTimestamp`.
    - `listByConversation(conversationId: string, limit: number): StoredMessage[]` — newest first, excludes nothing (deleted rows are returned with `deleted=1` so the UI can tombstone them).
    - `markDeleted(authorId: string, timestamp: number): void` — sets `deleted=1`, clears `body`. No-op if the row is absent.
    - `applyEdit(authorId: string, timestamp: number, newBody: string, editedTimestamp: number): void` — updates `body` + `editedTimestamp`. No-op if absent.

- [ ] **Step 1: Write the failing test** — `test/store/messages.test.ts`

```ts
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
})
```

- [ ] **Step 2: Run it — expect FAIL** (`messages` repo not attached).

- [ ] **Step 3: Implement the repo** — `src/store/messages.ts`

```ts
import type Database from 'better-sqlite3-multiple-ciphers'

export interface MessageInput {
  conversationId: string
  authorId: string
  authorNumber?: string | null
  timestamp: number
  direction: 'in' | 'out'
  body?: string | null
  quoteAuthorId?: string | null
  quoteTimestamp?: number | null
  receivedAt: number
}

export interface StoredMessage extends MessageInput {
  id: number
  editedTimestamp: number | null
  deleted: 0 | 1
}

interface Row {
  id: number
  conversation_id: string
  author_id: string
  author_number: string | null
  timestamp: number
  received_at: number
  direction: 'in' | 'out'
  body: string | null
  quote_author_id: string | null
  quote_timestamp: number | null
  edited_timestamp: number | null
  deleted: 0 | 1
}

function toStored(r: Row): StoredMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    authorId: r.author_id,
    authorNumber: r.author_number,
    timestamp: r.timestamp,
    receivedAt: r.received_at,
    direction: r.direction,
    body: r.body,
    quoteAuthorId: r.quote_author_id,
    quoteTimestamp: r.quote_timestamp,
    editedTimestamp: r.edited_timestamp,
    deleted: r.deleted,
  }
}

export class MessageRepo {
  constructor(private readonly db: Database.Database) {}

  upsert(m: MessageInput): void {
    // On conflict, update only conversation/body/quote — never touch deleted/edited,
    // so a redelivered envelope cannot resurrect a tombstoned or edited message.
    this.db
      .prepare(
        `INSERT INTO messages
           (conversation_id, author_id, author_number, timestamp, received_at,
            direction, body, quote_author_id, quote_timestamp)
         VALUES (@conversationId, @authorId, @authorNumber, @timestamp, @receivedAt,
                 @direction, @body, @quoteAuthorId, @quoteTimestamp)
         ON CONFLICT(author_id, timestamp) DO UPDATE SET
           conversation_id = excluded.conversation_id,
           body            = CASE WHEN messages.deleted = 1 THEN messages.body ELSE excluded.body END,
           quote_author_id = excluded.quote_author_id,
           quote_timestamp = excluded.quote_timestamp`,
      )
      .run({
        conversationId: m.conversationId,
        authorId: m.authorId,
        authorNumber: m.authorNumber ?? null,
        timestamp: m.timestamp,
        receivedAt: m.receivedAt,
        direction: m.direction,
        body: m.body ?? null,
        quoteAuthorId: m.quoteAuthorId ?? null,
        quoteTimestamp: m.quoteTimestamp ?? null,
      })
  }

  listByConversation(conversationId: string, limit: number): StoredMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE conversation_id = ?
         ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(conversationId, limit) as Row[]
    return rows.map(toStored)
  }

  markDeleted(authorId: string, timestamp: number): void {
    this.db
      .prepare(
        `UPDATE messages SET deleted = 1, body = NULL
         WHERE author_id = ? AND timestamp = ?`,
      )
      .run(authorId, timestamp)
  }

  applyEdit(authorId: string, timestamp: number, newBody: string, editedTimestamp: number): void {
    this.db
      .prepare(
        `UPDATE messages SET body = ?, edited_timestamp = ?
         WHERE author_id = ? AND timestamp = ? AND deleted = 0`,
      )
      .run(newBody, editedTimestamp, authorId, timestamp)
  }
}
```

- [ ] **Step 4: Attach the repo in `src/store/store.ts`**

Add the import and extend `Store`:

```ts
import { MessageRepo } from './messages'
```

Change the `Store` interface and `openStore` return:

```ts
export interface Store {
  db: Database.Database
  messages: MessageRepo
  close(): void
}
```

In `openStore`, before the `return`, construct the repo, and include it:

```ts
  const messages = new MessageRepo(db)

  return {
    db,
    messages,
    close: () => db.close(),
  }
```

- [ ] **Step 5: Run the message tests — expect PASS.** (`npm test test/store/messages.test.ts`)

- [ ] **Step 6: Run the full suite — expect PASS.** (`npm test`)

- [ ] **Step 7: Commit**

```bash
git add src/store/messages.ts src/store/store.ts test/store/messages.test.ts
git commit -m "feat: message repository with idempotent upsert, edit, delete"
```

---

### Task 3: Conversation repository

**Files:**
- Create: `src/store/conversations.ts`
- Modify: `src/store/store.ts` (attach `conversations`)
- Test: `test/store/conversations.test.ts`

**Interfaces:**
- Produces (attach `conversations: ConversationRepo`):
  - `interface ConversationInput { id: string; type: 'dm' | 'group'; displayName?: string | null }`
  - `interface StoredConversation { id: string; type: 'dm' | 'group'; displayName: string | null; avatarPath: string | null; lastActivity: number }`
  - `class ConversationRepo`:
    - `ensure(c: ConversationInput): void` — inserts if absent; if present, updates `type` and (only when non-null) `displayName`. Never lowers `lastActivity`.
    - `touch(id: string, activityTs: number): void` — raises `lastActivity` to `activityTs` if greater.
    - `list(): StoredConversation[]` — ordered by `lastActivity` DESC.

- [ ] **Step 1: Write the failing test** — `test/store/conversations.test.ts`

```ts
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
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — `src/store/conversations.ts`

```ts
import type Database from 'better-sqlite3-multiple-ciphers'

export interface ConversationInput {
  id: string
  type: 'dm' | 'group'
  displayName?: string | null
}

export interface StoredConversation {
  id: string
  type: 'dm' | 'group'
  displayName: string | null
  avatarPath: string | null
  lastActivity: number
}

interface Row {
  id: string
  type: 'dm' | 'group'
  display_name: string | null
  avatar_path: string | null
  last_activity: number
}

export class ConversationRepo {
  constructor(private readonly db: Database.Database) {}

  ensure(c: ConversationInput): void {
    this.db
      .prepare(
        `INSERT INTO conversations (id, type, display_name)
         VALUES (@id, @type, @displayName)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           display_name = COALESCE(excluded.display_name, conversations.display_name)`,
      )
      .run({ id: c.id, type: c.type, displayName: c.displayName ?? null })
  }

  touch(id: string, activityTs: number): void {
    this.db
      .prepare(
        `UPDATE conversations SET last_activity = ?
         WHERE id = ? AND ? > last_activity`,
      )
      .run(activityTs, id, activityTs)
  }

  list(): StoredConversation[] {
    const rows = this.db
      .prepare('SELECT * FROM conversations ORDER BY last_activity DESC')
      .all() as Row[]
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      displayName: r.display_name,
      avatarPath: r.avatar_path,
      lastActivity: r.last_activity,
    }))
  }
}
```

- [ ] **Step 4: Attach in `store.ts`** — import `ConversationRepo`, add `conversations: ConversationRepo` to the `Store` interface, construct `const conversations = new ConversationRepo(db)`, and include `conversations` in the returned object.

- [ ] **Step 5: Run conversation tests + full suite — expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/store/conversations.ts src/store/store.ts test/store/conversations.test.ts
git commit -m "feat: conversation repository"
```

---

### Task 4: Reactions repository

**Files:**
- Create: `src/store/reactions.ts`
- Modify: `src/store/store.ts`
- Test: `test/store/reactions.test.ts`

**Interfaces:**
- Produces (attach `reactions: ReactionRepo`):
  - `interface ReactionInput { targetAuthorId: string; targetTimestamp: number; reactorId: string; emoji: string; timestamp: number }`
  - `interface StoredReaction { targetAuthorId: string; targetTimestamp: number; reactorId: string; emoji: string; timestamp: number }`
  - `class ReactionRepo`:
    - `apply(r: ReactionInput): void` — upsert on `(targetAuthorId, targetTimestamp, reactorId)`; a new emoji from the same reactor replaces the old one. Orphan-tolerant (no requirement that the target message exists).
    - `remove(targetAuthorId: string, targetTimestamp: number, reactorId: string): void`
    - `listForMessage(targetAuthorId: string, targetTimestamp: number): StoredReaction[]`

- [ ] **Step 1: Write the failing test** — `test/store/reactions.test.ts`

```ts
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
})
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — `src/store/reactions.ts`

```ts
import type Database from 'better-sqlite3-multiple-ciphers'

export interface ReactionInput {
  targetAuthorId: string
  targetTimestamp: number
  reactorId: string
  emoji: string
  timestamp: number
}

export type StoredReaction = ReactionInput

interface Row {
  target_author_id: string
  target_timestamp: number
  reactor_id: string
  emoji: string
  timestamp: number
}

export class ReactionRepo {
  constructor(private readonly db: Database.Database) {}

  apply(r: ReactionInput): void {
    this.db
      .prepare(
        `INSERT INTO reactions
           (target_author_id, target_timestamp, reactor_id, emoji, timestamp)
         VALUES (@targetAuthorId, @targetTimestamp, @reactorId, @emoji, @timestamp)
         ON CONFLICT(target_author_id, target_timestamp, reactor_id) DO UPDATE SET
           emoji = excluded.emoji,
           timestamp = excluded.timestamp`,
      )
      .run(r)
  }

  remove(targetAuthorId: string, targetTimestamp: number, reactorId: string): void {
    this.db
      .prepare(
        `DELETE FROM reactions
         WHERE target_author_id = ? AND target_timestamp = ? AND reactor_id = ?`,
      )
      .run(targetAuthorId, targetTimestamp, reactorId)
  }

  listForMessage(targetAuthorId: string, targetTimestamp: number): StoredReaction[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM reactions
         WHERE target_author_id = ? AND target_timestamp = ?
         ORDER BY timestamp ASC`,
      )
      .all(targetAuthorId, targetTimestamp) as Row[]
    return rows.map((r) => ({
      targetAuthorId: r.target_author_id,
      targetTimestamp: r.target_timestamp,
      reactorId: r.reactor_id,
      emoji: r.emoji,
      timestamp: r.timestamp,
    }))
  }
}
```

- [ ] **Step 4: Attach in `store.ts`** — import `ReactionRepo`, add `reactions: ReactionRepo` to `Store`, construct and include it.

- [ ] **Step 5: Run reaction tests + full suite — expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add src/store/reactions.ts src/store/store.ts test/store/reactions.test.ts
git commit -m "feat: orphan-tolerant reaction repository"
```

---

### Task 5: Receipts + attachments repository

**Files:**
- Create: `src/store/receipts.ts`, `src/store/attachments.ts`
- Modify: `src/store/store.ts`
- Test: `test/store/receipts.test.ts`, `test/store/attachments.test.ts`

**Interfaces:**
- Produces (attach `receipts: ReceiptRepo`, `attachments: AttachmentRepo`):
  - `interface ReceiptInput { targetAuthorId: string; targetTimestamp: number; recipientId: string; type: 'delivery' | 'read' | 'viewed'; timestamp: number }`
  - `class ReceiptRepo`:
    - `record(r: ReceiptInput): void` — upsert on `(targetAuthorId, targetTimestamp, recipientId, type)`; keeps the latest timestamp. Orphan-tolerant.
    - `listForMessage(targetAuthorId: string, targetTimestamp: number): ReceiptInput[]`
  - `interface AttachmentInput { id: string; messageAuthorId: string; messageTimestamp: number; contentType?: string | null; filename?: string | null; size?: number | null; signalId?: string | null }`
  - `class AttachmentRepo`:
    - `add(a: AttachmentInput): void` — insert or replace by `id`.
    - `listForMessage(messageAuthorId: string, messageTimestamp: number): AttachmentInput[]`

- [ ] **Step 1: Write the failing receipts test** — `test/store/receipts.test.ts`

```ts
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
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — `src/store/receipts.ts`

```ts
import type Database from 'better-sqlite3-multiple-ciphers'

export interface ReceiptInput {
  targetAuthorId: string
  targetTimestamp: number
  recipientId: string
  type: 'delivery' | 'read' | 'viewed'
  timestamp: number
}

interface Row {
  target_author_id: string
  target_timestamp: number
  recipient_id: string
  type: 'delivery' | 'read' | 'viewed'
  timestamp: number
}

export class ReceiptRepo {
  constructor(private readonly db: Database.Database) {}

  record(r: ReceiptInput): void {
    this.db
      .prepare(
        `INSERT INTO receipts
           (target_author_id, target_timestamp, recipient_id, type, timestamp)
         VALUES (@targetAuthorId, @targetTimestamp, @recipientId, @type, @timestamp)
         ON CONFLICT(target_author_id, target_timestamp, recipient_id, type) DO UPDATE SET
           timestamp = MAX(receipts.timestamp, excluded.timestamp)`,
      )
      .run(r)
  }

  listForMessage(targetAuthorId: string, targetTimestamp: number): ReceiptInput[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM receipts WHERE target_author_id = ? AND target_timestamp = ?`,
      )
      .all(targetAuthorId, targetTimestamp) as Row[]
    return rows.map((r) => ({
      targetAuthorId: r.target_author_id,
      targetTimestamp: r.target_timestamp,
      recipientId: r.recipient_id,
      type: r.type,
      timestamp: r.timestamp,
    }))
  }
}
```

- [ ] **Step 4: Write the failing attachments test** — `test/store/attachments.test.ts`

```ts
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
```

- [ ] **Step 5: Implement** — `src/store/attachments.ts`

```ts
import type Database from 'better-sqlite3-multiple-ciphers'

export interface AttachmentInput {
  id: string
  messageAuthorId: string
  messageTimestamp: number
  contentType?: string | null
  filename?: string | null
  size?: number | null
  signalId?: string | null
}

interface Row {
  id: string
  message_author_id: string
  message_timestamp: number
  content_type: string | null
  filename: string | null
  size: number | null
  signal_id: string | null
}

export class AttachmentRepo {
  constructor(private readonly db: Database.Database) {}

  add(a: AttachmentInput): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO attachments
           (id, message_author_id, message_timestamp, content_type, filename, size, signal_id)
         VALUES (@id, @messageAuthorId, @messageTimestamp, @contentType, @filename, @size, @signalId)`,
      )
      .run({
        id: a.id,
        messageAuthorId: a.messageAuthorId,
        messageTimestamp: a.messageTimestamp,
        contentType: a.contentType ?? null,
        filename: a.filename ?? null,
        size: a.size ?? null,
        signalId: a.signalId ?? null,
      })
  }

  listForMessage(messageAuthorId: string, messageTimestamp: number): AttachmentInput[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM attachments WHERE message_author_id = ? AND message_timestamp = ?`,
      )
      .all(messageAuthorId, messageTimestamp) as Row[]
    return rows.map((r) => ({
      id: r.id,
      messageAuthorId: r.message_author_id,
      messageTimestamp: r.message_timestamp,
      contentType: r.content_type,
      filename: r.filename,
      size: r.size,
      signalId: r.signal_id,
    }))
  }
}
```

- [ ] **Step 6: Attach both in `store.ts`** — import `ReceiptRepo` and `AttachmentRepo`, add `receipts: ReceiptRepo` and `attachments: AttachmentRepo` to `Store`, construct and include them.

- [ ] **Step 7: Run both tests + full suite — expect PASS.**

- [ ] **Step 8: Commit**

```bash
git add src/store/receipts.ts src/store/attachments.ts src/store/store.ts test/store/receipts.test.ts test/store/attachments.test.ts
git commit -m "feat: receipts (per-recipient) and attachment metadata repositories"
```

---

### Task 6: Ingestion adapter (envelope → repositories)

**Files:**
- Modify: `src/signal/envelopes.ts` (widen `RawEnvelope` with the nested fields the adapter reads)
- Create: `src/signal/parse.ts` (`parseEnvelope`), `src/signal/ingest.ts` (`ingestEnvelope`)
- Create: `test/fixtures/envelopes.ts`
- Test: `test/signal/parse.test.ts`, `test/signal/ingest.test.ts`

**Interfaces:**
- Consumes: `Store` and its repositories; `classifyEnvelope`; `authorId`.
- Produces:
  - Widened `RawEnvelope` — add to `envelope`: `sourceUuid?`, `sourceNumber?`, and richer `dataMessage?: { message?; timestamp?; groupInfo?: { groupId?: string }; reaction?: { emoji?; targetAuthor?; targetAuthorNumber?; targetSentTimestamp?; isRemove?: boolean }; quote?: { id?: number; author?; authorNumber? }; attachments?: Array<{ id?; contentType?; filename?; size?: number }>; remoteDelete?: { timestamp?: number } }`, `syncMessage?: { sentMessage?: { destination?; destinationNumber?; message?; timestamp?; groupInfo?; reaction?; quote?; attachments?; remoteDelete? } }`, `editMessage?: { targetSentTimestamp?: number; dataMessage?: { message?: string } }`, `receiptMessage?: { isDelivery?: boolean; isRead?: boolean; isViewed?: boolean; timestamps?: number[] }`.
  - `type DomainEvent` — a discriminated union: `{ kind: 'message'; conversationId; conversationType; authorId; authorNumber?; timestamp; direction; body?; quoteAuthorId?; quoteTimestamp?; attachments: AttachmentInput[] } | { kind: 'reaction'; targetAuthorId; targetTimestamp; reactorId; emoji; remove: boolean; timestamp } | { kind: 'delete'; targetAuthorId; targetTimestamp } | { kind: 'edit'; targetAuthorId; targetTimestamp; newBody; editedTimestamp } | { kind: 'receipt'; targetAuthorId; targetTimestamp; recipientId; type; timestamp } | { kind: 'ignore' }`.
  - `parseEnvelope(raw: RawEnvelope, selfId: string): DomainEvent[]` — pure. `selfId` is the account's own `author_id`, used as the author of `sync-sent` messages and the `targetAuthorId` for receipts about our sent messages. Returns `[{kind:'ignore'}]` for typing/unknown.
  - `ingestEnvelope(store: Store, raw: RawEnvelope, selfId: string, now: number): void` — parses then applies each event to the repositories (message upsert + conversation ensure/touch + attachment add; reaction apply/remove; delete; edit; receipt record). `now` is the `receivedAt`/stored time (injected for deterministic tests).

**Design notes for the implementer:**
- **Conversation id:** group → `dataMessage.groupInfo.groupId` (type `'group'`); DM inbound → the sender's `author_id` (type `'dm'`); DM own-sent → the `destination`/`destinationNumber` resolved via `authorId` (type `'dm'`). A message always ensures its conversation and touches `last_activity` to the message timestamp.
- **Reaction target author:** `reaction.targetAuthor` (uuid) or `targetAuthorNumber`, via `authorId`.
- **Receipts:** `receiptMessage.timestamps[]` are the *sent* timestamps of OUR messages being acknowledged, so `targetAuthorId = selfId`, `recipientId = authorId(sourceUuid, sourceNumber)`, one event per timestamp; `type` from the `isDelivery/isRead/isViewed` flag.
- **Reaction/edit/delete** can arrive inside either `dataMessage` (from others) or `syncMessage.sentMessage` (our own from another device) — handle both by extracting the inner payload first, then branching on which sub-field is present.

- [ ] **Step 1: Widen `RawEnvelope`** in `src/signal/envelopes.ts` — replace the `dataMessage?: unknown` etc. fields with the richer optional shapes listed under Interfaces above. Keep `classifyEnvelope` and `EnvelopeKind` exactly as they are (the union-key checks still work).

- [ ] **Step 2: Create representative fixtures** — `test/fixtures/envelopes.ts`

```ts
import type { RawEnvelope } from '../../src/signal/envelopes'

export const SELF = 'self-uuid'

export const inboundText: RawEnvelope = {
  envelope: {
    sourceUuid: 'alice-uuid',
    sourceNumber: '+15551110001',
    timestamp: 1000,
    dataMessage: { message: 'hello from alice', timestamp: 1000 },
  },
}

export const ownSentText: RawEnvelope = {
  envelope: {
    sourceUuid: SELF,
    timestamp: 2000,
    syncMessage: {
      sentMessage: {
        destination: 'alice-uuid',
        destinationNumber: '+15551110001',
        message: 'reply from my phone',
        timestamp: 2000,
      },
    },
  },
}

export const groupText: RawEnvelope = {
  envelope: {
    sourceUuid: 'bob-uuid',
    sourceNumber: '+15551110002',
    timestamp: 3000,
    dataMessage: { message: 'hi group', timestamp: 3000, groupInfo: { groupId: 'group-xyz' } },
  },
}

export const inboundReaction: RawEnvelope = {
  envelope: {
    sourceUuid: 'alice-uuid',
    timestamp: 3100,
    dataMessage: {
      timestamp: 3100,
      reaction: { emoji: '👍', targetAuthor: SELF, targetSentTimestamp: 2000, isRemove: false },
    },
  },
}

export const remoteDelete: RawEnvelope = {
  envelope: {
    sourceUuid: 'alice-uuid',
    timestamp: 3200,
    dataMessage: { timestamp: 3200, remoteDelete: { timestamp: 1000 } },
  },
}

export const editMessage: RawEnvelope = {
  envelope: {
    sourceUuid: 'alice-uuid',
    timestamp: 3300,
    editMessage: { targetSentTimestamp: 1000, dataMessage: { message: 'hello (edited)' } },
  },
}

export const readReceipt: RawEnvelope = {
  envelope: {
    sourceUuid: 'alice-uuid',
    sourceNumber: '+15551110001',
    timestamp: 3400,
    receiptMessage: { isRead: true, timestamps: [2000] },
  },
}

export const typing: RawEnvelope = {
  envelope: { sourceUuid: 'alice-uuid', timestamp: 3500, typingMessage: { action: 'STARTED' } },
}
```

- [ ] **Step 2b: Run it — expect FAIL** (`npm test test/signal/parse.test.ts`) — `parseEnvelope` missing.

- [ ] **Step 3: Write the failing parse test** — `test/signal/parse.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { parseEnvelope } from '../../src/signal/parse'
import * as fx from '../fixtures/envelopes'

describe('parseEnvelope', () => {
  it('parses an inbound DM text into a message event', () => {
    const [ev] = fx.inboundText.envelope ? parseEnvelope(fx.inboundText, fx.SELF) : []
    expect(ev).toMatchObject({
      kind: 'message', direction: 'in', body: 'hello from alice',
      conversationId: 'alice-uuid', conversationType: 'dm', timestamp: 1000, authorId: 'alice-uuid',
    })
  })

  it('parses an own-sent sync message as an outgoing message to the destination conversation', () => {
    const [ev] = parseEnvelope(fx.ownSentText, fx.SELF)
    expect(ev).toMatchObject({
      kind: 'message', direction: 'out', body: 'reply from my phone',
      conversationId: 'alice-uuid', authorId: fx.SELF, timestamp: 2000,
    })
  })

  it('routes group messages to the group conversation', () => {
    const [ev] = parseEnvelope(fx.groupText, fx.SELF)
    expect(ev).toMatchObject({ kind: 'message', conversationId: 'group-xyz', conversationType: 'group' })
  })

  it('parses a reaction', () => {
    const [ev] = parseEnvelope(fx.inboundReaction, fx.SELF)
    expect(ev).toMatchObject({
      kind: 'reaction', emoji: '👍', targetAuthorId: fx.SELF, targetTimestamp: 2000, remove: false,
    })
  })

  it('parses a remote delete', () => {
    const [ev] = parseEnvelope(fx.remoteDelete, fx.SELF)
    expect(ev).toMatchObject({ kind: 'delete', targetAuthorId: 'alice-uuid', targetTimestamp: 1000 })
  })

  it('parses an edit', () => {
    const [ev] = parseEnvelope(fx.editMessage, fx.SELF)
    expect(ev).toMatchObject({
      kind: 'edit', targetAuthorId: 'alice-uuid', targetTimestamp: 1000, newBody: 'hello (edited)',
    })
  })

  it('parses a read receipt into a per-recipient event with self as target author', () => {
    const [ev] = parseEnvelope(fx.readReceipt, fx.SELF)
    expect(ev).toMatchObject({
      kind: 'receipt', type: 'read', targetAuthorId: fx.SELF, targetTimestamp: 2000, recipientId: 'alice-uuid',
    })
  })

  it('ignores typing', () => {
    expect(parseEnvelope(fx.typing, fx.SELF)).toEqual([{ kind: 'ignore' }])
  })
})
```

- [ ] **Step 4: Implement `parseEnvelope`** — `src/signal/parse.ts`

```ts
import { authorId } from '../store/identity'
import { classifyEnvelope, type RawEnvelope } from './envelopes'
import type { AttachmentInput } from '../store/attachments'

export type DomainEvent =
  | {
      kind: 'message'
      conversationId: string
      conversationType: 'dm' | 'group'
      authorId: string
      authorNumber?: string | null
      timestamp: number
      direction: 'in' | 'out'
      body?: string | null
      quoteAuthorId?: string | null
      quoteTimestamp?: number | null
      attachments: AttachmentInput[]
    }
  | { kind: 'reaction'; targetAuthorId: string; targetTimestamp: number; reactorId: string; emoji: string; remove: boolean; timestamp: number }
  | { kind: 'delete'; targetAuthorId: string; targetTimestamp: number }
  | { kind: 'edit'; targetAuthorId: string; targetTimestamp: number; newBody: string; editedTimestamp: number }
  | { kind: 'receipt'; targetAuthorId: string; targetTimestamp: number; recipientId: string; type: 'delivery' | 'read' | 'viewed'; timestamp: number }
  | { kind: 'ignore' }

type InnerPayload = NonNullable<NonNullable<RawEnvelope['envelope']>['dataMessage']>

function attachmentsFrom(payload: InnerPayload, ownerId: string, ownerTs: number): AttachmentInput[] {
  const list = payload.attachments ?? []
  return list.map((a, i) => ({
    id: `${ownerId}:${ownerTs}:${a.id ?? i}`,
    messageAuthorId: ownerId,
    messageTimestamp: ownerTs,
    contentType: a.contentType ?? null,
    filename: a.filename ?? null,
    size: a.size ?? null,
    signalId: a.id ?? null,
  }))
}

export function parseEnvelope(raw: RawEnvelope, selfId: string): DomainEvent[] {
  const e = raw.envelope
  if (!e) return [{ kind: 'ignore' }]
  const kind = classifyEnvelope(raw)
  const senderId = e.sourceUuid || e.sourceNumber ? authorId(e.sourceUuid, e.sourceNumber) : selfId

  // --- Edit (top-level) ---
  if (e.editMessage) {
    const targetTs = e.editMessage.targetSentTimestamp
    const newBody = e.editMessage.dataMessage?.message
    if (targetTs != null && newBody != null) {
      return [{ kind: 'edit', targetAuthorId: senderId, targetTimestamp: targetTs, newBody, editedTimestamp: e.timestamp ?? targetTs }]
    }
    return [{ kind: 'ignore' }]
  }

  // --- Receipts ---
  if (kind === 'receipt' && e.receiptMessage) {
    const rm = e.receiptMessage
    const type: 'delivery' | 'read' | 'viewed' = rm.isViewed ? 'viewed' : rm.isRead ? 'read' : 'delivery'
    const ts = e.timestamp ?? 0
    return (rm.timestamps ?? []).map((targetTs) => ({
      kind: 'receipt' as const,
      targetAuthorId: selfId,
      targetTimestamp: targetTs,
      recipientId: senderId,
      type,
      timestamp: ts,
    }))
  }

  // --- Data vs sync-sent share the same inner payload shape ---
  const isOwn = kind === 'sync-sent'
  const payload: InnerPayload | undefined = isOwn ? e.syncMessage?.sentMessage : e.dataMessage
  if (!payload) return [{ kind: 'ignore' }]

  // remoteDelete
  if (payload.remoteDelete?.timestamp != null) {
    return [{ kind: 'delete', targetAuthorId: isOwn ? selfId : senderId, targetTimestamp: payload.remoteDelete.timestamp }]
  }

  // reaction
  if (payload.reaction?.emoji != null && payload.reaction.targetSentTimestamp != null) {
    const r = payload.reaction
    const targetAuthorId = r.targetAuthor || r.targetAuthorNumber ? authorId(r.targetAuthor, r.targetAuthorNumber) : selfId
    return [{
      kind: 'reaction',
      targetAuthorId,
      targetTimestamp: r.targetSentTimestamp,
      reactorId: isOwn ? selfId : senderId,
      emoji: r.emoji,
      remove: r.isRemove === true,
      timestamp: e.timestamp ?? 0,
    }]
  }

  // plain message (may carry text and/or attachments)
  const msgTs = payload.timestamp ?? e.timestamp
  if (msgTs == null) return [{ kind: 'ignore' }]

  const groupId = payload.groupInfo?.groupId
  const ownerId = isOwn ? selfId : senderId
  let conversationId: string
  let conversationType: 'dm' | 'group'
  if (groupId) {
    conversationId = groupId
    conversationType = 'group'
  } else if (isOwn) {
    conversationId = authorId(payload.destination, payload.destinationNumber)
    conversationType = 'dm'
  } else {
    conversationId = senderId
    conversationType = 'dm'
  }

  const attachments = attachmentsFrom(payload, ownerId, msgTs)
  if (payload.message == null && attachments.length === 0) return [{ kind: 'ignore' }]

  return [{
    kind: 'message',
    conversationId,
    conversationType,
    authorId: ownerId,
    authorNumber: isOwn ? null : e.sourceNumber ?? null,
    timestamp: msgTs,
    direction: isOwn ? 'out' : 'in',
    body: payload.message ?? null,
    quoteAuthorId: payload.quote ? authorId(payload.quote.author, payload.quote.authorNumber) : null,
    quoteTimestamp: payload.quote?.id ?? null,
    attachments,
  }]
}
```

Note: `parse.ts` references `payload.destination`, `payload.quote`, `payload.groupInfo`, etc. Ensure the widened `RawEnvelope` in Step 1 includes `destination?`, `destinationNumber?`, `quote?`, `groupInfo?`, `attachments?`, `reaction?`, `remoteDelete?`, `message?`, `timestamp?` on BOTH `dataMessage` and `syncMessage.sentMessage` (they share the `InnerPayload` type via the `dataMessage` shape).

- [ ] **Step 5: Run parse tests — expect PASS.** (`npm test test/signal/parse.test.ts`)

- [ ] **Step 6: Write the failing ingest test** — `test/signal/ingest.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { ingestEnvelope } from '../../src/signal/ingest'
import * as fx from '../fixtures/envelopes'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swi-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

describe('ingestEnvelope', () => {
  it('stores an inbound message and its conversation', () => {
    const s = open()
    ingestEnvelope(s, fx.inboundText, fx.SELF, 5000)
    expect(s.conversations.list().map((c) => c.id)).toContain('alice-uuid')
    const msgs = s.messages.listByConversation('alice-uuid', 10)
    expect(msgs[0]).toMatchObject({ body: 'hello from alice', direction: 'in' })
  })

  it('stores an own-sent message as outgoing in the destination conversation', () => {
    const s = open()
    ingestEnvelope(s, fx.ownSentText, fx.SELF, 5000)
    const msgs = s.messages.listByConversation('alice-uuid', 10)
    expect(msgs.find((m) => m.direction === 'out')?.body).toBe('reply from my phone')
  })

  it('applies a reaction to the target message', () => {
    const s = open()
    ingestEnvelope(s, fx.ownSentText, fx.SELF, 5000)      // creates self@2000
    ingestEnvelope(s, fx.inboundReaction, fx.SELF, 5100)  // reacts to self@2000
    expect(s.reactions.listForMessage(fx.SELF, 2000)[0].emoji).toBe('👍')
  })

  it('tombstones on remoteDelete', () => {
    const s = open()
    ingestEnvelope(s, fx.inboundText, fx.SELF, 5000)       // alice@1000
    ingestEnvelope(s, fx.remoteDelete, fx.SELF, 5100)      // deletes alice@1000
    expect(s.messages.listByConversation('alice-uuid', 10)[0].deleted).toBe(1)
  })

  it('applies an edit', () => {
    const s = open()
    ingestEnvelope(s, fx.inboundText, fx.SELF, 5000)
    ingestEnvelope(s, fx.editMessage, fx.SELF, 5100)
    expect(s.messages.listByConversation('alice-uuid', 10)[0].body).toBe('hello (edited)')
  })

  it('records a read receipt about our sent message', () => {
    const s = open()
    ingestEnvelope(s, fx.ownSentText, fx.SELF, 5000)
    ingestEnvelope(s, fx.readReceipt, fx.SELF, 5100)
    const rows = s.receipts.listForMessage(fx.SELF, 2000)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'read', recipientId: 'alice-uuid' })
  })

  it('ignores typing without writing anything', () => {
    const s = open()
    ingestEnvelope(s, fx.typing, fx.SELF, 5000)
    expect(s.conversations.list()).toHaveLength(0)
  })

  it('is idempotent — re-ingesting the same message does not duplicate', () => {
    const s = open()
    ingestEnvelope(s, fx.inboundText, fx.SELF, 5000)
    ingestEnvelope(s, fx.inboundText, fx.SELF, 5001)
    expect(s.messages.listByConversation('alice-uuid', 10)).toHaveLength(1)
  })
})
```

- [ ] **Step 7: Implement `ingestEnvelope`** — `src/signal/ingest.ts`

```ts
import type { Store } from '../store/store'
import { parseEnvelope } from './parse'
import type { RawEnvelope } from './envelopes'

export function ingestEnvelope(store: Store, raw: RawEnvelope, selfId: string, now: number): void {
  for (const ev of parseEnvelope(raw, selfId)) {
    switch (ev.kind) {
      case 'message': {
        store.conversations.ensure({ id: ev.conversationId, type: ev.conversationType })
        store.messages.upsert({
          conversationId: ev.conversationId,
          authorId: ev.authorId,
          authorNumber: ev.authorNumber ?? null,
          timestamp: ev.timestamp,
          direction: ev.direction,
          body: ev.body ?? null,
          quoteAuthorId: ev.quoteAuthorId ?? null,
          quoteTimestamp: ev.quoteTimestamp ?? null,
          receivedAt: now,
        })
        for (const a of ev.attachments) store.attachments.add(a)
        store.conversations.touch(ev.conversationId, ev.timestamp)
        break
      }
      case 'reaction': {
        if (ev.remove) {
          store.reactions.remove(ev.targetAuthorId, ev.targetTimestamp, ev.reactorId)
        } else {
          store.reactions.apply({
            targetAuthorId: ev.targetAuthorId,
            targetTimestamp: ev.targetTimestamp,
            reactorId: ev.reactorId,
            emoji: ev.emoji,
            timestamp: ev.timestamp,
          })
        }
        break
      }
      case 'delete':
        store.messages.markDeleted(ev.targetAuthorId, ev.targetTimestamp)
        break
      case 'edit':
        store.messages.applyEdit(ev.targetAuthorId, ev.targetTimestamp, ev.newBody, ev.editedTimestamp)
        break
      case 'receipt':
        store.receipts.record({
          targetAuthorId: ev.targetAuthorId,
          targetTimestamp: ev.targetTimestamp,
          recipientId: ev.recipientId,
          type: ev.type,
          timestamp: ev.timestamp,
        })
        break
      case 'ignore':
        break
    }
  }
}
```

- [ ] **Step 8: Run ingest tests + full suite + typecheck — expect PASS/clean.** (`npm test` then `npm run typecheck`)

- [ ] **Step 9: Commit**

```bash
git add src/signal/envelopes.ts src/signal/parse.ts src/signal/ingest.ts test/fixtures/envelopes.ts test/signal/parse.test.ts test/signal/ingest.test.ts
git commit -m "feat: envelope parse + ingestion adapter into the store"
```

---

### Task 7: Retention prune

**Files:**
- Create: `src/store/prune.ts`
- Test: `test/store/prune.test.ts`

**Interfaces:**
- Consumes: `Store`.
- Produces:
  - `const DEFAULT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000`
  - `interface PruneResult { messages: number; reactions: number; receipts: number; attachments: number }`
  - `pruneOlderThan(store: Store, now: number, windowMs?: number): PruneResult` — deletes messages with `timestamp < now - windowMs`, and reactions/receipts/attachments whose target/message timestamp is older than the cutoff. Returns the counts deleted. Conversations are NOT pruned (few, cheap; names/avatars stay warm).

- [ ] **Step 1: Write the failing test** — `test/store/prune.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { pruneOlderThan, DEFAULT_WINDOW_MS } from '../../src/store/prune'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swp-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

const NOW = 1_000_000_000_000
const OLD = NOW - DEFAULT_WINDOW_MS - 1
const RECENT = NOW - 1000

describe('pruneOlderThan', () => {
  it('deletes messages older than the window and keeps recent ones', () => {
    const s = open()
    s.conversations.ensure({ id: 'c', type: 'dm' })
    s.messages.upsert({ conversationId: 'c', authorId: 'a', timestamp: OLD, direction: 'in', body: 'old', receivedAt: OLD })
    s.messages.upsert({ conversationId: 'c', authorId: 'a', timestamp: RECENT, direction: 'in', body: 'new', receivedAt: RECENT })
    const res = pruneOlderThan(s, NOW)
    expect(res.messages).toBe(1)
    const remaining = s.messages.listByConversation('c', 10)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].body).toBe('new')
  })

  it('prunes orphaned reactions, receipts, and attachments by their target timestamp', () => {
    const s = open()
    s.reactions.apply({ targetAuthorId: 'a', targetTimestamp: OLD, reactorId: 'b', emoji: '👍', timestamp: OLD })
    s.receipts.record({ targetAuthorId: 'a', targetTimestamp: OLD, recipientId: 'b', type: 'read', timestamp: OLD })
    s.attachments.add({ id: 'att', messageAuthorId: 'a', messageTimestamp: OLD })
    const res = pruneOlderThan(s, NOW)
    expect(res).toMatchObject({ reactions: 1, receipts: 1, attachments: 1 })
    expect(s.reactions.listForMessage('a', OLD)).toHaveLength(0)
  })

  it('respects a custom window', () => {
    const s = open()
    s.conversations.ensure({ id: 'c', type: 'dm' })
    s.messages.upsert({ conversationId: 'c', authorId: 'a', timestamp: NOW - 2000, direction: 'in', body: 'x', receivedAt: NOW })
    expect(pruneOlderThan(s, NOW, 1000).messages).toBe(1)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — `src/store/prune.ts`

```ts
import type { Store } from './store'

export const DEFAULT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export interface PruneResult {
  messages: number
  reactions: number
  receipts: number
  attachments: number
}

export function pruneOlderThan(store: Store, now: number, windowMs: number = DEFAULT_WINDOW_MS): PruneResult {
  const cutoff = now - windowMs
  const db = store.db
  const messages = db.prepare('DELETE FROM messages WHERE timestamp < ?').run(cutoff).changes
  const reactions = db.prepare('DELETE FROM reactions WHERE target_timestamp < ?').run(cutoff).changes
  const receipts = db.prepare('DELETE FROM receipts WHERE target_timestamp < ?').run(cutoff).changes
  const attachments = db.prepare('DELETE FROM attachments WHERE message_timestamp < ?').run(cutoff).changes
  return { messages, reactions, receipts, attachments }
}
```

- [ ] **Step 4: Run prune tests + full suite — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/store/prune.ts test/store/prune.test.ts
git commit -m "feat: retention prune by rolling window"
```

---

## Milestone 2 Done — Definition of Done

- `npm test` fully green (store repos, parse, ingest, prune).
- `npm run typecheck` clean.
- `better-sqlite3-multiple-ciphers` loads and encrypts at rest (wrong-key test proves it).
- The ingestion adapter, driven by fixtures, correctly stores: inbound text, own-sent (outgoing) text, group messages, reactions, remote deletes, edits, and per-recipient receipts; typing writes nothing; re-ingestion never duplicates.

Next: **Milestone 3 — Auth & session hardening**.

## Self-Review notes (author)

- **Spec coverage:** SQLCipher + `better-sqlite3-multiple-ciphers` (§13); own-sent as outgoing (§5.2/§6); dedup upsert on `(author_id, timestamp)`; `remoteDelete`/`editMessage`; orphan-tolerant reactions/receipts; per-recipient group receipts; typing memory-only; retention prune (§7). Names/avatars columns exist but are populated in M4 (profile service) — intentionally deferred.
- **Placeholder scan:** none; every step has complete code.
- **Type consistency:** `Store` gains `messages`/`conversations`/`reactions`/`receipts`/`attachments` across Tasks 2–5; `authorId`, `MessageInput`, `AttachmentInput`, `DomainEvent`, `parseEnvelope`, `ingestEnvelope`, `pruneOlderThan` names are stable across tasks. The widened `RawEnvelope` (Task 6 Step 1) is the shared shape both `parse.ts` and the fixtures rely on.
