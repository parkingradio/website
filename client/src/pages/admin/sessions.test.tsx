import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import App from '../../app'
import type { Artist } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import type { Session, StudioSet } from '../../session-fields'
import { CONFIG, jsonBody, mockFetch, requestsTo, visibleText } from '../../test-utils'

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

// Every one of Parking Radio's events, from the year 2000 on.
const EVENTS_URL = '/api/events?from=2000-01-01T00%3A00-05%3A00'

// RA's events, as the server orders them: the upcoming ones the soonest first, and the past ones the most recent first.
// The past ones' numbers are close to each other, as Parking Radio's often are.
const EVENTS = {
  [EVENTS_URL]: {
    ok: true,
    promoterUrl: 'https://ra.co/promoters/183980',
    upcoming: [raEvent('2300000', 'ONDES TAKEOVER', '2026-12-05T20:00:00-05:00'), raEvent('2400000', 'PLUS TARD', '2027-01-10T20:00:00-05:00')],
    // 23:30 on October 31 in Québec is already November 1 in UTC.
    past: [raEvent('6683745', 'HAUTE RIVE TAKEOVER', '2026-10-31T23:30:00-04:00'), raEvent('6683748', 'PLUS TÔT', '2026-09-01T20:00:00-04:00')],
  },
}

// What each option the open combobox shows says, e.g. an event's title and day, then its number.
const options = () => screen.queryAllByRole('option').map((option) => option.textContent)

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
    fitsInSession: true,
    overlappingSets: [],
    performanceTypes: [],
    otherPerformanceType: '',
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
  type: 'takeover',
  takeover: { id: 'collective-1', name: 'Ondes' },
  name: '',
  title: 'ONDES TAKEOVER',
  raEvent: { id: '6683745', url: 'https://ra.co/events/6683745' },
  description: '',
  effectiveDescription: 'LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC',
  hasFlyer: false,
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
      performanceTypes: ['dj'],
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
      performanceTypes: ['live-performance'],
      otherPerformanceType: 'Synthé',
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
  type: 'guest-mixes',
  takeover: null,
  name: '',
  title: 'GUEST MIXES',
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
    type: 'other',
    takeover: null,
    name: 'SOIRÉE',
    title: 'SOIRÉE',
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
  { ...SESSION, id: 'session-4', start: '2026-09-01T00:00:00.000Z', end: '2026-09-01T01:00:00.000Z', durationMinutes: 60, type: 'live-performance', takeover: null, name: '', title: 'LIVE PERFORMANCE', raEvent: null, sets: [], status: 'cancelled' },
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
    .map((row) => within(row).getAllByRole('cell').map(visibleText))
const days = () => rows().map((row) => row[0])

async function expectSearch(query: string, found: string[]) {
  const field = await screen.findByRole('searchbox', { name: 'Rechercher' })
  fireEvent.change(field, { target: { value: query } })
  await waitFor(() => expect(days()).toEqual(found))
}

// What was sent as the session's fields in a request to save one, as JSON in the "session" part.
function sentSession(request: RequestInit) {
  return JSON.parse((request.body as FormData).get('session') as string)
}

describe('The list of sessions', () => {
  const LIST = { ...LOGGED_IN, '/api/admin/sessions': { ok: true, sessions: SESSIONS } }

  it('lists every session, those without a date first, then the latest first, in Québec time', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions?status=all')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(rows()).toEqual([
      ['date à déterminer', '3 h', 'GUEST MIXES', 'Guest mixes', 'Brume · Cyan', 'planifiée'],
      ['sam. 14 nov. 2026', '21 h – 1 h', 'ONDES TAKEOVER', 'Takeover', 'Aurore, Brume · Cyan', 'planifiée'],
      ['ven. 2 oct. 2026', '20 h – 21 h', 'SOIRÉE', 'Autre', 'Brume', 'jouée'],
      ['lun. 31 août 2026', '20 h – 21 h', 'LIVE PERFORMANCE', 'Live performance', '', 'annulée'],
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
    expect(screen.getByRole('link', { name: 'Takeover' })).toHaveAttribute('href', '/admin/artistes/collectifs/collective-1')
    expect(screen.getByRole('link', { name: 'nouvelle session' })).toHaveAttribute('href', '/admin/sessions/nouvelle')
  })

  it('lists only the sessions with a status, once it is picked, counting those the search finds', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions?status=all')

    const filters = within(await screen.findByRole('group', { name: 'Statut' }))
    expect(filters.getAllByRole('button').map((button) => button.textContent)).toEqual(['toutes (4)', 'planifiées (2)', 'jouées (1)', 'annulées (1)'])
    fireEvent.click(filters.getByRole('button', { name: 'jouées (1)' }))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\?status=done$/)
    expect(days()).toEqual(['ven. 2 oct. 2026'])

    fireEvent.click(filters.getByRole('button', { name: 'toutes (4)' }))
    await expectSearch('brume', ['date à déterminer', 'sam. 14 nov. 2026', 'ven. 2 oct. 2026'])
    expect(filters.getAllByRole('button').map((button) => button.textContent)).toEqual(['toutes (3)', 'planifiées (2)', 'jouées (1)', 'annulées (0)'])
  })

  it('searches the sessions by title, type, takeover, performer, and day, written out or as the list shows it', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions?status=all')

    await expectSearch('soiree', ['ven. 2 oct. 2026'])
    await expectSearch('guest mixes', ['date à déterminer'])
    await expectSearch('autre', ['ven. 2 oct. 2026'])
    await expectSearch('ondes', ['sam. 14 nov. 2026'])
    await expectSearch('aurore', ['sam. 14 nov. 2026'])
    await expectSearch('samedi novembre', ['sam. 14 nov. 2026'])
    await expectSearch('14 nov', ['sam. 14 nov. 2026'])
    await expectSearch('nov 14', ['sam. 14 nov. 2026'])
    await expectSearch('31 août 2026', ['lun. 31 août 2026'])
    // What the list shows can be typed back.
    await expectSearch('sam 14', ['sam. 14 nov. 2026'])
    await expectSearch('ven. 2 oct.', ['ven. 2 oct. 2026'])
    // Not by "2" in "2026".
    await expectSearch('2 nov', [])
    await expectSearch('determiner', ['date à déterminer'])
    await expectSearch('personne', [])
    expect(screen.getByText('Aucune session ne correspond à la recherche.')).toBeInTheDocument()
  })

  it('sorts the sessions by their columns, those without a date being the latest', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions?status=all')
    await waitFor(() => expect(rows()).toHaveLength(4))

    fireEvent.click(screen.getByRole('button', { name: 'Date' }))
    expect(days()).toEqual(['lun. 31 août 2026', 'ven. 2 oct. 2026', 'sam. 14 nov. 2026', 'date à déterminer'])
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\?status=all&sort=date&order=asc$/)
    fireEvent.click(screen.getByRole('button', { name: 'Nom' }))
    expect(rows().map((row) => row[2])).toEqual(['GUEST MIXES', 'LIVE PERFORMANCE', 'ONDES TAKEOVER', 'SOIRÉE'])
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\?status=all&sort=name&order=asc$/)
    fireEvent.click(screen.getByRole('button', { name: 'Statut' }))
    expect(rows().map((row) => row[5])).toEqual(['planifiée', 'planifiée', 'jouée', 'annulée'])
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\?status=all&sort=status&order=asc$/)
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

