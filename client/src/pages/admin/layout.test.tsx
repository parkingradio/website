import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import App from '../../app'
import { mockFetch, requestsTo } from '../../test-utils'

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

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Calendrier' })).toBeInTheDocument())
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/calendrier')
    expect(within(adminMenu()).getByText('admin@example.com')).toBeInTheDocument()
  })

  it('links to every section from the menu, in order', async () => {
    mockFetch(LOGGED_IN)
    renderAt('/admin')

    await waitFor(() => expect(adminMenu()).toBeInTheDocument())
    expect(within(adminMenu()).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['calendrier', '/admin/calendrier'],
      ['rotation radio', '/admin/rotation'],
      ['candidatures', '/admin/candidatures'],
      ['artistes', '/admin/artistes'],
      ['admins', '/admin/admins'],
      ['configuration', '/admin/configuration'],
    ])
  })

  it('shows the login form in place of the page while logged out, then the page once logged in', async () => {
    mockFetch({ ...LOGGED_OUT, '/api/auth/login': { ok: true, email: 'admin@example.com' }, '/api/admin/invite': { ok: true } })
    renderAt('/admin/admins')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    expect(screen.queryByRole('navigation', { name: 'admin' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Courriel'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'correct-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'se connecter' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Admins' })).toBeInTheDocument())
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/admins')
  })

  it('shows the login form again after logging out', async () => {
    mockFetch({ ...LOGGED_IN, '/api/auth/logout': { ok: true } })
    renderAt('/admin/admins')

    await waitFor(() => expect(adminMenu()).toBeInTheDocument())
    fireEvent.click(within(adminMenu()).getByRole('button', { name: 'se déconnecter' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    // Without a body, which it doesn't take, nor a Content-Type, which the server would refuse without one.
    const [logout] = requestsTo('POST', '/api/auth/logout')
    expect(logout.body).toBe('')
    expect(new Headers(logout.headers).has('content-type')).toBe(false)
  })

  it('stays logged in when logging out fails', async () => {
    mockFetch({ ...LOGGED_IN, '/api/auth/logout': { ok: false, error: 'Internal server error' } })
    renderAt('/admin/admins')

    await waitFor(() => expect(adminMenu()).toBeInTheDocument())
    fireEvent.click(within(adminMenu()).getByRole('button', { name: 'se déconnecter' }))

    await waitFor(() => expect(requestsTo('POST', '/api/auth/logout')).toHaveLength(1))
    expect(adminMenu()).toBeInTheDocument()
  })

  it('sends /login to the admin pages', async () => {
    mockFetch(LOGGED_OUT)
    renderAt('/login')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    expect(screen.getByTestId('path')).toHaveTextContent('/admin')
  })
})
