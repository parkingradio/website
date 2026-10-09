import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import type { Application } from 'shared/applications'
import type { Artist } from 'shared/artists'
import App from '../../app'
import { jsonBody, mockFetch, requestsTo } from '../../test-utils'

const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' } }

function artist(id: string, name: string): Artist {
  return {
    id,
    createdAt: '2026-10-01T16:00:00.000Z',
    createdBy: 'admin@example.com',
    kind: 'artist',
    name,
    members: [],
    country: 'CA',
    city: 'Montréal',
    genres: ['techno'],
    bio: 'Une bio.',
    links: { soundcloud: name.toLowerCase() },
    email: `${name.toLowerCase()}@example.com`,
    phone: '514 555 0101',
    updatedBy: null,
    updatedAt: null,
  }
}

// Nobody gets applications by email yet, as on a new server.
const NO_RECIPIENTS = { '/api/admin/applications/recipients': { ok: true, recipients: [], updatedBy: null, updatedAt: null } }

const AURORE = artist('artist-1', 'Aurore')
const BRUME = artist('artist-2', 'Brume')
const ARTISTS = { '/api/admin/artists': { ok: true, artists: [AURORE, BRUME] } }

const APPLICATION: Application = {
  id: 'application-1',
  artistId: 'artist-1',
  createdAt: '2026-10-05T16:00:00.000Z',
  createdBy: 'admin@example.com',
  dates: ['2026-12-10', '2026-12-17', '2027-01-07', '2027-01-14'],
  timeSlots: [{ start: '18:00', end: '22:00' }],
  prestations: ['dj'],
  otherPrestation: 'Vinyle seulement',
  details: 'Une question ?\nUne autre.',
  updatedBy: null,
  updatedAt: null,
  status: 'new',
  statusUpdatedBy: null,
  statusUpdatedAt: null,
}

// Newest first, as the server lists them.
const APPLICATIONS: Application[] = [
  { ...APPLICATION, id: 'application-3', artistId: 'artist-2', createdAt: '2026-10-07T16:00:00.000Z', dates: ['2026-11-05'], prestations: ['rap'], status: 'rejected' },
  { ...APPLICATION, id: 'application-2', createdAt: '2026-10-06T16:00:00.000Z', dates: ['2026-11-12'], prestations: ['full-band'], otherPrestation: '', status: 'accepted' },
  APPLICATION,
]

function CurrentPath() {
  const location = useLocation()
  return <div data-testid="path">{location.pathname + location.search}</div>
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <CurrentPath />
    </MemoryRouter>,
  )
}

const rows = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))


describe('The list of applications', () => {
  it('lists every application, newest first, with its artist', async () => {
    mockFetch({ ...LOGGED_IN, ...NO_RECIPIENTS, ...ARTISTS, '/api/admin/applications': { ok: true, applications: APPLICATIONS } })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(rows()).toEqual([
      ['7 octobre 2026', 'Brume', '5 nov. 2026', 'Rap, autre : Vinyle seulement', 'refusée'],
      ['6 octobre 2026', 'Aurore', '12 nov. 2026', 'Full Band', 'retenue'],
      ['5 octobre 2026', 'Aurore', '10 déc. 2026, 17 déc. 2026, 7 janv. 2027 (+1)', 'DJ, autre : Vinyle seulement', 'nouvelle'],
    ])
    expect(screen.getByRole('link', { name: '5 octobre 2026' })).toHaveAttribute('href', '/admin/candidatures/application-1')
    expect(screen.getByRole('link', { name: 'Brume' })).toHaveAttribute('href', '/admin/artistes/artist-2')
    expect(screen.getByRole('link', { name: 'nouvelle candidature' })).toHaveAttribute('href', '/admin/candidatures/nouvelle')
  })

  it('lists only the applications with a status, once it is picked', async () => {
    mockFetch({ ...LOGGED_IN, ...NO_RECIPIENTS, ...ARTISTS, '/api/admin/applications': { ok: true, applications: APPLICATIONS } })
    renderAt('/admin/candidatures')

    const filters = within(await screen.findByRole('group', { name: 'Statut' }))
    expect(filters.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'toutes (3)',
      'nouvelles (1)',
      'retenues (1)',
      'refusées (1)',
    ])
    expect(filters.getByRole('button', { name: 'toutes (3)' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(filters.getByRole('button', { name: 'retenues (1)' }))
    expect(screen.getByTestId('path')).toHaveTextContent('/admin/candidatures?statut=accepted')
    expect(filters.getByRole('button', { name: 'retenues (1)' })).toHaveAttribute('aria-pressed', 'true')
    expect(rows().map((row) => row[0])).toEqual(['6 octobre 2026'])

    fireEvent.click(filters.getByRole('button', { name: 'toutes (3)' }))
    expect(rows()).toHaveLength(3)
  })

  it('lists the applications without their artists when those could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, ...NO_RECIPIENTS, '/api/admin/artists': { ok: false, error: 'Boom' }, '/api/admin/applications': { ok: true, applications: APPLICATIONS } })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom")
    expect(rows().map((row) => row[1])).toEqual(['artiste inconnu', 'artiste inconnu', 'artiste inconnu'])
  })

  it('says when there are no applications', async () => {
    mockFetch({ ...LOGGED_IN, ...NO_RECIPIENTS, ...ARTISTS, '/api/admin/applications': { ok: true, applications: [] } })
    renderAt('/admin/candidatures?statut=new')

    await waitFor(() => expect(screen.getByText('Aucune candidature.')).toBeInTheDocument())
  })

  it('says when the applications could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, ...NO_RECIPIENTS, ...ARTISTS, '/api/admin/applications': { ok: false, error: 'Boom' } })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les candidatures n'ont pas pu être chargées : Boom"))
  })
})

