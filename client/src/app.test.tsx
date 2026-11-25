import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useNavigate } from 'react-router'
import App from './pages/admin/test-app'
import { UNAUTHORIZED, mockFetch } from './test-utils'

describe('App', () => {
  it('renders the home page at /', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByTitle('Parking Radio Discord')).toBeInTheDocument()
  })

  it('renders the navbar with links to every page', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'archives' })).toHaveAttribute('href', '/archives')
    expect(screen.getByRole('link', { name: 'programmation' })).toHaveAttribute(
      'href',
      '/programmation',
    )
    expect(screen.getByRole('link', { name: 'synth meetups' })).toHaveAttribute(
      'href',
      '/synth-meetups',
    )
    expect(screen.getByRole('link', { name: 'appliquer' })).toHaveAttribute('href', '/appliquer')
    expect(screen.getByRole('link', { name: 'contribuer' })).toHaveAttribute('href', '/contribuer')
    expect(screen.getByRole('link', { name: 'merch' })).toHaveAttribute(
      'href',
      'https://parkingdotradio.bigcartel.com',
    )
  })

  it('renders the rotating logo, linking back to the home page', async () => {
    render(
      <MemoryRouter initialEntries={['/archives']}>
        <App />
      </MemoryRouter>,
    )
    const logo = screen.getByAltText('parking.radio')
    expect(logo.closest('a')).toHaveAttribute('href', '/')

    // The logo renders before /api/config resolves, so its src only appears once it has.
    expect(logo).not.toHaveAttribute('src')
    await waitFor(() =>
      expect(logo).toHaveAttribute('src', 'https://assets.example.test/p_3d_spin.gif'),
    )
  })

  it('renders /accept-invite', async () => {
    mockFetch({ '/api/admin/me': UNAUTHORIZED })
    render(
      <MemoryRouter initialEntries={['/accept-invite?token=abc']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Choisir un mot de passe' })).toBeInTheDocument()
  })

  it.each(['/foo', '/admin/foo'])('renders a not found page, with the navbar, at %s', (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Page introuvable' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'archives' })).toBeInTheDocument()
  })
})

describe("when the admin pages can't be loaded", () => {
  afterEach(() => {
    vi.doUnmock('./pages/admin/admin-pages')
    vi.resetModules()
  })

  it('says so in their place, under the navbar, until the page is reloaded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // An App module loads them once, hence a new one.
    vi.resetModules()
    vi.doMock('./pages/admin/admin-pages', () => {
      throw new Error('Failed to fetch dynamically imported module')
    })
    const { default: App } = await import('./app')
    function ToSessions() {
      const navigate = useNavigate()
      return <button onClick={() => navigate('/admin/sessions')}>sessions</button>
    }
    render(
      <MemoryRouter initialEntries={['/admin/calendrier']}>
        <App />
        <ToSessions />
      </MemoryRouter>,
    )
    const failed = "La page n'a pas pu être chargée. Rechargez la page pour réessayer."
    expect(await screen.findByRole('alert')).toHaveTextContent(failed)
    expect(screen.getByRole('link', { name: 'archives' })).toBeInTheDocument()
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.any(Error))

    fireEvent.click(screen.getByRole('button', { name: 'sessions' }))
    expect(screen.getByRole('alert')).toHaveTextContent(failed)

    // The public pages still work.
    fireEvent.click(screen.getByRole('link', { name: 'archives' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTitle('Parking Radio Archives')).toBeInTheDocument()
  })
})