describe('The default view of the list of sessions', () => {
  // A session that's still planned, though it's past.
  const PAST = { ...SESSION, id: 'session-5', start: '2026-01-11T01:00:00.000Z', end: '2026-01-11T02:00:00.000Z', durationMinutes: 60, sets: [] }
  const LIST = { ...LOGGED_IN, '/api/admin/sessions': { ok: true, sessions: [...SESSIONS, PAST] } }
  const SOONEST = ['sam. 10 janv. 2026', 'sam. 14 nov. 2026', 'date à déterminer']
  const header = () => screen.getByRole('columnheader', { name: 'Date' })

  it('opens on the planned sessions, the soonest first, past ones included, those without a date last', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions')

    await waitFor(() => expect(days()).toEqual(SOONEST))
    expect(header()).toHaveAttribute('aria-sort', 'ascending')
    expect(header()).toHaveTextContent('Date ↑')
    expect(screen.getByRole('button', { name: 'planifiées (3)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions$/)
  })

  it('is the same view once its status is picked with its button', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions?status=all')

    fireEvent.click(await screen.findByRole('button', { name: 'planifiées (3)' }))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\?status=planned$/)
    expect(days()).toEqual(SOONEST)
    expect(header()).toHaveAttribute('aria-sort', 'ascending')
  })

  it('lists every session, or those with another status, the latest first', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions')

    fireEvent.click(await screen.findByRole('button', { name: 'toutes (5)' }))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\?status=all$/)
    expect(days()).toEqual(['date à déterminer', 'sam. 14 nov. 2026', 'ven. 2 oct. 2026', 'lun. 31 août 2026', 'sam. 10 janv. 2026'])
    expect(header()).toHaveAttribute('aria-sort', 'descending')

    fireEvent.click(screen.getByRole('button', { name: 'jouées (1)' }))
    expect(header()).toHaveAttribute('aria-sort', 'descending')
  })

  it('sorts the other way around with the first click on the column', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions')

    await waitFor(() => expect(days()).toHaveLength(3))
    fireEvent.click(within(header()).getByRole('button'))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\?sort=date&order=desc$/)
    expect(days()).toEqual([...SOONEST].reverse())
    expect(header()).toHaveAttribute('aria-sort', 'descending')
  })

  it('shows it for a status it does not know', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions?status=planifiee')

    await waitFor(() => expect(days()).toEqual(SOONEST))
  })

  it('says when there are none with its status, though there are others', async () => {
    const others = SESSIONS.filter((session) => session.status !== 'planned')
    mockFetch({ ...LIST, '/api/admin/sessions': { ok: true, sessions: others } })
    renderAt('/admin/sessions')

    expect(await screen.findByText('Aucune session avec ce statut.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'toutes (2)' })).toBeInTheDocument()
  })

  it('searches within it, while the buttons count what the search finds in every status', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions')

    await expectSearch('brume', ['sam. 14 nov. 2026', 'date à déterminer'])
    expect(
      within(screen.getByRole('group', { name: 'Statut' }))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['toutes (3)', 'planifiées (2)', 'jouées (1)', 'annulées (0)'])
  })
})

// The content of the event on RA of SESSION, as the server gives it.
const RA_EVENT = {
  title: 'ONDES TAKEOVER',
  start: '2026-11-14T21:00:00-05:00',
  end: '2026-11-15T01:00:00-05:00',
  lineup: 'Aurore\nBrume\nCyan',
  venueId: '288529',
  promoterIds: ['183980'],
  content: 'LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC',
}
const RA_EVENTS = {
  '/api/admin/sessions/session-1/ra-event': { ok: true, event: RA_EVENT },
}
const PAGE = { ...LOGGED_IN, ...RA_EVENTS, '/api/admin/sessions/session-1': { ok: true, session: SESSION } }
const setsTable = () => screen.getByRole('table', { name: 'Sets' })
// What the mark of each set says, if it has one, in its tooltip (see button.test.tsx).
const marks = () =>
  within(setsTable())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).queryByRole('button', { name: 'avertissement' })?.getAttribute('aria-describedby') ?? null)
    .map((id) => id && document.getElementById(id)!.textContent)
// What the session's record, or the content of its event on RA, says for `label`.
// Its own terms only, since the content of the event on RA is within the session's record.
const recordValue = (record: string, label: string) =>
  [...screen.getByLabelText(record).querySelectorAll(':scope > dt')].find((term) => term.textContent === label)!.nextElementSibling as HTMLElement
