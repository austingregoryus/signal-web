import type { FastifyInstance } from 'fastify'
import type { Store } from '../store/store'
import type { AttachmentBlobStore } from '../store/attachmentsBlob'

interface SendCapableClient {
  sendMessage(input: { recipients?: string[]; groupId?: string; message?: string; base64Attachments?: string[] }): Promise<{ timestamp: number }>
  sendReaction(input: { recipient?: string; groupId?: string; reaction: string; targetAuthor: string; targetTimestamp: number; remove?: boolean }): Promise<void>
  sendTyping(input: { recipient?: string; groupId?: string; stop?: boolean }): Promise<void>
  sendReceipt(input: { recipient: string; targetTimestamp: number; type: 'read' | 'viewed' }): Promise<void>
  resolveUuid?(number: string): Promise<string | null>
}

export interface RestDeps {
  store: Store
  client: SendCapableClient
  selfId: string
  blobs: AttachmentBlobStore
}

/**
 * Parse a client-supplied attachment into its MIME type, raw base64 (for
 * signal-cli, which wants un-prefixed base64), and decoded bytes (for local
 * blob storage so the sender can render what they just sent). Accepts either a
 * `data:` URL (preferred — carries the content type) or bare base64.
 */
function parseAttachment(input: string): { contentType: string | null; base64: string; bytes: Buffer } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(input)
  if (m) return { contentType: m[1] ?? null, base64: m[3], bytes: Buffer.from(m[3], 'base64') }
  return { contentType: null, base64: input, bytes: Buffer.from(input, 'base64') }
}

export function registerRestApi(app: FastifyInstance, deps: RestDeps): void {
  const { store, client, selfId, blobs } = deps
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
      const { type, message, base64Attachments } = req.body
      // Resolve a number-keyed DM to its canonical UUID (in case a prior merge
      // happened). Groups pass through unchanged — group ids are never aliased.
      const conversationId = type === 'group' ? req.body.conversationId : store.conversations.resolveAlias(req.body.conversationId)
      // signal-cli expects un-prefixed base64; parseAttachment splits off any
      // data-URL prefix so we can also keep the content type + bytes locally.
      const parsed = (base64Attachments ?? []).map(parseAttachment)
      const sent = await client.sendMessage(
        type === 'group'
          ? { groupId: conversationId, message, base64Attachments: parsed.map((p) => p.base64) }
          : { recipients: [conversationId], message, base64Attachments: parsed.map((p) => p.base64) },
      )
      const ts = sent.timestamp || Date.now()
      store.conversations.ensure({ id: conversationId, type })
      store.messages.upsert({
        conversationId, authorId: selfId, timestamp: ts, direction: 'out',
        body: message ?? null, receivedAt: Date.now(),
      })
      // Persist each attachment locally so the sender's own view renders it.
      // No signalId: we already have the bytes, so /api/attachments/:id serves
      // them straight from the blob store without a signal-cli round-trip.
      for (let i = 0; i < parsed.length; i++) {
        const id = `${selfId}:${ts}:${i}`
        const p = parsed[i]
        store.attachments.add({
          id, messageAuthorId: selfId, messageTimestamp: ts,
          contentType: p.contentType, size: p.bytes.length, signalId: null,
        })
        await blobs.put(id, p.bytes)
      }
      store.conversations.touch(conversationId, ts)
      return reply.send({ ok: true, timestamp: ts })
    },
  )

  // Start a brand-new DM with a phone number the user hasn't talked to yet.
  // Conversation ids are UUID-based for inbound, so prefer resolving the
  // recipient's UUID (keeps this thread and their replies together); fall back
  // to the raw number if they aren't a known signal-cli contact yet.
  app.post<{ Body: { recipient: string; displayName?: string; message?: string; base64Attachments?: string[] } }>(
    '/api/start',
    auth,
    async (req, reply) => {
      const { recipient, displayName, message, base64Attachments } = req.body
      if (!recipient || !/^\+[1-9]\d{6,14}$/.test(recipient)) {
        return reply.code(400).send({ error: 'invalid_recipient', detail: 'E.164 phone number required, e.g. +15551234567' })
      }
      const parsed = (base64Attachments ?? []).map(parseAttachment)
      // signal-cli rejects empty messages (no text AND no attachments) with a
      // 400; surface that as a clear client error instead of letting it 500.
      const hasText = typeof message === 'string' && message.trim().length > 0
      if (!hasText && parsed.length === 0) {
        return reply.code(400).send({ error: 'empty_message', detail: 'A first message or attachment is required' })
      }
      const sent = await client.sendMessage({ recipients: [recipient], message, base64Attachments: parsed.map((p) => p.base64) })
      const ts = sent.timestamp || Date.now()
      const uuid = await client.resolveUuid?.(recipient) ?? null
      const resolved = uuid && uuid.length > 0 ? uuid : null
      // If signal-cli now knows this contact's UUID, link it so any future
      // number-keyed reference resolves to the UUID. Also: if a UUID-keyed
      // conversation for this contact already exists (e.g. they messaged first),
      // route there instead of creating a duplicate number-keyed row.
      if (resolved) store.conversations.linkAlias(recipient, resolved)
      const conversationId = store.conversations.resolveAlias(resolved ?? recipient)
      if (!conversationId) {
        return reply.code(500).send({ error: 'no_conversation_id' })
      }
      // If the user started by number but a UUID-keyed conversation already
      // exists, fold the (possibly just-created) number row into it.
      if (conversationId !== recipient) store.conversations.mergeInto(conversationId, recipient)
      store.conversations.ensure({ id: conversationId, type: 'dm', displayName: displayName ?? undefined })
      store.messages.upsert({
        conversationId, authorId: selfId, timestamp: ts, direction: 'out',
        body: message ?? null, receivedAt: Date.now(),
      })
      for (let i = 0; i < parsed.length; i++) {
        const id = `${selfId}:${ts}:${i}`
        const p = parsed[i]
        store.attachments.add({
          id, messageAuthorId: selfId, messageTimestamp: ts,
          contentType: p.contentType, size: p.bytes.length, signalId: null,
        })
        await blobs.put(id, p.bytes)
      }
      store.conversations.touch(conversationId, ts)
      return reply.send({ ok: true, conversationId, timestamp: ts })
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
