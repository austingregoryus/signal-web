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
