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

  async function build(enabled: boolean, connected = false): Promise<FastifyInstance> {
    app = Fastify()
    registerLinkRoute(app, { client: stubClient, deviceName: 'signal-web', status: () => connected, enabled })
    await app.ready()
    return app
  }

  it('serves the linking page as HTML', async () => {
    await build(true)
    const res = await app.inject({ method: 'GET', url: '/link' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('/link/qr')
    expect(res.body).toContain('Linked Devices')
  })

  it('proxies the QR image bytes', async () => {
    await build(true)
    const res = await app.inject({ method: 'GET', url: '/link/qr' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(Array.from(res.rawPayload)).toEqual([1, 2, 3])
  })

  it('reports connection status', async () => {
    await build(true, true)
    const res = await app.inject({ method: 'GET', url: '/link/status' })
    expect(res.json()).toEqual({ connected: true })
  })

  it('returns 404 for the page when disabled', async () => {
    await build(false)
    const res = await app.inject({ method: 'GET', url: '/link' })
    expect(res.statusCode).toBe(404)
  })
})
