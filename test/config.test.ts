import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { loadConfig } from '../src/config'

const base = { SIGNAL_NUMBER: '+15551234567', DB_KEY: 'k' }

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
    expect(() => loadConfig({ DB_KEY: 'k' })).toThrow(/SIGNAL_NUMBER is required/)
  })

  it('throws when SIGNAL_NUMBER is not E.164', () => {
    expect(() => loadConfig({ SIGNAL_NUMBER: '5551234567', DB_KEY: 'k' })).toThrow(/E\.164/)
  })

  it('throws when DB_KEY is missing', () => {
    expect(() => loadConfig({ SIGNAL_NUMBER: '+15551234567' })).toThrow(/DB_KEY is required/)
  })

  it('applies sane defaults for the new fields', () => {
    const cfg = loadConfig({ ...base })
    expect(cfg.dbPath).toBe('./data/signal-web.db')
    expect(cfg.secureCookies).toBe(true)
    expect(cfg.attachmentDir).toBe('./data/attachments')
    expect(cfg.trustProxy).toBe('loopback,uniquelocal')
    expect(cfg.sessionTtlDays).toBe(30)
    expect(cfg.sessionIdleDays).toBe(7)
    expect(cfg.publicUrl).toBe('http://localhost:8090')
    expect(cfg.allowedOrigin).toBe('http://localhost:8090')
    expect(cfg.rpOrigin).toBe('http://localhost:8090')
    expect(cfg.rpId).toBe('localhost')
  })

  it('derives rpId from a custom RP_ORIGIN', () => {
    const cfg = loadConfig({ ...base, RP_ORIGIN: 'https://signal.example.com' })
    expect(cfg.rpId).toBe('signal.example.com')
    expect(cfg.rpOrigin).toBe('https://signal.example.com')
  })

  it('allows SECURE_COOKIES and TRUST_PROXY to be disabled', () => {
    const cfg = loadConfig({ ...base, SECURE_COOKIES: 'false', TRUST_PROXY: 'false' })
    expect(cfg.secureCookies).toBe(false)
    expect(cfg.trustProxy).toBe(false)
  })

  it('passes an IP/CIDR TRUST_PROXY through', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '172.18.0.0/16' }).trustProxy).toBe('172.18.0.0/16')
  })

  it('still allows TRUST_PROXY=true to trust the whole chain (opt-in)', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true)
  })

  it('rejects a hop-count TRUST_PROXY (Fastify no longer honours it)', () => {
    expect(() => loadConfig({ ...base, TRUST_PROXY: '1' })).toThrow(/hop count/)
    expect(() => loadConfig({ ...base, TRUST_PROXY: '0' })).toThrow(/hop count/)
  })
})

describe('default TRUST_PROXY resolves the real client IP', () => {
  async function ipFor(remoteAddress: string, xff?: string): Promise<string> {
    const app = Fastify({ trustProxy: loadConfig({ ...base }).trustProxy })
    app.get('/ip', async (req) => req.ip)
    const res = await app.inject({
      method: 'GET', url: '/ip', remoteAddress,
      headers: xff ? { 'x-forwarded-for': xff } : {},
    })
    await app.close()
    return res.body
  }

  it('uses the client IP the private-network proxy reported', async () => {
    expect(await ipFor('172.18.0.3', '203.0.113.7')).toBe('203.0.113.7')
  })

  it('ignores a forged X-Forwarded-For prefix', async () => {
    expect(await ipFor('172.18.0.3', '10.9.9.9, 198.51.100.1, 203.0.113.7')).toBe('203.0.113.7')
  })

  it('ignores X-Forwarded-For from a public (non-proxy) peer', async () => {
    expect(await ipFor('203.0.113.7', '198.51.100.1')).toBe('203.0.113.7')
  })
})
