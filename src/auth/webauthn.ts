import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransport,
} from '@simplewebauthn/server'
import type { WebAuthnRepo } from '../store/webauthnStore'

export interface WebAuthnConfig {
  rpId: string
  rpName: string
  origin: string
}

export async function startRegistration(
  repo: WebAuthnRepo,
  cfg: WebAuthnConfig,
  userId: string,
  now: number,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const options = await generateRegistrationOptions({
    rpName: cfg.rpName,
    rpID: cfg.rpId,
    userName: userId,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })
  repo.saveChallenge(options.challenge, now)
  return options
}

export async function finishRegistration(
  repo: WebAuthnRepo,
  cfg: WebAuthnConfig,
  response: RegistrationResponseJSON,
  now: number,
): Promise<boolean> {
  const expectedChallenge = repo.takeChallenge()
  if (!expectedChallenge) return false
  let verification: VerifiedRegistrationResponse
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: cfg.origin,
      expectedRPID: cfg.rpId,
    })
  } catch {
    return false
  }
  if (!verification.verified || !verification.registrationInfo) return false
  const { credential } = verification.registrationInfo
  repo.addCredential({
    id: credential.id,
    publicKey: credential.publicKey,
    counter: credential.counter,
    transports: (response.response.transports ?? []) as string[],
    createdAt: now,
  })
  return true
}

export async function startAuthentication(
  repo: WebAuthnRepo,
  cfg: WebAuthnConfig,
  now: number,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const creds = repo.listCredentials()
  const options = await generateAuthenticationOptions({
    rpID: cfg.rpId,
    allowCredentials: creds.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransport[],
    })),
    userVerification: 'preferred',
  })
  repo.saveChallenge(options.challenge, now)
  return options
}

export async function finishAuthentication(
  repo: WebAuthnRepo,
  cfg: WebAuthnConfig,
  response: AuthenticationResponseJSON,
  now: number,
): Promise<boolean> {
  const expectedChallenge = repo.takeChallenge()
  if (!expectedChallenge) return false
  const cred = repo.getCredential(response.id)
  if (!cred) return false
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: cfg.origin,
      expectedRPID: cfg.rpId,
      credential: {
        id: cred.id,
        publicKey: cred.publicKey.slice(),
        counter: cred.counter,
        transports: cred.transports as AuthenticatorTransport[],
      },
    })
    if (!verification.verified) return false
    repo.updateCounter(cred.id, verification.authenticationInfo.newCounter)
    return true
  } catch {
    return false
  }
}
