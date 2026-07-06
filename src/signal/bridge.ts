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
    // For stored kinds, include the affected conversationId so the browser only
    // refetches the tail when the event is for the open thread. Parse to derive
    // it (the same parse ingest just did); for receipts the target is one of the
    // user's own conversations, which we can't cheaply identify here, so omit it
    // and let the browser fall back to refreshing whichever thread is open.
    if (kind === 'data' || kind === 'sync-sent') {
      const events = parseEnvelope(raw, this.deps.selfId)
      const msg = events.find((e) => e.kind === 'message')
      this.deps.hub.broadcast({
        type: 'message',
        timestamp: env.timestamp ?? null,
        conversationId: msg && msg.kind === 'message' ? msg.conversationId : null,
      } as LiveEvent)
    } else if (kind === 'receipt') {
      this.deps.hub.broadcast({ type: 'receipt', timestamp: env.timestamp ?? null } as LiveEvent)
    }
  }
}
