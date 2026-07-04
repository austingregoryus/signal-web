import { describe, it, expect } from 'vitest'
import { authorId } from '../../src/store/identity'

describe('authorId', () => {
  it('prefers uuid when present', () => {
    expect(authorId('uuid-1', '+15551234567')).toBe('uuid-1')
  })
  it('falls back to number when uuid is missing', () => {
    expect(authorId(null, '+15551234567')).toBe('+15551234567')
    expect(authorId(undefined, '+15551234567')).toBe('+15551234567')
  })
  it('throws when neither is present', () => {
    expect(() => authorId(null, null)).toThrow(/requires uuid or number/)
  })
})
