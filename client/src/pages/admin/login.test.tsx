import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { jsonBody, mockFetch, requestsTo } from '../../test-utils'
import { Login } from './login'

function renderLogin(onLogin = vi.fn()) {
  render(
    <MemoryRouter>
      <Login onLogin={onLogin} />
    </MemoryRouter>,
  )
  return onLogin
}

function logIn(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Courriel'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'se connecter' }))
}

describe('Login', () => {
  it('reports the logged-in email after a successful login', async () => {
    mockFetch({ 'POST /api/auth/login': { ok: true, email: 'Admin@example.com' } })
    const onLogin = renderLogin()

    logIn('admin@example.com', 'correct-password')

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('Admin@example.com'))
    expect(requestsTo('POST', '/api/auth/login').map(jsonBody)).toEqual([{ email: 'admin@example.com', password: 'correct-password' }])
  })

  it('shows an error after a failed login', async () => {
    mockFetch({ 'POST /api/auth/login': { ok: false, error: 'Invalid email or password' } })
    const onLogin = renderLogin()

    logIn('admin@example.com', 'wrong-password')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password'))
    expect(onLogin).not.toHaveBeenCalled()
  })

  it('shows its notice rather than the message the page was opened with', () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/admin', state: { message: 'Mot de passe enregistré.' } }]}>
        <Login onLogin={vi.fn()} notice="La session a pris fin." />
      </MemoryRouter>,
    )
    expect(screen.getByText('La session a pris fin.')).toBeInTheDocument()
    expect(screen.queryByText('Mot de passe enregistré.')).not.toBeInTheDocument()
  })
})
