import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Admin } from './admin'

describe('Admin', () => {
  it('renders without crashing', () => {
    const { container } = render(<Admin />)
    expect(container).not.toBeEmptyDOMElement()
  })

  it('shows the message id after a successful send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, messageId: 'abc-123' }) }),
    )
    render(<Admin />)

    fireEvent.change(screen.getByLabelText('Recipient email'), { target: { value: 'you@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }))

    await waitFor(() => expect(screen.getByText(/Email sent \(id: abc-123\)/)).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/send-test-email',
      expect.objectContaining({ body: JSON.stringify({ recipient: 'you@example.com' }) }),
    )
  })

  it('shows the error after a failed send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ ok: false, error: 'MessageRejected' }) }),
    )
    render(<Admin />)

    fireEvent.change(screen.getByLabelText('Recipient email'), { target: { value: 'you@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }))

    await waitFor(() => expect(screen.getByText(/Failed to send email: MessageRejected/)).toBeInTheDocument())
  })
})
