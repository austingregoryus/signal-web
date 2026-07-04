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
      return reply.header('content-type', row.content_type ?? 'application/octet-stream').send(bytes)
    },
  )
}
