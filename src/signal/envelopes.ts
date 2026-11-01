export type EnvelopeKind = 'data' | 'sync-sent' | 'receipt' | 'typing' | 'unknown'

export interface DataMessagePayload {
  message?: string
  timestamp?: number
  groupInfo?: { groupId?: string }
  reaction?: {
    emoji?: string
    targetAuthor?: string
    targetAuthorNumber?: string
    targetSentTimestamp?: number
    isRemove?: boolean
  }
  quote?: { id?: number; author?: string; authorNumber?: string }
  attachments?: Array<{ id?: string; contentType?: string; filename?: string; size?: number }>
  remoteDelete?: { timestamp?: number }
  destination?: string
  destinationNumber?: string
  editMessage?: { targetSentTimestamp?: number; dataMessage?: { message?: string } }
  /** The conversation's disappearing-message timer at send time (0 = off). */
  expiresInSeconds?: number | null
  /** True for the bodiless "timer changed" notice. */
  isExpirationUpdate?: boolean
}

export interface RawEnvelope {
  envelope?: {
    source?: string
    sourceUuid?: string
    sourceNumber?: string
    sourceName?: string
    timestamp?: number
    dataMessage?: DataMessagePayload
    syncMessage?: { sentMessage?: DataMessagePayload }
    editMessage?: { targetSentTimestamp?: number; dataMessage?: { message?: string } }
    receiptMessage?: {
      isDelivery?: boolean
      isRead?: boolean
      isViewed?: boolean
      timestamps?: number[]
    }
    typingMessage?: unknown
  }
  account?: string
}

export function classifyEnvelope(raw: RawEnvelope): EnvelopeKind {
  const e = raw.envelope
  if (!e) return 'unknown'
  // Own-sent (from another of the account's devices) must be checked first:
  // a sync sentMessage is NOT an inbound dataMessage.
  if (e.syncMessage?.sentMessage) return 'sync-sent'
  if (e.dataMessage) return 'data'
  if (e.receiptMessage) return 'receipt'
  if (e.typingMessage) return 'typing'
  return 'unknown'
}
