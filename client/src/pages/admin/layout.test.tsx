import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import App from '../../app'
import { mockFetch } from '../../test-utils'

const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' } }
const LOGGED_OUT = { '/api/admin/me': { ok: false, error: 'Unauthorized' } }

function CurrentPath() {
  return <div data-testid="path">{useLocation().pathname}</div>
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <CurrentPath />
    </MemoryRouter>,
  )
}

const adminMenu = () => screen.getByRole('navigation', { name: 'admin' })

describe('Admin pages', () => {
  it('shows the first section at /admin', async () => {
    mockFetch(LOGGED_IN)
    renderAt('/admin')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Admins' })).toBeInTheDocument())
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/admins')
    expect(within(adminMenu()).getByText('admin@example.com')).toBeInTheDocument()
  })

  it('links to every section from the menu', async () => {
    mockFetch(LOGGED_IN)
    renderAt('/admin')

    await waitFor(() => expect(adminMenu()).toBeInTheDocument())
    for (const [name, path] of [
      ['admins', '/admin/admins'],
      ['calendrier', '/admin/calendrier'],
      ['rotation radio', '/admin/rotation'],
      ['candidatures', '/admin/candidatures'],
    ]) {
      expect(within(adminMenu()).getByRole('link', { name })).toHaveAttribute('href', path)
    }
  })

  it.each([
    ['/admin/calendrier', 'Calendrier'],
    ['/admin/rotation', 'Rotation radio'],
    ['/admin/candidatures', 'Candidatures'],
  ])('shows a placeholder at %s', async (path, heading) => {
    mockFetch(LOGGED_IN)
    renderAt(path)

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument())
    expect(screen.getByText('Pas encore implémenté !')).toBeInTheDocument()
  })

  it('shows the login form in place of the page while logged out, then the page once logged in', async () => {
    mockFetch({ ...LOGGED_OUT, '/api/auth/login': { ok: true, email: 'admin@example.com' } })
    renderAt('/admin/rotation')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    expect(screen.queryByRole('navigation', { name: 'admin' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Courriel'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'correct-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'se connecter' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Rotation radio' })).toBeInTheDocument())
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/rotation')
  })

  it('shows the login form again after logging out', async () => {
    mockFetch({ ...LOGGED_IN, '/api/auth/logout': { ok: true } })
    renderAt('/admin/admins')

    await waitFor(() => expect(adminMenu()).toBeInTheDocument())
    fireEvent.click(within(adminMenu()).getByRole('button', { name: 'se déconnecter' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }))
  })

  it('sends /login to the admin pages', async () => {
    mockFetch(LOGGED_OUT)
    renderAt('/login')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    expect(screen.getByTestId('path')).toHaveTextContent('/admin')
  })
})
