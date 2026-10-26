import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import type { Application } from 'shared/applications'
import App from '../../app'
import type { Artist } from '../../artist-profile'
import { jsonBody, mockFetch, requestsTo } from '../../test-utils'

const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' } }

function artist(id: string, name: string): Artist {
  return {
    id,
    hasPhoto: true,
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

const AURORE = artist('artist-1', 'Aurore')
const BRUME = artist('artist-2', 'Brume')
const ARTISTS = { '/api/admin/artists': { ok: true, artists: [AURORE, BRUME] } }

const APPLICATION: Application = {
  id: 'application-1',
  artistId: 'artist-1',
  receivedAt: '2026-10-05T16:00:00.000Z',
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

// The most recently received first, as the server lists them. The last one came by email in March, and was created after
// the others.
const APPLICATIONS: Application[] = [
  { ...APPLICATION, id: 'application-4', receivedAt: '2026-10-08T16:00:00.000Z', createdAt: '2026-10-08T16:00:00.000Z', dates: ['2026-10-29'], prestations: ['vinyl'], otherPrestation: '', status: 'done' },
  { ...APPLICATION, id: 'application-3', artistId: 'artist-2', receivedAt: '2026-10-07T16:00:00.000Z', createdAt: '2026-10-07T16:00:00.000Z', dates: ['2026-11-05'], prestations: ['rap'], status: 'rejected' },
  { ...APPLICATION, id: 'application-2', receivedAt: '2026-10-06T16:00:00.000Z', createdAt: '2026-10-06T16:00:00.000Z', dates: ['2026-11-12'], prestations: ['full-band'], otherPrestation: '', status: 'accepted' },
  { ...APPLICATION, receivedAt: '2026-03-28T14:00:00.000Z', createdAt: '2026-10-09T16:00:00.000Z' },
]

function CurrentPath() {
  const location = useLocation()
  return <div data-testid="path">{location.pathname + location.search}</div>
}

function renderAt(path: string) {
  render(
    // Without transitions, like the app (see main.tsx).
    <MemoryRouter initialEntries={[path]} useTransitions={false}>
      <App />
      <CurrentPath />
    </MemoryRouter>,
  )
}

const rows = () =>
  screen
    .queryAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
const received = () => rows().map((row) => row[0])

// Searches for `query`, and waits for the list to show `found`, by when they were received.
async function expectSearch(query: string, found: string[]) {
  const field = await screen.findByRole('searchbox', { name: 'Rechercher' })
  fireEvent.change(field, { target: { value: query } })
  expect(field).toHaveValue(query)
  await waitFor(() => expect(received()).toEqual(found))
}


describe('The list of applications', () => {
  it('lists every application, the most recently received first, with when it was received and its artist', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/applications': { ok: true, applications: APPLICATIONS } })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(rows()).toEqual([
      ['8 octobre 2026', 'Aurore', '29 oct. 2026', 'Vinyl', 'faite'],
      ['7 octobre 2026', 'Brume', '5 nov. 2026', 'Rap, autre : Vinyle seulement', 'refusée'],
      ['6 octobre 2026', 'Aurore', '12 nov. 2026', 'Full Band', 'retenue'],
      ['28 mars 2026', 'Aurore', '10 déc. 2026, 17 déc. 2026, 7 janv. 2027 (+1)', 'DJ, autre : Vinyle seulement', 'nouvelle'],
    ])
    // There's nothing more to do about an application that's done, so it's greyed out like a rejected one.
    expect(screen.getByRole('cell', { name: 'faite' })).toHaveClass('admin-status-done')
    expect(screen.getByRole('link', { name: '28 mars 2026' })).toHaveAttribute('href', '/admin/candidatures/application-1')
    expect(screen.getByRole('link', { name: 'Brume' })).toHaveAttribute('href', '/admin/artistes/artist-2')
    expect(screen.getByRole('link', { name: 'nouvelle candidature' })).toHaveAttribute('href', '/admin/candidatures/nouvelle')
    // Where who they're emailed to is chosen.
    expect(within(screen.getByText(/se choisissent dans la/)).getByRole('link')).toHaveAttribute('href', '/admin/configuration')
  })

  it('lists only the applications with a status, once it is picked', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/applications': { ok: true, applications: APPLICATIONS } })
    renderAt('/admin/candidatures')

    const filters = within(await screen.findByRole('group', { name: 'Statut' }))
    expect(filters.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'toutes (4)',
      'nouvelles (1)',
      'retenues (1)',
      'planifiées (0)',
      'faites (1)',
      'refusées (1)',
    ])
    expect(filters.getByRole('button', { name: 'toutes (4)' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(filters.getByRole('button', { name: 'retenues (1)' }))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures\?statut=accepted$/)
    expect(filters.getByRole('button', { name: 'retenues (1)' })).toHaveAttribute('aria-pressed', 'true')
    expect(rows().map((row) => row[0])).toEqual(['6 octobre 2026'])

    fireEvent.click(filters.getByRole('button', { name: 'toutes (4)' }))
    expect(rows()).toHaveLength(4)
  })

  it('lists the applications without their artists when those could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: false, error: 'Boom' }, '/api/admin/applications': { ok: true, applications: APPLICATIONS } })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom")
    expect(rows().map((row) => row[1])).toEqual(['artiste inconnu', 'artiste inconnu', 'artiste inconnu', 'artiste inconnu'])
  })

  it('says when there are no applications', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/applications': { ok: true, applications: [] } })
    renderAt('/admin/candidatures?statut=new')

    await waitFor(() => expect(screen.getByText('Aucune candidature.')).toBeInTheDocument())
  })

  it('says when the applications could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/applications': { ok: false, error: 'Boom' } })
    renderAt('/admin/candidatures')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les candidatures n'ont pas pu être chargées : Boom"))
  })
})

