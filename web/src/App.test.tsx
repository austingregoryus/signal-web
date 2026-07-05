import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { App } from './App'

afterEach(() => vi.restoreAllMocks())

describe('App', () => {
  it('shows the login screen when anonymous', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }))
    render(<App />)
    await waitFor(() => expect(screen.getByText('Signal Web')).toBeInTheDocument())
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })
})
