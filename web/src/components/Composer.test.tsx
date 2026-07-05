import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from './Composer'

describe('Composer', () => {
  it('sends on click and clears', async () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'hello there')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).toHaveBeenCalledWith('hello there')
    expect(box).toHaveValue('')
  })
  it('sends on Enter but not Shift+Enter', async () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'line{Shift>}{Enter}{/Shift}two')
    expect(onSend).not.toHaveBeenCalled()
    await userEvent.type(box, '{Enter}')
    expect(onSend).toHaveBeenCalledWith('line\ntwo')
  })
})
