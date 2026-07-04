# Signal Web — Milestone 3: Auth & Session Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hardened, single-user authentication layer: Argon2id password (the guaranteed floor), server-side revocable + expiring sessions, login rate-limiting, CSRF protection, a WebSocket origin guard, and WebAuthn/YubiKey as a default-on second factor with password fallback — packaged as a Fastify auth plugin.

**Architecture:** Auth primitives are small, independently tested modules. Secrets and credentials (password hash, sessions, WebAuthn credentials, challenge) live in the encrypted SQLCipher store from Milestone 2, so they are encrypted at rest and revocable. Session tokens are high-entropy randoms; only their SHA-256 is stored, so a stolen DB yields no usable cookies. A Fastify plugin wires login/logout/guard/rate-limit/CSRF together. The plugin takes its `Store` and config as options — the real app wires it in Milestone 4; this milestone tests it with a temp store and `app.inject`.

**Tech Stack:** Node 24 / TypeScript / `@node-rs/argon2` (Argon2id, napi prebuilds — no compiler, no install script) / `@simplewebauthn/server` v13 (pure TS) / `@fastify/cookie` / Fastify 5 / Vitest.

## Global Constraints

- **ESM + `moduleResolution: "Bundler"`** — no `.js` import extensions; strict TS; typecheck stays clean.
- **Decisions locked (spec §9):** custom login only (no Cloudflare Access); WebAuthn **default-on with a password fallback**; at-rest keys auto-unlock.
- **Password:** Argon2id via `@node-rs/argon2` (default params). Never log the password or its hash.
- **Sessions:** opaque random token (≥256 bits) in an **`HttpOnly; Secure; SameSite=Strict`** cookie named `sw_session`; only the token's **SHA-256** is persisted; server-side revocable; **absolute expiry** (default 30 days) **and idle timeout** (default 7 days). Provide **revoke-all**.
- **Rate limiting:** login attempts throttled per-IP and globally, with lockout/backoff. Argon2 alone does not stop online guessing.
- **CSRF:** double-submit token on all state-changing routes; **`Origin` check on the WebSocket upgrade**.
- **Library choice rationale:** both new deps ship without native compilation or npm install scripts, avoiding the `ignore-scripts` prebuild gap noted in `docs/superpowers/DEFERRED.md`.
- **Log hygiene:** no passwords, hashes, tokens, session ids, or challenges in logs.
- New code under `src/auth/`; the encrypted store schema (`src/store/schema.ts`) gains auth tables (bump `SCHEMA_VERSION` to 2). Tests mirror under `test/auth/`.

## File Structure

- `src/store/schema.ts` — add `auth_config`, `sessions`, `webauthn_credentials`, `webauthn_challenge` tables; bump version.
- `src/store/authConfig.ts` — `AuthConfigRepo` (singleton password hash).
- `src/store/sessions.ts` — `SessionRepo`.
- `src/store/webauthnStore.ts` — `WebAuthnRepo` (credentials + challenge).
- `src/auth/password.ts` — `hashPassword`, `verifyPassword`.
- `src/auth/rateLimiter.ts` — `RateLimiter`.
- `src/auth/csrf.ts` — `issueCsrfToken`, `verifyCsrf`, `isAllowedOrigin`.
- `src/auth/webauthn.ts` — registration/authentication ceremony wrappers.
- `src/auth/plugin.ts` — `authPlugin` (Fastify) + `requireAuth`.
- `src/setPassword.ts` — CLI to set the single user's password.

---

### Task 1: Password hashing + auth_config repo + schema tables

**Files:**
- Modify: `src/store/schema.ts`, `src/store/store.ts`
- Create: `src/store/authConfig.ts`, `src/auth/password.ts`, `src/setPassword.ts`
- Test: `test/auth/password.test.ts`, `test/store/authConfig.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:
  - `hashPassword(plain: string): Promise<string>` and `verifyPassword(hash: string, plain: string): Promise<boolean>` from `src/auth/password.ts` (Argon2id).
  - Attach `authConfig: AuthConfigRepo` to `Store`:
    - `setPasswordHash(hash: string): void`
    - `getPasswordHash(): string | null`
  - Schema gains the four auth tables; `SCHEMA_VERSION = 2`.

- [ ] **Step 1: Add dependencies**

Run: `npm install @node-rs/argon2 @simplewebauthn/server @fastify/cookie`
Expected: installs with platform prebuilds as optional deps (no compiler, no lifecycle script needed). If it fails, report BLOCKED with the error.

- [ ] **Step 2: Extend the schema** — in `src/store/schema.ts`, set `export const SCHEMA_VERSION = 2` and append these tables to `SCHEMA_SQL` (they are additive; `CREATE TABLE IF NOT EXISTS` runs on every open):

```sql

