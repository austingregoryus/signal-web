import { randomBytes, createHash } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'

export interface SessionRow {
  tokenHash: string
  createdAt: number
  lastSeen: number
  expiresAt: number
}

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
