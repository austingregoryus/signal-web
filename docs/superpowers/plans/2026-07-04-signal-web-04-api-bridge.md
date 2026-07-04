# Signal Web — Milestone 4: Web API & Real-Time Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the store + adapter + auth into a working service: a resilient live bridge (signal-cli → ingest → browser), an authenticated browser WebSocket with cursor replay, a REST read/write API behind `requireAuth`, a profile/contact service for names & avatars, and a hardened attachment proxy.

**Architecture:** A composition root opens the encrypted store, builds a `SignalClient` (typed wrapper over signal-cli-rest-api REST), registers the M3 auth plugin (with `trustProxy`), starts the live bridge (M1 receiver → M2 `ingestEnvelope` → hub broadcast, now with reconnect/backoff/heartbeat), and mounts REST + a browser WS hub. Every outward call to signal-cli goes through `SignalClient`; every unit has a mockable seam so the backbone is unit-tested without a live daemon. Genuinely live paths (real sends, real attachment bytes) are flagged for manual verification against the linked device.

**Tech Stack:** Node 24 / TypeScript / Fastify 5 / `ws` / `@fastify/websocket` / Vitest. Reuses M1–M3 modules.

## Global Constraints

- **ESM + `moduleResolution: "Bundler"`**; strict TS; typecheck stays clean.
- **All auth-gated:** every `/api/*` route and the browser WS require a **full** session (`requireAuth`); non-GET requires CSRF; the WS upgrade enforces `isAllowedOrigin` (wire the guard deferred from M3) and a valid session cookie.
- **selfId consistency (spec §5.2):** the account's own `author_id` must be the same value used by `ingestEnvelope` for own-sent messages and receipt targets, and must match how *others* reference us (their reaction `targetAuthor` is our UUID). Resolve the account UUID at startup; if only the number is available, fall back to it and record the reaction-attach caveat.
- **Reconnect/replay (spec §5.2):** the signal-cli WS auto-reconnects with backoff + heartbeat; the store is the single source of truth; the browser WS replays from a cursor on (re)connect; ingestion is idempotent (M2), so redelivery is safe.
- **Attachment proxy hardening (spec §9):** opaque internal ids only (never client paths), verify the attachment belongs to a cached message, session-gated, encrypted at rest, size-capped, streamed.
- **Log hygiene (spec §9):** no message bodies, numbers, tokens, or attachment contents in logs.
- **Synced own-device edits:** per `docs/superpowers/DEFERRED.md`, handle `syncMessage.sentMessage.editMessage` in this milestone (extend the M2 parser).
- New app code under `src/app/`, `src/signal/`, `src/api/`. Tests mirror under `test/`.

## File Structure

- `src/config.ts` — extend `AppConfig` + `loadConfig` (store, auth, webauthn, origin, attachments).
- `src/signal/client.ts` — `SignalClient` (REST wrapper; injectable `fetch`).
- `src/signal/selfId.ts` — `resolveSelfId`.
- `src/signal/bridge.ts` — `LiveBridge` (receiver → ingest → hub), reconnect/backoff/heartbeat.
- `src/signal/reconnect.ts` — reconnect helper (backoff schedule) if extracted for testing.
- `src/api/hub.ts` — `BrowserHub` (connected clients, broadcast, cursor replay).
- `src/api/wsRoute.ts` — `registerBrowserWs` (auth + origin gated upgrade).
- `src/api/rest.ts` — `registerRestApi` (conversations, history, send, react, typing, attachments).
- `src/api/attachments.ts` — `AttachmentProxy`.
- `src/store/attachmentsBlob.ts` — encrypted-at-rest blob storage for attachment bytes.
- `src/profile/service.ts` — `ProfileService` (names/avatars refresh).
- `src/app/main.ts` — composition root (replaces `src/index.ts` wiring).

---

### Task 1: Extend config + `SignalClient` (REST wrapper)

**Files:**
- Modify: `src/config.ts`
- Create: `src/signal/client.ts`
- Test: `test/config.test.ts` (extend), `test/signal/client.test.ts`
- Modify: `package.json` (add `@fastify/websocket`)

**Interfaces:**
- `AppConfig` gains: `dbPath: string; dbKey: string; allowedOrigin: string; rpId: string; rpOrigin: string; attachmentDir: string; secureCookies: boolean; trustProxy: boolean; sessionTtlDays: number; sessionIdleDays: number`. `loadConfig` reads them from env with sane defaults; `dbKey` required (throws if missing) for the real run; `allowedOrigin`/`rpOrigin` default derived from a `PUBLIC_URL` env.
- `class SignalClient`:
  - `constructor(opts: { apiUrl: string; number: string; fetchImpl?: typeof fetch })`
  - `sendMessage(input: { recipients?: string[]; groupId?: string; message?: string; base64Attachments?: string[]; quoteTimestamp?: number; quoteAuthor?: string }): Promise<{ timestamp: number }>` — POST `/v2/send`.
  - `sendReaction(input: { recipient?: string; groupId?: string; reaction: string; targetAuthor: string; targetTimestamp: number; remove?: boolean }): Promise<void>` — POST `/v1/reactions/{number}`.
  - `sendReceipt(input: { recipient: string; targetTimestamp: number; type: 'read' | 'viewed' }): Promise<void>` — POST `/v1/receipts/{number}`.
  - `sendTyping(input: { recipient?: string; groupId?: string; stop?: boolean }): Promise<void>` — PUT/DELETE `/v1/typing-indicator/{number}`.
  - `fetchAttachment(id: string): Promise<{ contentType: string; bytes: Buffer }>` — GET `/v1/attachments/{id}`.
  - `listContacts(): Promise<Array<{ number?: string; uuid?: string; name?: string; profileName?: string }>>` — GET `/v1/contacts/{number}`.
  - `listGroups(): Promise<Array<{ id: string; name?: string }>>` — GET `/v1/groups/{number}`.
  - `getAccountUuid(): Promise<string | null>` — GET `/v1/accounts` (or identities); returns the account's own uuid if exposed, else null.
  - All methods throw on non-2xx with a message that never includes bodies/numbers.

- [ ] **Step 1: Add dependency** — `npm install @fastify/websocket`. Expected: installs (pure JS). Report BLOCKED on failure.

- [ ] **Step 2: Extend config** — in `src/config.ts`, widen `AppConfig` and `loadConfig` as above. Complete code:

