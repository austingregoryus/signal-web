import type { FastifyInstance } from 'fastify'
import type { Store } from '../store/store'
import type { AttachmentBlobStore } from '../store/attachmentsBlob'
import { normalizeGroupId } from '../store/groupId'

interface SendCapableClient {
  sendMessage(input: { recipients?: string[]; groupId?: string; message?: string; base64Attachments?: string[]; quoteTimestamp?: number; quoteAuthor?: string }): Promise<{ timestamp: number }>
  sendReaction(input: { recipient?: string; groupId?: string; reaction: string; targetAuthor: string; targetTimestamp: number; remove?: boolean }): Promise<void>
  sendTyping(input: { recipient?: string; groupId?: string; stop?: boolean }): Promise<void>
  sendReceipt(input: { recipient: string; targetTimestamp: number; type: 'read' | 'viewed' }): Promise<void>
  editMessage(input: { recipient?: string; groupId?: string; targetTimestamp: number; message: string }): Promise<void>
  resolveUuid?(number: string): Promise<string | null>
  getGroup?(groupId: string): Promise<{ name: string; description: string; members: string[]; admins: string[] }>
  updateGroup?(groupId: string, input: { name?: string; description?: string }): Promise<void>
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

// Attachments are sent as base64 JSON (~33% larger than the raw bytes), so the
// default 1 MB body limit rejects even modest photos with a 413. 25 MB lets a
// typical image through while staying well under signal-cli's own ceiling.
// Scoped to the send routes only; everything else keeps Fastify's 1 MB default.
export const UPLOAD_BODY_LIMIT = 25 * 1024 * 1024

export function registerRestApi(app: FastifyInstance, deps: RestDeps): void {
  const { store, client, selfId, blobs } = deps
  const auth = { preHandler: app.requireAuth }
  const upload = { ...auth, bodyLimit: UPLOAD_BODY_LIMIT }

  app.get('/api/conversations', auth, async () => store.conversations.list())

  app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>(
    '/api/conversations/:id/messages',
    auth,
    async (req) => {
      const rawLimit = Number(req.query.limit ?? 50)
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 500)) : 50
      const beforeNum = Number(req.query.before ?? Number.NaN)
      const before = Number.isFinite(beforeNum) ? beforeNum : undefined
      const messages = store.messages.listByConversation(req.params.id, limit, before).map((m) => ({
        ...m,
        reactions: store.reactions.listForMessage(m.authorId, m.timestamp),
        receipts: store.receipts.listForMessage(m.authorId, m.timestamp),
        attachments: store.attachments.listForMessage(m.authorId, m.timestamp),
      }))
      return { messages }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/conversations/:id',
    auth,
    async (req, reply) => {
      // Cascade-clean messages/reactions/receipts/attachments (+ their blobs)
      // and the conversation row. resolveAlias first so a stale number-id still
      // deletes the right conversation.
      const id = store.conversations.resolveAlias(req.params.id)
      const attachmentIds = store.conversations.remove(id)
      await Promise.all(attachmentIds.map((aid) => blobs.delete(aid)))
      return reply.send({ ok: true })
    },
  )

  // Conversation info — for groups: full member list (numbers resolved to names
  // via the contacts/conversations store) + name/description. For DMs: just the
  // local display name. Powers the info panel + rename affordance.
  app.get<{ Params: { id: string } }>(
    '/api/conversations/:id/info',
    auth,
    async (req, reply) => {
      const id = store.conversations.resolveAlias(req.params.id)
      const conv = store.conversations.list().find((c) => c.id === id)
      if (!conv) return reply.code(404).send({ error: 'not_found' })
      if (conv.type === 'group' && client.getGroup) {
        try {
          const g = await client.getGroup(id)
          const admins = new Set(g.admins)
          // Resolve each member number to a display name where we have one.
          const members = g.members.map((number) => ({
            number,
            displayName: store.conversations.displayNameFor(number),
            isAdmin: admins.has(number),
          }))
          return reply.send({ type: 'group', displayName: conv.displayName, name: g.name, description: g.description, members })
        } catch {
          // signal-cli lookup failed — fall back to local info only.
        }
      }
      return reply.send({ type: conv.type, displayName: conv.displayName })
    },
  )

