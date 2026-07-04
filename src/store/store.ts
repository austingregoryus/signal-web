import Database from 'better-sqlite3-multiple-ciphers'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'
import { MessageRepo } from './messages'
import { ConversationRepo } from './conversations'
import { ReactionRepo } from './reactions'
import { ReceiptRepo } from './receipts'
import { AttachmentRepo } from './attachments'
import { AuthConfigRepo } from './authConfig'
import { SessionRepo } from './sessions'

export interface Store {
  db: Database.Database
  messages: MessageRepo
  conversations: ConversationRepo
  reactions: ReactionRepo
  receipts: ReceiptRepo
  attachments: AttachmentRepo
  authConfig: AuthConfigRepo
  sessions: SessionRepo
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

  const messages = new MessageRepo(db)
  const conversations = new ConversationRepo(db)
  const reactions = new ReactionRepo(db)
  const receipts = new ReceiptRepo(db)
  const attachments = new AttachmentRepo(db)
  const authConfig = new AuthConfigRepo(db)
  const sessions = new SessionRepo(db)

  return {
    db,
    messages,
    conversations,
    reactions,
    receipts,
    attachments,
    authConfig,
    sessions,
    close: () => db.close(),
  }
}
