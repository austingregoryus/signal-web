import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer, MAX_ATTACHMENT_BYTES, type ComposerHandle } from './Composer'

describe('Composer', () => {
  it('sends on click and clears', async () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'hello there')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).toHaveBeenCalledWith('hello there', undefined, undefined)
    expect(box).toHaveValue('')
  })
  it('sends on Enter but not Shift+Enter', async () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'line{Shift>}{Enter}{/Shift}two')
    expect(onSend).not.toHaveBeenCalled()
    await userEvent.type(box, '{Enter}')
    expect(onSend).toHaveBeenCalledWith('line\ntwo', undefined, undefined)
  })
  it('keeps the text and shows an error when send fails', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('network error'))
    render(<Composer onSend={onSend} />)
    const box = screen.getByRole('textbox')
    await userEvent.type(box, 'hello there')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(box).toHaveValue('hello there')
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't send/i)
  })
})

describe('Composer attachments', () => {
  const png = (name = 'cat.png', size = 4): File => new File([new Uint8Array(size)], name, { type: 'image/png' })

  it('queues a picked file and sends it with the text', async () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} />)
    await userEvent.upload(screen.getByLabelText('Attachment file'), png())
    expect(await screen.findByRole('img', { name: 'cat.png' })).toBeInTheDocument()
    expect(onSend).not.toHaveBeenCalled() // picking no longer sends immediately
    await userEvent.type(screen.getByRole('textbox'), 'look')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).toHaveBeenCalledWith('look', [expect.stringMatching(/^data:image\/png;base64,/)], undefined)
    await waitFor(() => expect(screen.queryByRole('img', { name: 'cat.png' })).toBeNull())
  })

  it('queues a pasted image and can send it without text', async () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} />)
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { files: [png('')] } })
    expect(await screen.findByRole('img', { name: 'Pasted image' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).toHaveBeenCalledWith('', [expect.stringMatching(/^data:image\/png;base64,/)], undefined)
  })

  it('lets a queued file be removed before sending', async () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} />)
    await userEvent.upload(screen.getByLabelText('Attachment file'), png())
    await userEvent.click(await screen.findByRole('button', { name: 'Remove cat.png' }))
    expect(screen.queryByRole('img', { name: 'cat.png' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('refuses a file over the size cap', async () => {
    render(<Composer onSend={vi.fn()} />)
    const big = png('huge.png')
    Object.defineProperty(big, 'size', { value: MAX_ATTACHMENT_BYTES + 1 })
    await userEvent.upload(screen.getByLabelText('Attachment file'), big)
    expect(await screen.findByRole('alert')).toHaveTextContent(/too big/i)
    expect(screen.queryByRole('img', { name: 'huge.png' })).toBeNull()
  })

  it('accepts files handed over by a drop elsewhere on the page', async () => {
    const ref = createRef<ComposerHandle>()
    render(<Composer ref={ref} onSend={vi.fn()} />)
    act(() => ref.current?.addFiles([png('dropped.png')]))
    expect(await screen.findByRole('img', { name: 'dropped.png' })).toBeInTheDocument()
  })
})
