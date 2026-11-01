import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from './Toast'

vi.mock('../auth/webauthn', () => ({
  browserSupportsWebAuthn: () => true,
  runWebAuthnRegistration: vi.fn(),
}))
import { runWebAuthnRegistration } from '../auth/webauthn'
import { Settings } from './Settings'

function mockFetch(handler: (url: string, init?: RequestInit) => unknown): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const body = handler(url, init)
    return new Response(body === undefined ? '' : JSON.stringify(body), { status: 200 })
  }))
}

function renderSettings(onLogout = vi.fn()) {
  render(<ToastProvider><Settings onClose={() => {}} onLogout={onLogout} /></ToastProvider>)
  return onLogout
}

describe('Settings', () => {
  beforeEach(() => vi.mocked(runWebAuthnRegistration).mockReset())
  afterEach(() => vi.unstubAllGlobals())

  it('shows that no key is registered and warns before adding one', async () => {
    mockFetch(() => [])
    renderSettings()
    expect(await screen.findByText(/none yet/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /add a security key/i }))
    expect(screen.getByText(/every login will need this key/i)).toBeInTheDocument()
    expect(runWebAuthnRegistration).not.toHaveBeenCalled()
  })

  it('registers a key after confirmation and reloads the list', async () => {
    let keys: unknown[] = []
    mockFetch(() => keys)
    vi.mocked(runWebAuthnRegistration).mockImplementation(async () => {
      keys = [{ id: 'k1', createdAt: Date.now(), transports: ['usb'] }]
      return true
    })
    renderSettings()
    await userEvent.click(await screen.findByRole('button', { name: /add a security key/i }))
    await userEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(await screen.findByText(/1 security key registered/i)).toBeInTheDocument()
  })

  it('logs out, and "log out everywhere" revokes all sessions first', async () => {
    const calls: string[] = []
    mockFetch((url) => { calls.push(url); return url.includes('credentials') ? [] : { ok: true } })
    const onLogout = renderSettings()
    await userEvent.click(await screen.findByRole('button', { name: /^log out$/i }))
    expect(onLogout).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: /log out everywhere/i }))
    expect(calls).toContain('/auth/logout-all')
    expect(onLogout).toHaveBeenCalledTimes(2)
  })
})
