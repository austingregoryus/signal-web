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

  it('round-trips: toSendGroupId(normalizeGroupId(x)) === x for prefixed id', () => {
    expect(toSendGroupId(normalizeGroupId(PREFIXED))).toBe(PREFIXED)
    expect(normalizeGroupId(toSendGroupId(RAW))).toBe(RAW)
  })

  it('toSendGroupId does NOT misfire on a long hex-only token (no + or /)', () => {
    // A 32-char hex sha256 prefix looks base64-ish but is hex-only; it must NOT
    // be treated as a group id (would route a DM recipient to the group endpoint).
    const hex = '9f86d081884c7d659a2feaa0c55ad015'
    expect(toSendGroupId(hex)).toBe(hex)
  })

  it('toSendGroupId does NOT misfire on a 40+ char alphanumeric-only token', () => {
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghij' // 46 chars, no + or /
    expect(toSendGroupId(token)).toBe(token)
  })
})
