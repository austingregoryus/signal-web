import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { browserSupportsWebAuthn, runWebAuthnRegistration } from '../auth/webauthn'
import { useToast } from './Toast'
import styles from './Settings.module.css'

interface KeyInfo { id: string; createdAt: number; transports: string[] }

/**
 * Settings panel: security-key (2FA) enrollment and sign-out. Keys can be added
 * here but not removed — a stolen session must not be able to strip 2FA. Lost
 * keys are reset on the server with `npm run reset-security-keys`.
 */
export function Settings({ onClose, onLogout }: {
  onClose: () => void
  onLogout: () => void | Promise<void>
}): React.JSX.Element {
  const toast = useToast()
  const [keys, setKeys] = useState<KeyInfo[] | null>(null)
  const [confirmingAdd, setConfirmingAdd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supported = browserSupportsWebAuthn()

  const loadKeys = useCallback(async () => {
    try {
      setKeys(await api.get<KeyInfo[]>('/auth/webauthn/credentials'))
    } catch {
      setError('Could not load security keys')
    }
  }, [])
  useEffect(() => { void loadKeys() }, [loadKeys])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  async function addKey(): Promise<void> {
    setBusy(true); setError(null)
    try {
      const ok = await runWebAuthnRegistration()
      if (!ok) throw new Error('verify failed')
      setConfirmingAdd(false)
      toast.info('Security key added')
      await loadKeys()
    } catch (e) {
      const name = e instanceof Error ? e.name : ''
      setError(
        name === 'NotAllowedError' ? 'Cancelled — no key was added'
          : name === 'InvalidStateError' ? 'That key is already registered'
            : "Couldn't add the key — try again",
      )
    } finally {
      setBusy(false)
    }
  }

  async function logoutEverywhere(): Promise<void> {
    setBusy(true)
    try {
      await api.post('/auth/logout-all')
    } catch { /* session may already be gone — sign out locally regardless */ }
    await onLogout()
  }

  const count = keys?.length ?? 0
  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }} role="presentation">
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className={styles.header}>
          <h2 className={styles.title} id="settings-title">Settings</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close settings">×</button>
        </div>

        <section className={styles.section} aria-labelledby="settings-keys">
          <h3 className={styles.sectionTitle} id="settings-keys">Security keys</h3>
          <p className={styles.text}>
            {keys == null
              ? 'Loading…'
              : count === 0
                ? 'None yet — logging in only needs your password.'
                : `${count} security key${count === 1 ? '' : 's'} registered. Logging in needs your password and one of them.`}
          </p>
          {keys && count > 0 ? (
            <ul className={styles.keyList}>
              {keys.map((k) => (
                <li key={k.id}>Added {new Date(k.createdAt).toLocaleDateString()}</li>
              ))}
            </ul>
          ) : null}
          {!supported ? (
            <p className={styles.note}>
              This browser can't use security keys on this page. They need an https address (or localhost).
            </p>
          ) : confirmingAdd ? (
            <div className={styles.confirm}>
              <p className={styles.text}>
                <strong>From now on, every login will need this key as well as your password.</strong>{' '}
                If you lose every key, whoever runs the server can reset them
                with <code>npm run reset-security-keys</code>.
              </p>
              <div className={styles.row}>
                <button type="button" className={styles.secondary} onClick={() => setConfirmingAdd(false)} disabled={busy}>Cancel</button>
                <button type="button" className={styles.primary} onClick={() => void addKey()} disabled={busy}>
                  {busy ? 'Waiting for key…' : 'Continue'}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={styles.primary} onClick={() => { setError(null); setConfirmingAdd(true) }}>
              {count === 0 ? 'Add a security key' : 'Add another key'}
            </button>
          )}
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        </section>

        <section className={styles.section} aria-labelledby="settings-session">
          <h3 className={styles.sectionTitle} id="settings-session">Sign out</h3>
          <p className={styles.text}>On a shared or work computer, log out when you're done.</p>
          <div className={styles.row}>
            <button type="button" className={styles.primary} onClick={() => void onLogout()} disabled={busy}>Log out</button>
            <button type="button" className={styles.danger} onClick={() => void logoutEverywhere()} disabled={busy}>
              Log out everywhere
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
