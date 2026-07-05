import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Reactions } from './Reactions'

describe('Reactions', () => {
  it('groups reactions with counts', () => {
    render(<Reactions reactions={[
      { reactorId: 'a', emoji: '👍', timestamp: 1 },
      { reactorId: 'b', emoji: '👍', timestamp: 2 },
      { reactorId: 'c', emoji: '❤️', timestamp: 3 },
    ]} onReact={() => {}} />)
    expect(screen.getByText('👍 2')).toBeInTheDocument()
    expect(screen.getByText('❤️ 1')).toBeInTheDocument()
  })
  it('emits an emoji from the picker', async () => {
    const onReact = vi.fn()
    render(<Reactions reactions={[]} onReact={onReact} />)
    await userEvent.click(screen.getByRole('button', { name: /add reaction/i }))
    await userEvent.click(screen.getByRole('button', { name: '❤️' }))
    expect(onReact).toHaveBeenCalledWith('❤️')
  })
})
