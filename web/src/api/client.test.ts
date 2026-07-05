import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, ApiError } from './client'

afterEach(() => { vi.restoreAllMocks(); document.cookie = 'sw_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT' })

describe('api client', () => {
  it('GET returns json', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ id: 'c1' }]), { status: 200 }))
    await expect(api.get('/api/conversations')).resolves.toEqual([{ id: 'c1' }])
  })

  it('POST attaches the csrf header from the cookie', async () => {
    document.cookie = 'sw_csrf=tok123'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    await api.post('/api/send', { message: 'hi' })
    const init = spy.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('tok123')
    expect(init.method).toBe('POST')
  })

  it('throws ApiError with status on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"x"}', { status: 401 }))
    await expect(api.get('/api/conversations')).rejects.toMatchObject({ status: 401 })
    await expect(api.get('/api/conversations')).rejects.toBeInstanceOf(ApiError)
  })
})
