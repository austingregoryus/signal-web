import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Conversation, Message } from '../api/types'
import { useLiveSocket } from '../api/live'
import { ConversationList } from './ConversationList'
import { Thread } from './Thread'
import { Composer } from './Composer'
import { NewConversation } from './NewConversation'
import { avatarColor, initials } from './avatar'
import styles from './Chat.module.css'

export function Chat(): React.JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [typing, setTyping] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastSeenRef = useRef(0)

  const loadConversations = useCallback(async () => {
    const convs = await api.get<Conversation[]>('/api/conversations')
    setConversations(convs)
    for (const c of convs) {
      if (c.lastActivity > lastSeenRef.current) lastSeenRef.current = c.lastActivity
    }
  }, [])
  const loadThread = useCallback(async (id: string) => {
    const res = await api.get<{ messages: Message[] }>(`/api/conversations/${encodeURIComponent(id)}/messages?limit=200`)
    setMessages([...res.messages].reverse()) // API returns newest-first; show oldest-first
    for (const m of res.messages) {
      if (m.timestamp > lastSeenRef.current) lastSeenRef.current = m.timestamp
    }
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
      if (selected) void loadThread(selected)
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
    await loadThread(selected)
    await loadConversations()
  }, [selected, conversations, loadThread, loadConversations])

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
    await loadThread(selected)
  }, [selected, conversations, loadThread])

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
        <ConversationList conversations={conversations} selectedId={selected} onSelect={setSelected} />
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
            <Thread messages={messages} onReact={onReact} onReply={setReplyTo} typing={typing} />
            <Composer onSend={onSend} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />
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
    </div>
  )
}
