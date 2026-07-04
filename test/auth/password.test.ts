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
