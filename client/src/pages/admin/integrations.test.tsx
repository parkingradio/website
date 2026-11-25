import { render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import App from '../../app'
import { mockFetch } from '../../test-utils'

// The admin pages load on demand (see AdminPage in shell.tsx): load them up front, so that no test waits for them.
beforeAll(() => import('./admin-pages'))

// Connecting Claude, the connected apps, the calendars and the bookmarklet have their own tests, in
// integrations/connections.test.tsx, integrations/calendars.test.tsx and integrations/ra-bookmarklet.test.tsx: these are
// for the section that gathers them.

const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' } }
const PAGE = { ...LOGGED_IN, '/api/admin/connections': { ok: true, connections: [] } }

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('The integrations section', () => {
  it('shows how to connect Claude, then the connected apps, the calendars, then the bookmarklet', async () => {
    mockFetch(PAGE)
    renderAt('/admin/integrations')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Intégrations' })).toBeInTheDocument())
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Connecter Claude',
      'Vos applications connectées',
      'Calendriers',
      'Publier sur RA',
    ])
    await screen.findByText('Aucune application connectée.')
  })
})
