import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import styles from './Composer.module.css'

export function Composer({
  onSend,
}: {
  onSend: (text: string, base64Attachments?: string[]) => void | Promise<void>
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function send(): Promise<void> {
    const t = text.trim()
    if (!t) return
    try {
      await onSend(t)
      setText('')
      setError(null)
    } catch {
      setError("Couldn't send — try again")
    }
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
  }
  function onAttachClick(): void {
    fileInputRef.current?.click()
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
  return (
    <div className={styles.bar}>
      <button className={styles.attach} onClick={onAttachClick} aria-label="Attach file">📎</button>
      <input
        ref={fileInputRef}
        className={styles.fileInput}
        type="file"
        aria-label="Attachment file"
        onChange={onFileChange}
      />
      <textarea
        className={styles.box} rows={1} placeholder="Message" aria-label="Message"
        value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
      />
      <button className={styles.send} onClick={() => void send()} aria-label="Send">➤</button>
      {error && <span role="alert" className={styles.error}>{error}</span>}
    </div>
  )
}
