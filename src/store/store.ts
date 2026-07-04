import Database from 'better-sqlite3-multiple-ciphers'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'
import { MessageRepo } from './messages'

export interface Store {
  db: Database.Database
  messages: MessageRepo
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

  return {
    db,
    messages,
    close: () => db.close(),
  }
}
