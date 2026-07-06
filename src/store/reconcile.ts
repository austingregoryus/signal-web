import type { Store } from './store'
import { normalizeGroupId } from './groupId'

/**
 * One-time reconciliation. Repairs pre-existing duplicate conversations
 * created before the auto-merge logic existed. Two passes:
 *
 * 1. DM number↔uuid: scans messages (which carry both author_id and
 *    author_number) for the mapping, records aliases, and merges.
 * 2. Group raw-vs-prefixed: signal-cli delivers inbound group ids in raw
 *    base64 form but its REST API uses "group."-prefixed form, so a group
 *    could split into two conversations. Fold the prefixed form into the raw
 *    canonical form, preserving whichever display name is set.
 *
 * Idempotent — safe to run on every boot; a no-op once everything is merged.
 */
export function reconcileConversationAliases(store: Store): { merged: number; aliased: number } {
  let merged = 0
  let aliased = 0

  // --- Pass 1: DM number -> uuid (via message metadata) ---
  const rows = store.db
    .prepare('SELECT DISTINCT author_id, author_number FROM messages WHERE author_number IS NOT NULL AND author_number != author_id')
    .all() as { author_id: string; author_number: string }[]
  for (const r of rows) {
    store.conversations.linkAlias(r.author_number, r.author_id)
    aliased++
    const before = store.conversations.list().filter((c) => c.id === r.author_number || c.id === r.author_id).length
    store.conversations.mergeInto(r.author_id, r.author_number)
    const after = store.conversations.list().filter((c) => c.id === r.author_number || c.id === r.author_id).length
    if (after < before) merged++
  }

  // --- Pass 2: group prefixed -> raw canonical ---
  // Any group conversation whose id is "group."-prefixed should fold into its
  // raw-base64 counterpart (the form inbound envelopes produce). If only the
  // prefixed row exists, just rewrite its id to raw.
  const groups = store.conversations.list().filter((c) => c.type === 'group')
  for (const g of groups) {
    const canonical = normalizeGroupId(g.id)
    if (canonical === g.id) continue // already raw
    const rawExists = store.conversations.list().some((c) => c.id === canonical)
    if (rawExists) {
      const before = 2
      store.conversations.mergeInto(canonical, g.id)
      const after = store.conversations.list().filter((c) => c.id === canonical || c.id === g.id).length
      if (after < before) merged++
    } else {
      // Only the prefixed row exists — rewrite its id (and its messages') to raw.
      store.db.prepare('UPDATE conversations SET id = ? WHERE id = ?').run(canonical, g.id)
      store.db.prepare('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?').run(canonical, g.id)
      merged++
    }
    aliased++
  }

  return { merged, aliased }
}

