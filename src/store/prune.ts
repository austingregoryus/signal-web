import type { Store } from './store'

export const DEFAULT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export interface PruneResult {
  messages: number
  reactions: number
  receipts: number
  attachments: number
  /** Ids of attachment rows removed — the caller should delete their blob files. */
  attachmentIds: string[]
}

/**
 * Drop messages and their associated data older than `windowMs`. Runs the row
 * deletes in a transaction and returns the attachment ids so the caller can also
 * delete the encrypted blob files (this module is sync-only and has no blob
 * store access; wiring blobs here keeps the pruning boundary in one place).
 */
/**
 * Delete disappearing messages whose timer has run out, with their reactions,
 * receipts and attachment rows. Returns the attachment ids for blob deletion.
 * Runs often (every ~30s) since timers can be as short as a few seconds.
 */
export function pruneExpired(store: Store, now: number): PruneResult {
  const db = store.db
  const expired = `SELECT author_id, timestamp FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?`
  const attachmentIds = (
    db.prepare(`SELECT id FROM attachments WHERE (message_author_id, message_timestamp) IN (${expired})`).all(now) as { id: string }[]
  ).map((r) => r.id)
  const tx = db.transaction(() => {
    const reactions = db.prepare(`DELETE FROM reactions WHERE (target_author_id, target_timestamp) IN (${expired})`).run(now).changes
    const receipts = db.prepare(`DELETE FROM receipts WHERE (target_author_id, target_timestamp) IN (${expired})`).run(now).changes
    const attachments = db.prepare(`DELETE FROM attachments WHERE (message_author_id, message_timestamp) IN (${expired})`).run(now).changes
    const messages = db.prepare('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now).changes
    return { messages, reactions, receipts, attachments }
  })
  return { ...tx(), attachmentIds }
}

export function pruneOlderThan(store: Store, now: number, windowMs: number = DEFAULT_WINDOW_MS): PruneResult {
  const cutoff = now - windowMs
  const db = store.db
  // Collect attachment ids BEFORE deleting their rows; needed for blob cleanup.
  const attachmentIds = (
    db.prepare('SELECT id FROM attachments WHERE message_timestamp < ?').all(cutoff) as { id: string }[]
  ).map((r) => r.id)
  const tx = db.transaction(() => {
    const messages = db.prepare('DELETE FROM messages WHERE timestamp < ?').run(cutoff).changes
    const reactions = db.prepare('DELETE FROM reactions WHERE target_timestamp < ?').run(cutoff).changes
    const receipts = db.prepare('DELETE FROM receipts WHERE target_timestamp < ?').run(cutoff).changes
    const attachments = db.prepare('DELETE FROM attachments WHERE message_timestamp < ?').run(cutoff).changes
    return { messages, reactions, receipts, attachments }
  })
  const counts = tx()
  return { ...counts, attachmentIds }
}
