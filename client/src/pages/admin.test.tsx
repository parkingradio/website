import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { Admin } from './admin'
import { Login } from './login'

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<Admin />} />
        <Route path="/login" element={<Login />} />
      </Routes>
    </MemoryRouter>,
  )
}

function mockFetch(handlers: Record<string, () => Promise<{ ok: boolean } & Record<string, unknown>>>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const handler = handlers[url]
      if (!handler) throw new Error(`Unexpected fetch to ${url}`)
      return handler().then((body) => ({
        ok: body.ok,
        json: () => Promise.resolve(body),
      })) as unknown as Promise<Response>
    }),
  )
}

describe('Admin', () => {
  it('redirects to /login when not authenticated', async () => {
    mockFetch({ '/api/admin/me': () => Promise.resolve({ ok: false }) })
    renderAdmin()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument())
  })

  it('renders the admin page when authenticated', async () => {
    mockFetch({ '/api/admin/me': () => Promise.resolve({ ok: true, email: 'admin@example.com' }) })
    renderAdmin()

    await waitFor(() => expect(screen.getByText(/Logged in as admin@example.com/)).toBeInTheDocument())
    expect(screen.getByLabelText('Recipient email')).toBeInTheDocument()
  })

  it('shows the message id after a successful send', async () => {
    mockFetch({
      '/api/admin/me': () => Promise.resolve({ ok: true, email: 'admin@example.com' }),
      '/api/admin/send-test-email': () => Promise.resolve({ ok: true, messageId: 'abc-123' }),
    })
    renderAdmin()
    await waitFor(() => expect(screen.getByLabelText('Recipient email')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Recipient email'), { target: { value: 'you@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }))

    await waitFor(() => expect(screen.getByText(/Email sent \(id: abc-123\)/)).toBeInTheDocument())
  })

  it('shows the error after a failed send', async () => {
    mockFetch({
      '/api/admin/me': () => Promise.resolve({ ok: true, email: 'admin@example.com' }),
      '/api/admin/send-test-email': () => Promise.resolve({ ok: false, error: 'MessageRejected' }),
    })
    renderAdmin()
    await waitFor(() => expect(screen.getByLabelText('Recipient email')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Recipient email'), { target: { value: 'you@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }))

    await waitFor(() => expect(screen.getByText(/Failed to send email: MessageRejected/)).toBeInTheDocument())
  })
})
