export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

// Called when an /api/* request comes back 401, i.e. the session ended
// (expired, or "log out everywhere" from another device). /auth/* is excluded:
// a wrong password is also a 401 and must not be treated as session loss.
let unauthorizedHandler: (() => void) | null = null
export function onUnauthorized(fn: (() => void) | null): void {
  unauthorizedHandler = fn
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)sw_csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const init: RequestInit = { method, headers, credentials: 'same-origin' }
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  if (method !== 'GET' && method !== 'HEAD') headers['x-csrf-token'] = csrfToken()
  const res = await fetch(path, init)
  if (res.status === 401 && path.startsWith('/api/')) unauthorizedHandler?.()
  if (!res.ok) throw new ApiError(res.status, `${method} ${path} -> ${res.status}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
