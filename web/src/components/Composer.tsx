import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import styles from './Composer.module.css'

export function Composer({
  onSend,
}: {
  onSend: (text: string, base64Attachments?: string[]) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function send(): void {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
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
        const base64 = result.slice(result.indexOf(',') + 1)
        onSend('', [base64])
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
      <button className={styles.send} onClick={send} aria-label="Send">➤</button>
    </div>
  )
}
