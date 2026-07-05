import { startAuthentication } from '@simplewebauthn/browser'
import { api } from '../api/client'

export async function runWebAuthnLogin(): Promise<boolean> {
  const options = await api.post<import('@simplewebauthn/browser').PublicKeyCredentialRequestOptionsJSON>(
    '/auth/webauthn/login/options',
  )
  const assertion = await startAuthentication({ optionsJSON: options })
  const res = await api.post<{ ok: boolean }>('/auth/webauthn/login/verify', assertion)
  return res.ok
}
