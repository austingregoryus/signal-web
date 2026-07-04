import type { FastifyInstance } from 'fastify'
import type {} from '@fastify/websocket'
import type { Store } from '../store/store'
import type { BrowserHub, HubClient } from './hub'
import { isAllowedOrigin } from '../auth/csrf'
import type { SessionPolicy } from '../store/sessions'

export interface WsDeps {
  store: Store
  hub: BrowserHub
  allowedOrigin: string
  sessionPolicy: SessionPolicy
}

let nextId = 1

export async function registerBrowserWs(app: FastifyInstance, deps: WsDeps): Promise<void> {
  const { store, hub, allowedOrigin, sessionPolicy } = deps
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin
    const token = req.cookies?.sw_session
    const validFull =
      token != null &&
      store.sessions.validate(token, Date.now(), sessionPolicy) &&
      store.sessions.getLevel(token) === 'full'
    if (!isAllowedOrigin(origin, allowedOrigin) || !validFull) {
      socket.close()
      return
    }
    const client: HubClient = { id: nextId++, send: (d) => socket.send(d) }
    hub.add(client)
    const cursor = Number(new URL(req.url ?? '', 'http://x').searchParams.get('cursor') ?? 0)
    hub.replay(client, store, cursor, 200)
    socket.on('close', () => hub.remove(client))
    socket.on('error', () => hub.remove(client))
  })
}
