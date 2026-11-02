import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { ProfileService, parseExpiration } from '../../src/profile/service'

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

  it('seeds disappearing timers from the contact list when signal-cli reports them', async () => {
    const s = open()
    s.conversations.ensure({ id: 'alice-uuid', type: 'dm' })
    s.conversations.setExpireTimer('alice-uuid', 60_000) // learned from traffic earlier
    const client = {
      listContacts: async () => [
        { uuid: 'alice-uuid', number: '+15551110001', name: 'Alice', message_expiration: '' }, // field empty: leave as is
        { uuid: 'carol-uuid', number: '+15551110003', name: 'Carol', message_expiration: '86400s' },
        { uuid: 'dave-uuid', number: '+15551110004', name: 'Dave', message_expiration: 'disabled' },
      ],
      listGroups: async () => [],
    }
    await new ProfileService({ store: s, client, avatarDir: tmpdir() }).refresh()
    expect(s.conversations.getExpireTimer('alice-uuid')).toBe(60_000)
    expect(s.conversations.getExpireTimer('carol-uuid')).toBe(86_400_000)
    expect(s.conversations.getExpireTimer('dave-uuid')).toBe(0)
  })
})

describe('parseExpiration', () => {
  it('reads seconds, "disabled", and treats an empty field as unknown', () => {
    expect(parseExpiration('86400s')).toBe(86_400_000)
    expect(parseExpiration('30')).toBe(30_000)
    expect(parseExpiration('disabled')).toBe(0)
    expect(parseExpiration('')).toBeNull()
    expect(parseExpiration(undefined)).toBeNull()
    expect(parseExpiration('1d')).toBeNull() // unknown format: don't guess
  })
})
