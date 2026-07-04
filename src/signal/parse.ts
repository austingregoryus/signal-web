import { authorId } from '../store/identity'
import { classifyEnvelope, type RawEnvelope } from './envelopes'
import type { AttachmentInput } from '../store/attachments'

export type DomainEvent =
  | {
      kind: 'message'
      conversationId: string
      conversationType: 'dm' | 'group'
      authorId: string
      authorNumber?: string | null
      timestamp: number
      direction: 'in' | 'out'
      body?: string | null
      quoteAuthorId?: string | null
      quoteTimestamp?: number | null
      attachments: AttachmentInput[]
    }
  | { kind: 'reaction'; targetAuthorId: string; targetTimestamp: number; reactorId: string; emoji: string; remove: boolean; timestamp: number }
  | { kind: 'delete'; targetAuthorId: string; targetTimestamp: number }
  | { kind: 'edit'; targetAuthorId: string; targetTimestamp: number; newBody: string; editedTimestamp: number }
  | { kind: 'receipt'; targetAuthorId: string; targetTimestamp: number; recipientId: string; type: 'delivery' | 'read' | 'viewed'; timestamp: number }
  | { kind: 'ignore' }

type InnerPayload = NonNullable<NonNullable<RawEnvelope['envelope']>['dataMessage']>

function attachmentsFrom(payload: InnerPayload, ownerId: string, ownerTs: number): AttachmentInput[] {
  const list = payload.attachments ?? []
  return list.map((a, i) => ({
    id: `${ownerId}:${ownerTs}:${a.id ?? i}`,
    messageAuthorId: ownerId,
    messageTimestamp: ownerTs,
    contentType: a.contentType ?? null,
    filename: a.filename ?? null,
    size: a.size ?? null,
    signalId: a.id ?? null,
  }))
}

export function parseEnvelope(raw: RawEnvelope, selfId: string): DomainEvent[] {
  const e = raw.envelope
  if (!e) return [{ kind: 'ignore' }]
  const kind = classifyEnvelope(raw)
  const senderId = e.sourceUuid || e.sourceNumber ? authorId(e.sourceUuid, e.sourceNumber) : selfId

  // --- Edit (top-level) ---
  if (e.editMessage) {
    const targetTs = e.editMessage.targetSentTimestamp
    const newBody = e.editMessage.dataMessage?.message
    if (targetTs != null && newBody != null) {
      return [{ kind: 'edit', targetAuthorId: senderId, targetTimestamp: targetTs, newBody, editedTimestamp: e.timestamp ?? targetTs }]
    }
    return [{ kind: 'ignore' }]
  }

  // --- Receipts ---
  if (kind === 'receipt' && e.receiptMessage) {
    const rm = e.receiptMessage
    const type: 'delivery' | 'read' | 'viewed' = rm.isViewed ? 'viewed' : rm.isRead ? 'read' : 'delivery'
    const ts = e.timestamp ?? 0
    return (rm.timestamps ?? []).map((targetTs) => ({
      kind: 'receipt' as const,
      targetAuthorId: selfId,
      targetTimestamp: targetTs,
      recipientId: senderId,
      type,
      timestamp: ts,
    }))
  }

  // --- Data vs sync-sent share the same inner payload shape ---
  const isOwn = kind === 'sync-sent'
  const payload: InnerPayload | undefined = isOwn ? e.syncMessage?.sentMessage : e.dataMessage
  if (!payload) return [{ kind: 'ignore' }]

  // sync-side edit (own edit made from another device)
  if (isOwn && payload.editMessage) {
    const em = payload.editMessage
    if (em.targetSentTimestamp != null && em.dataMessage?.message != null) {
      return [{ kind: 'edit', targetAuthorId: selfId, targetTimestamp: em.targetSentTimestamp, newBody: em.dataMessage.message, editedTimestamp: e.timestamp ?? em.targetSentTimestamp }]
    }
  }

  // remoteDelete
  if (payload.remoteDelete?.timestamp != null) {
    return [{ kind: 'delete', targetAuthorId: isOwn ? selfId : senderId, targetTimestamp: payload.remoteDelete.timestamp }]
  }

  // reaction
  const r = payload.reaction
  if (r?.emoji != null && r.targetSentTimestamp != null) {
    const targetAuthorId = r.targetAuthor || r.targetAuthorNumber ? authorId(r.targetAuthor, r.targetAuthorNumber) : selfId
    return [{
      kind: 'reaction',
      targetAuthorId,
      targetTimestamp: r.targetSentTimestamp,
      reactorId: isOwn ? selfId : senderId,
      emoji: r.emoji,
      remove: r.isRemove === true,
      timestamp: e.timestamp ?? 0,
    }]
  }

  // plain message (may carry text and/or attachments)
  const msgTs = payload.timestamp ?? e.timestamp
  if (msgTs == null) return [{ kind: 'ignore' }]

  const groupId = payload.groupInfo?.groupId
  const ownerId = isOwn ? selfId : senderId
  let conversationId: string
  let conversationType: 'dm' | 'group'
  if (groupId) {
    conversationId = groupId
    conversationType = 'group'
  } else if (isOwn) {
    conversationId = authorId(payload.destination, payload.destinationNumber)
    conversationType = 'dm'
  } else {
    conversationId = senderId
    conversationType = 'dm'
  }

  const attachments = attachmentsFrom(payload, ownerId, msgTs)
  if (payload.message == null && attachments.length === 0) return [{ kind: 'ignore' }]

  return [{
    kind: 'message',
    conversationId,
    conversationType,
    authorId: ownerId,
    authorNumber: isOwn ? null : e.sourceNumber ?? null,
    timestamp: msgTs,
    direction: isOwn ? 'out' : 'in',
    body: payload.message ?? null,
    quoteAuthorId:
      payload.quote && (payload.quote.author || payload.quote.authorNumber)
        ? authorId(payload.quote.author, payload.quote.authorNumber)
        : null,
    quoteTimestamp: payload.quote?.id ?? null,
    attachments,
  }]
}
