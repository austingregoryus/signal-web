import { describe, it, expect, vi } from 'vitest'
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
  it('scrolls to and highlights a message picked from search', () => {
    // jsdom has no scrollIntoView; stub it to record which element was targeted.
    const scrolled: string[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push((this as HTMLElement).dataset.msgKey ?? '')
    })
    try {
      const { container } = render(<Thread conversationId="c1" messages={msgs} highlightKey="a:2000" />)
      expect(scrolled).toEqual(['a:2000'])
      expect(container.querySelector('[data-msg-key="a:2000"]')?.className).toMatch(/highlighted/)
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })
})
