export interface Conversation {
  id: string; type: 'dm' | 'group'; displayName: string | null; avatarPath: string | null
  lastActivity: number; unreadCount: number
  /** Disappearing-message timer for new messages; 0 = off. */
  expireTimerMs?: number
}
export interface Reaction { reactorId: string; emoji: string; timestamp: number }
export interface Receipt { recipientId: string; type: 'delivery' | 'read' | 'viewed'; timestamp: number }
export interface AttachmentMeta { id: string; contentType: string | null; filename: string | null }
export interface Message {
  id: number; conversationId: string; authorId: string; authorNumber: string | null
  timestamp: number; direction: 'in' | 'out'; body: string | null
  editedTimestamp: number | null; deleted: 0 | 1
  /** When a disappearing message vanishes (epoch ms); null = never. */
  expiresAt?: number | null
  quoteAuthorId: string | null; quoteTimestamp: number | null
  reactions: Reaction[]; receipts: Receipt[]; attachments: AttachmentMeta[]
}
export interface LoginResult { ok: boolean; webauthnRequired: boolean }
/** A message matching a search, with the conversation it belongs to. */
export interface SearchHit {
  id: number; conversationId: string; authorId: string; timestamp: number; direction: 'in' | 'out'
  body: string | null; conversationName: string | null; conversationType: 'dm' | 'group' | null
}
