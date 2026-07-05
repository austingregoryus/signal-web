import { resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

const API_PREFIXES = ['/api', '/auth', '/link']

export async function registerStaticSite(app: FastifyInstance, opts: { dir: string }): Promise<void> {
  // @fastify/static requires an absolute root; opts.dir may be relative (e.g. ./web/dist).
  await app.register(fastifyStatic, { root: resolve(opts.dir), wildcard: false })
  app.setNotFoundHandler((req, reply) => {
    const isApi = API_PREFIXES.some((p) => req.url === p || req.url.startsWith(`${p}/`))
    if (req.method === 'GET' && !isApi) {
      return reply.type('text/html').sendFile('index.html')
    }
    return reply.code(404).send({ error: 'not_found' })
  })
}
