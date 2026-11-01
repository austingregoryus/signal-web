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
  lastReadAt: number
  unreadCount: number
  /** Disappearing-message timer in ms (0 = off). */
  expireTimerMs: number
}

interface Row {
  id: string
  type: 'dm' | 'group'
  display_name: string | null
  avatar_path: string | null
  last_activity: number
  last_read_at: number
  expire_timer_ms: number
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
    return rows.map((r) => {
      // Unread = inbound messages newer than the last-read cursor.
      const unread = (
        this.db
          .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND direction = 'in' AND timestamp > ?")
          .get(r.id, r.last_read_at) as { n: number }
      ).n
      return {
        id: r.id,
        type: r.type,
        displayName: r.display_name,
        avatarPath: r.avatar_path,
        lastActivity: r.last_activity,
        lastReadAt: r.last_read_at,
        unreadCount: unread,
        expireTimerMs: r.expire_timer_ms,
      }
    })
  }

  /** Record the conversation's disappearing-message timer (0 = off). */
  setExpireTimer(id: string, ms: number): void {
    this.db.prepare('UPDATE conversations SET expire_timer_ms = ? WHERE id = ?').run(ms, id)
  }

  getExpireTimer(id: string): number {
    const row = this.db.prepare('SELECT expire_timer_ms FROM conversations WHERE id = ?').get(id) as
      | { expire_timer_ms: number }
      | undefined
    return row?.expire_timer_ms ?? 0
  }

  /** Mark a conversation read up to `now` (clears its unread badge). */
  markRead(id: string, now: number): void {
    this.db.prepare('UPDATE conversations SET last_read_at = MAX(last_read_at, ?) WHERE id = ?').run(now, id)
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
   * Look up the display name for a contact identifier (number or uuid),
   * resolving any alias first. Returns null if no named conversation exists.
   * Used to render group member lists with names instead of bare numbers.
   */
  displayNameFor(identifier: string): string | null {
    const id = this.resolveAlias(identifier)
    const row = this.db
      .prepare('SELECT display_name FROM conversations WHERE id = ?')
      .get(id) as { display_name: string | null } | undefined
    return row?.display_name ?? null
  }

  /** Update a conversation's local display name (DM rename). */
  rename(id: string, displayName: string): void {
    this.db
      .prepare('UPDATE conversations SET display_name = ? WHERE id = ?')
      .run(displayName, id)
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
    // Atomic: a crash mid-merge would otherwise leave messages repointed but
    // the obsolete row still present (phantom empty conversation).
    const tx = this.db.transaction((canonical: string, obsolete: string) => {
      const row = this.db
        .prepare('SELECT display_name, last_activity FROM conversations WHERE id = ?')
        .get(obsolete) as { display_name: string | null; last_activity: number } | undefined
      if (!row) return // nothing to merge (already merged or never existed)
      this.db.prepare('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?').run(canonical, obsolete)
      // Carry over the display name only if the canonical row lacks one.
      if (row.display_name) {
        this.db
          .prepare('UPDATE conversations SET display_name = COALESCE(display_name, ?) WHERE id = ?')
          .run(row.display_name, canonical)
      }
      // Bump last_activity if the obsolete conversation was more recent.
      this.db
        .prepare('UPDATE conversations SET last_activity = MAX(last_activity, ?) WHERE id = ?')
        .run(row.last_activity, canonical)
      this.db.prepare('DELETE FROM conversations WHERE id = ?').run(obsolete)
    })
    tx(canonicalId, obsoleteId)
  }

  /**
   * Permanently delete a conversation and all of its data: messages, reactions,
   * receipts, attachments (rows), and the conversation row itself. Returns the
   * list of attachment ids so the caller can also delete their encrypted blobs.
   * There are no SQL foreign keys / cascades in the schema, so this does the
   * cleanup manually by joining through messages' (author_id, timestamp) pairs.
   * Idempotent — a no-op if the conversation doesn't exist. The cleanup runs in
   * a transaction so a crash can't leave orphaned reaction/receipt rows whose
   * joining messages are already gone.
   */
  remove(id: string): string[] {
    // Collect attachment ids BEFORE the transaction (caller needs them for blob
    // cleanup); they're read-only here so reading outside the tx is fine.
    const exists = this.db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(id)
    if (!exists) return []
    const attachmentIds = (
      this.db
        .prepare(
          `SELECT a.id AS id FROM attachments a
           JOIN messages m ON a.message_author_id = m.author_id AND a.message_timestamp = m.timestamp
           WHERE m.conversation_id = ?`,
        )
        .all(id) as { id: string }[]
    ).map((r) => r.id)
    const tx = this.db.transaction((target: string) => {
      // Reactions + receipts key on (author_id, timestamp) like attachments.
      this.db
        .prepare(
          `DELETE FROM reactions WHERE (target_author_id, target_timestamp) IN
             (SELECT author_id, timestamp FROM messages WHERE conversation_id = ?)`,
        )
        .run(target)
      this.db
        .prepare(
          `DELETE FROM receipts WHERE (target_author_id, target_timestamp) IN
             (SELECT author_id, timestamp FROM messages WHERE conversation_id = ?)`,
        )
        .run(target)
      this.db
        .prepare(
          `DELETE FROM attachments WHERE (message_author_id, message_timestamp) IN
             (SELECT author_id, timestamp FROM messages WHERE conversation_id = ?)`,
        )
        .run(target)
      this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(target)
      this.db.prepare('DELETE FROM conversations WHERE id = ?').run(target)
      // Drop any alias pointing at this conversation so it isn't re-resolved.
      this.db.prepare('DELETE FROM contact_aliases WHERE uuid = ? OR number = ?').run(target, target)
    })
    tx(id)
    return attachmentIds
  }
}