describe('Searching the list of applications', () => {
  // Details of their own for one of them, to find it by them, and none for one that would say "autre" otherwise.
  const DETAILS: Record<string, string> = { 'application-2': 'Disponible en soirée.', 'application-4': '' }
  const SEARCHED = APPLICATIONS.map((application) => ({ ...application, details: DETAILS[application.id] ?? application.details }))
  const LISTED = { ...LOGGED_IN, ...ARTISTS, '/api/admin/applications': { ok: true, applications: SEARCHED } }

  it('finds applications by their artist', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures')

    await expectSearch('brume', ['7 octobre 2026'])
    await expectSearch('aurore@example.com', ['8 octobre 2026', '6 octobre 2026', '28 mars 2026'])
  })

  it('finds applications by their prestations and details', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures')

    await expectSearch('rap', ['7 octobre 2026'])
    // "Vinyl", and "Vinyle seulement" for the others.
    await expectSearch('vinyl', ['8 octobre 2026', '7 octobre 2026', '28 mars 2026'])
    await expectSearch('soiree', ['6 octobre 2026'])
    // Those with something else they'd do, as the list says.
    await expectSearch('autre', ['7 octobre 2026', '28 mars 2026'])
  })

  it('finds applications by the days their artists would like to play, by month, weekday or day', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures')

    // The first one would like to play on Thursdays in December and January, the others on a Thursday each, in October
    // and November.
    await expectSearch('decembre', ['28 mars 2026'])
    await expectSearch('novembre', ['7 octobre 2026', '6 octobre 2026'])
    await expectSearch('janvier 2027', ['28 mars 2026'])
    await expectSearch('jeudi', ['8 octobre 2026', '7 octobre 2026', '6 octobre 2026', '28 mars 2026'])
    await expectSearch('12 novembre', ['6 octobre 2026'])
    // Not when they were received.
    await expectSearch('mars', [])
  })

  it('counts the applications the search finds, by status, and keeps both in the URL', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures')

    await expectSearch('aurore', ['8 octobre 2026', '6 octobre 2026', '28 mars 2026'])
    const filters = within(screen.getByRole('group', { name: 'Statut' }))
    expect(filters.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'toutes (3)',
      'nouvelles (1)',
      'retenues (1)',
      'planifiées (0)',
      'faites (1)',
      'refusées (0)',
    ])

    fireEvent.click(filters.getByRole('button', { name: 'retenues (1)' }))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures\?recherche=aurore&statut=accepted$/)
    expect(received()).toEqual(['6 octobre 2026'])
  })

  it('says there are none with a status, rather than that none matches, when there are none with it at all', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?statut=scheduled&recherche=aurore')

    await waitFor(() => expect(screen.getByText('Aucune candidature.')).toBeInTheDocument())
  })

  it('says when no application matches', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?recherche=zzzzzz')

    await waitFor(() => expect(screen.getByText('Aucune candidature ne correspond à la recherche.')).toBeInTheDocument())
    expect(screen.getByRole('searchbox', { name: 'Rechercher' })).toHaveValue('zzzzzz')
  })

  it('still finds applications by what they say when the artists could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: false, error: 'Boom' }, '/api/admin/applications': { ok: true, applications: SEARCHED } })
    renderAt('/admin/candidatures?recherche=soiree')

    await waitFor(() => expect(received()).toEqual(['6 octobre 2026']))
  })
})

