import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConversationList } from './ConversationList'

const convs = [
  { id: 'alice-uuid', type: 'dm' as const, displayName: 'Alice', avatarPath: null, lastActivity: 2 },
  { id: '+15551110002', type: 'dm' as const, displayName: null, avatarPath: null, lastActivity: 1 },
]

describe('ConversationList', () => {
  it('renders names and falls back to the id when unnamed', () => {
    render(<ConversationList conversations={convs} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('+15551110002')).toBeInTheDocument()
  })
  it('calls onSelect when a row is clicked', async () => {
    const onSelect = vi.fn()
    render(<ConversationList conversations={convs} selectedId={null} onSelect={onSelect} />)
    await userEvent.click(screen.getByText('Alice'))
    expect(onSelect).toHaveBeenCalledWith('alice-uuid')
  })
  it('calls onDelete when the row delete button is clicked (not onSelect)', async () => {
    const onSelect = vi.fn()
    const onDelete = vi.fn()
    render(<ConversationList conversations={convs} selectedId={null} onSelect={onSelect} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: /delete conversation with alice/i }))
    expect(onDelete).toHaveBeenCalledWith(convs[0])
    expect(onSelect).not.toHaveBeenCalled()
  })
})
