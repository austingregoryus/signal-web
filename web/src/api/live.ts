import { useEffect, useRef, useState } from 'react'

export type LiveEvent = { type: string; [k: string]: unknown }
export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export function useLiveSocket(
  onEvent: (ev: LiveEvent) => void,
  getCursor?: () => number,
): ConnectionState {
  const cb = useRef(onEvent)
  cb.current = onEvent
  const cursorRef = useRef(getCursor)
  cursorRef.current = getCursor
  const [state, setState] = useState<ConnectionState>('connecting')
  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let delay = 1000
    let timer: ReturnType<typeof setTimeout> | undefined
    function connect(): void {
      setState('connecting')
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const cursor = cursorRef.current?.() ?? 0
      ws = new WebSocket(`${proto}://${location.host}/api/ws${cursor ? `?cursor=${cursor}` : ''}`)
      ws.onopen = () => { delay = 1000; setState('connected') }
      ws.onmessage = (e) => {
        let parsed: LiveEvent
        try { parsed = JSON.parse(String(e.data)) as LiveEvent } catch { return }
        cb.current(parsed)
      }
      ws.onclose = () => {
        if (closed) return
        setState('disconnected')
        timer = setTimeout(connect, delay)
        delay = Math.min(delay * 2, 30_000)
      }
    }
    connect()
    return () => { closed = true; if (timer) clearTimeout(timer); ws?.close() }
  }, [])
  return state
}
