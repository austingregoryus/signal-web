import { useState, type KeyboardEvent } from 'react'
import styles from './Composer.module.css'

export function Composer({ onSend }: { onSend: (text: string) => void }): React.JSX.Element {
  const [text, setText] = useState('')
  function send(): void {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }
  return (
    <div className={styles.bar}>
      <textarea
        className={styles.box} rows={1} placeholder="Message" aria-label="Message"
        value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
      />
      <button className={styles.send} onClick={send} aria-label="Send">➤</button>
    </div>
  )
}
