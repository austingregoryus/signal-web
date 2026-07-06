import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Conversation, Message } from '../api/types'
import { useLiveSocket } from '../api/live'
import { ConversationList } from './ConversationList'
import { Thread } from './Thread'
import { Composer } from './Composer'
import { NewConversation } from './NewConversation'
import { ConfirmDialog } from './ConfirmDialog'
import { avatarColor, initials } from './avatar'
import styles from './Chat.module.css'

export function Chat(): React.JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [typing, setTyping] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastSeenRef = useRef(0)

  const loadConversations = useCallback(async () => {
    const convs = await api.get<Conversation[]>('/api/conversations')
    setConversations(convs)
    for (const c of convs) {
      if (c.lastActivity > lastSeenRef.current) lastSeenRef.current = c.lastActivity
    }
  }, [])
  const PAGE = 50
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadThread = useCallback(async (id: string) => {
    // Initial load: newest PAGE messages, oldest-first for display.
    const res = await api.get<{ messages: Message[] }>(`/api/conversations/${encodeURIComponent(id)}/messages?limit=${PAGE}`)
    const oldestFirst = [...res.messages].reverse()
    setMessages(oldestFirst)
    setHasMore(res.messages.length === PAGE) // a full page means there may be more
    for (const m of res.messages) {
      if (m.timestamp > lastSeenRef.current) lastSeenRef.current = m.timestamp
    }
  }, [])
  const loadMore = useCallback(async (id: string, beforeTimestamp: number): Promise<Message[]> => {
    // Fetch the next older page; returns the new messages so the caller can
    // preserve scroll position after prepending. newest-first from the API.
    setLoadingMore(true)
    try {
      const res = await api.get<{ messages: Message[] }>(`/api/conversations/${encodeURIComponent(id)}/messages?limit=${PAGE}&before=${beforeTimestamp}`)
      setHasMore(res.messages.length === PAGE)
      const oldestFirst = [...res.messages].reverse()
      setMessages((prev) => [...oldestFirst, ...prev])
      return oldestFirst
    } finally {
      setLoadingMore(false)
    }
  }, [])
  // Refresh just the newest page on a live event — append only genuinely new
  // messages (deduped by authorId+timestamp) so the user's scroll position and
  // already-loaded older messages are preserved. Replaces the full-reload that
  // would otherwise wipe pagination state.
  const refreshTail = useCallback(async (id: string) => {
    const res = await api.get<{ messages: Message[] }>(`/api/conversations/${encodeURIComponent(id)}/messages?limit=${PAGE}`)
    const newest = [...res.messages].reverse() // oldest-first
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => `${m.authorId}:${m.timestamp}`))
      const fresh = newest.filter((m) => !seen.has(`${m.authorId}:${m.timestamp}`))
      return fresh.length > 0 ? [...prev, ...fresh] : prev
    })
  }, [])

  useEffect(() => { void loadConversations() }, [loadConversations])
  useEffect(() => { if (selected) void loadThread(selected) }, [selected, loadThread])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])

  useLiveSocket((ev) => {
    if (ev.type === 'message' || ev.type === 'receipt') {
      void loadConversations()
      // Append only genuinely new messages; preserve pagination + scroll.
      if (selected) void refreshTail(selected)
      if (
        ev.type === 'message' &&
        ev.message === undefined &&
        document.hidden &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        new Notification('New message')
      }
    }
    if (ev.type === 'typing') {
      setTyping(true)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => setTyping(false), 4000)
    }
  }, () => lastSeenRef.current)

  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current) }, [])

  const onSend = useCallback(async (text: string, base64Attachments?: string[], quote?: { authorId: string; timestamp: number }) => {
    if (!selected) return
    const conv = conversations.find((c) => c.id === selected)
    await api.post('/api/send', {
      conversationId: selected,
      type: conv?.type ?? 'dm',
      message: text,
      base64Attachments,
      quoteTimestamp: quote?.timestamp,
      quoteAuthor: quote?.authorId,
    })
    if (quote) setReplyTo(null)
    await refreshTail(selected)
    await loadConversations()
  }, [selected, conversations, refreshTail, loadConversations])

  const onDelete = useCallback(async (conv: Conversation) => {
    await api.delete(`/api/conversations/${encodeURIComponent(conv.id)}`)
    if (selected === conv.id) setSelected(null)
    await loadConversations()
  }, [selected, loadConversations])

  const onSubmitEdit = useCallback(async (timestamp: number, text: string) => {
    if (!selected) return
    const conv = conversations.find((c) => c.id === selected)
    await api.post('/api/edit', {
      conversationId: selected,
      type: conv?.type ?? 'dm',
      targetTimestamp: timestamp,
      message: text,
    })
    await refreshTail(selected)
  }, [selected, conversations, refreshTail])

  const onReact = useCallback(async (m: Message, emoji: string) => {
    if (!selected) return
    const conv = conversations.find((c) => c.id === selected)
    await api.post('/api/react', {
      conversationId: selected,
      type: conv?.type ?? 'dm',
      targetAuthorId: m.authorId,
      targetTimestamp: m.timestamp,
      emoji,
    })
    await refreshTail(selected)
  }, [selected, conversations, refreshTail])

  const selectedConv = conversations.find((c) => c.id === selected) ?? null
  const showThreadOnMobile = Boolean(selected)

  return (
    <div className={`${styles.layout} ${showThreadOnMobile ? styles.threadActive : ''}`}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h1 className={styles.sidebarTitle}>Messages</h1>
          <button
            className={styles.newBtn}
            onClick={() => setShowNew(true)}
            aria-label="New conversation"
            title="New conversation"
          >
            +
          </button>
        </div>
        <ConversationList
          conversations={conversations}
          selectedId={selected}
          onSelect={setSelected}
          onDelete={setPendingDelete}
        />
      </aside>
      <main className={styles.main}>
        {selected ? (
          <>
            <div className={styles.threadHeader}>
              <button
                className={styles.backBtn}
                onClick={() => setSelected(null)}
                aria-label="Back to conversations"
              >
                ‹
              </button>
              <span
                className={styles.threadAvatar}
                style={{ background: avatarColor(selectedConv?.id ?? selected) }}
                aria-hidden
              >
                {initials(selectedConv?.displayName ?? null)}
              </span>
              <span className={styles.threadName}>{selectedConv?.displayName ?? selectedConv?.id ?? selected}</span>
            </div>
            <Thread
              messages={messages}
              onReact={onReact}
              onReply={(m) => { setReplyTo(m); setEditing(null) }}
              onEdit={(m) => { setEditing(m); setReplyTo(null) }}
              hasMore={hasMore}
              loadingMore={loadingMore}
              onLoadMore={selected ? (before) => loadMore(selected, before) : undefined}
              typing={typing}
            />
            <Composer
              onSend={onSend}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              editing={editing}
              onSubmitEdit={onSubmitEdit}
              onCancelEdit={() => setEditing(null)}
            />
          </>
        ) : (
          <div className={styles.empty}>Select a conversation</div>
        )}
      </main>
      {showNew ? (
        <NewConversation
          onClose={() => setShowNew(false)}
          onStarted={(conversationId) => {
            // Select optimistically so the thread opens immediately, then reload
            // the list so the new conversation sorts to the top. Selection must
            // not depend on the reload completing (a swallowed rejection there
            // would otherwise leave the user on "Select a conversation").
            setShowNew(false)
            setSelected(conversationId)
            void loadConversations()
          }}
        />
      ) : null}
      {pendingDelete ? (
        <ConfirmDialog
          title="Delete conversation?"
          message={`This permanently removes "${pendingDelete.displayName ?? pendingDelete.id}" and all its messages from this device. The other person keeps their copy.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => {
            const conv = pendingDelete
            setPendingDelete(null)
            void onDelete(conv)
          }}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  )
}
