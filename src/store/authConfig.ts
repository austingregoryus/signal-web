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
