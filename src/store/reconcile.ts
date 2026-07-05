import type { Store } from './store'

/**
 * One-time reconciliation: fold any phone-number-keyed conversations into their
 * UUID-keyed canonical form. Scans messages (which carry both author_id and
 * author_number) for the number↔uuid mapping, records aliases, and merges.
 *
 * Idempotent — safe to run on every boot; a no-op once everything is merged.
 * Used to repair pre-existing duplicate conversations created before the
 * auto-merge in ingestEnvelope existed (e.g. a /api/start by number followed by
 * an inbound reply keyed by uuid).
 */
export function reconcileConversationAliases(store: Store): { merged: number; aliased: number } {
  let merged = 0
  let aliased = 0
  // Each row is one observation of (author_id, author_number). An author_id that
  // is a UUID paired with a phone number tells us the two refer to one contact.
  const rows = store.db
    .prepare('SELECT DISTINCT author_id, author_number FROM messages WHERE author_number IS NOT NULL AND author_number != author_id')
    .all() as { author_id: string; author_number: string }[]
  for (const r of rows) {
    // author_id is the UUID here (parser prefers uuid), author_number is the phone.
    store.conversations.linkAlias(r.author_number, r.author_id)
    aliased++
    // If both a number-keyed and a uuid-keyed conversation exist, fold the
    // number one into the uuid one.
    const before = store.conversations.list().filter((c) => c.id === r.author_number || c.id === r.author_id).length
    store.conversations.mergeInto(r.author_id, r.author_number)
    const after = store.conversations.list().filter((c) => c.id === r.author_number || c.id === r.author_id).length
    if (after < before) merged++
  }
  return { merged, aliased }
}
