export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
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
  if (!res.ok) throw new ApiError(res.status, `${method} ${path} -> ${res.status}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
}
