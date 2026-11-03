import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import App from '../../app'
import type { Artist } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import type { Session, StudioSet } from '../../session-fields'
import { jsonBody, mockFetch, requestsTo } from '../../test-utils'

const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' } }

function artist(id: string, name: string, genres: Artist['genres']): Artist {
  return {
    id,
    hasPhoto: false,
    createdAt: '2026-10-01T16:00:00.000Z',
    createdBy: 'admin@example.com',
    name,
    country: 'CA',
    city: 'Montréal',
    genres,
    bio: '',
    links: {},
    email: `${name.toLowerCase()}@example.com`,
    phone: '',
    updatedBy: null,
    updatedAt: null,
    collectives: [],
  }
}

const AURORE = artist('artist-1', 'Aurore', ['techno', 'acid'])
const BRUME = artist('artist-2', 'Brume', ['ambient'])
const CYAN = artist('artist-3', 'Cyan', ['house', 'techno'])
const ONDES: Collective = {
  id: 'collective-1',
  hasPhoto: false,
  createdAt: '2026-10-01T16:00:00.000Z',
  createdBy: 'admin@example.com',
  name: 'Ondes',
  members: [{ id: 'artist-1', name: 'Aurore' }],
  country: 'CA',
  city: 'Québec',
  description: '',
  links: {},
  email: 'ondes@example.com',
  phone: '',
  updatedBy: null,
  updatedAt: null,
}
const ARTISTS = { '/api/admin/artists': { ok: true, artists: [AURORE, BRUME, CYAN] } }
const COLLECTIVES = { '/api/admin/collectives': { ok: true, collectives: [ONDES] } }

function raEvent(id: string, title: string, start: string) {
  return { id, title, category: 'other', start, end: null, venue: null, city: null, lineup: [], url: `https://ra.co/events/${id}`, flyer: null }
}

// RA's events, in no particular order, whose times are RA's, without a time zone.
const EVENTS = {
  '/api/events': {
    ok: true,
    promoterUrl: 'https://ra.co/promoters/183980',
    upcoming: [raEvent('2400000', 'PLUS TARD', '2027-01-10T20:00'), raEvent('2300000', 'ONDES TAKEOVER', '2026-12-05T20:00')],
    past: [raEvent('2100000', 'PLUS TÔT', '2026-09-01T20:00'), raEvent('6683745', 'HAUTE RIVE TAKEOVER', '2026-10-31T23:30')],
  },
}

const TRACKED = {
  createdAt: '2026-10-01T16:00:00.000Z',
  createdBy: 'admin@example.com',
  updatedBy: null,
  updatedAt: null,
  status: 'planned' as const,
  statusUpdatedBy: null,
  statusUpdatedAt: null,
}

function studioSet(id: string, fields: Partial<StudioSet>): StudioSet {
  return {
    id,
    performers: [],
    offsetMinutes: null,
    durationMinutes: null,
    start: null,
    end: null,
    prestations: [],
    otherPrestation: '',
    genres: [],
    soundcloudTrack: null,
    youtubeVideo: null,
    ...TRACKED,
    ...fields,
  }
}

// Saturday, November 14th, 2026, from 21:00 to 1:00 in Québec: two sets one after the other, then one that's cancelled,
// whose place isn't known, and whose performer was deleted.
const SESSION: Session = {
  id: 'session-1',
  start: '2026-11-15T02:00:00.000Z',
  end: '2026-11-15T06:00:00.000Z',
  durationMinutes: 240,
  takeover: { id: 'collective-1', name: 'Ondes' },
  name: 'ONDES TAKEOVER',
  raEvent: { id: '6683745', url: 'https://ra.co/events/6683745' },
  sets: [
    studioSet('set-1', {
      performers: [
        { id: 'artist-1', name: 'Aurore' },
        { id: 'artist-2', name: 'Brume' },
      ],
      offsetMinutes: 0,
      durationMinutes: 60,
      start: '2026-11-15T02:00:00.000Z',
      end: '2026-11-15T03:00:00.000Z',
      prestations: ['dj'],
      genres: ['techno'],
      soundcloudTrack: { id: '123', url: 'https://soundcloud.com/parkingdotradio/ondes' },
      youtubeVideo: { id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    }),
    studioSet('set-2', {
      performers: [{ id: 'artist-3', name: 'Cyan' }],
      offsetMinutes: 60,
      durationMinutes: 90,
      start: '2026-11-15T03:00:00.000Z',
      end: '2026-11-15T04:30:00.000Z',
      prestations: ['live-performance'],
      otherPrestation: 'Synthé',
      genres: ['ambient'],
      status: 'done',
    }),
    studioSet('set-3', { durationMinutes: 60, status: 'cancelled' }),
  ],
  ...TRACKED,
}
const [SET, CYAN_SET] = SESSION.sets

// A session whose date isn't known yet, with a set whose place is, after another one.
const UNDATED: Session = {
  ...SESSION,
  id: 'session-2',
  start: null,
  end: null,
  durationMinutes: 180,
  takeover: null,
  name: '',
  raEvent: null,
  sets: [
    studioSet('set-4', { performers: [{ id: 'artist-2', name: 'Brume' }], offsetMinutes: 0, durationMinutes: 60 }),
    studioSet('set-5', { performers: [{ id: 'artist-3', name: 'Cyan' }], offsetMinutes: 90, durationMinutes: 60 }),
  ],
  createdAt: '2026-10-05T16:00:00.000Z',
}

// As the server lists them: the session without a date first, then the latest first.
const SESSIONS: Session[] = [
  UNDATED,
  SESSION,
  {
    ...SESSION,
    id: 'session-3',
    start: '2026-10-03T00:00:00.000Z',
    end: '2026-10-03T01:00:00.000Z',
    durationMinutes: 60,
    takeover: null,
    name: 'SOIRÉE',
    raEvent: null,
    sets: [studioSet('set-6', {
        performers: [{ id: 'artist-2', name: 'Brume' }],
        offsetMinutes: 0,
        durationMinutes: 60,
        start: '2026-10-03T00:00:00.000Z',
        end: '2026-10-03T01:00:00.000Z',
        status: 'done',
      })],
    status: 'done',
  },
  { ...SESSION, id: 'session-4', start: '2026-09-01T00:00:00.000Z', end: '2026-09-01T01:00:00.000Z', durationMinutes: 60, takeover: null, name: '', raEvent: null, sets: [], status: 'cancelled' },
]

function CurrentPath() {
  const location = useLocation()
  return <div data-testid="path">{location.pathname + location.search}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} useTransitions={false}>
      <App />
      <CurrentPath />
    </MemoryRouter>,
  )
}

