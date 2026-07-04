import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { ProfileService } from '../../src/profile/service'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swprof-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

const stubClient = {
  listContacts: async () => [
    { uuid: 'alice-uuid', number: '+15551110001', name: 'Alice' },
    { uuid: 'bob-uuid', number: '+15551110002' }, // no name
  ],
  listGroups: async () => [{ id: 'group-xyz', name: 'Family' }],
}

describe('ProfileService.refresh', () => {
  it('names conversations from contacts and groups, leaving unnamed ones on fallback', async () => {
    const s = open()
    s.conversations.ensure({ id: 'alice-uuid', type: 'dm' })
    s.conversations.ensure({ id: 'bob-uuid', type: 'dm' })
    s.conversations.ensure({ id: 'group-xyz', type: 'group' })
    const svc = new ProfileService({ store: s, client: stubClient, avatarDir: tmpdir() })
    const res = await svc.refresh()
    const byId = Object.fromEntries(s.conversations.list().map((c) => [c.id, c.displayName]))
    expect(byId['alice-uuid']).toBe('Alice')
    expect(byId['group-xyz']).toBe('Family')
    expect(byId['bob-uuid']).toBeNull() // stays on number-fallback
    expect(res.named).toBe(2)
  })
})
