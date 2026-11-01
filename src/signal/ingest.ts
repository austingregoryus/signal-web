import type { Store } from '../store/store'
import { parseEnvelope } from './parse'
import type { RawEnvelope } from './envelopes'

export function ingestEnvelope(store: Store, raw: RawEnvelope, selfId: string, now: number): void {
  for (const ev of parseEnvelope(raw, selfId)) {
    switch (ev.kind) {
      case 'message': {
        // Ensure the canonical conversation exists FIRST, so mergeInto has a
        // row to carry the obsolete conversation's display name onto.
        store.conversations.ensure({ id: ev.conversationId, type: ev.conversationType })
        // Auto-merge: if the sender has both a UUID and a phone number, record
        // the alias and fold any pre-existing number-keyed conversation into
        // this UUID-keyed one. This is what keeps a /api/start-created number
        // conversation and the contact's later inbound reply threaded together.
        // (Only inbound DMs carry authorNumber; outbound/sync-sent and UUID-only
        // envelopes skip this — nothing to merge against.)
        if (ev.direction === 'in' && ev.authorNumber && ev.conversationType === 'dm') {
          store.conversations.linkAlias(ev.authorNumber, ev.conversationId)
          store.conversations.mergeInto(ev.conversationId, ev.authorNumber)
        }
        if (ev.expiresInSeconds !== undefined) {
          store.conversations.setExpireTimer(ev.conversationId, ev.expiresInSeconds * 1000)
        }
        store.messages.upsert({
          conversationId: ev.conversationId,
          authorId: ev.authorId,
          authorNumber: ev.authorNumber ?? null,
          timestamp: ev.timestamp,
          direction: ev.direction,
          body: ev.body ?? null,
          quoteAuthorId: ev.quoteAuthorId ?? null,
          quoteTimestamp: ev.quoteTimestamp ?? null,
          receivedAt: now,
          expiresAt: expiryFor(ev.expiresInSeconds, ev.direction === 'out' ? ev.timestamp : now),
        })
        for (const a of ev.attachments) store.attachments.add(a)
        store.conversations.touch(ev.conversationId, ev.timestamp)
        break
      }
      case 'reaction': {
        if (ev.remove) {
          store.reactions.remove(ev.targetAuthorId, ev.targetTimestamp, ev.reactorId)
        } else {
          store.reactions.apply({
            targetAuthorId: ev.targetAuthorId,
            targetTimestamp: ev.targetTimestamp,
            reactorId: ev.reactorId,
            emoji: ev.emoji,
            timestamp: ev.timestamp,
          })
        }
        break
      }
      case 'delete':
        store.messages.markDeleted(ev.targetAuthorId, ev.targetTimestamp)
        break
      case 'edit':
        store.messages.applyEdit(ev.targetAuthorId, ev.targetTimestamp, ev.newBody, ev.editedTimestamp)
        break
      case 'receipt':
        store.receipts.record({
          targetAuthorId: ev.targetAuthorId,
          targetTimestamp: ev.targetTimestamp,
          recipientId: ev.recipientId,
          type: ev.type,
          timestamp: ev.timestamp,
        })
        break
      case 'timer':
        store.conversations.ensure({ id: ev.conversationId, type: ev.conversationType })
        store.conversations.setExpireTimer(ev.conversationId, ev.expiresInSeconds * 1000)
        break
      case 'ignore':
        break
    }
  }
}

/**
 * When a disappearing message should be deleted here. Signal starts the timer
 * when the recipient reads the message; we start it on arrival instead (sends:
 * at send time), so the web copy is never kept longer than the sender intended.
 */
export function expiryFor(expiresInSeconds: number | undefined, startMs: number): number | null {
  return expiresInSeconds && expiresInSeconds > 0 ? startMs + expiresInSeconds * 1000 : null
}
