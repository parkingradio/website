import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AcceptInvite } from './accept-invite'
import { AdminLayout } from './layout'
import { mockFetch } from '../../test-utils'

function submit(password: string, confirmPassword = password) {
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: confirmPassword } })
  fireEvent.click(screen.getByRole('button', { name: 'enregistrer le mot de passe' }))
}

function renderAcceptInvite() {
  return render(
    <MemoryRouter initialEntries={['/accept-invite?token=abc']}>
      <Routes>
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/admin" element={<AdminLayout />} />
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
    expect(screen.getByText('Au moins 8 caractères.')).toBeInTheDocument()
  })

  it('leads to the login form after successfully setting a password', async () => {
    mockFetch({
      '/api/auth/accept-invite': { ok: true },
      // Not logged in yet.
      '/api/admin/me': { ok: false, error: 'Unauthorized' },
    })
    renderAcceptInvite()

    submit('new-password-123')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    expect(screen.getByText('Mot de passe enregistré, vous pouvez maintenant vous connecter.')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/accept-invite',
      expect.objectContaining({ body: JSON.stringify({ token: 'abc', password: 'new-password-123' }) }),
    )
  })

  it('rejects a password shorter than 8 characters without calling the server', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderAcceptInvite()

    submit('short')

    await waitFor(() => expect(screen.getByText(/Le mot de passe doit contenir au moins 8 caractères/)).toBeInTheDocument())
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords without calling the server', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderAcceptInvite()

    submit('new-password-123', 'different-password')

    await waitFor(() => expect(screen.getByText('Les mots de passe ne correspondent pas')).toBeInTheDocument())
    expect(fetch).not.toHaveBeenCalled()
  })

  it('shows the server error for an invalid or expired token', async () => {
    mockFetch({ '/api/auth/accept-invite': { ok: false, error: 'Invalid or expired invite link' } })
    renderAcceptInvite()

    submit('new-password-123')

    await waitFor(() => expect(screen.getByText('Invalid or expired invite link')).toBeInTheDocument())
  })
})
