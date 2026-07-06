import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog title="Sure?" message="Are you sure?" onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel when the cancel button or Escape is used', () => {
    const onCancel = vi.fn()
    const { rerender } = render(<ConfirmDialog title="Sure?" message="x" onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    // Escape also closes.
    rerender(<ConfirmDialog title="Sure?" message="x" onConfirm={() => {}} onCancel={onCancel} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('calls onCancel when the backdrop is clicked, not when the modal body is clicked', () => {
    const onCancel = vi.fn()
    const { container } = render(<ConfirmDialog title="Sure?" message="x" onConfirm={() => {}} onCancel={onCancel} />)
    // The overlay is the click-catchable backdrop (the outermost div).
    const overlay = container.firstElementChild as HTMLElement
    fireEvent.click(overlay)
    expect(onCancel).toHaveBeenCalledTimes(1)
    // Clicking inside the modal body must NOT close.
    fireEvent.click(screen.getByRole('alertdialog'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
