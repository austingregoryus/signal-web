import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { api } from '../api/client'
import type { Conversation, Message, SearchHit } from '../api/types'
import { useLiveSocket } from '../api/live'
import { ConversationList } from './ConversationList'
import { Thread } from './Thread'
import { Composer, type ComposerHandle } from './Composer'
import { NewConversation } from './NewConversation'
import { ConfirmDialog } from './ConfirmDialog'
import { ConversationInfo } from './ConversationInfo'
import { Settings } from './Settings'
import { SearchResults } from './SearchResults'
import { useToast } from './Toast'
import { avatarColor, initials } from './avatar'
import { formatTimer } from './formatTimer'
import styles from './Chat.module.css'

export function Chat({ onLogout }: { onLogout?: () => void | Promise<void> } = {}): React.JSX.Element {
  const toast = useToast()
  const [showSettings, setShowSettings] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [typing, setTyping] = useState<string | null>(null) // sender name or null
  const [showNew, setShowNew] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const composerRef = useRef<ComposerHandle | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0) // dragenter/leave fire for every child; count to know when we really left
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  // The message to scroll to and flash after picking a search result.
  const [highlight, setHighlight] = useState<{ conversationId: string; key: string } | null>(null)
  const highlightPages = useRef(0)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastSeenRef = useRef(0)
  // Mirror of `selected` for reading inside async callbacks without capturing
  // a stale closure (the live handler + loadThread bail-out both need the
  // freshest value).
  const selectedRef = useRef<string | null>(null)
  useEffect(() => { selectedRef.current = selected }, [selected])

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
    // Initial load: newest PAGE messages, oldest-first for display. Capture the
    // id so a slow response for a previously-selected conversation can't land
    // its messages under the now-current one.
    const res = await api.get<{ messages: Message[] }>(`/api/conversations/${encodeURIComponent(id)}/messages?limit=${PAGE}`)
    if (selectedRef.current !== id) return // user has moved on; drop the stale result
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
      // Dedupe by server id in case the cursor overlaps already-loaded messages.
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id))
        const fresh = oldestFirst.filter((m) => !seen.has(m.id))
        return fresh.length > 0 ? [...fresh, ...prev] : prev
      })
      return oldestFirst
    } finally {
      setLoadingMore(false)
    }
  }, [])
  // Refresh the newest page on a live event. Merge by server `id` rather than
  // authorId+timestamp: an edited message or one gaining a reaction/receipt
  // keeps the same id, so we REPLACE it (so edits/reactions/read-receipts
  // propagate live) and APPEND only genuinely new ids. Preserves the user's
  // scroll position and already-loaded older history.
  const refreshTail = useCallback(async (id: string) => {
    const res = await api.get<{ messages: Message[] }>(`/api/conversations/${encodeURIComponent(id)}/messages?limit=${PAGE}`)
    if (selectedRef.current !== id) return // user has moved on
    const newest = [...res.messages].reverse() // oldest-first
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]))
      let changed = false
      for (const m of newest) {
        if (byId.has(m.id)) {
          if (byId.get(m.id) !== m) { byId.set(m.id, m); changed = true }
        } else {
          byId.set(m.id, m); changed = true
        }
      }
      if (!changed) return prev
      // Preserve order: keep prev's id ordering, append new ids at the end
      // (they're newer than the loaded tail), with replaced values slotted in.
      const ordered = prev.map((m) => byId.get(m.id) ?? m)
      const prevIds = new Set(prev.map((m) => m.id))
      for (const m of newest) if (!prevIds.has(m.id)) ordered.push(m)
      return ordered
    })
  }, [])

  useEffect(() => {
    if (!highlight || highlight.conversationId !== selected || loadingMore) return
    // Wait for this conversation's messages (the previous thread's may still be showing).
    if (messages.length === 0 || messages[0].conversationId !== selected) return
    if (messages.some((m) => `${m.authorId}:${m.timestamp}` === highlight.key)) return
    if (!hasMore || highlightPages.current >= 20) return // give up quietly; the thread is still open
    highlightPages.current++
    void loadMore(selected, messages[0].timestamp)
  }, [highlight, selected, messages, hasMore, loadingMore, loadMore])

  useEffect(() => { void loadConversations() }, [loadConversations])
  useEffect(() => { if (selected) void loadThread(selected) }, [selected, loadThread])
  useEffect(() => { setShowInfo(false); setReplyTo(null); setEditing(null) }, [selected])
  // Mark the opened conversation read locally + refresh the sidebar so the
  // unread badge clears immediately.
  useEffect(() => {
    if (!selected) return
    void api.post(`/api/conversations/${encodeURIComponent(selected)}/mark-read`).then(() => loadConversations())
  }, [selected, loadConversations])

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])

  const connection = useLiveSocket((ev) => {
    if (ev.type === 'message' || ev.type === 'reaction' || ev.type === 'receipt') {
      void loadConversations()
      // Refresh the open thread when the event is FOR it. When the event carries
      // a conversation id, only refresh on an exact match (avoids wasted fetches
      // for other-conversation messages). When it has no id (older bridge or an
      // unattributable event), fall back to refreshing the open thread — the
      // common case is that the event IS in the open thread.
      const targetId = typeof ev.conversationId === 'string' ? ev.conversationId : null
      const current = selectedRef.current
      if (current && (targetId === null || targetId === current)) void refreshTail(current)
      if (
        ev.type === 'message' &&
        document.hidden &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        // Richer body: "Sender: preview" (like Signal itself shows).
        const sender = typeof ev.sender === 'string' && ev.sender ? ev.sender : 'New message'
        const preview = typeof ev.preview === 'string' && ev.preview ? ev.preview : ''
        const title = preview ? sender : 'New message'
        const body = preview || (sender !== 'New message' ? sender : undefined)
        new Notification(title, body ? { body } : undefined)
      }
    }
    if (ev.type === 'typing') {
      // Resolve the typing sender's name; null falls back to a generic indicator.
      const source = typeof ev.source === 'string' ? ev.source : null
      const name = source ? (resolveName(source, source) ?? source) : null
      setTyping(name)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => setTyping(null), 4000)
    }
  }, () => lastSeenRef.current)

  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current) }, [])

  // Debounced search. A newer query supersedes any response still in flight.
  const searchQuery = query.trim()
  useEffect(() => {
    if (searchQuery.length < 2) { setResults([]); setSearching(false); return }
    let stale = false
    setSearching(true)
    const t = setTimeout(() => {
      api.get<{ results: SearchHit[] }>(`/api/search?q=${encodeURIComponent(searchQuery)}`)
        .then((res) => { if (!stale) setResults(res.results) })
        .catch(() => { if (!stale) setResults([]) })
        .finally(() => { if (!stale) setSearching(false) })
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [searchQuery])

  const openConversation = useCallback((id: string) => {
    setHighlight(null)
    setSelected(id)
  }, [])
  const openSearchHit = useCallback((hit: SearchHit) => {
    highlightPages.current = 0
    setHighlight({ conversationId: hit.conversationId, key: `${hit.authorId}:${hit.timestamp}` })
    setSelected(hit.conversationId)
  }, [])

  // Disappearing messages: drop them from view once their timer runs out. The
  // server stops returning them and sweeps them, but refreshTail only ever
  // adds/replaces, so already-loaded ones must be removed here.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now()
      setMessages((prev) => {
        const kept = prev.filter((m) => !m.expiresAt || m.expiresAt > now)
        return kept.length === prev.length ? prev : kept
      })
    }, 10_000)
    return () => clearInterval(t)
  }, [])

  const onSend = useCallback(async (text: string, base64Attachments?: string[], quote?: { authorId: string; timestamp: number }) => {
    if (!selected) return
    const conv = conversations.find((c) => c.id === selected)
    try {
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
    } catch {
      toast.error("Couldn't send the message — try again")
      throw new Error('send failed') // let the Composer clear its own error UI too
    }
  }, [selected, conversations, refreshTail, loadConversations, toast])

  const onDelete = useCallback(async (conv: Conversation) => {
    try {
      await api.delete(`/api/conversations/${encodeURIComponent(conv.id)}`)
      if (selected === conv.id) setSelected(null)
      await loadConversations()
    } catch {
      toast.error("Couldn't delete the conversation — try again")
    }
  }, [selected, loadConversations, toast])

  const onSubmitEdit = useCallback(async (timestamp: number, text: string) => {
    if (!selected) return
    const conv = conversations.find((c) => c.id === selected)
    try {
      await api.post('/api/edit', {
        conversationId: selected,
        type: conv?.type ?? 'dm',
        targetTimestamp: timestamp,
        message: text,
      })
      await refreshTail(selected)
    } catch {
      toast.error("Couldn't save the edit — try again")
      throw new Error('edit failed')
    }
  }, [selected, conversations, refreshTail, toast])

  const onReact = useCallback(async (m: Message, emoji: string) => {
    if (!selected) return
    const conv = conversations.find((c) => c.id === selected)
    try {
      await api.post('/api/react', {
        conversationId: selected,
        type: conv?.type ?? 'dm',
        targetAuthorId: m.authorId,
        targetTimestamp: m.timestamp,
        emoji,
      })
      await refreshTail(selected)
    } catch {
      toast.error("Couldn't add the reaction — try again")
    }
  }, [selected, conversations, refreshTail, toast])

  // A file dropped outside the thread (sidebar, empty pane) would otherwise make
  // the browser open it in place of the app. The thread's own handlers run first.
  useEffect(() => {
    const guard = (e: globalThis.DragEvent): void => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', guard)
    window.addEventListener('drop', guard)
    return () => {
      window.removeEventListener('dragover', guard)
      window.removeEventListener('drop', guard)
    }
  }, [])

  // Drag-and-drop files anywhere on the open thread to queue them in the composer.
  const isFileDrag = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const dropHandlers = selected ? {
    onDragEnter: (e: DragEvent) => { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth.current++; setDragging(true) },
    onDragOver: (e: DragEvent) => { if (isFileDrag(e)) e.preventDefault() }, // required for drop to fire
    onDragLeave: (e: DragEvent) => { if (!isFileDrag(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false) },
    onDrop: (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      composerRef.current?.addFiles(Array.from(e.dataTransfer.files))
    },
  } : {}

  const selectedConv = conversations.find((c) => c.id === selected) ?? null
  const showThreadOnMobile = Boolean(selected)
  // Resolve a group sender to a display name: look the author up in the loaded
  // conversations by id (uuid) or number, preferring a real display name.
  const resolveName = useCallback((authorId: string, authorNumber: string | null): string | null => {
    const byId = conversations.find((c) => c.id === authorId)
    if (byId?.displayName) return byId.displayName
    if (authorNumber) {
      const byNumber = conversations.find((c) => c.id === authorNumber)
      if (byNumber?.displayName) return byNumber.displayName
    }
    return null
  }, [conversations])

  return (
    <div className={`${styles.layout} ${showThreadOnMobile ? styles.threadActive : ''}`}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <h1 className={styles.sidebarTitle}>
            Messages
            <span
              className={`${styles.connDot} ${styles[`conn_${connection}`]}`}
              title={connection === 'connected' ? 'Connected' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
              aria-label={connection === 'connected' ? 'Connected' : 'Disconnected — reconnecting'}
            />
          </h1>
          <button
            className={styles.settingsBtn}
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            title="Settings"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </button>
          <button
            className={styles.newBtn}
            onClick={() => setShowNew(true)}
            aria-label="New conversation"
            title="New conversation"
          >
            <svg className={styles.newBtnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
        <div className={styles.searchBar}>
          <input
            className={styles.search}
            type="search"
            placeholder="Search messages"
            aria-label="Search messages"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }}
          />
        </div>
        {searchQuery.length >= 2 ? (
          <SearchResults query={searchQuery} results={results} loading={searching} onPick={openSearchHit} />
        ) : (
          <ConversationList
            conversations={conversations}
            selectedId={selected}
            onSelect={openConversation}
            onDelete={setPendingDelete}
          />
        )}
      </aside>
      <main className={`${styles.main} ${dragging ? styles.dragging : ''}`} {...dropHandlers}>
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
              {selectedConv?.expireTimerMs ? (
                <span className={styles.timerLabel} title="New messages in this chat disappear after this long">
                  ⏱ {formatTimer(selectedConv.expireTimerMs)}
                </span>
              ) : null}
              <button
                className={styles.infoBtn}
                onClick={() => setShowInfo(true)}
                aria-label="Conversation info"
                title="Info"
              >
                ⓘ
              </button>
            </div>
            <Thread
              conversationId={selected}
              messages={messages}
              onReact={onReact}
              onReply={(m) => { setReplyTo(m); setEditing(null) }}
              onEdit={(m) => { setEditing(m); setReplyTo(null) }}
              hasMore={hasMore}
              loadingMore={loadingMore}
              onLoadMore={selected ? (before) => loadMore(selected, before) : undefined}
              typing={typing}
              isGroup={selectedConv?.type === 'group'}
              resolveName={resolveName}
              highlightKey={highlight?.conversationId === selected ? highlight.key : null}
            />
            <Composer
              ref={composerRef}
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
            openConversation(conversationId)
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
      {showSettings ? (
        <Settings
          onClose={() => setShowSettings(false)}
          onLogout={async () => { setShowSettings(false); await onLogout?.() }}
        />
      ) : null}
      {showInfo && selected ? (
        <ConversationInfo
          conversationId={selected}
          initialName={selectedConv?.displayName ?? null}
          onClose={() => setShowInfo(false)}
          onRenamed={() => { void loadConversations() }}
        />
      ) : null}
    </div>
  )
}