```ts
export interface AppConfig {
  port: number
  signalNumber: string
  signalApiUrl: string
  signalWsUrl: string
  dbPath: string
  dbKey: string
  publicUrl: string
  allowedOrigin: string
  rpId: string
  rpOrigin: string
  attachmentDir: string
  secureCookies: boolean
  trustProxy: boolean
  sessionTtlDays: number
  sessionIdleDays: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const signalNumber = env.SIGNAL_NUMBER
  if (!signalNumber) throw new Error('SIGNAL_NUMBER is required (E.164, e.g. +15551234567)')
  if (!/^\+[1-9]\d{6,14}$/.test(signalNumber)) {
    throw new Error('SIGNAL_NUMBER must be E.164 format, e.g. +15551234567')
  }
  const signalApiUrl = env.SIGNAL_API_URL ?? 'http://signal-cli-rest-api:8080'
  const publicUrl = env.PUBLIC_URL ?? 'http://localhost:8090'
  const rpOrigin = env.RP_ORIGIN ?? publicUrl
  const dbKey = env.DB_KEY ?? ''
  if (!dbKey) throw new Error('DB_KEY is required (encryption key for the SQLCipher store)')
  return {
    port: Number(env.PORT ?? 8090),
    signalNumber,
    signalApiUrl,
    signalWsUrl: signalApiUrl.replace(/^http/, 'ws'),
    dbPath: env.DB_PATH ?? './data/signal-web.db',
    dbKey,
    publicUrl,
    allowedOrigin: env.ALLOWED_ORIGIN ?? publicUrl,
    rpId: env.RP_ID ?? new URL(rpOrigin).hostname,
    rpOrigin,
    attachmentDir: env.ATTACHMENT_DIR ?? './data/attachments',
    secureCookies: (env.SECURE_COOKIES ?? 'true') !== 'false',
    trustProxy: (env.TRUST_PROXY ?? 'true') !== 'false',
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
    sessionIdleDays: Number(env.SESSION_IDLE_DAYS ?? 7),
  }
}
```

Update `test/config.test.ts`: the existing tests must now pass `DB_KEY` in the base env (add `DB_KEY: 'k'` to the `base` object). Add assertions for a couple of new defaults (`dbPath`, `secureCookies`, `rpId` derived from `rpOrigin`) and that a missing `DB_KEY` throws.

- [ ] **Step 3: Write the failing client test** — `test/signal/client.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { SignalClient } from '../../src/signal/client'

function mockFetch(handler: (url: string, init?: RequestInit) => { status: number; body?: unknown; buf?: Buffer; contentType?: string }) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const r = handler(url, init)
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: String(r.status),
      json: async () => r.body,
      arrayBuffer: async () => (r.buf ? r.buf.buffer.slice(r.buf.byteOffset, r.buf.byteOffset + r.buf.byteLength) : new ArrayBuffer(0)),
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? r.contentType ?? 'application/octet-stream' : null) },
    } as unknown as Response
  }) as typeof fetch
}

const base = { apiUrl: 'http://signal:8080', number: '+15551230000' }

describe('SignalClient', () => {
  it('sends a message and returns the timestamp', async () => {
    let captured: { url: string; body: unknown } | undefined
    const client = new SignalClient({
      ...base,
      fetchImpl: mockFetch((url, init) => {
        captured = { url, body: JSON.parse(String(init?.body)) }
        return { status: 201, body: { timestamp: 1712000000000 } }
      }),
    })
    const res = await client.sendMessage({ recipients: ['+15551119999'], message: 'hi' })
    expect(res.timestamp).toBe(1712000000000)
    expect(captured?.url).toContain('/v2/send')
    expect((captured?.body as { message: string }).message).toBe('hi')
  })

  it('fetches an attachment as bytes + content-type', async () => {
    const client = new SignalClient({
      ...base,
      fetchImpl: mockFetch(() => ({ status: 200, buf: Buffer.from([1, 2, 3]), contentType: 'image/png' })),
    })
    const a = await client.fetchAttachment('att-1')
    expect(a.contentType).toBe('image/png')
    expect(Array.from(a.bytes)).toEqual([1, 2, 3])
  })

  it('throws on a non-2xx without leaking the recipient number', async () => {
    const client = new SignalClient({ ...base, fetchImpl: mockFetch(() => ({ status: 500 })) })
    await expect(client.sendMessage({ recipients: ['+15551119999'], message: 'x' })).rejects.toThrow(/send failed/i)
    await expect(client.sendMessage({ recipients: ['+15551119999'], message: 'x' })).rejects.not.toThrow(/15551119999/)
  })
})
```

- [ ] **Step 4: Run it — expect FAIL.**

- [ ] **Step 5: Implement** — `src/signal/client.ts`

```ts
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
    const recipients = input.groupId ? [input.groupId] : (input.recipients ?? [])
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

  async sendReaction(input: {
    recipient?: string
    groupId?: string
    reaction: string
    targetAuthor: string
    targetTimestamp: number
    remove?: boolean
  }): Promise<void> {
    await this.post(`/v1/reactions/${encodeURIComponent(this.opts.number)}`, {
      recipient: input.groupId ?? input.recipient,
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
      body: JSON.stringify({ recipient: input.groupId ?? input.recipient }),
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

  async listGroups(): Promise<Array<{ id: string; name?: string }>> {
    const res = await this.fetchImpl(this.url(`/v1/groups/${encodeURIComponent(this.opts.number)}`))
    if (!res.ok) throw new Error(`groups failed: ${res.status}`)
    return (await res.json()) as Array<{ id: string; name?: string }>
  }

  async getAccountUuid(): Promise<string | null> {
    try {
      const res = await this.fetchImpl(this.url('/v1/accounts'))
      if (!res.ok) return null
      const accounts = (await res.json()) as Array<{ number?: string; uuid?: string }>
      const me = accounts.find((a) => a.number === this.opts.number)
      return me?.uuid ?? null
    } catch {
      return null
    }
  }
}
```

- [ ] **Step 6: Run client + config tests + full suite + typecheck — expect PASS/clean.**

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/config.ts src/signal/client.ts test/config.test.ts test/signal/client.test.ts
git commit -m "feat: extend config and add SignalClient REST wrapper"
```

---

### Task 2: selfId resolution + synced-edit parser fix

**Files:**
- Create: `src/signal/selfId.ts`
- Modify: `src/signal/envelopes.ts` (add `editMessage` under `syncMessage.sentMessage`), `src/signal/parse.ts` (handle sync-side edit)
- Test: `test/signal/selfId.test.ts`, `test/signal/parse.test.ts` (extend)

**Interfaces:**
- `resolveSelfId(client: Pick<SignalClient, 'getAccountUuid'>, fallbackNumber: string): Promise<string>` — returns the account uuid if available, else the number. Never throws.
- Parser: an own edit synced from the phone arrives as `syncMessage.sentMessage.editMessage` → produce an `edit` event with `targetAuthorId = selfId`.

- [ ] **Step 1: Write the failing selfId test** — `test/signal/selfId.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { resolveSelfId } from '../../src/signal/selfId'

