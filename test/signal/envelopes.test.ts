import { describe, it, expect } from 'vitest'
import { classifyEnvelope } from '../../src/signal/envelopes'

describe('classifyEnvelope', () => {
  it('classifies an inbound data message', () => {
    expect(classifyEnvelope({ envelope: { dataMessage: { message: 'hi' } } })).toBe('data')
  })

  it('classifies an own-sent sync message as sync-sent (before data)', () => {
    expect(
      classifyEnvelope({ envelope: { syncMessage: { sentMessage: { message: 'hi' } } } }),
    ).toBe('sync-sent')
  })

  it('classifies a receipt', () => {
    expect(classifyEnvelope({ envelope: { receiptMessage: { isRead: true } } })).toBe('receipt')
  })

  it('classifies a typing indicator', () => {
    expect(classifyEnvelope({ envelope: { typingMessage: { action: 'STARTED' } } })).toBe('typing')
  })

  it('prefers sync-sent when both syncMessage.sentMessage and dataMessage are present', () => {
    expect(
      classifyEnvelope({
        envelope: {
          syncMessage: { sentMessage: { message: 'hi' } },
          dataMessage: { message: 'hi' },
        },
      }),
    ).toBe('sync-sent')
  })

  it('returns unknown for an empty envelope', () => {
    expect(classifyEnvelope({})).toBe('unknown')
  })
})
