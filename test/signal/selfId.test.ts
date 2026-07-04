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
  it('short-circuits on an explicit uuid override without calling the client', async () => {
    const id = await resolveSelfId(
      { getAccountUuid: async () => { throw new Error('should not be called') } },
      '+15551230000',
      'explicit-uuid',
    )
    expect(id).toBe('explicit-uuid')
  })
})
