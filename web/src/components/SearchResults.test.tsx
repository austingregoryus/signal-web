import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchResults, snippet } from './SearchResults'
import type { SearchHit } from '../api/types'

const hit: SearchHit = {
  id: 7, conversationId: 'c1', authorId: 'a', timestamp: 1000, direction: 'in',
  body: 'are we still on for Dinner tonight?', conversationName: 'Alice', conversationType: 'dm',
}

describe('SearchResults', () => {
  it('shows the conversation and highlights the match, and picks on click', () => {
    const onPick = vi.fn()
    render(<SearchResults query="dinner" results={[hit]} loading={false} onPick={onPick} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Dinner').tagName).toBe('MARK')
    fireEvent.click(screen.getByRole('button'))
    expect(onPick).toHaveBeenCalledWith(hit)
  })

  it('says when nothing matches', () => {
    render(<SearchResults query="zebra" results={[]} loading={false} onPick={vi.fn()} />)
    expect(screen.getByText('No messages match "zebra"')).toBeInTheDocument()
  })

  it('trims long bodies around the match', () => {
    const body = `${'a'.repeat(100)} needle ${'b'.repeat(100)}`
    const s = snippet(body, 'NEEDLE')
    expect(s.match).toBe('needle')
    expect(s.before.startsWith('…')).toBe(true)
    expect(s.after.endsWith('…')).toBe(true)
  })
})
