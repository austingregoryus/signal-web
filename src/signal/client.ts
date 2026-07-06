import { toSendGroupId } from '../store/groupId'

export interface SignalClientOptions {
  apiUrl: string
  number: string
  fetchImpl?: typeof fetch
}

export interface SendInput {
  recipients?: string[]
  groupId?: string
  message?: string
  base64Attachments?: string[]
  quoteTimestamp?: number
  quoteAuthor?: string
}

export interface Contact {
  number?: string
  uuid?: string
  name?: string
  profileName?: string
}

export class SignalClient {
  private readonly fetchImpl: typeof fetch
  constructor(private readonly opts: SignalClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  private url(path: string): string {
    return `${this.opts.apiUrl}${path}`
  }

  private async post(path: string, body: unknown, label: string): Promise<unknown> {
    const res = await this.fetchImpl(this.url(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${label} failed: ${res.status}`)
    return res.status === 204 ? undefined : res.json().catch(() => undefined)
  }

  async sendMessage(input: SendInput): Promise<{ timestamp: number }> {
    const recipients = input.groupId ? [toSendGroupId(input.groupId)] : (input.recipients ?? [])
    const body: Record<string, unknown> = {
      number: this.opts.number,
      recipients,
      message: input.message ?? '',
    }
    if (input.base64Attachments?.length) body.base64_attachments = input.base64Attachments
    if (input.quoteTimestamp) {
      body.quote_timestamp = input.quoteTimestamp
      body.quote_author = input.quoteAuthor
    }
    const json = (await this.post('/v2/send', body, 'send')) as { timestamp?: number } | undefined
    return { timestamp: json?.timestamp ?? 0 }
  }

  /**
   * Edit a previously-sent message. signal-cli implements editing as a `/v2/send`
   * call carrying the new text plus the original message's timestamp as
   * `edit_timestamp`. Only your own outgoing messages can be edited.
   */
  async editMessage(input: {
    recipient?: string
    groupId?: string
    targetTimestamp: number
    message: string
  }): Promise<void> {
    const recipients = input.groupId ? [toSendGroupId(input.groupId)] : (input.recipient ? [input.recipient] : [])
    await this.post('/v2/send', {
      number: this.opts.number,
      recipients,
      message: input.message,
      edit_timestamp: input.targetTimestamp,
    }, 'edit')
  }

  async sendReaction(input: {
    recipient?: string
    groupId?: string
    reaction: string
    targetAuthor: string
    targetTimestamp: number
    remove?: boolean
  }): Promise<void> {
    await this.post(`/v1/reactions/${encodeURIComponent(this.opts.number)}`, {
      recipient: input.groupId ? toSendGroupId(input.groupId) : input.recipient,
      reaction: input.reaction,
      target_author: input.targetAuthor,
      timestamp: input.targetTimestamp,
      remove: input.remove ?? false,
    }, 'reaction')
  }

  async sendReceipt(input: { recipient: string; targetTimestamp: number; type: 'read' | 'viewed' }): Promise<void> {
    await this.post(`/v1/receipts/${encodeURIComponent(this.opts.number)}`, {
      recipient: input.recipient,
      receipt_type: input.type,
      timestamp: input.targetTimestamp,
    }, 'receipt')
  }

  async sendTyping(input: { recipient?: string; groupId?: string; stop?: boolean }): Promise<void> {
    const res = await this.fetchImpl(this.url(`/v1/typing-indicator/${encodeURIComponent(this.opts.number)}`), {
      method: input.stop ? 'DELETE' : 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient: input.groupId ? toSendGroupId(input.groupId) : input.recipient }),
    })
    if (!res.ok) throw new Error(`typing failed: ${res.status}`)
  }

  async fetchAttachment(id: string): Promise<{ contentType: string; bytes: Buffer }> {
    const res = await this.fetchImpl(this.url(`/v1/attachments/${encodeURIComponent(id)}`))
    if (!res.ok) throw new Error(`attachment fetch failed: ${res.status}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    return { contentType: res.headers.get('content-type') ?? 'application/octet-stream', bytes }
  }

  async listContacts(): Promise<Contact[]> {
    const res = await this.fetchImpl(this.url(`/v1/contacts/${encodeURIComponent(this.opts.number)}`))
    if (!res.ok) throw new Error(`contacts failed: ${res.status}`)
    return (await res.json()) as Contact[]
  }

  /**
   * Resolve a phone number to its Signal UUID. Conversation ids are UUID-based
   * for inbound messages (signal-cli always supplies sourceUuid), so starting
   * a new conversation by UUID — rather than the raw number — keeps the user's
   * outgoing thread and the contact's later replies under one conversation.
   * Returns null if the number isn't a known contact (caller falls back to the
   * number itself).
   */
  async resolveUuid(number: string): Promise<string | null> {
    try {
      const contacts = await this.listContacts()
      const hit = contacts.find((c) => c.number === number)
      // signal-cli can return a contact entry with an empty/absent uuid when
      // the number isn't registered yet — treat that as "not resolved" so the
      // caller falls back to the raw number instead of creating a conversation
      // with an empty id.
      const uuid = hit?.uuid
      return uuid && uuid.length > 0 ? uuid : null
    } catch {
      return null
    }
  }

  async listGroups(): Promise<Array<{ id: string; name?: string }>> {
    const res = await this.fetchImpl(this.url(`/v1/groups/${encodeURIComponent(this.opts.number)}`))
    if (!res.ok) throw new Error(`groups failed: ${res.status}`)
    return (await res.json()) as Array<{ id: string; name?: string }>
  }

  async getLinkingQr(deviceName: string): Promise<{ contentType: string; bytes: Buffer }> {
    const res = await this.fetchImpl(
      this.url(`/v1/qrcodelink?device_name=${encodeURIComponent(deviceName)}`),
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`qrcodelink failed: ${res.status} ${detail.slice(0, 300)}`.trim())
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    return { contentType: res.headers.get('content-type') ?? 'image/png', bytes }
  }

  async getAccountUuid(): Promise<string | null> {
    try {
      const res = await this.fetchImpl(this.url('/v1/accounts'))
      if (!res.ok) return null
      const data = (await res.json()) as unknown
      if (!Array.isArray(data)) return null
      for (const entry of data) {
        if (entry && typeof entry === 'object' && 'number' in entry) {
          const e = entry as { number?: string; uuid?: string }
          if (e.number === this.opts.number && e.uuid) return e.uuid
        }
      }
      return null // array-of-strings shape exposes no uuid
    } catch {
      return null
    }
  }
}
