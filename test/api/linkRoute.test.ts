import { describe, it, expect, afterEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { SignalClient } from '../../src/signal/client'
import { registerLinkRoute } from '../../src/api/linkRoute'

function mockFetch(handler: () => { status: number; buf?: Buffer; contentType?: string }) {
  return (async () => {
    const r = handler()
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: String(r.status),
      arrayBuffer: async () =>
        r.buf ? r.buf.buffer.slice(r.buf.byteOffset, r.buf.byteOffset + r.buf.byteLength) : new ArrayBuffer(0),
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? (r.contentType ?? 'image/png') : null) },
    } as unknown as Response
  }) as typeof fetch
}

describe('SignalClient.getLinkingQr', () => {
  it('returns the QR png bytes and content-type', async () => {
    const client = new SignalClient({
      apiUrl: 'http://signal:8080',
      number: '+15551230000',
      fetchImpl: mockFetch(() => ({ status: 200, buf: Buffer.from([137, 80, 78, 71]), contentType: 'image/png' })),
    })
    const qr = await client.getLinkingQr('signal-web')
    expect(qr.contentType).toBe('image/png')
    expect(Array.from(qr.bytes)).toEqual([137, 80, 78, 71])
  })
})

describe('registerLinkRoute', () => {
  let app: FastifyInstance
  afterEach(async () => { await app?.close() })

  const stubClient = { getLinkingQr: async () => ({ contentType: 'image/png', bytes: Buffer.from([1, 2, 3]) }) }
  const TOKEN = 'boot-token-123'

  interface BuildOpts { enabled?: boolean; connected?: boolean; passwordIsSet?: boolean; sessionFull?: boolean }
  async function build(opts: BuildOpts = {}): Promise<FastifyInstance> {
    app = Fastify()
    registerLinkRoute(app, {
      client: stubClient,
      deviceName: 'signal-web',
      status: () => opts.connected ?? false,
      enabled: opts.enabled ?? true,
      passwordIsSet: () => opts.passwordIsSet ?? false,
      sessionIsFull: () => opts.sessionFull ?? false,
      bootstrapToken: TOKEN,
    })
    await app.ready()
    return app
  }

  it('serves the linking page as HTML with a valid bootstrap token', async () => {
    await build()
    const res = await app.inject({ method: 'GET', url: `/link?t=${TOKEN}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.body).toContain('/link/qr')
    expect(res.body).toContain('Linked Devices')
  })

  it('rejects the page without the bootstrap token (401)', async () => {
    await build()
    expect((await app.inject({ method: 'GET', url: '/link' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/link?t=wrong' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/link/qr' })).statusCode).toBe(401)
  })

  it('proxies the QR image bytes with a valid token', async () => {
    await build()
    const res = await app.inject({ method: 'GET', url: `/link/qr?t=${TOKEN}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(Array.from(res.rawPayload)).toEqual([1, 2, 3])
  })

  it('reports connection status with a valid token', async () => {
    await build({ connected: true })
    const res = await app.inject({ method: 'GET', url: `/link/status?t=${TOKEN}` })
    expect(res.json()).toEqual({ connected: true })
  })

  it('once a password is set, the token no longer works and a full session is required', async () => {
    await build({ passwordIsSet: true, sessionFull: false })
    // token path is closed after configuration
    expect((await app.inject({ method: 'GET', url: `/link?t=${TOKEN}` })).statusCode).toBe(401)
    await app.close()
    // with a full session it is allowed
    await build({ passwordIsSet: true, sessionFull: true })
    expect((await app.inject({ method: 'GET', url: '/link' })).statusCode).toBe(200)
  })

  it('returns 404 for the page when disabled', async () => {
    await build({ enabled: false })
    const res = await app.inject({ method: 'GET', url: `/link?t=${TOKEN}` })
    expect(res.statusCode).toBe(404)
  })
})
