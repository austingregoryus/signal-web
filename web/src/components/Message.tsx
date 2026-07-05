import type { Message as Msg } from '../api/types'
import { Reactions } from './Reactions'
import { Attachment } from './Attachment'
import styles from './Message.module.css'

export function Message({
  m, onReact, compact,
}: { m: Msg; onReact?: (emoji: string) => void; compact?: boolean }): React.JSX.Element {
  const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const isRead = m.direction === 'out' && m.receipts.some((r) => r.type === 'read')
  return (
    <div className={`${styles.row} ${m.direction === 'out' ? styles.out : styles.in} ${compact ? styles.compact : ''}`}>
      <div className={styles.bubble}>
        {m.deleted ? (
          <em className={styles.deleted}>This message was deleted</em>
        ) : (
          <span className={styles.body}>{m.body}</span>
        )}
        {m.attachments.map((a) => <Attachment key={a.id} meta={a} />)}
        <span className={styles.meta}>
          {m.editedTimestamp && !m.deleted ? <span className={styles.edited}>edited · </span> : null}
          {time}
          {isRead ? <span className={styles.read}> · ✓✓ Read</span> : null}
        </span>
        {onReact ? (
          <Reactions reactions={m.reactions} onReact={onReact} align={m.direction === 'out' ? 'end' : 'start'} />
        ) : null}
      </div>
    </div>
  )
}
