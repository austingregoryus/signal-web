import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Attachment } from './Attachment'

describe('Attachment', () => {
  it('renders an image for image content types', () => {
    render(<Attachment meta={{ id: 'att-1', contentType: 'image/png', filename: 'p.png' }} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', '/api/attachments/att-1')
  })
  it('renders a download link for other types', () => {
    render(<Attachment meta={{ id: 'att-2', contentType: 'application/pdf', filename: 'doc.pdf' }} />)
    const link = screen.getByRole('link', { name: /doc\.pdf/i })
    expect(link).toHaveAttribute('href', '/api/attachments/att-2')
  })
})
