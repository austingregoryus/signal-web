import type { FastifyInstance } from 'fastify'
import type { Store } from '../store/store'
import type { AttachmentBlobStore } from '../store/attachmentsBlob'

interface FetchCapableClient {
  fetchAttachment(id: string): Promise<{ contentType: string; bytes: Buffer }>
}

export interface AttachmentDeps {
  store: Store
  client: FetchCapableClient
  blobs: AttachmentBlobStore
  maxBytes?: number
}

const INLINE_SAFE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export function safeContentType(declared: string | null): { contentType: string; disposition: 'inline' | 'attachment' } {
  const d = declared ?? 'application/octet-stream'
  return INLINE_SAFE.has(d)
    ? { contentType: d, disposition: 'inline' }
    : { contentType: 'application/octet-stream', disposition: 'attachment' }
}

export function registerAttachmentRoute(app: FastifyInstance, deps: AttachmentDeps): void {
  const maxBytes = deps.maxBytes ?? 25 * 1024 * 1024
  app.get<{ Params: { id: string } }>(
    '/api/attachments/:id',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      // The opaque id MUST correspond to a cached attachment row — no arbitrary fetch.
      const row = deps.store.db
        .prepare('SELECT id, signal_id, content_type FROM attachments WHERE id = ?')
        .get(req.params.id) as { id: string; signal_id: string | null; content_type: string | null } | undefined
      if (!row) return reply.code(404).send({ error: 'not_found' })

      let bytes = await deps.blobs.get(row.id)
      if (!bytes) {
        if (!row.signal_id) return reply.code(404).send({ error: 'unavailable' })
        const fetched = await deps.client.fetchAttachment(row.signal_id)
        if (fetched.bytes.length > maxBytes) return reply.code(413).send({ error: 'too_large' })
        await deps.blobs.put(row.id, fetched.bytes)
        bytes = fetched.bytes
      }
      const { contentType, disposition } = safeContentType(row.content_type)
      return reply
        .header('content-type', contentType)
        .header('content-disposition', disposition)
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('cross-origin-resource-policy', 'same-origin')
        .send(bytes)
    },
  )
}