describe('Who applications are emailed to', () => {
  const URL = '/api/admin/applications/recipients'
  const LIST = { ...LOGGED_IN, ...ARTISTS, '/api/admin/applications': { ok: true, applications: [] } }
  const CHOSEN = { ok: true, recipients: ['equipe@example.com', 'booking@example.com'], updatedBy: 'admin@example.com', updatedAt: '2026-10-07T16:30:00.000Z' }

  const entry = () => screen.getByRole('textbox', { name: "Adresse e-mail d'un destinataire" })
  const shown = () =>
    within(screen.getByRole('group', { name: 'Destinataires' }))
      .queryAllByRole('listitem')
      .map((item) => item.firstChild?.textContent)
  const add = (value: string) => {
    fireEvent.change(entry(), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter ce destinataire' }))
  }

  it('shows the recipients, and who chose them', async () => {
    mockFetch({ ...LIST, [URL]: CHOSEN })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(shown()).toEqual(['equipe@example.com', 'booking@example.com']))
    expect(screen.getByRole('heading', { name: 'Envoi par e-mail' })).toBeInTheDocument()
    expect(screen.getByText(/^Changé par admin@example.com le 7 octobre 2026/)).toBeInTheDocument()
    expect(screen.queryByText(/Aucun destinataire/)).not.toBeInTheDocument()
    // Each change is saved right away.
    expect(screen.queryByRole('button', { name: 'enregistrer' })).not.toBeInTheDocument()
  })

  it('says that applications are emailed to nobody until recipients are chosen', async () => {
    mockFetch({ ...LIST, ...NO_RECIPIENTS })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(entry()).toBeInTheDocument())
    expect(shown()).toEqual([])
    expect(screen.getByText(/Aucun destinataire/)).toBeInTheDocument()
    expect(screen.queryByText(/^Changé par/)).not.toBeInTheDocument()
  })

  it('saves an address as soon as it is added, and shows the recipients as the server returns them', async () => {
    const saved = { ok: true, recipients: ['equipe@example.com'], updatedBy: 'admin@example.com', updatedAt: '2026-10-08T16:30:00.000Z' }
    mockFetch({ ...LIST, ...NO_RECIPIENTS, [`PUT ${URL}`]: saved })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(entry()).toBeInTheDocument())
    add(' equipe@example.com ')

    await waitFor(() => expect(shown()).toEqual(['equipe@example.com']))
    expect(requestsTo('PUT', URL).map(jsonBody)).toEqual([{ recipients: ['equipe@example.com'] }])
    expect(entry()).toHaveValue('')
    expect(screen.queryByText(/Aucun destinataire/)).not.toBeInTheDocument()
    expect(screen.getByText(/^Changé par admin@example.com le 8 octobre 2026/)).toBeInTheDocument()
  })

  it('adds the address with Enter too, and keeps the focus on it for the next one', async () => {
    mockFetch({ ...LIST, ...NO_RECIPIENTS, [`PUT ${URL}`]: { ...CHOSEN, recipients: ['equipe@example.com'] } })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(entry()).toBeInTheDocument())
    fireEvent.change(entry(), { target: { value: 'equipe@example.com' } })
    // Enter submits the form, which jsdom doesn't do by itself.
    fireEvent.submit(entry().closest('form')!)
    // Nothing can be added or removed while the recipients are being saved.
    expect(screen.getByRole('button', { name: 'ajouter ce destinataire' })).toBeDisabled()

    await waitFor(() => expect(shown()).toEqual(['equipe@example.com']))
    expect(requestsTo('PUT', URL).map(jsonBody)).toEqual([{ recipients: ['equipe@example.com'] }])
    expect(screen.getByRole('button', { name: 'ajouter ce destinataire' })).toBeEnabled()
    expect(entry()).toHaveFocus()
  })

  it('keeps what was typed while an address was being saved', async () => {
    mockFetch({ ...LIST, ...NO_RECIPIENTS })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(entry()).toBeInTheDocument())
    // The save only returns once `respond` is called.
    let respond: (response: Response) => void = () => {}
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => (respond = resolve)))
    add('equipe@example.com')
    fireEvent.change(entry(), { target: { value: 'booking@' } })
    respond({ ok: true, json: () => Promise.resolve({ ...CHOSEN, recipients: ['equipe@example.com'] }) } as Response)

    await waitFor(() => expect(shown()).toEqual(['equipe@example.com']))
    expect(entry()).toHaveValue('booking@')
  })

  it('saves the recipients as soon as one is removed', async () => {
    mockFetch({ ...LIST, [URL]: CHOSEN, [`PUT ${URL}`]: { ...CHOSEN, recipients: ['booking@example.com'] } })
    renderAt('/admin/candidatures')

    fireEvent.click(await screen.findByRole('button', { name: 'retirer equipe@example.com' }))
    expect(screen.getByRole('button', { name: 'retirer booking@example.com' })).toBeDisabled()
    await waitFor(() => expect(shown()).toEqual(['booking@example.com']))
    expect(requestsTo('PUT', URL).map(jsonBody)).toEqual([{ recipients: ['booking@example.com'] }])
    // Rather than being lost with the button that was clicked.
    expect(entry()).toHaveFocus()
  })

  it('keeps an address that could not be removed, and says why', async () => {
    mockFetch({ ...LIST, [URL]: CHOSEN, [`PUT ${URL}`]: { ok: false, error: 'Internal server error' } })
    renderAt('/admin/candidatures')

    fireEvent.click(await screen.findByRole('button', { name: 'retirer equipe@example.com' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("Les destinataires n'ont pas pu être enregistrés : Internal server error"),
    )
    expect(shown()).toEqual(['equipe@example.com', 'booking@example.com'])
  })

  it('stops adding addresses once there are as many as there can be', async () => {
    const recipients = Array.from({ length: 10 }, (_, i) => `admin-${i}@example.com`)
    mockFetch({ ...LIST, [URL]: { ...CHOSEN, recipients } })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(shown()).toEqual(recipients))
    expect(screen.getByRole('button', { name: 'ajouter ce destinataire' })).toBeDisabled()
  })

  it("doesn't save an address the recipients already have, whatever its case", async () => {
    mockFetch({ ...LIST, [URL]: CHOSEN })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(entry()).toBeInTheDocument())
    add('Equipe@Example.com')
    expect(entry()).toHaveValue('')
    expect(requestsTo('PUT', URL)).toHaveLength(0)
  })

  it("doesn't save what isn't an email address", async () => {
    mockFetch({ ...LIST, ...NO_RECIPIENTS })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(entry()).toBeInTheDocument())
    add('pas une adresse')
    expect(screen.getByText('Adresse e-mail invalide.')).toBeInTheDocument()
    expect(entry()).toHaveValue('pas une adresse')
    expect(entry()).toHaveAttribute('aria-invalid', 'true')
    expect(requestsTo('PUT', URL)).toHaveLength(0)

    // Until the address is changed.
    fireEvent.change(entry(), { target: { value: 'pas une adresse@' } })
    expect(screen.queryByText('Adresse e-mail invalide.')).not.toBeInTheDocument()
    expect(entry()).not.toHaveAttribute('aria-invalid')
  })

  it('says why an address could not be saved, and keeps it typed, until it is', async () => {
    mockFetch({ ...LIST, [URL]: CHOSEN, [`PUT ${URL}`]: { ok: false, error: 'Internal server error' } })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(entry()).toBeInTheDocument())
    add('autre@example.com')

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("Les destinataires n'ont pas pu être enregistrés : Internal server error"),
    )
    expect(shown()).toEqual(['equipe@example.com', 'booking@example.com'])
    expect(entry()).toHaveValue('autre@example.com')

    mockFetch({ ...LIST, [URL]: CHOSEN, [`PUT ${URL}`]: { ...CHOSEN, recipients: [...CHOSEN.recipients, 'autre@example.com'] } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter ce destinataire' }))
    await waitFor(() => expect(shown()).toEqual(['equipe@example.com', 'booking@example.com', 'autre@example.com']))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says when the recipients could not be loaded, and still lists the applications', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/applications': { ok: true, applications: APPLICATIONS }, [URL]: { ok: false, error: 'Boom' } })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les destinataires n'ont pas pu être chargés : Boom"))
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('An application’s page', () => {
  const PAGE = {
    ...LOGGED_IN,
    '/api/admin/applications/application-1': { ok: true, application: APPLICATION },
    '/api/admin/artists/artist-1': { ok: true, artist: AURORE },
  }

  it('says when the artist sent the application themselves', async () => {
    mockFetch({ ...PAGE, '/api/admin/applications/application-1': { ok: true, application: { ...APPLICATION, createdBy: null } } })
    renderAt('/admin/candidatures/application-1')

    await waitFor(() => expect(screen.getByText(/^Envoyée par/)).toBeInTheDocument())
    expect(screen.getByText(/^Envoyée par/)).toHaveTextContent('Envoyée par le formulaire « appliquer » le 5 octobre 2026.')
  })

  it('shows the application, and who the artist is', async () => {
    mockFetch(PAGE)
    renderAt('/admin/candidatures/application-1')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Candidature de Aurore' })).toBeInTheDocument())
    expect(screen.getByText(/^Créée par/)).toHaveTextContent(/^Créée par admin@example.com le 5 octobre 2026/)
    expect(screen.getByRole('button', { name: 'nouvelle' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: 'Aurore' })).toHaveAttribute('href', '/admin/artistes/artist-1')
    expect(screen.getByRole('link', { name: 'aurore@example.com' })).toHaveAttribute('href', 'mailto:aurore@example.com')
    expect(screen.getByText('jeudi 10 décembre 2026')).toBeInTheDocument()
    expect(screen.getByText('jeudi 14 janvier 2027')).toBeInTheDocument()
    expect(screen.getByText('18:00 à 22:00')).toBeInTheDocument()
    expect(screen.getByText('DJ, autre : Vinyle seulement')).toBeInTheDocument()
    expect(screen.getByText(/^Une question/)).toHaveTextContent('Une question ? Une autre.')
  })

  it('says when an application has no time slot, prestation or details', async () => {
    const bare = { ...APPLICATION, timeSlots: [], prestations: [], otherPrestation: '', details: '' }
    mockFetch({ ...PAGE, '/api/admin/applications/application-1': { ok: true, application: bare } })
    renderAt('/admin/candidatures/application-1')

    await waitFor(() => expect(screen.getByText('à toute heure')).toBeInTheDocument())
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('changes the status, and says who did', async () => {
    const accepted = { ...APPLICATION, status: 'accepted', statusUpdatedBy: 'other@example.com', statusUpdatedAt: '2026-10-06T16:00:00.000Z' }
    mockFetch({ ...PAGE, 'PUT /api/admin/applications/application-1/status': { ok: true, application: accepted } })
    renderAt('/admin/candidatures/application-1')

    fireEvent.click(await screen.findByRole('button', { name: 'retenue' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'retenue' })).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByRole('button', { name: 'nouvelle' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(/^Changé par/)).toHaveTextContent(/^Changé par other@example.com le 6 octobre 2026/)
    expect(jsonBody(requestsTo('PUT', '/api/admin/applications/application-1/status')[0])).toEqual({ status: 'accepted' })
  })

  it('says when the status could not be changed', async () => {
    mockFetch({ ...PAGE, 'PUT /api/admin/applications/application-1/status': { ok: false, error: 'No such application' } })
    renderAt('/admin/candidatures/application-1')

    fireEvent.click(await screen.findByRole('button', { name: 'refusée' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Le statut n'a pas pu être changé : No such application"))
    expect(screen.getByRole('button', { name: 'nouvelle' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('changes the application', async () => {
    const changed = { ...APPLICATION, details: 'Corrigé.', updatedBy: 'other@example.com', updatedAt: '2026-10-06T16:00:00.000Z' }
    mockFetch({ ...PAGE, 'PUT /api/admin/applications/application-1': { ok: true, application: changed } })
    renderAt('/admin/candidatures/application-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(screen.getByLabelText('Date 4')).toHaveValue('2027-01-14')
    expect(screen.getByLabelText('DJ')).toBeChecked()
    expect(screen.getByLabelText('Rap')).not.toBeChecked()
    expect(screen.getByLabelText('Performance Live')).not.toBeChecked()
    expect(screen.getByLabelText('Autre')).toHaveValue('Vinyle seulement')
    fireEvent.click(screen.getByRole('button', { name: 'retirer la date 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'ajouter une date' }))
    fireEvent.change(screen.getByLabelText('Date 4'), { target: { value: '2027-02-04' } })
    fireEvent.click(screen.getByRole('button', { name: 'retirer la plage 1' }))
    fireEvent.click(screen.getByLabelText('Rap'))
    fireEvent.change(screen.getByLabelText('Autre'), { target: { value: 'Vinyle, surtout' } })
    fireEvent.change(screen.getByLabelText('Questions ou détails'), { target: { value: 'Corrigé.' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(screen.getByText('Corrigé.')).toBeInTheDocument())
    expect(jsonBody(requestsTo('PUT', '/api/admin/applications/application-1')[0])).toEqual({
      dates: ['2026-12-17', '2027-01-07', '2027-01-14', '2027-02-04'],
      timeSlots: [],
      // By their ids.
      prestations: ['dj', 'rap'],
      otherPrestation: 'Vinyle, surtout',
      details: 'Corrigé.',
    })
    expect(screen.getByText(/^Modifiée par/)).toHaveTextContent(/^Modifiée par other@example.com le 6 octobre 2026/)
  })

  it('sends the prestations in the order of the list, whatever order they were checked in', async () => {
    mockFetch({ ...PAGE, 'PUT /api/admin/applications/application-1': { ok: true, application: APPLICATION } })
    renderAt('/admin/candidatures/application-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.click(screen.getByLabelText('Full Band'))
    fireEvent.click(screen.getByLabelText('Vinyl'))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(requestsTo('PUT', '/api/admin/applications/application-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PUT', '/api/admin/applications/application-1')[0]).prestations).toEqual(['dj', 'vinyl', 'full-band'])
  })

  it('shows a prestation that is no longer in the list by its id, as wrong, until it is unchecked', async () => {
    const application = { ...APPLICATION, prestations: ['dj', 'theremin'] }
    mockFetch({
      ...PAGE,
      '/api/admin/applications/application-1': { ok: true, application },
      'PUT /api/admin/applications/application-1': { ok: true, application: APPLICATION },
    })
    renderAt('/admin/candidatures/application-1')

    expect(await screen.findByText('DJ, theremin, autre : Vinyle seulement')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'modifier' }))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(screen.getByText("Une des prestations n'est pas dans la liste.")).toBeInTheDocument()
    expect(screen.getByLabelText('theremin')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('theremin')).toHaveFocus()
    expect(requestsTo('PUT', '/api/admin/applications/application-1')).toHaveLength(0)

    fireEvent.click(screen.getByLabelText('theremin'))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/applications/application-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PUT', '/api/admin/applications/application-1')[0]).prestations).toEqual(['dj'])
  })

  it('says what is wrong with a time slot once the time slots are left, and sends nothing', async () => {
    mockFetch(PAGE)
    renderAt('/admin/candidatures/application-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.click(screen.getByRole('button', { name: 'ajouter une plage horaire' }))
    const start = screen.getByLabelText('Début de la plage 2')
    const end = screen.getByLabelText('Fin de la plage 2')
    fireEvent.change(start, { target: { value: '23:00' } })
    // Going from the start to the end of the slot isn't leaving the time slots.
    fireEvent.blur(start, { relatedTarget: end })
    expect(screen.queryByText('Une des plages horaires est invalide.')).not.toBeInTheDocument()
    fireEvent.change(end, { target: { value: '21:00' } })
    fireEvent.blur(end)
    expect(screen.getByText('Une des plages horaires est invalide.')).toBeInTheDocument()
    expect(start).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Début de la plage 1')).not.toHaveAttribute('aria-invalid')

    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(start).toHaveFocus())
    expect(requestsTo('PUT', '/api/admin/applications/application-1')).toHaveLength(0)
  })

  it('needs at least one date', async () => {
    mockFetch(PAGE)
    renderAt('/admin/candidatures/application-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    for (const index of [4, 3, 2]) fireEvent.click(screen.getByRole('button', { name: `retirer la date ${index}` }))
    fireEvent.change(screen.getByLabelText('Date 1'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    expect(screen.getByText('Choisis au moins une date.')).toBeInTheDocument()
    expect(requestsTo('PUT', '/api/admin/applications/application-1')).toHaveLength(0)
  })

  it('counts a date that is left empty as wrong, rather than dropping it', async () => {
    mockFetch(PAGE)
    renderAt('/admin/candidatures/application-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.click(screen.getByRole('button', { name: 'ajouter une date' }))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    expect(screen.getByText('Une des dates est invalide.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Date 5')).toHaveFocus())
    expect(requestsTo('PUT', '/api/admin/applications/application-1')).toHaveLength(0)
  })

  it('shows why the server refused the application, and keeps the form', async () => {
    mockFetch({ ...PAGE, 'PUT /api/admin/applications/application-1': { ok: false, error: 'No such application' } })
    renderAt('/admin/candidatures/application-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("La candidature n'a pas pu être enregistrée : No such application"))
    expect(screen.getByRole('button', { name: 'enregistrer' })).toBeEnabled()
  })

  it('deletes the application once confirmed, and goes back to the list', async () => {
    mockFetch({
      ...PAGE,
      ...ARTISTS,
      ...NO_RECIPIENTS,
      'DELETE /api/admin/applications/application-1': { ok: true },
      '/api/admin/applications': { ok: true, applications: [] },
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderAt('/admin/candidatures/application-1')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Candidature de Aurore' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'supprimer la candidature' }))
    expect(confirm).toHaveBeenLastCalledWith('Supprimer définitivement cette candidature de Aurore ?')
    expect(requestsTo('DELETE', '/api/admin/applications/application-1')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'supprimer la candidature' }))
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures$/))
  })

  it('says when the application could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/applications/nope': { ok: false, error: 'No such application' } })
    renderAt('/admin/candidatures/nope')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("La candidature n'a pas pu être chargée : No such application"))
  })
})

describe('Creating an application', () => {
  it('creates an application for the artist it was started from, then shows it', async () => {
    const created = { ...APPLICATION, id: 'application-4', artistId: 'artist-2', timeSlots: [], prestations: ['dj'], otherPrestation: 'B2B', details: '' }
    mockFetch({
      ...LOGGED_IN,
      ...ARTISTS,
      'POST /api/admin/applications': { ok: true, application: created },
      '/api/admin/applications/application-4': { ok: true, application: created },
      '/api/admin/artists/artist-2': { ok: true, artist: BRUME },
    })
    renderAt('/admin/candidatures/nouvelle?artiste=artist-2')

    const picked = await screen.findByLabelText('Artiste')
    expect(picked).toHaveValue('artist-2')
    fireEvent.change(screen.getByLabelText('Date 1'), { target: { value: '2026-12-10' } })
    fireEvent.click(screen.getByLabelText('DJ'))
    fireEvent.change(screen.getByLabelText('Autre'), { target: { value: 'B2B' } })
    fireEvent.click(screen.getByRole('button', { name: 'créer la candidature' }))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/admin/candidatures/application-4'))
    expect(jsonBody(requestsTo('POST', '/api/admin/applications')[0])).toEqual({
      artistId: 'artist-2',
      dates: ['2026-12-10'],
      timeSlots: [],
      prestations: ['dj'],
      otherPrestation: 'B2B',
      details: '',
    })
  })

  it('picks no artist when started from an unknown one, and needs one to be picked', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS })
    renderAt('/admin/candidatures/nouvelle?artiste=gone')

    expect(await screen.findByLabelText('Artiste')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Date 1'), { target: { value: '2026-12-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'créer la candidature' }))
    expect(screen.getByText("Choisis l'artiste.")).toBeInTheDocument()
    expect(requestsTo('POST', '/api/admin/applications')).toHaveLength(0)
  })

  it('asks to add the artist first when there is none', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists: [] } })
    renderAt('/admin/candidatures/nouvelle')

    await waitFor(() => expect(screen.getByRole('link', { name: "ajoutez d'abord l'artiste" })).toHaveAttribute('href', '/admin/artistes/nouveau'))
  })
})
