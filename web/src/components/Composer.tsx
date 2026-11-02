import { useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type Ref } from 'react'
import type { Message as Msg } from '../api/types'
import { EmojiPicker } from './EmojiPicker'
import styles from './Composer.module.css'

/** Raw bytes allowed per message. Base64 adds a third, so this stays under the server's 25 MB body limit. */
export const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024

export interface ComposerHandle {
  /** Queue files (from a drop elsewhere on the page) as attachments. */
  addFiles(files: File[]): void
}

interface Pending { id: number; name: string; contentType: string; size: number; dataUrl: string }

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('unreadable')))
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'))
    reader.readAsDataURL(file)
  })
}

export function Composer({
  onSend, replyTo, onCancelReply, editing, onSubmitEdit, onCancelEdit, ref,
}: {
  onSend: (text: string, base64Attachments?: string[], quote?: { authorId: string; timestamp: number }) => void | Promise<void>
  replyTo?: Msg | null
  onCancelReply?: () => void
  editing?: Msg | null
  onSubmitEdit?: (timestamp: number, text: string) => void | Promise<void>
  onCancelEdit?: () => void
  ref?: Ref<ComposerHandle>
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [pending, setPending] = useState<Pending[]>([])
  const nextId = useRef(1)
  const pendingBytes = useRef(0) // includes reads still in flight, so a burst can't overshoot the cap
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

  function addFiles(files: File[]): void {
    if (isEditing || files.length === 0) return // Signal edits are text-only
    let rejected = false
    for (const file of files) {
      if (pendingBytes.current + file.size > MAX_ATTACHMENT_BYTES) {
        setError(`"${file.name || 'That file'}" is too big — attachments are limited to 18 MB per message`)
        rejected = true
        continue
      }
      pendingBytes.current += file.size
      const id = nextId.current++
      // Keep the full data URL (e.g. "data:image/jpeg;base64,..."). The server
      // splits off the content type for local storage and the bare base64 for
      // signal-cli. Sending only the bare base64 lost the MIME type, so the
      // sender's own copy rendered as a non-image attachment.
      readAsDataUrl(file).then(
        (dataUrl) => {
          setPending((prev) => [...prev, { id, name: file.name || 'Pasted image', contentType: file.type, size: file.size, dataUrl }])
          // Reads resolve after the loop: don't wipe a sibling's "too big" message.
          if (!rejected) setError(null)
        },
        () => {
          pendingBytes.current -= file.size
          setError(`Couldn't read "${file.name || 'that file'}"`)
        },
      )
    }
  }
  useImperativeHandle(ref, () => ({ addFiles }))

  function removePending(id: number): void {
    const gone = pending.find((p) => p.id === id)
    if (gone) pendingBytes.current -= gone.size
    setPending((prev) => prev.filter((p) => p.id !== id))
  }

  async function send(): Promise<void> {
    const t = text.trim()
    const attachments = isEditing ? [] : pending
    if (!t && attachments.length === 0) return
    try {
      if (isEditing && editing && onSubmitEdit) {
        await onSubmitEdit(editing.timestamp, t)
        setText('')
        setError(null)
        onCancelEdit?.()
      } else {
        const quote = replyTo ? { authorId: replyTo.authorId, timestamp: replyTo.timestamp } : undefined
        await onSend(t, attachments.length > 0 ? attachments.map((p) => p.dataUrl) : undefined, quote)
        setText('')
        setError(null)
        if (attachments.length > 0) {
          const sentIds = new Set(attachments.map((p) => p.id))
          setPending((prev) => prev.filter((p) => !sentIds.has(p.id)))
          pendingBytes.current -= attachments.reduce((n, p) => n + p.size, 0)
        }
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
    addFiles(Array.from(e.target.files ?? []))
    e.target.value = ''
  }
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>): void {
    // Pasting a screenshot/copied image queues it; pasting text is untouched.
    const files = Array.from(e.clipboardData.files)
    if (files.length === 0 || isEditing) return
    e.preventDefault()
    addFiles(files)
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
      {pending.length > 0 && !isEditing ? (
        <ul className={styles.pending} aria-label="Attachments to send">
          {pending.map((p) => (
            <li key={p.id} className={styles.chip}>
              {p.contentType.startsWith('image/')
                ? <img className={styles.thumb} src={p.dataUrl} alt={p.name} />
                : <span className={styles.chipName}>📎 {p.name}</span>}
              <button type="button" className={styles.chipRemove} aria-label={`Remove ${p.name}`} onClick={() => removePending(p.id)}>×</button>
            </li>
          ))}
        </ul>
      ) : null}
      <button className={styles.attach} onClick={onAttachClick} aria-label="Attach file" disabled={isEditing}>📎</button>
      <input
        ref={fileInputRef}
        className={styles.fileInput}
        type="file"
        multiple
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
        value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste}
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
