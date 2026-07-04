import type { FastifyInstance } from 'fastify'
import type { Store } from '../store/store'

interface SendCapableClient {
  sendMessage(input: { recipients?: string[]; groupId?: string; message?: string; base64Attachments?: string[] }): Promise<{ timestamp: number }>
  sendReaction(input: { recipient?: string; groupId?: string; reaction: string; targetAuthor: string; targetTimestamp: number; remove?: boolean }): Promise<void>
  sendTyping(input: { recipient?: string; groupId?: string; stop?: boolean }): Promise<void>
  sendReceipt(input: { recipient: string; targetTimestamp: number; type: 'read' | 'viewed' }): Promise<void>
}

export interface RestDeps {
  store: Store
  client: SendCapableClient
  selfId: string
}

export function registerRestApi(app: FastifyInstance, deps: RestDeps): void {
  const { store, client, selfId } = deps
  const auth = { preHandler: app.requireAuth }

  app.get('/api/conversations', auth, async () => store.conversations.list())

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/conversations/:id/messages',
    auth,
    async (req) => {
      const raw = Number(req.query.limit ?? 100)
      const limit = Number.isFinite(raw) ? Math.max(1, Math.min(raw, 500)) : 100
      const messages = store.messages.listByConversation(req.params.id, limit).map((m) => ({
        ...m,
        reactions: store.reactions.listForMessage(m.authorId, m.timestamp),
        receipts: store.receipts.listForMessage(m.authorId, m.timestamp),
        attachments: store.attachments.listForMessage(m.authorId, m.timestamp),
      }))
      return { messages }
    },
  )

  app.post<{ Body: { conversationId: string; type: 'dm' | 'group'; message?: string; base64Attachments?: string[] } }>(
    '/api/send',
    auth,
    async (req, reply) => {
      const { conversationId, type, message, base64Attachments } = req.body
      const sent = await client.sendMessage(
        type === 'group'
          ? { groupId: conversationId, message, base64Attachments }
          : { recipients: [conversationId], message, base64Attachments },
      )
      const ts = sent.timestamp || Date.now()
      store.conversations.ensure({ id: conversationId, type })
      store.messages.upsert({
        conversationId, authorId: selfId, timestamp: ts, direction: 'out',
        body: message ?? null, receivedAt: Date.now(),
      })
      store.conversations.touch(conversationId, ts)
      return reply.send({ ok: true, timestamp: ts })
    },
  )

  app.post<{ Body: { conversationId?: string; type?: 'dm' | 'group'; targetAuthorId: string; targetTimestamp: number; emoji: string; remove?: boolean } }>(
    '/api/react',
    auth,
    async (req, reply) => {
      const b = req.body
      await client.sendReaction({
        recipient: b.type === 'group' ? undefined : b.conversationId,
        groupId: b.type === 'group' ? b.conversationId : undefined,
        reaction: b.emoji, targetAuthor: b.targetAuthorId, targetTimestamp: b.targetTimestamp, remove: b.remove,
      })
      if (b.remove) store.reactions.remove(b.targetAuthorId, b.targetTimestamp, selfId)
      else store.reactions.apply({ targetAuthorId: b.targetAuthorId, targetTimestamp: b.targetTimestamp, reactorId: selfId, emoji: b.emoji, timestamp: Date.now() })
      return reply.send({ ok: true })
    },
  )

  app.post<{ Body: { conversationId: string; type?: 'dm' | 'group'; stop?: boolean } }>(
    '/api/typing',
    auth,
    async (req, reply) => {
      await client.sendTyping({
        recipient: req.body.type === 'group' ? undefined : req.body.conversationId,
        groupId: req.body.type === 'group' ? req.body.conversationId : undefined,
        stop: req.body.stop,
      })
      return reply.send({ ok: true })
    },
  )

  app.post<{ Body: { recipient: string; targetTimestamp: number } }>(
    '/api/read',
    auth,
    async (req, reply) => {
      await client.sendReceipt({ recipient: req.body.recipient, targetTimestamp: req.body.targetTimestamp, type: 'read' })
      return reply.send({ ok: true })
    },
  )
}
