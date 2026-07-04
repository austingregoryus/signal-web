import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { startRegistration, startAuthentication } from '../../src/auth/webauthn'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swwa-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

const cfg = { rpId: 'signal.example.com', rpName: 'Signal Web', origin: 'https://signal.example.com' }

describe('webauthn ceremony (options + challenge persistence)', () => {
  it('startRegistration returns options and persists the challenge', async () => {
    const s = open()
    const options = await startRegistration(s.webauthn, cfg, 'user-1', 1000)
    expect(options.rp.id).toBe('signal.example.com')
    expect(typeof options.challenge).toBe('string')
    // the challenge is saved server-side for the finish step
    expect(s.webauthn.takeChallenge()).toBeTruthy()
  })

  it('startAuthentication persists a challenge even with no credentials', async () => {
    const s = open()
    const options = await startAuthentication(s.webauthn, cfg, 2000)
    expect(typeof options.challenge).toBe('string')
    expect(s.webauthn.takeChallenge()).toBeTruthy()
  })
})
