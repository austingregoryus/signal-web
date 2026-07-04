import type { Store } from './store'

export const DEFAULT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export interface PruneResult {
  messages: number
  reactions: number
  receipts: number
  attachments: number
}

export function pruneOlderThan(store: Store, now: number, windowMs: number = DEFAULT_WINDOW_MS): PruneResult {
  const cutoff = now - windowMs
  const db = store.db
  const messages = db.prepare('DELETE FROM messages WHERE timestamp < ?').run(cutoff).changes
  const reactions = db.prepare('DELETE FROM reactions WHERE target_timestamp < ?').run(cutoff).changes
  const receipts = db.prepare('DELETE FROM receipts WHERE target_timestamp < ?').run(cutoff).changes
  const attachments = db.prepare('DELETE FROM attachments WHERE message_timestamp < ?').run(cutoff).changes
  return { messages, reactions, receipts, attachments }
}
