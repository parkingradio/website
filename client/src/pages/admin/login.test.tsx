import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, email: 'Admin@example.com' }) }),
    )
    const onLogin = renderLogin()

    logIn('admin@example.com', 'correct-password')

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('Admin@example.com'))
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ body: JSON.stringify({ email: 'admin@example.com', password: 'correct-password' }) }),
    )
  })

  it('shows an error after a failed login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ ok: false, error: 'Invalid email or password' }),
      }),
    )
    const onLogin = renderLogin()

    logIn('admin@example.com', 'wrong-password')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password'))
    expect(onLogin).not.toHaveBeenCalled()
  })
})
