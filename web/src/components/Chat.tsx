import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Conversation, Message } from '../api/types'
import { useLiveSocket } from '../api/live'
import { ConversationList } from './ConversationList'
import { Thread } from './Thread'
import { Composer } from './Composer'
import styles from './Chat.module.css'

export function Chat(): React.JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])

  const loadConversations = useCallback(async () => {
    setConversations(await api.get<Conversation[]>('/api/conversations'))
  }, [])
  const loadThread = useCallback(async (id: string) => {
    const res = await api.get<{ messages: Message[] }>(`/api/conversations/${encodeURIComponent(id)}/messages?limit=200`)
    setMessages([...res.messages].reverse()) // API returns newest-first; show oldest-first
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
      if (ev.type === 'message' && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('New message')
      }
    }
  })

  const onSend = useCallback(async (text: string) => {
    if (!selected) return
    const conv = conversations.find((c) => c.id === selected)
    await api.post('/api/send', { conversationId: selected, type: conv?.type ?? 'dm', message: text })
    await loadThread(selected)
    await loadConversations()
  }, [selected, conversations, loadThread, loadConversations])

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <ConversationList conversations={conversations} selectedId={selected} onSelect={setSelected} />
      </aside>
      <main className={styles.main}>
        {selected ? (
          <>
            <Thread messages={messages} />
            <Composer onSend={onSend} />
          </>
        ) : (
          <div className={styles.empty}>Select a conversation</div>
        )}
      </main>
    </div>
  )
}
