import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAuth } from './useAuth'

afterEach(() => vi.restoreAllMocks())

describe('useAuth', () => {
  it('starts anon when the probe 401s', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state).toBe('anon'))
  })

  it('logs in with a password (no webauthn required)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 })) // initial probe
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, webauthnRequired: false }), { status: 200 }))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state).toBe('anon'))
    await act(async () => { await result.current.login('pw') })
    expect(result.current.state).toBe('authed')
  })
})