const rows = (table: HTMLElement | null = screen.queryByRole('table')) =>
  (table ? within(table).queryAllByRole('row') : [])
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
const days = () => rows().map((row) => row[0])

async function expectSearch(query: string, found: string[]) {
  const field = await screen.findByRole('searchbox', { name: 'Rechercher' })
  fireEvent.change(field, { target: { value: query } })
  await waitFor(() => expect(days()).toEqual(found))
}

describe('The list of sessions', () => {
  const LIST = { ...LOGGED_IN, '/api/admin/sessions': { ok: true, sessions: SESSIONS } }

  it('lists every session, those without a date first, then the latest first, in Québec time', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(rows()).toEqual([
      ['date à déterminer', '3 h', '', '', 'Brume · Cyan', 'planifiée'],
      ['sam. 14 nov. 2026', '21 h – 1 h', 'ONDES TAKEOVER', 'Ondes', 'Aurore, Brume · Cyan', 'planifiée'],
      ['ven. 2 oct. 2026', '20 h – 21 h', 'SOIRÉE', '', 'Brume', 'jouée'],
      ['lun. 31 août 2026', '20 h – 21 h', '', '', '', 'annulée'],
    ])
    // Done sessions are greyed out, and cancelled ones faded out in their own color.
    const sessionRows = screen.getAllByRole('row').slice(1)
    expect(sessionRows[0]).toHaveClass('admin-status-planned')
    expect(sessionRows[1]).toHaveClass('admin-status-planned')
    expect(sessionRows[2]).toHaveClass('admin-status-done')
    expect(sessionRows[3]).toHaveClass('admin-status-cancelled')
    expect(screen.getByRole('link', { name: 'sam. 14 nov. 2026' })).toHaveAttribute('href', '/admin/sessions/session-1')
    expect(screen.getByRole('link', { name: 'date à déterminer' })).toHaveAttribute('href', '/admin/sessions/session-2')
    expect(screen.getAllByRole('link', { name: 'Brume' })[0]).toHaveAttribute('href', '/admin/artistes/artist-2')
    expect(screen.getByRole('link', { name: 'Ondes' })).toHaveAttribute('href', '/admin/artistes/collectifs/collective-1')
    expect(screen.getByRole('link', { name: 'nouvelle session' })).toHaveAttribute('href', '/admin/sessions/nouvelle')
  })

  it('lists only the sessions with a status, once it is picked, counting those the search finds', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions')

    const filters = within(await screen.findByRole('group', { name: 'Statut' }))
    expect(filters.getAllByRole('button').map((button) => button.textContent)).toEqual(['toutes (4)', 'planifiées (2)', 'jouées (1)', 'annulées (1)'])
    fireEvent.click(filters.getByRole('button', { name: 'jouées (1)' }))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\?statut=done$/)
    expect(days()).toEqual(['ven. 2 oct. 2026'])

    fireEvent.click(filters.getByRole('button', { name: 'toutes (4)' }))
    await expectSearch('brume', ['date à déterminer', 'sam. 14 nov. 2026', 'ven. 2 oct. 2026'])
    expect(filters.getAllByRole('button').map((button) => button.textContent)).toEqual(['toutes (3)', 'planifiées (2)', 'jouées (1)', 'annulées (0)'])
  })

  it('searches the sessions by name, takeover, performer, and day written out', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions')

    await expectSearch('soiree', ['ven. 2 oct. 2026'])
    await expectSearch('ondes', ['sam. 14 nov. 2026'])
    await expectSearch('aurore', ['sam. 14 nov. 2026'])
    await expectSearch('samedi novembre', ['sam. 14 nov. 2026'])
    await expectSearch('determiner', ['date à déterminer'])
    await expectSearch('personne', [])
    expect(screen.getByText('Aucune session ne correspond à la recherche.')).toBeInTheDocument()
  })

  it('sorts the sessions by their columns, those without a date being the latest', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions')
    await waitFor(() => expect(rows()).toHaveLength(4))

    fireEvent.click(screen.getByRole('button', { name: 'Date' }))
    expect(days()).toEqual(['lun. 31 août 2026', 'ven. 2 oct. 2026', 'sam. 14 nov. 2026', 'date à déterminer'])
    fireEvent.click(screen.getByRole('button', { name: 'Nom' }))
    expect(rows().map((row) => row[2])).toEqual(['', '', 'ONDES TAKEOVER', 'SOIRÉE'])
    fireEvent.click(screen.getByRole('button', { name: 'Statut' }))
    expect(rows().map((row) => row[5])).toEqual(['planifiée', 'planifiée', 'jouée', 'annulée'])
    expect(screen.getByTestId('path')).toHaveTextContent('tri=statut&ordre=asc')
  })

  it('says when there are no sessions, or when they could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions': { ok: true, sessions: [] } })
    const { unmount } = renderAt('/admin/sessions')
    expect(await screen.findByText('Aucune session.')).toBeInTheDocument()
    unmount()

    mockFetch({ ...LOGGED_IN, '/api/admin/sessions': { ok: false, error: 'Boom' } })
    renderAt('/admin/sessions')
    expect(await screen.findByRole('alert')).toHaveTextContent("Les sessions n'ont pas pu être chargées : Boom")
  })
})

const PAGE = { ...LOGGED_IN, '/api/admin/sessions/session-1': { ok: true, session: SESSION } }
const setsTable = () => screen.getByRole('table', { name: 'Sets' })
const value = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement

