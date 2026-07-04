import type { Store } from '../store/store'

export interface HubClient {
  readonly id: number
  send(data: string): void
}

export type LiveEvent = { type: 'message' | 'reaction' | 'receipt' | 'typing' } & Record<string, unknown>

export class BrowserHub {
  private readonly clients = new Set<HubClient>()

  add(client: HubClient): void {
    this.clients.add(client)
  }

  remove(client: HubClient): void {
    this.clients.delete(client)
  }

  size(): number {
    return this.clients.size
  }

  broadcast(event: LiveEvent): void {
    const data = JSON.stringify(event)
    for (const client of [...this.clients]) {
      try {
        client.send(data)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  replay(client: HubClient, store: Store, cursor: number, limit: number): void {
    const conversations = store.conversations.list()
    const rows: Array<{ conversationId: string; timestamp: number; message: unknown }> = []
    for (const conv of conversations) {
      for (const m of store.messages.listByConversation(conv.id, limit)) {
        if (m.timestamp > cursor) rows.push({ conversationId: conv.id, timestamp: m.timestamp, message: m })
      }
    }
    rows.sort((a, b) => a.timestamp - b.timestamp)
    for (const r of rows) {
      client.send(JSON.stringify({ type: 'message', conversationId: r.conversationId, message: r.message }))
    }
  }
}
