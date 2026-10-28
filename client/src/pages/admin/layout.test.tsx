import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import App from '../../app'
import { api } from '../../api/client'
import { UNAUTHORIZED, mockFetch, requestsTo } from '../../test-utils'

const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' } }
const LOGGED_OUT = { '/api/admin/me': UNAUTHORIZED }
const SESSION_ENDED = 'La session a pris fin. Connectez-vous à nouveau pour continuer.'

function CurrentPath() {
  return <div data-testid="path">{useLocation().pathname}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <CurrentPath />
    </MemoryRouter>,
  )
}

const adminMenu = () => screen.getByRole('navigation', { name: 'admin' })

function logIn() {
  fireEvent.change(screen.getByLabelText('Courriel'), { target: { value: 'admin@example.com' } })
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'correct-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'se connecter' }))
}

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
    expect(screen.queryByText(SESSION_ENDED)).not.toBeInTheDocument()

    logIn()

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Admins' })).toBeInTheDocument())
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/admins')
  })

  it('shows the login form again after logging out', async () => {
    mockFetch({ ...LOGGED_IN, '/api/auth/logout': { ok: true } })
    renderAt('/admin/admins')

    await waitFor(() => expect(adminMenu()).toBeInTheDocument())
    fireEvent.click(within(adminMenu()).getByRole('button', { name: 'se déconnecter' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    expect(screen.queryByText(SESSION_ENDED)).not.toBeInTheDocument()
    // Without a body, which it doesn't take, nor a Content-Type, which the server would refuse without one.
    const [logout] = requestsTo('POST', '/api/auth/logout')
    expect(logout.body).toBe('')
    expect(new Headers(logout.headers).has('content-type')).toBe(false)
  })

  it('stays logged in when logging out fails, and says so until trying again', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/admins': { ok: true, admins: [] }, '/api/auth/logout': { ok: false, error: 'Internal server error' } })
    renderAt('/admin/admins')

    await waitFor(() => expect(adminMenu()).toBeInTheDocument())
    const logout = within(adminMenu()).getByRole('button', { name: 'se déconnecter' })
    fireEvent.click(logout)

    await waitFor(() => expect(within(adminMenu()).getByRole('alert')).toHaveTextContent('La déconnexion a échoué : Internal server error'))
    expect(requestsTo('POST', '/api/auth/logout')).toHaveLength(1)

    fireEvent.click(logout)
    expect(within(adminMenu()).queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(requestsTo('POST', '/api/auth/logout')).toHaveLength(2))
    await waitFor(() => expect(within(adminMenu()).getByRole('alert')).toBeInTheDocument())
  })

  it('shows the login form when the session ends while a page is open, then the page, loaded anew, once logged in', async () => {
    // Both of the section's requests fail, as they would once the session ended.
    mockFetch({ ...LOGGED_IN, '/api/admin/applications': UNAUTHORIZED, '/api/admin/artists': UNAUTHORIZED })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    expect(screen.getByText(SESSION_ENDED)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'admin' })).not.toBeInTheDocument()
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/candidatures')

    mockFetch({
      ...LOGGED_IN,
      '/api/admin/applications': { ok: true, applications: [] },
      '/api/admin/artists': { ok: true, artists: [] },
      '/api/auth/login': { ok: true, email: 'admin@example.com' },
    })
    logIn()

    await waitFor(() => expect(screen.getByText('Aucune candidature.')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(SESSION_ENDED)).not.toBeInTheDocument()
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/candidatures')
  })

  it('shows the login form when the session ends, in StrictMode too', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/admins': UNAUTHORIZED })
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/admin/admins']}>
          <App />
        </MemoryRouter>
      </StrictMode>,
    )

    await waitFor(() => expect(screen.getByText(SESSION_ENDED)).toBeInTheDocument())
    expect(screen.getAllByRole('heading', { name: 'Connexion' })).toHaveLength(1)
  })

  it("doesn't say that the session ended after logging out, even when a request fails with 401 meanwhile", async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/admins': { ok: true, admins: [] }, '/api/admin/features': UNAUTHORIZED, '/api/auth/logout': { ok: true } })
    // A request of the section's, which fails with 401 while the logout is under way.
    const answer = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (input instanceof Request && input.url.endsWith('/api/auth/logout')) await api.GET('/api/admin/features')
      return answer(input, init)
    })
    renderAt('/admin/admins')

    await waitFor(() => expect(adminMenu()).toBeInTheDocument())
    fireEvent.click(within(adminMenu()).getByRole('button', { name: 'se déconnecter' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    await waitFor(() => expect(requestsTo('POST', '/api/auth/logout')).toHaveLength(1))
    expect(screen.queryByText(SESSION_ENDED)).not.toBeInTheDocument()
  })

  it('stops listening for the session ending once the admin pages are gone', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/admins': { ok: true, admins: [] }, '/api/admin/features': UNAUTHORIZED })
    const { unmount } = renderAt('/admin/admins')
    await waitFor(() => expect(adminMenu()).toBeInTheDocument())
    const error = vi.spyOn(console, 'error')

    unmount()
    expect(await api.GET('/api/admin/features')).toEqual({ ok: false, error: 'Unauthorized' })
    expect(error).not.toHaveBeenCalled()
  })

  it("says so, rather than showing the login form, when it can't tell whether there's a session", async () => {
    // Firefox's message, which already ends with a period.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('NetworkError when attempting to fetch resource.'))))
    renderAt('/admin/admins')

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "La session n'a pas pu être vérifiée : NetworkError when attempting to fetch resource. Rechargez la page pour réessayer.",
      ),
    )
    expect(screen.queryByRole('heading', { name: 'Connexion' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'admin' })).not.toBeInTheDocument()
  })

  it('sends /login to the admin pages', async () => {
    mockFetch(LOGGED_OUT)
    renderAt('/login')

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument())
    expect(screen.getByTestId('path')).toHaveTextContent('/admin')
  })
})