describe('Sorting the list of applications', () => {
  const LISTED = { ...LOGGED_IN, ...ARTISTS, '/api/admin/applications': { ok: true, applications: APPLICATIONS } }

  it('lists the most recently received first, then the other way around', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures')

    const header = await screen.findByRole('columnheader', { name: 'Reçue le' })
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Reçue le ↓', 'Artiste', 'Dates', 'Prestations', 'Statut'])
    // There's no order to prestations.
    expect(within(screen.getByRole('columnheader', { name: 'Prestations' })).queryByRole('button')).not.toBeInTheDocument()

    fireEvent.click(within(header).getByRole('button'))
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    expect(received()).toEqual(['28 mars 2026', '6 octobre 2026', '7 octobre 2026', '8 octobre 2026'])
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures\?tri=recue&ordre=asc$/)
  })

  it('sorts the applications the way their column first sorts them when the URL does not say which way', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?tri=recue')

    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Reçue le' })).toHaveAttribute('aria-sort', 'descending'))
    expect(received()).toEqual(['8 octobre 2026', '7 octobre 2026', '6 octobre 2026', '28 mars 2026'])
  })

  it('sorts the applications by artist, each artist’s the most recently received first', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures')

    fireEvent.click(await screen.findByRole('button', { name: 'Artiste' }))
    expect(rows().map((row) => row.slice(0, 2))).toEqual([
      ['8 octobre 2026', 'Aurore'],
      ['6 octobre 2026', 'Aurore'],
      ['28 mars 2026', 'Aurore'],
      ['7 octobre 2026', 'Brume'],
    ])
  })

  it('sorts the applications by the first day their artists would like to play', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?tri=recue&ordre=asc')

    fireEvent.click(await screen.findByRole('button', { name: 'Dates' }))
    expect(rows().map((row) => row[2])).toEqual(['29 oct. 2026', '5 nov. 2026', '12 nov. 2026', '10 déc. 2026, 17 déc. 2026, 7 janv. 2027 (+1)'])
  })

  it('sorts the applications by status, in the order they usually go through them', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures')

    fireEvent.click(await screen.findByRole('button', { name: 'Statut' }))
    expect(rows().map((row) => row[4])).toEqual(['nouvelle', 'retenue', 'faite', 'refusée'])
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

  it('says when the application was received, when that is not the day it was created', async () => {
    const received = { ...APPLICATION, receivedAt: '2026-03-28T14:00:00.000Z' }
    mockFetch({ ...PAGE, '/api/admin/applications/application-1': { ok: true, application: received } })
    renderAt('/admin/candidatures/application-1')

    await waitFor(() => expect(screen.getByText(/^Reçue le/)).toHaveTextContent('Reçue le 28 mars 2026.'))
    expect(screen.getByText(/^Créée par/)).toHaveTextContent(/^Créée par admin@example.com le 5 octobre 2026/)
  })

  it('says once when the application was received and created the same day', async () => {
    // E.g. if the admin who created it picked that day, which is received at its start.
    const received = { ...APPLICATION, receivedAt: new Date('2026-10-05T00:00').toISOString(), createdAt: new Date('2026-10-05T12:00').toISOString() }
    mockFetch({ ...PAGE, '/api/admin/applications/application-1': { ok: true, application: received } })
    renderAt('/admin/candidatures/application-1')

    await waitFor(() => expect(screen.getByText(/^Créée par/)).toHaveTextContent(/^Créée par admin@example.com le 5 octobre 2026/))
    expect(screen.queryByText(/^Reçue le/)).not.toBeInTheDocument()
  })

  it('shows the application, and who the artist is', async () => {
    mockFetch(PAGE)
    renderAt('/admin/candidatures/application-1')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Candidature de Aurore' })).toBeInTheDocument())
    expect(screen.getByText(/^Créée par/)).toHaveTextContent(/^Créée par admin@example.com le 5 octobre 2026/)
    // It was received the day it was created, which is said once.
    expect(screen.queryByText(/^Reçue le/)).not.toBeInTheDocument()
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
    expect(screen.getByLabelText('Reçue le')).toHaveValue('2026-10-05')
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
    // Without when it was received, which didn't change, so that the server keeps the time too.
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

  it('changes when the application was received, to the start of the day picked', async () => {
    mockFetch({ ...PAGE, 'PUT /api/admin/applications/application-1': { ok: true, application: APPLICATION } })
    renderAt('/admin/candidatures/application-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.change(screen.getByLabelText('Reçue le'), { target: { value: '2026-03-28' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(requestsTo('PUT', '/api/admin/applications/application-1')).toHaveLength(1))
    // In the browser's time zone, like the admin pages show dates.
    expect(jsonBody(requestsTo('PUT', '/api/admin/applications/application-1')[0]).receivedAt).toBe(new Date('2026-03-28T00:00').toISOString())
  })

  it('needs a day when the application was received, which is not in the future', async () => {
    mockFetch(PAGE)
    renderAt('/admin/candidatures/application-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    const received = screen.getByLabelText('Reçue le')
    fireEvent.change(received, { target: { value: '2099-01-01' } })
    fireEvent.blur(received)
    expect(screen.getByText('La date de réception ne peut pas être dans le futur.')).toBeInTheDocument()
    expect(received).toHaveAttribute('aria-invalid', 'true')

    // Browsers let years have more digits than the server takes.
    fireEvent.change(received, { target: { value: '20260-03-28' } })
    expect(screen.getByText('La date de réception est invalide.')).toBeInTheDocument()

    fireEvent.change(received, { target: { value: '' } })
    expect(screen.getByText('Choisissez le jour où la candidature a été reçue.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(received).toHaveFocus())
    expect(requestsTo('PUT', '/api/admin/applications/application-1')).toHaveLength(0)
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

    expect(screen.getByText('Choisissez au moins une date.')).toBeInTheDocument()
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
    // Received now, unless said otherwise.
    expect(screen.getByLabelText('Reçue le')).toHaveValue('')
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

  it('sends when the application was received, if a day was picked', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, 'POST /api/admin/applications': { ok: true, application: APPLICATION } })
    renderAt('/admin/candidatures/nouvelle?artiste=artist-1')

    fireEvent.change(await screen.findByLabelText('Reçue le'), { target: { value: '2026-03-28' } })
    fireEvent.change(screen.getByLabelText('Date 1'), { target: { value: '2026-12-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'créer la candidature' }))

    await waitFor(() => expect(requestsTo('POST', '/api/admin/applications')).toHaveLength(1))
    expect(jsonBody(requestsTo('POST', '/api/admin/applications')[0])).toMatchObject({
      artistId: 'artist-1',
      receivedAt: new Date('2026-03-28T00:00').toISOString(),
    })
  })

  it('picks no artist when started from an unknown one, and needs one to be picked', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS })
    renderAt('/admin/candidatures/nouvelle?artiste=gone')

    expect(await screen.findByLabelText('Artiste')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Date 1'), { target: { value: '2026-12-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'créer la candidature' }))
    expect(screen.getByText("Choisissez l'artiste.")).toBeInTheDocument()
    expect(requestsTo('POST', '/api/admin/applications')).toHaveLength(0)
  })

  it('asks to add the artist first when there is none', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists: [] } })
    renderAt('/admin/candidatures/nouvelle')

    await waitFor(() => expect(screen.getByRole('link', { name: "ajoutez d'abord l'artiste" })).toHaveAttribute('href', '/admin/artistes/nouveau'))
  })
})
