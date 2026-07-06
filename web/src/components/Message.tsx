import type { Message as Msg } from '../api/types'
import { Reactions } from './Reactions'
import { Attachment } from './Attachment'
import { avatarColor, initials } from './avatar'
import styles from './Message.module.css'

export function Message({
  m, onReact, onReply, onEdit, quoteOf, compact, showSender, resolveName,
}: {
  m: Msg
  onReact?: (emoji: string) => void
  onReply?: (m: Msg) => void
  onEdit?: (m: Msg) => void
  quoteOf?: (authorId: string, timestamp: number) => Msg | undefined
  compact?: boolean
  /** Whether to show the sender's name (group inbound, non-compact). */
  showSender?: boolean
  /** Resolve an author id/number to a display name (for group sender labels). */
  resolveName?: (authorId: string, authorNumber: string | null) => string | null
}): React.JSX.Element {
  const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  // Outgoing receipt state, in increasing significance: sent < delivered < read.
  const receiptState = m.direction === 'out'
    ? m.receipts.some((r) => r.type === 'read' || r.type === 'viewed')
      ? 'read'
      : m.receipts.some((r) => r.type === 'delivery')
        ? 'delivered'
        : 'sent'
    : 'none'
  const quoted = m.quoteAuthorId != null && m.quoteTimestamp != null
    ? quoteOf?.(m.quoteAuthorId, m.quoteTimestamp)
    : undefined
  // Only your own outgoing, non-deleted, text-bearing messages are editable.
  const canEdit = m.direction === 'out' && !m.deleted && m.body != null && m.body !== ''
  const senderName = showSender && !compact ? (resolveName?.(m.authorId, m.authorNumber) ?? m.authorNumber ?? m.authorId) : null
  return (
    <div className={`${styles.row} ${m.direction === 'out' ? styles.out : styles.in} ${compact ? styles.compact : ''}`}>
      {senderName ? (
        <span className={styles.senderAvatar} style={{ background: avatarColor(m.authorId) }} aria-hidden>
          {initials(senderName)}
        </span>
      ) : null}
      <div className={styles.bubble}>
        {senderName ? <span className={styles.sender}>{senderName}</span> : null}
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
          {receiptState === 'sent' ? <span className={styles.tick}> · Sent</span> : null}
          {receiptState === 'delivered' ? <span className={styles.tick}> · Delivered</span> : null}
          {receiptState === 'read' ? <span className={styles.read}> · Read</span> : null}
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
