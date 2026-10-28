import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import App from '../../app'
import { mockFetch } from '../../test-utils'

// Who applications are emailed to, the SoundCloud app and the feature flags have their own tests, in
// configuration/recipients.test.tsx, configuration/soundcloud.test.tsx and configuration/features.test.tsx: these are
// for the section that gathers them.

const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' } }
// No flags, so that these tests don't depend on flags that are bound to be retired.
const NO_FEATURES = { '/api/admin/features': { ok: true, features: [] } }
// Nobody gets applications by email yet, as on a new server.
const NO_RECIPIENTS = { '/api/admin/applications/recipients': { ok: true, recipients: [], updatedBy: null, updatedAt: null } }
// No SoundCloud credentials yet either.
const NO_CREDENTIALS = { '/api/admin/radio/credentials': { ok: true, credentials: null } }
const PAGE = { ...LOGGED_IN, ...NO_FEATURES, ...NO_RECIPIENTS, ...NO_CREDENTIALS }

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

describe('The configuration section', () => {
  it('shows who applications are emailed to, then the SoundCloud app, then the feature flags', async () => {
    mockFetch(PAGE)
    renderAt('/admin/configuration')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Configuration' })).toBeInTheDocument())
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'Envoi des candidatures par e-mail',
      'Connexion SoundCloud',
      'Features',
    ])
    await screen.findByText('Aucune feature pour le moment.')
    await screen.findByRole('textbox', { name: "Adresse e-mail d'un destinataire" })
    await screen.findByRole('textbox', { name: 'Client ID' })
  })

  it('is where /admin/features leads, since the feature flags moved there', async () => {
    mockFetch(PAGE)
    renderAt('/admin/features')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Configuration' })).toBeInTheDocument())
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/configuration')
  })

  it('says when the recipients could not be loaded, and still shows the features', async () => {
    mockFetch({ ...PAGE, '/api/admin/applications/recipients': { ok: false, error: 'Boom' } })
    renderAt('/admin/configuration')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les destinataires n'ont pas pu être chargés : Boom"))
    await screen.findByText('Aucune feature pour le moment.')
    await screen.findByRole('textbox', { name: 'Client ID' })
    expect(screen.queryByRole('textbox', { name: "Adresse e-mail d'un destinataire" })).not.toBeInTheDocument()
  })
})