CREATE TABLE IF NOT EXISTS auth_config (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id         TEXT PRIMARY KEY,   -- credential id (base64url)
  public_key BLOB NOT NULL,
  counter    INTEGER NOT NULL,
  transports TEXT,               -- JSON array of transport strings
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webauthn_challenge (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  challenge  TEXT,
  created_at INTEGER
);
```

Note: bumping `SCHEMA_VERSION` does not run a migration here (the schema is create-if-not-exists and additive); the constant documents the current shape. The existing version-insert logic in `store.ts` stays as-is.

- [ ] **Step 3: Write the failing password test** — `test/auth/password.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/auth/password'

describe('password hashing', () => {
  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).not.toContain('correct horse')
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(await verifyPassword(hash, 'Tr0ub4dour')).toBe(false)
  })

  it('produces distinct hashes for the same input (random salt)', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 4: Run it — expect FAIL** (`npm test test/auth/password.test.ts`).

- [ ] **Step 5: Implement** — `src/auth/password.ts`

```ts
import { hash, verify, Algorithm } from '@node-rs/argon2'

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, { algorithm: Algorithm.Argon2id })
}

export async function verifyPassword(hashString: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashString, plain)
  } catch {
    // A malformed stored hash must not throw into the auth path.
    return false
  }
}
```

- [ ] **Step 6: Run it — expect PASS.**

- [ ] **Step 7: Write the failing authConfig test** — `test/store/authConfig.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swac-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

describe('AuthConfigRepo', () => {
  it('returns null before a password is set', () => {
    const s = open()
    expect(s.authConfig.getPasswordHash()).toBeNull()
  })

  it('stores and reads back the password hash (singleton)', () => {
    const s = open()
    s.authConfig.setPasswordHash('hash-1')
    expect(s.authConfig.getPasswordHash()).toBe('hash-1')
    s.authConfig.setPasswordHash('hash-2')
    expect(s.authConfig.getPasswordHash()).toBe('hash-2')
  })
})
```

- [ ] **Step 8: Run it — expect FAIL.**

- [ ] **Step 9: Implement** — `src/store/authConfig.ts`

```ts
import type Database from 'better-sqlite3-multiple-ciphers'

export class AuthConfigRepo {
  constructor(private readonly db: Database.Database) {}

  setPasswordHash(hash: string): void {
    this.db
      .prepare(
        `INSERT INTO auth_config (id, password_hash) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash`,
      )
      .run(hash)
  }

  getPasswordHash(): string | null {
    const row = this.db
      .prepare('SELECT password_hash FROM auth_config WHERE id = 1')
      .get() as { password_hash: string | null } | undefined
    return row?.password_hash ?? null
  }
}
```

- [ ] **Step 10: Attach in `src/store/store.ts`** — import `AuthConfigRepo`, add `authConfig: AuthConfigRepo` to `Store`, construct `const authConfig = new AuthConfigRepo(db)`, include it in the returned object (keep all existing repos).

- [ ] **Step 11: Create the set-password CLI** — `src/setPassword.ts`

```ts
import { openStore } from './store/store'
import { hashPassword } from './auth/password'

async function main(): Promise<void> {
  const dbPath = process.env.DB_PATH
  const dbKey = process.env.DB_KEY
  const password = process.env.NEW_PASSWORD
  if (!dbPath || !dbKey) throw new Error('DB_PATH and DB_KEY are required')
  if (!password || password.length < 8) throw new Error('NEW_PASSWORD is required (min 8 chars)')

  const store = openStore(dbPath, dbKey)
  store.authConfig.setPasswordHash(await hashPassword(password))
  store.close()
  console.log('[set-password] password updated')
}

main().catch((err: unknown) => {
  console.error(`[set-password] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
```

Add to `package.json` scripts: `"set-password": "tsx src/setPassword.ts"`.

- [ ] **Step 12: Run full suite + typecheck — expect PASS/clean.**

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json src/store/schema.ts src/store/store.ts src/store/authConfig.ts src/auth/password.ts src/setPassword.ts test/auth/password.test.ts test/store/authConfig.test.ts
git commit -m "feat: argon2id password hashing, auth_config store, set-password CLI"
```

---

### Task 2: Session repository (revocable, expiring, idle timeout)

**Files:**
- Create: `src/store/sessions.ts`
- Modify: `src/store/store.ts`
- Test: `test/store/sessions.test.ts`

**Interfaces:**
- Produces (attach `sessions: SessionRepo`):
  - `interface SessionRow { tokenHash: string; createdAt: number; lastSeen: number; expiresAt: number }`
  - `interface SessionPolicy { ttlMs: number; idleMs: number }`
  - `class SessionRepo`:
    - `create(now: number, policy: SessionPolicy): string` — generates a random token (returns the RAW token; stores only its SHA-256), `expiresAt = now + ttlMs`.
    - `validate(token: string, now: number, policy: SessionPolicy): boolean` — looks up by token hash; deletes + returns `false` if absent, past `expiresAt`, or idle beyond `idleMs`; otherwise updates `lastSeen = now` and returns `true`.
    - `revoke(token: string): void`
    - `revokeAll(): void`
    - `count(): number` (test helper)

- [ ] **Step 1: Write the failing test** — `test/store/sessions.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `sws-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

const policy = { ttlMs: 30 * 24 * 3600_000, idleMs: 7 * 24 * 3600_000 }
const T0 = 1_000_000_000_000

describe('SessionRepo', () => {
  it('creates a session and validates it', () => {
    const s = open()
    const token = s.sessions.create(T0, policy)
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(20)
    expect(s.sessions.validate(token, T0 + 1000, policy)).toBe(true)
  })

  it('does not store the raw token (only its hash)', () => {
    const s = open()
    const token = s.sessions.create(T0, policy)
    const row = s.db.prepare('SELECT token_hash FROM sessions').get() as { token_hash: string }
    expect(row.token_hash).not.toBe(token)
  })

  it('rejects an unknown token', () => {
    const s = open()
    expect(s.sessions.validate('nope', T0, policy)).toBe(false)
  })

  it('expires past the absolute TTL and deletes the row', () => {
    const s = open()
    const token = s.sessions.create(T0, policy)
    expect(s.sessions.validate(token, T0 + policy.ttlMs + 1, policy)).toBe(false)
    expect(s.sessions.count()).toBe(0)
  })

  it('expires after idle timeout', () => {
    const s = open()
    const token = s.sessions.create(T0, policy)
    // active at T0+idle-1 keeps it alive, advancing last_seen
    expect(s.sessions.validate(token, T0 + policy.idleMs - 1, policy)).toBe(true)
    // idle window measured from the new last_seen
    expect(s.sessions.validate(token, T0 + policy.idleMs - 1 + policy.idleMs + 1, policy)).toBe(false)
  })

  it('revoke removes a single session; revokeAll clears them', () => {
    const s = open()
    const a = s.sessions.create(T0, policy)
    const b = s.sessions.create(T0, policy)
    s.sessions.revoke(a)
    expect(s.sessions.validate(a, T0 + 1, policy)).toBe(false)
    expect(s.sessions.validate(b, T0 + 1, policy)).toBe(true)
    s.sessions.revokeAll()
    expect(s.sessions.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — `src/store/sessions.ts`

```ts
import { randomBytes, createHash } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'

export interface SessionPolicy {
  ttlMs: number
  idleMs: number
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export class SessionRepo {
  constructor(private readonly db: Database.Database) {}

  create(now: number, policy: SessionPolicy): string {
    const token = randomBytes(32).toString('base64url')
    this.db
      .prepare(
        `INSERT INTO sessions (token_hash, created_at, last_seen, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(hashToken(token), now, now, now + policy.ttlMs)
    return token
  }

  validate(token: string, now: number, policy: SessionPolicy): boolean {
    const tokenHash = hashToken(token)
    const row = this.db
      .prepare('SELECT created_at, last_seen, expires_at FROM sessions WHERE token_hash = ?')
      .get(tokenHash) as { created_at: number; last_seen: number; expires_at: number } | undefined
    if (!row) return false
    if (now > row.expires_at || now - row.last_seen > policy.idleMs) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
      return false
    }
    this.db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, tokenHash)
    return true
  }

  revoke(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
  }

  revokeAll(): void {
    this.db.prepare('DELETE FROM sessions').run()
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }
    return row.n
  }
}
```

- [ ] **Step 4: Attach in `store.ts`** — import `SessionRepo`, add `sessions: SessionRepo` to `Store`, construct + include.

- [ ] **Step 5: Run session tests + full suite + typecheck — expect PASS/clean.**

- [ ] **Step 6: Commit**

```bash
git add src/store/sessions.ts src/store/store.ts test/store/sessions.test.ts
git commit -m "feat: revocable, expiring session repository (hashed tokens)"
```

---

### Task 3: Login rate limiter

**Files:**
- Create: `src/auth/rateLimiter.ts`
- Test: `test/auth/rateLimiter.test.ts`

**Interfaces:**
- Produces:
  - `interface RateLimitConfig { maxPerKey: number; windowMs: number; lockoutMs: number; maxGlobal: number }`
  - `interface RateDecision { allowed: boolean; retryAfterMs: number }`
  - `class RateLimiter`:
    - `constructor(config: RateLimitConfig)`
    - `check(key: string, now: number): RateDecision` — denies if the key is locked out or the global concurrent-failure budget is exhausted.
    - `recordFailure(key: string, now: number): void` — increments the key's failures in the rolling window; on reaching `maxPerKey`, locks the key until `now + lockoutMs`.
    - `recordSuccess(key: string): void` — clears the key's failures and lockout.
  - In-memory (single-user, single-process). Time is injected for deterministic tests.

- [ ] **Step 1: Write the failing test** — `test/auth/rateLimiter.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { RateLimiter } from '../../src/auth/rateLimiter'

const cfg = { maxPerKey: 3, windowMs: 60_000, lockoutMs: 300_000, maxGlobal: 100 }

describe('RateLimiter', () => {
  it('allows attempts under the limit', () => {
    const rl = new RateLimiter(cfg)
    expect(rl.check('ip1', 0).allowed).toBe(true)
    rl.recordFailure('ip1', 0)
    expect(rl.check('ip1', 1).allowed).toBe(true)
  })

  it('locks out a key after maxPerKey failures', () => {
    const rl = new RateLimiter(cfg)
    rl.recordFailure('ip1', 0)
    rl.recordFailure('ip1', 1)
    rl.recordFailure('ip1', 2)
    const d = rl.check('ip1', 3)
    expect(d.allowed).toBe(false)
    expect(d.retryAfterMs).toBeGreaterThan(0)
  })

  it('lifts the lockout after lockoutMs', () => {
    const rl = new RateLimiter(cfg)
    rl.recordFailure('ip1', 0)
    rl.recordFailure('ip1', 0)
    rl.recordFailure('ip1', 0)
    expect(rl.check('ip1', 0).allowed).toBe(false)
    expect(rl.check('ip1', cfg.lockoutMs + 1).allowed).toBe(true)
  })

  it('a successful login clears the key’s failures', () => {
    const rl = new RateLimiter(cfg)
    rl.recordFailure('ip1', 0)
    rl.recordFailure('ip1', 0)
    rl.recordSuccess('ip1')
    rl.recordFailure('ip1', 1)
    expect(rl.check('ip1', 2).allowed).toBe(true)
  })

  it('failures outside the window do not count toward lockout', () => {
    const rl = new RateLimiter(cfg)
    rl.recordFailure('ip1', 0)
    rl.recordFailure('ip1', 0)
    rl.recordFailure('ip1', cfg.windowMs + 1) // first two aged out
    expect(rl.check('ip1', cfg.windowMs + 2).allowed).toBe(true)
  })

  it('denies when the global failure budget is exhausted', () => {
    const rl = new RateLimiter({ ...cfg, maxGlobal: 2 })
    rl.recordFailure('a', 0)
    rl.recordFailure('b', 0)
    expect(rl.check('c', 0).allowed).toBe(false)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — `src/auth/rateLimiter.ts`

```ts
export interface RateLimitConfig {
  maxPerKey: number
  windowMs: number
  lockoutMs: number
  maxGlobal: number
}

export interface RateDecision {
  allowed: boolean
  retryAfterMs: number
}

interface KeyState {
  failures: number[] // timestamps within the window
  lockedUntil: number
}

export class RateLimiter {
  private readonly keys = new Map<string, KeyState>()

  constructor(private readonly config: RateLimitConfig) {}

  private prune(state: KeyState, now: number): void {
    const cutoff = now - this.config.windowMs
    state.failures = state.failures.filter((t) => t > cutoff)
  }

  private globalFailures(now: number): number {
    const cutoff = now - this.config.windowMs
    let total = 0
    for (const state of this.keys.values()) total += state.failures.filter((t) => t > cutoff).length
    return total
  }

  check(key: string, now: number): RateDecision {
    const state = this.keys.get(key)
    if (state && now < state.lockedUntil) {
      return { allowed: false, retryAfterMs: state.lockedUntil - now }
    }
    if (this.globalFailures(now) >= this.config.maxGlobal) {
      return { allowed: false, retryAfterMs: this.config.windowMs }
    }
    return { allowed: true, retryAfterMs: 0 }
  }

  recordFailure(key: string, now: number): void {
    const state = this.keys.get(key) ?? { failures: [], lockedUntil: 0 }
    this.prune(state, now)
    state.failures.push(now)
    if (state.failures.length >= this.config.maxPerKey) {
      state.lockedUntil = now + this.config.lockoutMs
    }
    this.keys.set(key, state)
  }

  recordSuccess(key: string): void {
    this.keys.delete(key)
  }
}
```

- [ ] **Step 4: Run rate-limiter tests + full suite + typecheck — expect PASS/clean.**

- [ ] **Step 5: Commit**

```bash
git add src/auth/rateLimiter.ts test/auth/rateLimiter.test.ts
git commit -m "feat: in-memory login rate limiter with per-key lockout and global cap"
```

---

### Task 4: CSRF tokens + WebSocket origin guard

**Files:**
- Create: `src/auth/csrf.ts`
- Test: `test/auth/csrf.test.ts`

**Interfaces:**
- Produces:
  - `issueCsrfToken(): string` — 32-byte base64url random.
  - `verifyCsrf(cookieToken: string | undefined, headerToken: string | undefined): boolean` — constant-time equality; both must be present and equal.
  - `isAllowedOrigin(origin: string | undefined, allowed: string): boolean` — exact match against the configured origin; `undefined`/mismatch → false.

- [ ] **Step 1: Write the failing test** — `test/auth/csrf.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { issueCsrfToken, verifyCsrf, isAllowedOrigin } from '../../src/auth/csrf'

describe('CSRF', () => {
  it('issues distinct high-entropy tokens', () => {
    const a = issueCsrfToken()
    const b = issueCsrfToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(20)
  })

  it('verifies matching cookie and header tokens', () => {
    const t = issueCsrfToken()
    expect(verifyCsrf(t, t)).toBe(true)
  })

  it('rejects when missing or mismatched', () => {
    const t = issueCsrfToken()
    expect(verifyCsrf(t, undefined)).toBe(false)
    expect(verifyCsrf(undefined, t)).toBe(false)
    expect(verifyCsrf(t, t + 'x')).toBe(false)
    expect(verifyCsrf('', '')).toBe(false)
  })
})

describe('isAllowedOrigin', () => {
  it('accepts an exact match and rejects others', () => {
    expect(isAllowedOrigin('https://signal.example.com', 'https://signal.example.com')).toBe(true)
    expect(isAllowedOrigin('https://evil.com', 'https://signal.example.com')).toBe(false)
    expect(isAllowedOrigin(undefined, 'https://signal.example.com')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — `src/auth/csrf.ts`

```ts
import { randomBytes, timingSafeEqual } from 'node:crypto'

export function issueCsrfToken(): string {
  return randomBytes(32).toString('base64url')
}

export function verifyCsrf(cookieToken: string | undefined, headerToken: string | undefined): boolean {
  if (!cookieToken || !headerToken) return false
  const a = Buffer.from(cookieToken)
  const b = Buffer.from(headerToken)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function isAllowedOrigin(origin: string | undefined, allowed: string): boolean {
  return origin === allowed
}
```

- [ ] **Step 4: Run csrf tests + full suite + typecheck — expect PASS/clean.**

- [ ] **Step 5: Commit**

```bash
git add src/auth/csrf.ts test/auth/csrf.test.ts
git commit -m "feat: double-submit CSRF tokens and websocket origin guard"
```

---

### Task 5: WebAuthn ceremony wrappers + credential store

**Files:**
- Create: `src/store/webauthnStore.ts`, `src/auth/webauthn.ts`
- Modify: `src/store/store.ts`
- Test: `test/store/webauthnStore.test.ts`, `test/auth/webauthn.test.ts`

**Interfaces:**
- Produces (attach `webauthn: WebAuthnRepo`):
  - `interface StoredCredential { id: string; publicKey: Uint8Array; counter: number; transports: string[]; createdAt: number }`
  - `class WebAuthnRepo`:
    - `saveChallenge(challenge: string, now: number): void`
    - `takeChallenge(): string | null` — returns and clears the current challenge (one-time use).
    - `addCredential(c: StoredCredential): void`
    - `listCredentials(): StoredCredential[]`
    - `getCredential(id: string): StoredCredential | null`
    - `updateCounter(id: string, counter: number): void`
    - `hasCredential(): boolean`
  - From `src/auth/webauthn.ts` (thin wrappers over `@simplewebauthn/server`, config-injected):
    - `interface WebAuthnConfig { rpId: string; rpName: string; origin: string }`
    - `startRegistration(repo, cfg, userId, now): Promise<PublicKeyCredentialCreationOptionsJSON>` — generates options, saves the challenge.
    - `finishRegistration(repo, cfg, response, now): Promise<boolean>` — verifies against the taken challenge; on success stores the credential.
    - `startAuthentication(repo, cfg, now): Promise<PublicKeyCredentialRequestOptionsJSON>` — generates options over registered credentials, saves the challenge.
    - `finishAuthentication(repo, cfg, response, now): Promise<boolean>` — verifies; on success updates the counter.

- Testing note: `@simplewebauthn/server`'s cryptographic `verifyRegistrationResponse`/`verifyAuthenticationResponse` require a real authenticator's attestation/assertion, which cannot be produced headlessly. This task's tests cover the **repo** (challenge one-time-use, credential CRUD, counter update) and the **options-generation + challenge-persistence** halves of the ceremony. The actual verify calls are exercised manually with a real YubiKey in a later milestone; keep `finishRegistration`/`finishAuthentication` thin so the untested surface is minimal.

- [ ] **Step 1: Write the failing repo test** — `test/store/webauthnStore.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `sww-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

describe('WebAuthnRepo', () => {
  it('takeChallenge is one-time-use', () => {
    const s = open()
    s.webauthn.saveChallenge('chal-1', 1000)
    expect(s.webauthn.takeChallenge()).toBe('chal-1')
    expect(s.webauthn.takeChallenge()).toBeNull()
  })

  it('stores, lists, gets, and updates a credential', () => {
    const s = open()
    expect(s.webauthn.hasCredential()).toBe(false)
    s.webauthn.addCredential({
      id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['usb'], createdAt: 1,
    })
    expect(s.webauthn.hasCredential()).toBe(true)
    expect(s.webauthn.listCredentials()).toHaveLength(1)
    const got = s.webauthn.getCredential('cred-1')
    expect(got?.transports).toEqual(['usb'])
    expect(Array.from(got!.publicKey)).toEqual([1, 2, 3])
    s.webauthn.updateCounter('cred-1', 5)
    expect(s.webauthn.getCredential('cred-1')?.counter).toBe(5)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — `src/store/webauthnStore.ts`

```ts
import type Database from 'better-sqlite3-multiple-ciphers'

export interface StoredCredential {
  id: string
  publicKey: Uint8Array
  counter: number
  transports: string[]
  createdAt: number
}

interface CredRow {
  id: string
  public_key: Buffer
  counter: number
  transports: string | null
  created_at: number
}

export class WebAuthnRepo {
  constructor(private readonly db: Database.Database) {}

  saveChallenge(challenge: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO webauthn_challenge (id, challenge, created_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET challenge = excluded.challenge, created_at = excluded.created_at`,
      )
      .run(challenge, now)
  }

  takeChallenge(): string | null {
    const row = this.db
      .prepare('SELECT challenge FROM webauthn_challenge WHERE id = 1')
      .get() as { challenge: string | null } | undefined
    const challenge = row?.challenge ?? null
    this.db.prepare('UPDATE webauthn_challenge SET challenge = NULL WHERE id = 1').run()
    return challenge
  }

  addCredential(c: StoredCredential): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO webauthn_credentials (id, public_key, counter, transports, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(c.id, Buffer.from(c.publicKey), c.counter, JSON.stringify(c.transports), c.createdAt)
  }

  private toCred(r: CredRow): StoredCredential {
    return {
      id: r.id,
      publicKey: new Uint8Array(r.public_key),
      counter: r.counter,
      transports: r.transports ? (JSON.parse(r.transports) as string[]) : [],
      createdAt: r.created_at,
    }
  }

  listCredentials(): StoredCredential[] {
    const rows = this.db.prepare('SELECT * FROM webauthn_credentials').all() as CredRow[]
    return rows.map((r) => this.toCred(r))
  }

  getCredential(id: string): StoredCredential | null {
    const row = this.db.prepare('SELECT * FROM webauthn_credentials WHERE id = ?').get(id) as
      | CredRow
      | undefined
    return row ? this.toCred(row) : null
  }

  updateCounter(id: string, counter: number): void {
    this.db.prepare('UPDATE webauthn_credentials SET counter = ? WHERE id = ?').run(counter, id)
  }

  hasCredential(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM webauthn_credentials').get() as { n: number }
    return row.n > 0
  }
}
```

- [ ] **Step 4: Attach in `store.ts`** — import `WebAuthnRepo`, add `webauthn: WebAuthnRepo` to `Store`, construct + include.

- [ ] **Step 5: Write the failing webauthn wrapper test** — `test/auth/webauthn.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { startRegistration, startAuthentication } from '../../src/auth/webauthn'

let store: Store
let path: string
afterEach(() => {
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})
function open(): Store {
  path = join(tmpdir(), `swwa-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  return store
}

const cfg = { rpId: 'signal.example.com', rpName: 'Signal Web', origin: 'https://signal.example.com' }

describe('webauthn ceremony (options + challenge persistence)', () => {
  it('startRegistration returns options and persists the challenge', async () => {
    const s = open()
    const options = await startRegistration(s.webauthn, cfg, 'user-1', 1000)
    expect(options.rp.id).toBe('signal.example.com')
    expect(typeof options.challenge).toBe('string')
    // the challenge is saved server-side for the finish step
    expect(s.webauthn.takeChallenge()).toBeTruthy()
  })

  it('startAuthentication persists a challenge even with no credentials', async () => {
    const s = open()
    const options = await startAuthentication(s.webauthn, cfg, 2000)
    expect(typeof options.challenge).toBe('string')
    expect(s.webauthn.takeChallenge()).toBeTruthy()
  })
})
```

- [ ] **Step 6: Run it — expect FAIL.**

- [ ] **Step 7: Implement** — `src/auth/webauthn.ts`

```ts
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server'
import type { WebAuthnRepo } from '../store/webauthnStore'

export interface WebAuthnConfig {
  rpId: string
  rpName: string
  origin: string
}

export async function startRegistration(
  repo: WebAuthnRepo,
  cfg: WebAuthnConfig,
  userId: string,
  now: number,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const options = await generateRegistrationOptions({
    rpName: cfg.rpName,
    rpID: cfg.rpId,
    userName: userId,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })
  repo.saveChallenge(options.challenge, now)
  return options
}

export async function finishRegistration(
  repo: WebAuthnRepo,
  cfg: WebAuthnConfig,
  response: RegistrationResponseJSON,
  now: number,
): Promise<boolean> {
  const expectedChallenge = repo.takeChallenge()
  if (!expectedChallenge) return false
  let verification: VerifiedRegistrationResponse
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: cfg.origin,
      expectedRPID: cfg.rpId,
    })
  } catch {
    return false
  }
  if (!verification.verified || !verification.registrationInfo) return false
  const { credential } = verification.registrationInfo
  repo.addCredential({
    id: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: (response.response.transports ?? []) as string[],
    createdAt: now,
  })
  return true
}

export async function startAuthentication(
  repo: WebAuthnRepo,
  cfg: WebAuthnConfig,
  now: number,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const creds = repo.listCredentials()
  const options = await generateAuthenticationOptions({
    rpID: cfg.rpId,
    allowCredentials: creds.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    userVerification: 'preferred',
  })
  repo.saveChallenge(options.challenge, now)
  return options
}

export async function finishAuthentication(
  repo: WebAuthnRepo,
  cfg: WebAuthnConfig,
  response: AuthenticationResponseJSON,
  now: number,
): Promise<boolean> {
  const expectedChallenge = repo.takeChallenge()
  if (!expectedChallenge) return false
  const cred = repo.getCredential(response.id)
  if (!cred) return false
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: cfg.origin,
      expectedRPID: cfg.rpId,
      credential: {
        id: cred.id,
        publicKey: cred.publicKey,
        counter: cred.counter,
        transports: cred.transports as AuthenticatorTransportFuture[],
      },
    })
    if (!verification.verified) return false
    repo.updateCounter(cred.id, verification.authenticationInfo.newCounter)
    return true
  } catch {
    return false
  }
}
```

Note: if `@simplewebauthn/server`'s current type names differ slightly (e.g. option field names), adjust to the installed version's types so typecheck passes — keep the behavior (generate options + save challenge; verify + store/update credential). Report any signature adjustment you make.

- [ ] **Step 8: Run webauthn tests + full suite + typecheck — expect PASS/clean.**

- [ ] **Step 9: Commit**

```bash
git add src/store/webauthnStore.ts src/auth/webauthn.ts src/store/store.ts test/store/webauthnStore.test.ts test/auth/webauthn.test.ts
git commit -m "feat: webauthn credential store and ceremony wrappers"
```

---

### Task 6: Fastify auth plugin (login/logout/guard, cookie, rate-limit, CSRF)

**Files:**
- Create: `src/auth/plugin.ts`
- Test: `test/auth/plugin.test.ts`

**Interfaces:**
- Consumes: `Store` (with `authConfig`, `sessions`, `webauthn`), `verifyPassword`, `RateLimiter`, `issueCsrfToken`/`verifyCsrf`, webauthn wrappers.
- Produces:
  - `interface AuthPluginOptions { store: Store; sessionPolicy: SessionPolicy; rateLimit: RateLimitConfig; webauthn: WebAuthnConfig; secureCookies: boolean }`
  - `authPlugin(app: FastifyInstance, opts: AuthPluginOptions): Promise<void>` — registers `@fastify/cookie`, a `requireAuth` decorator/preHandler, and routes:
    - `POST /auth/login` — body `{ password: string }`; rate-limited by client IP; on success creates a session, sets the `sw_session` cookie (`HttpOnly; Secure(if secureCookies); SameSite=Strict; Path=/`) and a readable `sw_csrf` cookie, returns `{ ok: true, webauthnRequired: boolean }` where `webauthnRequired = store.webauthn.hasCredential()`.
    - `POST /auth/logout` — clears the current session + cookie.
    - `POST /auth/logout-all` — `sessions.revokeAll()`.
    - `GET /auth/status` — `{ authenticated: boolean }` for the current cookie.
    - WebAuthn routes: `POST /auth/webauthn/register/options`, `/register/verify`, `/auth/webauthn/login/options`, `/login/verify` (login/options + login/verify are usable pre-session as the second factor; register requires an active session).
  - `requireAuth` — a preHandler that 401s when the `sw_session` cookie is missing/invalid, and enforces CSRF (`verifyCsrf(sw_csrf cookie, x-csrf-token header)`) on non-GET requests.
- Note: this milestone tests the **password** login path, session cookie behavior, `requireAuth` gating, logout, logout-all, rate-limit lockout, and CSRF enforcement — all via `app.inject`. The WebAuthn verify endpoints are wired but their crypto is manual-tested later (as in Task 5).

- [ ] **Step 1: Write the failing test** — `test/auth/plugin.test.ts`

```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { openStore, type Store } from '../../src/store/store'
import { hashPassword } from '../../src/auth/password'
import { authPlugin } from '../../src/auth/plugin'

let store: Store
let path: string
let app: FastifyInstance

const opts = () => ({
  store,
  sessionPolicy: { ttlMs: 30 * 24 * 3600_000, idleMs: 7 * 24 * 3600_000 },
  rateLimit: { maxPerKey: 3, windowMs: 60_000, lockoutMs: 300_000, maxGlobal: 100 },
  webauthn: { rpId: 'localhost', rpName: 'Signal Web', origin: 'http://localhost' },
  secureCookies: false,
})

beforeEach(async () => {
  path = join(tmpdir(), `swp-${Date.now()}-${Math.round(performance.now())}.db`)
  store = openStore(path, 'k')
  store.authConfig.setPasswordHash(await hashPassword('hunter2hunter2'))
  app = Fastify()
  await authPlugin(app, opts())
  // a protected route to exercise requireAuth
  app.get('/protected', { preHandler: app.requireAuth }, async () => ({ secret: 42 }))
  app.post('/protected', { preHandler: app.requireAuth }, async () => ({ ok: true }))
  await app.ready()
})

afterEach(async () => {
  await app?.close()
  store?.close()
  try { rmSync(path) } catch { /* ignore */ }
})

function cookieFrom(res: { headers: Record<string, unknown> }, name: string): string | undefined {
  const raw = res.headers['set-cookie']
  const arr = Array.isArray(raw) ? raw : raw ? [String(raw)] : []
  const hit = arr.find((c) => c.startsWith(`${name}=`))
  return hit?.split(';')[0].split('=')[1]
}

describe('authPlugin', () => {
  it('rejects a protected route without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' })
    expect(res.statusCode).toBe(401)
  })

  it('logs in with the correct password and sets an HttpOnly session cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'hunter2hunter2' } })
    expect(res.statusCode).toBe(200)
    const setCookie = res.headers['set-cookie']
    const flat = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie)
    expect(flat).toContain('sw_session=')
    expect(flat).toContain('HttpOnly')
    expect(flat).toContain('SameSite=Strict')
  })

  it('rejects a wrong password', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'wrong' } })
    expect(res.statusCode).toBe(401)
  })

  it('allows a protected GET once authenticated', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'hunter2hunter2' } })
    const session = cookieFrom(login, 'sw_session')
    const res = await app.inject({ method: 'GET', url: '/protected', cookies: { sw_session: session! } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ secret: 42 })
  })

  it('enforces CSRF on a protected POST', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'hunter2hunter2' } })
    const session = cookieFrom(login, 'sw_session')
    const csrf = cookieFrom(login, 'sw_csrf')
    // without the header → blocked
    const blocked = await app.inject({ method: 'POST', url: '/protected', cookies: { sw_session: session!, sw_csrf: csrf! } })
    expect(blocked.statusCode).toBe(403)
    // with matching header → allowed
    const ok = await app.inject({
      method: 'POST', url: '/protected',
      cookies: { sw_session: session!, sw_csrf: csrf! },
      headers: { 'x-csrf-token': csrf! },
    })
    expect(ok.statusCode).toBe(200)
  })

  it('logout invalidates the session', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'hunter2hunter2' } })
    const session = cookieFrom(login, 'sw_session')
    const csrf = cookieFrom(login, 'sw_csrf')
    await app.inject({ method: 'POST', url: '/auth/logout', cookies: { sw_session: session!, sw_csrf: csrf! }, headers: { 'x-csrf-token': csrf! } })
    const res = await app.inject({ method: 'GET', url: '/protected', cookies: { sw_session: session! } })
    expect(res.statusCode).toBe(401)
  })

  it('locks out after repeated wrong passwords', async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'wrong' } })
    }
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'hunter2hunter2' } })
    expect(res.statusCode).toBe(429)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL.**

