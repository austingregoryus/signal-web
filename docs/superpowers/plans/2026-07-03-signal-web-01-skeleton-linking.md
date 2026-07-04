# Signal Web — Milestone 1: Skeleton & Device Linking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo, run both containers, link the phone as a Signal device, and prove real inbound envelopes reach our backend and are correctly classified (including own-sent sync messages).

**Architecture:** A TypeScript Node backend (Fastify) runs alongside `bbernhard/signal-cli-rest-api` (json-rpc mode) on a private Docker network. The backend opens the signal-cli receive WebSocket, parses each envelope, classifies it, and logs it (kind + timestamp only — no bodies). A one-shot script fetches the linking QR from signal-cli so the phone can link the server as a secondary device.

**Tech Stack:** Node 24, TypeScript (run via `tsx`, no build step this milestone), Fastify 5, `ws`, Vitest, Docker Compose.

## Global Constraints

- **Node:** `>=24` (Debian-slim base image, not Alpine — later native modules need prebuilds).
- **Signal engine:** `bbernhard/signal-cli-rest-api` in `MODE=json-rpc`; receive WS at `/v1/receive/{number}`; linking at `/v1/qrcodelink`. Pin the image tag (swap to a digest before real deployment).
- **Log hygiene (spec §9):** never log message bodies, phone numbers, or QR/link tokens. Log envelope `kind` and `timestamp` only.
- **Secrets:** real values live in `.env` (git-ignored); only `.env.example` is committed.
- **Signal number format:** E.164, e.g. `+15551234567`.
- **Own-sent handling (spec §5.2):** the classifier MUST treat `syncMessage.sentMessage` as its own kind (`sync-sent`), checked before `dataMessage`. This is the foundation for two-sided threads in M2.

---

