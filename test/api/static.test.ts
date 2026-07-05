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
