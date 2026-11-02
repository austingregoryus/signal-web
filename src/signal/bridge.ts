import type { Store } from '../store/store'
import type { BrowserHub, LiveEvent } from '../api/hub'
import { ingestEnvelope } from './ingest'
import { classifyEnvelope, type RawEnvelope } from './envelopes'
import { parseEnvelope } from './parse'

export interface LiveBridgeDeps {
  store: Store
  hub: BrowserHub
  selfId: string
  now?: () => number
}

export class LiveBridge {
  constructor(private readonly deps: LiveBridgeDeps) {}

  handleEnvelope(raw: RawEnvelope): void {
    const now = this.deps.now ? this.deps.now() : Date.now()
    // Persist first (source of truth), then notify.
    ingestEnvelope(this.deps.store, raw, this.deps.selfId, now)

    const kind = classifyEnvelope(raw)
    const env = raw.envelope
    if (!env) return
    if (kind === 'typing') {
      this.deps.hub.broadcast({ type: 'typing', source: env.sourceUuid ?? env.sourceNumber ?? null } as LiveEvent)
      return
    }
    // For stored kinds, include the affected conversationId so the browser can
    // skip refetching when the event isn't for the open thread. We parse (the
    // same parse ingest just did) to derive both the event type — which may be
    // 'message' OR 'reaction' for a data envelope — and the conversation id.
    // Reactions/receipts target a specific message; their conversation is the
    // one that message lives in, which we look up so the browser refreshes the
    // right thread. If we can't resolve it, the browser falls back to refreshing
    // the open thread (correct for the common "event in the open thread" case).
    if (kind === 'data' || kind === 'sync-sent') {
      const events = parseEnvelope(raw, this.deps.selfId)
      // A bare "timer changed" notice has nothing to show — don't fire a
      // new-message poke (which would also pop a desktop notification). The
      // sidebar and thread header do show the timer, so tell the browser to
      // reload its conversation list.
      const timer = events.find((e) => e.kind === 'timer')
      if (timer && timer.kind === 'timer') {
        this.deps.hub.broadcast({ type: 'conversation', conversationId: timer.conversationId } as LiveEvent)
        return
      }
      if (events.every((e) => e.kind === 'ignore')) return
      const reaction = events.find((e) => e.kind === 'reaction')
      const msg = events.find((e) => e.kind === 'message')
      if (reaction && reaction.kind === 'reaction') {
        const conversationId = this.deps.store.messages.findConversationForMessage(
          reaction.targetAuthorId, reaction.targetTimestamp,
        )
        this.deps.hub.broadcast({ type: 'reaction', timestamp: env.timestamp ?? null, conversationId } as LiveEvent)
      } else {
        // Carry a sender label + body preview so the browser can show a richer
        // notification ("Sam: hey") without an extra round-trip.
        const senderName = env.sourceName ?? env.sourceNumber ?? null
        const preview = msg && msg.kind === 'message' ? (msg.body ?? (msg.attachments.length > 0 ? '📎 Photo' : null)) : null
        this.deps.hub.broadcast({
          type: 'message',
          timestamp: env.timestamp ?? null,
          conversationId: msg && msg.kind === 'message' ? msg.conversationId : null,
          sender: senderName,
          preview,
        } as LiveEvent)
      }
    } else if (kind === 'receipt') {
      const events = parseEnvelope(raw, this.deps.selfId)
      const receipt = events.find((e) => e.kind === 'receipt')
      const conversationId = receipt && receipt.kind === 'receipt'
        ? this.deps.store.messages.findConversationForMessage(receipt.targetAuthorId, receipt.targetTimestamp)
        : null
      this.deps.hub.broadcast({ type: 'receipt', timestamp: env.timestamp ?? null, conversationId } as LiveEvent)
    }
  }
}
