import { useEffect, useMemo, useRef } from 'react'
import type { Message as Msg } from '../api/types'
import { Message } from './Message'
import styles from './Thread.module.css'

export function Thread({
  conversationId = null, messages, onReact, onReply, onEdit, hasMore, loadingMore, onLoadMore, typing,
  isGroup = false, resolveName, highlightKey = null,
}: {
  conversationId?: string | null
  messages: Msg[]
  onReact?: (m: Msg, emoji: string) => void
  onReply?: (m: Msg) => void
  onEdit?: (m: Msg) => void
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: (beforeTimestamp: number) => void | Promise<unknown>
  /** Typing indicator: a sender name (string), true (generic), or null. */
  typing?: string | null
  /** Group context — show sender labels on inbound messages. */
  isGroup?: boolean
  /** Resolve an author id/number to a display name (for group sender labels). */
  resolveName?: (authorId: string, authorNumber: string | null) => string | null
  /** "authorId:timestamp" of a message to scroll to and flash (from search). */
  highlightKey?: string | null
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const prevHeightRef = useRef<number | null>(null)
  const loadingRef = useRef(false)
  // Track which conversation the user is viewing. When it changes, we treat the
  // next render as "just opened" and force-scroll to the bottom — otherwise the
  // container defaults to scrollTop=0 (the oldest message), which looks broken.
  const convRef = useRef<string | null>(null)
  const justOpenedRef = useRef(true)

  // Mark "just opened" whenever the conversation id changes.
  useEffect(() => {
    if (convRef.current !== conversationId) {
      convRef.current = conversationId
      justOpenedRef.current = true
    }
  }, [conversationId])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // Prepended history landing: restore the user's prior scroll position.
    if (prevHeightRef.current != null) {
      el.scrollTop = el.scrollHeight - prevHeightRef.current
      prevHeightRef.current = null
      return
    }
    // Just opened this conversation: always jump to bottom. But only clear the
    // flag once messages are actually present (the first render may run before
    // the async loadThread resolves, with an empty list and equal scrollHeight
    // — stay "just opened" until there's something to scroll to).
    if (justOpenedRef.current) {
      if (messages.length === 0) return
      el.scrollTop = el.scrollHeight
      justOpenedRef.current = false
      return
    }
    // Otherwise a new message arrived — stick to the bottom only if the user is
    // already near it (don't yank them down while reading history).
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages.length, typing])

  // Jump to the highlighted message once it's loaded (it may take a few pages
  // of history). Runs after the bottom-scroll above, so it wins; only once per key.
  const jumpedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!highlightKey) { jumpedRef.current = null; return }
    if (jumpedRef.current === highlightKey) return
    const el = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-msg-key]') ?? [])
      .find((n) => n.dataset.msgKey === highlightKey)
    if (!el) return
    jumpedRef.current = highlightKey
    justOpenedRef.current = false
    el.scrollIntoView?.({ block: 'center' })
  }, [highlightKey, messages])

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
            showSender={isGroup && m.direction === 'in'}
            resolveName={resolveName}
            highlighted={highlightKey === `${m.authorId}:${m.timestamp}`}
          />
        )
      })}
      {typing ? (
        <div className={styles.typingRow}>
          <div className={styles.typingBubble}>
            {typeof typing === 'string' ? `${typing} is typing…` : '…'}
          </div>
        </div>
      ) : null}
      <div ref={(el) => { /* bottom anchor; not strictly needed since we scroll the container */ if (!el) return }} />
    </div>
  )
}
