import type { Message as Msg } from '../api/types'
import { Reactions } from './Reactions'
import { Attachment } from './Attachment'
import styles from './Message.module.css'

export function Message({
  m, onReact, onReply, onEdit, quoteOf, compact,
}: {
  m: Msg
  onReact?: (emoji: string) => void
  onReply?: (m: Msg) => void
  onEdit?: (m: Msg) => void
  quoteOf?: (authorId: string, timestamp: number) => Msg | undefined
  compact?: boolean
}): React.JSX.Element {
  const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const isRead = m.direction === 'out' && m.receipts.some((r) => r.type === 'read')
  const quoted = m.quoteAuthorId != null && m.quoteTimestamp != null
    ? quoteOf?.(m.quoteAuthorId, m.quoteTimestamp)
    : undefined
  // Only your own outgoing, non-deleted, text-bearing messages are editable.
  const canEdit = m.direction === 'out' && !m.deleted && m.body != null && m.body !== ''
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
      <div className={styles.actions}>
        {onReply && !m.deleted ? (
          <button className={styles.actionBtn} onClick={() => onReply(m)} aria-label="Reply" title="Reply">↩</button>
        ) : null}
        {onEdit && canEdit ? (
          <button className={styles.actionBtn} onClick={() => onEdit(m)} aria-label="Edit" title="Edit">✎</button>
        ) : null}
      </div>
    </div>
  )
}
