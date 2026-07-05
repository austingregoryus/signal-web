import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { LoginResult } from '../api/types'
import { runWebAuthnLogin } from './webauthn'

type State = 'loading' | 'anon' | 'authed'

export function useAuth() {
  const [state, setState] = useState<State>('loading')
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let alive = true
    api.get('/api/conversations')
      .then(() => { if (alive) setState('authed') })
      .catch((e) => { if (alive) setState(e instanceof ApiError && e.status === 401 ? 'anon' : 'anon') })
    return () => { alive = false }
  }, [])

  const login = useCallback(async (password: string) => {
    setError(undefined)
    try {
      const res = await api.post<LoginResult>('/auth/login', { password })
      if (res.webauthnRequired) {
        const ok = await runWebAuthnLogin()
        if (!ok) { setError('Security key verification failed'); return }
      }
      setState('authed')
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? 'Too many attempts, try later' : 'Wrong password')
    }
  }, [])

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {})
    setState('anon')
  }, [])

  return { state, error, login, logout }
}
