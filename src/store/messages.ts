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
  /** Disappearing message: delete at this ms time (null = keep). */
  expiresAt?: number | null
}

export interface StoredMessage extends MessageInput {
  id: number
  editedTimestamp: number | null
  deleted: 0 | 1
  expiresAt: number | null
}

export interface SearchHit extends StoredMessage {
  conversationName: string | null
  conversationType: 'dm' | 'group' | null
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
  expires_at: number | null
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
    expiresAt: r.expires_at,
  }
}

/** Escape LIKE wildcards so user input matches literally (paired with ESCAPE '\'). */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export class MessageRepo {
  constructor(private readonly db: Database.Database) {}

  upsert(m: MessageInput): void {
    // On conflict (same author+timestamp+conversation, i.e. a redelivered
    // envelope), update only body/quote — never touch deleted/edited, so a
    // redelivered envelope cannot resurrect a tombstoned or edited message
    // (nor push back a disappearing message's expiry).
    this.db
      .prepare(
        `INSERT INTO messages
           (conversation_id, author_id, author_number, timestamp, received_at,
            direction, body, quote_author_id, quote_timestamp, expires_at)
         VALUES (@conversationId, @authorId, @authorNumber, @timestamp, @receivedAt,
                 @direction, @body, @quoteAuthorId, @quoteTimestamp, @expiresAt)
         ON CONFLICT(author_id, timestamp, conversation_id) DO UPDATE SET
           body            = CASE
             WHEN messages.deleted = 1 OR messages.edited_timestamp IS NOT NULL
               THEN messages.body
             ELSE excluded.body
           END,
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
        expiresAt: m.expiresAt ?? null,
      })
  }

  /**
   * List messages for a conversation, newest-first. Pass `beforeTimestamp` to
   * page: returns messages strictly older than that cursor (exclusive), which
   * lets the client load the newest N first, then fetch older batches as the
   * user scrolls up. Omit it for the initial newest-first page.
   */
  listByConversation(conversationId: string, limit: number, beforeTimestamp?: number, now = Date.now()): StoredMessage[] {
    // Expired disappearing messages are hidden even before the sweep deletes them.
    const live = '(expires_at IS NULL OR expires_at > ?)'
    const sql = beforeTimestamp != null
      ? `SELECT * FROM messages WHERE conversation_id = ? AND timestamp < ? AND ${live}
         ORDER BY timestamp DESC LIMIT ?`
      : `SELECT * FROM messages WHERE conversation_id = ? AND ${live}
         ORDER BY timestamp DESC LIMIT ?`
    const rows = (beforeTimestamp != null
      ? this.db.prepare(sql).all(conversationId, beforeTimestamp, now, limit)
      : this.db.prepare(sql).all(conversationId, now, limit)) as Row[]
    return rows.map(toStored)
  }

  /**
   * Case-insensitive substring search over message text across all
   * conversations, newest-first. Skips deleted and expired messages. Both
   * sides are lower-cased in JS (`fold`, registered in openStore) because
   * SQLite's LIKE only folds ASCII.
   */
  search(query: string, limit: number, now = Date.now()): SearchHit[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, c.display_name AS conversation_name, c.type AS conversation_type
         FROM messages m LEFT JOIN conversations c ON c.id = m.conversation_id
         WHERE m.deleted = 0 AND fold(m.body) LIKE ? ESCAPE '\\'
           AND (m.expires_at IS NULL OR m.expires_at > ?)
         ORDER BY m.timestamp DESC LIMIT ?`,
      )
      .all(`%${likeEscape(query.toLowerCase())}%`, now, limit) as Array<Row & { conversation_name: string | null; conversation_type: 'dm' | 'group' | null }>
    return rows.map((r) => ({ ...toStored(r), conversationName: r.conversation_name, conversationType: r.conversation_type }))
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

  /**
   * Look up the conversation a (authorId, timestamp) message belongs to. Used by
   * the live bridge to attribute reaction/receipt events to the right thread so
   * the browser refreshes the correct conversation. Returns null if not found.
   */
  findConversationForMessage(authorId: string, timestamp: number): string | null {
    const row = this.db
      .prepare('SELECT conversation_id FROM messages WHERE author_id = ? AND timestamp = ?')
      .get(authorId, timestamp) as { conversation_id: string } | undefined
    return row?.conversation_id ?? null
  }
}
