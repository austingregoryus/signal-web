import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

const API_PREFIXES = ['/api', '/auth', '/link']

export async function registerStaticSite(app: FastifyInstance, opts: { dir: string }): Promise<void> {
  await app.register(fastifyStatic, { root: opts.dir, wildcard: false })
  app.setNotFoundHandler((req, reply) => {
    const isApi = API_PREFIXES.some((p) => req.url === p || req.url.startsWith(`${p}/`))
    if (req.method === 'GET' && !isApi) {
      return reply.type('text/html').sendFile('index.html')
    }
    return reply.code(404).send({ error: 'not_found' })
  })
}
