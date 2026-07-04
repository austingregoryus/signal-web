import { describe, it, expect } from 'vitest'
import { parseEnvelope } from '../../src/signal/parse'
import * as fx from '../fixtures/envelopes'

describe('parseEnvelope', () => {
  it('parses an inbound DM text into a message event', () => {
    const [ev] = fx.inboundText.envelope ? parseEnvelope(fx.inboundText, fx.SELF) : []
    expect(ev).toMatchObject({
      kind: 'message', direction: 'in', body: 'hello from alice',
      conversationId: 'alice-uuid', conversationType: 'dm', timestamp: 1000, authorId: 'alice-uuid',
    })
  })

  it('parses an own-sent sync message as an outgoing message to the destination conversation', () => {
    const [ev] = parseEnvelope(fx.ownSentText, fx.SELF)
    expect(ev).toMatchObject({
      kind: 'message', direction: 'out', body: 'reply from my phone',
      conversationId: 'alice-uuid', authorId: fx.SELF, timestamp: 2000,
    })
  })

  it('routes group messages to the group conversation', () => {
    const [ev] = parseEnvelope(fx.groupText, fx.SELF)
    expect(ev).toMatchObject({ kind: 'message', conversationId: 'group-xyz', conversationType: 'group' })
  })

  it('parses a reaction', () => {
    const [ev] = parseEnvelope(fx.inboundReaction, fx.SELF)
    expect(ev).toMatchObject({
      kind: 'reaction', emoji: '👍', targetAuthorId: fx.SELF, targetTimestamp: 2000, remove: false,
    })
  })

  it('parses an own-sent (sync) reaction with self as the reactor', () => {
    const [ev] = parseEnvelope(fx.ownSentReaction, fx.SELF)
    expect(ev).toMatchObject({
      kind: 'reaction', emoji: '🎉', reactorId: fx.SELF,
      targetAuthorId: 'alice-uuid', targetTimestamp: 1000, remove: false,
    })
  })

  it('parses a remote delete', () => {
    const [ev] = parseEnvelope(fx.remoteDelete, fx.SELF)
    expect(ev).toMatchObject({ kind: 'delete', targetAuthorId: 'alice-uuid', targetTimestamp: 1000 })
  })

  it('parses an edit', () => {
    const [ev] = parseEnvelope(fx.editMessage, fx.SELF)
    expect(ev).toMatchObject({
      kind: 'edit', targetAuthorId: 'alice-uuid', targetTimestamp: 1000, newBody: 'hello (edited)',
    })
  })

  it('parses a read receipt into a per-recipient event with self as target author', () => {
    const [ev] = parseEnvelope(fx.readReceipt, fx.SELF)
    expect(ev).toMatchObject({
      kind: 'receipt', type: 'read', targetAuthorId: fx.SELF, targetTimestamp: 2000, recipientId: 'alice-uuid',
    })
  })

  it('ignores typing', () => {
    expect(parseEnvelope(fx.typing, fx.SELF)).toEqual([{ kind: 'ignore' }])
  })
})
