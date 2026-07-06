import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Thread } from './Thread'
import type { Message } from '../api/types'

const base = { conversationId: 'c1', authorId: 'a', authorNumber: null, reactions: [], receipts: [], attachments: [], quoteAuthorId: null, quoteTimestamp: null }
const msgs: Message[] = [
  { ...base, id: 1, timestamp: 1000, direction: 'in', body: 'hello', editedTimestamp: null, deleted: 0 },
  { ...base, id: 2, timestamp: 2000, direction: 'out', body: 'hi back', editedTimestamp: 2500, deleted: 0 },
  { ...base, id: 3, timestamp: 3000, direction: 'in', body: null, editedTimestamp: null, deleted: 1 },
]

describe('Thread', () => {
  it('renders inbound and outbound messages', () => {
    render(<Thread messages={msgs} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('hi back')).toBeInTheDocument()
  })
  it('shows an edited marker and a deleted tombstone', () => {
    render(<Thread messages={msgs} />)
    expect(screen.getByText(/edited/i)).toBeInTheDocument()
    expect(screen.getByText(/deleted/i)).toBeInTheDocument()
  })
})
