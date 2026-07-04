import WebSocket from 'ws'
import { classifyEnvelope, type EnvelopeKind, type RawEnvelope } from './envelopes'

export interface ReceiverEvent {
  kind: EnvelopeKind
  raw: RawEnvelope
}

export interface ReceiverOptions {
  wsBaseUrl: string
  signalNumber: string
  onEvent: (ev: ReceiverEvent) => void
  onError?: (err: Error) => void
  WebSocketImpl?: typeof WebSocket
}

export function receiveUrl(wsBaseUrl: string, signalNumber: string): string {
  return `${wsBaseUrl}/v1/receive/${encodeURIComponent(signalNumber)}`
}

export class SignalReceiver {
  private ws?: WebSocket

  constructor(private readonly opts: ReceiverOptions) {}

  start(): void {
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
  }

  stop(): void {
    this.ws?.close()
    this.ws = undefined
  }
}
