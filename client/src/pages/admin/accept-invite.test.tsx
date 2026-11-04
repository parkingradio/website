import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AcceptInvite } from './accept-invite'
import { AdminLayout } from './layout'
import { UNAUTHORIZED, jsonBody, mockFetch, requestsTo } from '../../test-utils'

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

// Waits until the answer of /api/admin/me has been handled, so that a note it would show is there.
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
  expect(requestsTo('GET', '/api/admin/me')).toHaveLength(1)
}

describe('AcceptInvite', () => {
  // No one is logged in, unless a test says otherwise.
  beforeEach(() => mockFetch({ '/api/admin/me': UNAUTHORIZED }))

  it('renders without crashing', () => {
    const { container } = renderAcceptInvite()
    expect(container).not.toBeEmptyDOMElement()
  })

  it('shows the minimum password length hint', () => {
    renderAcceptInvite()
    expect(screen.getByText('Au moins 8 caractères.')).toBeInTheDocument()
  })

  it('says who is logged in, whom saving the password logs out, and then leads to the login form', async () => {
    mockFetch({ '/api/admin/me': { ok: true, email: 'inviter@example.com' } })
    renderAcceptInvite()

    expect(
      await screen.findByText('Ce navigateur est connecté en tant que inviter@example.com. Enregistrer ce mot de passe le déconnectera.'),
    ).toBeInTheDocument()

    // Accepting the invite clears the session cookie.
    mockFetch({ '/api/auth/accept-invite': { ok: true }, '/api/admin/me': UNAUTHORIZED })
    submit('new-password-123')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    expect(screen.getByText('Mot de passe enregistré, vous pouvez maintenant vous connecter.')).toBeInTheDocument()
  })

  it("says nothing about who's logged in when no one is", async () => {
    renderAcceptInvite()
    await settle()
    expect(screen.queryByText(/Ce navigateur est connecté/)).not.toBeInTheDocument()
  })

  it("says nothing about who's logged in when that can't be known", async () => {
    // Without an answer for /api/admin/me, asking it fails as when the network does.
    mockFetch({})
    renderAcceptInvite()
    await settle()
    expect(screen.queryByText(/Ce navigateur est connecté/)).not.toBeInTheDocument()
  })

  it('leads to the login form after successfully setting a password', async () => {
    mockFetch({ '/api/auth/accept-invite': { ok: true }, '/api/admin/me': UNAUTHORIZED })
    renderAcceptInvite()

    submit('new-password-123')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    expect(screen.getByText('Mot de passe enregistré, vous pouvez maintenant vous connecter.')).toBeInTheDocument()
    expect(requestsTo('POST', '/api/auth/accept-invite').map(jsonBody)).toEqual([{ token: 'abc', password: 'new-password-123' }])
  })

  it('rejects a password shorter than 8 characters without calling the server', async () => {
    renderAcceptInvite()

    submit('short')

    await waitFor(() => expect(screen.getByText(/Le mot de passe doit contenir au moins 8 caractères/)).toBeInTheDocument())
    expect(requestsTo('POST', '/api/auth/accept-invite')).toEqual([])
  })

  it('rejects mismatched passwords without calling the server', async () => {
    renderAcceptInvite()

    submit('new-password-123', 'different-password')

    await waitFor(() => expect(screen.getByText('Les mots de passe ne correspondent pas')).toBeInTheDocument())
    expect(requestsTo('POST', '/api/auth/accept-invite')).toEqual([])
  })

  it('shows the server error for an invalid or expired token', async () => {
    mockFetch({ '/api/auth/accept-invite': { ok: false, error: 'Invalid or expired invite link' }, '/api/admin/me': UNAUTHORIZED })
    renderAcceptInvite()

    submit('new-password-123')

    await waitFor(() => expect(screen.getByText('Invalid or expired invite link')).toBeInTheDocument())
  })
})
