import Database from 'better-sqlite3-multiple-ciphers'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'
import { MessageRepo } from './messages'
import { ConversationRepo } from './conversations'
import { ReactionRepo } from './reactions'
import { ReceiptRepo } from './receipts'
import { AttachmentRepo } from './attachments'
import { AuthConfigRepo } from './authConfig'
import { SessionRepo } from './sessions'
import { WebAuthnRepo } from './webauthnStore'

export interface Store {
  db: Database.Database
  messages: MessageRepo
  conversations: ConversationRepo
  reactions: ReactionRepo
  receipts: ReceiptRepo
  attachments: AttachmentRepo
  authConfig: AuthConfigRepo
  sessions: SessionRepo
  webauthn: WebAuthnRepo
  close(): void
}

export function openStore(path: string, key: string): Store {
  const db = new Database(path)
  // Key MUST be set before any other statement.
  db.pragma(`key = '${key.replace(/'/g, "''")}'`)
  db.pragma('journal_mode = WAL')
  // Unicode-aware lower-casing for search; SQLite's own LIKE and lower() fold
  // ASCII only, so "École" would never match "école".
  db.function('fold', { deterministic: true }, (s: unknown) => (typeof s === 'string' ? s.toLowerCase() : null))
  db.exec(SCHEMA_SQL)

  const existing = db.prepare('SELECT version FROM schema_meta').get() as
    | { version: number }
    | undefined
  if (!existing) {
    db.prepare('INSERT INTO schema_meta (version) VALUES (?)').run(SCHEMA_VERSION)
  }

  // Migration to v6: widen the messages uniqueness key from
  // (author_id, timestamp) to (author_id, timestamp, conversation_id).
  // SQLite can't alter a table constraint in place, so rebuild the table.
  // Existing rows satisfy the stricter old constraint, so they trivially
  // satisfy the wider one — no collisions, no data loss. CREATE TABLE IF NOT
  // EXISTS above already applied the new constraint to fresh DBs; this only
  // fires for DBs created at v5 or earlier.
  if (existing && existing.version < 6) {
    // The current table SQL, with all whitespace stripped so we can match the
    // UNIQUE clause regardless of formatting. A fresh v6 DB (created by the
    // SCHEMA_SQL above) already has the widened clause; an old v5 DB doesn't.
    const messagesSql = (
      (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'").get() as
        | { sql: string }
        | undefined
      )?.sql ?? ''
    ).replace(/\s+/g, '')
    const alreadyWidened = messagesSql.includes('UNIQUE(author_id,timestamp,conversation_id)')
    // Only rebuild if the table still carries the old narrow unique constraint.
    if (!alreadyWidened) {
      db.exec(`
        BEGIN;
        CREATE TABLE messages_v6 (
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
          UNIQUE(author_id, timestamp, conversation_id)
        );
        INSERT INTO messages_v6
          (id, conversation_id, author_id, author_number, timestamp, received_at,
           direction, body, quote_author_id, quote_timestamp, edited_timestamp, deleted)
          SELECT id, conversation_id, author_id, author_number, timestamp, received_at,
                 direction, body, quote_author_id, quote_timestamp, edited_timestamp, deleted
          FROM messages;
        DROP TABLE messages;
        ALTER TABLE messages_v6 RENAME TO messages;
        CREATE INDEX IF NOT EXISTS idx_messages_conversation
          ON messages(conversation_id, timestamp);
        COMMIT;
      `)
    }
    db.prepare('UPDATE schema_meta SET version = ?').run(SCHEMA_VERSION)
  }

  // Additive column migrations for DBs created before the column existed.
  // SQLite has no ADD COLUMN IF NOT EXISTS, so guard with PRAGMA table_info.
  // This is the minimal migration runner; a full per-version runner is tracked
  // as deferred work. Each column added here must be idempotent.
  const columns = (db.prepare('PRAGMA table_info(conversations)').all() as { name: string }[])
    .map((c) => c.name)
  if (!columns.includes('last_read_at')) {
    db.exec("ALTER TABLE conversations ADD COLUMN last_read_at INTEGER NOT NULL DEFAULT 0")
  }
  if (!columns.includes('expire_timer_ms')) {
    db.exec("ALTER TABLE conversations ADD COLUMN expire_timer_ms INTEGER NOT NULL DEFAULT 0")
  }
  // Runs after the v6 rebuild above, which recreates messages without this column.
  const messageColumns = (db.prepare('PRAGMA table_info(messages)').all() as { name: string }[])
    .map((c) => c.name)
  if (!messageColumns.includes('expires_at')) {
    db.exec('ALTER TABLE messages ADD COLUMN expires_at INTEGER')
  }
  // Created here, not in SCHEMA_SQL: on an old DB the column doesn't exist until now.
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL')

  const messages = new MessageRepo(db)
  const conversations = new ConversationRepo(db)
  const reactions = new ReactionRepo(db)
  const receipts = new ReceiptRepo(db)
  const attachments = new AttachmentRepo(db)
  const authConfig = new AuthConfigRepo(db)
  const sessions = new SessionRepo(db)
  const webauthn = new WebAuthnRepo(db)

  return {
    db,
    messages,
    conversations,
    reactions,
    receipts,
    attachments,
    authConfig,
    sessions,
    webauthn,
    close: () => db.close(),
  }
}
