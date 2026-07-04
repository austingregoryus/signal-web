import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `sws-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

const policy = { ttlMs: 30 * 24 * 3600_000, idleMs: 7 * 24 * 3600_000 }
const T0 = 1_000_000_000_000

describe('SessionRepo', () => {
  it('creates a session and validates it', () => {
    const s = open()
    const token = s.sessions.create(T0, policy)
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(20)
    expect(s.sessions.validate(token, T0 + 1000, policy)).toBe(true)
  })

  it('does not store the raw token (only its hash)', () => {
    const s = open()
    const token = s.sessions.create(T0, policy)
    const row = s.db.prepare('SELECT token_hash FROM sessions').get() as { token_hash: string }
    expect(row.token_hash).not.toBe(token)
  })

  it('rejects an unknown token', () => {
    const s = open()
    expect(s.sessions.validate('nope', T0, policy)).toBe(false)
  })

  it('expires past the absolute TTL and deletes the row', () => {
    const s = open()
    const token = s.sessions.create(T0, policy)
    expect(s.sessions.validate(token, T0 + policy.ttlMs + 1, policy)).toBe(false)
    expect(s.sessions.count()).toBe(0)
  })

  it('expires after idle timeout', () => {
    const s = open()
    const token = s.sessions.create(T0, policy)
    // active at T0+idle-1 keeps it alive, advancing last_seen
    expect(s.sessions.validate(token, T0 + policy.idleMs - 1, policy)).toBe(true)
    // idle window measured from the new last_seen
    expect(s.sessions.validate(token, T0 + policy.idleMs - 1 + policy.idleMs + 1, policy)).toBe(false)
  })

  it('revoke removes a single session; revokeAll clears them', () => {
    const s = open()
    const a = s.sessions.create(T0, policy)
    const b = s.sessions.create(T0, policy)
    s.sessions.revoke(a)
    expect(s.sessions.validate(a, T0 + 1, policy)).toBe(false)
    expect(s.sessions.validate(b, T0 + 1, policy)).toBe(true)
    s.sessions.revokeAll()
    expect(s.sessions.count()).toBe(0)
  })
})
