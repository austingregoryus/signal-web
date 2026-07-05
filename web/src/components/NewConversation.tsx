import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import styles from './NewConversation.module.css'

export interface StartResult {
  conversationId: string
}

/**
 * Modal that starts a brand-new DM by phone number. On submit we POST /api/start,
 * which resolves the recipient's UUID (so future inbound replies thread under
 * the same conversation) and sends the first message.
 */
export function NewConversation({
  onClose,
  onStarted,
}: {
  onClose: () => void
  onStarted: (conversationId: string) => void
}): React.JSX.Element {
  const [recipient, setRecipient] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const firstInput = useRef<HTMLInputElement | null>(null)

  // Focus the first field on open; close on Escape; lock background scroll.
  useEffect(() => {
    firstInput.current?.focus()
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const r = recipient.trim()
    if (!r) { setError('Enter a phone number'); return }
    if (!/^\+[1-9]\d{6,14}$/.test(r)) {
      setError('Use E.164 format, e.g. +15551234567')
      return
    }
    const msg = message.trim()
    if (!msg) {
      setError('Enter a first message')
      return
    }
    setSending(true)
    setError(null)
    try {
      const res = await api.post<StartResult>('/api/start', {
        recipient: r,
        displayName: displayName.trim() || undefined,
        message: msg,
      })
      onStarted(res.conversationId)
    } catch (err) {
      setError(err instanceof ApiError ? `Couldn't start (${err.status})` : "Couldn't start — try again")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="New conversation" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>New conversation</h2>
          <button type="button" className={styles.closeBtn} aria-label="Close" onClick={onClose}>×</button>
        </div>
        <form className={styles.form} onSubmit={(e) => void submit(e)}>
          <label className={styles.field}>
            <span className={styles.label}>Phone number</span>
            <input
              ref={firstInput}
              className={styles.input}
              type="tel"
              placeholder="+15551234567"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Name (optional)</span>
            <input
              className={styles.input}
              type="text"
              placeholder="What to call this contact"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>First message</span>
            <textarea
              className={styles.input}
              rows={2}
              placeholder="Type a message…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          {error ? <span role="alert" className={styles.error}>{error}</span> : null}
          <button type="submit" className={styles.submit} disabled={sending}>
            {sending ? 'Starting…' : 'Start conversation'}
          </button>
        </form>
      </div>
    </div>
  )
}