const value = (label: string) => recordValue('Session', label)
const raValue = (label: string) => recordValue("Contenu de l'événement RA", label)

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
    expect(value('Type')).toHaveTextContent(/^Takeover$/)
    expect(within(value('Takeover de')).getByRole('link', { name: 'Ondes' })).toHaveAttribute('href', '/admin/artistes/collectifs/collective-1')
    // Faded out, since it's the name its type gives it.
    expect(value('Nom')).toHaveTextContent(/^ONDES TAKEOVER$/)
    expect(value('Nom')).toHaveClass('admin-generated')
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

  it('shows its description, faded out when it is the one its type gives it, and its flyer, or that it has none', async () => {
    mockFetch(PAGE)
    const first = renderAt('/admin/sessions/session-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'ONDES TAKEOVER' })).toBeInTheDocument()
    expect(value('Description')).toHaveTextContent(/^LIVE STREAMING FROM QUÉBEC CITY\. SPACE OPEN TO PUBLIC$/)
    expect(value('Description')).toHaveClass('admin-generated')
    expect(value('Flyer')).toHaveTextContent(/^Pas de flyer$/)
    first.unmount()

    const own = { ...SESSION, description: 'Ligne 1\n\nLigne 2', effectiveDescription: 'Ligne 1\n\nLigne 2', hasFlyer: true, updatedAt: '2026-10-02T16:00:00.000Z' }
    mockFetch({ ...PAGE, '/api/admin/sessions/session-1': { ok: true, session: own } })
    const second = renderAt('/admin/sessions/session-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'ONDES TAKEOVER' })).toBeInTheDocument()
    // With its line breaks.
    expect(value('Description').textContent).toBe('Ligne 1\n\nLigne 2')
    expect(value('Description')).not.toHaveClass('admin-generated')
    expect(within(value('Flyer')).getByRole('img', { name: 'Flyer de ONDES TAKEOVER' })).toHaveAttribute(
      'src',
      `/api/admin/sessions/session-1/flyer?v=${encodeURIComponent('2026-10-02T16:00:00.000Z')}`,
    )
    expect(screen.getByText('La session, son flyer et ses sets seront supprimés pour de bon. Leurs artistes et le collectif de son takeover restent.')).toBeInTheDocument()
    second.unmount()

    // A session of type other has none, unless it has its own.
    const other = { ...SESSION, type: 'other', name: 'ATELIER', title: 'ATELIER', takeover: null, effectiveDescription: '', hasFlyer: true, sets: [] }
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-1': { ok: true, session: other } })
    renderAt('/admin/sessions/session-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'ATELIER' })).toBeInTheDocument()
    expect(value('Description')).toHaveTextContent(/^-$/)
    expect(screen.getByText('La session et son flyer seront supprimés pour de bon.')).toBeInTheDocument()
  })

  it("shows a session whose date isn't known, its sets' times counted from its start", async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-2': { ok: true, session: UNDATED } })
    renderAt('/admin/sessions/session-2')

    expect(await screen.findByRole('heading', { level: 1, name: 'GUEST MIXES' })).toBeInTheDocument()
    expect(value('Quand')).toHaveTextContent('date à déterminer')
    expect(value('Durée')).toHaveTextContent('3 h')
    expect(value('Type')).toHaveTextContent(/^Guest mixes$/)
    expect(screen.queryByText('Takeover de', { selector: 'dt' })).not.toBeInTheDocument()
    expect(value('Événement RA')).toHaveTextContent('-')
    expect(rows(setsTable()).map((row) => row[0])).toEqual(['+0 h – +1 h', '+1 h 30 – +2 h 30'])
    expect(screen.getByText('La session et ses sets seront supprimés pour de bon. Leurs artistes restent.')).toBeInTheDocument()
  })

  it('is titled by its own name, which it shows, and says what deleting it does', async () => {
    const named = { ...SESSION, name: 'VKT TAKEOVER', title: 'VKT TAKEOVER', sets: [] }
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-1': { ok: true, session: named } })
    const first = renderAt('/admin/sessions/session-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'VKT TAKEOVER' })).toBeInTheDocument()
    expect(value('Nom')).toHaveTextContent(/^VKT TAKEOVER$/)
    expect(value('Nom')).not.toHaveClass('admin-generated')
    expect(screen.getByText('Aucun set.')).toBeInTheDocument()
    expect(screen.getByText('La session sera supprimée pour de bon. Le collectif de son takeover reste.')).toBeInTheDocument()
    first.unmount()

    const other = { ...SESSION, type: 'other', name: 'LISTENING PARTY', title: 'LISTENING PARTY', takeover: null, sets: [] }
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-1': { ok: true, session: other } })
    const second = renderAt('/admin/sessions/session-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'LISTENING PARTY' })).toBeInTheDocument()
    expect(value('Type')).toHaveTextContent(/^Autre$/)
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
      "Annuler la session annule aussi ses 2 sets qui ne le sont pas. Annuler la session ?",
    )
    expect(requestsTo('PUT', '/api/admin/sessions/session-1/status')).toHaveLength(0)

    fireEvent.click(statuses.getByRole('button', { name: 'annulée' }))
    await waitFor(() => expect(statuses.getByRole('button', { name: 'annulée' })).toHaveAttribute('aria-pressed', 'true'))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sessions/session-1/status')[0])).toEqual({ status: 'cancelled' })
    expect(screen.getByText(/^Changé par admin@example.com le/)).toBeInTheDocument()

    // Its sets can't be added to, or un-cancelled, which the buttons say, greyed out, rather than the page.
    expect(visibleText(document.body)).not.toMatch(/La session est annulée/)
    const add = screen.getByRole('button', { name: 'ajouter un set' })
    expect(add).toHaveAttribute('aria-disabled', 'true')
    expect(add).toHaveAccessibleDescription('La session est annulée\u00a0: on ne peut pas lui ajouter de set.')
    fireEvent.click(add)
    expect(screen.queryByRole('heading', { name: 'Nouveau set' })).not.toBeInTheDocument()
    const setStatuses = within(screen.getByRole('group', { name: 'Statut : Set de Cyan, 22 h – 23 h 30' }))
    for (const status of ['planifié', 'joué']) {
      const button = setStatuses.getByRole('button', { name: status })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAccessibleDescription('La session est annulée\u00a0: on ne peut pas rétablir ses sets.')
    }
    fireEvent.click(setStatuses.getByRole('button', { name: 'joué' }))
    expect(requestsTo('PUT', '/api/admin/sets/set-2/status')).toHaveLength(0)
    expect(setStatuses.getByRole('button', { name: 'annulé' })).not.toHaveAttribute('aria-disabled')
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

  it("changes a set's status, saying above the sets why it couldn't, without naming the session it's on", async () => {
    const done = { ...SESSION, sets: [{ ...SET, status: 'done' as const }, CYAN_SET, SESSION.sets[2]] }
    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-1/status': { ok: true, session: done } })
    renderAt('/admin/sessions/session-1')

    const statuses = within(await screen.findByRole('group', { name: 'Statut : Set de Aurore et Brume, 21 h – 22 h' }))
    fireEvent.click(statuses.getByRole('button', { name: 'joué' }))
    await waitFor(() => expect(statuses.getByRole('button', { name: 'joué' })).toHaveAttribute('aria-pressed', 'true'))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sets/set-1/status')[0])).toEqual({ status: 'done' })

    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-3/status': { ok: false, error: 'This session is cancelled', session: SESSION, set: null } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Statut : Set, horaire à déterminer (1 h)' })).getByRole('button', { name: 'planifié' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Le statut de « Set, horaire à déterminer \(1 h\) » n'a pas pu être changé : This session is cancelled$/)
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument()
    expect(alert.compareDocumentPosition(setsTable()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("shows only the server's message when it names nothing in the way", async () => {
    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-1/status': { ok: false, error: 'This session is cancelled', session: null, set: null } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(within(await screen.findByRole('group', { name: 'Statut : Set de Aurore et Brume, 21 h – 22 h' })).getByRole('button', { name: 'annulé' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Le statut de « Set de Aurore et Brume, 21 h – 22 h » n'a pas pu être changé : This session is cancelled$/)
  })

  it('changes the session in a form in its place, sending its start back as it was', async () => {
    const changed = { ...SESSION, name: 'AUTRE', title: 'AUTRE', updatedBy: 'admin@example.com', updatedAt: '2026-10-02T16:00:00.000Z' }
    mockFetch({ ...PAGE, ...COLLECTIVES, ...EVENTS, 'PUT /api/admin/sessions/session-1': { ok: true, session: changed } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(await screen.findByLabelText('Date')).toHaveValue('2026-11-14')
    expect(screen.getByLabelText('Début')).toHaveValue('21:00')
    expect(screen.getByLabelText('Fin')).toHaveValue('01:00')
    expect(screen.getByRole('status')).toHaveTextContent('Dure 4 h, finit le lendemain, dimanche 15 novembre 2026.')
    expect(screen.getByText('Ses sets se déplacent avec elle.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Takeover' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Collectif' })).toHaveValue('Ondes')
    // The name its type gives it shows while it has none of its own.
    expect(screen.getByLabelText('Nom')).toHaveValue('')
    expect(screen.getByLabelText('Nom')).toHaveAttribute('placeholder', 'ONDES TAKEOVER')
    // Once RA's events are read, the session's is named by its title and its day.
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Événement RA' })).toHaveValue('HAUTE RIVE TAKEOVER, sam. 31 oct. 2026'))
    // Offered once, by its title, rather than by its number too.
    fireEvent.click(screen.getByRole('combobox', { name: 'Événement RA' }))
    expect(options()).toEqual([
      'Aucun événement RA',
      'ONDES TAKEOVER, sam. 5 déc. 2026n° 2300000',
      'PLUS TARD, dim. 10 janv. 2027n° 2400000',
      'HAUTE RIVE TAKEOVER, sam. 31 oct. 2026n° 6683745',
      'PLUS TÔT, mar. 1 sept. 2026n° 6683748',
    ])
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Événement RA' }), { key: 'Escape' })

    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'AUTRE' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'AUTRE' })).toBeInTheDocument()
    expect(sentSession(requestsTo('PUT', '/api/admin/sessions/session-1')[0])).toEqual({
      start: '2026-11-14T21:00-05:00',
      durationMinutes: 240,
      type: 'takeover',
      takeover: 'collective-1',
      name: 'AUTRE',
      raEvent: '6683745',
      description: '',
    })
  })

  it('changes its description and its flyer, which it can also remove, in the form', async () => {
    const withFlyer = { ...SESSION, hasFlyer: true }
    mockFetch({ ...LOGGED_IN, ...COLLECTIVES, ...EVENTS, '/api/admin/sessions/session-1': { ok: true, session: withFlyer }, 'PUT /api/admin/sessions/session-1': { ok: true, session: withFlyer } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    // The description its type gives it shows while it has none of its own, and can be taken as a start.
    const description = await screen.findByLabelText('Description')
    expect(description).toHaveValue('')
    expect(description).toHaveAttribute('placeholder', 'LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC')
    fireEvent.click(screen.getByRole('button', { name: 'reprendre le texte par défaut' }))
    expect(description).toHaveValue('LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC')
    expect(screen.queryByRole('button', { name: 'reprendre le texte par défaut' })).not.toBeInTheDocument()
    fireEvent.change(description, { target: { value: 'LIVE STREAMING FROM QUÉBEC CITY.\r\n\r\nSPECIAL  NIGHT ' } })
    // A synth meetup gives another one, and a session of type other none.
    fireEvent.click(screen.getByRole('radio', { name: 'Synth meetup' }))
    expect(description.getAttribute('placeholder')).toMatch(/^SYNTH MEETUPS\n\nRencontres hebdomadaires/)
    fireEvent.click(screen.getByRole('radio', { name: 'Autre' }))
    expect(description).not.toHaveAttribute('placeholder')
    expect(screen.queryByRole('button', { name: 'reprendre le texte par défaut' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Takeover' }))

    // Its flyer is shown, and removed once the session is saved.
    expect(screen.getByRole('img', { name: 'Flyer actuel' })).toHaveAttribute('src', expect.stringMatching(/^\/api\/admin\/sessions\/session-1\/flyer\?v=/))
    fireEvent.click(screen.getByRole('button', { name: 'retirer le flyer' }))
    expect(screen.getByText(/Le flyer actuel sera retiré à l'enregistrement\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-1')).toHaveLength(1))
    const sent = requestsTo('PUT', '/api/admin/sessions/session-1')[0].body as FormData
    expect(JSON.parse(sent.get('session') as string)).toMatchObject({ description: 'LIVE STREAMING FROM QUÉBEC CITY.\n\nSPECIAL  NIGHT' })
    expect(sent.get('removeFlyer')).toBe('true')
    expect(sent.get('flyer')).toBeNull()

    // Another flyer replaces it, and is checked as soon as it's chosen.
    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    const input = await screen.findByLabelText('Flyer')
    fireEvent.change(input, { target: { files: [new File(['gif'], 'flyer.gif', { type: 'image/gif' })] } })
    expect(await screen.findByText('Le flyer doit être en JPEG, PNG ou WebP.')).toBeInTheDocument()
    const flyer = new File(['flyer'], 'flyer.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [flyer] } })
    expect(screen.getByText(/^Facultatif\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-1')).toHaveLength(2))
    const replaced = requestsTo('PUT', '/api/admin/sessions/session-1')[1].body as FormData
    expect(replaced.get('flyer')).toBeInstanceOf(File)
    expect((replaced.get('flyer') as File).name).toBe('flyer.png')
    expect(replaced.get('removeFlyer')).toBeNull()
  })

  it("keeps the session's event on RA when it isn't among those read from RA, and offers it until the form closes", async () => {
    const other = { ...SESSION, raEvent: { id: '1000000', url: 'https://ra.co/events/1000000' } }
    mockFetch({ ...LOGGED_IN, ...COLLECTIVES, ...EVENTS, '/api/admin/sessions/session-1': { ok: true, session: other }, 'PUT /api/admin/sessions/session-1': { ok: true, session: other } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    const picker = await screen.findByRole('combobox', { name: 'Événement RA' })
    await waitFor(() => expect(picker).not.toHaveAttribute('placeholder', 'chargement des événements…'))
    expect(picker).toHaveValue('Événement RA n° 1000000')
    expect(screen.getByRole('link', { name: 'https://ra.co/events/1000000' })).toHaveAttribute('href', 'https://ra.co/events/1000000')
    fireEvent.click(picker)
    expect(options()).toEqual([
      'Aucun événement RA',
      'Événement RA n° 1000000',
      'ONDES TAKEOVER, sam. 5 déc. 2026n° 2300000',
      'PLUS TARD, dim. 10 janv. 2027n° 2400000',
      'HAUTE RIVE TAKEOVER, sam. 31 oct. 2026n° 6683745',
      'PLUS TÔT, mar. 1 sept. 2026n° 6683748',
    ])
    // It's found by its name and its number, like "Aucun événement RA" by its own.
    fireEvent.change(picker, { target: { value: 'événement' } })
    expect(options()).toEqual(['Aucun événement RA', 'Événement RA n° 1000000'])
    fireEvent.change(picker, { target: { value: '1000' } })
    expect(options()).toEqual(['Événement RA n° 1000000'])
    fireEvent.change(picker, { target: { value: 'https://ra.co/events/1000000' } })
    expect(options()).toEqual(['Événement RA n° 1000000'])

    // Removed, then picked again.
    fireEvent.change(picker, { target: { value: 'aucun' } })
    fireEvent.keyDown(picker, { key: 'Enter' })
    expect(picker).toHaveValue('Aucun événement RA')
    expect(screen.queryByRole('link', { name: /^https:\/\/ra\.co/ })).not.toBeInTheDocument()
    fireEvent.change(picker, { target: { value: '1000000' } })
    fireEvent.keyDown(picker, { key: 'Enter' })
    expect(picker).toHaveValue('Événement RA n° 1000000')

    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(sentSession(requestsTo('PUT', '/api/admin/sessions/session-1')[0])).toMatchObject({ raEvent: '1000000' })
  })

  it("keeps the session's event on RA while RA's events can't be read, which it says, and only lets it be removed", async () => {
    mockFetch({ ...PAGE, ...COLLECTIVES, [EVENTS_URL]: { ok: false, error: 'The events cannot be read from RA.' }, 'PUT /api/admin/sessions/session-1': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(await screen.findByText("Les événements n'ont pas pu être lus sur RA : The events cannot be read from RA.")).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const picker = screen.getByRole('combobox', { name: 'Événement RA' })
    expect(picker).toHaveValue('Événement RA n° 6683745')
    expect(screen.getByRole('link', { name: 'https://ra.co/events/6683745' })).toBeInTheDocument()
    fireEvent.click(picker)
    expect(options()).toEqual(['Aucun événement RA', 'Événement RA n° 6683745'])
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Aucun événement RA' }))

    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(sentSession(requestsTo('PUT', '/api/admin/sessions/session-1')[0])).toMatchObject({ raEvent: null })
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
    expect(sentSession(requestsTo('PUT', '/api/admin/sessions/session-1')[0])).toMatchObject({ start: '2026-11-01T01:30-05:00', durationMinutes: 120 })
  })

  it('marks the sets that are not cancelled and do not fit in the session, or overlap, saying why', async () => {
    // Until 23:00, with a set that overlaps the first two, two more that don't fit, and a cancelled one that wouldn't fit
    // either.
    const [first, cyan, cancelled] = SESSION.sets
    const crowded: Session = {
      ...SESSION,
      end: '2026-11-15T04:00:00.000Z',
      durationMinutes: 120,
      sets: [
        { ...first, overlappingSets: ['set-4'] },
        studioSet('set-4', {
          performers: [{ id: 'artist-4', name: 'Dune' }],
          offsetMinutes: 30,
          durationMinutes: 60,
          start: '2026-11-15T02:30:00.000Z',
          end: '2026-11-15T03:30:00.000Z',
          overlappingSets: ['set-1', 'set-2'],
        }),
        { ...cyan, fitsInSession: false, overlappingSets: ['set-4'] },
        studioSet('set-5', {
          performers: [{ id: 'artist-5', name: 'Écume' }],
          offsetMinutes: 130,
          durationMinutes: 30,
          start: '2026-11-15T04:10:00.000Z',
          end: '2026-11-15T04:40:00.000Z',
          fitsInSession: false,
        }),
        { ...cancelled, durationMinutes: 180, fitsInSession: false },
        studioSet('set-6', { performers: [{ id: 'artist-6', name: 'Flore' }], durationMinutes: 180, fitsInSession: false }),
      ],
    }
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-1': { ok: true, session: crowded }, 'DELETE /api/admin/sets/set-4': { ok: true } })
    renderAt('/admin/sessions/session-1')

    await screen.findByRole('table', { name: 'Sets' })
    expect(marks()).toEqual([
      'Chevauche le set de Dune, 21 h 30 – 22 h 30.',
      'Chevauche le set de Aurore et Brume, 21 h – 22 h. Chevauche le set de Cyan, 22 h – 23 h 30.',
      'Finit après la session. Chevauche le set de Dune, 21 h 30 – 22 h 30.',
      'Commence après la session.',
      null,
      'Dure plus longtemps que la session.',
    ])
    // After the times, as text rather than as an emoji.
    expect(rows(setsTable())[0][0]).toBe('21 h – 22 h \u26a0\ufe0e')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()

    // Without the set that overlapped the others, they don't overlap anymore.
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'supprimer : Set de Dune, 21 h 30 – 22 h 30' }))
    await waitFor(() => expect(marks()).toHaveLength(5))
    expect(marks()).toEqual([null, 'Finit après la session.', 'Commence après la session.', null, 'Dure plus longtemps que la session.'])
    expect(rows(setsTable())[0][0]).toBe('21 h – 22 h')
  })

  it('marks no set when every set fits in the session, without overlapping another', async () => {
    mockFetch(PAGE)
    renderAt('/admin/sessions/session-1')
    await screen.findByRole('table', { name: 'Sets' })
    expect(marks()).toEqual([null, null, null])
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
    expect(sentSession(requestsTo('PUT', '/api/admin/sessions/session-2')[0])).toEqual({
      start: '2026-11-14T21:00-05:00',
      durationMinutes: 180,
      type: 'guest-mixes',
      takeover: null,
      name: '',
      raEvent: null,
      description: '',
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

describe("A session's event on RA", () => {
  const RA_URL = '/api/admin/sessions/session-1/ra-event'
  const UNPUBLISHED = { ...SESSION, raEvent: null }
  const UNPUBLISHED_PAGE = { ...PAGE, '/api/admin/sessions/session-1': { ok: true, session: UNPUBLISHED } }
  const SAVED = { ...SESSION, raEvent: { id: '2400123', url: 'https://ra.co/events/2400123' } }
  const writeText = vi.fn<(text: string) => Promise<void>>()

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  async function openPanel() {
    fireEvent.click(within(await screen.findByLabelText('Session')).getByRole('button', { name: 'créer' }))
    await waitFor(() => expect(raValue('Titre')).toBeInTheDocument())
  }

  it('is only a link once the session has one, without its content', async () => {
    mockFetch(PAGE)
    renderAt('/admin/sessions/session-1')
    await screen.findByRole('heading', { level: 1, name: 'ONDES TAKEOVER' })
    expect(value('Événement RA')).toHaveTextContent(/^https:\/\/ra\.co\/events\/6683745$/)
    expect(screen.queryByRole('button', { name: 'créer' })).not.toBeInTheDocument()
    expect(requestsTo('GET', RA_URL)).toHaveLength(0)
  })

  it('shows its content under "Événement RA", with a button to copy each text, once "créer" is clicked', async () => {
    mockFetch(UNPUBLISHED_PAGE)
    renderAt('/admin/sessions/session-1')
    await screen.findByRole('heading', { level: 1, name: 'ONDES TAKEOVER' })
    expect(value('Événement RA')).toHaveTextContent(/^- créer$/)
    await openPanel()

    expect(within(value('Événement RA')).getByRole('link', { name: 'sur RA' })).toHaveAttribute('href', 'https://ra.co/pro/event/create')
    expect(raValue('Titre')).toHaveTextContent(/^ONDES TAKEOVERcopier$/)
    expect(raValue('Quand')).toHaveTextContent('samedi 14 novembre 2026, de 21 h à 1 h le lendemain')
    expect(within(raValue('Line-up')).getByText(/^Aurore/)).toHaveTextContent('Aurore Brume Cyan', { normalizeWhitespace: true })
    expect(within(raValue('Salle')).getByRole('link')).toHaveAttribute('href', 'https://ra.co/clubs/288529')
    expect(within(raValue('Promoteur')).getByRole('link')).toHaveAttribute('href', 'https://ra.co/promoters/183980')
    expect(raValue('Description')).toHaveTextContent('LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC')

    fireEvent.click(screen.getByRole('button', { name: 'copier le line-up' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'copier le line-up' })).toHaveTextContent('copié'))
    expect(writeText).toHaveBeenCalledWith('Aurore\nBrume\nCyan')
    fireEvent.click(screen.getByRole('button', { name: 'copier le titre' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('ONDES TAKEOVER'))
    fireEvent.click(screen.getByRole('button', { name: 'copier la description' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC'))

    writeText.mockRejectedValue(new Error('Denied'))
    fireEvent.click(screen.getByRole('button', { name: 'copier le titre' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'copier le titre' })).toHaveTextContent('échec de la copie'))

    // Closing it saves nothing.
    fireEvent.click(screen.getByRole('button', { name: 'annuler' }))
    expect(value('Événement RA')).toHaveTextContent(/^- créer$/)
    expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(0)
  })

  it("saves only the event's link, then shows the session as the server returns it", async () => {
    // With a description someone else gave it since the page loaded it.
    const saved = { ...SAVED, description: 'Changée entre-temps.', effectiveDescription: 'Changée entre-temps.' }
    mockFetch({ ...UNPUBLISHED_PAGE, 'PATCH /api/admin/sessions/session-1': { ok: true, session: saved } })
    renderAt('/admin/sessions/session-1')
    await openPanel()

    const field = screen.getByRole('textbox', { name: "Lien de l'événement RA" })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(await screen.findByText("Collez le lien de l'événement RA.")).toBeInTheDocument()
    fireEvent.change(field, { target: { value: 'https://ra.co/clubs/288529' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(await screen.findByText("Ce n'est pas le lien d'un événement RA, p. ex. https://ra.co/events/6683745.")).toBeInTheDocument()
    expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(0)

    // With or without its https://.
    fireEvent.change(field, { target: { value: 'ra.co/events/2400123' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(value('Événement RA')).toHaveTextContent(/^https:\/\/ra\.co\/events\/2400123$/))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sessions/session-1')[0])).toEqual({ raEvent: '2400123' })
    expect(value('Description')).toHaveTextContent(/^Changée entre-temps\.$/)
  })

  it("shows the server's error when the link can't be saved", async () => {
    mockFetch({ ...UNPUBLISHED_PAGE, 'PATCH /api/admin/sessions/session-1': { ok: false, error: 'Something went wrong' } })
    renderAt('/admin/sessions/session-1')
    await openPanel()
    fireEvent.change(screen.getByRole('textbox', { name: "Lien de l'événement RA" }), { target: { value: '2400123' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("L'événement RA n'a pas pu être enregistré : Something went wrong")
    expect(screen.getByRole('button', { name: 'enregistrer' })).toBeEnabled()
  })

  it('shows a session without a date as such, and a missing description without a button', async () => {
    mockFetch({ ...PAGE, '/api/admin/sessions/session-2': { ok: true, session: UNDATED }, '/api/admin/sessions/session-2/ra-event': { ok: true, event: { ...RA_EVENT, start: null, end: null, content: '' } } })
    renderAt('/admin/sessions/session-2')
    await openPanel()

    expect(raValue('Quand')).toHaveTextContent('date à déterminer')
    expect(raValue('Description')).toHaveTextContent(/^-$/)
    expect(screen.queryByRole('button', { name: 'copier la description' })).not.toBeInTheDocument()
  })

  it('reads it again whenever the session changes, e.g. its sets', async () => {
    const cancelled = { ...UNPUBLISHED, sets: [{ ...SET, status: 'cancelled' as const }, CYAN_SET, SESSION.sets[2]] }
    mockFetch(UNPUBLISHED_PAGE)
    renderAt('/admin/sessions/session-1')
    await openPanel()

    mockFetch({ ...UNPUBLISHED_PAGE, [RA_URL]: { ok: true, event: { ...RA_EVENT, lineup: 'Cyan' } }, 'PUT /api/admin/sets/set-1/status': { ok: true, session: cancelled } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Statut : Set de Aurore et Brume, 21 h – 22 h' })).getByRole('button', { name: 'annulé' }))
    await waitFor(() => expect(raValue('Line-up')).toHaveTextContent(/^Cyancopier$/))
  })

  it("opens RA's form with the event, for the bookmarklet, from the panel", async () => {
    mockFetch(UNPUBLISHED_PAGE)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderAt('/admin/sessions/session-1')
    await openPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Publier sur RA' }))
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/ra\.co\/pro\/event\/create#parking-radio=/), '_blank', 'noopener')
    const url = open.mock.calls[0][0] as string
    expect(JSON.parse(decodeURIComponent(url.slice(url.indexOf('=') + 1)))).toEqual({ site: location.origin, environment: 'production', session: 'session-1', event: RA_EVENT })
    expect(screen.queryByText(/^Attention/)).not.toBeInTheDocument()
    open.mockRestore()
  })

  it("can't publish a session that has no date, or is cancelled", async () => {
    const expectUnavailable = async (session: Session, why: string) => {
      mockFetch({ ...PAGE, [`/api/admin/sessions/${session.id}`]: { ok: true, session }, [`/api/admin/sessions/${session.id}/ra-event`]: { ok: true, event: RA_EVENT } })
      const page = renderAt(`/admin/sessions/${session.id}`)
      await openPanel()
      const button = screen.getByRole('button', { name: 'Publier sur RA' })
      expect(button).toHaveAccessibleDescription(why)
      expect(button).toHaveAttribute('aria-disabled', 'true')
      page.unmount()
    }
    await expectUnavailable(UNDATED, "La session n'a pas de date.")
    await expectUnavailable({ ...UNPUBLISHED, status: 'cancelled' }, 'La session est annulée.')
  })

  it('publishes outside production too, warning that the event will be created on RA all the same', async () => {
    mockFetch({ ...UNPUBLISHED_PAGE, '/api/config': { ...CONFIG, environment: 'test' } })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderAt('/admin/sessions/session-1')
    await openPanel()

    expect(await screen.findByText("Attention : l'événement sera vraiment créé sur RA, à partir d'une session de TEST.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Publier sur RA' }))
    const url = open.mock.calls[0][0] as string
    expect(JSON.parse(decodeURIComponent(url.slice(url.indexOf('=') + 1)))).toMatchObject({ environment: 'test' })
    open.mockRestore()
  })

  it('opens the panel with the event on RA the bookmarklet created, saving it only with « enregistrer »', async () => {
    mockFetch({ ...UNPUBLISHED_PAGE, 'PATCH /api/admin/sessions/session-1': { ok: true, session: SAVED } })
    renderAt('/admin/sessions/session-1?raEvent=2400123')

    const notice = "L'événement RA n° 2400123 vient d'être créé sur RA : enregistrez-le dans la session."
    expect(await screen.findByText(notice, { normalizer: (text) => text.replace(/\s+/g, ' ') })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: "Lien de l'événement RA" })).toHaveValue('https://ra.co/events/2400123')
    expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(value('Événement RA')).toHaveTextContent(/^https:\/\/ra\.co\/events\/2400123$/))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sessions/session-1')[0])).toEqual({ raEvent: '2400123' })
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\/session-1$/)
  })

  it('saves nothing when the panel is cancelled, and ignores what is not an event on RA', async () => {
    mockFetch(UNPUBLISHED_PAGE)
    const first = renderAt('/admin/sessions/session-1?raEvent=2400123')
    fireEvent.click(await screen.findByRole('button', { name: 'annuler' }))
    expect(value('Événement RA')).toHaveTextContent(/^- créer$/)
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\/session-1$/)
    first.unmount()

    renderAt('/admin/sessions/session-1?raEvent=javascript:alert(1)')
    await screen.findByRole('heading', { level: 1, name: 'ONDES TAKEOVER' })
    expect(value('Événement RA')).toHaveTextContent(/^- créer$/)
    expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(0)
  })

  it('says when its content could not be loaded', async () => {
    mockFetch({ ...UNPUBLISHED_PAGE, [RA_URL]: { ok: false, error: 'Something went wrong' } })
    renderAt('/admin/sessions/session-1')
    fireEvent.click(within(await screen.findByLabelText('Session')).getByRole('button', { name: 'créer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Le contenu de l'événement RA n'a pas pu être chargé : Something went wrong")
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

  it('adds a set when the last one ends, for an hour, with its performance types and its artists’ genres, and closes', async () => {
    const added = { ...SESSION, sets: [...SESSION.sets, studioSet('set-9', { performers: [{ id: 'artist-3', name: 'Cyan' }], offsetMinutes: 150, durationMinutes: 60 })] }
    mockFetch({ ...SET_PAGE, 'POST /api/admin/sessions/session-1/sets': { ok: true, session: added } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    // After Cyan's set, which ends at 23:30: the cancelled one, whose place isn't known, doesn't count.
    expect(screen.getByLabelText('Début')).toHaveValue('23:30')
    expect(screen.getByLabelText('Fin')).toHaveValue('00:30')
    expect(screen.getByRole('status')).toHaveTextContent('Dure 1 h, finit le lendemain, dimanche 15 novembre 2026.')
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
      performanceTypes: ['dj'],
      otherPerformanceType: '',
      genres: ['house', 'techno', 'acid'],
      soundcloudTrack: null,
      youtubeVideo: null,
    })
  })

  it("changes a set, from times that are the next day, which it says, and doesn't check that it takes place within the session", async () => {
    mockFetch({ ...SET_PAGE, 'PUT /api/admin/sets/set-2': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Cyan, 22 h – 23 h 30' }))
    expect(await screen.findByLabelText('Début')).toHaveValue('22:00')
    expect(screen.getByLabelText('Fin')).toHaveValue('23:30')
    expect(screen.getByLabelText('Performance Live')).toBeChecked()
    expect(screen.getByLabelText('Autre')).toHaveValue('Synthé')
    expect(screen.getByRole('button', { name: 'retirer ambient' })).toBeInTheDocument()
    expect(screen.getByText(/^Ajouté par admin@example.com le/)).toBeInTheDocument()

    expect(screen.getByRole('status')).toHaveTextContent('Dure 1 h 30.')
    // Before the session's start time, so the next day, after it ends.
    fireEvent.change(screen.getByLabelText('Début'), { target: { value: '20:00' } })
    fireEvent.change(screen.getByLabelText('Fin'), { target: { value: '21:00' } })
    expect(screen.getByRole('status')).toHaveTextContent('Dure 1 h, commence le lendemain, dimanche 15 novembre 2026.')
    fireEvent.change(screen.getByLabelText('Début'), { target: { value: '00:30' } })
    fireEvent.change(screen.getByLabelText('Fin'), { target: { value: '01:30' } })
    expect(screen.getByRole('status')).toHaveTextContent('Dure 1 h, commence le lendemain, dimanche 15 novembre 2026.')
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sets/set-2')).toHaveLength(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(jsonBody(requestsTo('PUT', '/api/admin/sets/set-2')[0])).toMatchObject({
      performers: [{ id: 'artist-3' }],
      offsetMinutes: 210,
      durationMinutes: 60,
      performanceTypes: ['live-performance'],
      otherPerformanceType: 'Synthé',
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
    fireEvent.change(start.getByLabelText('heures'), { target: { value: '24' } })
    fireEvent.change(start.getByLabelText('minutes'), { target: { value: '' } })
    fireEvent.change(duration.getByLabelText('heures'), { target: { value: '1' } })
    expect(await screen.findByText('Un set commence au plus 23 h 59 après le début de la session.')).toBeInTheDocument()

    // Until after the session ends, which it doesn't have to.
    fireEvent.change(start.getByLabelText('heures'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions/session-2/sets')).toHaveLength(1))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions/session-2/sets')[0])).toMatchObject({ offsetMinutes: 120, durationMinutes: 60 })
  })

  it('adds a set whose place is not known, with or without a duration, which can be longer than the session, but not a day', async () => {
    mockFetch({ ...SET_PAGE, 'POST /api/admin/sessions/session-1/sets': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    pick('Brume')
    fireEvent.click(screen.getByLabelText('horaire à déterminer'))
    const duration = within(screen.getByRole('group', { name: 'Durée' }))
    // As long as the times said.
    expect(duration.getByLabelText('heures')).toHaveValue(1)
    fireEvent.change(duration.getByLabelText('heures'), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    expect(await screen.findByText('Un set dure au plus 24 heures.')).toBeInTheDocument()

    fireEvent.change(duration.getByLabelText('heures'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions/session-1/sets')).toHaveLength(1))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions/session-1/sets')[0])).toMatchObject({ offsetMinutes: null, durationMinutes: 300 })

    await openNew()
    pick('Brume')
    fireEvent.click(screen.getByLabelText('horaire à déterminer'))
    fireEvent.change(within(screen.getByRole('group', { name: 'Durée' })).getByLabelText('heures'), { target: { value: '' } })
    fireEvent.change(within(screen.getByRole('group', { name: 'Durée' })).getByLabelText('minutes'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions/session-1/sets')).toHaveLength(2))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions/session-1/sets')[1])).toMatchObject({ offsetMinutes: null, durationMinutes: null })
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

    // A set of this session is named without a link.
    mockFetch({ ...SET_PAGE, 'POST /api/admin/sessions/session-1/sets': { ok: false, error: "This YouTube video is another set's", session: SESSION, set: CYAN_SET } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/^Le set n'a pas pu être ajouté : This YouTube video is another set's \(Set de Cyan, 22 h – 23 h 30\)$/),
    )
    alert = screen.getByRole('alert')
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument()

    // A cancelled session has its own session in the way, which isn't named.
    mockFetch({ ...SET_PAGE, 'POST /api/admin/sessions/session-1/sets': { ok: false, error: 'This session is cancelled', session: SESSION, set: null } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^Le set n'a pas pu être ajouté : This session is cancelled$/))
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

  async function fillIn({ day = '2026-11-14', start = '21:00', end = '01:00', type = 'Guest mixes' as string | null } = {}) {
    fireEvent.change(await screen.findByLabelText('Date'), { target: { value: day } })
    fireEvent.change(screen.getByLabelText('Début'), { target: { value: start } })
    fireEvent.change(screen.getByLabelText('Fin'), { target: { value: end } })
    if (type) fireEvent.click(screen.getByRole('radio', { name: type }))
  }

  it('adds a session, ending the next day when the end time is not after the start time, and goes to its page', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')

    await fillIn()
    expect(screen.getByRole('status')).toHaveTextContent('Dure 4 h, finit le lendemain, dimanche 15 novembre 2026.')
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: '  HAUTE   RIVE ' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\/session-1$/))
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toEqual({
      start: '2026-11-14T21:00-05:00',
      durationMinutes: 240,
      type: 'guest-mixes',
      takeover: null,
      name: 'HAUTE RIVE',
      raEvent: null,
      description: '',
    })
  })

  it('adds a session with its own description, of at most 5000 characters, and a flyer', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')

    await fillIn()
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'x'.repeat(5001) } })
    fireEvent.blur(screen.getByLabelText('Description'))
    expect(screen.getByText('La description dépasse 5000 caractères.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: ' Une soirée.\n\nDeux salles. ' } })
    fireEvent.change(screen.getByLabelText('Flyer'), { target: { files: [new File(['flyer'], 'flyer.jpg', { type: 'image/jpeg' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))

    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    const sent = requestsTo('POST', '/api/admin/sessions')[0].body as FormData
    expect(JSON.parse(sent.get('session') as string)).toMatchObject({ description: 'Une soirée.\n\nDeux salles.' })
    expect((sent.get('flyer') as File).name).toBe('flyer.jpg')
    expect(sent.get('removeFlyer')).toBeNull()
  })

  it('needs a type, picked among them in order, a collective for a takeover only, and a name for another kind of session', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')

    await fillIn({ type: null })
    const types = within(screen.getByRole('group', { name: 'Type' }))
    expect(types.getAllByRole('radio').map((radio) => radio.parentElement!.textContent)).toEqual(['Guest mixes', 'Live performance', 'Takeover', 'Synth meetup', 'Autre'])
    expect(types.getAllByRole('radio').filter((radio) => (radio as HTMLInputElement).checked)).toEqual([])
    expect(screen.getByLabelText('Nom')).toHaveAttribute('placeholder', 'p. ex. LISTENING PARTY')
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    expect(await screen.findByText('Choisissez le type de la session.')).toBeInTheDocument()

    // Only a takeover has a collective, which it needs, and which gives it its name.
    expect(screen.queryByRole('combobox', { name: 'Collectif' })).not.toBeInTheDocument()
    fireEvent.click(types.getByRole('radio', { name: 'Takeover' }))
    expect(screen.queryByText('Choisissez le type de la session.')).not.toBeInTheDocument()
    expect(await screen.findByText('Choisissez le collectif du takeover.')).toBeInTheDocument()
    expect(screen.getByLabelText('Nom')).toHaveAttribute('placeholder', 'NOM DU COLLECTIF TAKEOVER')
    const collective = screen.getByRole('combobox', { name: 'Collectif' })
    fireEvent.click(collective)
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Ondes/ }))
    expect(screen.getByLabelText('Nom')).toHaveAttribute('placeholder', 'ONDES TAKEOVER')

    // Another type doesn't send it, but keeps it while the form is open.
    fireEvent.click(types.getByRole('radio', { name: 'Synth meetup' }))
    expect(screen.queryByRole('combobox', { name: 'Collectif' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Nom')).toHaveAttribute('placeholder', 'SYNTH MEETUPS')
    fireEvent.click(types.getByRole('radio', { name: 'Takeover' }))
    expect(screen.getByRole('combobox', { name: 'Collectif' })).toHaveValue('Ondes')

    fireEvent.click(types.getByRole('radio', { name: 'Autre' }))
    expect(screen.getByLabelText('Nom')).toHaveAttribute('placeholder', 'p. ex. LISTENING PARTY')
    expect(await screen.findByText('Indiquez le nom de la session.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'ATELIER DE DJing' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ type: 'other', takeover: null, name: 'ATELIER DE DJing' })
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
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ start: null, durationMinutes: 210 })
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

  it('picks the event on RA among every one read from RA, the upcoming ones first, found by title, day or number', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')
    await fillIn()

    expect(screen.queryByLabelText("Lien de l'événement")).not.toBeInTheDocument()
    const picker = screen.getByRole('combobox', { name: 'Événement RA' })
    await waitFor(() => expect(picker).not.toHaveAttribute('placeholder', 'chargement des événements…'))
    expect(requestsTo('GET', EVENTS_URL)).toHaveLength(1)
    expect(picker).toHaveValue('Aucun événement RA')
    fireEvent.click(picker)
    // Each by the day it starts on in Québec, e.g. October 31, though it's November 1 in UTC.
    expect(options()).toEqual([
      'Aucun événement RA',
      'ONDES TAKEOVER, sam. 5 déc. 2026n° 2300000',
      'PLUS TARD, dim. 10 janv. 2027n° 2400000',
      'HAUTE RIVE TAKEOVER, sam. 31 oct. 2026n° 6683745',
      'PLUS TÔT, mar. 1 sept. 2026n° 6683748',
    ])

    const found = (query: string) => {
      fireEvent.change(picker, { target: { value: query } })
      return options()
    }
    expect(found('plus')).toEqual(['PLUS TARD, dim. 10 janv. 2027n° 2400000', 'PLUS TÔT, mar. 1 sept. 2026n° 6683748'])
    expect(found('31 oct')).toEqual(['HAUTE RIVE TAKEOVER, sam. 31 oct. 2026n° 6683745'])
    expect(found('samedi 5 décembre 2026')).toEqual(['ONDES TAKEOVER, sam. 5 déc. 2026n° 2300000'])
    expect(found('haute 31 oct')).toEqual(['HAUTE RIVE TAKEOVER, sam. 31 oct. 2026n° 6683745'])
    // As an event's day is shown, with "mar" for mardi, or by its weekday and day alone.
    expect(found('mar 1 sept')).toEqual(['PLUS TÔT, mar. 1 sept. 2026n° 6683748'])
    expect(found('mar 1')).toEqual(['PLUS TÔT, mar. 1 sept. 2026n° 6683748'])
    expect(found('mar. 1 sept. 2026')).toEqual(['PLUS TÔT, mar. 1 sept. 2026n° 6683748'])
    // A number, or part of one, exactly, without the typos titles allow for.
    expect(found('8374')).toEqual(['HAUTE RIVE TAKEOVER, sam. 31 oct. 2026n° 6683745', 'PLUS TÔT, mar. 1 sept. 2026n° 6683748'])
    expect(found('45')).toEqual(['HAUTE RIVE TAKEOVER, sam. 31 oct. 2026n° 6683745'])
    // Digits are searched in titles and days too, e.g. a year, or a day of the month.
    expect(found('2026')).toEqual([
      'ONDES TAKEOVER, sam. 5 déc. 2026n° 2300000',
      'HAUTE RIVE TAKEOVER, sam. 31 oct. 2026n° 6683745',
      'PLUS TÔT, mar. 1 sept. 2026n° 6683748',
    ])
    expect(found('5')).toEqual(['ONDES TAKEOVER, sam. 5 déc. 2026n° 2300000', 'HAUTE RIVE TAKEOVER, sam. 31 oct. 2026n° 6683745'])
    // A link to an event's page finds that one, if it's offered.
    expect(found('https://www.ra.co/events/6683745/?ref=x')).toEqual(['HAUTE RIVE TAKEOVER, sam. 31 oct. 2026n° 6683745'])
    expect(found('ra.co/events/2300000')).toEqual(['ONDES TAKEOVER, sam. 5 déc. 2026n° 2300000'])
    expect(found('https://ra.co/events/1234567')).toEqual([])
    expect(found(' 6683748 ')).toEqual(['PLUS TÔT, mar. 1 sept. 2026n° 6683748'])
    fireEvent.keyDown(picker, { key: 'Enter' })
    expect(picker).toHaveValue('PLUS TÔT, mar. 1 sept. 2026')
    expect(screen.getByRole('link', { name: 'https://ra.co/events/6683748' })).toHaveAttribute('href', 'https://ra.co/events/6683748')

    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ raEvent: '6683748' })
  })

  it('starts as the takeover of the collective of the link that leads to it, sent by its id, unless it is unknown', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    const first = renderAt('/admin/sessions/nouvelle?takeover=collective-1')
    expect(await screen.findByRole('combobox', { name: 'Collectif' })).toHaveValue('Ondes')
    expect(screen.getByRole('radio', { name: 'Takeover' })).toBeChecked()
    await fillIn({ type: null })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ type: 'takeover', takeover: 'collective-1' })
    first.unmount()

    renderAt('/admin/sessions/nouvelle?takeover=unknown')
    expect(await screen.findByRole('radio', { name: 'Takeover' })).not.toBeChecked()
    expect(screen.queryByRole('combobox', { name: 'Collectif' })).not.toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('radio', { name: 'Takeover' }))
    expect(screen.getByRole('combobox', { name: 'Collectif' })).toBeDisabled()
  })

  it('starts without a type when the collectives could not be loaded, even from a collective', async () => {
    mockFetch({ ...NEW, '/api/admin/collectives': { ok: false, error: 'Boom' } })
    renderAt('/admin/sessions/nouvelle?takeover=collective-1')

    expect(await screen.findByRole('alert')).toHaveTextContent("Les collectifs n'ont pas pu être chargés : Boom")
    expect(screen.getByRole('radio', { name: 'Takeover' })).not.toBeChecked()
  })
})