describe("A session's page", () => {
  it('shows everything about the session and its sets', async () => {
    mockFetch({ ...PAGE, '/api/admin/sessions/session-1': { ok: true, session: { ...SESSION, updatedBy: 'other@example.com', updatedAt: '2026-10-02T16:00:00.000Z' } } })
    renderAt('/admin/sessions/session-1')

    expect(await screen.findByRole('heading', { level: 1, name: 'ONDES TAKEOVER' })).toBeInTheDocument()
    expect(screen.getByText(/^Ajoutée par admin@example.com le/)).toBeInTheDocument()
    expect(screen.getByText(/^Modifiée par other@example.com le/)).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Statut' })).getByRole('button', { name: 'planifiée' })).toHaveAttribute('aria-pressed', 'true')
    expect(value('Quand')).toHaveTextContent('samedi 14 novembre 2026, de 21 h à 1 h le lendemain')
    expect(value('Durée')).toHaveTextContent('4 h')
    expect(within(value('Takeover de')).getByRole('link', { name: 'Ondes' })).toHaveAttribute('href', '/admin/artistes/collectifs/collective-1')
    expect(value('Nom')).toHaveTextContent('ONDES TAKEOVER')
    expect(within(value('Événement RA')).getByRole('link')).toHaveAttribute('href', 'https://ra.co/events/6683745')

    expect(rows(setsTable())).toEqual([
      ['21 h – 22 h', 'Aurore, Brume', 'DJ', 'techno', 'SoundCloud · YouTube', 'planifiéjouéannulé', 'modifier ×'],
      ['22 h – 23 h 30', 'Cyan', 'Performance Live, autre : Synthé', 'ambient', '', 'planifiéjouéannulé', 'modifier ×'],
      ['horaire à déterminer (1 h)', '-', '', '-', '', 'planifiéjouéannulé', 'modifier ×'],
    ])
    const first = within(setsTable()).getAllByRole('row')[1]
    expect(within(first).getByRole('link', { name: 'Aurore' })).toHaveAttribute('href', '/admin/artistes/artist-1')
    expect(within(first).getByRole('link', { name: 'YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(within(screen.getByRole('group', { name: 'Statut : Set de Cyan, 22 h – 23 h 30' })).getByRole('button', { name: 'joué' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const setRows = within(setsTable()).getAllByRole('row').slice(1)
    expect(setRows[0]).toHaveClass('admin-status-planned')
    expect(setRows[1]).toHaveClass('admin-status-done')
    expect(setRows[2]).toHaveClass('admin-status-cancelled')
    expect(screen.getByText('La session et ses sets seront supprimés pour de bon. Leurs artistes et le collectif de son takeover restent.')).toBeInTheDocument()
  })

  it("shows a session whose date isn't known, its sets' times counted from its start", async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-2': { ok: true, session: UNDATED } })
    renderAt('/admin/sessions/session-2')

    expect(await screen.findByRole('heading', { level: 1, name: 'Session sans date' })).toBeInTheDocument()
    expect(value('Quand')).toHaveTextContent('date à déterminer')
    expect(value('Durée')).toHaveTextContent('3 h')
    expect(value('Takeover de')).toHaveTextContent('-')
    expect(value('Événement RA')).toHaveTextContent('-')
    expect(rows(setsTable()).map((row) => row[0])).toEqual(['+0 h – +1 h', '+1 h 30 – +2 h 30'])
    expect(screen.getByText('La session et ses sets seront supprimés pour de bon. Leurs artistes restent.')).toBeInTheDocument()
  })

  it('is titled by its takeover, or else its day, and says what deleting it does', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-1': { ok: true, session: { ...SESSION, name: '', sets: [] } } })
    const first = renderAt('/admin/sessions/session-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Takeover de Ondes' })).toBeInTheDocument()
    expect(screen.getByText('Aucun set.')).toBeInTheDocument()
    expect(screen.getByText('La session sera supprimée pour de bon. Le collectif de son takeover reste.')).toBeInTheDocument()
    first.unmount()

    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-1': { ok: true, session: { ...SESSION, name: '', takeover: null, sets: [] } } })
    const second = renderAt('/admin/sessions/session-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Session du samedi 14 novembre 2026' })).toBeInTheDocument()
    expect(screen.getByText('La session sera supprimée pour de bon.')).toBeInTheDocument()
    second.unmount()

    // With sets whose performers were all deleted.
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-1': { ok: true, session: { ...SESSION, sets: [SESSION.sets[2]] } } })
    renderAt('/admin/sessions/session-1')
    expect(await screen.findByText('La session et ses sets seront supprimés pour de bon. Le collectif de son takeover reste.')).toBeInTheDocument()
  })

  it('changes the status, asking first when cancelling it cancels sets', async () => {
    const cancelled = { ...SESSION, status: 'cancelled', statusUpdatedBy: 'admin@example.com', statusUpdatedAt: '2026-11-15T04:00:00.000Z' }
    cancelled.sets = SESSION.sets.map((set) => ({ ...set, status: 'cancelled' }))
    mockFetch({ ...PAGE, 'PUT /api/admin/sessions/session-1/status': { ok: true, session: cancelled } })
    renderAt('/admin/sessions/session-1')

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const statuses = within(await screen.findByRole('group', { name: 'Statut' }))
    fireEvent.click(statuses.getByRole('button', { name: 'annulée' }))
    expect(confirm).toHaveBeenLastCalledWith(
      "Annuler la session annule aussi ses 2 sets qui ne le sont pas. Ne plus l'annuler ne les rétablira pas : chaque set se rétablit à part. Annuler la session ?",
    )
    expect(requestsTo('PUT', '/api/admin/sessions/session-1/status')).toHaveLength(0)

    fireEvent.click(statuses.getByRole('button', { name: 'annulée' }))
    await waitFor(() => expect(statuses.getByRole('button', { name: 'annulée' })).toHaveAttribute('aria-pressed', 'true'))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sessions/session-1/status')[0])).toEqual({ status: 'cancelled' })
    expect(screen.getByText(/^Changé par admin@example.com le/)).toBeInTheDocument()

    // Its sets can't be added to, or un-cancelled.
    expect(screen.getByText("La session est annulée : on ne peut pas lui ajouter de set, ni rétablir les siens.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ajouter un set' })).not.toBeInTheDocument()
    const setStatuses = within(screen.getByRole('group', { name: 'Statut : Set de Cyan, 22 h – 23 h 30' }))
    expect(setStatuses.getByRole('button', { name: 'joué' })).toBeDisabled()
    expect(setStatuses.getByRole('button', { name: 'annulé' })).toBeEnabled()
  })

  it("says why the status couldn't be changed, linking to the session it would overlap", async () => {
    const other = SESSIONS[2]
    mockFetch({ ...PAGE, 'PUT /api/admin/sessions/session-1/status': { ok: false, error: 'Another session overlaps this one', session: other, set: null } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(within(await screen.findByRole('group', { name: 'Statut' })).getByRole('button', { name: 'jouée' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Le statut n'a pas pu être changé : Another session overlaps this one (SOIRÉE, ven. 2 oct. 2026)")
    expect(within(alert).getByRole('link')).toHaveAttribute('href', '/admin/sessions/session-3')
  })

  it("changes a set's status, saying above the sets why it couldn't, naming a set of the session without a link", async () => {
    const done = { ...SESSION, sets: [{ ...SET, status: 'done' as const }, CYAN_SET, SESSION.sets[2]] }
    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-1/status': { ok: true, session: done } })
    renderAt('/admin/sessions/session-1')

    const statuses = within(await screen.findByRole('group', { name: 'Statut : Set de Aurore et Brume, 21 h – 22 h' }))
    fireEvent.click(statuses.getByRole('button', { name: 'joué' }))
    await waitFor(() => expect(statuses.getByRole('button', { name: 'joué' })).toHaveAttribute('aria-pressed', 'true'))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sets/set-1/status')[0])).toEqual({ status: 'done' })

    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-3/status': { ok: false, error: 'Another set overlaps this one', session: SESSION, set: CYAN_SET } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Statut : Set, horaire à déterminer (1 h)' })).getByRole('button', { name: 'planifié' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      "Le statut de « Set, horaire à déterminer (1 h) » n'a pas pu être changé : Another set overlaps this one (Set de Cyan, 22 h – 23 h 30)",
    )
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument()
    expect(alert.compareDocumentPosition(setsTable()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("shows only the server's message when it names nothing in the way", async () => {
    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-1/status': { ok: false, error: 'Another set overlaps this one', session: null, set: null } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(within(await screen.findByRole('group', { name: 'Statut : Set de Aurore et Brume, 21 h – 22 h' })).getByRole('button', { name: 'annulé' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Le statut de « Set de Aurore et Brume, 21 h – 22 h » n'a pas pu être changé : Another set overlaps this one$/)
  })

  it('changes the session in a form in its place, sending its start back as it was', async () => {
    const changed = { ...SESSION, name: 'AUTRE', updatedBy: 'admin@example.com', updatedAt: '2026-10-02T16:00:00.000Z' }
    mockFetch({ ...PAGE, ...COLLECTIVES, ...EVENTS, 'PUT /api/admin/sessions/session-1': { ok: true, session: changed } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(await screen.findByLabelText('Date')).toHaveValue('2026-11-14')
    expect(screen.getByLabelText('Début')).toHaveValue('21:00')
    expect(screen.getByLabelText('Fin')).toHaveValue('01:00')
    expect(screen.getByRole('status')).toHaveTextContent('Dure 4 h, finit le lendemain, dimanche 15 novembre 2026.')
    expect(screen.getByText('Ses sets se déplacent avec elle.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Takeover de' })).toHaveValue('Ondes')
    // Once RA's events are read, the session's is picked.
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Parmi les événements de RA' })).toHaveValue('HAUTE RIVE TAKEOVER'))

    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'AUTRE' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'AUTRE' })).toBeInTheDocument()
    expect(jsonBody(requestsTo('PUT', '/api/admin/sessions/session-1')[0])).toEqual({
      start: '2026-11-14T21:00-05:00',
      durationMinutes: 240,
      takeover: 'collective-1',
      name: 'AUTRE',
      raEvent: 'https://ra.co/events/6683745',
    })
  })

  it('keeps a session that starts at the second 1:30 of the night clocks fall back where it is when its name changes', async () => {
    // 1:30 in winter time, an hour after the first 1:30, for 2 hours.
    const second = { ...SESSION, start: '2026-11-01T06:30:00.000Z', end: '2026-11-01T08:30:00.000Z', durationMinutes: 120, sets: [] }
    mockFetch({ ...LOGGED_IN, ...COLLECTIVES, ...EVENTS, '/api/admin/sessions/session-1': { ok: true, session: second }, 'PUT /api/admin/sessions/session-1': { ok: true, session: second } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(await screen.findByLabelText('Début')).toHaveValue('01:30')
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'AUTRE' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sessions/session-1')[0])).toMatchObject({ start: '2026-11-01T01:30-05:00', durationMinutes: 120 })
  })

  it("names the set that wouldn't fit in the session once it's shorter, without a link", async () => {
    mockFetch({
      ...PAGE,
      ...COLLECTIVES,
      ...EVENTS,
      'PUT /api/admin/sessions/session-1': { ok: false, error: 'A set of the session would not fit in it', session: SESSION, set: CYAN_SET },
    })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.change(await screen.findByLabelText('Fin'), { target: { value: '22:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("La session n'a pas pu être enregistrée : A set of the session would not fit in it (Set de Cyan, 22 h – 23 h 30)")
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument()
    expect(jsonBody(requestsTo('PUT', '/api/admin/sessions/session-1')[0])).toMatchObject({ start: '2026-11-14T21:00-05:00', durationMinutes: 60 })
  })

  it("has one form open at a time, the session's or a set's", async () => {
    mockFetch({ ...PAGE, ...COLLECTIVES, ...EVENTS, ...ARTISTS })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(await screen.findByLabelText('Nom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ajouter un set' }))
    expect(await screen.findByRole('heading', { name: 'Nouveau set' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Nom')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'modifier : Set de Cyan, 22 h – 23 h 30' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Set de Cyan' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Nouveau set' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'annuler' }))
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
  })

  it("closes a new set's form once the session is cancelled, since it can't be added to anymore", async () => {
    const cancelled = { ...SESSION, status: 'cancelled' as const, sets: SESSION.sets.map((set) => ({ ...set, status: 'cancelled' as const })) }
    mockFetch({ ...PAGE, ...ARTISTS, 'PUT /api/admin/sessions/session-1/status': { ok: true, session: cancelled } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'ajouter un set' }))
    expect(await screen.findByRole('heading', { name: 'Nouveau set' })).toBeInTheDocument()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    fireEvent.click(within(screen.getByRole('group', { name: 'Statut' })).getByRole('button', { name: 'annulée' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Nouveau set' })).not.toBeInTheDocument())
  })

  it("gives a session without a date a day and a start, its end filled in from its duration", async () => {
    const dated = { ...UNDATED, start: '2026-11-15T02:00:00.000Z', end: '2026-11-15T05:00:00.000Z' }
    mockFetch({ ...LOGGED_IN, ...COLLECTIVES, ...EVENTS, '/api/admin/sessions/session-2': { ok: true, session: UNDATED }, 'PUT /api/admin/sessions/session-2': { ok: true, session: dated } })
    renderAt('/admin/sessions/session-2')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(await screen.findByLabelText('date à déterminer')).toBeChecked()
    expect(within(screen.getByRole('group', { name: 'Durée' })).getByLabelText('heures')).toHaveValue(3)
    fireEvent.click(screen.getByLabelText('date à déterminer'))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-14' } })
    fireEvent.change(screen.getByLabelText('Début'), { target: { value: '21:00' } })
    expect(screen.getByLabelText('Fin')).toHaveValue('00:00')
    expect(screen.getByRole('status')).toHaveTextContent('Dure 3 h, finit le lendemain, dimanche 15 novembre 2026.')
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-2')).toHaveLength(1))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sessions/session-2')[0])).toEqual({
      start: '2026-11-14T21:00-05:00',
      durationMinutes: 180,
      takeover: null,
      name: '',
      raEvent: null,
    })
    expect(await screen.findByText('samedi 14 novembre 2026, de 21 h à 0 h le lendemain')).toBeInTheDocument()
  })

  it('deletes the session once confirmed, and goes back to the list', async () => {
    mockFetch({ ...PAGE, 'DELETE /api/admin/sessions/session-1': { ok: true }, '/api/admin/sessions': { ok: true, sessions: [] } })
    renderAt('/admin/sessions/session-1')

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(await screen.findByRole('button', { name: 'supprimer la session' }))
    expect(requestsTo('DELETE', '/api/admin/sessions/session-1')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'supprimer la session' }))
    expect(confirm).toHaveBeenLastCalledWith('Supprimer définitivement cette session et ses 3 sets ?')
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions$/))
  })

  it('says when the session could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-1': { ok: false, error: 'No such session' } })
    renderAt('/admin/sessions/session-1')
    expect(await screen.findByRole('alert')).toHaveTextContent("La session n'a pas pu être chargée : No such session")
  })
})

describe("A set's form", () => {
  const SET_PAGE = { ...PAGE, ...ARTISTS }

  async function openNew() {
    fireEvent.click(await screen.findByRole('button', { name: 'ajouter un set' }))
    await screen.findByRole('heading', { name: 'Nouveau set' })
  }

  function pick(name: string) {
    fireEvent.click(screen.getByRole('combobox', { name: 'Ajouter un artiste' }))
    fireEvent.mouseDown(screen.getByRole('option', { name: new RegExp(`^${name}`) }))
  }

  it('adds a set when the last one ends, for an hour, with its prestations and its artists’ genres, and closes', async () => {
    const added = { ...SESSION, sets: [...SESSION.sets, studioSet('set-9', { performers: [{ id: 'artist-3', name: 'Cyan' }], offsetMinutes: 150, durationMinutes: 60 })] }
    mockFetch({ ...SET_PAGE, 'POST /api/admin/sessions/session-1/sets': { ok: true, session: added } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    // After Cyan's set, which ends at 23:30: the cancelled one, whose place isn't known, doesn't count.
    expect(screen.getByLabelText('Début')).toHaveValue('23:30')
    expect(screen.getByLabelText('Fin')).toHaveValue('00:30')
    expect(screen.getByRole('status')).toHaveTextContent('Dure 1 h.')
    expect(screen.getByText('La session a lieu de 21 h à 1 h le lendemain. Heure du Québec.')).toBeInTheDocument()

    pick('Cyan')
    pick('Aurore')
    // Already in the set, so it can't be picked again.
    fireEvent.click(screen.getByRole('combobox', { name: 'Ajouter un artiste' }))
    expect(screen.getByRole('option', { name: /^Cyan/ })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: /^Cyan/ })).toHaveTextContent('déjà dans le set')
    fireEvent.click(screen.getByLabelText('DJ'))

    // Their first genres, in the order of a collective's genres, up to 3.
    expect(screen.getByText(/^Genres de ses artistes : house, techno, acid\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'reprendre les genres des artistes' }))
    expect(screen.getByRole('button', { name: 'retirer house' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'reprendre les genres des artistes' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Nouveau set' })).not.toBeInTheDocument())
    expect(rows(setsTable())).toHaveLength(4)
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions/session-1/sets')[0])).toEqual({
      performers: [{ id: 'artist-3' }, { id: 'artist-1' }],
      offsetMinutes: 150,
      durationMinutes: 60,
      prestations: ['dj'],
      otherPrestation: '',
      genres: ['house', 'techno', 'acid'],
      soundcloudTrack: null,
      youtubeVideo: null,
    })
  })

  it('changes a set, from times that are the next day, and checks that it takes place within the session', async () => {
    mockFetch({ ...SET_PAGE, 'PUT /api/admin/sets/set-2': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Cyan, 22 h – 23 h 30' }))
    expect(await screen.findByLabelText('Début')).toHaveValue('22:00')
    expect(screen.getByLabelText('Fin')).toHaveValue('23:30')
    expect(screen.getByLabelText('Performance Live')).toBeChecked()
    expect(screen.getByLabelText('Autre')).toHaveValue('Synthé')
    expect(screen.getByRole('button', { name: 'retirer ambient' })).toBeInTheDocument()
    expect(screen.getByText(/^Ajouté par admin@example.com le/)).toBeInTheDocument()

    // Before the session's start time, so the next day, after it ends.
    fireEvent.change(screen.getByLabelText('Début'), { target: { value: '20:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(await screen.findByText('Le set doit avoir lieu pendant la session, de 21 h à 1 h le lendemain.')).toBeInTheDocument()
    expect(screen.getByLabelText('Début')).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(screen.getByLabelText('Début'), { target: { value: '00:30' } })
    fireEvent.change(screen.getByLabelText('Fin'), { target: { value: '01:30' } })
    expect(await screen.findByText('Le set doit avoir lieu pendant la session, de 21 h à 1 h le lendemain.')).toBeInTheDocument()
    expect(requestsTo('PUT', '/api/admin/sets/set-2')).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('Fin'), { target: { value: '01:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sets/set-2')).toHaveLength(1))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sets/set-2')[0])).toMatchObject({
      performers: [{ id: 'artist-3' }],
      offsetMinutes: 210,
      durationMinutes: 30,
      prestations: ['live-performance'],
      otherPrestation: 'Synthé',
      genres: ['ambient'],
    })
  })

  it("places a set in a session without a date by its start after the session's and its duration, which it needs", async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/sessions/session-2': { ok: true, session: UNDATED }, 'POST /api/admin/sessions/session-2/sets': { ok: true, session: UNDATED } })
    renderAt('/admin/sessions/session-2')

    await openNew()
    // After Cyan's set, which ends 2 h 30 after the start, until the session ends, half an hour later.
    const start = within(screen.getByRole('group', { name: 'Début, après celui de la session' }))
    const duration = within(screen.getByRole('group', { name: 'Durée' }))
    expect(start.getByLabelText('heures')).toHaveValue(2)
    expect(start.getByLabelText('minutes')).toHaveValue(30)
    expect(duration.getByLabelText('heures')).toHaveValue(0)
    expect(duration.getByLabelText('minutes')).toHaveValue(30)
    expect(screen.getByText('La session dure 3 h.')).toBeInTheDocument()
    pick('Brume')

    fireEvent.change(duration.getByLabelText('minutes'), { target: { value: '' } })
    fireEvent.change(duration.getByLabelText('heures'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    expect(await screen.findByText('Indiquez la durée du set.')).toBeInTheDocument()
    fireEvent.change(duration.getByLabelText('heures'), { target: { value: '1' } })
    expect(await screen.findByText('Le set doit avoir lieu pendant la session, qui dure 3 h.')).toBeInTheDocument()

    fireEvent.change(start.getByLabelText('heures'), { target: { value: '1' } })
    fireEvent.change(start.getByLabelText('minutes'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions/session-2/sets')).toHaveLength(1))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions/session-2/sets')[0])).toMatchObject({ offsetMinutes: 60, durationMinutes: 60 })
  })

  it('adds a set whose place is not known, with or without a duration, no longer than the session', async () => {
    mockFetch({ ...SET_PAGE, 'POST /api/admin/sessions/session-1/sets': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    pick('Brume')
    fireEvent.click(screen.getByLabelText('horaire à déterminer'))
    const duration = within(screen.getByRole('group', { name: 'Durée' }))
    // As long as the times said.
    expect(duration.getByLabelText('heures')).toHaveValue(1)
    fireEvent.change(duration.getByLabelText('heures'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    expect(await screen.findByText('Le set ne peut pas durer plus longtemps que la session, de 21 h à 1 h le lendemain.')).toBeInTheDocument()

    fireEvent.change(duration.getByLabelText('heures'), { target: { value: '' } })
    fireEvent.change(duration.getByLabelText('minutes'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions/session-1/sets')).toHaveLength(1))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions/session-1/sets')[0])).toMatchObject({ offsetMinutes: null, durationMinutes: null })
  })

  it('keeps how long a set lasts when its place is no longer known', async () => {
    mockFetch({ ...SET_PAGE, 'PUT /api/admin/sets/set-2': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Cyan, 22 h – 23 h 30' }))
    fireEvent.click(await screen.findByLabelText('horaire à déterminer'))
    const duration = within(screen.getByRole('group', { name: 'Durée' }))
    expect(duration.getByLabelText('heures')).toHaveValue(1)
    expect(duration.getByLabelText('minutes')).toHaveValue(30)
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sets/set-2')).toHaveLength(1))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sets/set-2')[0])).toMatchObject({ offsetMinutes: null, durationMinutes: 90 })
  })

  it("starts without times when the session's sets fill it", async () => {
    const full = { ...SESSION, sets: [{ ...SET, durationMinutes: 240, end: SESSION.end }] }
    mockFetch({ ...SET_PAGE, '/api/admin/sessions/session-1': { ok: true, session: full } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    expect(screen.getByLabelText('Début')).toHaveValue('')
    expect(screen.getByLabelText('Fin')).toHaveValue('')
    expect(screen.getByLabelText('horaire à déterminer')).not.toBeChecked()
  })

  it('sends a new set that starts at the second 1:00 of the night clocks fall back as it was proposed', async () => {
    // From 23:00 in summer time to 2:00 in winter time, 4 hours later, where the first set ends at the second 1:00.
    const night: Session = {
      ...SESSION,
      start: '2026-11-01T03:00:00.000Z',
      end: '2026-11-01T07:00:00.000Z',
      sets: [{ ...SET, offsetMinutes: 0, durationMinutes: 180, start: '2026-11-01T03:00:00.000Z', end: '2026-11-01T06:00:00.000Z' }],
    }
    mockFetch({ ...SET_PAGE, '/api/admin/sessions/session-1': { ok: true, session: night }, 'POST /api/admin/sessions/session-1/sets': { ok: true, session: night } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    expect(screen.getByLabelText('Début')).toHaveValue('01:00')
    expect(screen.getByLabelText('Fin')).toHaveValue('02:00')
    pick('Brume')
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions/session-1/sets')).toHaveLength(1))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions/session-1/sets')[0])).toMatchObject({ offsetMinutes: 180, durationMinutes: 60 })
  })

  it("refuses a start that clocks skip as they spring forward, in a session that starts before they do", async () => {
    // From 23:00 in winter time, on the night of March 7th, 2026, for 4 hours.
    const night: Session = { ...SESSION, start: '2026-03-08T04:00:00.000Z', end: '2026-03-08T08:00:00.000Z', sets: [] }
    mockFetch({ ...SET_PAGE, '/api/admin/sessions/session-1': { ok: true, session: night }, 'POST /api/admin/sessions/session-1/sets': { ok: true, session: night } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    pick('Brume')
    fireEvent.change(screen.getByLabelText('Début'), { target: { value: '02:30' } })
    fireEvent.change(screen.getByLabelText('Fin'), { target: { value: '03:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    expect(await screen.findByText("Cette heure n'existe pas cette nuit-là, au passage à l'heure d'été.")).toBeInTheDocument()

    // 3:00 in summer time is 3 hours after 23:00 in winter time.
    fireEvent.change(screen.getByLabelText('Début'), { target: { value: '03:00' } })
    fireEvent.change(screen.getByLabelText('Fin'), { target: { value: '04:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions/session-1/sets')).toHaveLength(1))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions/session-1/sets')[0])).toMatchObject({ offsetMinutes: 180, durationMinutes: 60 })
  })

  it("shows the server's error, linking to another session's set it names, but not to the session it's on", async () => {
    mockFetch({ ...SET_PAGE, 'POST /api/admin/sessions/session-1/sets': { ok: false, error: "This YouTube video is another set's", session: SESSIONS[2], set: SESSIONS[2].sets[0] } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    pick('Brume')
    fireEvent.change(screen.getByLabelText('YouTube'), { target: { value: 'dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    let alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Le set n'a pas pu être ajouté : This YouTube video is another set's (Set de Brume, SOIRÉE, ven. 2 oct. 2026, 20 h – 21 h)")
    expect(within(alert).getByRole('link')).toHaveAttribute('href', '/admin/sessions/session-3')

    // A set that doesn't fit has its own session in the way.
    mockFetch({ ...SET_PAGE, 'POST /api/admin/sessions/session-1/sets': { ok: false, error: 'The set does not fit in its session', session: SESSION, set: null } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^Le set n'a pas pu être ajouté : The set does not fit in its session$/))
    alert = screen.getByRole('alert')
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument()
  })

  it('says what is wrong with the links once they are left', async () => {
    mockFetch(SET_PAGE)
    renderAt('/admin/sessions/session-1')

    await openNew()
    const soundcloud = screen.getByLabelText('SoundCloud')
    fireEvent.change(soundcloud, { target: { value: 'https://on.soundcloud.com/AbCdE' } })
    fireEvent.blur(soundcloud)
    expect(await screen.findByText(/^Le lien SoundCloud doit mener à la piste/)).toBeInTheDocument()
  })

  it('takes a performer again to change a set whose performers were all deleted', async () => {
    mockFetch(SET_PAGE)
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set, horaire à déterminer (1 h)' }))
    expect(await screen.findByLabelText('horaire à déterminer')).toBeChecked()
    expect(within(screen.getByRole('group', { name: 'Durée' })).getByLabelText('heures')).toHaveValue(1)
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(await screen.findByText('Choisissez au moins un artiste.')).toBeInTheDocument()
    expect(requestsTo('PUT', '/api/admin/sets/set-3')).toHaveLength(0)
  })

  it("deletes a set with the × of its row once confirmed, closing its form if it's open, or says why it couldn't", async () => {
    mockFetch({ ...SET_PAGE, 'DELETE /api/admin/sets/set-2': { ok: true } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Cyan, 22 h – 23 h 30' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Set de Cyan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /supprimer le set/ })).not.toBeInTheDocument()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'supprimer : Set de Cyan, 22 h – 23 h 30' }))
    expect(confirm).toHaveBeenLastCalledWith('Supprimer définitivement ce set (Set de Cyan, 22 h – 23 h 30) ? Ses artistes restent.')
    expect(requestsTo('DELETE', '/api/admin/sets/set-2')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'supprimer : Set de Cyan, 22 h – 23 h 30' }))
    // The focus goes to the next set's ×, in the commit that removes the row. It's read in the waitFor that sees the row
    // gone, which runs right after React's DOM changes and layout effects but before its passive effects, since waiting
    // for the focus would also pass if it only moved later, leaving it on the page in between.
    let focused: Element | null = null
    await waitFor(() => {
      expect(rows(setsTable())).toHaveLength(2)
      focused = document.activeElement
    })
    expect(focused).toBe(screen.getByRole('button', { name: 'supprimer : Set, horaire à déterminer (1 h)' }))
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()

    mockFetch({ ...SET_PAGE, 'DELETE /api/admin/sets/set-3': { ok: false, error: 'Boom' } })
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'supprimer : Set, horaire à déterminer (1 h)' }))
    expect(window.confirm).toHaveBeenLastCalledWith('Supprimer définitivement ce set (Set, horaire à déterminer (1 h)) ?')
    expect(await screen.findByRole('alert')).toHaveTextContent("Le set « Set, horaire à déterminer (1 h) » n'a pas pu être supprimé : Boom")
    expect(rows(setsTable())).toHaveLength(2)
  })

  it("moves the focus to the previous set's × once the last one is deleted, or to the heading once there are none", async () => {
    const two = { ...SESSION, sets: [SET, CYAN_SET] }
    mockFetch({ ...SET_PAGE, '/api/admin/sessions/session-1': { ok: true, session: two }, 'DELETE /api/admin/sets/set-2': { ok: true }, 'DELETE /api/admin/sets/set-1': { ok: true } })
    renderAt('/admin/sessions/session-1')

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(await screen.findByRole('button', { name: 'supprimer : Set de Cyan, 22 h – 23 h 30' }))
    // Read as soon as the set is gone, as in the test above.
    let focused: Element | null = null
    await waitFor(() => {
      expect(rows(setsTable())).toHaveLength(1)
      focused = document.activeElement
    })
    expect(focused).toBe(screen.getByRole('button', { name: 'supprimer : Set de Aurore et Brume, 21 h – 22 h' }))
    fireEvent.click(screen.getByRole('button', { name: 'supprimer : Set de Aurore et Brume, 21 h – 22 h' }))
    await waitFor(() => {
      expect(screen.getByText('Aucun set.')).toBeInTheDocument()
      focused = document.activeElement
    })
    expect(focused).toBe(screen.getByRole('heading', { level: 2, name: 'Sets' }))
  })

  it("closes the form of a set opened while it's being deleted, rather than showing a new set's", async () => {
    mockFetch({ ...SET_PAGE, 'DELETE /api/admin/sets/set-2': { ok: true } })
    renderAt('/admin/sessions/session-1')

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(await screen.findByRole('button', { name: 'supprimer : Set de Cyan, 22 h – 23 h 30' }))
    fireEvent.click(screen.getByRole('button', { name: 'modifier : Set de Cyan, 22 h – 23 h 30' }))
    await waitFor(() => expect(rows(setsTable())).toHaveLength(2))
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
  })

  it('says when the artists could not be loaded', async () => {
    mockFetch({ ...PAGE, '/api/admin/artists': { ok: false, error: 'Boom' } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom")
    expect(screen.getByRole('combobox', { name: 'Ajouter un artiste' })).toBeDisabled()
  })
})

describe('Adding a session', () => {
  const NEW = { ...LOGGED_IN, ...COLLECTIVES, ...EVENTS }

  async function fillIn({ day = '2026-11-14', start = '21:00', end = '01:00' } = {}) {
    fireEvent.change(await screen.findByLabelText('Date'), { target: { value: day } })
    fireEvent.change(screen.getByLabelText('Début'), { target: { value: start } })
    fireEvent.change(screen.getByLabelText('Fin'), { target: { value: end } })
  }

  it('adds a session, ending the next day when the end time is not after the start time, and goes to its page', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')

    await fillIn()
    expect(screen.getByRole('status')).toHaveTextContent('Dure 4 h, finit le lendemain, dimanche 15 novembre 2026.')
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: '  HAUTE   RIVE ' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\/session-1$/))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions')[0])).toEqual({
      start: '2026-11-14T21:00-05:00',
      durationMinutes: 240,
      takeover: null,
      name: 'HAUTE RIVE',
      raEvent: null,
    })
  })

  it("adds a session whose date isn't known, keeping how long its times said it lasts", async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: UNDATED } })
    renderAt('/admin/sessions/nouvelle')

    await fillIn({ start: '20:00', end: '23:30' })
    fireEvent.click(screen.getByLabelText('date à déterminer'))
    const duration = within(screen.getByRole('group', { name: 'Durée' }))
    expect(duration.getByLabelText('heures')).toHaveValue(3)
    expect(duration.getByLabelText('minutes')).toHaveValue(30)
    expect(screen.queryByLabelText('Date')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))

    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ start: null, durationMinutes: 210 })
  })

  it('needs the duration of a session without a date, of at most 24 hours', async () => {
    mockFetch(NEW)
    renderAt('/admin/sessions/nouvelle')

    fireEvent.click(await screen.findByLabelText('date à déterminer'))
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    expect(await screen.findByText('Indiquez la durée de la session.')).toBeInTheDocument()
    fireEvent.change(within(screen.getByRole('group', { name: 'Durée' })).getByLabelText('heures'), { target: { value: '25' } })
    expect(await screen.findByText('Une session dure au plus 24 heures.')).toBeInTheDocument()
    expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(0)
  })

  it("refuses a start that doesn't happen that day, and a session longer than 24 hours across a change of the clocks", async () => {
    mockFetch(NEW)
    renderAt('/admin/sessions/nouvelle')

    await fillIn({ day: '2026-03-08', start: '02:30', end: '04:00' })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    expect(await screen.findByText("Cette heure n'existe pas cette nuit-là, au passage à l'heure d'été.")).toBeInTheDocument()
    expect(screen.getByLabelText('Début')).toHaveAttribute('aria-invalid', 'true')

    await fillIn({ day: '2026-10-31', start: '21:00', end: '21:00' })
    expect(await screen.findByText('Une session dure au plus 24 heures.')).toBeInTheDocument()
    expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(0)
  })

  it('picks the event on RA among those read from RA, the upcoming ones first, by their day as RA gives it, or takes a pasted link', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')
    await fillIn()

    const picker = screen.getByRole('combobox', { name: 'Parmi les événements de RA' })
    await waitFor(() => expect(picker).not.toHaveAttribute('placeholder', 'chargement des événements…'))
    fireEvent.click(picker)
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Aucun événement RA',
      'ONDES TAKEOVER5 déc. 2026',
      'PLUS TARD10 janv. 2027',
      'HAUTE RIVE TAKEOVER31 oct. 2026',
      'PLUS TÔT1 sept. 2026',
    ])
    fireEvent.mouseDown(screen.getByRole('option', { name: /^ONDES TAKEOVER/ }))
    const link = screen.getByLabelText("Lien de l'événement")
    expect(link).toHaveValue('https://ra.co/events/2300000')

    // An older one, pasted, which isn't among those of the list.
    fireEvent.change(link, { target: { value: 'https://ra.co/events/1000000' } })
    expect(picker).toHaveValue('')
    // One of the list, pasted, which picks it.
    fireEvent.change(link, { target: { value: 'https://ra.co/events/6683745?ref=x' } })
    expect(picker).toHaveValue('HAUTE RIVE TAKEOVER')

    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ raEvent: 'https://ra.co/events/6683745?ref=x' })
  })

  it("doesn't wait for RA, and says when its events could not be read", async () => {
    mockFetch({ ...NEW, '/api/events': { ok: false, error: 'The events cannot be read from RA.' } })
    renderAt('/admin/sessions/nouvelle')

    expect(await screen.findByText("Les événements n'ont pas pu être lus sur RA : The events cannot be read from RA. Collez le lien de l'événement.")).toBeInTheDocument()
    expect(screen.getByLabelText("Lien de l'événement")).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('starts as the takeover of the collective of the link that leads to it, sent by its id, unless it is unknown', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    const first = renderAt('/admin/sessions/nouvelle?takeover=collective-1')
    expect(await screen.findByRole('combobox', { name: 'Takeover de' })).toHaveValue('Ondes')
    await fillIn()
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ takeover: 'collective-1' })
    first.unmount()

    renderAt('/admin/sessions/nouvelle?takeover=unknown')
    expect(await screen.findByRole('combobox', { name: 'Takeover de' })).toHaveValue('Aucun takeover')
  })

  it("shows the server's error, linking to the session it would overlap", async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: false, error: 'Another session overlaps this one', session: SESSION, set: null } })
    renderAt('/admin/sessions/nouvelle')

    await fillIn()
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("La session n'a pas pu être ajoutée : Another session overlaps this one (ONDES TAKEOVER, sam. 14 nov. 2026)")
    expect(within(alert).getByRole('link')).toHaveAttribute('href', '/admin/sessions/session-1')
  })

  it('says when the collectives could not be loaded', async () => {
    mockFetch({ ...NEW, '/api/admin/collectives': { ok: false, error: 'Boom' } })
    renderAt('/admin/sessions/nouvelle')

    expect(await screen.findByRole('alert')).toHaveTextContent("Les collectifs n'ont pas pu être chargés : Boom")
    expect(screen.getByRole('combobox', { name: 'Takeover de' })).toBeDisabled()
  })
})
