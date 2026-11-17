import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import App from '../../app'
import type { Application } from '../../application-fields'
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

function application(id: string, owner: { artistId: string } | { collectiveId: string }, receivedAt: string, status: Application['status'], dates: string[]): Application {
  return {
    id,
    artistId: null,
    collectiveId: null,
    ...owner,
    receivedAt,
    createdAt: receivedAt,
    createdBy: 'admin@example.com',
    dates,
    timeSlots: [],
    performanceTypes: ['dj'],
    otherPerformanceType: '',
    details: '',
    updatedBy: null,
    updatedAt: null,
    status,
    statusUpdatedBy: null,
    statusUpdatedAt: null,
    sets: [],
    sessions: [],
  }
}

// Every application, as the server lists them, the most recently received first: Cyan's, which set-2 comes from, Ondes',
// which its takeover comes from, then Brume's, and Aurore's.
const APPLICATIONS_LIST = [
  application('application-2', { artistId: 'artist-3' }, '2026-09-02T16:00:00.000Z', 'scheduled', ['2026-11-14']),
  application('application-1', { collectiveId: 'collective-1' }, '2026-09-01T16:00:00.000Z', 'accepted', ['2026-11-14', '2026-11-21']),
  application('application-4', { artistId: 'artist-2' }, '2026-08-20T16:00:00.000Z', 'accepted', ['2026-12-05']),
  application('application-3', { artistId: 'artist-1' }, '2026-08-15T16:00:00.000Z', 'new', ['2026-11-14', '2026-11-21', '2026-11-28', '2026-12-05']),
]
// What the forms of sessions and sets pick from, which they load with the artists or the collectives.
const APPLICATIONS = { '/api/admin/applications': { ok: true, total: APPLICATIONS_LIST.length, applications: APPLICATIONS_LIST } }
const ARTISTS = { '/api/admin/artists': { ok: true, artists: [AURORE, BRUME, CYAN] }, ...APPLICATIONS }
const COLLECTIVES = { '/api/admin/collectives': { ok: true, collectives: [ONDES] }, ...APPLICATIONS }

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
    durationMinutes: null,
    performanceTypes: [],
    otherPerformanceType: '',
    genres: [],
    soundcloudTrack: null,
    youtubeVideo: null,
    application: null,
    ...TRACKED,
    ...fields,
  }
}

// Saturday, November 14th, 2026, from 21:00 to 1:00 in Québec: two sets, then one that's cancelled, whose performer was
// deleted.
const SESSION: Session = {
  id: 'session-1',
  start: '2026-11-15T02:00:00.000Z',
  end: '2026-11-15T06:00:00.000Z',
  durationMinutes: 240,
  type: 'takeover',
  takeover: { id: 'collective-1', name: 'Ondes' },
  application: { id: 'application-1', receivedAt: '2026-09-01T16:00:00.000Z' },
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
      durationMinutes: 60,
      performanceTypes: ['dj'],
      genres: ['techno'],
      soundcloudTrack: { id: '123', url: 'https://soundcloud.com/parkingdotradio/ondes' },
      youtubeVideo: { id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    }),
    studioSet('set-2', {
      performers: [{ id: 'artist-3', name: 'Cyan' }],
      durationMinutes: 90,
      performanceTypes: ['live-performance'],
      otherPerformanceType: 'Synthé',
      genres: ['ambient'],
      application: { id: 'application-2', receivedAt: '2026-09-02T16:00:00.000Z' },
      status: 'done',
    }),
    studioSet('set-3', { durationMinutes: 60, status: 'cancelled' }),
  ],
  ...TRACKED,
  announced: false,
  announcedUpdatedBy: null,
  announcedUpdatedAt: null,
}
const [SET, CYAN_SET] = SESSION.sets

