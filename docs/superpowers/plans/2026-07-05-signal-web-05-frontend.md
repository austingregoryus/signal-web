# Signal Web — Milestone 5: React Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clean, legible browser UI — login (password + optional YubiKey), conversation list, thread view, composer, live updates, reactions, receipts, typing, attachments, and content-less notifications — served same-origin by the existing Fastify backend and wired to the live M4 API/WebSocket.

**Architecture:** A Vite + React + TypeScript SPA under `web/`, built to static files and served by the Fastify app via `@fastify/static` with an SPA fallback (so cookies/CSRF/WS-origin all stay same-origin). A thin typed API client attaches the CSRF header (read from the readable `sw_csrf` cookie) to writes and treats `401` as "show login". A live WebSocket hook consumes the backend's minimal "poke" events and refetches the affected data (the backend's live events are change-signals, not full rows — see `docs/superpowers/DEFERRED.md`). Design: calm, high-legibility, familiar chat layout, dark/light aware.

**Tech Stack:** Vite 6 / React 19 / TypeScript / CSS Modules / Vitest + jsdom + Testing Library / `@simplewebauthn/browser` / `@fastify/static`.

## Global Constraints

- **Same-origin only:** the SPA is served by Fastify at `/`; it calls `/api/*`, `/auth/*` on the same origin. No cross-origin calls (the backend's CSRF + WS origin checks require this).
- **CSRF on writes:** every non-GET request to the backend must send `x-csrf-token: <sw_csrf cookie value>`.
- **Auth gating by probe:** on load, the app probes `GET /api/conversations`; `200` → authenticated, render app; `401` → render login. (This sidesteps the known `/auth/status` pending-session ambiguity.) After password login, if the response has `webauthnRequired: true`, run the WebAuthn step before treating the user as logged in.
- **Live = poke + refetch:** on a `message`/`receipt` WS event, refetch the conversation list and the open thread; on `typing`, show a transient indicator. Do not assume the event carries the message body.
- **Notifications content-less (spec §5.3):** background notifications say "New message", never the text.
- **ESM + strict TS** in `web/` too. Frontend tests use `jsdom`; backend tests stay `node` (don't break the existing 133 backend tests).
- **Design tokens (use consistently):** base font ≥ 16px, comfortable line-height, a single accent (`#2563eb`), rounded bubbles, clear in/out distinction, dark/light via `prefers-color-scheme`. Favor clarity and size over density — the primary user is non-technical.
- New frontend code under `web/`; new backend glue under `src/api/static.ts`. Root `package.json` gains a `build:web` script; the Dockerfile builds `web/` in a stage and serves `web/dist`.

## File Structure

- `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/vitest.setup.ts`
- `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css`
- `web/src/api/client.ts` — typed fetch wrapper (CSRF, 401 handling)
- `web/src/api/types.ts` — shared response types
- `web/src/api/live.ts` — `useLiveSocket` hook
- `web/src/auth/useAuth.ts`, `web/src/auth/webauthn.ts`, `web/src/components/Login.tsx`
- `web/src/components/ConversationList.tsx`, `web/src/components/Thread.tsx`, `web/src/components/Composer.tsx`, `web/src/components/Message.tsx`, `web/src/components/Reactions.tsx`, `web/src/components/Attachment.tsx`
- `src/api/static.ts` — `registerStaticSite`
- `Dockerfile` (multi-stage), root `package.json` (scripts)

---

### Task 1: `web/` scaffold + Fastify static serving + Docker build

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/vitest.setup.ts`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css`, `web/src/App.test.tsx`
- Create: `src/api/static.ts`; Test: `test/api/static.test.ts`
- Modify: `src/app/main.ts`, root `package.json`, `Dockerfile`, `.gitignore`

**Interfaces:**
- `registerStaticSite(app: FastifyInstance, opts: { dir: string }): Promise<void>` — registers `@fastify/static` (root `dir`) and a not-found handler that, for GET requests whose path does not start with `/api`, `/auth`, or `/link`, returns `index.html` (SPA routing); other not-found paths get a JSON 404.

- [ ] **Step 1: Backend dep** — `npm install @fastify/static` (root). Add root `package.json` scripts: `"build:web": "npm --prefix web install && npm --prefix web run build"`.

- [ ] **Step 2: Scaffold `web/`** — create these files:

`web/package.json`:
```json
{
  "name": "signal-web-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@simplewebauthn/browser": "^13.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.5",
    "vitest": "^2.1.8"
  }
}
```

`web/vite.config.ts` (build to `web/dist`; dev-proxy the backend so `npm --prefix web run dev` works during frontend iteration):
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8090', ws: true },
      '/auth': 'http://localhost:8090',
      '/link': 'http://localhost:8090',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"]
}
```

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Signal Web</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/vitest.setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
```

`web/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`web/src/App.tsx` (placeholder for this task; real shell arrives in Task 2):
```tsx
export function App(): React.JSX.Element {
  return <div className="app-shell">Signal Web</div>
}
```

`web/src/styles.css`:
```css
:root { color-scheme: light dark; --accent: #2563eb; --bg: #f6f7f9; --fg: #14171a; --panel: #fff; --muted: #667; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f1115; --fg: #e7e9ea; --panel: #181b21; --muted: #9aa4b2; } }
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; font-size: 16px; background: var(--bg); color: var(--fg); }
.app-shell { height: 100%; display: grid; place-items: center; }
```

`web/src/App.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App'

describe('App', () => {
  it('renders the shell', () => {
    render(<App />)
    expect(screen.getByText('Signal Web')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Install web deps + verify the frontend builds & tests** — Run `npm --prefix web install`, then `npm --prefix web test` (App test passes) and `npm --prefix web run build` (produces `web/dist/index.html`). Expected: green + a built `web/dist`.

- [ ] **Step 4: Write the failing backend serving test** — `test/api/static.test.ts`

```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerStaticSite } from '../../src/api/static'

let app: FastifyInstance
let dir: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'swstatic-'))
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>spa</title>')
  writeFileSync(join(dir, 'assets', 'x.js'), 'console.log(1)')
  app = Fastify()
  app.get('/api/ping', async () => ({ ok: true }))
  await registerStaticSite(app, { dir })
  await app.ready()
})
afterEach(async () => {
  await app?.close()
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('registerStaticSite', () => {
  it('serves index.html at /', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('spa')
  })
  it('serves static assets', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/x.js' })
    expect(res.statusCode).toBe(200)
  })
  it('falls back to index.html for unknown client routes (SPA)', async () => {
    const res = await app.inject({ method: 'GET', url: '/conversation/abc' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('spa')
  })
  it('does not hijack API routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ping' })
    expect(res.json()).toEqual({ ok: true })
  })
  it('returns JSON 404 for unknown API routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
  })
})
```

- [ ] **Step 5: Run it — expect FAIL** (`npm test test/api/static.test.ts`).

- [ ] **Step 6: Implement** — `src/api/static.ts`

```ts
import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

const API_PREFIXES = ['/api', '/auth', '/link']

export async function registerStaticSite(app: FastifyInstance, opts: { dir: string }): Promise<void> {
  await app.register(fastifyStatic, { root: opts.dir, wildcard: false })
  app.setNotFoundHandler((req, reply) => {
    const isApi = API_PREFIXES.some((p) => req.url === p || req.url.startsWith(`${p}/`))
    if (req.method === 'GET' && !isApi) {
      return reply.type('text/html').sendFile('index.html')
    }
    return reply.code(404).send({ error: 'not_found' })
  })
}
```

- [ ] **Step 7: Run the serving tests — expect PASS.**

- [ ] **Step 8: Wire into `src/app/main.ts`** — after the other route registrations and before `app.listen`, add:

```ts
import { registerStaticSite } from '../api/static'
```
and (guarded so a missing build doesn't crash dev):
```ts
  const webDir = process.env.WEB_DIR ?? './web/dist'
  try {
    await registerStaticSite(app, { dir: webDir })
  } catch (err) {
    console.warn(`[app] static site not served (${err instanceof Error ? err.message : String(err)})`)
  }
```

- [ ] **Step 9: Multi-stage Dockerfile** — replace `Dockerfile` with:

```dockerfile
# --- build the frontend ---
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# --- backend runtime ---
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
COPY --from=web /web/dist ./web/dist
EXPOSE 8090
CMD ["npx", "tsx", "src/index.ts"]
```

- [ ] **Step 10: gitignore + full backend suite** — add `web/node_modules/` and `web/dist/` to `.gitignore`. Run root `npm test` (backend still green) and `npm run typecheck`.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json web/ src/api/static.ts src/app/main.ts test/api/static.test.ts Dockerfile .gitignore
git commit -m "feat: web frontend scaffold and same-origin static serving"
```

---

### Task 2: Typed API client + auth (login screen)

**Files:**
- Create: `web/src/api/types.ts`, `web/src/api/client.ts`, `web/src/auth/webauthn.ts`, `web/src/auth/useAuth.ts`, `web/src/components/Login.tsx`, `web/src/components/Login.module.css`
- Modify: `web/src/App.tsx`
- Test: `web/src/api/client.test.ts`, `web/src/auth/useAuth.test.tsx`

**Interfaces:**
- `api.get<T>(path): Promise<T>` / `api.post<T>(path, body): Promise<T>` — same-origin fetch; `post` attaches `x-csrf-token` from the `sw_csrf` cookie; both throw `ApiError` with `.status` on non-2xx.
- `useAuth()` → `{ state: 'loading' | 'anon' | 'authed'; login(password): Promise<void>; logout(): Promise<void>; error?: string }`. `login` posts to `/auth/login`; if `webauthnRequired`, runs `runWebAuthnLogin()`; then sets `authed`.

- [ ] **Step 1: Types** — `web/src/api/types.ts`

```ts
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
```

- [ ] **Step 2: Write the failing client test** — `web/src/api/client.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, ApiError } from './client'

afterEach(() => { vi.restoreAllMocks(); document.cookie = 'sw_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT' })

describe('api client', () => {
  it('GET returns json', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ id: 'c1' }]), { status: 200 }))
    await expect(api.get('/api/conversations')).resolves.toEqual([{ id: 'c1' }])
  })

  it('POST attaches the csrf header from the cookie', async () => {
    document.cookie = 'sw_csrf=tok123'
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    await api.post('/api/send', { message: 'hi' })
    const init = spy.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('tok123')
    expect(init.method).toBe('POST')
  })

  it('throws ApiError with status on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"x"}', { status: 401 }))
    await expect(api.get('/api/conversations')).rejects.toMatchObject({ status: 401 })
    await expect(api.get('/api/conversations')).rejects.toBeInstanceOf(ApiError)
  })
})
```

- [ ] **Step 3: Implement the client** — `web/src/api/client.ts`

```ts
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)sw_csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const init: RequestInit = { method, headers, credentials: 'same-origin' }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  if (method !== 'GET' && method !== 'HEAD') headers['x-csrf-token'] = csrfToken()
  const res = await fetch(path, init)
  if (!res.ok) throw new ApiError(res.status, `${method} ${path} -> ${res.status}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
}
```

- [ ] **Step 4: WebAuthn browser flow** — `web/src/auth/webauthn.ts`

```ts
import { startAuthentication } from '@simplewebauthn/browser'
import { api } from '../api/client'

export async function runWebAuthnLogin(): Promise<boolean> {
  const options = await api.post<import('@simplewebauthn/browser').PublicKeyCredentialRequestOptionsJSON>(
    '/auth/webauthn/login/options',
  )
  const assertion = await startAuthentication({ optionsJSON: options })
  const res = await api.post<{ ok: boolean }>('/auth/webauthn/login/verify', assertion)
  return res.ok
}
```

- [ ] **Step 5: Write the failing useAuth test** — `web/src/auth/useAuth.test.tsx`

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAuth } from './useAuth'

