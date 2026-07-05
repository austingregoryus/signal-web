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

  /**
   * Record that `number` and `uuid` refer to the same Signal contact. Idempotent
   * (a re-link with the same pair is a no-op). Used to seed the alias table
   * whenever both identifiers are observed together (inbound messages, contact
   * sync) so that number-keyed conversations can later be folded into the UUID.
   */
  linkAlias(number: string, uuid: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO contact_aliases (number, uuid) VALUES (?, ?)')
      .run(number, uuid)
  }

  /**
   * Resolve an arbitrary conversation id to its canonical form. If `id` is a
   * phone number with a known alias, returns the UUID; otherwise returns `id`
   * unchanged (uuid-keyed and group conversations pass straight through).
   */
  resolveAlias(id: string): string {
    const row = this.db
      .prepare('SELECT uuid FROM contact_aliases WHERE number = ?')
      .get(id) as { uuid: string } | undefined
    return row ? row.uuid : id
  }

  /**
   * Fold the obsolete conversation into the canonical one: repoint its messages,
   * coalesce display_name (keep whichever side has a name), and delete the
   * obsolete row. Idempotent — a no-op if obsoleteId no longer exists.
   *
   * Reactions/receipts/attachments stay attached via (author_id, timestamp),
   * which this function does not touch, so they follow the messages correctly.
   */
  mergeInto(canonicalId: string, obsoleteId: string): void {
    if (canonicalId === obsoleteId) return
    const obsolete = this.db
      .prepare('SELECT display_name, last_activity FROM conversations WHERE id = ?')
      .get(obsoleteId) as { display_name: string | null; last_activity: number } | undefined
    if (!obsolete) return // nothing to merge (already merged or never existed)
    this.db.prepare('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?').run(canonicalId, obsoleteId)
    // Carry over the display name only if the canonical row lacks one.
    if (obsolete.display_name) {
      this.db
        .prepare('UPDATE conversations SET display_name = COALESCE(display_name, ?) WHERE id = ?')
        .run(obsolete.display_name, canonicalId)
    }
    // Bump last_activity if the obsolete conversation was more recent.
    this.db
      .prepare('UPDATE conversations SET last_activity = MAX(last_activity, ?) WHERE id = ?')
      .run(obsolete.last_activity, canonicalId)
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(obsoleteId)
  }
}
