import type Database from 'better-sqlite3-multiple-ciphers'

export interface ReceiptInput {
  targetAuthorId: string
  targetTimestamp: number
  recipientId: string
  type: 'delivery' | 'read' | 'viewed'
  timestamp: number
}

interface Row {
  target_author_id: string
  target_timestamp: number
  recipient_id: string
  type: 'delivery' | 'read' | 'viewed'
  timestamp: number
}

export class ReceiptRepo {
  constructor(private readonly db: Database.Database) {}

  record(r: ReceiptInput): void {
    this.db
      .prepare(
        `INSERT INTO receipts
           (target_author_id, target_timestamp, recipient_id, type, timestamp)
         VALUES (@targetAuthorId, @targetTimestamp, @recipientId, @type, @timestamp)
         ON CONFLICT(target_author_id, target_timestamp, recipient_id, type) DO UPDATE SET
           timestamp = MAX(receipts.timestamp, excluded.timestamp)`,
      )
      .run(r)
  }

  listForMessage(targetAuthorId: string, targetTimestamp: number): ReceiptInput[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM receipts WHERE target_author_id = ? AND target_timestamp = ?`,
      )
      .all(targetAuthorId, targetTimestamp) as Row[]
    return rows.map((r) => ({
      targetAuthorId: r.target_author_id,
      targetTimestamp: r.target_timestamp,
      recipientId: r.recipient_id,
      type: r.type,
      timestamp: r.timestamp,
    }))
  }
}
