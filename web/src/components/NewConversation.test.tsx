import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewConversation } from './NewConversation'

afterEach(() => { vi.restoreAllMocks() })

describe('NewConversation', () => {
  it('rejects a non-E.164 number with a validation message', async () => {
    const user = userEvent.setup()
    const onStarted = vi.fn()
    render(<NewConversation onClose={() => {}} onStarted={onStarted} />)
    await user.type(screen.getByPlaceholderText('+15551234567'), 'not-a-number')
    fireEvent.click(screen.getByRole('button', { name: /start conversation/i }))
    expect(await screen.findByText(/E\.164 format/i)).toBeInTheDocument()
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('requires a first message before submitting', async () => {
    const onStarted = vi.fn()
    render(<NewConversation onClose={() => {}} onStarted={onStarted} />)
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), { target: { value: '+15551234567' } })
    fireEvent.click(screen.getByRole('button', { name: /start conversation/i }))
    expect(await screen.findByText(/enter a first message/i)).toBeInTheDocument()
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('submits to /api/start and calls onStarted with the conversation id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ conversationId: 'uuid-from-server' }), { status: 200 }),
    )
    const onStarted = vi.fn()
    render(<NewConversation onClose={() => {}} onStarted={onStarted} />)
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), { target: { value: '+15551234567' } })
    fireEvent.change(screen.getByPlaceholderText('Type a message…'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: /start conversation/i }))
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('uuid-from-server'))
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<NewConversation onClose={onClose} onStarted={() => {}} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
