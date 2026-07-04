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
