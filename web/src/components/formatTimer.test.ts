import { describe, it, expect } from 'vitest'
import { formatTimer } from './formatTimer'

describe('formatTimer', () => {
  it('labels common Signal timers', () => {
    expect(formatTimer(30_000)).toBe('30s')
    expect(formatTimer(5 * 60_000)).toBe('5m')
    expect(formatTimer(3_600_000)).toBe('1h')
    expect(formatTimer(86_400_000)).toBe('1d')
    expect(formatTimer(4 * 604_800_000)).toBe('4w')
    expect(formatTimer(90 * 60_000)).toBe('90m')
  })
})
