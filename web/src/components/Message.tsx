import type { Message as Msg } from '../api/types'
import styles from './Message.module.css'

export function Message({ m }: { m: Msg }): React.JSX.Element {
  const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className={`${styles.row} ${m.direction === 'out' ? styles.out : styles.in}`}>
      <div className={styles.bubble}>
        {m.deleted ? (
          <em className={styles.deleted}>This message was deleted</em>
        ) : (
          <span className={styles.body}>{m.body}</span>
        )}
        <span className={styles.meta}>
          {m.editedTimestamp && !m.deleted ? <span className={styles.edited}>edited · </span> : null}
          {time}
        </span>
      </div>
    </div>
  )
}
