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
  path = join(tmpdir(), `swac-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

describe('AuthConfigRepo', () => {
  it('returns null before a password is set', () => {
    const s = open()
    expect(s.authConfig.getPasswordHash()).toBeNull()
  })

  it('stores and reads back the password hash (singleton)', () => {
    const s = open()
    s.authConfig.setPasswordHash('hash-1')
    expect(s.authConfig.getPasswordHash()).toBe('hash-1')
    s.authConfig.setPasswordHash('hash-2')
    expect(s.authConfig.getPasswordHash()).toBe('hash-2')
  })
})
