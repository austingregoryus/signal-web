import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { avatarColor, initials } from './avatar'
import styles from './ConversationInfo.module.css'

interface Member {
  number: string
  displayName: string | null
  isAdmin: boolean
}
interface Info {
  type: 'dm' | 'group'
  displayName: string | null
  name?: string
  description?: string
  members?: Member[]
}

/**
 * Panel showing a conversation's details: for groups, the member list (numbers
 * resolved to names, admins badged); for both, a rename field. Group renames
 * propagate to all members via signal-cli; DM renames are local-only.
 */
export function ConversationInfo({
  conversationId, initialName, onClose, onRenamed,
}: {
  conversationId: string
  initialName: string | null
  onClose: () => void
  onRenamed: (newName: string) => void
}): React.JSX.Element {
  const [info, setInfo] = useState<Info | null>(null)
  const [name, setName] = useState(initialName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    api.get<Info>(`/api/conversations/${encodeURIComponent(conversationId)}/info`)
      .then((i) => { if (alive) { setInfo(i); setName(i.name ?? i.displayName ?? '') } })
      .catch(() => { if (alive) setError('Could not load info') })
    return () => { alive = false }
  }, [conversationId])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  async function saveRename(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || trimmed === (info?.name ?? info?.displayName)) return
    setSaving(true); setError(null)
    try {
      await api.post(`/api/conversations/${encodeURIComponent(conversationId)}/rename`, { name: trimmed })
      onRenamed(trimmed)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError && err.status === 502 ? 'Signal rejected the rename' : 'Could not rename — try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }} role="presentation">
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Conversation info">
        <div className={styles.header}>
          <h2 className={styles.title}>Info</h2>
          <button type="button" className={styles.closeBtn} aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className={styles.body}>
          <label className={styles.field}>
            <span className={styles.label}>{info?.type === 'group' ? 'Group name' : 'Name'}</span>
            <div className={styles.renameRow}>
              <input
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={info?.type === 'group' ? 'Group name' : 'Contact name'}
              />
              <button
                type="button"
                className={styles.saveBtn}
                onClick={() => void saveRename()}
                disabled={saving || !name.trim() || name.trim() === (info?.name ?? info?.displayName)}
              >
                Save
              </button>
            </div>
            {info?.type === 'dm' ? <span className={styles.hint}>Only changes the name on this device.</span> : null}
          </label>

          {info?.type === 'group' ? (
            <div className={styles.section}>
              <span className={styles.label}>Members ({info.members?.length ?? 0})</span>
              <ul className={styles.memberList}>
                {(info.members ?? []).map((m) => (
                  <li key={m.number} className={styles.member}>
                    <span className={styles.memberAvatar} style={{ background: avatarColor(m.number) }} aria-hidden>
                      {initials(m.displayName ?? m.number)}
                    </span>
                    <span className={styles.memberName}>{m.displayName ?? m.number}</span>
                    {m.isAdmin ? <span className={styles.adminBadge}>admin</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? <span role="alert" className={styles.error}>{error}</span> : null}
        </div>
      </div>
    </div>
  )
}
