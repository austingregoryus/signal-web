import type { FastifyInstance } from 'fastify'

/**
 * The public origin the browser connects from (used to scope CSP connect-src
 * to the live WebSocket). Pass the same value as PUBLIC_URL.
 */
export function registerSecurityHeaders(app: FastifyInstance, publicUrl: string): void {
  // The live socket connects to the same host as the page, over ws/wss.
  const wsOrigin = publicUrl.replace(/^http/, 'ws')
  app.addHook('onSend', async (_req, reply, payload) => {
    // Only set a header if the route hasn't already — stricter per-route policy
    // (e.g. attachment CSP 'default-src none') wins.
    if (!reply.hasHeader('Content-Security-Policy')) {
      reply.header('Content-Security-Policy', [
        "default-src 'self'",
        `connect-src 'self' ${wsOrigin}`,
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join('; '))
    }
    if (!reply.hasHeader('Strict-Transport-Security')) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    if (!reply.hasHeader('X-Content-Type-Options')) reply.header('X-Content-Type-Options', 'nosniff')
    if (!reply.hasHeader('X-Frame-Options')) reply.header('X-Frame-Options', 'DENY')
    if (!reply.hasHeader('Referrer-Policy')) reply.header('Referrer-Policy', 'no-referrer')
    if (!reply.hasHeader('X-Robots-Tag')) reply.header('X-Robots-Tag', 'noindex, nofollow')
    return payload
  })
}
