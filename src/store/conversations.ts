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