  // Rename a conversation. Groups: signal-cli PUT propagates to all members,
  // then update the local name. DMs: local display name only (a contact's
  // canonical name on Signal can't be changed from here).
  app.post<{ Params: { id: string }; Body: { name: string } }>(
    '/api/conversations/:id/rename',
    auth,
    async (req, reply) => {
      const name = req.body.name?.trim()
      if (!name) return reply.code(400).send({ error: 'invalid_name' })
      const id = store.conversations.resolveAlias(req.params.id)
      const conv = store.conversations.list().find((c) => c.id === id)
      if (!conv) return reply.code(404).send({ error: 'not_found' })
      if (conv.type === 'group') {
        if (!client.updateGroup) return reply.code(501).send({ error: 'not_supported' })
        try { await client.updateGroup(id, { name }) } catch {
          return reply.code(502).send({ error: 'rename_failed' })
        }
      }
      store.conversations.rename(id, name)
      return reply.send({ ok: true })
    },
  )

  // Mark a conversation read locally (clears its unread badge). Distinct from
  // /api/read, which sends a read RECEIPT to signal-cli for the recipient.
  app.post<{ Params: { id: string } }>(
    '/api/conversations/:id/mark-read',
    auth,
    async (req, reply) => {
      const id = store.conversations.resolveAlias(req.params.id)
      store.conversations.markRead(id, Date.now())
      return reply.send({ ok: true })
    },
  )

  app.post<{ Body: { conversationId: string; type: 'dm' | 'group'; message?: string; base64Attachments?: string[]; quoteTimestamp?: number; quoteAuthor?: string } }>(
    '/api/send',
    upload,
    async (req, reply) => {
      const { type, message, base64Attachments, quoteTimestamp, quoteAuthor } = req.body
      // Resolve a number-keyed DM to its canonical UUID (in case a prior merge
      // happened), and a "group."-prefixed id to its raw canonical form. The
      // client's toSendGroupId() re-prefixes for the wire; we store raw.
      const conversationId = type === 'group'
        ? normalizeGroupId(req.body.conversationId)
        : store.conversations.resolveAlias(req.body.conversationId)
      // signal-cli expects un-prefixed base64; parseAttachment splits off any
      // data-URL prefix so we can also keep the content type + bytes locally.
      const parsed = (base64Attachments ?? []).map(parseAttachment)
      const sent = await client.sendMessage(
        type === 'group'
          ? { groupId: conversationId, message, base64Attachments: parsed.map((p) => p.base64), quoteTimestamp, quoteAuthor }
          : { recipients: [conversationId], message, base64Attachments: parsed.map((p) => p.base64), quoteTimestamp, quoteAuthor },
      )
      const ts = sent.timestamp || Date.now()
      store.conversations.ensure({ id: conversationId, type })
      store.messages.upsert({
        conversationId, authorId: selfId, timestamp: ts, direction: 'out',
        body: message ?? null, quoteAuthorId: quoteAuthor ?? null, quoteTimestamp: quoteTimestamp ?? null,
        receivedAt: Date.now(),
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

  // Edit one of the user's own previously-sent messages. signal-cli implements
  // editing as a /v2/send carrying the new text + the original timestamp, then
  // applies the edit locally so the sender's view updates immediately.
  app.post<{ Body: { conversationId: string; type?: 'dm' | 'group'; targetTimestamp: number; message: string } }>(
    '/api/edit',
    auth,
    async (req, reply) => {
      const { type, targetTimestamp, message } = req.body
      const conversationId = type === 'group'
        ? normalizeGroupId(req.body.conversationId)
        : store.conversations.resolveAlias(req.body.conversationId)
      await client.editMessage(
        type === 'group'
          ? { groupId: conversationId, targetTimestamp, message }
          : { recipient: conversationId, targetTimestamp, message },
      )
      // applyEdit only updates a non-deleted message owned by selfId; safe no-op
      // if the target doesn't exist or isn't ours.
      store.messages.applyEdit(selfId, targetTimestamp, message, Date.now())
      return reply.send({ ok: true })
    },
  )

  // Start a brand-new DM with a phone number the user hasn't talked to yet.
  // Conversation ids are UUID-based for inbound, so prefer resolving the
  // recipient's UUID (keeps this thread and their replies together); fall back
  // to the raw number if they aren't a known signal-cli contact yet.
  app.post<{ Body: { recipient: string; displayName?: string; message?: string; base64Attachments?: string[] } }>(
    '/api/start',
    upload,
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
