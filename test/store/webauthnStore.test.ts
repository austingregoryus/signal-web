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
  path = join(tmpdir(), `sww-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

describe('WebAuthnRepo', () => {
  it('takeChallenge is one-time-use', () => {
    const s = open()
    s.webauthn.saveChallenge('chal-1', 1000)
    expect(s.webauthn.takeChallenge()).toBe('chal-1')
    expect(s.webauthn.takeChallenge()).toBeNull()
  })

  it('stores, lists, gets, and updates a credential', () => {
    const s = open()
    expect(s.webauthn.hasCredential()).toBe(false)
    s.webauthn.addCredential({
      id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['usb'], createdAt: 1,
    })
    expect(s.webauthn.hasCredential()).toBe(true)
    expect(s.webauthn.listCredentials()).toHaveLength(1)
    const got = s.webauthn.getCredential('cred-1')
    expect(got?.transports).toEqual(['usb'])
    expect(Array.from(got!.publicKey)).toEqual([1, 2, 3])
    s.webauthn.updateCounter('cred-1', 5)
    expect(s.webauthn.getCredential('cred-1')?.counter).toBe(5)
  })
})
