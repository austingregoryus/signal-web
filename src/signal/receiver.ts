import WebSocket from 'ws'
import { classifyEnvelope, type EnvelopeKind, type RawEnvelope } from './envelopes'

export interface ReceiverEvent {
  kind: EnvelopeKind
  raw: RawEnvelope
}

export interface ReconnectOptions {
  minDelayMs: number
  maxDelayMs: number
}

export interface ReceiverOptions {
  wsBaseUrl: string
  signalNumber: string
  onEvent: (ev: ReceiverEvent) => void
  onError?: (err: Error) => void
  onOpen?: () => void
  onClose?: (code: number) => void
  WebSocketImpl?: typeof WebSocket
  reconnect?: ReconnectOptions
  heartbeatMs?: number
}

export function receiveUrl(wsBaseUrl: string, signalNumber: string): string {
  return `${wsBaseUrl}/v1/receive/${encodeURIComponent(signalNumber)}`
}

export class SignalReceiver {
  private ws?: WebSocket
  private stopped = false
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private heartbeatTimer?: ReturnType<typeof setInterval>
  private currentBackoffMs = 0

  constructor(private readonly opts: ReceiverOptions) {}

  start(): void {
    this.stopped = false
    this.clearReconnectTimer()
    const Impl = this.opts.WebSocketImpl ?? WebSocket
    const ws = new Impl(receiveUrl(this.opts.wsBaseUrl, this.opts.signalNumber))
    this.ws = ws

    ws.on('message', (data: WebSocket.RawData) => {
      let raw: RawEnvelope
      try {
        raw = JSON.parse(data.toString()) as RawEnvelope
      } catch {
        return // non-JSON keep-alive; ignore
      }
      this.opts.onEvent({ kind: classifyEnvelope(raw), raw })
    })

    ws.on('error', (err: Error) => this.opts.onError?.(err))
    ws.on('open', () => {
      // Reset backoff after a successful connection.
      this.currentBackoffMs = this.opts.reconnect?.minDelayMs ?? 0
      this.startHeartbeat()
      this.opts.onOpen?.()
    })
    ws.on('close', (code: number) => {
      this.clearHeartbeat()
      this.opts.onClose?.(code)
      if (!this.stopped) this.scheduleReconnect()
    })
  }

  stop(): void {
    this.stopped = true
    this.clearReconnectTimer()
    this.clearHeartbeat()
    this.ws?.close()
    this.ws = undefined
  }

  private scheduleReconnect(): void {
    const reconnect = this.opts.reconnect
    if (!reconnect) return
    const delay = this.currentBackoffMs > 0 ? this.currentBackoffMs : reconnect.minDelayMs
    this.currentBackoffMs = Math.min(delay * 2, reconnect.maxDelayMs)
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      if (!this.stopped) this.start()
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat()
    const heartbeatMs = this.opts.heartbeatMs
    if (!heartbeatMs) return
    this.heartbeatTimer = setInterval(() => {
      this.ws?.ping()
    }, heartbeatMs)
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }
}
