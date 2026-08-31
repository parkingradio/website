import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AcceptInvite } from './accept-invite'
import { Login } from './login'

function renderAcceptInvite() {
  return render(
    <MemoryRouter initialEntries={['/accept-invite?token=abc']}>
      <Routes>
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/login" element={<Login />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AcceptInvite', () => {
  it('renders without crashing', () => {
    const { container } = renderAcceptInvite()
    expect(container).not.toBeEmptyDOMElement()
  })

  it('shows the minimum password length hint', () => {
    renderAcceptInvite()
    expect(screen.getByText('Must be at least 8 characters.')).toBeInTheDocument()
  })

  it('navigates to /login after successfully setting a password', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) }))
    renderAcceptInvite()

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'new-password-123' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'new-password-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/accept-invite',
      expect.objectContaining({ body: JSON.stringify({ token: 'abc', password: 'new-password-123' }) }),
    )
  })

  it('rejects a password shorter than 8 characters without calling the server', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderAcceptInvite()

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))

    await waitFor(() => expect(screen.getByText(/Password must be at least 8 characters/)).toBeInTheDocument())
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords without calling the server', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderAcceptInvite()

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'new-password-123' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'different-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))

    await waitFor(() => expect(screen.getByText('Passwords do not match')).toBeInTheDocument())
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows the server error for an invalid or expired token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ ok: false, error: 'Invalid or expired invite link' }) }),
    )
    renderAcceptInvite()

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'new-password-123' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'new-password-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }))

    await waitFor(() => expect(screen.getByText('Invalid or expired invite link')).toBeInTheDocument())
  })
})
