import { describe, it, expect } from 'vitest'
import { SignalClient } from '../../src/signal/client'

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body?: unknown; buf?: Buffer; contentType?: string }) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const r = handler(url, init)
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: String(r.status),
      json: async () => r.body,
      arrayBuffer: async () => (r.buf ? r.buf.buffer.slice(r.buf.byteOffset, r.buf.byteOffset + r.buf.byteLength) : new ArrayBuffer(0)),
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? r.contentType ?? 'application/octet-stream' : null) },
    } as unknown as Response
  }) as typeof fetch
}

const base = { apiUrl: 'http://signal:8080', number: '+15551230000' }

describe('SignalClient', () => {
  it('sends a message and returns the timestamp', async () => {
    let captured: { url: string; body: unknown } | undefined
    const client = new SignalClient({
      ...base,
      fetchImpl: mockFetch((url, init) => {
        captured = { url, body: JSON.parse(String(init?.body)) }
        return { status: 201, body: { timestamp: 1712000000000 } }
      }),
    })
    const res = await client.sendMessage({ recipients: ['+15551119999'], message: 'hi' })
    expect(res.timestamp).toBe(1712000000000)
    expect(captured?.url).toContain('/v2/send')
    expect((captured?.body as { message: string }).message).toBe('hi')
  })

  it('fetches an attachment as bytes + content-type', async () => {
    const client = new SignalClient({
      ...base,
      fetchImpl: mockFetch(() => ({ status: 200, buf: Buffer.from([1, 2, 3]), contentType: 'image/png' })),
    })
    const a = await client.fetchAttachment('att-1')
    expect(a.contentType).toBe('image/png')
    expect(Array.from(a.bytes)).toEqual([1, 2, 3])
  })

  it('throws on a non-2xx without leaking the recipient number', async () => {
    const client = new SignalClient({ ...base, fetchImpl: mockFetch(() => ({ status: 500 })) })
    await expect(client.sendMessage({ recipients: ['+15551119999'], message: 'x' })).rejects.toThrow(/send failed/i)
    await expect(client.sendMessage({ recipients: ['+15551119999'], message: 'x' })).rejects.not.toThrow(/15551119999/)
  })
})
