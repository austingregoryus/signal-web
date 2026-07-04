import type { Store } from '../store/store'
import type { BrowserHub, LiveEvent } from '../api/hub'
import { ingestEnvelope } from './ingest'
import { classifyEnvelope, type RawEnvelope } from './envelopes'

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
    // For stored kinds, notify the browser that its store view changed. The browser
    // then pulls the affected conversation via REST (or the event carries the row).
    if (kind === 'data' || kind === 'sync-sent') {
      this.deps.hub.broadcast({ type: 'message', timestamp: env.timestamp ?? null } as LiveEvent)
    } else if (kind === 'receipt') {
      this.deps.hub.broadcast({ type: 'receipt', timestamp: env.timestamp ?? null } as LiveEvent)
    }
  }
}
