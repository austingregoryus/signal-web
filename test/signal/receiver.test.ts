import { describe, it, expect, afterEach } from 'vitest'
import { WebSocketServer } from 'ws'
import WebSocket from 'ws'
import { SignalReceiver, receiveUrl, type ReceiverEvent } from '../../src/signal/receiver'

describe('receiveUrl', () => {
  it('builds the receive endpoint with an encoded number', () => {
    expect(receiveUrl('ws://host:8080', '+15551234567')).toBe(
      'ws://host:8080/v1/receive/%2B15551234567',
    )
  })
})

describe('SignalReceiver', () => {
  let wss: WebSocketServer | undefined

  afterEach(() => {
    wss?.close()
    wss = undefined
  })

  it('parses and classifies an incoming envelope', async () => {
    wss = new WebSocketServer({ port: 0 })
    await new Promise<void>((resolve) => wss!.on('listening', () => resolve()))
    const port = (wss.address() as { port: number }).port

    wss.on('connection', (sock) => {
      sock.send(JSON.stringify({ envelope: { timestamp: 42, dataMessage: { message: 'hi' } } }))
    })

    const events: ReceiverEvent[] = []
    const rx = new SignalReceiver({
      wsBaseUrl: `ws://127.0.0.1:${port}`,
      signalNumber: '+15551234567',
      onEvent: (e) => events.push(e),
      WebSocketImpl: WebSocket,
    })
    rx.start()

    await new Promise<void>((resolve) => setTimeout(resolve, 250))
    rx.stop()

    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].kind).toBe('data')
    expect(events[0].raw.envelope?.timestamp).toBe(42)
  })

  it('ignores non-JSON keep-alive frames without throwing', async () => {
    wss = new WebSocketServer({ port: 0 })
    await new Promise<void>((resolve) => wss!.on('listening', () => resolve()))
    const port = (wss.address() as { port: number }).port

    wss.on('connection', (sock) => sock.send('ping'))

    const events: ReceiverEvent[] = []
    const rx = new SignalReceiver({
      wsBaseUrl: `ws://127.0.0.1:${port}`,
      signalNumber: '+15551234567',
      onEvent: (e) => events.push(e),
      WebSocketImpl: WebSocket,
    })
    rx.start()

    await new Promise<void>((resolve) => setTimeout(resolve, 200))
    rx.stop()

    expect(events.length).toBe(0)
  })

  it('calls onOpen when the connection is established', async () => {
    wss = new WebSocketServer({ port: 0 })
    await new Promise<void>((resolve) => wss!.on('listening', () => resolve()))
    const port = (wss.address() as { port: number }).port

    let opened = false
    const rx = new SignalReceiver({
      wsBaseUrl: `ws://127.0.0.1:${port}`,
      signalNumber: '+15551234567',
      onEvent: () => {},
      onOpen: () => {
        opened = true
      },
      WebSocketImpl: WebSocket,
    })
    rx.start()

    await new Promise<void>((resolve) => setTimeout(resolve, 250))
    rx.stop()

    expect(opened).toBe(true)
  })
})
