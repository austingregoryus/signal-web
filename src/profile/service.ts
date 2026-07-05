import type { Store } from '../store/store'

interface ContactLike { number?: string; uuid?: string; name?: string; profileName?: string }
interface GroupLike { id: string; name?: string }

export interface ProfileDeps {
  store: Store
  client: { listContacts: () => Promise<ContactLike[]>; listGroups: () => Promise<GroupLike[]> }
  avatarDir: string
}

export class ProfileService {
  constructor(private readonly deps: ProfileDeps) {}

  async refresh(): Promise<{ named: number }> {
    let named = 0
    const [contacts, groups] = await Promise.all([
      this.deps.client.listContacts().catch(() => [] as ContactLike[]),
      this.deps.client.listGroups().catch(() => [] as GroupLike[]),
    ])
    for (const c of contacts) {
      const name = c.name || c.profileName
      const id = c.uuid || c.number
      // Seed the alias table so a number-keyed conversation can later be folded
      // into the UUID when both identifiers are present.
      if (c.uuid && c.number) this.deps.store.conversations.linkAlias(c.number, c.uuid)
      if (name && id) {
        this.deps.store.conversations.ensure({ id, type: 'dm', displayName: name })
        named++
      }
    }
    for (const g of groups) {
      if (g.name) {
        this.deps.store.conversations.ensure({ id: g.id, type: 'group', displayName: g.name })
        named++
      }
    }
    return { named }
  }
}
