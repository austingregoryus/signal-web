export interface Conversation { id: string; type: 'dm' | 'group'; displayName: string | null; avatarPath: string | null; lastActivity: number }
export interface Reaction { reactorId: string; emoji: string; timestamp: number }
export interface Receipt { recipientId: string; type: 'delivery' | 'read' | 'viewed'; timestamp: number }
export interface AttachmentMeta { id: string; contentType: string | null; filename: string | null }
export interface Message {
  id: number; conversationId: string; authorId: string; authorNumber: string | null
  timestamp: number; direction: 'in' | 'out'; body: string | null
  editedTimestamp: number | null; deleted: 0 | 1
  reactions: Reaction[]; receipts: Receipt[]; attachments: AttachmentMeta[]
}
export interface LoginResult { ok: boolean; webauthnRequired: boolean }
