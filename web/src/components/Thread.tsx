import { useEffect, useRef } from 'react'
import type { Message as Msg } from '../api/types'
import { Message } from './Message'
import styles from './Thread.module.css'

export function Thread({ messages, onReact, typing }: { messages: Msg[]; onReact?: (m: Msg, emoji: string) => void; typing?: boolean }): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView?.() }, [messages.length, typing])
  return (
    <div className={styles.thread}>
      {messages.map((m) => <Message key={m.id} m={m} onReact={onReact ? (emoji) => onReact(m, emoji) : undefined} />)}
      {typing ? (
        <div className={styles.typingRow}>
          <div className={styles.typingBubble}>…</div>
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  )
}
