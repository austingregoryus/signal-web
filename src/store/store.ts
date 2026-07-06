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
  db.exec(SCHEMA_SQL)

  const existing = db.prepare('SELECT version FROM schema_meta').get() as
    | { version: number }
    | undefined
  if (!existing) {
    db.prepare('INSERT INTO schema_meta (version) VALUES (?)').run(SCHEMA_VERSION)
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
