import { randomBytes, timingSafeEqual } from 'node:crypto'

export function issueCsrfToken(): string {
  return randomBytes(32).toString('base64url')
}

export function verifyCsrf(cookieToken: string | undefined, headerToken: string | undefined): boolean {
  if (!cookieToken || !headerToken) return false
  const a = Buffer.from(cookieToken)
  const b = Buffer.from(headerToken)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function isAllowedOrigin(origin: string | undefined, allowed: string): boolean {
  return origin === allowed
}
