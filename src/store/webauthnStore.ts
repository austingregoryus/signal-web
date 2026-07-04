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
