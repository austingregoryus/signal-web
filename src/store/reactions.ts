import type Database from 'better-sqlite3-multiple-ciphers'

export interface ReactionInput {
  targetAuthorId: string
  targetTimestamp: number
  reactorId: string
  emoji: string
  timestamp: number
}

export type StoredReaction = ReactionInput

interface Row {
  target_author_id: string
  target_timestamp: number
  reactor_id: string
  emoji: string
  timestamp: number
}

export class ReactionRepo {
  constructor(private readonly db: Database.Database) {}

  apply(r: ReactionInput): void {
    this.db
      .prepare(
        `INSERT INTO reactions
           (target_author_id, target_timestamp, reactor_id, emoji, timestamp)
         VALUES (@targetAuthorId, @targetTimestamp, @reactorId, @emoji, @timestamp)
         ON CONFLICT(target_author_id, target_timestamp, reactor_id) DO UPDATE SET
           emoji = excluded.emoji,
           timestamp = excluded.timestamp`,
      )
      .run(r)
  }

  remove(targetAuthorId: string, targetTimestamp: number, reactorId: string): void {
    this.db
      .prepare(
        `DELETE FROM reactions
         WHERE target_author_id = ? AND target_timestamp = ? AND reactor_id = ?`,
      )
      .run(targetAuthorId, targetTimestamp, reactorId)
  }

  listForMessage(targetAuthorId: string, targetTimestamp: number): StoredReaction[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM reactions
         WHERE target_author_id = ? AND target_timestamp = ?
         ORDER BY timestamp ASC`,
      )
      .all(targetAuthorId, targetTimestamp) as Row[]
    return rows.map((r) => ({
      targetAuthorId: r.target_author_id,
      targetTimestamp: r.target_timestamp,
      reactorId: r.reactor_id,
      emoji: r.emoji,
      timestamp: r.timestamp,
    }))
  }
}