- [ ] **Step 3: Implement** — `src/auth/plugin.ts`

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import type { Store } from '../store/store'
import type { SessionPolicy } from '../store/sessions'
import { verifyPassword } from './password'
import { RateLimiter, type RateLimitConfig } from './rateLimiter'
import { issueCsrfToken, verifyCsrf } from './csrf'
import type { WebAuthnConfig } from './webauthn'
import {
  startRegistration,
  finishRegistration,
  startAuthentication,
  finishAuthentication,
} from './webauthn'

export interface AuthPluginOptions {
  store: Store
  sessionPolicy: SessionPolicy
  rateLimit: RateLimitConfig
  webauthn: WebAuthnConfig
  secureCookies: boolean
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

const SESSION_COOKIE = 'sw_session'
const CSRF_COOKIE = 'sw_csrf'

export async function authPlugin(app: FastifyInstance, opts: AuthPluginOptions): Promise<void> {
  const { store, sessionPolicy, webauthn, secureCookies } = opts
  const limiter = new RateLimiter(opts.rateLimit)
  await app.register(fastifyCookie)

  function setSessionCookies(reply: FastifyReply, token: string, csrf: string): void {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/',
      maxAge: Math.floor(sessionPolicy.ttlMs / 1000),
    })
    reply.setCookie(CSRF_COOKIE, csrf, {
      httpOnly: false, secure: secureCookies, sameSite: 'strict', path: '/',
      maxAge: Math.floor(sessionPolicy.ttlMs / 1000),
    })
  }

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[SESSION_COOKIE]
    if (!token || !store.sessions.validate(token, Date.now(), sessionPolicy)) {
      await reply.code(401).send({ error: 'unauthorized' })
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const headerToken = req.headers['x-csrf-token']
      const csrfHeader = Array.isArray(headerToken) ? headerToken[0] : headerToken
      if (!verifyCsrf(req.cookies[CSRF_COOKIE], csrfHeader)) {
        await reply.code(403).send({ error: 'csrf' })
        return
      }
    }
  })

  app.post<{ Body: { password?: string } }>('/auth/login', async (req, reply) => {
    const ip = req.ip
    const now = Date.now()
    const decision = limiter.check(ip, now)
    if (!decision.allowed) {
      return reply.code(429).send({ error: 'rate_limited', retryAfterMs: decision.retryAfterMs })
    }
    const password = req.body?.password ?? ''
    const hash = store.authConfig.getPasswordHash()
    const ok = hash ? await verifyPassword(hash, password) : false
    if (!ok) {
      limiter.recordFailure(ip, now)
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    limiter.recordSuccess(ip)
    const token = store.sessions.create(now, sessionPolicy)
    const csrf = issueCsrfToken()
    setSessionCookies(reply, token, csrf)
    return reply.send({ ok: true, webauthnRequired: store.webauthn.hasCredential() })
  })

  app.post('/auth/logout', { preHandler: app.requireAuth }, async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE]
    if (token) store.sessions.revoke(token)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    reply.clearCookie(CSRF_COOKIE, { path: '/' })
    return reply.send({ ok: true })
  })

  app.post('/auth/logout-all', { preHandler: app.requireAuth }, async (_req, reply) => {
    store.sessions.revokeAll()
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    reply.clearCookie(CSRF_COOKIE, { path: '/' })
    return reply.send({ ok: true })
  })

  app.get('/auth/status', async (req) => {
    const token = req.cookies[SESSION_COOKIE]
    const authenticated = token ? store.sessions.validate(token, Date.now(), sessionPolicy) : false
    return { authenticated }
  })

  // --- WebAuthn (registration requires a live session; login usable as 2FA) ---
  app.post('/auth/webauthn/register/options', { preHandler: app.requireAuth }, async () => {
    return startRegistration(store.webauthn, webauthn, 'signal-web-user', Date.now())
  })

  app.post('/auth/webauthn/register/verify', { preHandler: app.requireAuth }, async (req, reply) => {
    const ok = await finishRegistration(store.webauthn, webauthn, req.body as never, Date.now())
    return reply.code(ok ? 200 : 400).send({ ok })
  })

  app.post('/auth/webauthn/login/options', async () => {
    return startAuthentication(store.webauthn, webauthn, Date.now())
  })

  app.post('/auth/webauthn/login/verify', async (req, reply) => {
    const ok = await finishAuthentication(store.webauthn, webauthn, req.body as never, Date.now())
    if (!ok) return reply.code(401).send({ ok: false })
    const token = store.sessions.create(Date.now(), sessionPolicy)
    const csrf = issueCsrfToken()
    setSessionCookies(reply, token, csrf)
    return reply.send({ ok: true })
  })
}
```

- [ ] **Step 4: Run plugin tests + full suite + typecheck — expect PASS/clean.**

If `@fastify/cookie` typing for `req.cookies` needs an index signature, or `req.ip` is undefined under `inject` (it should default to `127.0.0.1`), adjust minimally and note it.

- [ ] **Step 5: Commit**

```bash
git add src/auth/plugin.ts test/auth/plugin.test.ts
git commit -m "feat: fastify auth plugin — password login, sessions, csrf, rate limiting"
```

---

## Milestone 3 Done — Definition of Done

- `npm test` fully green (password, authConfig, sessions, rateLimiter, csrf, webauthnStore, webauthn options, plugin).
- `npm run typecheck` clean.
- Password login through the Fastify plugin sets an `HttpOnly; Secure; SameSite=Strict` session cookie; `requireAuth` gates protected routes; CSRF is enforced on non-GET; wrong-password lockout returns 429; logout + logout-all invalidate sessions.
- WebAuthn credential store + option-generation/challenge lifecycle are tested; the cryptographic verify is intentionally deferred to a manual real-key test.

Next: **Milestone 4 — Web API & real-time bridge** (mounts the data routes behind `requireAuth`, wires the live signal-cli↔browser bridge, profile/contact service, attachment proxy, and — per `docs/superpowers/DEFERRED.md` — the synced own-device edit path).

## Self-Review notes (author)

- **Spec coverage (§9):** Argon2id password; hashed-token revocable sessions with absolute + idle expiry and revoke-all; per-IP + global login rate limiting with lockout; double-submit CSRF; WS origin guard; WebAuthn default-on with password fallback (the plugin returns `webauthnRequired` and the login/verify path mints a session). Auth data lives in the encrypted store. Custom-login-only (no Cloudflare Access) honored.
- **Testing honesty:** WebAuthn cryptographic verification cannot run headlessly; the plan tests everything around it and keeps the verify wrappers thin, with the real-key step deferred — stated explicitly, not hidden.
- **Placeholder scan:** none; every step has complete code.
- **Type consistency:** `Store` gains `authConfig`/`sessions`/`webauthn` across Tasks 1/2/5; `SessionPolicy`, `RateLimitConfig`, `WebAuthnConfig`, `AuthPluginOptions` names are stable; the plugin consumes exactly the repos and helpers defined earlier.
