import type { Store } from '../store/store'
import { normalizeGroupId } from '../store/groupId'

interface ContactLike {
  number?: string
  uuid?: string
  name?: string
  /** What signal-cli-rest-api actually sends for the contact's own profile name. */
  profile_name?: string
  profileName?: string
  message_expiration?: string
}
interface GroupLike { id: string; name?: string }

/**
 * signal-cli-rest-api's contact `message_expiration` ("86400s", "disabled", or
 * a bare number of seconds) as ms; null when the field is absent or unreadable.
 * As of signal-cli-rest-api 0.101 / signal-cli 0.14.8 the field is always empty
 * (the REST layer reads `messageExpiration` but signal-cli emits
 * `messageExpirationTime`), so until upstream fixes the name, timers are
 * learned only from traffic — see DEPLOY.md troubleshooting.
 */
export function parseExpiration(raw: string | undefined): number | null {
  if (raw == null) return null
  const s = raw.trim().toLowerCase()
  if (s === '') return null
  if (s === 'disabled' || s === 'off') return 0
  const m = /^(\d+)\s*s?$/.exec(s)
  return m ? Number(m[1]) * 1000 : null
}

export interface ProfileDeps {
  store: Store
  client: { listContacts: () => Promise<ContactLike[]>; listGroups: () => Promise<GroupLike[]> }
  avatarDir: string
}

export class ProfileService {
  constructor(private readonly deps: ProfileDeps) {}

  async refresh(): Promise<{ named: number }> {
    let named = 0
    // A failed fetch leaves existing names alone, but say so: a silent failure
    // here once left every conversation showing a raw id until the next run.
    const warn = (what: string) => (err: unknown): never[] => {
      console.warn(`[profile] ${what} refresh failed: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
    const [contacts, groups] = await Promise.all([
      this.deps.client.listContacts().catch(warn('contact')) as Promise<ContactLike[]>,
      this.deps.client.listGroups().catch(warn('group')) as Promise<GroupLike[]>,
    ])
    for (const c of contacts) {
      const name = c.name || c.profile_name || c.profileName
      const id = c.uuid || c.number
      // Seed the alias table so a number-keyed conversation can later be folded
      // into the UUID when both identifiers are present.
      if (c.uuid && c.number) this.deps.store.conversations.linkAlias(c.number, c.uuid)
      if (name && id) {
        this.deps.store.conversations.ensure({ id, type: 'dm', displayName: name })
        named++
      }
      // Seed the disappearing-message timer from signal-cli's contact store so
      // sends from the web expire even before any traffic in the chat.
      const timerMs = parseExpiration(c.message_expiration)
      if (id && timerMs !== null) this.deps.store.conversations.setExpireTimer(id, timerMs)
    }
    for (const g of groups) {
      if (g.name) {
        // signal-cli's /v1/groups returns the "group."-prefixed form; normalize
        // to the raw base64 form so this matches the id inbound envelopes use
        // (otherwise the group splits into two conversations).
        this.deps.store.conversations.ensure({ id: normalizeGroupId(g.id), type: 'group', displayName: g.name })
        named++
      }
    }
    return { named }
  }
}
