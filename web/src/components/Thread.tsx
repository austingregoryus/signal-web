import { useEffect, useMemo, useRef } from 'react'
import type { Message as Msg } from '../api/types'
import { Message } from './Message'
import styles from './Thread.module.css'

export function Thread({
  messages, onReact, onReply, typing,
}: {
  messages: Msg[]
  onReact?: (m: Msg, emoji: string) => void
  onReply?: (m: Msg) => void
  typing?: boolean
}): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView?.() }, [messages.length, typing])
  // Lookup of (authorId, timestamp) -> message so a reply can render a preview
  // of the message it quotes. Keyed on the same identity the DB uses.
  const quoteOf = useMemo(() => {
    const map = new Map<string, Msg>()
    for (const m of messages) map.set(`${m.authorId}:${m.timestamp}`, m)
    return (authorId: string, timestamp: number) => map.get(`${authorId}:${timestamp}`)
  }, [messages])
  return (
    <div className={styles.thread}>
      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const compact = Boolean(
          prev && prev.direction === m.direction && prev.authorId === m.authorId && m.timestamp - prev.timestamp < 60_000,
        )
        return (
          <Message
            key={m.id}
            m={m}
            compact={compact}
            onReact={onReact ? (emoji) => onReact(m, emoji) : undefined}
            onReply={onReply}
            quoteOf={quoteOf}
          />
        )
      })}
      {typing ? (
        <div className={styles.typingRow}>
          <div className={styles.typingBubble}>…</div>
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  )
}