### Task 1: Repo scaffold + Fastify `/health`

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/server.ts`
- Test: `test/server.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `buildServer(): FastifyInstance` — a Fastify app with `GET /health` → `{ status: 'ok' }`. Later tasks import `buildServer` from `src/server`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "signal-web",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "link-device": "tsx src/signal/link.ts"
  },
  "dependencies": {
    "fastify": "^5.2.0",
    "tsx": "^4.19.2",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/ws": "^8.5.13",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (Bundler resolution — no `.js` import extensions needed; `tsx` runs it directly)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
link-qr.png
*.log
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated, `package-lock.json` created, no errors.

- [ ] **Step 6: Write the failing test** — `test/server.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { buildServer } from '../src/server'

describe('health endpoint', () => {
  it('returns { status: "ok" } with 200', async () => {
    const app = buildServer()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/server` (module does not exist yet).

- [ ] **Step 8: Write minimal implementation** — `src/server.ts`

```ts
import Fastify, { type FastifyInstance } from 'fastify'

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false })
  app.get('/health', async () => ({ status: 'ok' }))
  return app
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 1 passing.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/server.ts test/server.test.ts
git commit -m "feat: scaffold backend with Fastify health endpoint"
```

---

### Task 2: Config loader

**Files:**
- Create: `src/config.ts`
- Create: `.env.example`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface AppConfig { port: number; signalNumber: string; signalApiUrl: string; signalWsUrl: string }`
  - `loadConfig(env?: NodeJS.ProcessEnv): AppConfig` — validates `SIGNAL_NUMBER` (E.164, required), defaults `SIGNAL_API_URL` to `http://signal-cli-rest-api:8080` and `PORT` to `8090`, derives `signalWsUrl` by swapping the `http` scheme for `ws`.

- [ ] **Step 1: Write the failing test** — `test/config.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

const base = { SIGNAL_NUMBER: '+15551234567' }

describe('loadConfig', () => {
  it('loads defaults and derives the ws url from the api url', () => {
    const cfg = loadConfig({ ...base })
    expect(cfg.signalNumber).toBe('+15551234567')
    expect(cfg.port).toBe(8090)
    expect(cfg.signalApiUrl).toBe('http://signal-cli-rest-api:8080')
    expect(cfg.signalWsUrl).toBe('ws://signal-cli-rest-api:8080')
  })

  it('derives wss from https', () => {
    const cfg = loadConfig({ ...base, SIGNAL_API_URL: 'https://example.com:8443' })
    expect(cfg.signalWsUrl).toBe('wss://example.com:8443')
  })

  it('throws when SIGNAL_NUMBER is missing', () => {
    expect(() => loadConfig({})).toThrow(/SIGNAL_NUMBER is required/)
  })

  it('throws when SIGNAL_NUMBER is not E.164', () => {
    expect(() => loadConfig({ SIGNAL_NUMBER: '5551234567' })).toThrow(/E\.164/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test test/config.test.ts`
Expected: FAIL — cannot resolve `../src/config`.

- [ ] **Step 3: Write minimal implementation** — `src/config.ts`

```ts
export interface AppConfig {
  port: number
  signalNumber: string
  signalApiUrl: string
  signalWsUrl: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const signalNumber = env.SIGNAL_NUMBER
  if (!signalNumber) {
    throw new Error('SIGNAL_NUMBER is required (E.164, e.g. +15551234567)')
  }
  if (!/^\+[1-9]\d{6,14}$/.test(signalNumber)) {
    throw new Error('SIGNAL_NUMBER must be E.164 format, e.g. +15551234567')
  }
  const signalApiUrl = env.SIGNAL_API_URL ?? 'http://signal-cli-rest-api:8080'
  return {
    port: Number(env.PORT ?? 8090),
    signalNumber,
    signalApiUrl,
    signalWsUrl: signalApiUrl.replace(/^http/, 'ws'),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test test/config.test.ts`
Expected: PASS — 4 passing.

- [ ] **Step 5: Create `.env.example`**

```
# The Signal phone number the server links to (E.164).
SIGNAL_NUMBER=+15551234567
# Internal URL of the signal-cli-rest-api container.
SIGNAL_API_URL=http://signal-cli-rest-api:8080
# Port the web app listens on.
PORT=8090
# Name shown for this linked device in the phone's Linked Devices list.
DEVICE_NAME=signal-web
```

- [ ] **Step 6: Commit**

```bash
git add src/config.ts test/config.test.ts .env.example
git commit -m "feat: add validated config loader"
```

---

### Task 3: Envelope classifier

**Files:**
- Create: `src/signal/envelopes.ts`
- Test: `test/signal/envelopes.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type EnvelopeKind = 'data' | 'sync-sent' | 'receipt' | 'typing' | 'unknown'`
  - `interface RawEnvelope` (shape below).
  - `classifyEnvelope(raw: RawEnvelope): EnvelopeKind` — checks `syncMessage.sentMessage` **before** `dataMessage` so own-sent messages are never misfiled as inbound.

- [ ] **Step 1: Write the failing test** — `test/signal/envelopes.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { classifyEnvelope } from '../../src/signal/envelopes'

describe('classifyEnvelope', () => {
  it('classifies an inbound data message', () => {
    expect(classifyEnvelope({ envelope: { dataMessage: { message: 'hi' } } })).toBe('data')
  })

  it('classifies an own-sent sync message as sync-sent (before data)', () => {
    expect(
      classifyEnvelope({ envelope: { syncMessage: { sentMessage: { message: 'hi' } } } }),
    ).toBe('sync-sent')
  })

  it('classifies a receipt', () => {
    expect(classifyEnvelope({ envelope: { receiptMessage: { isRead: true } } })).toBe('receipt')
  })

  it('classifies a typing indicator', () => {
    expect(classifyEnvelope({ envelope: { typingMessage: { action: 'STARTED' } } })).toBe('typing')
  })

  it('returns unknown for an empty envelope', () => {
    expect(classifyEnvelope({})).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test test/signal/envelopes.test.ts`
Expected: FAIL — cannot resolve `../../src/signal/envelopes`.

- [ ] **Step 3: Write minimal implementation** — `src/signal/envelopes.ts`

```ts
export type EnvelopeKind = 'data' | 'sync-sent' | 'receipt' | 'typing' | 'unknown'

export interface RawEnvelope {
  envelope?: {
    source?: string
    sourceUuid?: string
    sourceName?: string
    timestamp?: number
    dataMessage?: unknown
    syncMessage?: { sentMessage?: unknown }
    receiptMessage?: unknown
    typingMessage?: unknown
  }
  account?: string
}

export function classifyEnvelope(raw: RawEnvelope): EnvelopeKind {
  const e = raw.envelope
  if (!e) return 'unknown'
  // Own-sent (from another of the account's devices) must be checked first:
  // a sync sentMessage is NOT an inbound dataMessage.
  if (e.syncMessage?.sentMessage) return 'sync-sent'
  if (e.dataMessage) return 'data'
  if (e.receiptMessage) return 'receipt'
  if (e.typingMessage) return 'typing'
  return 'unknown'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test test/signal/envelopes.test.ts`
Expected: PASS — 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/signal/envelopes.ts test/signal/envelopes.test.ts
git commit -m "feat: classify signal envelopes incl. own-sent sync"
```

---

### Task 4: Signal receive WebSocket consumer

**Files:**
- Create: `src/signal/receiver.ts`
- Test: `test/signal/receiver.test.ts`

**Interfaces:**
- Consumes: `classifyEnvelope`, `EnvelopeKind`, `RawEnvelope` from `src/signal/envelopes`.
- Produces:
  - `receiveUrl(wsBaseUrl: string, signalNumber: string): string` → `${wsBaseUrl}/v1/receive/${encodeURIComponent(signalNumber)}`
  - `interface ReceiverEvent { kind: EnvelopeKind; raw: RawEnvelope }`
  - `interface ReceiverOptions { wsBaseUrl: string; signalNumber: string; onEvent: (ev: ReceiverEvent) => void; onError?: (err: Error) => void; WebSocketImpl?: typeof WebSocket }`
  - `class SignalReceiver { constructor(opts: ReceiverOptions); start(): void; stop(): void }`
- Note: robust auto-reconnect with backoff/heartbeat is deferred to Milestone 2 (spec §5.2). This milestone establishes a single connection that parses and classifies.

- [ ] **Step 1: Write the failing test** — `test/signal/receiver.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { WebSocketServer } from 'ws'
import WebSocket from 'ws'
import { SignalReceiver, receiveUrl, type ReceiverEvent } from '../../src/signal/receiver'

describe('receiveUrl', () => {
  it('builds the receive endpoint with an encoded number', () => {
    expect(receiveUrl('ws://host:8080', '+15551234567')).toBe(
      'ws://host:8080/v1/receive/%2B15551234567',
    )
  })
})

describe('SignalReceiver', () => {
  let wss: WebSocketServer | undefined

  afterEach(() => {
    wss?.close()
    wss = undefined
  })

  it('parses and classifies an incoming envelope', async () => {
    wss = new WebSocketServer({ port: 0 })
    await new Promise<void>((resolve) => wss!.on('listening', () => resolve()))
    const port = (wss.address() as { port: number }).port

    wss.on('connection', (sock) => {
      sock.send(JSON.stringify({ envelope: { timestamp: 42, dataMessage: { message: 'hi' } } }))
    })

    const events: ReceiverEvent[] = []
    const rx = new SignalReceiver({
      wsBaseUrl: `ws://127.0.0.1:${port}`,
      signalNumber: '+15551234567',
      onEvent: (e) => events.push(e),
      WebSocketImpl: WebSocket,
    })
    rx.start()

    await new Promise<void>((resolve) => setTimeout(resolve, 250))
    rx.stop()

    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].kind).toBe('data')
    expect(events[0].raw.envelope?.timestamp).toBe(42)
  })

  it('ignores non-JSON keep-alive frames without throwing', async () => {
    wss = new WebSocketServer({ port: 0 })
    await new Promise<void>((resolve) => wss!.on('listening', () => resolve()))
    const port = (wss.address() as { port: number }).port

    wss.on('connection', (sock) => sock.send('ping'))

    const events: ReceiverEvent[] = []
    const rx = new SignalReceiver({
      wsBaseUrl: `ws://127.0.0.1:${port}`,
      signalNumber: '+15551234567',
      onEvent: (e) => events.push(e),
      WebSocketImpl: WebSocket,
    })
    rx.start()

    await new Promise<void>((resolve) => setTimeout(resolve, 200))
    rx.stop()

    expect(events.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test test/signal/receiver.test.ts`
Expected: FAIL — cannot resolve `../../src/signal/receiver`.

- [ ] **Step 3: Write minimal implementation** — `src/signal/receiver.ts`

```ts
import WebSocket from 'ws'
import { classifyEnvelope, type EnvelopeKind, type RawEnvelope } from './envelopes'

export interface ReceiverEvent {
  kind: EnvelopeKind
  raw: RawEnvelope
}

export interface ReceiverOptions {
  wsBaseUrl: string
  signalNumber: string
  onEvent: (ev: ReceiverEvent) => void
  onError?: (err: Error) => void
  WebSocketImpl?: typeof WebSocket
}

export function receiveUrl(wsBaseUrl: string, signalNumber: string): string {
  return `${wsBaseUrl}/v1/receive/${encodeURIComponent(signalNumber)}`
}

export class SignalReceiver {
  private ws?: WebSocket

  constructor(private readonly opts: ReceiverOptions) {}

  start(): void {
    const Impl = this.opts.WebSocketImpl ?? WebSocket
    const ws = new Impl(receiveUrl(this.opts.wsBaseUrl, this.opts.signalNumber))
    this.ws = ws

    ws.on('message', (data: WebSocket.RawData) => {
      let raw: RawEnvelope
      try {
        raw = JSON.parse(data.toString()) as RawEnvelope
      } catch {
        return // non-JSON keep-alive; ignore
      }
      this.opts.onEvent({ kind: classifyEnvelope(raw), raw })
    })

    ws.on('error', (err: Error) => this.opts.onError?.(err))
  }

  stop(): void {
    this.ws?.close()
    this.ws = undefined
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test test/signal/receiver.test.ts`
Expected: PASS — 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/signal/receiver.ts test/signal/receiver.test.ts
git commit -m "feat: signal receive websocket consumer"
```

---

### Task 5: Application entrypoint (compose config + server + receiver)

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes: `loadConfig` (`src/config`), `buildServer` (`src/server`), `SignalReceiver` (`src/signal/receiver`).
- Produces: a runnable process. No new exports; this is the composition root. Logs each envelope as `kind` + `timestamp` only (log hygiene).

- [ ] **Step 1: Write the entrypoint** — `src/index.ts`

```ts
import { loadConfig } from './config'
import { buildServer } from './server'
import { SignalReceiver } from './signal/receiver'

async function main(): Promise<void> {
  const config = loadConfig()
  const app = buildServer()

  const receiver = new SignalReceiver({
    wsBaseUrl: config.signalWsUrl,
    signalNumber: config.signalNumber,
    onEvent: (ev) => {
      // Log hygiene (spec §9): kind + timestamp only. Never bodies or numbers.
      const ts = ev.raw.envelope?.timestamp ?? 'n/a'
      console.log(`[signal] envelope kind=${ev.kind} ts=${ts}`)
    },
    onError: (err) => console.error(`[signal] receiver error: ${err.message}`),
  })
  receiver.start()

  await app.listen({ port: config.port, host: '0.0.0.0' })
  console.log(`[app] listening on :${config.port}`)
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[app] fatal: ${message}`)
  process.exit(1)
})
```

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Verify it boots locally (expected to log a receiver error until containers exist)**

Run: `SIGNAL_NUMBER=+15551234567 SIGNAL_API_URL=http://127.0.0.1:9 npm start`
Expected: prints `[app] listening on :8090`, and (because nothing is at that address) a `[signal] receiver error: ...` line. Confirm `GET http://127.0.0.1:8090/health` returns `{"status":"ok"}` (in another shell: `curl -s localhost:8090/health`). Then stop with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: application entrypoint wiring server and receiver"
```

---

### Task 6: Containers + device linking + end-to-end proof

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `src/signal/link.ts`
- Create: `README.md` (linking runbook)

**Interfaces:**
- Consumes: `loadConfig` (`src/config`).
- Produces: `npm run link-device` writes `link-qr.png` (a QR the phone scans). Running containers that stream real envelopes into the Task 5 logger.
- This task's deliverable is verified manually (a real phone must scan the QR); there is no unit test.

- [ ] **Step 1: Create `Dockerfile`** (Debian-slim; runs TypeScript via `tsx`)

```dockerfile
FROM node:24-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src

EXPOSE 8090
CMD ["npx", "tsx", "src/index.ts"]
```

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
services:
  signal-cli-rest-api:
    # Pin to a tag now; replace with an image digest before real deployment (spec §9).
    image: bbernhard/signal-cli-rest-api:0.94
    environment:
      - MODE=json-rpc
    volumes:
      - signal-cli-data:/home/.local/share/signal-cli
    networks: [signalnet]
    # NOTE: no published port in normal operation. For the ONE-TIME linking step you
    # may temporarily add:  ports: ["8080:8080"]  — or use `docker compose exec` (below).

  app:
    build: .
    env_file: .env
    depends_on: [signal-cli-rest-api]
    ports:
      - "8090:8090"
    networks: [signalnet]

volumes:
  signal-cli-data:

networks:
  signalnet:
```

- [ ] **Step 3: Create the linking script** — `src/signal/link.ts`

```ts
import { writeFile } from 'node:fs/promises'
import { loadConfig } from './config'

async function main(): Promise<void> {
  const config = loadConfig()
  const deviceName = process.env.DEVICE_NAME ?? 'signal-web'
  const url = `${config.signalApiUrl}/v1/qrcodelink?device_name=${encodeURIComponent(deviceName)}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`qrcodelink failed: ${res.status} ${res.statusText}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile('link-qr.png', buf)

  console.log('[link] wrote link-qr.png — open it and scan from your phone:')
  console.log('[link] Signal → Settings → Linked Devices → Link New Device')
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[link] error: ${message}`)
  process.exit(1)
})
```

Note the import path: `link.ts` lives in `src/signal/`, so it imports `./config`? No — `config.ts` is in `src/`. Correct the import to `../config`.

- [ ] **Step 4: Fix the import path in `src/signal/link.ts`**

Change `import { loadConfig } from './config'` to:

```ts
import { loadConfig } from '../config'
```

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Create `.env` from the example and set the real number**

Run:
```bash
cp .env.example .env
```
Then edit `.env` and set `SIGNAL_NUMBER` to the real phone's E.164 number. (`.env` is git-ignored.)

- [ ] **Step 6: Build and start the containers**

Run: `docker compose up -d --build`
Expected: both `signal-cli-rest-api` and `app` reach running state.
Verify: `curl -s localhost:8090/health` → `{"status":"ok"}`.

- [ ] **Step 7: Generate the linking QR (from inside the app container, on the private network)**

Run:
```bash
docker compose exec app npx tsx src/signal/link.ts
docker compose cp app:/app/link-qr.png ./link-qr.png
```
Expected: `link-qr.png` appears in the project directory.

- [ ] **Step 8: Link the phone (manual)**

Open `link-qr.png`. On the phone: **Signal → Settings → Linked Devices → Link New Device**, scan the QR. Expected: a new device named `signal-web` (or your `DEVICE_NAME`) appears in Linked Devices.

- [ ] **Step 9: Prove envelopes flow (manual end-to-end)**

Run: `docker compose logs -f app`
Then, from the phone or another family member, send a message to a conversation, and also send a message **from the phone itself**.
Expected log lines (no bodies, by design):
```
[signal] envelope kind=data ts=...       # message from someone else
[signal] envelope kind=sync-sent ts=...  # message you sent from the phone
```
Seeing **both** `data` and `sync-sent` confirms the own-sent path works — the key correctness proof for this milestone.

- [ ] **Step 10: Write `README.md` (linking runbook)**

````markdown
# Signal Web

Self-hosted web client that links to Signal (via signal-cli) so a single user can read
and send messages from a browser. See the design spec in
`docs/superpowers/specs/` and the roadmap in `docs/superpowers/plans/`.

## Prerequisites
- Docker + Docker Compose
- A phone with Signal installed (stays the primary device)

## First-time setup
1. `cp .env.example .env` and set `SIGNAL_NUMBER` (E.164, e.g. `+15551234567`).
2. `docker compose up -d --build`
3. Generate and scan the linking QR:
   ```bash
   docker compose exec app npx tsx src/signal/link.ts
   docker compose cp app:/app/link-qr.png ./link-qr.png
   ```
   Open `link-qr.png` and scan: **Signal → Settings → Linked Devices → Link New Device**.
4. `docker compose logs -f app` — send a test message; you should see
   `envelope kind=data` (inbound) and `envelope kind=sync-sent` (sent from your phone).

## Notes
- A linked device only receives messages from the moment of linking forward; there is no
  history backfill.
- To unlink: Signal → Settings → Linked Devices → remove `signal-web`.
- Logs never contain message bodies or phone numbers by design.
````

- [ ] **Step 11: Commit**

```bash
git add Dockerfile docker-compose.yml src/signal/link.ts README.md
git commit -m "feat: containers, device linking, and e2e envelope proof"
```

---

## Milestone 1 Done — Definition of Done

- `npm test` passes (server, config, envelopes, receiver).
- `npm run typecheck` clean.
- `docker compose up -d --build` runs both services.
- The phone links successfully as `signal-web`.
- `docker compose logs -f app` shows both `kind=data` and `kind=sync-sent` envelopes.

Next: **Milestone 2 — Signal adapter & encrypted store** (SQLCipher via
`better-sqlite3-multiple-ciphers`, full data model, ingest all envelope types with dedup
and edit/delete handling, fixture-replay tests). Its plan is written when M1 is complete.

## Self-Review notes (author)

- **Spec coverage (M1 slice):** container topology (§4), json-rpc engine + linking (§13,
  §3), own-sent sync classification (§5.2/§6), log hygiene (§9) — all present. Encrypted
  store, auth, API, frontend, retention, Cloudflare are later milestones by design.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code.
- **Type consistency:** `buildServer`, `loadConfig`/`AppConfig`, `classifyEnvelope`/
  `EnvelopeKind`/`RawEnvelope`, `SignalReceiver`/`ReceiverEvent`/`receiveUrl` are used with
  identical names/signatures across tasks. `link.ts` import path corrected in Task 6 Step 4.
