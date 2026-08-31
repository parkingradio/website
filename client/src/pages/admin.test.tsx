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
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('shows a confirmation after successfully inviting a new admin', async () => {
    mockFetch({
      '/api/admin/me': () => Promise.resolve({ ok: true, email: 'admin@example.com' }),
      '/api/admin/invite': () => Promise.resolve({ ok: true }),
    })
    renderAdmin()
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new-admin@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))

    await waitFor(() => expect(screen.getByText('Invite sent.')).toBeInTheDocument())
  })

  it('shows the error after a failed invite', async () => {
    mockFetch({
      '/api/admin/me': () => Promise.resolve({ ok: true, email: 'admin@example.com' }),
      '/api/admin/invite': () => Promise.resolve({ ok: false, error: 'This email address is already an activated admin' }),
    })
    renderAdmin()
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'already-admin@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }))

    await waitFor(() =>
      expect(screen.getByText(/Failed to send invite: This email address is already an activated admin/)).toBeInTheDocument(),
    )
  })
})
