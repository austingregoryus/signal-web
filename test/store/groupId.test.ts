import { describe, it, expect } from 'vitest'
import { normalizeGroupId, toSendGroupId } from '../../src/store/groupId'

// The real pair observed against a live signal-cli instance:
const RAW = 'GxH1JWjt6ejZYUjRwdyIRjqgip+u4i6cMziREZmGJhg='
const PREFIXED = 'group.R3hIMUpXanQ2ZWpaWVVqUndkeUlSanFnaXArdTRpNmNNemlSRVptR0poZz0='

describe('groupId normalization', () => {
  it('normalizeGroupId: strips the group. prefix by decoding back to raw', () => {
    expect(normalizeGroupId(PREFIXED)).toBe(RAW)
  })

  it('normalizeGroupId: passes raw and non-group ids through unchanged', () => {
    expect(normalizeGroupId(RAW)).toBe(RAW)
    expect(normalizeGroupId('some-uuid-1234')).toBe('some-uuid-1234')
    expect(normalizeGroupId('+15551234567')).toBe('+15551234567')
  })

  it('toSendGroupId: prefixes a raw group id for signal-cli /v2/send', () => {
    expect(toSendGroupId(RAW)).toBe(PREFIXED)
  })

  it('toSendGroupId: passes already-prefixed, UUIDs, and numbers through unchanged', () => {
    expect(toSendGroupId(PREFIXED)).toBe(PREFIXED)
    expect(toSendGroupId('some-uuid-1234')).toBe('some-uuid-1234')
    expect(toSendGroupId('+15551234567')).toBe('+15551234567')
  })

  it('round-trips: toSendGroupId(normalizeGroupId(x)) === x for prefixed ids', () => {
    expect(toSendGroupId(normalizeGroupId(PREFIXED))).toBe(PREFIXED)
    expect(normalizeGroupId(toSendGroupId(RAW))).toBe(RAW)
  })
})