describe('resolveSelfId', () => {
  it('returns the account uuid when available', async () => {
    const id = await resolveSelfId({ getAccountUuid: async () => 'self-uuid' }, '+15551230000')
    expect(id).toBe('self-uuid')
  })
  it('falls back to the number when uuid is null', async () => {
    const id = await resolveSelfId({ getAccountUuid: async () => null }, '+15551230000')
    expect(id).toBe('+15551230000')
  })
  it('falls back to the number when the lookup throws', async () => {
    const id = await resolveSelfId({ getAccountUuid: async () => { throw new Error('x') } }, '+15551230000')
    expect(id).toBe('+15551230000')
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — `src/signal/selfId.ts`

```ts
export async function resolveSelfId(
  client: { getAccountUuid: () => Promise<string | null> },
  fallbackNumber: string,
): Promise<string> {
  try {
    const uuid = await client.getAccountUuid()
    return uuid ?? fallbackNumber
  } catch {
    return fallbackNumber
  }
}
```

- [ ] **Step 4: Extend the envelope type + parser** for synced edits. In `src/signal/envelopes.ts`, add `editMessage?: { targetSentTimestamp?: number; dataMessage?: { message?: string } }` to the `syncMessage.sentMessage` shape (the inner payload). In `src/signal/parse.ts`, before the `payload` message branch, when `isOwn` and `payload` has an `editMessage`, emit an edit event:

```ts
  // sync-side edit (own edit made from another device)
  if (isOwn && payload && (payload as { editMessage?: { targetSentTimestamp?: number; dataMessage?: { message?: string } } }).editMessage) {
    const em = (payload as { editMessage: { targetSentTimestamp?: number; dataMessage?: { message?: string } } }).editMessage
    if (em.targetSentTimestamp != null && em.dataMessage?.message != null) {
      return [{ kind: 'edit', targetAuthorId: selfId, targetTimestamp: em.targetSentTimestamp, newBody: em.dataMessage.message, editedTimestamp: e.timestamp ?? em.targetSentTimestamp }]
    }
  }
```

Place this right after `payload` is resolved (`const payload = isOwn ? e.syncMessage?.sentMessage : e.dataMessage`) and before the `remoteDelete` check.

Add a fixture + parse test: an `ownSentEdit` envelope with `syncMessage.sentMessage.editMessage` → parses to `{ kind: 'edit', targetAuthorId: SELF, targetTimestamp, newBody }`.

- [ ] **Step 5: Run selfId + parse tests + full suite + typecheck — expect PASS/clean.**

- [ ] **Step 6: Commit**

```bash
git add src/signal/selfId.ts src/signal/envelopes.ts src/signal/parse.ts test/signal/selfId.test.ts test/fixtures/envelopes.ts test/signal/parse.test.ts
git commit -m "feat: resolve account selfId; handle synced own-device edits"
```

---

### Task 3: Browser hub (broadcast + cursor replay)

**Files:**
- Create: `src/api/hub.ts`
- Test: `test/api/hub.test.ts`

**Interfaces:**
- `interface HubClient { send(data: string): void; readonly id: number }`
- `type LiveEvent = { type: 'message' | 'reaction' | 'receipt' | 'typing'; [k: string]: unknown }`
- `class BrowserHub`:
  - `add(client: HubClient): void`, `remove(client: HubClient): void`
  - `broadcast(event: LiveEvent): void` — JSON-serializes and sends to every client; a throwing client is removed.
  - `replay(client: HubClient, store: Store, cursor: number, limit: number): void` — sends messages across conversations newer than `cursor` (a timestamp) so a reconnecting browser catches up from the store (source of truth).
  - `size(): number`
- The hub holds no Signal logic — just fan-out. It is transport-agnostic (`HubClient` is an interface), so tests use a fake client and the real WS route adapts a socket to it in Task 4.

- [ ] **Step 1: Write the failing test** — `test/api/hub.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { BrowserHub, type HubClient } from '../../src/api/hub'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swhub-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

function fakeClient(id: number): HubClient & { sent: string[] } {
  const sent: string[] = []
  return { id, sent, send: (d) => sent.push(d) }
}

describe('BrowserHub', () => {
  it('broadcasts an event to all clients as JSON', () => {
    const hub = new BrowserHub()
    const a = fakeClient(1)
    const b = fakeClient(2)
    hub.add(a); hub.add(b)
    hub.broadcast({ type: 'message', body: 'hi' })
    expect(JSON.parse(a.sent[0])).toMatchObject({ type: 'message', body: 'hi' })
    expect(b.sent).toHaveLength(1)
  })

  it('drops a client that throws on send', () => {
    const hub = new BrowserHub()
    const bad: HubClient = { id: 9, send: () => { throw new Error('closed') } }
    hub.add(bad)
    hub.broadcast({ type: 'typing' })
    expect(hub.size()).toBe(0)
  })

  it('replays messages newer than the cursor from the store', () => {
    const s = open()
    s.conversations.ensure({ id: 'c1', type: 'dm' })
    s.messages.upsert({ conversationId: 'c1', authorId: 'a', timestamp: 1000, direction: 'in', body: 'old', receivedAt: 1 })
    s.messages.upsert({ conversationId: 'c1', authorId: 'a', timestamp: 2000, direction: 'in', body: 'new', receivedAt: 2 })
    const hub = new BrowserHub()
    const c = fakeClient(1)
    hub.replay(c, s, 1500, 100)
    const bodies = c.sent.map((d) => JSON.parse(d)).filter((e) => e.type === 'message').map((e) => e.message.body)
    expect(bodies).toContain('new')
    expect(bodies).not.toContain('old')
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — `src/api/hub.ts`

```ts
import type { Store } from '../store/store'

export interface HubClient {
  readonly id: number
  send(data: string): void
}

export type LiveEvent = { type: 'message' | 'reaction' | 'receipt' | 'typing' } & Record<string, unknown>

export class BrowserHub {
  private readonly clients = new Set<HubClient>()

  add(client: HubClient): void {
    this.clients.add(client)
  }

  remove(client: HubClient): void {
    this.clients.delete(client)
  }

  size(): number {
    return this.clients.size
  }

  broadcast(event: LiveEvent): void {
    const data = JSON.stringify(event)
    for (const client of [...this.clients]) {
      try {
        client.send(data)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  replay(client: HubClient, store: Store, cursor: number, limit: number): void {
    const conversations = store.conversations.list()
    const rows: Array<{ conversationId: string; timestamp: number; message: unknown }> = []
    for (const conv of conversations) {
      for (const m of store.messages.listByConversation(conv.id, limit)) {
        if (m.timestamp > cursor) rows.push({ conversationId: conv.id, timestamp: m.timestamp, message: m })
      }
    }
    rows.sort((a, b) => a.timestamp - b.timestamp)
    for (const r of rows) {
      client.send(JSON.stringify({ type: 'message', conversationId: r.conversationId, message: r.message }))
    }
  }
}
```

- [ ] **Step 4: Run hub tests + full suite + typecheck — expect PASS/clean.**

- [ ] **Step 5: Commit**

```bash
git add src/api/hub.ts test/api/hub.test.ts
git commit -m "feat: browser hub with broadcast and cursor replay"
```

---

### Task 4: Live bridge (receiver → ingest → hub) with reconnect

**Files:**
- Create: `src/signal/bridge.ts`
- Modify: `src/signal/receiver.ts` (add reconnect/backoff/heartbeat + `onOpen`/`onClose` already exist)
- Test: `test/signal/bridge.test.ts`, `test/signal/receiver.test.ts` (extend for reconnect)

**Interfaces:**
- `class LiveBridge`:
  - `constructor(deps: { store: Store; hub: BrowserHub; selfId: string; now?: () => number })`
  - `handleEnvelope(raw: RawEnvelope): void` — ingests into the store (M2 `ingestEnvelope`) then broadcasts a derived `LiveEvent` to the hub. Typing envelopes broadcast a `typing` event but are not stored (M2 already ignores them in the store).
  - The receiver's reconnect is added as a `reconnect` option: on close (not user-initiated), schedule a reconnect with exponential backoff (capped), and a periodic ping while open.
- Testing: `handleEnvelope` is tested by feeding fixtures and asserting both the store side (rows present) and the hub side (a fake client received the broadcast). Reconnect is tested at the receiver level with a fake WS server that drops the connection and asserting a reconnect attempt occurs (using injected timers / a short backoff).

- [ ] **Step 1: Write the failing bridge test** — `test/signal/bridge.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { BrowserHub, type HubClient } from '../../src/api/hub'
import { LiveBridge } from '../../src/signal/bridge'
import * as fx from '../fixtures/envelopes'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swbr-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}
function fakeClient(): HubClient & { sent: string[] } {
  const sent: string[] = []
  return { id: 1, sent, send: (d) => sent.push(d) }
}

describe('LiveBridge.handleEnvelope', () => {
  it('ingests an inbound message and broadcasts it', () => {
    const s = open()
    const hub = new BrowserHub()
    const c = fakeClient()
    hub.add(c)
    const bridge = new LiveBridge({ store: s, hub, selfId: fx.SELF, now: () => 5000 })
    bridge.handleEnvelope(fx.inboundText)
    expect(s.messages.listByConversation('alice-uuid', 10)[0].body).toBe('hello from alice')
    const evs = c.sent.map((d) => JSON.parse(d))
    expect(evs.some((e) => e.type === 'message')).toBe(true)
  })

  it('broadcasts typing without storing it', () => {
    const s = open()
    const hub = new BrowserHub()
    const c = fakeClient()
    hub.add(c)
    const bridge = new LiveBridge({ store: s, hub, selfId: fx.SELF, now: () => 5000 })
    bridge.handleEnvelope(fx.typing)
    expect(s.conversations.list()).toHaveLength(0)
    expect(c.sent.map((d) => JSON.parse(d)).some((e) => e.type === 'typing')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — `src/signal/bridge.ts`

```ts
import type { Store } from '../store/store'
import type { BrowserHub, LiveEvent } from '../api/hub'
import { ingestEnvelope } from './ingest'
import { classifyEnvelope, type RawEnvelope } from './envelopes'

export interface LiveBridgeDeps {
  store: Store
  hub: BrowserHub
  selfId: string
  now?: () => number
}

export class LiveBridge {
  constructor(private readonly deps: LiveBridgeDeps) {}

  handleEnvelope(raw: RawEnvelope): void {
    const now = this.deps.now ? this.deps.now() : Date.now()
    // Persist first (source of truth), then notify.
    ingestEnvelope(this.deps.store, raw, this.deps.selfId, now)

    const kind = classifyEnvelope(raw)
    const env = raw.envelope
    if (!env) return
    if (kind === 'typing') {
      this.deps.hub.broadcast({ type: 'typing', source: env.sourceUuid ?? env.sourceNumber ?? null } as LiveEvent)
      return
    }
    // For stored kinds, notify the browser that its store view changed. The browser
    // then pulls the affected conversation via REST (or the event carries the row).
    if (kind === 'data' || kind === 'sync-sent') {
      this.deps.hub.broadcast({ type: 'message', timestamp: env.timestamp ?? null } as LiveEvent)
    } else if (kind === 'receipt') {
      this.deps.hub.broadcast({ type: 'receipt', timestamp: env.timestamp ?? null } as LiveEvent)
    }
  }
}
```

Note: keep broadcast payloads free of message bodies is NOT required here (the browser is authenticated and needs content) — but the *bridge* keeps them minimal (a change signal + timestamp); the browser fetches the concrete rows via REST/replay. This avoids duplicating body-serialization logic and keeps the socket small.

- [ ] **Step 4: Add reconnect to the receiver** — in `src/signal/receiver.ts`, add optional `reconnect?: { minDelayMs: number; maxDelayMs: number }` and a `heartbeatMs?` to `ReceiverOptions`. On `close` (when not stopped by us), schedule `start()` again after a backoff that doubles from `minDelayMs` to `maxDelayMs`; reset the backoff on a successful `open`. While open, send a ping every `heartbeatMs`. Guard all timers so `stop()` clears them. Add a receiver test: a fake WS server that closes the socket immediately; assert the receiver attempts a second connection within a short window (use `minDelayMs: 10`).

- [ ] **Step 5: Run bridge + receiver tests + full suite + typecheck — expect PASS/clean.**

- [ ] **Step 6: Commit**

```bash
git add src/signal/bridge.ts src/signal/receiver.ts test/signal/bridge.test.ts test/signal/receiver.test.ts
git commit -m "feat: live bridge (ingest+broadcast) and receiver reconnect/heartbeat"
```

---

### Task 5: REST read/write API + browser WS route (auth-gated)

**Files:**
- Create: `src/api/rest.ts`, `src/api/wsRoute.ts`
- Test: `test/api/rest.test.ts`

**Interfaces:**
- `registerRestApi(app, { store, client, selfId }): void` — mounts behind `app.requireAuth`:
  - `GET /api/conversations` → `store.conversations.list()`
  - `GET /api/conversations/:id/messages?limit=` → history (with reactions/receipts/attachments joined per message)
  - `POST /api/send` `{ conversationId, type, message?, attachments? }` → `client.sendMessage(...)`, then optimistic `ingestEnvelope`-equivalent store write of the outgoing message (so it appears immediately); returns the timestamp
  - `POST /api/react` `{ targetAuthorId, targetTimestamp, emoji, remove? }` → `client.sendReaction`
  - `POST /api/typing` `{ conversationId, stop? }` → `client.sendTyping`
  - `POST /api/read` `{ recipient, targetTimestamp }` → `client.sendReceipt({ type: 'read' })`
- `registerBrowserWs(app, { store, hub, config })` — `GET /api/ws` upgraded via `@fastify/websocket`; on upgrade, enforce `isAllowedOrigin(req.headers.origin, config.allowedOrigin)` and a valid **full** session cookie (reuse the session validation), else close; adapt the socket to a `HubClient`, `hub.add`, replay from the client-provided `?cursor=`, and `hub.remove` on close.
- Testing: REST tested via `app.inject` with a logged-in session (reuse the M3 auth plugin + a temp store); `client` is a stub capturing calls. `GET /api/conversations` unauthorized → 401. The WS route's auth/origin gate is unit-tested where feasible (origin check is pure via `isAllowedOrigin`; the full upgrade is exercised manually against the running app).

- [ ] **Step 1: Write the failing REST test** — `test/api/rest.test.ts`

```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { hashPassword } from '../../src/auth/password'
import { authPlugin } from '../../src/auth/plugin'
import { registerRestApi } from '../../src/api/rest'

let store: Store
let path: string
let app: FastifyInstance
const sendCalls: unknown[] = []
const stubClient = {
  sendMessage: async (i: unknown) => { sendCalls.push(i); return { timestamp: 111 } },
  sendReaction: async () => {},
  sendTyping: async () => {},
  sendReceipt: async () => {},
}

beforeEach(async () => {
  sendCalls.length = 0
  path = join(tmpdir(), `swrest-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  store.authConfig.setPasswordHash(await hashPassword('hunter2hunter2'))
  store.conversations.ensure({ id: 'c1', type: 'dm', displayName: 'Alice' })
  store.messages.upsert({ conversationId: 'c1', authorId: 'a', timestamp: 1000, direction: 'in', body: 'hi', receivedAt: 1 })
  app = Fastify()
  await authPlugin(app, {
    store,
    sessionPolicy: { ttlMs: 1e9, idleMs: 1e9 },
    rateLimit: { maxPerKey: 5, windowMs: 60_000, lockoutMs: 1000, maxGlobal: 100 },
    webauthn: { rpId: 'localhost', rpName: 'x', origin: 'http://localhost' },
    secureCookies: false,
  })
  registerRestApi(app, { store, client: stubClient as never, selfId: 'self' })
  await app.ready()
})
afterEach(async () => {
  await app?.close(); store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})

async function login(): Promise<{ session: string; csrf: string }> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'hunter2hunter2' } })
  const raw = res.headers['set-cookie']
  const arr = Array.isArray(raw) ? raw : [String(raw)]
  const pick = (n: string) => arr.find((c) => c.startsWith(`${n}=`))!.split(';')[0].split('=')[1]
  return { session: pick('sw_session'), csrf: pick('sw_csrf') }
}

describe('REST API', () => {
  it('rejects unauthenticated access', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conversations' })
    expect(res.statusCode).toBe(401)
  })

  it('lists conversations when authenticated', async () => {
    const { session } = await login()
    const res = await app.inject({ method: 'GET', url: '/api/conversations', cookies: { sw_session: session } })
    expect(res.statusCode).toBe(200)
    expect(res.json()[0]).toMatchObject({ id: 'c1', displayName: 'Alice' })
  })

  it('returns conversation history', async () => {
    const { session } = await login()
    const res = await app.inject({ method: 'GET', url: '/api/conversations/c1/messages?limit=10', cookies: { sw_session: session } })
    expect(res.statusCode).toBe(200)
    expect(res.json().messages[0].body).toBe('hi')
  })

  it('sends a message via the client and stores it optimistically', async () => {
    const { session, csrf } = await login()
    const res = await app.inject({
      method: 'POST', url: '/api/send',
      cookies: { sw_session: session, sw_csrf: csrf }, headers: { 'x-csrf-token': csrf },
      payload: { conversationId: 'c1', type: 'dm', message: 'hello back' },
    })
    expect(res.statusCode).toBe(200)
    expect(sendCalls).toHaveLength(1)
    const stored = store.messages.listByConversation('c1', 10).find((m) => m.direction === 'out')
    expect(stored?.body).toBe('hello back')
  })

  it('enforces CSRF on send', async () => {
    const { session } = await login()
    const res = await app.inject({
      method: 'POST', url: '/api/send', cookies: { sw_session: session },
      payload: { conversationId: 'c1', type: 'dm', message: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement `registerRestApi`** — `src/api/rest.ts`

```ts
import type { FastifyInstance } from 'fastify'
import type { Store } from '../store/store'

interface SendCapableClient {
  sendMessage(input: { recipients?: string[]; groupId?: string; message?: string; base64Attachments?: string[] }): Promise<{ timestamp: number }>
  sendReaction(input: { recipient?: string; groupId?: string; reaction: string; targetAuthor: string; targetTimestamp: number; remove?: boolean }): Promise<void>
  sendTyping(input: { recipient?: string; groupId?: string; stop?: boolean }): Promise<void>
  sendReceipt(input: { recipient: string; targetTimestamp: number; type: 'read' | 'viewed' }): Promise<void>
}

export interface RestDeps {
  store: Store
  client: SendCapableClient
  selfId: string
}

export function registerRestApi(app: FastifyInstance, deps: RestDeps): void {
  const { store, client, selfId } = deps
  const auth = { preHandler: app.requireAuth }

  app.get('/api/conversations', auth, async () => store.conversations.list())

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/conversations/:id/messages',
    auth,
    async (req) => {
      const limit = Math.min(Number(req.query.limit ?? 100), 500)
      const messages = store.messages.listByConversation(req.params.id, limit).map((m) => ({
        ...m,
        reactions: store.reactions.listForMessage(m.authorId, m.timestamp),
        receipts: store.receipts.listForMessage(m.authorId, m.timestamp),
        attachments: store.attachments.listForMessage(m.authorId, m.timestamp),
      }))
      return { messages }
    },
  )

  app.post<{ Body: { conversationId: string; type: 'dm' | 'group'; message?: string; base64Attachments?: string[] } }>(
    '/api/send',
    auth,
    async (req, reply) => {
      const { conversationId, type, message, base64Attachments } = req.body
      const sent = await client.sendMessage(
        type === 'group'
          ? { groupId: conversationId, message, base64Attachments }
          : { recipients: [conversationId], message, base64Attachments },
      )
      const ts = sent.timestamp || Date.now()
      store.conversations.ensure({ id: conversationId, type })
      store.messages.upsert({
        conversationId, authorId: selfId, timestamp: ts, direction: 'out',
        body: message ?? null, receivedAt: Date.now(),
      })
      store.conversations.touch(conversationId, ts)
      return reply.send({ ok: true, timestamp: ts })
    },
  )

  app.post<{ Body: { conversationId?: string; type?: 'dm' | 'group'; targetAuthorId: string; targetTimestamp: number; emoji: string; remove?: boolean } }>(
    '/api/react',
    auth,
    async (req, reply) => {
      const b = req.body
      await client.sendReaction({
        recipient: b.type === 'group' ? undefined : b.conversationId,
        groupId: b.type === 'group' ? b.conversationId : undefined,
        reaction: b.emoji, targetAuthor: b.targetAuthorId, targetTimestamp: b.targetTimestamp, remove: b.remove,
      })
      if (b.remove) store.reactions.remove(b.targetAuthorId, b.targetTimestamp, selfId)
      else store.reactions.apply({ targetAuthorId: b.targetAuthorId, targetTimestamp: b.targetTimestamp, reactorId: selfId, emoji: b.emoji, timestamp: Date.now() })
      return reply.send({ ok: true })
    },
  )

  app.post<{ Body: { conversationId: string; type?: 'dm' | 'group'; stop?: boolean } }>(
    '/api/typing',
    auth,
    async (req, reply) => {
      await client.sendTyping({
        recipient: req.body.type === 'group' ? undefined : req.body.conversationId,
        groupId: req.body.type === 'group' ? req.body.conversationId : undefined,
        stop: req.body.stop,
      })
      return reply.send({ ok: true })
    },
  )

  app.post<{ Body: { recipient: string; targetTimestamp: number } }>(
    '/api/read',
    auth,
    async (req, reply) => {
      await client.sendReceipt({ recipient: req.body.recipient, targetTimestamp: req.body.targetTimestamp, type: 'read' })
      return reply.send({ ok: true })
    },
  )
}
```

- [ ] **Step 4: Implement `registerBrowserWs`** — `src/api/wsRoute.ts`

```ts
import type { FastifyInstance } from 'fastify'
import type { Store } from '../store/store'
import type { BrowserHub, HubClient } from './hub'
import { isAllowedOrigin } from '../auth/csrf'
import type { SessionPolicy } from '../store/sessions'

export interface WsDeps {
  store: Store
  hub: BrowserHub
  allowedOrigin: string
  sessionPolicy: SessionPolicy
}

let nextId = 1

export async function registerBrowserWs(app: FastifyInstance, deps: WsDeps): Promise<void> {
  const { store, hub, allowedOrigin, sessionPolicy } = deps
  app.get('/api/ws', { websocket: true }, (socket, req) => {
    const origin = req.headers.origin
    const token = req.cookies?.sw_session
    const validFull =
      token != null &&
      store.sessions.validate(token, Date.now(), sessionPolicy) &&
      store.sessions.getLevel(token) === 'full'
    if (!isAllowedOrigin(origin, allowedOrigin) || !validFull) {
      socket.close()
      return
    }
    const client: HubClient = { id: nextId++, send: (d) => socket.send(d) }
    hub.add(client)
    const cursor = Number(new URL(req.url, 'http://x').searchParams.get('cursor') ?? 0)
    hub.replay(client, store, cursor, 200)
    socket.on('close', () => hub.remove(client))
    socket.on('error', () => hub.remove(client))
  })
}
```

- [ ] **Step 5: Run REST tests + full suite + typecheck — expect PASS/clean.** (The WS route's full upgrade is verified manually in the DoD; the origin/session gate logic reuses tested primitives.)

- [ ] **Step 6: Commit**

```bash
git add src/api/rest.ts src/api/wsRoute.ts test/api/rest.test.ts
git commit -m "feat: auth-gated REST api and browser websocket route"
```

---

### Task 6: Profile/contact service (names + avatars)

**Files:**
- Create: `src/profile/service.ts`
- Test: `test/profile/service.test.ts`

**Interfaces:**
- `class ProfileService`:
  - `constructor(deps: { store: Store; client: Pick<SignalClient, 'listContacts' | 'listGroups'>; avatarDir: string })`
  - `refresh(): Promise<{ named: number }>` — pulls contacts + groups, and for each updates the matching conversation's `display_name` via `conversations.ensure` (only when a name is available; number-fallback stays otherwise). Returns how many conversations got a name. (Avatar fetch/storage is stubbed to a path in this task; wiring actual avatar bytes is folded into the attachment-style storage and can be a thin follow-up — keep the name path fully working and tested.)
- Testing: `client` is a stub returning fixture contacts/groups; assert the conversation names update and that a contact without a name leaves the existing value intact.

- [ ] **Step 1: Write the failing test** — `test/profile/service.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { ProfileService } from '../../src/profile/service'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swprof-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

const stubClient = {
  listContacts: async () => [
    { uuid: 'alice-uuid', number: '+15551110001', name: 'Alice' },
    { uuid: 'bob-uuid', number: '+15551110002' }, // no name
  ],
  listGroups: async () => [{ id: 'group-xyz', name: 'Family' }],
}

describe('ProfileService.refresh', () => {
  it('names conversations from contacts and groups, leaving unnamed ones on fallback', async () => {
    const s = open()
    s.conversations.ensure({ id: 'alice-uuid', type: 'dm' })
    s.conversations.ensure({ id: 'bob-uuid', type: 'dm' })
    s.conversations.ensure({ id: 'group-xyz', type: 'group' })
    const svc = new ProfileService({ store: s, client: stubClient, avatarDir: tmpdir() })
    const res = await svc.refresh()
    const byId = Object.fromEntries(s.conversations.list().map((c) => [c.id, c.displayName]))
    expect(byId['alice-uuid']).toBe('Alice')
    expect(byId['group-xyz']).toBe('Family')
    expect(byId['bob-uuid']).toBeNull() // stays on number-fallback
    expect(res.named).toBe(2)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — `src/profile/service.ts`

```ts
import type { Store } from '../store/store'

interface ContactLike { number?: string; uuid?: string; name?: string; profileName?: string }
interface GroupLike { id: string; name?: string }

export interface ProfileDeps {
  store: Store
  client: { listContacts: () => Promise<ContactLike[]>; listGroups: () => Promise<GroupLike[]> }
  avatarDir: string
}

export class ProfileService {
  constructor(private readonly deps: ProfileDeps) {}

  async refresh(): Promise<{ named: number }> {
    let named = 0
    const [contacts, groups] = await Promise.all([
      this.deps.client.listContacts().catch(() => [] as ContactLike[]),
      this.deps.client.listGroups().catch(() => [] as GroupLike[]),
    ])
    for (const c of contacts) {
      const name = c.name || c.profileName
      const id = c.uuid || c.number
      if (name && id) {
        this.deps.store.conversations.ensure({ id, type: 'dm', displayName: name })
        named++
      }
    }
    for (const g of groups) {
      if (g.name) {
        this.deps.store.conversations.ensure({ id: g.id, type: 'group', displayName: g.name })
        named++
      }
    }
    return { named }
  }
}
```

- [ ] **Step 4: Run profile tests + full suite + typecheck — expect PASS/clean.**

- [ ] **Step 5: Commit**

```bash
git add src/profile/service.ts test/profile/service.test.ts
git commit -m "feat: profile/contact service names conversations (number fallback)"
```

---

### Task 7: Hardened attachment proxy + encrypted blob store + composition root

**Files:**
- Create: `src/store/attachmentsBlob.ts`, `src/api/attachments.ts`, `src/app/main.ts`
- Modify: `src/api/rest.ts` (add the attachment route), `package.json` (script), `src/index.ts` (delegate to `src/app/main.ts`)
- Test: `test/api/attachments.test.ts`

**Interfaces:**
- `class AttachmentBlobStore`:
  - `constructor(dir: string, key: string)`
  - `put(id: string, bytes: Buffer): Promise<void>` — writes AES-256-GCM-encrypted bytes to `dir/<sha256(id)>`; the file never contains plaintext.
  - `get(id: string): Promise<Buffer | null>` — decrypts; returns null if absent. Path is derived by hashing the opaque id (no client-controlled path).
- `AttachmentProxy` (in `src/api/attachments.ts`):
  - `registerAttachmentRoute(app, { store, client, blobs })` — `GET /api/attachments/:id` behind `requireAuth`: looks up the attachment row by opaque `id` in the store; **404 if not found** (the id must exist as a cached attachment — no arbitrary fetch); serves the decrypted bytes with the stored content-type; if not yet cached to blob, fetches via `client.fetchAttachment(signalId)`, stores encrypted, then serves. Enforces a size cap.
- `src/app/main.ts`: the composition root — `loadConfig`, `openStore(dbPath, dbKey)`, build `SignalClient`, `resolveSelfId`, `BrowserHub`, `LiveBridge`, `SignalReceiver` (with reconnect, `onEvent → bridge.handleEnvelope`), Fastify app with `trustProxy: config.trustProxy`, register `authPlugin` + `registerRestApi` + `registerBrowserWs` + the attachment route, a periodic `ProfileService.refresh` + `pruneOlderThan`, then `listen`.
- `src/index.ts` becomes a thin `import('./app/main')` runner (keeps `npm start`).

- [ ] **Step 1: Write the failing blob + proxy test** — `test/api/attachments.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdtempSync } from 'node:fs'
import { AttachmentBlobStore } from '../../src/store/attachmentsBlob'

let dir: string
afterEach(() => {
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('AttachmentBlobStore', () => {
  it('stores encrypted (ciphertext on disk) and round-trips the plaintext', async () => {
    dir = mkdtempSync(join(tmpdir(), 'swblob-'))
    const blobs = new AttachmentBlobStore(dir, 'a-256-bit-keyphrase-................')
    const plain = Buffer.from('secret image bytes')
    await blobs.put('att-1', plain)
    const back = await blobs.get('att-1')
    expect(back?.toString()).toBe('secret image bytes')
  })

  it('returns null for an unknown id', async () => {
    dir = mkdtempSync(join(tmpdir(), 'swblob-'))
    const blobs = new AttachmentBlobStore(dir, 'a-256-bit-keyphrase-................')
    expect(await blobs.get('missing')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement the blob store** — `src/store/attachmentsBlob.ts`

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export class AttachmentBlobStore {
  private readonly key: Buffer

  constructor(private readonly dir: string, keyPhrase: string) {
    // Derive a 32-byte key from the phrase (the store key is already high-entropy).
    this.key = createHash('sha256').update(keyPhrase).digest()
  }

  private pathFor(id: string): string {
    const name = createHash('sha256').update(id).digest('hex')
    return join(this.dir, name)
  }

  async put(id: string, bytes: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const enc = Buffer.concat([cipher.update(bytes), cipher.final()])
    const tag = cipher.getAuthTag()
    // file layout: iv(12) | tag(16) | ciphertext
    await writeFile(this.pathFor(id), Buffer.concat([iv, tag, enc]))
  }

  async get(id: string): Promise<Buffer | null> {
    let raw: Buffer
    try {
      raw = await readFile(this.pathFor(id))
    } catch {
      return null
    }
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const enc = raw.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()])
  }
}
```

- [ ] **Step 4: Run blob tests — expect PASS.**

- [ ] **Step 5: Implement the attachment route** — `src/api/attachments.ts` (added to REST):

```ts
import type { FastifyInstance } from 'fastify'
import type { Store } from '../store/store'
import type { AttachmentBlobStore } from '../store/attachmentsBlob'

interface FetchCapableClient {
  fetchAttachment(id: string): Promise<{ contentType: string; bytes: Buffer }>
}

export interface AttachmentDeps {
  store: Store
  client: FetchCapableClient
  blobs: AttachmentBlobStore
  maxBytes?: number
}

export function registerAttachmentRoute(app: FastifyInstance, deps: AttachmentDeps): void {
  const maxBytes = deps.maxBytes ?? 25 * 1024 * 1024
  app.get<{ Params: { id: string } }>(
    '/api/attachments/:id',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      // The opaque id MUST correspond to a cached attachment row — no arbitrary fetch.
      const row = deps.store.db
        .prepare('SELECT id, signal_id, content_type FROM attachments WHERE id = ?')
        .get(req.params.id) as { id: string; signal_id: string | null; content_type: string | null } | undefined
      if (!row) return reply.code(404).send({ error: 'not_found' })

      let bytes = await deps.blobs.get(row.id)
      if (!bytes) {
        if (!row.signal_id) return reply.code(404).send({ error: 'unavailable' })
        const fetched = await deps.client.fetchAttachment(row.signal_id)
        if (fetched.bytes.length > maxBytes) return reply.code(413).send({ error: 'too_large' })
        await deps.blobs.put(row.id, fetched.bytes)
        bytes = fetched.bytes
      }
      return reply.header('content-type', row.content_type ?? 'application/octet-stream').send(bytes)
    },
  )
}
```

- [ ] **Step 6: Implement the composition root** — `src/app/main.ts`

```ts
import Fastify from 'fastify'
import { loadConfig } from '../config'
import { openStore } from '../store/store'
import { SignalClient } from '../signal/client'
import { resolveSelfId } from '../signal/selfId'
import { SignalReceiver } from '../signal/receiver'
import { BrowserHub } from '../api/hub'
import { LiveBridge } from '../signal/bridge'
import { authPlugin } from '../auth/plugin'
import { registerRestApi } from '../api/rest'
import { registerBrowserWs } from '../api/wsRoute'
import { registerAttachmentRoute } from '../api/attachments'
import { AttachmentBlobStore } from '../store/attachmentsBlob'
import { ProfileService } from '../profile/service'
import { pruneOlderThan } from '../store/prune'
import fastifyWebsocket from '@fastify/websocket'

const DAY = 24 * 3600_000

export async function main(): Promise<void> {
  const config = loadConfig()
  const store = openStore(config.dbPath, config.dbKey)
  const client = new SignalClient({ apiUrl: config.signalApiUrl, number: config.signalNumber })
  const selfId = await resolveSelfId(client, config.signalNumber)
  const hub = new BrowserHub()
  const bridge = new LiveBridge({ store, hub, selfId })
  const blobs = new AttachmentBlobStore(config.attachmentDir, config.dbKey)
  const profile = new ProfileService({ store, client, avatarDir: config.attachmentDir })

  const receiver = new SignalReceiver({
    wsBaseUrl: config.signalWsUrl,
    signalNumber: config.signalNumber,
    onEvent: (ev) => bridge.handleEnvelope(ev.raw),
    onOpen: () => console.log('[signal] connected to signal-cli'),
    onClose: (code) => console.log(`[signal] disconnected (code=${code})`),
    onError: (err) => console.error(`[signal] receiver error: ${err.message}`),
    reconnect: { minDelayMs: 1000, maxDelayMs: 30_000 },
    heartbeatMs: 30_000,
  })
  receiver.start()

  const app = Fastify({ trustProxy: config.trustProxy })
  await app.register(fastifyWebsocket)
  await authPlugin(app, {
    store,
    sessionPolicy: { ttlMs: config.sessionTtlDays * DAY, idleMs: config.sessionIdleDays * DAY },
    rateLimit: { maxPerKey: 5, windowMs: 60_000, lockoutMs: 15 * 60_000, maxGlobal: 200 },
    webauthn: { rpId: config.rpId, rpName: 'Signal Web', origin: config.rpOrigin },
    secureCookies: config.secureCookies,
  })
  registerRestApi(app, { store, client, selfId })
  registerAttachmentRoute(app, { store, client, blobs })
  await registerBrowserWs(app, {
    store, hub, allowedOrigin: config.allowedOrigin,
    sessionPolicy: { ttlMs: config.sessionTtlDays * DAY, idleMs: config.sessionIdleDays * DAY },
  })

  // periodic maintenance
  setInterval(() => { void profile.refresh() }, 10 * 60_000).unref()
  setInterval(() => { pruneOlderThan(store, Date.now()) }, 60 * 60_000).unref()
  void profile.refresh()

  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`[app] listening on :${config.port}`)
}
```

- [ ] **Step 7: Wire `registerAttachmentRoute` import + call** — it's already called in `main.ts`; also re-export it from `src/api/rest.ts` if the plan's earlier tests import from there (they import from `../../src/api/attachments`, so no change needed). Replace `src/index.ts` body with:

```ts
import { main } from './app/main'

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[app] fatal: ${message}`)
  process.exit(1)
})
```

- [ ] **Step 8: Run full suite + typecheck — expect PASS/clean.** (`main.ts` has no unit test — it is the composition root, verified by the DoD manual run.)

- [ ] **Step 9: Commit**

```bash
git add src/store/attachmentsBlob.ts src/api/attachments.ts src/app/main.ts src/index.ts test/api/attachments.test.ts
git commit -m "feat: encrypted attachment blob store, hardened proxy, composition root"
```

---

## Milestone 4 Done — Definition of Done

- `npm test` fully green (client, selfId, parse sync-edit, hub, bridge, REST, profile, blob).
- `npm run typecheck` clean.
- **Manual (against the linked device):** `docker compose up`, log in through the auth flow, open the browser WS, send a message from the web (arrives on the phone), receive a message (appears live), a name resolves for at least one contact, and an inbound image loads via `/api/attachments/:id`.
- All `/api/*` routes and the WS require a full session; CSRF enforced on writes; WS enforces origin + session.

## Self-Review notes (author)

- **Spec coverage:** SignalClient (send/react/typing/receipt/attachment/contacts/groups); live bridge with reconnect/heartbeat (§5.2); browser WS with cursor replay + origin/session gate (wires the deferred M3 WS-origin guard); REST read/write behind requireAuth + CSRF; profile names with number fallback (§5.2 flaky-names work item); hardened attachment proxy with opaque ids + encrypted-at-rest blobs + size cap (§9); synced own-device edit (DEFERRED item); trustProxy (DEFERRED item); periodic prune (§7).
- **Testing honesty:** real sends, real attachment bytes, and the full WS upgrade need the live daemon — covered by mockable seams for units and an explicit manual DoD. Avatar *bytes* fetch is stubbed to keep the name path fully tested; a thin follow-up can store avatar blobs via the same `AttachmentBlobStore` (noted).
- **Placeholder scan:** none; every step has complete code.
- **Type consistency:** `SignalClient`, `BrowserHub`/`HubClient`/`LiveEvent`, `LiveBridge`, `registerRestApi`/`registerBrowserWs`/`registerAttachmentRoute`, `AttachmentBlobStore`, `ProfileService`, extended `AppConfig` names are stable across tasks; `main.ts` consumes exactly those signatures.