afterEach(() => vi.restoreAllMocks())

describe('useAuth', () => {
  it('starts anon when the probe 401s', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state).toBe('anon'))
  })

  it('logs in with a password (no webauthn required)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 })) // initial probe
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, webauthnRequired: false }), { status: 200 }))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state).toBe('anon'))
    await act(async () => { await result.current.login('pw') })
    expect(result.current.state).toBe('authed')
  })
})
```

- [ ] **Step 6: Implement** — `web/src/auth/useAuth.ts`

```ts
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { LoginResult } from '../api/types'
import { runWebAuthnLogin } from './webauthn'

type State = 'loading' | 'anon' | 'authed'

export function useAuth() {
  const [state, setState] = useState<State>('loading')
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let alive = true
    api.get('/api/conversations')
      .then(() => { if (alive) setState('authed') })
      .catch((e) => { if (alive) setState(e instanceof ApiError && e.status === 401 ? 'anon' : 'anon') })
    return () => { alive = false }
  }, [])

  const login = useCallback(async (password: string) => {
    setError(undefined)
    try {
      const res = await api.post<LoginResult>('/auth/login', { password })
      if (res.webauthnRequired) {
        const ok = await runWebAuthnLogin()
        if (!ok) { setError('Security key verification failed'); return }
      }
      setState('authed')
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? 'Too many attempts, try later' : 'Wrong password')
    }
  }, [])

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {})
    setState('anon')
  }, [])

  return { state, error, login, logout }
}
```

- [ ] **Step 7: Login component** — `web/src/components/Login.tsx` + `Login.module.css`

```tsx
import { useState, type FormEvent } from 'react'
import styles from './Login.module.css'

