import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EmojiPicker } from './EmojiPicker'

describe('EmojiPicker', () => {
  it('shows the first category by default and calls onPick when an emoji is clicked', () => {
    const onPick = vi.fn()
    render(<EmojiPicker onPick={onPick} onClose={() => {}} />)
    // The picker is a listbox with emoji option buttons.
    const heartEyes = screen.getByRole('option', { name: 'heart' })
    fireEvent.click(heartEyes)
    expect(onPick).toHaveBeenCalledWith('😍')
  })

  it('keeps the picker open after a pick (so several can be added in a row)', () => {
    const onPick = vi.fn()
    render(<EmojiPicker onPick={onPick} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('option', { name: 'joy' }))
    fireEvent.click(screen.getByRole('option', { name: 'heart' }))
    expect(onPick).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('filters by the search query', () => {
    const onPick = vi.fn()
    render(<EmojiPicker onPick={onPick} onClose={() => {}} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pizza' } })
    const opts = screen.getAllByRole('option')
    expect(opts).toHaveLength(1)
    expect(opts[0]).toHaveTextContent('🍕')
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<EmojiPicker onPick={() => {}} onClose={onClose} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
