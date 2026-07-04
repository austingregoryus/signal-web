import { describe, it, expect } from 'vitest'
import { RateLimiter } from '../../src/auth/rateLimiter'

const cfg = { maxPerKey: 3, windowMs: 60_000, lockoutMs: 300_000, maxGlobal: 100 }

describe('RateLimiter', () => {
  it('allows attempts under the limit', () => {
    const rl = new RateLimiter(cfg)
    expect(rl.check('ip1', 0).allowed).toBe(true)
    rl.recordFailure('ip1', 0)
    expect(rl.check('ip1', 1).allowed).toBe(true)
  })

  it('locks out a key after maxPerKey failures', () => {
    const rl = new RateLimiter(cfg)
    rl.recordFailure('ip1', 0)
    rl.recordFailure('ip1', 1)
    rl.recordFailure('ip1', 2)
    const d = rl.check('ip1', 3)
    expect(d.allowed).toBe(false)
    expect(d.retryAfterMs).toBeGreaterThan(0)
  })

  it('lifts the lockout after lockoutMs', () => {
    const rl = new RateLimiter(cfg)
    rl.recordFailure('ip1', 0)
    rl.recordFailure('ip1', 0)
    rl.recordFailure('ip1', 0)
    expect(rl.check('ip1', 0).allowed).toBe(false)
    expect(rl.check('ip1', cfg.lockoutMs + 1).allowed).toBe(true)
  })

  it("a successful login clears the key's failures", () => {
    const rl = new RateLimiter(cfg)
    rl.recordFailure('ip1', 0)
    rl.recordFailure('ip1', 0)
    rl.recordSuccess('ip1')
    rl.recordFailure('ip1', 1)
    expect(rl.check('ip1', 2).allowed).toBe(true)
  })

  it('failures outside the window do not count toward lockout', () => {
    const rl = new RateLimiter(cfg)
    rl.recordFailure('ip1', 0)
    rl.recordFailure('ip1', 0)
    rl.recordFailure('ip1', cfg.windowMs + 1) // first two aged out
    expect(rl.check('ip1', cfg.windowMs + 2).allowed).toBe(true)
  })

  it('denies when the global failure budget is exhausted', () => {
    const rl = new RateLimiter({ ...cfg, maxGlobal: 2 })
    rl.recordFailure('a', 0)
    rl.recordFailure('b', 0)
    expect(rl.check('c', 0).allowed).toBe(false)
  })
})