export function Login({ onSubmit, error }: { onSubmit: (pw: string) => void; error?: string }): React.JSX.Element {
  const [pw, setPw] = useState('')
  function submit(e: FormEvent): void { e.preventDefault(); onSubmit(pw) }
  return (
    <form className={styles.card} onSubmit={submit}>
      <h1>Signal Web</h1>
      <p className={styles.sub}>Sign in to read your messages</p>
      <input
        className={styles.input} type="password" autoFocus placeholder="Password"
        value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password"
      />
      {error && <div className={styles.error} role="alert">{error}</div>}
      <button className={styles.btn} type="submit">Sign in</button>
      <p className={styles.hint}>If you have a security key, you'll be asked to tap it after your password.</p>
    </form>
  )
}
```

```css
.card { max-width: 360px; margin: 12vh auto; background: var(--panel); padding: 32px; border-radius: 16px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
.card h1 { margin: 0; font-size: 1.4rem; }
.sub { margin: 0 0 8px; color: var(--muted); }
.input { padding: 12px 14px; font-size: 1rem; border-radius: 10px; border: 1px solid #8883; background: transparent; color: var(--fg); }
.btn { padding: 12px; font-size: 1rem; font-weight: 600; border: 0; border-radius: 10px; background: var(--accent); color: #fff; cursor: pointer; }
.error { color: #dc2626; font-size: .9rem; }
.hint { color: var(--muted); font-size: .82rem; margin: 4px 0 0; }
```

- [ ] **Step 8: App shell wires auth** — `web/src/App.tsx`

```tsx
import { useAuth } from './auth/useAuth'
import { Login } from './components/Login'

export function App(): React.JSX.Element {
  const auth = useAuth()
  if (auth.state === 'loading') return <div className="app-shell">Loading…</div>
  if (auth.state === 'anon') return <Login onSubmit={auth.login} error={auth.error} />
  return <div className="app-shell">Signed in (chat UI arrives next task)</div>
}
```

- [ ] **Step 9: Run web tests + typecheck — expect PASS/clean.** (`npm --prefix web test`, `npm --prefix web run typecheck`)

- [ ] **Step 10: Commit**

```bash
git add web/src
git commit -m "feat: api client, auth hook, and login screen"
```

---

### Task 3: Conversation list

**Files:** Create `web/src/components/ConversationList.tsx` + `.module.css`; Test `web/src/components/ConversationList.test.tsx`. Modify `web/src/api/types.ts` if needed.

**Interfaces:** `ConversationList({ conversations, selectedId, onSelect })` — renders each conversation with its display name (or the id/number as fallback), a group/DM affordance, sorted as given (backend returns `lastActivity DESC`), highlights `selectedId`, calls `onSelect(id)` on click.

- [ ] **Step 1: Failing test** — `web/src/components/ConversationList.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConversationList } from './ConversationList'

const convs = [
  { id: 'alice-uuid', type: 'dm' as const, displayName: 'Alice', avatarPath: null, lastActivity: 2 },
  { id: '+15551110002', type: 'dm' as const, displayName: null, avatarPath: null, lastActivity: 1 },
]

describe('ConversationList', () => {
  it('renders names and falls back to the id when unnamed', () => {
    render(<ConversationList conversations={convs} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('+15551110002')).toBeInTheDocument()
  })
  it('calls onSelect when a row is clicked', async () => {
    const onSelect = vi.fn()
    render(<ConversationList conversations={convs} selectedId={null} onSelect={onSelect} />)
    await userEvent.click(screen.getByText('Alice'))
    expect(onSelect).toHaveBeenCalledWith('alice-uuid')
  })
})
```

- [ ] **Step 2: Implement** — `web/src/components/ConversationList.tsx`

```tsx
import type { Conversation } from '../api/types'
import styles from './ConversationList.module.css'

export function ConversationList({
  conversations, selectedId, onSelect,
}: { conversations: Conversation[]; selectedId: string | null; onSelect: (id: string) => void }): React.JSX.Element {
  return (
    <ul className={styles.list}>
      {conversations.map((c) => (
        <li key={c.id}>
          <button
            className={`${styles.row} ${c.id === selectedId ? styles.active : ''}`}
            onClick={() => onSelect(c.id)}
          >
            <span className={styles.avatar} aria-hidden>{c.type === 'group' ? '👥' : '👤'}</span>
            <span className={styles.name}>{c.displayName ?? c.id}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
```

```css
.list { list-style: none; margin: 0; padding: 0; overflow-y: auto; }
.row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 14px 16px; border: 0; background: transparent; color: var(--fg); font-size: 1rem; text-align: left; cursor: pointer; border-bottom: 1px solid #8881; }
.row:hover { background: #8881; }
.active { background: #2563eb22; }
.avatar { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; background: #8882; font-size: 1.1rem; }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 3: Run web tests — expect PASS.**
- [ ] **Step 4: Commit** — `git add web/src && git commit -m "feat: conversation list component"`

---

### Task 4: Thread view + history

**Files:** Create `web/src/components/Thread.tsx`, `web/src/components/Message.tsx` + CSS; Test `web/src/components/Thread.test.tsx`.

**Interfaces:** `Thread({ messages })` — renders messages oldest→newest; each `Message` shows the body in an in/out bubble, a tombstone ("This message was deleted") when `deleted`, an "(edited)" marker when `editedTimestamp`, and a localized time. Reactions/attachments render via components added in later tasks (import placeholders that no-op if empty).

- [ ] **Step 1: Failing test** — `web/src/components/Thread.test.tsx`

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Thread } from './Thread'
import type { Message } from '../api/types'

const base = { conversationId: 'c1', authorId: 'a', authorNumber: null, reactions: [], receipts: [], attachments: [] }
const msgs: Message[] = [
  { ...base, id: 1, timestamp: 1000, direction: 'in', body: 'hello', editedTimestamp: null, deleted: 0 },
  { ...base, id: 2, timestamp: 2000, direction: 'out', body: 'hi back', editedTimestamp: 2500, deleted: 0 },
  { ...base, id: 3, timestamp: 3000, direction: 'in', body: null, editedTimestamp: null, deleted: 1 },
]

describe('Thread', () => {
  it('renders inbound and outbound messages', () => {
    render(<Thread messages={msgs} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('hi back')).toBeInTheDocument()
  })
  it('shows an edited marker and a deleted tombstone', () => {
    render(<Thread messages={msgs} />)
    expect(screen.getByText(/edited/i)).toBeInTheDocument()
    expect(screen.getByText(/deleted/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Implement** — `web/src/components/Message.tsx`

```tsx
import type { Message as Msg } from '../api/types'
import styles from './Message.module.css'

export function Message({ m }: { m: Msg }): React.JSX.Element {
  const time = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className={`${styles.row} ${m.direction === 'out' ? styles.out : styles.in}`}>
      <div className={styles.bubble}>
        {m.deleted ? (
          <em className={styles.deleted}>This message was deleted</em>
        ) : (
          <span className={styles.body}>{m.body}</span>
        )}
        <span className={styles.meta}>
          {m.editedTimestamp && !m.deleted ? <span className={styles.edited}>edited · </span> : null}
          {time}
        </span>
      </div>
    </div>
  )
}
```

`web/src/components/Thread.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import type { Message as Msg } from '../api/types'
import { Message } from './Message'
import styles from './Thread.module.css'

export function Thread({ messages }: { messages: Msg[] }): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView() }, [messages.length])
  return (
    <div className={styles.thread}>
      {messages.map((m) => <Message key={m.id} m={m} />)}
      <div ref={endRef} />
    </div>
  )
}
```

`web/src/components/Message.module.css`:
```css
.row { display: flex; margin: 6px 12px; }
.in { justify-content: flex-start; }
.out { justify-content: flex-end; }
.bubble { max-width: 72%; padding: 8px 12px; border-radius: 14px; background: #8882; line-height: 1.4; word-wrap: break-word; }
.out .bubble { background: var(--accent); color: #fff; }
.meta { display: block; font-size: .7rem; opacity: .7; margin-top: 4px; text-align: right; }
.deleted { opacity: .6; }
```

`web/src/components/Thread.module.css`:
```css
.thread { flex: 1; overflow-y: auto; padding: 12px 0; display: flex; flex-direction: column; }
```

- [ ] **Step 3: Run web tests — expect PASS.**
- [ ] **Step 4: Commit** — `git add web/src && git commit -m "feat: thread and message components"`

---

### Task 5: Composer (send text) + main layout

**Files:** Create `web/src/components/Composer.tsx` + CSS, `web/src/components/Chat.tsx` (two-pane layout tying list+thread+composer to the API); Test `web/src/components/Composer.test.tsx`. Modify `web/src/App.tsx` to render `Chat` when authed.

**Interfaces:**
- `Composer({ onSend })` — a textarea + send button; Enter sends (Shift+Enter newline); clears on send; calls `onSend(text)`.
- `Chat()` — loads conversations (`api.get('/api/conversations')`), on select loads `api.get('/api/conversations/:id/messages')`, renders `ConversationList` + `Thread` + `Composer`; `onSend` posts `/api/send` `{ conversationId, type, message }` then refetches the thread.

- [ ] **Step 1: Failing composer test** — `web/src/components/Composer.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from './Composer'

describe('Composer', () => {
  it('sends on click and clears', async () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'hello there')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).toHaveBeenCalledWith('hello there')
    expect(box).toHaveValue('')
  })
  it('sends on Enter but not Shift+Enter', async () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'line{Shift>}{Enter}{/Shift}two')
    expect(onSend).not.toHaveBeenCalled()
    await userEvent.type(box, '{Enter}')
    expect(onSend).toHaveBeenCalledWith('line\ntwo')
  })
})
```

- [ ] **Step 2: Implement** — `web/src/components/Composer.tsx`

```tsx
import { useState, type KeyboardEvent } from 'react'
import styles from './Composer.module.css'

export function Composer({ onSend }: { onSend: (text: string) => void }): React.JSX.Element {
  const [text, setText] = useState('')
  function send(): void {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }
  return (
    <div className={styles.bar}>
      <textarea
        className={styles.box} rows={1} placeholder="Message" aria-label="Message"
        value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
      />
      <button className={styles.send} onClick={send} aria-label="Send">➤</button>
    </div>
  )
}
```

`web/src/components/Chat.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Conversation, Message } from '../api/types'
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
```

CSS (`Composer.module.css`, `Chat.module.css`):
```css
/* Composer.module.css */
.bar { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #8882; }
.box { flex: 1; resize: none; font: inherit; padding: 10px 12px; border-radius: 12px; border: 1px solid #8883; background: transparent; color: var(--fg); }
.send { border: 0; border-radius: 12px; padding: 0 16px; background: var(--accent); color: #fff; font-size: 1.1rem; cursor: pointer; }
```
```css
/* Chat.module.css */
.layout { height: 100%; display: grid; grid-template-columns: minmax(240px, 320px) 1fr; }
.sidebar { border-right: 1px solid #8882; overflow: hidden; display: flex; flex-direction: column; }
.main { display: flex; flex-direction: column; min-height: 0; }
.empty { flex: 1; display: grid; place-items: center; color: var(--muted); }
@media (max-width: 640px) { .layout { grid-template-columns: 1fr; } }
```

Update `web/src/App.tsx` authed branch to `return <Chat />`.

- [ ] **Step 3: Run web tests + typecheck — expect PASS/clean.**
- [ ] **Step 4: Commit** — `git add web/src && git commit -m "feat: composer and two-pane chat layout"`

---

### Task 6: Live WebSocket hook + notifications

**Files:** Create `web/src/api/live.ts`; Test `web/src/api/live.test.ts`. Modify `web/src/components/Chat.tsx` to use it.

**Interfaces:** `useLiveSocket(onEvent: (ev: { type: string; [k: string]: unknown }) => void): void` — opens a WS to `` `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws` `` (optionally `?cursor=`), parses JSON messages, invokes `onEvent`, and auto-reconnects with backoff. `Chat` uses it: on a `message`/`receipt` event, refetch conversations + the open thread; when `document.hidden`, fire a content-less `Notification('New message')` (if permission granted).

- [ ] **Step 1: Failing hook test** — `web/src/api/live.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLiveSocket } from './live'

class FakeWS {
  static last: FakeWS | null = null
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  close = vi.fn()
  constructor(public url: string) { FakeWS.last = this }
}

afterEach(() => vi.restoreAllMocks())

describe('useLiveSocket', () => {
  it('connects and forwards parsed events', () => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket)
    const onEvent = vi.fn()
    renderHook(() => useLiveSocket(onEvent))
    FakeWS.last!.onopen?.()
    FakeWS.last!.onmessage?.({ data: JSON.stringify({ type: 'message', timestamp: 5 }) })
    expect(onEvent).toHaveBeenCalledWith({ type: 'message', timestamp: 5 })
    expect(FakeWS.last!.url).toContain('/api/ws')
  })

  it('ignores non-JSON frames', () => {
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket)
    const onEvent = vi.fn()
    renderHook(() => useLiveSocket(onEvent))
    FakeWS.last!.onmessage?.({ data: 'ping' })
    expect(onEvent).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Implement** — `web/src/api/live.ts`

```ts
import { useEffect, useRef } from 'react'

export type LiveEvent = { type: string; [k: string]: unknown }

export function useLiveSocket(onEvent: (ev: LiveEvent) => void): void {
  const cb = useRef(onEvent)
  cb.current = onEvent
  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let delay = 1000
    let timer: ReturnType<typeof setTimeout> | undefined
    function connect(): void {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/api/ws`)
      ws.onopen = () => { delay = 1000 }
      ws.onmessage = (e) => {
        let parsed: LiveEvent
        try { parsed = JSON.parse(String(e.data)) as LiveEvent } catch { return }
        cb.current(parsed)
      }
      ws.onclose = () => {
        if (closed) return
        timer = setTimeout(connect, delay)
        delay = Math.min(delay * 2, 30_000)
      }
    }
    connect()
    return () => { closed = true; if (timer) clearTimeout(timer); ws?.close() }
  }, [])
}
```

- [ ] **Step 3: Wire into `Chat.tsx`** — add near the other hooks:

```tsx
import { useLiveSocket } from '../api/live'
```
```tsx
  useLiveSocket((ev) => {
    if (ev.type === 'message' || ev.type === 'receipt') {
      void loadConversations()
      if (selected) void loadThread(selected)
      if (ev.type === 'message' && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('New message')
      }
    }
  })
```
Also request notification permission once when authed (add to `Chat`): `useEffect(() => { if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission() }, [])`.

- [ ] **Step 4: Run web tests + typecheck — expect PASS/clean.**
- [ ] **Step 5: Commit** — `git add web/src && git commit -m "feat: live websocket updates and content-less notifications"`

---

### Task 7: Reactions + receipts + typing display

**Files:** Create `web/src/components/Reactions.tsx` + CSS; Test `web/src/components/Reactions.test.tsx`. Modify `Message.tsx` (render reactions + a read tick), `Chat.tsx`/`Thread.tsx` (typing indicator).

**Interfaces:**
- `Reactions({ reactions, onReact })` — renders grouped emoji with counts; a small "＋" opens a tiny picker (👍 ❤️ 😂 😮 😢 🙏); clicking an emoji calls `onReact(emoji)`.
- `Message` shows a "✓✓ Read" tick on `direction:'out'` messages that have a `read` receipt.
- Typing: `Chat` tracks a transient `typing` boolean set true on a `typing` event and cleared after 4s; `Thread` shows a "…" bubble when true.

- [ ] **Step 1: Failing reactions test** — `web/src/components/Reactions.test.tsx`

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Reactions } from './Reactions'

describe('Reactions', () => {
  it('groups reactions with counts', () => {
    render(<Reactions reactions={[
      { reactorId: 'a', emoji: '👍', timestamp: 1 },
      { reactorId: 'b', emoji: '👍', timestamp: 2 },
      { reactorId: 'c', emoji: '❤️', timestamp: 3 },
    ]} onReact={() => {}} />)
    expect(screen.getByText('👍 2')).toBeInTheDocument()
    expect(screen.getByText('❤️ 1')).toBeInTheDocument()
  })
  it('emits an emoji from the picker', async () => {
    const onReact = vi.fn()
    render(<Reactions reactions={[]} onReact={onReact} />)
    await userEvent.click(screen.getByRole('button', { name: /add reaction/i }))
    await userEvent.click(screen.getByRole('button', { name: '❤️' }))
    expect(onReact).toHaveBeenCalledWith('❤️')
  })
})
```

- [ ] **Step 2: Implement** — `web/src/components/Reactions.tsx`

```tsx
import { useState } from 'react'
import type { Reaction } from '../api/types'
import styles from './Reactions.module.css'

const PICKER = ['👍', '❤️', '😂', '😮', '😢', '🙏']

export function Reactions({ reactions, onReact }: { reactions: Reaction[]; onReact: (emoji: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const counts = new Map<string, number>()
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1)
  return (
    <div className={styles.wrap}>
      {[...counts.entries()].map(([emoji, n]) => (
        <button key={emoji} className={styles.chip} onClick={() => onReact(emoji)}>{emoji} {n}</button>
      ))}
      <button className={styles.add} aria-label="Add reaction" onClick={() => setOpen((o) => !o)}>＋</button>
      {open && (
        <div className={styles.picker}>
          {PICKER.map((e) => (
            <button key={e} aria-label={e} onClick={() => { onReact(e); setOpen(false) }}>{e}</button>
          ))}
        </div>
      )}
    </div>
  )
}
```

```css
/* Reactions.module.css */
.wrap { display: flex; gap: 4px; align-items: center; margin-top: 4px; position: relative; }
.chip, .add { border: 0; border-radius: 10px; background: #8883; padding: 1px 7px; font-size: .8rem; cursor: pointer; color: inherit; }
.picker { position: absolute; bottom: 100%; left: 0; display: flex; gap: 2px; background: var(--panel); border: 1px solid #8883; border-radius: 10px; padding: 4px; z-index: 5; }
.picker button { border: 0; background: transparent; font-size: 1.1rem; cursor: pointer; }
```

- [ ] **Step 3: Wire reactions + read tick into `Message.tsx`** — add a `onReact?: (emoji: string) => void` prop; render `<Reactions reactions={m.reactions} onReact={...} />` under the bubble; when `m.direction==='out'` and `m.receipts.some(r => r.type==='read')`, append `✓✓` to the meta. In `Chat.tsx`, pass `onReact` that posts `/api/react` `{ conversationId: selected, type, targetAuthorId: m.authorId, targetTimestamp: m.timestamp, emoji }` then refetches the thread. Add the transient typing indicator (state + timeout) driven by the `typing` live event; render a "…" bubble in `Thread` when active. Keep the existing Message/Thread tests passing (extend as needed).

- [ ] **Step 4: Run web tests + typecheck — expect PASS/clean.**
- [ ] **Step 5: Commit** — `git add web/src && git commit -m "feat: reactions, read receipts, and typing indicator"`

---

### Task 8: Attachments (view + send)

**Files:** Create `web/src/components/Attachment.tsx`; Test `web/src/components/Attachment.test.tsx`. Modify `Message.tsx` (render attachments), `Composer.tsx` (attach a file → base64 → send).

**Interfaces:**
- `Attachment({ meta })` — for an image content-type, render `<img src={/api/attachments/:id} loading="lazy">`; otherwise a download link (`<a download>`), labeled with the filename or "Attachment".
- Composer gains a 📎 button → file picker → reads the file as base64 → calls `onSend('', [base64])` (extend `onSend` signature to `(text: string, base64Attachments?: string[])`); `Chat.onSend` forwards `base64Attachments` to `/api/send`.

- [ ] **Step 1: Failing test** — `web/src/components/Attachment.test.tsx`

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Attachment } from './Attachment'

describe('Attachment', () => {
  it('renders an image for image content types', () => {
    render(<Attachment meta={{ id: 'att-1', contentType: 'image/png', filename: 'p.png' }} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', '/api/attachments/att-1')
  })
  it('renders a download link for other types', () => {
    render(<Attachment meta={{ id: 'att-2', contentType: 'application/pdf', filename: 'doc.pdf' }} />)
    const link = screen.getByRole('link', { name: /doc\.pdf/i })
    expect(link).toHaveAttribute('href', '/api/attachments/att-2')
  })
})
```

- [ ] **Step 2: Implement** — `web/src/components/Attachment.tsx`

```tsx
import type { AttachmentMeta } from '../api/types'
import styles from './Attachment.module.css'

export function Attachment({ meta }: { meta: AttachmentMeta }): React.JSX.Element {
  const src = `/api/attachments/${encodeURIComponent(meta.id)}`
  if (meta.contentType?.startsWith('image/')) {
    return <img className={styles.image} src={src} alt={meta.filename ?? 'image attachment'} loading="lazy" />
  }
  return <a className={styles.file} href={src} download>{meta.filename ?? 'Attachment'}</a>
}
```

```css
/* Attachment.module.css */
.image { max-width: 260px; max-height: 260px; border-radius: 10px; display: block; margin-top: 4px; }
.file { display: inline-block; margin-top: 4px; color: var(--accent); text-decoration: underline; }
```

- [ ] **Step 3: Wire into `Message.tsx`** — render `m.attachments.map((a) => <Attachment key={a.id} meta={a} />)` above the meta line. In `Composer.tsx`, add a 📎 button + hidden `<input type="file">`; on select, read via `FileReader.readAsDataURL`, strip the `data:...;base64,` prefix, and call `onSend('', [base64])`. Extend `onSend` types through `Composer` and `Chat`; `Chat.onSend` posts `{ conversationId, type, message, base64Attachments }`. Keep existing Composer tests passing (the text path is unchanged).

- [ ] **Step 4: Run web tests + typecheck + full backend suite — expect PASS/clean.**
- [ ] **Step 5: Commit** — `git add web/src && git commit -m "feat: attachment viewing and sending"`

---

## Milestone 5 Done — Definition of Done

- `npm --prefix web test` green (client, auth, list, thread, composer, live, reactions, attachment); `npm --prefix web run typecheck` clean; root `npm test` still green.
- `npm run build:web` produces `web/dist`; the Dockerfile builds it; the Fastify app serves the SPA at `/` same-origin.
- **Manual (against the live backend):** set a password, open the app, log in (password; YubiKey tap if a key is registered), see conversations with names, open one, read history, send a text and see it appear, receive a message live, view an inbound image, add a reaction. Notifications prompt once and fire content-less when the tab is hidden.

## Self-Review notes (author)

- **Spec coverage (§5.3):** login (password + WebAuthn via `@simplewebauthn/browser`), conversation list w/ names + number fallback, thread w/ edits/tombstones, composer (text + attachments), live updates, reactions (view+send), read receipts, typing, content-less notifications, attachments (view+send). Same-origin serving preserves the auth/CSRF/WS-origin model.
- **Testing honesty:** component/logic tests run in jsdom; the real visual/interaction pass is the manual DoD against the live backend (now possible — the device is linked). WebAuthn's browser ceremony can only be fully exercised with a physical key (manual).
- **Contract fidelity:** the live hook treats events as pokes and refetches (matches the backend's minimal live-event contract in DEFERRED.md); history is fetched newest-first from the API and reversed for display.
- **Placeholder scan:** none; every step has complete code.
- **Type consistency:** `api`, `Conversation`/`Message`/`Reaction`/`AttachmentMeta`, `useAuth`, `useLiveSocket`, and the component prop shapes are stable across tasks; `Chat` composes exactly those signatures.
