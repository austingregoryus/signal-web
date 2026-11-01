import { startAuthentication, startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser'
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser'
import { api } from '../api/client'

export { browserSupportsWebAuthn }

export async function runWebAuthnLogin(): Promise<boolean> {
  const options = await api.post<PublicKeyCredentialRequestOptionsJSON>('/auth/webauthn/login/options')
  const assertion = await startAuthentication({ optionsJSON: options })
  const res = await api.post<{ ok: boolean }>('/auth/webauthn/login/verify', assertion)
  return res.ok
}

/** Register a new security key / passkey for this account. Throws on cancel or failure. */
export async function runWebAuthnRegistration(): Promise<boolean> {
  const options = await api.post<PublicKeyCredentialCreationOptionsJSON>('/auth/webauthn/register/options')
  const attestation = await startRegistration({ optionsJSON: options })
  const res = await api.post<{ ok: boolean }>('/auth/webauthn/register/verify', attestation)
  return res.ok
}
