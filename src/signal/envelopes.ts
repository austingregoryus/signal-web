export type EnvelopeKind = 'data' | 'sync-sent' | 'receipt' | 'typing' | 'unknown'

export interface RawEnvelope {
  envelope?: {
    source?: string
    sourceUuid?: string
    sourceName?: string
    timestamp?: number
    dataMessage?: unknown
    syncMessage?: { sentMessage?: unknown }
    receiptMessage?: unknown
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
