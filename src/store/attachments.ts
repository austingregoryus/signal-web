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