// A session whose date isn't known yet, with two sets.
const UNDATED: Session = {
  ...SESSION,
  id: 'session-2',
  start: null,
  end: null,
  durationMinutes: 180,
  type: 'guest-mixes',
  takeover: null,
  application: null,
  name: '',
  title: 'GUEST MIXES',
  raEvent: null,
  sets: [
    studioSet('set-4', { performers: [{ id: 'artist-2', name: 'Brume' }], durationMinutes: 60 }),
    studioSet('set-5', { performers: [{ id: 'artist-3', name: 'Cyan' }], durationMinutes: 60 }),
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
    application: null,
    name: 'SOIRÉE',
    title: 'SOIRÉE',
    raEvent: null,
    sets: [studioSet('set-6', {
        performers: [{ id: 'artist-2', name: 'Brume' }],
        durationMinutes: 60,
        status: 'done',
      })],
    status: 'done',
    announced: true,
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
// The date or the time of the session's start or end, in its form.
const timeInput = (when: 'Début' | 'Fin', part: 'date' | 'heure') => within(screen.getByRole('group', { name: when })).getByLabelText(part)

function sentSession(request: RequestInit) {
  return JSON.parse((request.body as FormData).get('session') as string)
}

describe('The list of sessions', () => {
  const LIST = { ...LOGGED_IN, '/api/admin/sessions': { ok: true, sessions: SESSIONS } }

  it('says which day a session ends on, when it lasts several days, and on its page too', async () => {
    // From 18:00 on Friday to 2:00 on Sunday.
    const weekend = { ...SESSION, start: '2026-11-13T23:00:00.000Z', end: '2026-11-15T07:00:00.000Z', durationMinutes: 1920 }
    mockFetch({ ...PAGE, '/api/admin/sessions': { ok: true, sessions: [weekend] }, '/api/admin/sessions/session-1': { ok: true, session: weekend } })
    renderAt('/admin/sessions?status=all')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(rows()[0].slice(0, 2)).toEqual(['ven. 13 nov. 2026', '18 h – dim. 15 nov., 2 h'])
    fireEvent.click(screen.getByRole('link', { name: 'ven. 13 nov. 2026' }))
    expect(await screen.findByText('du vendredi 13 novembre 2026 à 18 h au dimanche 15 novembre 2026 à 2 h')).toBeInTheDocument()
    expect(value('Durée')).toHaveTextContent(/^32 h$/)
  })

  it('lists every session, those without a date first, then the latest first, in Québec time', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions?status=all')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(rows()).toEqual([
      ['date à déterminer', '3 h', 'GUEST MIXES', 'Guest mixes', 'Brume · Cyan', 'planifiée', ''],
      ['sam. 14 nov. 2026', '21 h – 1 h', 'ONDES TAKEOVER', 'Takeover', 'Aurore, Brume · Cyan', 'planifiée', ''],
      ['ven. 2 oct. 2026', '20 h – 21 h', 'SOIRÉE', 'Autre', 'Brume', 'jouée', 'annoncée'],
      ['lun. 31 août 2026', '20 h – 21 h', 'LIVE PERFORMANCE', 'Live performance', '', 'annulée', ''],
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

  it('lists only the announced sessions, or the others, once picked, each group of buttons counting what the other one and the search find', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions?status=all')

    const statuses = within(await screen.findByRole('group', { name: 'Statut' }))
    const announced = within(screen.getByRole('group', { name: 'Annonce' }))
    const labels = (group: typeof statuses) => group.getAllByRole('button').map((button) => button.textContent)
    expect(labels(announced)).toEqual(['toutes (4)', 'annoncées (1)', 'non annoncées (3)'])
    expect(announced.getByRole('button', { name: 'toutes (4)' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(announced.getByRole('button', { name: 'non annoncées (3)' }))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\?status=all&announced=false$/)
    expect(days()).toEqual(['date à déterminer', 'sam. 14 nov. 2026', 'lun. 31 août 2026'])
    expect(labels(statuses)).toEqual(['toutes (3)', 'planifiées (2)', 'jouées (0)', 'annulées (1)'])

    fireEvent.click(statuses.getByRole('button', { name: 'planifiées (2)' }))
    expect(labels(announced)).toEqual(['toutes (2)', 'annoncées (0)', 'non annoncées (2)'])
    fireEvent.click(announced.getByRole('button', { name: 'annoncées (0)' }))
    expect(screen.getByText('Aucune session ne correspond à ces filtres.')).toBeInTheDocument()

    fireEvent.click(announced.getByRole('button', { name: 'toutes (2)' }))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\?status=planned$/)
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
// What the sets say when they add up to more than their session, if they do.
const tooLong = () => screen.queryByText(/Les sets durent /)?.textContent ?? null
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
    expect(within(value('Candidature')).getByRole('link', { name: 'reçue le 1 septembre 2026' })).toHaveAttribute('href', '/admin/candidatures/application-1')
    // Faded out, since it's the name its type gives it.
    expect(value('Nom')).toHaveTextContent(/^ONDES TAKEOVER$/)
    expect(value('Nom')).toHaveClass('admin-generated')
    expect(within(value('Événement RA')).getByRole('link')).toHaveAttribute('href', 'https://ra.co/events/6683745')

    expect(rows(setsTable())).toEqual([
      ['1 h', 'Aurore, Brume', 'DJ', 'techno', 'SoundCloud · YouTube', 'planifiéjouéannulé', '↑ ↓ modifier ×'],
      ['1 h 30', 'Cyan', 'Performance Live, autre : Synthé', 'ambient', 'Candidature', 'planifiéjouéannulé', '↑ ↓ modifier ×'],
      ['1 h', '-', '', '-', '', 'planifiéjouéannulé', '↑ ↓ modifier ×'],
    ])
    const first = within(setsTable()).getAllByRole('row')[1]
    expect(within(first).getByRole('link', { name: 'Aurore' })).toHaveAttribute('href', '/admin/artistes/artist-1')
    expect(within(first).getByRole('link', { name: 'YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    const second = within(setsTable()).getAllByRole('row')[2]
    const application = within(second).getByRole('link', { name: 'Candidature reçue le 2 septembre 2026' })
    expect(application).toHaveTextContent(/^Candidature$/)
    expect(application).toHaveAttribute('href', '/admin/candidatures/application-2')
    expect(within(screen.getByRole('group', { name: 'Statut : Set de Cyan' })).getByRole('button', { name: 'joué' })).toHaveAttribute(
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

  it("shows a session whose date isn't known, and its sets' durations", async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-2': { ok: true, session: UNDATED } })
    renderAt('/admin/sessions/session-2')

    expect(await screen.findByRole('heading', { level: 1, name: 'GUEST MIXES' })).toBeInTheDocument()
    expect(value('Quand')).toHaveTextContent('date à déterminer')
    expect(value('Durée')).toHaveTextContent('3 h')
    expect(value('Type')).toHaveTextContent(/^Guest mixes$/)
    expect(screen.queryByText('Takeover de', { selector: 'dt' })).not.toBeInTheDocument()
    expect(value('Événement RA')).toHaveTextContent('-')
    expect(rows(setsTable()).map((row) => row[0])).toEqual(['1 h', '1 h'])
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
    // Those that aren't cancelled, saying which were played.
    expect(confirm).toHaveBeenLastCalledWith('Ces sets seront aussi annulés\u00a0:\n• Set de Aurore et Brume\n• Set de Cyan (joué)\nAnnuler la session ?')
    expect(requestsTo('PUT', '/api/admin/sessions/session-1/status')).toHaveLength(0)

    fireEvent.click(statuses.getByRole('button', { name: 'annulée' }))
    await waitFor(() => expect(statuses.getByRole('button', { name: 'annulée' })).toHaveAttribute('aria-pressed', 'true'))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sessions/session-1/status')[0])).toEqual({ status: 'cancelled' })
    expect(screen.getByText(/^Statut changé par admin@example.com le/)).toBeInTheDocument()

    // Its sets can't be added to, or un-cancelled, which the buttons say, greyed out, rather than the page.
    expect(visibleText(document.body)).not.toMatch(/La session est annulée/)
    const add = screen.getByRole('button', { name: 'ajouter un set' })
    expect(add).toHaveAttribute('aria-disabled', 'true')
    expect(add).toHaveAccessibleDescription('La session est annulée\u00a0: on ne peut pas lui ajouter de set.')
    fireEvent.click(add)
    expect(screen.queryByRole('heading', { name: 'Nouveau set' })).not.toBeInTheDocument()
    const setStatuses = within(screen.getByRole('group', { name: 'Statut : Set de Cyan' }))
    for (const status of ['planifié', 'joué']) {
      const button = setStatuses.getByRole('button', { name: status })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAccessibleDescription('La session est annulée\u00a0: on ne peut pas rétablir ses sets.')
    }
    fireEvent.click(setStatuses.getByRole('button', { name: 'joué' }))
    expect(requestsTo('PUT', '/api/admin/sets/set-2/status')).toHaveLength(0)
    expect(setStatuses.getByRole('button', { name: 'annulé' })).not.toHaveAttribute('aria-disabled')
  })

  it('names the one set that cancelling a played session cancels, saying that it was played', async () => {
    const played: Session = { ...SESSION, status: 'done', sets: [CYAN_SET, SESSION.sets[2]] }
    mockFetch({ ...PAGE, '/api/admin/sessions/session-1': { ok: true, session: played } })
    renderAt('/admin/sessions/session-1')

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    fireEvent.click(within(await screen.findByRole('group', { name: 'Statut' })).getByRole('button', { name: 'annulée' }))
    expect(confirm).toHaveBeenLastCalledWith('Ce set sera aussi annulé\u00a0:\n• Set de Cyan (joué)\nAnnuler la session ?')
    expect(requestsTo('PUT', '/api/admin/sessions/session-1/status')).toHaveLength(0)
  })

  it('asks first when marking it jouée marks planned sets, naming them, and not when none is', async () => {
    const statusButton = async (name: string) => within(await screen.findByRole('group', { name: 'Statut' })).getByRole('button', { name })
    const done = (session: Session): Session => ({
      ...session,
      status: 'done',
      statusUpdatedBy: 'admin@example.com',
      statusUpdatedAt: '2026-11-15T04:00:00.000Z',
      sets: session.sets.map((set) => (set.status === 'planned' ? { ...set, status: 'done' } : set)),
    })
    mockFetch({ ...PAGE, 'PUT /api/admin/sessions/session-1/status': { ok: true, session: done(SESSION) } })
    const page = renderAt('/admin/sessions/session-1')

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(await statusButton('jouée'))
    expect(confirm).toHaveBeenLastCalledWith('Le set planifié sera aussi marqué comme joué\u00a0:\n• Set de Aurore et Brume\nMarquer la session comme jouée ?')
    expect(requestsTo('PUT', '/api/admin/sessions/session-1/status')).toHaveLength(0)
    fireEvent.click(await statusButton('jouée'))
    await waitFor(async () => expect(await statusButton('jouée')).toHaveAttribute('aria-pressed', 'true'))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sessions/session-1/status')[0])).toEqual({ status: 'done' })
    expect(within(screen.getByRole('group', { name: 'Statut : Set de Aurore et Brume' })).getByRole('button', { name: 'joué' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    page.unmount()

    // Several, each on a line of its own.
    mockFetch({ ...LOGGED_IN, ...RA_EVENTS, '/api/admin/sessions/session-2': { ok: true, session: UNDATED } })
    const undated = renderAt('/admin/sessions/session-2')
    confirm.mockReturnValueOnce(false)
    fireEvent.click(await statusButton('jouée'))
    expect(confirm).toHaveBeenLastCalledWith('Les sets planifiés seront aussi marqués comme joués\u00a0:\n• Set de Brume\n• Set de Cyan\nMarquer la session comme jouée ?')
    expect(requestsTo('PUT', '/api/admin/sessions/session-2/status')).toHaveLength(0)
    undated.unmount()

    // Without planned sets, nothing to ask.
    confirm.mockClear()
    const played = { ...SESSION, sets: SESSION.sets.slice(1) }
    mockFetch({ ...PAGE, '/api/admin/sessions/session-1': { ok: true, session: played }, 'PUT /api/admin/sessions/session-1/status': { ok: true, session: done(played) } })
    renderAt('/admin/sessions/session-1')
    fireEvent.click(await statusButton('jouée'))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-1/status')).toHaveLength(1))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('announces the session, and un-announces it, saying who did it', async () => {
    const announced = { ...SESSION, announced: true, announcedUpdatedBy: 'admin@example.com', announcedUpdatedAt: '2026-11-15T04:00:00.000Z' }
    mockFetch({ ...PAGE, 'PUT /api/admin/sessions/session-1/announced': { ok: true, session: announced } })
    renderAt('/admin/sessions/session-1')

    const group = within(await screen.findByRole('group', { name: 'Annonce' }))
    expect(group.getAllByRole('button').map((button) => button.textContent)).toEqual(['non annoncée', 'annoncée'])
    // Under "Statut", after the status, rather than under a heading of its own.
    const follows = (before: HTMLElement, after: HTMLElement) => Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.queryByRole('heading', { name: 'Annonce' })).not.toBeInTheDocument()
    expect(follows(screen.getByRole('group', { name: 'Statut' }), screen.getByRole('group', { name: 'Annonce' }))).toBe(true)
    expect(follows(screen.getByRole('group', { name: 'Annonce' }), screen.getByRole('heading', { level: 2, name: 'Session' }))).toBe(true)
    expect(group.getByRole('button', { name: 'non annoncée' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText(/^Annonce changée par/)).not.toBeInTheDocument()
    fireEvent.click(group.getByRole('button', { name: 'annoncée' }))
    await waitFor(() => expect(group.getByRole('button', { name: 'annoncée' })).toHaveAttribute('aria-pressed', 'true'))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sessions/session-1/announced')[0])).toEqual({ announced: true })
    expect(screen.getByText(/^Annonce changée par admin@example.com le/)).toBeInTheDocument()
    // Neither the status, nor who changed it.
    expect(screen.queryByText(/^Statut changé par/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Modifiée par/)).not.toBeInTheDocument()
  })

  it("says why it couldn't be announced, under its buttons", async () => {
    mockFetch({ ...PAGE, 'PUT /api/admin/sessions/session-1/announced': { ok: false, error: 'An announced session has a start' } })
    renderAt('/admin/sessions/session-1')

    const group = within(await screen.findByRole('group', { name: 'Annonce' }))
    fireEvent.click(group.getByRole('button', { name: 'annoncée' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("L'annonce n'a pas pu être changée : An announced session has a start")
    expect(alert.previousElementSibling).toBe(group.getByRole('button', { name: 'annoncée' }).closest('[role="group"]'))
    expect(group.getByRole('button', { name: 'non annoncée' })).toHaveAttribute('aria-pressed', 'true')
  })

  it("can't announce a session without a date, which its button says", async () => {
    mockFetch({ ...LOGGED_IN, ...RA_EVENTS, '/api/admin/sessions/session-2': { ok: true, session: UNDATED } })
    renderAt('/admin/sessions/session-2')

    const button = within(await screen.findByRole('group', { name: 'Annonce' })).getByRole('button', { name: 'annoncée' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAccessibleDescription("La session n'a pas de date.")
    fireEvent.click(button)
    expect(requestsTo('PUT', '/api/admin/sessions/session-2/announced')).toHaveLength(0)
  })

  it('says right away, in its form, that an announced session keeps its date', async () => {
    mockFetch({ ...LOGGED_IN, ...COLLECTIVES, ...EVENTS, '/api/admin/sessions/session-1': { ok: true, session: { ...SESSION, announced: true } } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    const undated = await screen.findByLabelText('date à déterminer')
    fireEvent.click(undated)
    expect(screen.getByRole('alert')).toHaveTextContent("Une session annoncée a une date : retirez d'abord son annonce.")
    expect(undated).toHaveAttribute('aria-invalid', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(requestsTo('PUT', '/api/admin/sessions/session-1')).toHaveLength(0)
    fireEvent.click(undated)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("says why the status couldn't be changed, linking to the session it would overlap", async () => {
    const other = SESSIONS[2]
    // Un-cancelling it, since a cancelled session doesn't count.
    const cancelled = { ...SESSION, status: 'cancelled' as const, sets: SESSION.sets.map((set) => ({ ...set, status: 'cancelled' as const })) }
    mockFetch({
      ...PAGE,
      '/api/admin/sessions/session-1': { ok: true, session: cancelled },
      'PUT /api/admin/sessions/session-1/status': { ok: false, error: 'Another session overlaps this one', session: other, set: null },
    })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(within(await screen.findByRole('group', { name: 'Statut' })).getByRole('button', { name: 'planifiée' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Le statut n'a pas pu être changé : Another session overlaps this one (SOIRÉE, ven. 2 oct. 2026)")
    expect(within(alert).getByRole('link')).toHaveAttribute('href', '/admin/sessions/session-3')
  })

  it("changes a set's status, saying above the sets why it couldn't, without naming the session it's on", async () => {
    const done = { ...SESSION, sets: [{ ...SET, status: 'done' as const }, CYAN_SET, SESSION.sets[2]] }
    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-1/status': { ok: true, session: done } })
    renderAt('/admin/sessions/session-1')

    const statuses = within(await screen.findByRole('group', { name: 'Statut : Set de Aurore et Brume' }))
    fireEvent.click(statuses.getByRole('button', { name: 'joué' }))
    await waitFor(() => expect(statuses.getByRole('button', { name: 'joué' })).toHaveAttribute('aria-pressed', 'true'))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sets/set-1/status')[0])).toEqual({ status: 'done' })

    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-3/status': { ok: false, error: 'This session is cancelled', session: SESSION, set: null } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Statut : Set' })).getByRole('button', { name: 'planifié' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Le statut de « Set » n'a pas pu être changé : This session is cancelled$/)
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument()
    expect(alert.compareDocumentPosition(setsTable()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("shows only the server's message when it names nothing in the way", async () => {
    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-1/status': { ok: false, error: 'This session is cancelled', session: null, set: null } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(within(await screen.findByRole('group', { name: 'Statut : Set de Aurore et Brume' })).getByRole('button', { name: 'annulé' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Le statut de « Set de Aurore et Brume » n'a pas pu être changé : This session is cancelled$/)
  })

  it('changes the session in a form in its place, sending its start back as it was', async () => {
    const changed = { ...SESSION, name: 'AUTRE', title: 'AUTRE', updatedBy: 'admin@example.com', updatedAt: '2026-10-02T16:00:00.000Z' }
    mockFetch({ ...PAGE, ...COLLECTIVES, ...EVENTS, 'PUT /api/admin/sessions/session-1': { ok: true, session: changed } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    await screen.findByRole('group', { name: 'Début' })
    expect(timeInput('Début', 'date')).toHaveValue('2026-11-14')
    expect(timeInput('Début', 'heure')).toHaveValue('21:00')
    expect(timeInput('Fin', 'date')).toHaveValue('2026-11-15')
    expect(timeInput('Fin', 'heure')).toHaveValue('01:00')
    expect(screen.getByRole('status')).toHaveTextContent(/^Dure 4 h\.$/)
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
      // Sent back as it is.
      application: 'application-1',
      name: 'AUTRE',
      raEvent: '6683745',
      description: '',
    })
  })

  it("picks a takeover's application among its collective's, which it keeps while another type is picked, but only a takeover sends", async () => {
    const VAGUES: Collective = { ...ONDES, id: 'collective-2', name: 'Vagues', email: 'vagues@example.com' }
    const vagues = application('application-5', { collectiveId: 'collective-2' }, '2026-09-10T16:00:00.000Z', 'new', ['2026-12-12'])
    mockFetch({
      ...PAGE,
      ...EVENTS,
      '/api/admin/collectives': { ok: true, collectives: [ONDES, VAGUES] },
      '/api/admin/applications': { ok: true, total: 5, applications: [vagues, ...APPLICATIONS_LIST] },
      'PUT /api/admin/sessions/session-1': { ok: true, session: SESSION },
    })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    const picker = () => screen.getByRole('combobox', { name: 'Candidature' })
    expect(await screen.findByRole('combobox', { name: 'Candidature' })).toHaveValue('Reçue le 1 septembre 2026')
    fireEvent.click(picker())
    expect(options()).toEqual(['Aucune candidature', 'Reçue le 1 septembre 2026retenue · 14 nov. 2026, 21 nov. 2026'])
    fireEvent.keyDown(picker(), { key: 'Escape' })

    // Another collective says right away that the application isn't its, until one of its own is picked.
    const error = 'La candidature doit être celle du collectif du takeover : choisissez-en une autre, ou « Aucune candidature ».'
    fireEvent.click(screen.getByRole('combobox', { name: 'Collectif' }))
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Vagues/ }))
    expect(screen.getByText(error)).toBeInTheDocument()
    fireEvent.click(picker())
    expect(options()).toEqual(['Aucune candidature', 'Reçue le 1 septembre 2026retenue · 14 nov. 2026, 21 nov. 2026', 'Reçue le 10 septembre 2026nouvelle · 12 déc. 2026'])
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Reçue le 10 septembre 2026/ }))
    expect(screen.queryByText(error)).not.toBeInTheDocument()

    // Hidden with the collective for another type, and back with it.
    fireEvent.click(screen.getByRole('radio', { name: 'Guest mixes' }))
    expect(screen.queryByRole('combobox', { name: 'Candidature' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Takeover' }))
    expect(picker()).toHaveValue('Reçue le 10 septembre 2026')
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(sentSession(requestsTo('PUT', '/api/admin/sessions/session-1')[0])).toMatchObject({ type: 'takeover', takeover: 'collective-2', application: 'application-5' })
  })

  it("keeps the takeover's application when the applications could not be loaded, which it says, and lets it be removed", async () => {
    mockFetch({ ...PAGE, ...EVENTS, '/api/admin/collectives': { ok: true, collectives: [ONDES] }, '/api/admin/applications': { ok: false, error: 'Boom' } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Les candidatures n'ont pas pu être chargées : Boom")
    expect(screen.getByRole('combobox', { name: 'Candidature' })).toHaveValue('Reçue le 1 septembre 2026')
    fireEvent.click(screen.getByRole('combobox', { name: 'Candidature' }))
    expect(options()).toEqual(['Aucune candidature', 'Reçue le 1 septembre 2026'])
  })

  it('sends no application for another type than a takeover', async () => {
    mockFetch({ ...PAGE, ...COLLECTIVES, ...EVENTS, 'PUT /api/admin/sessions/session-1': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(await screen.findByRole('combobox', { name: 'Candidature' })).toHaveValue('Reçue le 1 septembre 2026')
    fireEvent.click(screen.getByRole('radio', { name: 'Guest mixes' }))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(sentSession(requestsTo('PUT', '/api/admin/sessions/session-1')[0])).toMatchObject({ type: 'guest-mixes', takeover: null, application: null })
  })

  it("shows « - » for a takeover's application when it has none", async () => {
    mockFetch({ ...PAGE, '/api/admin/sessions/session-1': { ok: true, session: { ...SESSION, application: null } } })
    renderAt('/admin/sessions/session-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'ONDES TAKEOVER' })).toBeInTheDocument()
    expect(value('Candidature')).toHaveTextContent(/^-$/)
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
    await screen.findByRole('group', { name: 'Début' })
    expect(timeInput('Début', 'heure')).toHaveValue('01:30')
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'AUTRE' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(sentSession(requestsTo('PUT', '/api/admin/sessions/session-1')[0])).toMatchObject({ start: '2026-11-01T01:30-05:00', durationMinutes: 120 })
  })

  it('keeps a session that ends at the second 1:30 of the night clocks fall back where it ends while its end is unchanged', async () => {
    // From midnight, in summer time, to 1:30 in winter time.
    const second = { ...SESSION, start: '2026-11-01T04:00:00.000Z', end: '2026-11-01T06:30:00.000Z', durationMinutes: 150, sets: [] }
    mockFetch({ ...LOGGED_IN, ...COLLECTIVES, ...EVENTS, '/api/admin/sessions/session-1': { ok: true, session: second }, 'PUT /api/admin/sessions/session-1': { ok: true, session: second } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    await screen.findByRole('group', { name: 'Début' })
    expect(timeInput('Fin', 'heure')).toHaveValue('01:30')
    expect(screen.getByRole('status')).toHaveTextContent(/^Dure 2 h 30\.$/)
    // Changing only the start's time doesn't move the end.
    fireEvent.change(timeInput('Début', 'heure'), { target: { value: '00:30' } })
    expect(screen.getByRole('status')).toHaveTextContent(/^Dure 2 h\.$/)
    fireEvent.change(timeInput('Début', 'heure'), { target: { value: '00:00' } })
    // Moving the start's day moves the end's, and moving it back finds the end as it opened.
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '2026-11-08' } })
    expect(timeInput('Fin', 'date')).toHaveValue('2026-11-08')
    expect(screen.getByRole('status')).toHaveTextContent(/^Dure 1 h 30\.$/)
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '2026-11-01' } })
    expect(screen.getByRole('status')).toHaveTextContent(/^Dure 2 h 30\.$/)
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(sentSession(requestsTo('PUT', '/api/admin/sessions/session-1')[0])).toMatchObject({ start: '2026-11-01T00:00-04:00', durationMinutes: 150 })
  })

  it('goes through the years a date field gives as a year is typed, saying what is wrong', async () => {
    mockFetch({ ...PAGE, ...COLLECTIVES, ...EVENTS })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    await screen.findByRole('group', { name: 'Début' })
    fireEvent.change(timeInput('Fin', 'date'), { target: { value: '0002-11-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(await screen.findByText('La fin doit être après le début.')).toBeInTheDocument()
    fireEvent.change(timeInput('Fin', 'date'), { target: { value: '2026-11-15' } })
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '0002-11-14' } })
    expect(await screen.findByText('Une session a lieu entre les années 2000 et 2999.')).toBeInTheDocument()
    expect(timeInput('Fin', 'date')).toHaveValue('0002-11-15')
    expect(requestsTo('PUT', '/api/admin/sessions/session-1')).toHaveLength(0)
  })

  it('moves an overnight session to another day, its end with it, and back', async () => {
    mockFetch({ ...PAGE, ...COLLECTIVES, ...EVENTS, 'PUT /api/admin/sessions/session-1': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    await screen.findByRole('group', { name: 'Début' })
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '2026-11-21' } })
    expect(timeInput('Fin', 'date')).toHaveValue('2026-11-22')
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '2026-11-14' } })
    expect(timeInput('Fin', 'date')).toHaveValue('2026-11-15')
    expect(screen.getByRole('status')).toHaveTextContent(/^Dure 4 h\.$/)
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '2026-11-21' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(sentSession(requestsTo('PUT', '/api/admin/sessions/session-1')[0])).toMatchObject({ start: '2026-11-21T21:00-05:00', durationMinutes: 240 })
  })

  it('says when its sets add up to more than the session, cancelled ones included, and no longer once one is deleted', async () => {
    // Until 23:00, with sets of 2 h 15, a cancelled one included, and one whose duration isn't known.
    const [first, , cancelled] = SESSION.sets
    const crowded: Session = {
      ...SESSION,
      end: '2026-11-15T04:00:00.000Z',
      durationMinutes: 120,
      sets: [
        first,
        studioSet('set-4', { performers: [{ id: 'artist-4', name: 'Dune' }], durationMinutes: 45 }),
        { ...cancelled, durationMinutes: 30 },
        studioSet('set-5', { performers: [{ id: 'artist-5', name: 'Écume' }] }),
      ],
    }
    const withoutDune = { ...crowded, sets: crowded.sets.filter((set) => set.id !== 'set-4') }
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-1': { ok: true, session: crowded }, 'DELETE /api/admin/sets/set-4': { ok: true, session: withoutDune } })
    renderAt('/admin/sessions/session-1')

    await screen.findByRole('table', { name: 'Sets' })
    expect(tooLong()).toBe('\u26a0\ufe0e Les sets durent 2 h 15, plus que la session (2 h).')
    expect(screen.getByRole('status')).toHaveClass('admin-warning')
    expect(rows(setsTable()).map((row) => row[0])).toEqual(['1 h', '45 min', '30 min', 'à déterminer'])

    // Without Dune's set, as the server then has the session.
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'supprimer : Set de Dune' }))
    await waitFor(() => expect(rows(setsTable())).toHaveLength(3))
    expect(tooLong()).toBeNull()
  })

  it('says nothing of its sets when they add up to no more than the session', async () => {
    mockFetch(PAGE)
    renderAt('/admin/sessions/session-1')
    await screen.findByRole('table', { name: 'Sets' })
    expect(tooLong()).toBeNull()
  })

  it('moves a set up or down among the sets, showing them as the server then has them, the focus staying on its arrow', async () => {
    const [first, cyan, cancelled] = SESSION.sets
    const session = (...sets: StudioSet[]): Session => ({ ...SESSION, sets })
    mockFetch({
      ...LOGGED_IN,
      '/api/admin/sessions/session-1': { ok: true, session: session(first, cyan, cancelled) },
      'PUT /api/admin/sets/set-3/position': { ok: true, session: session(first, cancelled, cyan) },
      'PUT /api/admin/sets/set-2/position': { ok: true, session: session(first, cyan, cancelled) },
      'PUT /api/admin/sets/set-1/position': { ok: false, error: 'Boom' },
    })
    renderAt('/admin/sessions/session-1')

    await screen.findByRole('table', { name: 'Sets' })
    expect(screen.getByRole('button', { name: 'monter : Set de Aurore et Brume' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'descendre : Set' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'monter : Set' }))
    await waitFor(() => expect(rows(setsTable()).map((row) => row[1])).toEqual(['Aurore, Brume', '-', 'Cyan']))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sets/set-3/position')[0])).toEqual({ position: 1 })
    expect(screen.getByRole('button', { name: 'monter : Set' })).toHaveFocus()

    // Moved back up, the focus staying on its arrow.
    fireEvent.click(screen.getByRole('button', { name: 'monter : Set de Cyan' }))
    await waitFor(() => expect(rows(setsTable()).map((row) => row[1])).toEqual(['Aurore, Brume', 'Cyan', '-']))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sets/set-2/position')[0])).toEqual({ position: 1 })
    expect(screen.getByRole('button', { name: 'monter : Set de Cyan' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'descendre : Set de Aurore et Brume' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Le set « Set de Aurore et Brume » n'a pas pu être déplacé : Boom$/)
    expect(rows(setsTable()).map((row) => row[1])).toEqual(['Aurore, Brume', 'Cyan', '-'])
  })

  it("has one form open at a time, the session's or a set's", async () => {
    mockFetch({ ...PAGE, ...COLLECTIVES, ...EVENTS, ...ARTISTS })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(await screen.findByLabelText('Nom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ajouter un set' }))
    expect(await screen.findByRole('heading', { name: 'Nouveau set' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Nom')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'modifier : Set de Cyan' }))
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
    // Once the start has its day and its time, the end is filled in, both its day and its time.
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '2026-11-14' } })
    expect(timeInput('Fin', 'date')).toHaveValue('2026-11-14')
    expect(timeInput('Fin', 'heure')).toHaveValue('')
    fireEvent.change(timeInput('Début', 'heure'), { target: { value: '21:00' } })
    expect(timeInput('Fin', 'date')).toHaveValue('2026-11-15')
    expect(timeInput('Fin', 'heure')).toHaveValue('00:00')
    expect(screen.getByRole('status')).toHaveTextContent(/^Dure 3 h\.$/)
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-2')).toHaveLength(1))
    expect(sentSession(requestsTo('PUT', '/api/admin/sessions/session-2')[0])).toEqual({
      start: '2026-11-14T21:00-05:00',
      durationMinutes: 180,
      type: 'guest-mixes',
      takeover: null,
      application: null,
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
    fireEvent.click(within(screen.getByRole('group', { name: 'Statut : Set de Aurore et Brume' })).getByRole('button', { name: 'annulé' }))
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

  // The hours and minutes of the set's duration in its form.
  const duration = () => within(screen.getByRole('group', { name: 'Durée' }))
  const durationValues = () => [duration().getByLabelText('heures'), duration().getByLabelText('minutes')].map((input) => (input as HTMLInputElement).value)

  it('adds a set after the others, for what is left of the session, with its performance types and its artists’ genres, and closes', async () => {
    const added = { ...SESSION, sets: [...SESSION.sets, studioSet('set-9', { performers: [{ id: 'artist-3', name: 'Cyan' }], durationMinutes: 30 })] }
    mockFetch({ ...SET_PAGE, 'POST /api/admin/sessions/session-1/sets': { ok: true, session: added } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    // Its sets last 3 h 30, the cancelled one included, which keeps its place: half an hour is left.
    expect(durationValues()).toEqual(['0', '30'])

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
      durationMinutes: 30,
      performanceTypes: ['dj'],
      otherPerformanceType: '',
      genres: ['house', 'techno', 'acid'],
      soundcloudTrack: null,
      youtubeVideo: null,
      application: null,
    })
  })

  it('shows the session as the server has it once a set is added, which can make it planifiée again', async () => {
    const played: Session = { ...SESSION, status: 'done', sets: [CYAN_SET, SESSION.sets[2]] }
    const reopened: Session = {
      ...played,
      status: 'planned',
      statusUpdatedBy: 'admin@example.com',
      statusUpdatedAt: '2026-11-15T04:00:00.000Z',
      sets: [...played.sets, studioSet('set-9', { performers: [{ id: 'artist-1', name: 'Aurore' }], durationMinutes: 30 })],
    }
    mockFetch({ ...SET_PAGE, '/api/admin/sessions/session-1': { ok: true, session: played }, 'POST /api/admin/sessions/session-1/sets': { ok: true, session: reopened } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    pick('Aurore')
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(rows(setsTable())).toHaveLength(3))
    expect(within(screen.getByRole('group', { name: 'Statut' })).getByRole('button', { name: 'planifiée' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('changes a set, its duration included, even when the sets then add up to more than the session', async () => {
    mockFetch({ ...SET_PAGE, 'PUT /api/admin/sets/set-2': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Cyan' }))
    await screen.findByRole('heading', { name: 'Set de Cyan' })
    expect(durationValues()).toEqual(['1', '30'])
    expect(screen.getByLabelText('Performance Live')).toBeChecked()
    expect(screen.getByLabelText('Autre')).toHaveValue('Synthé')
    expect(screen.getByRole('button', { name: 'retirer ambient' })).toBeInTheDocument()
    expect(screen.getByText(/^Ajouté par admin@example.com le/)).toBeInTheDocument()

    fireEvent.change(duration().getByLabelText('heures'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sets/set-2')).toHaveLength(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(jsonBody(requestsTo('PUT', '/api/admin/sets/set-2')[0])).toEqual({
      performers: [{ id: 'artist-3' }],
      durationMinutes: 330,
      performanceTypes: ['live-performance'],
      otherPerformanceType: 'Synthé',
      genres: ['ambient'],
      soundcloudTrack: null,
      youtubeVideo: null,
      // Sent back as it is.
      application: 'application-2',
    })
  })

  it('adds a set without a duration, or with one of more than a day, in a session without a date too', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/sessions/session-2': { ok: true, session: UNDATED }, 'POST /api/admin/sessions/session-2/sets': { ok: true, session: UNDATED } })
    renderAt('/admin/sessions/session-2')

    await openNew()
    // An hour of the 3 hours is left.
    expect(durationValues()).toEqual(['1', '0'])
    pick('Brume')
    fireEvent.change(duration().getByLabelText('heures'), { target: { value: '25' } })
    fireEvent.change(duration().getByLabelText('minutes'), { target: { value: '75' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    expect(await screen.findByText('La durée est invalide.')).toBeInTheDocument()
    expect(requestsTo('POST', '/api/admin/sessions/session-2/sets')).toHaveLength(0)
    fireEvent.change(duration().getByLabelText('minutes'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions/session-2/sets')).toHaveLength(1))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions/session-2/sets')[0])).toMatchObject({ durationMinutes: 1501 })
    await openNew()
    pick('Brume')

    fireEvent.change(duration().getByLabelText('heures'), { target: { value: '' } })
    fireEvent.change(duration().getByLabelText('minutes'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions/session-2/sets')).toHaveLength(2))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions/session-2/sets')[1])).toMatchObject({ durationMinutes: null })
  })

  it("starts without a duration when the session's sets fill it", async () => {
    const full = { ...SESSION, sets: [{ ...SET, durationMinutes: 240 }] }
    mockFetch({ ...SET_PAGE, '/api/admin/sessions/session-1': { ok: true, session: full } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    expect(durationValues()).toEqual(['', ''])
  })

  it("shows the server's error, linking to another session's set it names, but not to the session it's on", async () => {
    mockFetch({ ...SET_PAGE, 'POST /api/admin/sessions/session-1/sets': { ok: false, error: "This YouTube video is another set's", session: SESSIONS[2], set: SESSIONS[2].sets[0] } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    pick('Brume')
    fireEvent.change(screen.getByLabelText('YouTube'), { target: { value: 'dQw4w9WgXcQ' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    let alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Le set n'a pas pu être ajouté : This YouTube video is another set's (Set de Brume, SOIRÉE, ven. 2 oct. 2026)")
    expect(within(alert).getByRole('link')).toHaveAttribute('href', '/admin/sessions/session-3')

    // A set of this session is named without a link.
    mockFetch({ ...SET_PAGE, 'POST /api/admin/sessions/session-1/sets': { ok: false, error: "This YouTube video is another set's", session: SESSION, set: CYAN_SET } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/^Le set n'a pas pu être ajouté : This YouTube video is another set's \(Set de Cyan\)$/),
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

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set' }))
    await screen.findByRole('heading', { name: 'Set' })
    expect(durationValues()).toEqual(['1', '0'])
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(await screen.findByText('Choisissez au moins un artiste.')).toBeInTheDocument()
    expect(requestsTo('PUT', '/api/admin/sets/set-3')).toHaveLength(0)
  })

  it("deletes a set with the × of its row once confirmed, closing its form if it's open, or says why it couldn't", async () => {
    mockFetch({ ...SET_PAGE, 'DELETE /api/admin/sets/set-2': { ok: true, session: { ...SESSION, sets: [SET, SESSION.sets[2]] } } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Cyan' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Set de Cyan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /supprimer le set/ })).not.toBeInTheDocument()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'supprimer : Set de Cyan' }))
    expect(confirm).toHaveBeenLastCalledWith('Supprimer définitivement ce set (Set de Cyan) ?')
    expect(requestsTo('DELETE', '/api/admin/sets/set-2')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'supprimer : Set de Cyan' }))
    // The focus goes to the next set's ×, in the commit that removes the row. It's read in the waitFor that sees the row
    // gone, which runs right after React's DOM changes and layout effects but before its passive effects, since waiting
    // for the focus would also pass if it only moved later, leaving it on the page in between.
    let focused: Element | null = null
    await waitFor(() => {
      expect(rows(setsTable())).toHaveLength(2)
      focused = document.activeElement
    })
    expect(focused).toBe(screen.getByRole('button', { name: 'supprimer : Set' }))
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()

    mockFetch({ ...SET_PAGE, 'DELETE /api/admin/sets/set-3': { ok: false, error: 'Boom' } })
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'supprimer : Set' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Le set « Set » n'a pas pu être supprimé : Boom")
    expect(rows(setsTable())).toHaveLength(2)
  })

  it("moves the focus to the previous set's × once the last one is deleted, or to the heading once there are none", async () => {
    const two = { ...SESSION, sets: [SET, CYAN_SET] }
    mockFetch({
      ...SET_PAGE,
      '/api/admin/sessions/session-1': { ok: true, session: two },
      'DELETE /api/admin/sets/set-2': { ok: true, session: { ...two, sets: [SET] } },
      'DELETE /api/admin/sets/set-1': { ok: true, session: { ...two, sets: [] } },
    })
    renderAt('/admin/sessions/session-1')

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(await screen.findByRole('button', { name: 'supprimer : Set de Cyan' }))
    // Read as soon as the set is gone, as in the test above.
    let focused: Element | null = null
    await waitFor(() => {
      expect(rows(setsTable())).toHaveLength(1)
      focused = document.activeElement
    })
    expect(focused).toBe(screen.getByRole('button', { name: 'supprimer : Set de Aurore et Brume' }))
    fireEvent.click(screen.getByRole('button', { name: 'supprimer : Set de Aurore et Brume' }))
    await waitFor(() => {
      expect(screen.getByText('Aucun set.')).toBeInTheDocument()
      focused = document.activeElement
    })
    expect(focused).toBe(screen.getByRole('heading', { level: 2, name: 'Sets' }))
  })

  it('shows the session as the server has it once a set is deleted, which can make it jouée', async () => {
    const [, cyan, cancelled] = SESSION.sets
    const played = { ...SESSION, status: 'done' as const, statusUpdatedBy: 'admin@example.com', statusUpdatedAt: '2026-11-15T04:00:00.000Z', sets: [cyan, cancelled] }
    mockFetch({ ...SET_PAGE, 'DELETE /api/admin/sets/set-1': { ok: true, session: played } })
    renderAt('/admin/sessions/session-1')

    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    fireEvent.click(await screen.findByRole('button', { name: 'supprimer : Set de Aurore et Brume' }))
    await waitFor(() => expect(rows(setsTable())).toHaveLength(2))
    expect(within(screen.getByRole('group', { name: 'Statut' })).getByRole('button', { name: 'jouée' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/^Statut changé par admin@example.com le/)).toBeInTheDocument()
  })

  it("closes the form of a set opened while it's being deleted, rather than showing a new set's", async () => {
    mockFetch({ ...SET_PAGE, 'DELETE /api/admin/sets/set-2': { ok: true, session: { ...SESSION, sets: [SET, SESSION.sets[2]] } } })
    renderAt('/admin/sessions/session-1')

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(await screen.findByRole('button', { name: 'supprimer : Set de Cyan' }))
    fireEvent.click(screen.getByRole('button', { name: 'modifier : Set de Cyan' }))
    await waitFor(() => expect(rows(setsTable())).toHaveLength(2))
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
  })

  // As the page shows it, with its non-breaking spaces as spaces.
  const SET_ERROR = "La candidature doit être celle d'un des artistes du set : choisissez-en une autre, ou « Aucune candidature »."
  const applicationPicker = () => screen.getByRole('combobox', { name: 'Candidature' })

  it("picks the set's application among its performers', which it says right away once it isn't one of theirs anymore", async () => {
    mockFetch({ ...SET_PAGE, 'PUT /api/admin/sets/set-1': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Aurore et Brume' }))
    expect(await screen.findByRole('heading', { name: 'Set de Aurore et Brume' })).toBeInTheDocument()
    expect(applicationPicker()).toHaveValue('Aucune candidature')
    fireEvent.click(applicationPicker())
    // Its performers', in their order, each named by its artist and when it was received, with its status and dates.
    expect(options()).toEqual([
      'Aucune candidature',
      'Aurore, reçue le 15 août 2026nouvelle · 14 nov. 2026, 21 nov. 2026, 28 nov. 2026 (+1)',
      'Brume, reçue le 20 août 2026retenue · 5 déc. 2026',
    ])
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Aurore, reçue le 15 août 2026/ }))
    expect(applicationPicker()).toHaveValue('Aurore, reçue le 15 août 2026')

    // Taking Aurore out of the set says so before the form is sent, and keeps the application among the options.
    fireEvent.click(screen.getByRole('button', { name: 'retirer Aurore' }))
    expect(screen.getByText(SET_ERROR)).toBeInTheDocument()
    expect(applicationPicker()).toHaveValue('Aurore, reçue le 15 août 2026')
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(requestsTo('PUT', '/api/admin/sets/set-1')).toHaveLength(0)
    // Adding her back makes it right again.
    pick('Aurore')
    expect(screen.queryByText(SET_ERROR)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sets/set-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sets/set-1')[0])).toMatchObject({ performers: [{ id: 'artist-2' }, { id: 'artist-1' }], application: 'application-3' })
  })

  it('says when there is no application to pick, before it has performers, or when they have none', async () => {
    const onlyBrumes = APPLICATIONS_LIST.filter((application) => application.artistId === 'artist-2')
    mockFetch({ ...SET_PAGE, '/api/admin/applications': { ok: true, total: 1, applications: onlyBrumes } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    expect(applicationPicker()).toHaveValue('')
    expect(applicationPicker()).toHaveAttribute('placeholder', "Choisissez d'abord les artistes.")
    pick('Aurore')
    expect(applicationPicker()).toHaveValue('')
    expect(applicationPicker()).toHaveAttribute('placeholder', 'Aucune candidature de cet artiste.')
    pick('Cyan')
    expect(applicationPicker()).toHaveAttribute('placeholder', 'Aucune candidature de ces artistes.')
    pick('Brume')
    expect(applicationPicker()).toHaveValue('Aucune candidature')
  })

  it('offers no application but none to a set without one when the applications could not be loaded', async () => {
    mockFetch({ ...PAGE, ...ARTISTS, '/api/admin/applications': { ok: false, error: 'Boom' } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    expect(screen.getByRole('alert')).toHaveTextContent("Les candidatures n'ont pas pu être chargées : Boom")
    pick('Aurore')
    // Rather than saying that Aurore has none, which the form doesn't know.
    expect(applicationPicker()).toHaveValue('Aucune candidature')
    fireEvent.click(applicationPicker())
    expect(options()).toEqual(['Aucune candidature'])
  })

  it("keeps the set's application when the applications could not be loaded, which it says, and lets it be removed", async () => {
    mockFetch({ ...PAGE, ...ARTISTS, '/api/admin/applications': { ok: false, error: 'Boom' }, 'PUT /api/admin/sets/set-2': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Cyan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Les candidatures n'ont pas pu être chargées : Boom")
    // Named by when it was received only, since whose it is isn't known.
    expect(applicationPicker()).toHaveValue('Reçue le 2 septembre 2026')
    fireEvent.click(applicationPicker())
    expect(options()).toEqual(['Aucune candidature', 'Reçue le 2 septembre 2026'])
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Aucune candidature' }))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sets/set-2')).toHaveLength(1))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sets/set-2')[0])).toMatchObject({ application: null })
  })

  it('says when the artists could not be loaded', async () => {
    mockFetch({ ...PAGE, ...APPLICATIONS, '/api/admin/artists': { ok: false, error: 'Boom' } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom")
    expect(screen.getByRole('combobox', { name: 'Ajouter un artiste' })).toBeDisabled()
  })
})

// Fills a new session's form in, from 21:00 on Saturday, November 14, 2026, to 1:00 the next day, as guest mixes, unless
// it's told otherwise.
async function fillIn({ day = '2026-11-14', start = '21:00', endDay = '2026-11-15', end = '01:00', type = 'Guest mixes' as string | null } = {}) {
  await screen.findByRole('group', { name: 'Début' })
  fireEvent.change(timeInput('Début', 'date'), { target: { value: day } })
  fireEvent.change(timeInput('Début', 'heure'), { target: { value: start } })
  fireEvent.change(timeInput('Fin', 'date'), { target: { value: endDay } })
  fireEvent.change(timeInput('Fin', 'heure'), { target: { value: end } })
  if (type) fireEvent.click(screen.getByRole('radio', { name: type }))
}

describe('Adding a session', () => {
  const NEW = { ...LOGGED_IN, ...COLLECTIVES, ...EVENTS }

  it('adds a session, from its start to its end, each a day and a time, and goes to its page', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')

    await fillIn()
    expect(screen.getByRole('status')).toHaveTextContent(/^Dure 4 h\.$/)
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: '  HAUTE   RIVE ' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\/session-1$/))
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toEqual({
      start: '2026-11-14T21:00-05:00',
      durationMinutes: 240,
      type: 'guest-mixes',
      takeover: null,
      application: null,
      name: 'HAUTE RIVE',
      raEvent: null,
      description: '',
      sets: [],
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

    await fillIn({ start: '20:00', endDay: '2026-11-14', end: '23:30' })
    fireEvent.click(screen.getByLabelText('date à déterminer'))
    const duration = within(screen.getByRole('group', { name: 'Durée' }))
    expect(duration.getByLabelText('heures')).toHaveValue(3)
    expect(duration.getByLabelText('minutes')).toHaveValue(30)
    expect(screen.queryByRole('group', { name: 'Début' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))

    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ start: null, durationMinutes: 210 })
  })

  it('needs the duration of a session without a date, which can be more than a day', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: UNDATED } })
    renderAt('/admin/sessions/nouvelle')

    fireEvent.click(await screen.findByLabelText('date à déterminer'))
    fireEvent.click(screen.getByRole('radio', { name: 'Guest mixes' }))
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    expect(await screen.findByText('Indiquez la durée de la session.')).toBeInTheDocument()
    fireEvent.change(within(screen.getByRole('group', { name: 'Durée' })).getByLabelText('heures'), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ start: null, durationMinutes: 9000 })
  })

  it("fills the end in from the duration once the start's time, then its day, are entered after un-checking « date à déterminer »", async () => {
    mockFetch(NEW)
    renderAt('/admin/sessions/nouvelle')

    fireEvent.click(await screen.findByLabelText('date à déterminer'))
    fireEvent.change(within(screen.getByRole('group', { name: 'Durée' })).getByLabelText('heures'), { target: { value: '2' } })
    fireEvent.change(within(screen.getByRole('group', { name: 'Durée' })).getByLabelText('minutes'), { target: { value: '30' } })
    fireEvent.click(screen.getByLabelText('date à déterminer'))
    fireEvent.change(timeInput('Début', 'heure'), { target: { value: '23:00' } })
    expect(timeInput('Fin', 'heure')).toHaveValue('')
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '2026-11-14' } })
    expect(timeInput('Fin', 'date')).toHaveValue('2026-11-15')
    expect(timeInput('Fin', 'heure')).toHaveValue('01:30')
    expect(screen.getByRole('status')).toHaveTextContent(/^Dure 2 h 30\.$/)
  })

  it('adds a session that lasts several days', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')

    await fillIn({ day: '2026-11-13', start: '18:00', endDay: '2026-11-15', end: '02:00' })
    expect(screen.getByRole('status')).toHaveTextContent(/^Dure 32 h\.$/)
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ start: '2026-11-13T18:00-05:00', durationMinutes: 1920 })
  })

  it("refuses an end that isn't after the start, rather than moving it to the next day", async () => {
    mockFetch(NEW)
    renderAt('/admin/sessions/nouvelle')

    await fillIn({ endDay: '2026-11-14' })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    expect(await screen.findByText('La fin doit être après le début.')).toBeInTheDocument()
    expect(timeInput('Fin', 'heure')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(0)
  })

  it("gives the end the start's day, then keeps its distance in days from it, even when the start's day is cleared on the way", async () => {
    mockFetch(NEW)
    renderAt('/admin/sessions/nouvelle')

    await screen.findByRole('group', { name: 'Début' })
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '2026-11-14' } })
    expect(timeInput('Fin', 'date')).toHaveValue('2026-11-14')
    // Changed by hand, it keeps that distance.
    fireEvent.change(timeInput('Fin', 'date'), { target: { value: '2026-11-16' } })
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '2026-11-20' } })
    expect(timeInput('Fin', 'date')).toHaveValue('2026-11-22')
    // As browsers do while a day is typed.
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '' } })
    expect(timeInput('Fin', 'date')).toHaveValue('2026-11-22')
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '2026-11-02' } })
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '2026-11-27' } })
    expect(timeInput('Fin', 'date')).toHaveValue('2026-11-29')
  })

  it("refuses a time that the clocks skip, at the start or at the end", async () => {
    mockFetch(NEW)
    renderAt('/admin/sessions/nouvelle')

    const skipped = "Cette heure n'existe pas cette nuit-là, au passage à l'heure d'été."
    await fillIn({ day: '2026-03-08', start: '02:30', endDay: '2026-03-08', end: '04:00' })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    expect(await screen.findByText(skipped)).toBeInTheDocument()
    expect(timeInput('Début', 'heure')).toHaveAttribute('aria-invalid', 'true')

    await fillIn({ day: '2026-03-07', start: '23:00', endDay: '2026-03-08', end: '02:30' })
    expect(await screen.findByText(skipped)).toBeInTheDocument()
    expect(timeInput('Fin', 'heure')).toHaveAttribute('aria-invalid', 'true')
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
    // Its application is picked among the collective's.
    expect(screen.getByRole('combobox', { name: 'Candidature' })).toHaveValue('Aucune candidature')
    fireEvent.click(screen.getByRole('combobox', { name: 'Candidature' }))
    expect(options()).toEqual(['Aucune candidature', 'Reçue le 1 septembre 2026retenue · 14 nov. 2026, 21 nov. 2026'])
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Reçue le 1 septembre 2026/ }))
    await fillIn({ type: null })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ type: 'takeover', takeover: 'collective-1', application: 'application-1' })
    first.unmount()

    renderAt('/admin/sessions/nouvelle?takeover=unknown')
    expect(await screen.findByRole('radio', { name: 'Takeover' })).not.toBeChecked()
    expect(screen.queryByRole('combobox', { name: 'Collectif' })).not.toBeInTheDocument()
  })

  it("says when there is no application to pick, before the takeover's collective is picked, or when it has none", async () => {
    const VAGUES: Collective = { ...ONDES, id: 'collective-2', name: 'Vagues', email: 'vagues@example.com' }
    mockFetch({ ...NEW, '/api/admin/collectives': { ok: true, collectives: [ONDES, VAGUES] } })
    renderAt('/admin/sessions/nouvelle')

    fireEvent.click(await screen.findByRole('radio', { name: 'Takeover' }))
    const picker = screen.getByRole('combobox', { name: 'Candidature' })
    expect(picker).toHaveValue('')
    expect(picker).toHaveAttribute('placeholder', "Choisissez d'abord le collectif.")
    fireEvent.click(screen.getByRole('combobox', { name: 'Collectif' }))
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Vagues/ }))
    expect(picker).toHaveValue('')
    expect(picker).toHaveAttribute('placeholder', 'Aucune candidature de ce collectif.')
  })

  it('offers no application but none when the applications could not be loaded, which it says', async () => {
    mockFetch({ ...NEW, '/api/admin/applications': { ok: false, error: 'Boom' } })
    renderAt('/admin/sessions/nouvelle?takeover=collective-1')

    expect(await screen.findByRole('alert')).toHaveTextContent("Les candidatures n'ont pas pu être chargées : Boom")
    // Rather than saying that the collective has none, which the form doesn't know.
    expect(screen.getByRole('combobox', { name: 'Candidature' })).toHaveValue('Aucune candidature')
    fireEvent.click(screen.getByRole('combobox', { name: 'Candidature' }))
    expect(options()).toEqual(['Aucune candidature'])
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

describe("A new session's sets", () => {
  const NEW = { ...LOGGED_IN, ...COLLECTIVES, ...EVENTS, ...ARTISTS }

  // The open set's form, under its title.
  const setForm = (title: string) => within(screen.getByRole('region', { name: title }))

  // Adds a set of `performer` in a new set's form, at the times it starts with, unless `fill` changes them, or other
  // fields.
  async function addSet(performer: string, fill: (form: ReturnType<typeof setForm>) => void = () => {}) {
    fireEvent.click(screen.getByRole('button', { name: 'ajouter un set' }))
    await screen.findByRole('heading', { name: 'Nouveau set' })
    const form = setForm('Nouveau set')
    fireEvent.click(form.getByRole('combobox', { name: 'Ajouter un artiste' }))
    fireEvent.mouseDown(form.getByRole('option', { name: new RegExp(`^${performer}`) }))
    fill(form)
    fireEvent.click(form.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Nouveau set' })).not.toBeInTheDocument())
  }

  const setsTable = () => screen.getByRole('table', { name: 'Sets' })

  // The hours and minutes of the duration in the set's form `form`.
  const durationIn = (form: ReturnType<typeof setForm>) =>
    within(form.getByRole('group', { name: 'Durée' }))
      .getAllByRole('spinbutton')
      .map((input) => (input as HTMLInputElement).value)
  const lasting = (hours: string, minutes: string) => (form: ReturnType<typeof setForm>) => {
    const group = within(form.getByRole('group', { name: 'Durée' }))
    fireEvent.change(group.getByLabelText('heures'), { target: { value: hours } })
    fireEvent.change(group.getByLabelText('minutes'), { target: { value: minutes } })
  }

  it('lists sets in the order they are added, which the arrows change, and sends them with the session in that order', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')

    await fillIn()
    expect(screen.getByText('Aucun set.')).toBeInTheDocument()
    await addSet('Brume', lasting('1', '30'))
    // An hour, since 2 h 30 of the 4 hours are left.
    fireEvent.click(screen.getByRole('button', { name: 'ajouter un set' }))
    await screen.findByRole('heading', { name: 'Nouveau set' })
    expect(durationIn(setForm('Nouveau set'))).toEqual(['1', '0'])
    fireEvent.click(setForm('Nouveau set').getByRole('button', { name: 'annuler' }))
    await addSet('Cyan')
    await addSet('Aurore', (form) => {
      lasting('', '')(form)
      fireEvent.change(form.getByLabelText('YouTube'), { target: { value: 'dQw4w9WgXcQ' } })
    })

    expect(rows(setsTable()).map((row) => row.slice(0, 2))).toEqual([
      ['1 h 30', 'Brume'],
      ['1 h', 'Cyan'],
      ['à déterminer', 'Aurore'],
    ])
    expect(within(setsTable()).getByRole('link', { name: 'YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')

    fireEvent.click(screen.getByRole('button', { name: 'modifier : Set de Brume' }))
    await screen.findByRole('heading', { name: 'Set de Brume' })
    expect(durationIn(setForm('Set de Brume'))).toEqual(['1', '30'])
    lasting('1', '0')(setForm('Set de Brume'))
    fireEvent.click(setForm('Set de Brume').getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Set de Brume' })).not.toBeInTheDocument())
    expect(rows(setsTable())[0][0]).toBe('1 h')

    // Moved down, twice, the focus staying on its arrow, or going to the other one once it's last.
    expect(screen.getByRole('button', { name: 'monter : Set de Brume' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'descendre : Set de Aurore' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'descendre : Set de Brume' }))
    expect(rows(setsTable()).map((row) => row[1])).toEqual(['Cyan', 'Brume', 'Aurore'])
    expect(screen.getByRole('button', { name: 'descendre : Set de Brume' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'descendre : Set de Brume' }))
    expect(rows(setsTable()).map((row) => row[1])).toEqual(['Cyan', 'Aurore', 'Brume'])
    expect(screen.getByRole('button', { name: 'monter : Set de Brume' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'retirer : Set de Cyan' }))
    expect(rows(setsTable()).map((row) => row[1])).toEqual(['Aurore', 'Brume'])

    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\/session-1$/))
    const empty = { performanceTypes: [], otherPerformanceType: '', genres: [], soundcloudTrack: null, application: null }
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0]).sets).toEqual([
      { ...empty, performers: [{ id: 'artist-1' }], durationMinutes: null, youtubeVideo: 'dQw4w9WgXcQ' },
      { ...empty, performers: [{ id: 'artist-2' }], durationMinutes: 60, youtubeVideo: null },
    ])
  })

  it('says when its sets add up to more than the session, once its times are known', async () => {
    mockFetch(NEW)
    renderAt('/admin/sessions/nouvelle')

    await fillIn()
    await addSet('Aurore', lasting('3', '30'))
    expect(tooLong()).toBeNull()
    await addSet('Brume', lasting('1', '0'))
    expect(tooLong()).toBe('\u26a0\ufe0e Les sets durent 4 h 30, plus que la session (4 h).')
    // Longer, until 2:00.
    fireEvent.change(timeInput('Fin', 'heure'), { target: { value: '02:00' } })
    expect(tooLong()).toBeNull()
    fireEvent.change(timeInput('Fin', 'heure'), { target: { value: '01:00' } })
    expect(tooLong()).not.toBeNull()
    // Nothing while they aren't.
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '' } })
    expect(tooLong()).toBeNull()
  })

  it("lists sets before the session's times are known, for an hour by default, then for what's left of the session", async () => {
    mockFetch(NEW)
    renderAt('/admin/sessions/nouvelle')

    fireEvent.click(await screen.findByRole('button', { name: 'ajouter un set' }))
    await screen.findByRole('heading', { name: 'Nouveau set' })
    expect(durationIn(setForm('Nouveau set'))).toEqual(['1', '0'])
    // The form keeps what it opened with once the session's times are known.
    await fillIn()
    expect(durationIn(setForm('Nouveau set'))).toEqual(['1', '0'])
    fireEvent.click(setForm('Nouveau set').getByRole('button', { name: 'annuler' }))

    await addSet('Aurore', lasting('3', '30'))
    fireEvent.click(screen.getByRole('button', { name: 'ajouter un set' }))
    await screen.findByRole('heading', { name: 'Nouveau set' })
    expect(durationIn(setForm('Nouveau set'))).toEqual(['0', '30'])
    fireEvent.click(setForm('Nouveau set').getByRole('button', { name: 'annuler' }))

    // Not valid anymore: they can still be changed.
    fireEvent.change(timeInput('Début', 'date'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'modifier : Set de Aurore' }))
    await screen.findByRole('heading', { name: 'Set de Aurore' })
    expect(durationIn(setForm('Set de Aurore'))).toEqual(['3', '30'])
    // Without a hint under its duration.
    expect(setForm('Set de Aurore').queryByText(/La session dure|La durée de la session|Laissez vide/)).not.toBeInTheDocument()
  })

  it("can't be sent with a set's form open, which it says", async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')

    await fillIn()
    await addSet('Aurore')
    const submit = screen.getByRole('button', { name: 'ajouter la session' })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter un set' }))
    await screen.findByRole('heading', { name: 'Nouveau set' })
    expect(submit).toHaveAttribute('aria-disabled', 'true')
    expect(submit).toHaveAccessibleDescription("Ajoutez d'abord le set, ou annulez-le.")
    fireEvent.click(screen.getByRole('button', { name: 'modifier : Set de Aurore' }))
    await screen.findByRole('heading', { name: 'Set de Aurore' })
    expect(submit).toHaveAccessibleDescription("Enregistrez d'abord le set, ou annulez-le.")
    fireEvent.click(submit)
    expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(0)

    fireEvent.click(setForm('Set de Aurore').getByRole('button', { name: 'annuler' }))
    expect(submit).not.toHaveAttribute('aria-disabled')
    fireEvent.click(submit)
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
  })

  it("keeps what's changed in a set's form when another set is taken out of the list, and moves the focus to the next set's ×", async () => {
    mockFetch(NEW)
    renderAt('/admin/sessions/nouvelle')

    await fillIn()
    await addSet('Aurore')
    await addSet('Brume')
    await addSet('Cyan')
    fireEvent.click(screen.getByRole('button', { name: 'modifier : Set de Brume' }))
    await screen.findByRole('heading', { name: 'Set de Brume' })
    lasting('1', '30')(setForm('Set de Brume'))

    // Aurore's, before it in the list: the focus goes to the next set's ×.
    fireEvent.click(screen.getByRole('button', { name: 'retirer : Set de Aurore' }))
    expect(screen.getByRole('button', { name: 'retirer : Set de Brume' })).toHaveFocus()
    expect(durationIn(setForm('Set de Brume'))).toEqual(['1', '30'])
    fireEvent.click(setForm('Set de Brume').getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Set de Brume' })).not.toBeInTheDocument())
    expect(rows(setsTable()).map((row) => row.slice(0, 2))).toEqual([
      ['1 h 30', 'Brume'],
      ['1 h', 'Cyan'],
    ])

    // The last one's: the previous set's ×, then the heading of the sets once there are none.
    fireEvent.click(screen.getByRole('button', { name: 'retirer : Set de Cyan' }))
    expect(screen.getByRole('button', { name: 'retirer : Set de Brume' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'retirer : Set de Brume' }))
    expect(screen.getByRole('heading', { name: 'Sets' })).toHaveFocus()
    expect(screen.getByText('Aucun set.')).toBeInTheDocument()
  })

  it('opens the pages its sets link to in a new tab, so that the form is not left', async () => {
    mockFetch(NEW)
    renderAt('/admin/sessions/nouvelle')

    await fillIn()
    await addSet('Aurore', (form) => {
      fireEvent.click(form.getByRole('combobox', { name: 'Candidature' }))
      fireEvent.mouseDown(form.getByRole('option', { name: /^Aurore, reçue le 15 août 2026/ }))
    })
    for (const name of ['Aurore', 'Candidature reçue le 15 août 2026']) {
      expect(within(setsTable()).getByRole('link', { name })).toHaveAttribute('target', '_blank')
    }
  })

  it("can't be changed while the session is sent", async () => {
    let answer: (value: Response) => void = () => {}
    mockFetch(NEW)
    const answered = vi.mocked(fetch).getMockImplementation()!
    // The session is sent until it's answered.
    vi.mocked(fetch).mockImplementation((input, options) =>
      (input instanceof Request ? input.method : options?.method) === 'POST' ? new Promise((resolve) => (answer = resolve)) : answered(input, options),
    )
    renderAt('/admin/sessions/nouvelle')

    await fillIn()
    await addSet('Aurore')
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'ajouter un set' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'modifier : Set de Aurore' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'retirer : Set de Aurore' })).toBeDisabled()
    answer(Response.json({ ok: false, error: 'Boom' }, { status: 500 }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'ajouter un set' })).toBeEnabled())
  })

  it("names the set the server refuses, and what's in the way, another session's set, linked, or another of the sets", async () => {
    const refusing = (error: object) => mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: false, ...error } })
    refusing({ error: "This YouTube video is another set's", session: null, set: null, setIndex: 1, otherSetIndex: 0 })
    renderAt('/admin/sessions/nouvelle')

    await fillIn()
    await addSet('Aurore')
    await addSet('Brume')
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    let alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Le set de Brume n'a pas pu être ajouté : This YouTube video is another set's \(Set de Aurore\)$/)
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument()

    refusing({ error: "This YouTube video is another set's", session: SESSIONS[2], set: SESSIONS[2].sets[0], setIndex: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Le set de Aurore n'a pas pu être ajouté : This YouTube video is another set's (Set de Brume, SOIRÉE, ven. 2 oct. 2026)",
      ),
    )
    alert = screen.getByRole('alert')
    expect(within(alert).getByRole('link')).toHaveAttribute('href', '/admin/sessions/session-3')

    refusing({ error: 'No such artist', setIndex: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^Le set de Brume n'a pas pu être ajouté : No such artist$/))

    // About the session itself.
    refusing({ error: 'Another session overlaps this one', session: SESSIONS[2], set: null })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^La session n'a pas pu être ajoutée : Another session overlaps this one \(SOIRÉE/))
  })
})

describe('From an application', () => {
  // Aurore's, with something else she'd do.
  const AURORES = { ...APPLICATIONS_LIST[3], performanceTypes: ['dj', 'vinyl'], otherPerformanceType: 'Synthé', timeSlots: [{ start: '18:00', end: '22:00' }] } satisfies Application
  const LIST = APPLICATIONS_LIST.map((application) => (application.id === AURORES.id ? AURORES : application))
  const WITH_AURORES = { ...ARTISTS, '/api/admin/applications': { ok: true, total: LIST.length, applications: LIST } }
  const path = () => screen.getByTestId('path')
  const newSet = () => within(screen.getByRole('region', { name: 'Nouveau set' }))

  describe("on a session's page", () => {
    const SET_PAGE = { ...PAGE, ...WITH_AURORES }

    it('opens a new set filled in from it, for what is left of the session, focused, and removes it from the address once saved', async () => {
      const added = { ...SESSION, sets: [...SESSION.sets, studioSet('set-9', { performers: [{ id: 'artist-1', name: 'Aurore' }], durationMinutes: 30 })] }
      mockFetch({ ...SET_PAGE, 'POST /api/admin/sessions/session-1/sets': { ok: true, session: added } })
      renderAt('/admin/sessions/session-1?application=application-3')

      expect(await screen.findByRole('heading', { name: 'Nouveau set' })).toHaveFocus()
      expect(newSet().getByRole('button', { name: 'retirer Aurore' })).toBeInTheDocument()
      expect(newSet().getByRole('combobox', { name: 'Candidature' })).toHaveValue('Aurore, reçue le 15 août 2026')
      expect(newSet().getByLabelText('DJ')).toBeChecked()
      expect(newSet().getByLabelText('Vinyl')).toBeChecked()
      expect(within(newSet().getByRole('group', { name: 'Durée' })).getByLabelText('minutes')).toHaveValue(30)
      fireEvent.click(newSet().getByRole('button', { name: 'ajouter le set' }))

      await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions/session-1/sets')).toHaveLength(1))
      expect(jsonBody(requestsTo('POST', '/api/admin/sessions/session-1/sets')[0])).toEqual({
        performers: [{ id: 'artist-1' }],
        durationMinutes: 30,
        performanceTypes: ['dj', 'vinyl'],
        otherPerformanceType: 'Synthé',
        genres: [],
        soundcloudTrack: null,
        youtubeVideo: null,
        application: 'application-3',
      })
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Nouveau set' })).not.toBeInTheDocument())
      expect(path()).toHaveTextContent(/^\/admin\/sessions\/session-1$/)
    })

    it('removes it from the address once the form is cancelled, or another one opens, which starts empty', async () => {
      mockFetch(SET_PAGE)
      const first = renderAt('/admin/sessions/session-1?application=application-3&raEvent=x')
      await screen.findByRole('heading', { name: 'Nouveau set' })
      fireEvent.click(newSet().getByRole('button', { name: 'annuler' }))
      expect(screen.queryByRole('heading', { name: 'Nouveau set' })).not.toBeInTheDocument()
      expect(path()).toHaveTextContent(/^\/admin\/sessions\/session-1$/)
      first.unmount()

      renderAt('/admin/sessions/session-1?application=application-3')
      await screen.findByRole('heading', { name: 'Nouveau set' })
      fireEvent.click(screen.getByRole('button', { name: 'ajouter un set' }))
      expect(path()).toHaveTextContent(/^\/admin\/sessions\/session-1$/)
      await waitFor(() => expect(newSet().getByRole('combobox', { name: 'Candidature' })).toHaveValue(''))
      expect(newSet().queryByRole('button', { name: 'retirer Aurore' })).not.toBeInTheDocument()
    })

    it("opens nothing for an application that doesn't exist, or a collective's, or in a cancelled session", async () => {
      mockFetch(SET_PAGE)
      for (const application of ['unknown', 'application-1']) {
        const page = renderAt(`/admin/sessions/session-1?application=${application}`)
        await waitFor(() => expect(requestsTo('GET', '/api/admin/applications').length).toBeGreaterThan(0))
        await screen.findByRole('heading', { name: 'Sets' })
        expect(screen.queryByRole('heading', { name: 'Nouveau set' })).not.toBeInTheDocument()
        page.unmount()
        vi.mocked(fetch).mockClear()
      }

      mockFetch({ ...SET_PAGE, '/api/admin/sessions/session-1': { ok: true, session: { ...SESSION, status: 'cancelled' } } })
      renderAt('/admin/sessions/session-1?application=application-3')
      await screen.findByRole('heading', { name: 'Sets' })
      expect(screen.queryByRole('heading', { name: 'Nouveau set' })).not.toBeInTheDocument()
      expect(requestsTo('GET', '/api/admin/applications')).toHaveLength(0)
    })

    it('opens a new set without it when the applications could not be loaded, which it says', async () => {
      mockFetch({ ...SET_PAGE, '/api/admin/applications': { ok: false, error: 'Boom' } })
      renderAt('/admin/sessions/session-1?application=application-3')

      expect(await screen.findByRole('heading', { name: 'Nouveau set' })).toHaveFocus()
      expect(screen.getByRole('alert')).toHaveTextContent("Les candidatures n'ont pas pu être chargées : Boom")
      expect(newSet().queryByRole('button', { name: 'retirer Aurore' })).not.toBeInTheDocument()
    })
  })

  describe('on "nouvelle session"', () => {
    const NEW = { ...LOGGED_IN, ...COLLECTIVES, ...EVENTS, ...WITH_AURORES }
    const reminder = () => within(screen.getByRole('region', { name: 'Candidature' }))

    it("lists a set filled in from an artist's application, whose duration isn't known, under when the artist would like to play", async () => {
      mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
      renderAt('/admin/sessions/nouvelle?application=application-3')

      expect(await screen.findByRole('link', { name: 'Reçue le 15 août 2026' })).toHaveAttribute('href', '/admin/candidatures/application-3')
      expect(reminder().getByRole('link')).toHaveAttribute('target', '_blank')
      expect(reminder().getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'samedi 14 novembre 2026',
        'samedi 21 novembre 2026',
        'samedi 28 novembre 2026',
        'samedi 5 décembre 2026',
      ])
      expect(reminder().getByText('18:00 à 22:00')).toBeInTheDocument()
      // Which doesn't fill in the session's times.
      expect(timeInput('Début', 'date')).toHaveValue('')
      expect(timeInput('Début', 'heure')).toHaveValue('')
      expect(rows(screen.getByRole('table', { name: 'Sets' })).map((row) => row.slice(0, 3))).toEqual([['à déterminer', 'Aurore', 'DJ, Vinyl, autre : Synthé']])
      expect(requestsTo('GET', '/api/admin/applications')).toHaveLength(1)

      await fillIn()
      fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
      await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
      expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({
        type: 'guest-mixes',
        application: null,
        sets: [
          {
            performers: [{ id: 'artist-1' }],
            durationMinutes: null,
            performanceTypes: ['dj', 'vinyl'],
            otherPerformanceType: 'Synthé',
            genres: [],
            soundcloudTrack: null,
            youtubeVideo: null,
            application: 'application-3',
          },
        ],
      })
    })

    it('changes the set it lists, or takes it out of the list, like any other', async () => {
      mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
      renderAt('/admin/sessions/nouvelle?application=application-3')

      await fillIn()
      fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Aurore' }))
      await screen.findByRole('heading', { name: 'Set de Aurore' })
      const form = within(screen.getByRole('region', { name: 'Set de Aurore' }))
      expect(within(form.getByRole('group', { name: 'Durée' })).getByLabelText('heures')).toHaveValue(null)
      expect(form.getByRole('combobox', { name: 'Candidature' })).toHaveValue('Aurore, reçue le 15 août 2026')
      fireEvent.change(form.getByLabelText('YouTube'), { target: { value: 'dQw4w9WgXcQ' } })
      fireEvent.click(form.getByRole('button', { name: 'enregistrer' }))
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Set de Aurore' })).not.toBeInTheDocument())
      const table = screen.getByRole('table', { name: 'Sets' })
      expect(rows(table)).toHaveLength(1)
      expect(within(table).getByRole('link', { name: 'YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')

      fireEvent.click(screen.getByRole('button', { name: 'retirer : Set de Aurore' }))
      expect(screen.getByText('Aucun set.')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Sets' })).toHaveFocus()
      fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
      await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
      expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0]).sets).toEqual([])
    })

    it("starts as the takeover of a collective's application, in place of the takeover of the address, linked to it", async () => {
      const VAGUES: Collective = { ...ONDES, id: 'collective-2', name: 'Vagues', email: 'vagues@example.com' }
      mockFetch({ ...NEW, '/api/admin/collectives': { ok: true, collectives: [ONDES, VAGUES] }, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
      renderAt('/admin/sessions/nouvelle?takeover=collective-2&application=application-1')

      expect(await screen.findByRole('combobox', { name: 'Collectif' })).toHaveValue('Ondes')
      expect(screen.getByRole('radio', { name: 'Takeover' })).toBeChecked()
      expect(screen.getByRole('combobox', { name: 'Candidature' })).toHaveValue('Reçue le 1 septembre 2026')
      expect(reminder().getAllByRole('listitem').map((item) => item.textContent)).toEqual(['samedi 14 novembre 2026', 'samedi 21 novembre 2026'])
      expect(screen.getByText('Aucun set.')).toBeInTheDocument()

      await fillIn({ type: null })
      fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
      await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
      expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ type: 'takeover', takeover: 'collective-1', application: 'application-1', sets: [] })
    })

    it("ignores an application that doesn't exist, keeping the takeover of the address", async () => {
      mockFetch(NEW)
      renderAt('/admin/sessions/nouvelle?takeover=collective-1&application=unknown')

      expect(await screen.findByRole('combobox', { name: 'Collectif' })).toHaveValue('Ondes')
      expect(screen.getByRole('combobox', { name: 'Candidature' })).toHaveValue('Aucune candidature')
      expect(screen.queryByRole('region', { name: 'Candidature' })).not.toBeInTheDocument()
      expect(screen.getByText('Aucun set.')).toBeInTheDocument()
    })

    it('starts without it when the applications, or the artists, could not be loaded, which it says', async () => {
      mockFetch({ ...NEW, '/api/admin/applications': { ok: false, error: 'Boom' } })
      const first = renderAt('/admin/sessions/nouvelle?application=application-3')
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les candidatures n'ont pas pu être chargées : Boom"))
      expect(screen.getByText('Aucun set.')).toBeInTheDocument()
      first.unmount()

      mockFetch({ ...NEW, '/api/admin/artists': { ok: false, error: 'Boom' } })
      renderAt('/admin/sessions/nouvelle?application=application-3')
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom"))
      expect(screen.getByText('Aucun set.')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Candidature' })).not.toBeInTheDocument()
    })
  })
})
