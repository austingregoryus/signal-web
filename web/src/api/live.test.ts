import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLiveSocket } from './live'

class FakeWS {
  static last: FakeWS | null = null
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  close = vi.fn()
  constructor(public url: string) { FakeWS.last = this }
}

afterEach(() => vi.restoreAllMocks())

describe('useLiveSocket', () => {
  it('connects and forwards parsed events', () => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket)
    const onEvent = vi.fn()
    renderHook(() => useLiveSocket(onEvent))
    FakeWS.last!.onopen?.()
    FakeWS.last!.onmessage?.({ data: JSON.stringify({ type: 'message', timestamp: 5 }) })
    expect(onEvent).toHaveBeenCalledWith({ type: 'message', timestamp: 5 })
    expect(FakeWS.last!.url).toContain('/api/ws')
  })

  it('ignores non-JSON frames', () => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket)
    const onEvent = vi.fn()
    renderHook(() => useLiveSocket(onEvent))
    FakeWS.last!.onmessage?.({ data: 'ping' })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('sends a cursor query param when getCursor is provided', () => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket)
    const onEvent = vi.fn()
    renderHook(() => useLiveSocket(onEvent, () => 42))
    expect(FakeWS.last!.url).toContain('cursor=42')
  })
})
