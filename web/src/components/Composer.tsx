import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type { Message as Msg } from '../api/types'
import { EmojiPicker } from './EmojiPicker'
import styles from './Composer.module.css'

export function Composer({
  onSend, replyTo, onCancelReply, editing, onSubmitEdit, onCancelEdit,
}: {
  onSend: (text: string, base64Attachments?: string[], quote?: { authorId: string; timestamp: number }) => void | Promise<void>
  replyTo?: Msg | null
  onCancelReply?: () => void
  editing?: Msg | null
  onSubmitEdit?: (timestamp: number, text: string) => void | Promise<void>
  onCancelEdit?: () => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isEditing = Boolean(editing)

  // When a reply target is set, focus the textarea so the user can type
  // immediately; clear it when the reply is cancelled or sent.
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus()
  }, [replyTo])

  // Edit mode: pre-fill the textarea with the message being edited and focus it.
  useEffect(() => {
    if (editing) {
      setText(editing.body ?? '')
      textareaRef.current?.focus()
    }
  }, [editing])

  async function send(): Promise<void> {
    const t = text.trim()
    if (!t) return
    try {
      if (isEditing && editing && onSubmitEdit) {
        await onSubmitEdit(editing.timestamp, t)
        setText('')
        setError(null)
        onCancelEdit?.()
      } else {
        const quote = replyTo ? { authorId: replyTo.authorId, timestamp: replyTo.timestamp } : undefined
        await onSend(t, undefined, quote)
        setText('')
        setError(null)
        if (quote) onCancelReply?.()
      }
    } catch {
      setError(isEditing ? "Couldn't save — try again" : "Couldn't send — try again")
    }
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
    if (isEditing && e.key === 'Escape') { e.preventDefault(); onCancelEdit?.() }
  }
  function onAttachClick(): void {
    fileInputRef.current?.click()
  }
  function onEmoji(emoji: string): void {
    // Insert at the cursor; keep focus in the textarea so the user can keep typing.
    const ta = textareaRef.current
    if (!ta) { setText((t) => t + emoji); return }
    const start = ta.selectionStart ?? text.length
    const end = ta.selectionEnd ?? text.length
    const next = text.slice(0, start) + emoji + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      const pos = start + emoji.length
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }
  function onFileChange(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        // Keep the full data URL (e.g. "data:image/jpeg;base64,..."). The server
        // splits off the content type for local storage and the bare base64 for
        // signal-cli. Sending only the bare base64 lost the MIME type, so the
        // sender's own copy rendered as a non-image attachment.
        void (async () => {
          try {
            await onSend('', [result])
            setError(null)
          } catch {
            setError("Couldn't send — try again")
          }
        })()
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }
  // Attach/emoji are disabled in edit mode — Signal edits are text-only.
  return (
    <div className={styles.bar}>
      {editing ? (
        <div className={styles.replyBar}>
          <span className={styles.replyQuote}>
            <span className={styles.replyLabel}>Editing message</span>
            <span className={styles.replyText}>{editing.body ?? 'Message'}</span>
          </span>
          <button type="button" className={styles.replyCancel} aria-label="Cancel edit" onClick={onCancelEdit}>×</button>
        </div>
      ) : replyTo ? (
        <div className={styles.replyBar}>
          <span className={styles.replyQuote}>
            <span className={styles.replyLabel}>Replying to</span>
            <span className={styles.replyText}>{replyTo.body ?? (replyTo.attachments.length > 0 ? '📎 Attachment' : 'Message')}</span>
          </span>
          <button type="button" className={styles.replyCancel} aria-label="Cancel reply" onClick={onCancelReply}>×</button>
        </div>
      ) : null}
      <button className={styles.attach} onClick={onAttachClick} aria-label="Attach file" disabled={isEditing}>📎</button>
      <input
        ref={fileInputRef}
        className={styles.fileInput}
        type="file"
        aria-label="Attachment file"
        onChange={onFileChange}
        disabled={isEditing}
      />
      <button
        className={styles.emoji}
        onClick={() => setShowEmoji((s) => !s)}
        aria-label="Emoji"
        aria-expanded={showEmoji}
        title="Emoji"
      >
        😊
      </button>
      <textarea
        ref={textareaRef}
        className={styles.box} rows={1}
        placeholder={isEditing ? 'Edit message…' : 'Message'}
        aria-label="Message"
        value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
      />
      <button className={styles.send} onClick={() => void send()} aria-label={isEditing ? 'Save edit' : 'Send'}>
        {isEditing ? '✓' : '➤'}
      </button>
      {error && <span role="alert" className={styles.error}>{error}</span>}
      {showEmoji && !isEditing ? (
        <EmojiPicker onPick={onEmoji} onClose={() => setShowEmoji(false)} />
      ) : null}
    </div>
  )
}
