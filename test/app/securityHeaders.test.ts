import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { registerSecurityHeaders } from '../../src/app/securityHeaders'

async function buildApp(publicUrl: string) {
  const app = Fastify()
  registerSecurityHeaders(app, publicUrl)
  app.get('/plain', async () => ({ ok: true }))
  // A route that sets its OWN CSP must NOT be overwritten by the hook.
  app.get('/strict', async (req, reply) => {
    reply.header('Content-Security-Policy', "default-src 'none'")
    return { ok: true }
  })
  await app.ready()
  return app
}

describe('security headers middleware', () => {
  it('sets baseline headers on every response', async () => {
    const app = await buildApp('https://signal.example.com')
    const res = await app.inject({ method: 'GET', url: '/plain' })
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow')
    await app.close()
  })

  it("derives connect-src from the public URL (https -> wss) so the live WS can connect", async () => {
    const app = await buildApp('https://signal.example.com')
    const res = await app.inject({ method: 'GET', url: '/plain' })
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("connect-src 'self' wss://signal.example.com")
    expect(csp).toContain("img-src 'self' data: blob:")
    expect(csp).toContain("frame-ancestors 'none'")
    await app.close()
  })

  it('does NOT overwrite a stricter per-route CSP', async () => {
    const app = await buildApp('https://signal.example.com')
    const res = await app.inject({ method: 'GET', url: '/strict' })
    expect(res.headers['content-security-policy']).toBe("default-src 'none'")
    await app.close()
  })
})
