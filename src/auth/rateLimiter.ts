export interface RateLimitConfig {
  maxPerKey: number
  windowMs: number
  lockoutMs: number
  maxGlobal: number
}

export interface RateDecision {
  allowed: boolean
  retryAfterMs: number
}

interface KeyState {
  failures: number[] // timestamps within the window
  lockedUntil: number
}

export class RateLimiter {
  private readonly keys = new Map<string, KeyState>()

  constructor(private readonly config: RateLimitConfig) {}

  private prune(state: KeyState, now: number): void {
    const cutoff = now - this.config.windowMs
    state.failures = state.failures.filter((t) => t > cutoff)
  }

  private globalFailures(now: number): number {
    const cutoff = now - this.config.windowMs
    let total = 0
    for (const state of this.keys.values()) total += state.failures.filter((t) => t > cutoff).length
    return total
  }

  check(key: string, now: number): RateDecision {
    const state = this.keys.get(key)
    if (state && now < state.lockedUntil) {
      return { allowed: false, retryAfterMs: state.lockedUntil - now }
    }
    if (this.globalFailures(now) >= this.config.maxGlobal) {
      return { allowed: false, retryAfterMs: this.config.windowMs }
    }
    return { allowed: true, retryAfterMs: 0 }
  }

  recordFailure(key: string, now: number): void {
    const state = this.keys.get(key) ?? { failures: [], lockedUntil: 0 }
    this.prune(state, now)
    state.failures.push(now)
    if (state.failures.length >= this.config.maxPerKey) {
      state.lockedUntil = now + this.config.lockoutMs
    }
    this.keys.set(key, state)
  }

  recordSuccess(key: string): void {
    this.keys.delete(key)
  }
}
