import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Message } from './Message'
import type { Message as Msg } from '../api/types'

const base = {
  id: 1, conversationId: 'c1', authorId: 'a', authorNumber: null,
  timestamp: 1000, direction: 'in' as const, body: 'hello',
  editedTimestamp: null, deleted: 0 as const,
  quoteAuthorId: null, quoteTimestamp: null,
  reactions: [], receipts: [], attachments: [],
}

describe('Message', () => {
  it('fires onReply when the reply button is clicked', () => {
    const onReply = vi.fn()
    render(<Message m={base} onReply={onReply} />)
    fireEvent.click(screen.getByRole('button', { name: /reply/i }))
    expect(onReply).toHaveBeenCalledWith(base)
  })

  it('renders a quote preview when the message quotes another', () => {
    const quoted: Msg = { ...base, id: 0, timestamp: 500, body: 'original text' }
    const reply: Msg = { ...base, id: 2, body: 'a response', quoteAuthorId: 'a', quoteTimestamp: 500 }
    render(<Message m={reply} quoteOf={(authorId, ts) => (authorId === 'a' && ts === 500 ? quoted : undefined)} />)
    expect(screen.getByText('original text')).toBeInTheDocument()
  })

  it('does not render a reply button on deleted messages', () => {
    const deleted = { ...base, deleted: 1 as const, body: null }
    render(<Message m={deleted} onReply={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /reply/i })).toBeNull()
  })

  it('shows an edit button only on own outgoing text messages', () => {
    const onEdit = vi.fn()
    // Inbound message: no edit button.
    const { rerender } = render(<Message m={base} onEdit={onEdit} />)
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull()
    // Outgoing text message: edit button present and fires onEdit.
    const outgoing = { ...base, direction: 'out' as const, body: 'my msg' }
    rerender(<Message m={outgoing} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalledWith(outgoing)
    // Outgoing but empty/deleted: no edit button.
    rerender(<Message m={{ ...outgoing, body: '' }} onEdit={onEdit} />)
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull()
  })
})
