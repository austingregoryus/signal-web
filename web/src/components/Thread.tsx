import { useEffect, useMemo, useRef } from 'react'
import type { Message as Msg } from '../api/types'
import { Message } from './Message'
import styles from './Thread.module.css'

export function Thread({
  messages, onReact, onReply, onEdit, hasMore, loadingMore, onLoadMore, typing,
}: {
  messages: Msg[]
  onReact?: (m: Msg, emoji: string) => void
  onReply?: (m: Msg) => void
  onEdit?: (m: Msg) => void
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: (beforeTimestamp: number) => void | Promise<unknown>
  typing?: boolean
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const prevHeightRef = useRef<number | null>(null)
  const loadingRef = useRef(false)

  // Scroll to the bottom when a new message arrives (but NOT when the user has
  // scrolled up to read history — that would yank them down).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // If prepended history is landing (prevHeightRef set), restore position.
    if (prevHeightRef.current != null) {
      const restored = el.scrollHeight - prevHeightRef.current
      el.scrollTop = restored
      prevHeightRef.current = null
      return
    }
    // Otherwise stick to the bottom unless the user is scrolled up.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages.length, typing])

  // Detect scroll-to-top to load more history. Captures the height before the
  // async prepend so the effect above can restore the user's position.
  function onScroll(): void {
    const el = scrollRef.current
    if (!el || !onLoadMore || !hasMore || loadingMore || loadingRef.current) return
    if (el.scrollTop > 60) return
    const oldest = messages[0]
    if (!oldest) return
    loadingRef.current = true
    prevHeightRef.current = el.scrollHeight
    Promise.resolve(onLoadMore(oldest.timestamp)).finally(() => { loadingRef.current = false })
  }

  const quoteOf = useMemo(() => {
    const map = new Map<string, Msg>()
    for (const m of messages) map.set(`${m.authorId}:${m.timestamp}`, m)
    return (authorId: string, timestamp: number) => map.get(`${authorId}:${timestamp}`)
  }, [messages])

  return (
    <div className={styles.thread} ref={scrollRef} onScroll={onScroll}>
      {loadingMore ? <div className={styles.loadingMore}>Loading older messages…</div> : null}
      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const compact = Boolean(
          prev && prev.direction === m.direction && prev.authorId === m.authorId && m.timestamp - prev.timestamp < 60_000,
        )
        return (
          <Message
            key={`${m.authorId}:${m.timestamp}`}
            m={m}
            compact={compact}
            onReact={onReact ? (emoji) => onReact(m, emoji) : undefined}
            onReply={onReply}
            onEdit={onEdit}
            quoteOf={quoteOf}
          />
        )
      })}
      {typing ? (
        <div className={styles.typingRow}>
          <div className={styles.typingBubble}>…</div>
        </div>
      ) : null}
      <div ref={(el) => { /* bottom anchor; not strictly needed since we scroll the container */ if (!el) return }} />
    </div>
  )
}
