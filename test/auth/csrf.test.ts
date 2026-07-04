import { describe, it, expect } from 'vitest'
import { issueCsrfToken, verifyCsrf, isAllowedOrigin } from '../../src/auth/csrf'

describe('CSRF', () => {
  it('issues distinct high-entropy tokens', () => {
    const a = issueCsrfToken()
    const b = issueCsrfToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(20)
  })

  it('verifies matching cookie and header tokens', () => {
    const t = issueCsrfToken()
    expect(verifyCsrf(t, t)).toBe(true)
  })

  it('rejects when missing or mismatched', () => {
    const t = issueCsrfToken()
    expect(verifyCsrf(t, undefined)).toBe(false)
    expect(verifyCsrf(undefined, t)).toBe(false)
    expect(verifyCsrf(t, t + 'x')).toBe(false)
    expect(verifyCsrf('', '')).toBe(false)
  })
})

describe('isAllowedOrigin', () => {
  it('accepts an exact match and rejects others', () => {
    expect(isAllowedOrigin('https://signal.example.com', 'https://signal.example.com')).toBe(true)
    expect(isAllowedOrigin('https://evil.com', 'https://signal.example.com')).toBe(false)
    expect(isAllowedOrigin(undefined, 'https://signal.example.com')).toBe(false)
  })
})
