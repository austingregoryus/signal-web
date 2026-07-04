import type { Store } from '../store/store'
import { parseEnvelope } from './parse'
import type { RawEnvelope } from './envelopes'

export function ingestEnvelope(store: Store, raw: RawEnvelope, selfId: string, now: number): void {
  for (const ev of parseEnvelope(raw, selfId)) {
    switch (ev.kind) {
      case 'message': {
        store.conversations.ensure({ id: ev.conversationId, type: ev.conversationType })
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
      case 'ignore':
        break
    }
  }
}
