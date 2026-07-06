import type { Message as Msg } from '../api/types'
import { Reactions } from './Reactions'
import { Attachment } from './Attachment'
import styles from './Message.module.css'

export function Message({
  m, onReact, onReply, quoteOf, compact,
}: {
  m: Msg
  onReact?: (emoji: string) => void
  onReply?: (m: Msg) => void
  quoteOf?: (authorId: string, timestamp: number) => Msg | undefined
  compact?: boolean
}): React.JSX.Element {
  const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const isRead = m.direction === 'out' && m.receipts.some((r) => r.type === 'read')
  const quoted = m.quoteAuthorId != null && m.quoteTimestamp != null
    ? quoteOf?.(m.quoteAuthorId, m.quoteTimestamp)
    : undefined
  return (
    <div className={`${styles.row} ${m.direction === 'out' ? styles.out : styles.in} ${compact ? styles.compact : ''}`}>
      <div className={styles.bubble}>
        {quoted ? (
          <div className={styles.quote}>
            <span className={styles.quoteText}>{quoted.body ?? (quoted.attachments.length > 0 ? '📎 Attachment' : 'Message')}</span>
          </div>
        ) : null}
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
      {onReply && !m.deleted ? (
        <button className={styles.replyBtn} onClick={() => onReply(m)} aria-label="Reply" title="Reply">↩</button>
      ) : null}
    </div>
  )
}
