import type { Conversation } from '../api/types'
import { avatarColor, initials } from './avatar'
import styles from './ConversationList.module.css'

export function ConversationList({
  conversations, selectedId, onSelect,
}: { conversations: Conversation[]; selectedId: string | null; onSelect: (id: string) => void }): React.JSX.Element {
  return (
    <ul className={styles.list}>
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            className={`${styles.row} ${c.id === selectedId ? styles.active : ''}`}
            onClick={() => onSelect(c.id)}
          >
            <span className={styles.avatar} style={{ background: avatarColor(c.id) }} aria-hidden>
              {c.type === 'group' ? '👥' : initials(c.displayName)}
            </span>
            <span className={styles.name}>{c.displayName ?? c.id}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
