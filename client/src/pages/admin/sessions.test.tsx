import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import App from '../../app'
import type { Application } from '../../application-fields'
import type { Artist } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import type { Session, StudioSet } from '../../session-fields'
import { CONFIG, held, jsonBody, mockFetch, moveWithKeyboard, named, requestsTo, shownTime, spaced, timeParts, typeTime, visibleText } from '../../test-utils'
import type { Body } from '../../test-utils'

// The admin pages load on demand (see AdminPage in shell.tsx): load them up front, so that no test waits for them.
beforeAll(() => import('./admin-pages'))

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
    // What's consistent with its status.
    decision: status === 'planned' || status === 'done' ? 'accepted' : status,
    decisionUpdatedBy: null,
    decisionUpdatedAt: null,
    sets: [],
    sessions: [],
  }
}

// Every application, as the server lists them, the most recently received first: Cyan's, which set-2 comes from, Ondes',
// which its takeover comes from, then Brume's, and Aurore's.
const APPLICATIONS_LIST = [
  application('application-2', { artistId: 'artist-3' }, '2026-09-02T16:00:00.000Z', 'planned', ['2026-11-14']),
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
const RA_EVENTS_URL = '/api/ra-events?from=2000-01-01T00%3A00-05%3A00'

// RA's events, as the server orders them: the upcoming ones the soonest first, and the past ones the most recent first.
// The past ones' numbers are close to each other, as Parking Radio's often are.
const RA_EVENTS = {
  [RA_EVENTS_URL]: {
    ok: true,
    promoterUrl: 'https://ra.co/promoters/183980',
    upcoming: [raEvent('2300000', 'ONDES TAKEOVER', '2026-12-05T20:00:00-05:00'), raEvent('2400000', 'PLUS TARD', '2027-01-10T20:00:00-05:00')],
    // 23:30 on October 31 in Québec is already November 1 in UTC.
    past: [raEvent('6683745', 'HAUTE RIVE TAKEOVER', '2026-10-31T23:30:00-04:00'), raEvent('6683748', 'PLUS TÔT', '2026-09-01T20:00:00-04:00')],
  },
}

// What each option the open combobox shows says, e.g. an event's title and day, then its number.
const options = () =>
  screen
    .queryAllByRole('option')
    // Not those of the sets' statuses.
    .filter((option) => !option.closest('select'))
    .map((option) => spaced(option.textContent))

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

// `session`, and its sets, with `status`.
const withStatus = (session: Session, status: Session['status']): Session => ({ ...session, status, sets: session.sets.map((set) => ({ ...set, status })) })

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
    // A dropdown by the option it shows. Not the cell with the handle that reorders the rows, which shows nothing else.
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .filter((cell) => !cell.querySelector('.admin-handle'))
        .map((cell) => cell.querySelector('select')?.selectedOptions[0].textContent ?? spaced(visibleText(cell))),
    )
const days = () => rows().map((row) => row[0])

async function expectSearch(query: string, found: string[]) {
  const field = await screen.findByRole('searchbox', { name: 'Rechercher' })
  fireEvent.change(field, { target: { value: query } })
  await waitFor(() => expect(days()).toEqual(found))
}

// The date of the session's start or end, in its form, and its time (see `typeTime` and `shownTime`), whose hour is the
// first of its parts.
const dayInput = (when: 'Début' | 'Fin') => within(screen.getByRole('group', { name: when })).getByLabelText('date')
const timeField = (when: 'Début' | 'Fin') => within(screen.getByRole('group', { name: when })).getByRole('group', { name: 'heure' })
const timeHour = (when: 'Début' | 'Fin') => timeParts(timeField(when))[0]
// One of the programmation's time slots, in the group named "Plages horaires", e.g. "18 h – 22 h".
const slot = (label: string) => within(screen.getByRole('group', { name: 'Plages horaires' })).getByRole('button', { name: label })
// How long the session form says the session lasts, rather than what's said of the sets' handles after their table.
const lasts = () => within(screen.getByRole('group', { name: 'Quand' })).queryByRole('status')

// What was sent as the session's fields in a request to save one, as JSON in the "session" part.
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
    fireEvent.click(screen.getByRole('link', { name: named('ven. 13 nov. 2026') }))
    expect(await screen.findByText('du vendredi 13 novembre 2026 à 18 h au dimanche 15 novembre 2026 à 2 h')).toBeInTheDocument()
    expect(value('Durée')).toHaveTextContent(/^32 h$/)
  })

  it('lists every session, those without a date first, then the latest first, in Québec time', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions?status=all')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(rows()).toEqual([
      ['date à déterminer', '3 h', 'GUEST MIXES', 'Guest mixes', 'Brume · Cyan', 'planifiée', 'non annoncée'],
      ['sam. 14 nov. 2026', '21 h – 1 h', 'ONDES TAKEOVER', 'Takeover', 'Aurore, Brume · Cyan', 'planifiée', 'non annoncée'],
      ['ven. 2 oct. 2026', '20 h – 21 h', 'SOIRÉE', 'Autre', 'Brume', 'jouée', 'annoncée'],
      ['lun. 31 août 2026', '20 h – 21 h', 'LIVE PERFORMANCE', 'Live performance', '', 'annulée', 'non annoncée'],
    ])
    // Done sessions are greyed out, and cancelled ones faded out in their own color.
    const sessionRows = screen.getAllByRole('row').slice(1)
    expect(sessionRows[0]).toHaveClass('admin-status-planned')
    expect(sessionRows[1]).toHaveClass('admin-status-planned')
    expect(sessionRows[2]).toHaveClass('admin-status-done')
    expect(sessionRows[3]).toHaveClass('admin-status-cancelled')
    expect(screen.getByRole('link', { name: named('sam. 14 nov. 2026') })).toHaveAttribute('href', '/admin/sessions/session-1')
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

describe('Announcing a session from the list', () => {
  const LIST = { ...LOGGED_IN, '/api/admin/sessions': { ok: true, sessions: SESSIONS } }
  const PUT = 'PUT /api/admin/sessions/session-1/announced'
  const ANNOUNCED = { ...SESSION, announced: true, announcedUpdatedBy: 'admin@example.com', announcedUpdatedAt: '2026-11-15T04:00:00.000Z' }
  // SOIRÉE, which is announced, un-announced.
  const UNANNOUNCE_SOIREE = { 'PUT /api/admin/sessions/session-3/announced': { ok: true, session: { ...SESSIONS[2], announced: false } } }
  const select = (of: string) => screen.findByRole('combobox', { name: named(`Annonce : ${of}`) })
  const counts = (name: string) => within(screen.getByRole('group', { name })).getAllByRole('button').map((button) => button.textContent)

  it('offers « non annoncée » and « annoncée », by a name that tells the sessions apart', async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions?status=all')

    const planned = await select('ONDES TAKEOVER, sam. 14 nov. 2026')
    expect(planned).toHaveValue('false')
    expect(within(planned).getAllByRole('option').map((option) => option.textContent)).toEqual(['non annoncée', 'annoncée'])
    expect(await select('SOIRÉE, ven. 2 oct. 2026')).toHaveValue('true')
    expect(screen.getAllByRole('combobox').map((each) => spaced(each.getAttribute('aria-label')))).toEqual([
      'Annonce : GUEST MIXES, date à déterminer',
      'Annonce : ONDES TAKEOVER, sam. 14 nov. 2026',
      'Annonce : SOIRÉE, ven. 2 oct. 2026',
      'Annonce : LIVE PERFORMANCE, lun. 31 août 2026',
    ])
  })

  it("can't announce a session without a date, whose dropdown is greyed out, saying why, but keeps the focus", async () => {
    mockFetch(LIST)
    renderAt('/admin/sessions?status=all')

    const undated = await select('GUEST MIXES, date à déterminer')
    expect(undated).toHaveTextContent(/^non annoncée$/)
    expect(undated).toHaveAttribute('aria-disabled', 'true')
    expect(undated).toHaveAttribute('aria-expanded', 'false')
    expect(undated).not.toBeDisabled()
    expect(undated).toHaveAccessibleDescription("La session n'a pas de date.")
    undated.focus()
    expect(undated).toHaveFocus()
    fireEvent.click(undated)
    expect(undated).toHaveFocus()
    expect(requestsTo('PUT', '/api/admin/sessions/session-2/announced')).toHaveLength(0)
  })

  it('takes a session out of the announced ones once it is un-announced, without loading the list again', async () => {
    mockFetch({ ...LIST, ...UNANNOUNCE_SOIREE })
    renderAt('/admin/sessions?status=all&announced=true')

    fireEvent.change(await select('SOIRÉE, ven. 2 oct. 2026'), { target: { value: 'false' } })

    await waitFor(() => expect(rows()).toEqual([]))
    expect(screen.getByText('Aucune session ne correspond à ces filtres.')).toBeInTheDocument()
    expect(jsonBody(requestsTo('PUT', '/api/admin/sessions/session-3/announced')[0])).toEqual({ announced: false })
    expect(requestsTo('GET', '/api/admin/sessions')).toHaveLength(1)
    expect(counts('Annonce')).toEqual(['toutes (4)', 'annoncées (0)', 'non annoncées (4)'])
    expect(counts('Statut')).toEqual(['toutes (0)', 'planifiées (0)', 'jouées (0)', 'annulées (0)'])
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\?status=all&announced=true$/)
  })

  it('takes a session out of those that are not announced once it is announced', async () => {
    mockFetch({ ...LIST, [PUT]: { ok: true, session: ANNOUNCED } })
    renderAt('/admin/sessions?status=all&announced=false')

    fireEvent.change(await select('ONDES TAKEOVER, sam. 14 nov. 2026'), { target: { value: 'true' } })

    await waitFor(() => expect(days()).toEqual(['date à déterminer', 'lun. 31 août 2026']))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sessions/session-1/announced')[0])).toEqual({ announced: true })
    expect(counts('Annonce')).toEqual(['toutes (4)', 'annoncées (2)', 'non annoncées (2)'])
  })

  it('keeps a session listed among all of them, with its new value', async () => {
    mockFetch({ ...LIST, [PUT]: { ok: true, session: ANNOUNCED } })
    renderAt('/admin/sessions?status=all')

    const changed = await select('ONDES TAKEOVER, sam. 14 nov. 2026')
    fireEvent.change(changed, { target: { value: 'true' } })

    await waitFor(() => expect(counts('Annonce')).toEqual(['toutes (4)', 'annoncées (2)', 'non annoncées (2)']))
    expect(changed).toHaveValue('true')
    expect(rows()).toHaveLength(4)
  })

  it('shows the value picked and keeps only that session from being changed while it is saved', async () => {
    mockFetch({ ...LIST, [PUT]: { ok: true, session: ANNOUNCED } })
    renderAt('/admin/sessions?status=all')

    const changed = await select('ONDES TAKEOVER, sam. 14 nov. 2026')
    const other = await select('SOIRÉE, ven. 2 oct. 2026')
    fireEvent.change(changed, { target: { value: 'true' } })

    expect(changed).toBeDisabled()
    expect(changed).toHaveValue('true')
    expect(other).toBeEnabled()
    await waitFor(() => expect(changed).toBeEnabled())
    expect(changed).toHaveValue('true')
  })

  it('says why it could not be changed, above the list, naming the session, which keeps its value, until the next change', async () => {
    mockFetch({ ...LIST, [PUT]: { ok: false, error: 'No such session' } })
    renderAt('/admin/sessions?status=all')

    const changed = await select('ONDES TAKEOVER, sam. 14 nov. 2026')
    fireEvent.change(changed, { target: { value: 'true' } })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("L'annonce de « ONDES TAKEOVER, sam. 14 nov. 2026 » n'a pas pu être changée : No such session")
    expect(Boolean(alert.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    await waitFor(() => expect(changed).toBeEnabled())
    expect(changed).toHaveValue('false')

    mockFetch({ ...LIST, ...UNANNOUNCE_SOIREE })
    const other = await select('SOIRÉE, ven. 2 oct. 2026')
    fireEvent.change(other, { target: { value: 'false' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(other).toBeEnabled())
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

// With its takeover's collective, which its sets' forms load.
const PAGE = { ...LOGGED_IN, '/api/admin/sessions/session-1': { ok: true, session: SESSION }, '/api/admin/collectives/collective-1': { ok: true, collective: ONDES } }
const setsTable = () => screen.getByRole('table', { name: 'Sets' })
// What the sets say when they add up to more than their session, if they do.
const tooLong = () => spaced(screen.queryByText(/Les sets durent /)?.textContent ?? null)
// What the session's record says for `label`.
const value = (label: string) =>
  [...screen.getByLabelText('Session').querySelectorAll(':scope > dt')].find((term) => term.textContent === label)!.nextElementSibling as HTMLElement

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
      ['1 h', 'Aurore, Brume', 'DJ', 'techno', 'SoundCloud · YouTube', 'planifié', 'déplacer modifier ×'],
      ['1 h 30', 'Cyan', 'Performance Live, autre : Synthé', 'ambient', 'Candidature', 'joué', 'déplacer modifier ×'],
      ['1 h', '-', '', '-', '', 'annulé', 'déplacer modifier ×'],
    ])
    const first = within(setsTable()).getAllByRole('row')[1]
    expect(within(first).getByRole('link', { name: 'Aurore' })).toHaveAttribute('href', '/admin/artistes/artist-1')
    expect(within(first).getByRole('link', { name: 'YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    const second = within(setsTable()).getAllByRole('row')[2]
    const application = within(second).getByRole('link', { name: 'Candidature reçue le 2 septembre 2026' })
    expect(application).toHaveTextContent(/^Candidature$/)
    expect(application).toHaveAttribute('href', '/admin/candidatures/application-2')
    const cyan = screen.getByRole('combobox', { name: 'Statut : Set de Cyan' })
    expect(cyan).toHaveValue('done')
    expect(within(cyan).getAllByRole('option').map((option) => option.textContent)).toEqual(['planifié', 'joué', 'annulé'])
    expect(screen.queryByText(/on ne peut pas rétablir ses sets/)).not.toBeInTheDocument()
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
    // At the server's larger size, linking to the flyer as it was sent.
    const flyer = `/api/admin/sessions/session-1/flyer?v=${encodeURIComponent('2026-10-02T16:00:00.000Z')}`
    expect(within(value('Flyer')).getByRole('img', { name: 'Flyer de ONDES TAKEOVER' })).toHaveAttribute('src', `${flyer}&width=1280`)
    expect(within(value('Flyer')).getByRole('link', { name: 'Flyer de ONDES TAKEOVER' })).toHaveAttribute('href', flyer)
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
    const reordered = { ...cancelled, sets: [cancelled.sets[1], cancelled.sets[0], cancelled.sets[2]] }
    mockFetch({ ...PAGE, 'PUT /api/admin/sessions/session-1/status': { ok: true, session: cancelled }, 'PUT /api/admin/sets/set-1/position': { ok: true, session: reordered } })
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

    // Sets can't be added to it, which the button says, greyed out. Its sets can't be un-cancelled: their statuses are
    // written out, and the page says why once, above them.
    const add = screen.getByRole('button', { name: 'ajouter un set' })
    expect(add).toHaveAttribute('aria-disabled', 'true')
    expect(add).toHaveAccessibleDescription('La session est annulée\u00a0: on ne peut pas lui ajouter de set.')
    fireEvent.click(add)
    expect(screen.queryByRole('heading', { name: 'Nouveau set' })).not.toBeInTheDocument()
    expect(within(setsTable()).queryByRole('combobox')).not.toBeInTheDocument()
    expect(rows(setsTable()).map((row) => row[5])).toEqual(['annulé', 'annulé', 'annulé'])
    const why = screen.getByText(/on ne peut pas rétablir ses sets/)
    expect(why.textContent).toBe('La session est annulée\u00a0: on ne peut pas rétablir ses sets.')
    expect(why.compareDocumentPosition(setsTable()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(visibleText(document.body).match(/La session est annulée/g)).toHaveLength(1)

    // Its sets can still be reordered.
    await moveWithKeyboard(screen.getByRole('button', { name: 'réordonner : Set de Aurore et Brume' }), 1)
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sets/set-1/position').map(jsonBody)).toEqual([{ position: 1 }]))
    await waitFor(() => expect(rows(setsTable()).map((row) => row[1])).toEqual(['Cyan', 'Aurore, Brume', '-']))
  })

  it("brings its sets' dropdowns back once it's un-cancelled, and says nothing of sets it doesn't have", async () => {
    const sets = SESSION.sets.map((set) => ({ ...set, status: 'cancelled' as const }))
    const cancelled: Session = { ...SESSION, status: 'cancelled', sets }
    // Its sets stay cancelled.
    mockFetch({ ...PAGE, '/api/admin/sessions/session-1': { ok: true, session: cancelled }, 'PUT /api/admin/sessions/session-1/status': { ok: true, session: { ...cancelled, status: 'planned' } } })
    const page = renderAt('/admin/sessions/session-1')

    expect(await screen.findByText(/on ne peut pas rétablir ses sets/)).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('group', { name: 'Statut' })).getByRole('button', { name: 'planifiée' }))
    await waitFor(() => expect(within(setsTable()).getAllByRole('combobox')).toHaveLength(3))
    expect(screen.getByRole('combobox', { name: 'Statut : Set de Cyan' })).toHaveValue('cancelled')
    expect(screen.queryByText(/on ne peut pas rétablir ses sets/)).not.toBeInTheDocument()
    page.unmount()

    mockFetch({ ...PAGE, '/api/admin/sessions/session-1': { ok: true, session: { ...cancelled, sets: [] } } })
    renderAt('/admin/sessions/session-1')
    expect(await screen.findByText('Aucun set.')).toBeInTheDocument()
    expect(screen.queryByText(/on ne peut pas rétablir ses sets/)).not.toBeInTheDocument()
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
    expect(screen.getByRole('combobox', { name: 'Statut : Set de Aurore et Brume' })).toHaveValue('done')
    page.unmount()

    // Several, each on a line of its own.
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-2': { ok: true, session: UNDATED } })
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
    mockFetch({ ...LOGGED_IN, '/api/admin/sessions/session-2': { ok: true, session: UNDATED } })
    renderAt('/admin/sessions/session-2')

    const button = within(await screen.findByRole('group', { name: 'Annonce' })).getByRole('button', { name: 'annoncée' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAccessibleDescription("La session n'a pas de date.")
    fireEvent.click(button)
    expect(requestsTo('PUT', '/api/admin/sessions/session-2/announced')).toHaveLength(0)
  })

  it('says right away, in its form, that an announced session keeps its date', async () => {
    mockFetch({ ...LOGGED_IN, ...COLLECTIVES, ...RA_EVENTS, '/api/admin/sessions/session-1': { ok: true, session: { ...SESSION, announced: true } } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    const undated = await screen.findByLabelText('date à déterminer')
    fireEvent.click(undated)
    expect(screen.getByRole('alert')).toHaveTextContent("Une session annoncée a une date : retirez d'abord son annonce.")
    expect(undated).toHaveAttribute('aria-invalid', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(0)
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

  it("changes a set's status from its dropdown, saying above the sets why it couldn't, without naming the session it's on", async () => {
    // Its other sets are done or cancelled, so the session is done too.
    const done: Session = { ...SESSION, status: 'done', sets: [{ ...SET, status: 'done' }, CYAN_SET, SESSION.sets[2]] }
    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-1/status': { ok: true, session: done } })
    renderAt('/admin/sessions/session-1')

    const changed = await screen.findByRole('combobox', { name: 'Statut : Set de Aurore et Brume' })
    expect(changed.closest('tr')).toHaveClass('admin-status-planned')
    fireEvent.change(changed, { target: { value: 'done' } })
    // While it's saved, it shows the status picked, and no set can be changed.
    expect(changed).toHaveValue('done')
    for (const select of within(setsTable()).getAllByRole('combobox')) expect(select).toBeDisabled()
    await waitFor(() => expect(changed).toBeEnabled())
    expect(changed).toHaveValue('done')
    expect(changed.closest('tr')).toHaveClass('admin-status-done')
    expect(jsonBody(requestsTo('PUT', '/api/admin/sets/set-1/status')[0])).toEqual({ status: 'done' })
    expect(within(screen.getByRole('group', { name: 'Statut' })).getByRole('button', { name: 'jouée' })).toHaveAttribute('aria-pressed', 'true')

    // Back to the set's status when it can't be changed.
    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-3/status': { ok: false, error: 'This session is cancelled', session: SESSION, set: null } })
    const refused = screen.getByRole('combobox', { name: 'Statut : Set' })
    fireEvent.change(refused, { target: { value: 'planned' } })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Le statut de « Set » n'a pas pu être changé : This session is cancelled$/)
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument()
    expect(alert.compareDocumentPosition(setsTable()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(refused).toBeEnabled())
    expect(refused).toHaveValue('cancelled')
  })

  it('gives a dropdown the focus back once its status is saved, unless another control took it meanwhile', async () => {
    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-1/status': { ok: true, session: SESSION }, 'PUT /api/admin/sets/set-2/status': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    // Browsers take the focus away from it while it's disabled, to the page itself, which jsdom doesn't, even with blur().
    const dropFocus = () => {
      document.body.tabIndex = -1
      document.body.focus()
      document.body.removeAttribute('tabindex')
    }
    const changed = await screen.findByRole('combobox', { name: 'Statut : Set de Aurore et Brume' })
    changed.focus()
    fireEvent.change(changed, { target: { value: 'done' } })
    dropFocus()
    expect(changed).not.toHaveFocus()
    await waitFor(() => expect(changed).toBeEnabled())
    expect(changed).toHaveFocus()

    const other = screen.getByRole('combobox', { name: 'Statut : Set de Cyan' })
    other.focus()
    fireEvent.change(other, { target: { value: 'planned' } })
    const edit = screen.getByRole('button', { name: 'modifier : Set de Cyan' })
    edit.focus()
    await waitFor(() => expect(other).toBeEnabled())
    expect(edit).toHaveFocus()
  })

  it("shows only the server's message when it names nothing in the way", async () => {
    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-1/status': { ok: false, error: 'This session is cancelled', session: null, set: null } })
    renderAt('/admin/sessions/session-1')

    fireEvent.change(await screen.findByRole('combobox', { name: 'Statut : Set de Aurore et Brume' }), { target: { value: 'cancelled' } })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Le statut de « Set de Aurore et Brume » n'a pas pu être changé : This session is cancelled$/)
  })

  it('changes the session in a form in its place, sending its start back as it was', async () => {
    const changed = { ...SESSION, name: 'AUTRE', title: 'AUTRE', updatedBy: 'admin@example.com', updatedAt: '2026-10-02T16:00:00.000Z' }
    mockFetch({ ...PAGE, ...COLLECTIVES, ...RA_EVENTS, 'PATCH /api/admin/sessions/session-1': { ok: true, session: changed } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    await screen.findByRole('group', { name: 'Début' })
    expect(dayInput('Début')).toHaveValue('2026-11-14')
    expect(shownTime(timeField('Début'))).toBe('21 h 00')
    expect(dayInput('Fin')).toHaveValue('2026-11-15')
    expect(shownTime(timeField('Fin'))).toBe('1 h 00')
    expect(lasts()).toHaveTextContent(/^Dure 4 h\.$/)
    expect(screen.getByRole('radio', { name: 'Takeover' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Collectif' })).toHaveValue('Ondes')
    // The name its type gives it shows while it has none of its own.
    expect(screen.getByLabelText('Nom')).toHaveValue('')
    expect(screen.getByLabelText('Nom')).toHaveAttribute('placeholder', 'ONDES TAKEOVER')
    // Once RA's events are read, the session's is named by its title and its day.
    await waitFor(() => expect(spaced(screen.getByRole<HTMLInputElement>('combobox', { name: 'Événement RA' }).value)).toBe('HAUTE RIVE TAKEOVER, sam. 31 oct. 2026'))
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
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sessions/session-1')[0])).toEqual({
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

  it.each(['planned', 'cancelled'] as const)("greys out its collective's rejected applications unless the takeover is cancelled: %s", async (status) => {
    const rejected = application('application-6', { collectiveId: 'collective-1' }, '2026-09-10T16:00:00.000Z', 'rejected', ['2026-12-12'])
    const session = { ...SESSION, status, sets: SESSION.sets.map((set) => ({ ...set, status: status === 'cancelled' ? status : set.status })) }
    mockFetch({
      ...PAGE,
      ...RA_EVENTS,
      ...COLLECTIVES,
      '/api/admin/sessions/session-1': { ok: true, session },
      '/api/admin/applications': { ok: true, total: 5, applications: [rejected, ...APPLICATIONS_LIST] },
    })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.click(await screen.findByRole('combobox', { name: 'Candidature' }))
    const option = screen.getByRole('option', { name: /^Reçue le 10 septembre 2026/ })
    expect(option).toHaveTextContent('refusée')
    fireEvent.mouseDown(option)
    if (status === 'planned') expect(option).toHaveAttribute('aria-disabled', 'true')
    else expect(screen.getByRole('combobox', { name: 'Candidature' })).toHaveValue('Reçue le 10 septembre 2026')
  })

  // Another collective, with an application of its own.
  const VAGUES: Collective = { ...ONDES, id: 'collective-2', name: 'Vagues', email: 'vagues@example.com' }
  const vagues = application('application-5', { collectiveId: 'collective-2' }, '2026-09-10T16:00:00.000Z', 'new', ['2026-12-12'])

  it("picks a takeover's application among its collective's only, which it keeps while another type is picked, but only a takeover sends", async () => {
    const MAREES: Collective = { ...ONDES, id: 'collective-3', name: 'Marées', email: 'marees@example.com' }
    mockFetch({
      ...PAGE,
      ...RA_EVENTS,
      '/api/admin/collectives': { ok: true, collectives: [ONDES, VAGUES, MAREES] },
      '/api/admin/applications': { ok: true, total: 5, applications: [vagues, ...APPLICATIONS_LIST] },
      'PATCH /api/admin/sessions/session-1': { ok: true, session: SESSION },
    })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    const picker = () => screen.getByRole('combobox', { name: 'Candidature' })
    expect(await screen.findByRole('combobox', { name: 'Candidature' })).toHaveValue('Reçue le 1 septembre 2026')
    fireEvent.click(picker())
    expect(options()).toEqual(['Aucune candidature', 'Reçue le 1 septembre 2026retenue · 14 nov. 2026, 21 nov. 2026'])
    fireEvent.keyDown(picker(), { key: 'Escape' })

    // Another collective, without an application, takes it away, and it's no longer offered.
    fireEvent.click(screen.getByRole('combobox', { name: 'Collectif' }))
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Marées/ }))
    expect(picker()).toHaveValue('')
    expect(picker()).toHaveAttribute('placeholder', 'Aucune candidature de ce collectif.')
    // One with a single new or accepted application gives it that one.
    fireEvent.click(screen.getByRole('combobox', { name: 'Collectif' }))
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Vagues/ }))
    expect(picker()).toHaveValue('Reçue le 10 septembre 2026')
    fireEvent.click(picker())
    expect(options()).toEqual(['Aucune candidature', 'Reçue le 10 septembre 2026nouvelle · 12 déc. 2026'])
    fireEvent.keyDown(picker(), { key: 'Escape' })

    // Hidden with the collective for another type, and back with it.
    fireEvent.click(screen.getByRole('radio', { name: 'Guest mixes' }))
    expect(screen.queryByRole('combobox', { name: 'Candidature' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Takeover' }))
    expect(picker()).toHaveValue('Reçue le 10 septembre 2026')
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sessions/session-1')[0])).toMatchObject({ type: 'takeover', takeover: 'collective-2', application: 'application-5' })
  })

  it.each([
    ['planned', 'Reçue le 10 septembre 2026'],
    ['done', 'Aucune candidature'],
    ['cancelled', 'Aucune candidature'],
  ] as const)("doesn't pick a %s takeover's application as its form opens, nor with another collective unless it's planned", async (status, picked) => {
    const session = withStatus({ ...SESSION, application: null }, status)
    mockFetch({
      ...PAGE,
      ...RA_EVENTS,
      '/api/admin/sessions/session-1': { ok: true, session },
      '/api/admin/collectives': { ok: true, collectives: [ONDES, VAGUES] },
      '/api/admin/applications': { ok: true, total: 5, applications: [vagues, ...APPLICATIONS_LIST] },
    })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    // Ondes' only one, since the session can be meant to have none.
    expect(await screen.findByRole('combobox', { name: 'Candidature' })).toHaveValue('Aucune candidature')
    fireEvent.click(screen.getByRole('combobox', { name: 'Collectif' }))
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Vagues/ }))
    expect(screen.getByRole('combobox', { name: 'Candidature' })).toHaveValue(picked)
  })

  it("keeps the takeover's application when the applications could not be loaded, which it says, and lets it be removed", async () => {
    mockFetch({ ...PAGE, ...RA_EVENTS, '/api/admin/collectives': { ok: true, collectives: [ONDES] }, '/api/admin/applications': { ok: false, error: 'Boom' } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Les candidatures n'ont pas pu être chargées : Boom")
    expect(screen.getByRole('combobox', { name: 'Candidature' })).toHaveValue('Reçue le 1 septembre 2026')
    fireEvent.click(screen.getByRole('combobox', { name: 'Candidature' }))
    expect(options()).toEqual(['Aucune candidature', 'Reçue le 1 septembre 2026'])
  })

  it('sends no application for another type than a takeover', async () => {
    mockFetch({ ...PAGE, ...COLLECTIVES, ...RA_EVENTS, 'PATCH /api/admin/sessions/session-1': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(await screen.findByRole('combobox', { name: 'Candidature' })).toHaveValue('Reçue le 1 septembre 2026')
    fireEvent.click(screen.getByRole('radio', { name: 'Guest mixes' }))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sessions/session-1')[0])).toMatchObject({ type: 'guest-mixes', takeover: null, application: null })
  })

  it("shows « - » for a takeover's application when it has none", async () => {
    mockFetch({ ...PAGE, '/api/admin/sessions/session-1': { ok: true, session: { ...SESSION, application: null } } })
    renderAt('/admin/sessions/session-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'ONDES TAKEOVER' })).toBeInTheDocument()
    expect(value('Candidature')).toHaveTextContent(/^-$/)
  })

  it('changes its description and its flyer, which it can also remove, in the form', async () => {
    const withFlyer = { ...SESSION, hasFlyer: true }
    mockFetch({
      ...LOGGED_IN,
      ...COLLECTIVES,
      ...RA_EVENTS,
      '/api/admin/sessions/session-1': { ok: true, session: withFlyer },
      'PATCH /api/admin/sessions/session-1': { ok: true, session: withFlyer },
      'DELETE /api/admin/sessions/session-1/flyer': { ok: true, session: SESSION },
      'PUT /api/admin/sessions/session-1/flyer': { ok: true, session: withFlyer },
    })
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
    // Its fields first, then the flyer.
    await waitFor(() => expect(requestsTo('DELETE', '/api/admin/sessions/session-1/flyer')).toHaveLength(1))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sessions/session-1')[0])).toMatchObject({ description: 'LIVE STREAMING FROM QUÉBEC CITY.\n\nSPECIAL  NIGHT' })
    expect(await screen.findByText('Pas de flyer')).toBeInTheDocument()

    // Another flyer replaces it, and is checked as soon as it's chosen.
    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    const input = await screen.findByLabelText('Flyer')
    fireEvent.change(input, { target: { files: [new File(['gif'], 'flyer.gif', { type: 'image/gif' })] } })
    expect(await screen.findByText('Le flyer doit être en JPEG, PNG ou WebP.')).toBeInTheDocument()
    const flyer = new File(['flyer'], 'flyer.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [flyer] } })
    expect(screen.getByText(/^Facultatif\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PUT', '/api/admin/sessions/session-1/flyer')).toHaveLength(1))
    expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(2)
    const replaced = requestsTo('PUT', '/api/admin/sessions/session-1/flyer')[0].body as FormData
    expect(replaced.get('flyer')).toBeInstanceOf(File)
    expect((replaced.get('flyer') as File).name).toBe('flyer.png')
    expect(requestsTo('DELETE', '/api/admin/sessions/session-1/flyer')).toHaveLength(1)
  })

  it('keeps the form open when only the flyer is refused, showing the session as it was saved, and sends both again', async () => {
    const changed = { ...SESSION, name: 'NUIT SPÉCIALE', title: 'NUIT SPÉCIALE' }
    mockFetch({
      ...PAGE,
      ...COLLECTIVES,
      ...RA_EVENTS,
      'PATCH /api/admin/sessions/session-1': { ok: true, session: changed },
      'PUT /api/admin/sessions/session-1/flyer': { ok: false, error: 'The flyer is larger than 10 MB' },
    })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.change(await screen.findByLabelText('Nom'), { target: { value: 'NUIT SPÉCIALE' } })
    fireEvent.change(screen.getByLabelText('Flyer'), { target: { files: [new File(['flyer'], 'flyer.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('La session a été enregistrée, mais pas le flyer : The flyer is larger than 10 MB'))
    // The page shows the session as it was saved, under the form, which stays open.
    expect(screen.getByRole('heading', { level: 1, name: 'NUIT SPÉCIALE' })).toBeInTheDocument()
    expect(screen.getByLabelText('Nom')).toHaveValue('NUIT SPÉCIALE')

    mockFetch({
      ...PAGE,
      ...COLLECTIVES,
      ...RA_EVENTS,
      'PATCH /api/admin/sessions/session-1': { ok: true, session: changed },
      'PUT /api/admin/sessions/session-1/flyer': { ok: true, session: { ...changed, hasFlyer: true } },
    })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'modifier' })).toBeInTheDocument())
    expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(1)
    expect(requestsTo('PUT', '/api/admin/sessions/session-1/flyer')).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'Flyer de NUIT SPÉCIALE' })).toBeInTheDocument()
  })

  it("doesn't send the flyer when the session's fields are refused", async () => {
    mockFetch({
      ...PAGE,
      ...COLLECTIVES,
      ...RA_EVENTS,
      'PATCH /api/admin/sessions/session-1': { ok: false, error: 'Another session overlaps this one', session: null, set: null },
    })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.change(await screen.findByLabelText('Flyer'), { target: { files: [new File(['flyer'], 'flyer.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("La session n'a pas pu être enregistrée : Another session overlaps this one"))
    expect(requestsTo('PUT', '/api/admin/sessions/session-1/flyer')).toHaveLength(0)
  })

  it('says so when its flyer could not be removed, keeping it and the form', async () => {
    const withFlyer = { ...SESSION, hasFlyer: true }
    mockFetch({
      ...PAGE,
      ...COLLECTIVES,
      ...RA_EVENTS,
      '/api/admin/sessions/session-1': { ok: true, session: withFlyer },
      'PATCH /api/admin/sessions/session-1': { ok: true, session: withFlyer },
      'DELETE /api/admin/sessions/session-1/flyer': { ok: false, error: 'Internal server error' },
    })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.click(await screen.findByRole('button', { name: 'retirer le flyer' }))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('La session a été enregistrée, mais pas le flyer : Internal server error'))
    expect(screen.getByText(/Le flyer actuel sera retiré à l'enregistrement\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'annuler' }))
    expect(screen.getByRole('img', { name: 'Flyer de ONDES TAKEOVER' })).toBeInTheDocument()
  })

  it("keeps the session's event on RA when it isn't among those read from RA, and offers it until the form closes", async () => {
    const other = { ...SESSION, raEvent: { id: '1000000', url: 'https://ra.co/events/1000000' } }
    mockFetch({ ...LOGGED_IN, ...COLLECTIVES, ...RA_EVENTS, '/api/admin/sessions/session-1': { ok: true, session: other }, 'PATCH /api/admin/sessions/session-1': { ok: true, session: other } })
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
    await waitFor(() => expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sessions/session-1')[0])).toMatchObject({ raEvent: '1000000' })
  })

  it("keeps the session's event on RA while RA's events can't be read, which it says, and only lets it be removed", async () => {
    mockFetch({ ...PAGE, ...COLLECTIVES, [RA_EVENTS_URL]: { ok: false, error: 'The events cannot be read from RA.' }, 'PATCH /api/admin/sessions/session-1': { ok: true, session: SESSION } })
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
    await waitFor(() => expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sessions/session-1')[0])).toMatchObject({ raEvent: null })
  })

  it('keeps a session that starts at the second 1:30 of the night clocks fall back where it is when its name changes', async () => {
    // 1:30 in winter time, an hour after the first 1:30, for 2 hours.
    const second = { ...SESSION, start: '2026-11-01T06:30:00.000Z', end: '2026-11-01T08:30:00.000Z', durationMinutes: 120, sets: [] }
    mockFetch({ ...LOGGED_IN, ...COLLECTIVES, ...RA_EVENTS, '/api/admin/sessions/session-1': { ok: true, session: second }, 'PATCH /api/admin/sessions/session-1': { ok: true, session: second } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    await screen.findByRole('group', { name: 'Début' })
    expect(shownTime(timeField('Début'))).toBe('1 h 30')
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'AUTRE' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sessions/session-1')[0])).toMatchObject({ start: '2026-11-01T01:30-05:00', durationMinutes: 120 })
  })

  it('keeps a session that ends at the second 1:30 of the night clocks fall back where it ends while its end is unchanged', async () => {
    // From midnight, in summer time, to 1:30 in winter time.
    const second = { ...SESSION, start: '2026-11-01T04:00:00.000Z', end: '2026-11-01T06:30:00.000Z', durationMinutes: 150, sets: [] }
    mockFetch({ ...LOGGED_IN, ...COLLECTIVES, ...RA_EVENTS, '/api/admin/sessions/session-1': { ok: true, session: second }, 'PATCH /api/admin/sessions/session-1': { ok: true, session: second } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    await screen.findByRole('group', { name: 'Début' })
    expect(shownTime(timeField('Fin'))).toBe('1 h 30')
    expect(lasts()).toHaveTextContent(/^Dure 2 h 30\.$/)
    // Changing only the start's time doesn't move the end.
    typeTime(timeField('Début'), '00:30')
    expect(lasts()).toHaveTextContent(/^Dure 2 h\.$/)
    typeTime(timeField('Début'), '00:00')
    // Moving the start's day moves the end's, and moving it back finds the end as it opened.
    fireEvent.change(dayInput('Début'), { target: { value: '2026-11-08' } })
    expect(dayInput('Fin')).toHaveValue('2026-11-08')
    expect(lasts()).toHaveTextContent(/^Dure 1 h 30\.$/)
    fireEvent.change(dayInput('Début'), { target: { value: '2026-11-01' } })
    expect(lasts()).toHaveTextContent(/^Dure 2 h 30\.$/)
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sessions/session-1')[0])).toMatchObject({ start: '2026-11-01T00:00-04:00', durationMinutes: 150 })
  })

  it('goes through the years a date field gives as a year is typed, saying what is wrong', async () => {
    mockFetch({ ...PAGE, ...COLLECTIVES, ...RA_EVENTS })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    await screen.findByRole('group', { name: 'Début' })
    fireEvent.change(dayInput('Fin'), { target: { value: '0002-11-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(await screen.findByText('La fin doit être après le début.')).toBeInTheDocument()
    fireEvent.change(dayInput('Fin'), { target: { value: '2026-11-15' } })
    fireEvent.change(dayInput('Début'), { target: { value: '0002-11-14' } })
    expect(await screen.findByText('Une session a lieu entre les années 2000 et 2999.')).toBeInTheDocument()
    expect(dayInput('Fin')).toHaveValue('0002-11-15')
    expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(0)
  })

  it('moves an overnight session to another day, its end with it, and back', async () => {
    mockFetch({ ...PAGE, ...COLLECTIVES, ...RA_EVENTS, 'PATCH /api/admin/sessions/session-1': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    await screen.findByRole('group', { name: 'Début' })
    fireEvent.change(dayInput('Début'), { target: { value: '2026-11-21' } })
    expect(dayInput('Fin')).toHaveValue('2026-11-22')
    fireEvent.change(dayInput('Début'), { target: { value: '2026-11-14' } })
    expect(dayInput('Fin')).toHaveValue('2026-11-15')
    expect(lasts()).toHaveTextContent(/^Dure 4 h\.$/)
    fireEvent.change(dayInput('Début'), { target: { value: '2026-11-21' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sessions/session-1')[0])).toMatchObject({ start: '2026-11-21T21:00-05:00', durationMinutes: 240 })
  })

  it("moves an overnight session into one of the programmation's time slots, on its start's day, which shows as picked", async () => {
    mockFetch({ ...PAGE, ...COLLECTIVES, ...RA_EVENTS, 'PATCH /api/admin/sessions/session-1': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    await screen.findByRole('group', { name: 'Début' })
    const slots = within(screen.getByRole('group', { name: 'Plages horaires' })).getAllByRole('button')
    expect(slots.map((button) => button.textContent)).toEqual(['11 h – 15 h', '13 h – 17 h', '18 h – 22 h'])
    expect(slots.filter((button) => button.getAttribute('aria-pressed') === 'true')).toEqual([])
    fireEvent.click(slot('18 h – 22 h'))
    expect(slot('18 h – 22 h')).toHaveAttribute('aria-pressed', 'true')
    expect(shownTime(timeField('Début'))).toBe('18 h 00')
    expect(dayInput('Fin')).toHaveValue('2026-11-14')
    expect(shownTime(timeField('Fin'))).toBe('22 h 00')
    expect(lasts()).toHaveTextContent(/^Dure 4 h\.$/)
    // The times can still be changed, and the slot then isn't picked anymore.
    typeTime(timeField('Fin'), '23:00')
    expect(slot('18 h – 22 h')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(slot('18 h – 22 h'))
    // Picking a slot doesn't send the form.
    expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PATCH', '/api/admin/sessions/session-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sessions/session-1')[0])).toMatchObject({ start: '2026-11-14T18:00-05:00', durationMinutes: 240 })
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
    const warning = screen.getByText(/Les sets durent /)
    expect(warning).toHaveAttribute('role', 'status')
    expect(warning).toHaveClass('admin-warning')
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

  // Holds back the answers to the requests that save a set's place, which are still made, until what this returns is
  // called.
  function holdMoves() {
    const answered = vi.mocked(fetch).getMockImplementation()!
    let release = () => {}
    const released = new Promise<void>((resolve) => (release = resolve))
    vi.mocked(fetch).mockImplementation(async (input, options) => {
      const response = answered(input, options)
      if ((input instanceof Request ? input.url : String(input)).endsWith('/position')) await released
      return response
    })
    return release
  }

  it("moves a set where it's dropped, showing it there while it's saved, with a request per drop, its handle keeping the focus", async () => {
    const [first, cyan, cancelled] = SESSION.sets
    const session = (...sets: StudioSet[]): Session => ({ ...SESSION, sets })
    mockFetch({
      ...LOGGED_IN,
      '/api/admin/sessions/session-1': { ok: true, session: session(first, cyan, cancelled) },
      // As the server then has the session, the status of the set of Cyan changed by another admin meanwhile.
      'PUT /api/admin/sets/set-1/position': { ok: true, session: session({ ...cyan, status: 'cancelled' }, cancelled, first) },
    })
    const answer = holdMoves()
    renderAt('/admin/sessions/session-1')

    await screen.findByRole('table', { name: 'Sets' })
    const handle = screen.getByRole('button', { name: 'réordonner : Set de Aurore et Brume' })
    expect(handle).not.toHaveAttribute('aria-disabled')
    // Put back with Escape, which sends nothing.
    await moveWithKeyboard(handle, 1, { cancel: true })
    expect(rows(setsTable()).map((row) => row[1])).toEqual(['Aurore, Brume', 'Cyan', '-'])

    // Moved down two places, to the end, where it shows while that's saved, with a single request. Its handle keeps the
    // focus, greyed out, like the others, and the sets' other controls can't be used, until it's saved.
    await moveWithKeyboard(handle, 2)
    expect(rows(setsTable()).map((row) => row[1])).toEqual(['Cyan', '-', 'Aurore, Brume'])
    expect(requestsTo('PUT', '/api/admin/sets/set-1/position').map(jsonBody)).toEqual([{ position: 2 }])
    expect(requestsTo('PUT', '/api/admin/sets/set-2/position')).toHaveLength(0)
    expect(handle).toHaveFocus()
    for (const each of screen.getAllByRole('button', { name: /^réordonner : / })) expect(each).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('combobox', { name: 'Statut : Set de Cyan' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'supprimer : Set de Cyan' })).toBeDisabled()
    // Picking it up again does nothing.
    await moveWithKeyboard(handle, -1)
    expect(rows(setsTable()).map((row) => row[1])).toEqual(['Cyan', '-', 'Aurore, Brume'])
    expect(requestsTo('PUT', '/api/admin/sets/set-1/position')).toHaveLength(1)

    answer()
    await waitFor(() => expect(handle).not.toHaveAttribute('aria-disabled'))
    expect(rows(setsTable()).map((row) => [row[1], row[5]])).toEqual([
      ['Cyan', 'annulé'],
      ['-', 'annulé'],
      ['Aurore, Brume', 'planifié'],
    ])
    expect(handle).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("puts a set back where it was when its place can't be saved, saying why, its handle keeping the focus", async () => {
    mockFetch({ ...PAGE, 'PUT /api/admin/sets/set-1/position': { ok: false, error: 'Boom' }, 'PUT /api/admin/sets/set-3/position': { ok: false, error: 'Boom' } })
    renderAt('/admin/sessions/session-1')

    await screen.findByRole('table', { name: 'Sets' })
    const handle = screen.getByRole('button', { name: 'réordonner : Set de Aurore et Brume' })
    await moveWithKeyboard(handle, 1)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Le set « Set de Aurore et Brume » n'a pas pu être déplacé : Boom$/)
    expect(alert.compareDocumentPosition(setsTable()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(rows(setsTable()).map((row) => row[1])).toEqual(['Aurore, Brume', 'Cyan', '-'])
    expect(requestsTo('PUT', '/api/admin/sets/set-1/position').map(jsonBody)).toEqual([{ position: 1 }])
    expect(handle).not.toHaveAttribute('aria-disabled')
    expect(handle).toHaveFocus()

    // Moved up, to the start, then put back at the end, which puts its row back in the page.
    const last = screen.getByRole('button', { name: 'réordonner : Set' })
    await moveWithKeyboard(last, -2)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^Le set « Set » n'a pas pu être déplacé : Boom$/))
    expect(rows(setsTable()).map((row) => row[1])).toEqual(['Aurore, Brume', 'Cyan', '-'])
    expect(requestsTo('PUT', '/api/admin/sets/set-3/position').map(jsonBody)).toEqual([{ position: 0 }])
    expect(last).toHaveFocus()
  })

  it("doesn't put a set back over what the server answered for another change while its place was saved", async () => {
    const [first, cyan, cancelled] = SESSION.sets
    const changed = { ...SESSION, sets: [first, { ...cyan, durationMinutes: 45 }, cancelled] }
    mockFetch({ ...PAGE, ...ARTISTS, 'PUT /api/admin/sets/set-1/position': { ok: false, error: 'Boom' }, 'PATCH /api/admin/sets/set-2': { ok: true, session: changed } })
    const answer = holdMoves()
    renderAt('/admin/sessions/session-1')

    await screen.findByRole('table', { name: 'Sets' })
    await moveWithKeyboard(screen.getByRole('button', { name: 'réordonner : Set de Aurore et Brume' }), 1)
    // The set of Cyan saved from its form meanwhile.
    fireEvent.click(screen.getByRole('button', { name: 'modifier : Set de Cyan' }))
    await screen.findByRole('heading', { name: 'Set de Cyan' })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(rows(setsTable()).map((row) => row.slice(0, 2))).toEqual([['1 h', 'Aurore, Brume'], ['45 min', 'Cyan'], ['1 h', '-']]))

    answer()
    expect(await screen.findByRole('alert')).toHaveTextContent(/n'a pas pu être déplacé : Boom$/)
    expect(rows(setsTable()).map((row) => row.slice(0, 2))).toEqual([['1 h', 'Aurore, Brume'], ['45 min', 'Cyan'], ['1 h', '-']])
  })

  it("has one form open at a time, the session's or a set's", async () => {
    mockFetch({ ...PAGE, ...COLLECTIVES, ...RA_EVENTS, ...ARTISTS })
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
    mockFetch({ ...LOGGED_IN, ...COLLECTIVES, ...RA_EVENTS, '/api/admin/sessions/session-2': { ok: true, session: UNDATED }, 'PATCH /api/admin/sessions/session-2': { ok: true, session: dated } })
    renderAt('/admin/sessions/session-2')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(await screen.findByLabelText('date à déterminer')).toBeChecked()
    expect(within(screen.getByRole('group', { name: 'Durée' })).getByLabelText('heures')).toHaveValue(3)
    fireEvent.click(screen.getByLabelText('date à déterminer'))
    // Once the start has its day and its time, the end is filled in, both its day and its time.
    fireEvent.change(dayInput('Début'), { target: { value: '2026-11-14' } })
    expect(dayInput('Fin')).toHaveValue('2026-11-14')
    expect(shownTime(timeField('Fin'))).toBe('–– h ––')
    typeTime(timeField('Début'), '21:00')
    expect(dayInput('Fin')).toHaveValue('2026-11-15')
    expect(shownTime(timeField('Fin'))).toBe('0 h 00')
    expect(lasts()).toHaveTextContent(/^Dure 3 h\.$/)
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PATCH', '/api/admin/sessions/session-2')).toHaveLength(1))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sessions/session-2')[0])).toEqual({
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
  const PUBLICATION_URL = '/api/admin/sessions/session-1/ra-publication'
  const UNPUBLISHED = { ...SESSION, raEvent: null }
  const UNPUBLISHED_PAGE = { ...PAGE, '/api/admin/sessions/session-1': { ok: true, session: UNPUBLISHED } }
  const SAVED = { ...SESSION, raEvent: { id: '2400123', url: 'https://ra.co/events/2400123' } }

  async function openPanel() {
    fireEvent.click(within(await screen.findByLabelText('Session')).getByRole('button', { name: 'créer' }))
    await screen.findByRole('button', { name: 'Publier sur RA' })
  }

  // The session's page, its panel open, with the tab « Publier sur RA » opens, before it's sent to RA's form, and the
  // server's answer to the token's request, `token`, e.g. held back.
  async function openPanelWithTab(token: Body | Promise<Body>) {
    mockFetch({ ...UNPUBLISHED_PAGE, [`POST ${PUBLICATION_URL}`]: token })
    const tab = { opener: window as Window | null, closed: false, close: vi.fn(), location: { replace: vi.fn() } }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    renderAt('/admin/sessions/session-1')
    await openPanel()
    return { tab, open }
  }

  it('is only a link once the session has one', async () => {
    mockFetch(PAGE)
    renderAt('/admin/sessions/session-1')
    await screen.findByRole('heading', { level: 1, name: 'ONDES TAKEOVER' })
    expect(value('Événement RA')).toHaveTextContent(/^https:\/\/ra\.co\/events\/6683745$/)
    expect(screen.queryByRole('button', { name: 'créer' })).not.toBeInTheDocument()
  })

  it('opens a panel under "Événement RA", which says to log in to RA first, and where to create the event by hand', async () => {
    mockFetch(UNPUBLISHED_PAGE)
    renderAt('/admin/sessions/session-1')
    await screen.findByRole('heading', { level: 1, name: 'ONDES TAKEOVER' })
    expect(value('Événement RA')).toHaveTextContent(/^- créer$/)
    await openPanel()

    expect(within(value('Événement RA')).getByRole('link', { name: 'sur RA' })).toHaveAttribute('href', 'https://ra.co/pro/event/create')
    expect(value('Événement RA')).toHaveTextContent(
      "« Publier sur RA » ouvre RA, où le favori « Parking Radio → RA » vous montre l'événement, puis le crée et l'enregistre dans la session. Assurez-vous d'être connecté au bon compte RA avant de cliquer sur « Publier sur RA ». Si le favori ne fonctionne pas, créez l'événement sur RA à la main d'après la page de la session, puis collez son lien ci-dessous.",
    )
    expect(within(value('Événement RA')).getByText('avant').tagName).toBe('STRONG')
    expect(within(value('Événement RA')).queryByRole('link', { name: 'Intégrations' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^Attention/)).not.toBeInTheDocument()
    // Nothing is asked of the server until « Publier sur RA » is clicked.
    expect(requestsTo('POST', PUBLICATION_URL)).toHaveLength(0)

    // Closing it saves nothing, even a link that was pasted.
    fireEvent.change(screen.getByRole('textbox', { name: "Lien de l'événement RA" }), { target: { value: 'https://ra.co/events/2400123' } })
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

  it("opens a tab right away, then sends it to RA's form with a token for the session, once the server gives it", async () => {
    const token = held()
    const { tab, open } = await openPanelWithTab(token.body)

    fireEvent.click(screen.getByRole('button', { name: 'Publier sur RA' }))
    expect(open).toHaveBeenCalledWith('', '_blank')
    // RA's page can't reach the session's.
    expect(tab.opener).toBeNull()
    await waitFor(() => expect(requestsTo('POST', PUBLICATION_URL)).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Publier sur RA' })).toBeDisabled()
    expect(tab.location.replace).not.toHaveBeenCalled()

    await token.answer({ ok: true, token: 'the-token' })
    expect(tab.location.replace).toHaveBeenCalledWith('https://ra.co/pro/event/create#parking-radio=the-token')
    expect(screen.getByRole('button', { name: 'Publier sur RA' })).toBeEnabled()
    expect(tab.close).not.toHaveBeenCalled()
  })

  it("closes the tab, and says why, when the server doesn't give a token", async () => {
    const { tab } = await openPanelWithTab({ ok: false, error: 'No such session' })

    fireEvent.click(screen.getByRole('button', { name: 'Publier sur RA' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("La publication sur RA n'a pas pu être préparée : No such session")
    expect(tab.close).toHaveBeenCalled()
    expect(tab.location.replace).not.toHaveBeenCalled()
  })

  it('does nothing more once the tab is closed, and says when the browser opens none', async () => {
    const token = held()
    const { tab, open } = await openPanelWithTab(token.body)

    fireEvent.click(screen.getByRole('button', { name: 'Publier sur RA' }))
    await waitFor(() => expect(requestsTo('POST', PUBLICATION_URL)).toHaveLength(1))
    tab.closed = true
    await token.answer({ ok: true, token: 'the-token' })
    expect(screen.getByRole('button', { name: 'Publier sur RA' })).toBeEnabled()
    expect(tab.location.replace).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    open.mockReturnValue(null)
    fireEvent.click(screen.getByRole('button', { name: 'Publier sur RA' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("RA n'a pas pu s'ouvrir dans un nouvel onglet.")
    expect(requestsTo('POST', PUBLICATION_URL)).toHaveLength(1)
  })

  it("can't publish a session that has no date, or is cancelled", async () => {
    const expectUnavailable = async (session: Session, why: string) => {
      mockFetch({ ...PAGE, [`/api/admin/sessions/${session.id}`]: { ok: true, session } })
      const page = renderAt(`/admin/sessions/${session.id}`)
      await openPanel()
      const button = screen.getByRole('button', { name: 'Publier sur RA' })
      expect(button).toHaveAccessibleDescription(why)
      expect(button).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(button)
      expect(requestsTo('POST', `/api/admin/sessions/${session.id}/ra-publication`)).toHaveLength(0)
      page.unmount()
    }
    await expectUnavailable(UNDATED, "La session n'a pas de date.")
    await expectUnavailable({ ...UNPUBLISHED, status: 'cancelled' }, 'La session est annulée.')
  })

  it('warns, outside production, that the event will be created on RA all the same', async () => {
    mockFetch({ ...UNPUBLISHED_PAGE, '/api/config': { ...CONFIG, environment: 'test' } })
    renderAt('/admin/sessions/session-1')
    await openPanel()
    expect(await screen.findByText("Attention : l'événement sera vraiment créé sur RA, à partir d'une session de TEST.")).toBeInTheDocument()
    // The bookmarklet's name, as Intégrations gives it.
    expect(value('Événement RA')).toHaveTextContent('où le favori « Parking Radio → RA [TEST] » vous montre')
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
    // Those in the set aren't offered again.
    const picker = screen.getByRole('combobox', { name: 'Ajouter un artiste' })
    fireEvent.click(picker)
    expect(options()).toEqual(['Brumebrume@example.com'])
    fireEvent.change(picker, { target: { value: 'cyan' } })
    expect(options()).toEqual([])
    expect(screen.getByRole('listbox')).toHaveTextContent(/^aucun résultat$/)
    fireEvent.keyDown(picker, { key: 'Escape' })
    fireEvent.click(screen.getByLabelText('DJ'))

    // Their first genres, in the order of a collective's genres, up to 3.
    expect(screen.getByText(/^Genres de ses artistes : house, techno, acid\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'reprendre les genres des artistes' }))
    expect(screen.getByRole('button', { name: 'retirer house' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'reprendre les genres des artistes' })).not.toBeInTheDocument()
    // Aurore first, dragged up by her handle.
    await moveWithKeyboard(screen.getByRole('button', { name: 'réordonner Aurore' }), -1)

    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Nouveau set' })).not.toBeInTheDocument())
    expect(rows(setsTable())).toHaveLength(4)
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions/session-1/sets')[0])).toEqual({
      performers: [{ id: 'artist-1' }, { id: 'artist-3' }],
      durationMinutes: 30,
      performanceTypes: ['dj'],
      otherPerformanceType: '',
      genres: ['house', 'techno', 'acid'],
      soundcloudTrack: null,
      youtubeVideo: null,
      // Aurore's, picked as she was added, Cyan's being planned already.
      application: 'application-3',
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
    mockFetch({ ...SET_PAGE, 'PATCH /api/admin/sets/set-2': { ok: true, session: SESSION } })
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
    await waitFor(() => expect(requestsTo('PATCH', '/api/admin/sets/set-2')).toHaveLength(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sets/set-2')[0])).toEqual({
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
    expect(requestsTo('PATCH', '/api/admin/sets/set-3')).toHaveLength(0)
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

  const applicationPicker = () => screen.getByRole('combobox', { name: 'Candidature' })

  it("picks the set's application among its performers' only, which is taken away once it isn't one of theirs anymore", async () => {
    // Brume's is planned already, so that none is picked in place of Aurore's once she's taken out.
    const applications = APPLICATIONS_LIST.map((each) => (each.id === 'application-4' ? { ...each, status: 'planned' as const } : each))
    mockFetch({ ...SET_PAGE, '/api/admin/applications': { ok: true, total: 4, applications }, 'PATCH /api/admin/sets/set-1': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Aurore et Brume' }))
    expect(await screen.findByRole('heading', { name: 'Set de Aurore et Brume' })).toBeInTheDocument()
    expect(applicationPicker()).toHaveValue('Aucune candidature')
    fireEvent.click(applicationPicker())
    // Its performers', in their order, each named by its artist and when it was received, with its status and dates.
    expect(options()).toEqual([
      'Aucune candidature',
      'Aurore, reçue le 15 août 2026nouvelle · 14 nov. 2026, 21 nov. 2026, 28 nov. 2026 (+1)',
      'Brume, reçue le 20 août 2026planifiée · 5 déc. 2026',
    ])
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Aurore, reçue le 15 août 2026/ }))
    expect(applicationPicker()).toHaveValue('Aurore, reçue le 15 août 2026')

    // Taking Aurore out of the set takes it away, and it's no longer offered.
    fireEvent.click(screen.getByRole('button', { name: 'retirer Aurore' }))
    expect(applicationPicker()).toHaveValue('Aucune candidature')
    fireEvent.click(applicationPicker())
    expect(options()).toEqual(['Aucune candidature', 'Brume, reçue le 20 août 2026planifiée · 5 déc. 2026'])
    fireEvent.keyDown(applicationPicker(), { key: 'Escape' })
    // Adding her back picks it again, as her only one.
    pick('Aurore')
    expect(applicationPicker()).toHaveValue('Aurore, reçue le 15 août 2026')
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PATCH', '/api/admin/sets/set-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sets/set-1')[0])).toMatchObject({ performers: [{ id: 'artist-2' }, { id: 'artist-1' }], application: 'application-3' })
  })

  // As Brume's application is rejected.
  const WITH_REJECTED = {
    '/api/admin/applications': {
      ok: true,
      total: APPLICATIONS_LIST.length,
      applications: APPLICATIONS_LIST.map((each) => (each.id === 'application-4' ? { ...each, status: 'rejected', decision: 'rejected' } : each)),
    },
  }
  const brumes = () => screen.getByRole('option', { name: /^Brume, reçue le 20 août 2026/ })

  // Opens the form of the set of Aurore and Brume, with its session and its sets that have `status`, and its applications.
  async function openWithRejected(status: Session['status']) {
    const session = { ...SESSION, status, sets: SESSION.sets.map((set) => ({ ...set, status })) }
    mockFetch({ ...SET_PAGE, ...WITH_REJECTED, '/api/admin/sessions/session-1': { ok: true, session } })
    renderAt('/admin/sessions/session-1')
    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Aurore et Brume' }))
    await screen.findByRole('heading', { name: 'Set de Aurore et Brume' })
    fireEvent.click(applicationPicker())
  }

  it("greys out its performers' rejected applications, which a planned set can't have", async () => {
    await openWithRejected('planned')
    expect(brumes()).toHaveTextContent('refusée')
    expect(brumes()).toHaveAttribute('aria-disabled', 'true')
    fireEvent.mouseDown(brumes())
    expect(screen.getByRole('listbox')).toBeVisible()
  })

  it("lets a cancelled set have its performers' rejected applications", async () => {
    await openWithRejected('cancelled')
    expect(brumes()).not.toHaveAttribute('aria-disabled')
    fireEvent.mouseDown(brumes())
    expect(applicationPicker()).toHaveValue('Brume, reçue le 20 août 2026')
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
    // Brume's, the only one, is picked as she's added.
    pick('Brume')
    expect(applicationPicker()).toHaveValue('Brume, reçue le 20 août 2026')
  })

  it("picks its performers' only new or accepted application as an artist is added or taken out, but not as they're reordered", async () => {
    mockFetch(SET_PAGE)
    renderAt('/admin/sessions/session-1')

    await openNew()
    pick('Aurore')
    expect(applicationPicker()).toHaveValue('Aurore, reçue le 15 août 2026')
    // Kept as Brume is added.
    pick('Brume')
    expect(applicationPicker()).toHaveValue('Aurore, reçue le 15 août 2026')
    fireEvent.click(applicationPicker())
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Aucune candidature' }))
    // Brume's makes two, until she's taken out, and Cyan's is planned already: Aurore's is then the only one.
    pick('Cyan')
    expect(applicationPicker()).toHaveValue('Aucune candidature')
    fireEvent.click(screen.getByRole('button', { name: 'retirer Brume' }))
    expect(applicationPicker()).toHaveValue('Aurore, reçue le 15 août 2026')
    fireEvent.click(applicationPicker())
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Aucune candidature' }))
    await moveWithKeyboard(screen.getByRole('button', { name: 'réordonner Cyan' }), -1)
    expect(applicationPicker()).toHaveValue('Aucune candidature')
  })

  it("replaces an application that isn't its performers' anymore with their only new or accepted one", async () => {
    mockFetch({ ...SET_PAGE, 'POST /api/admin/sessions/session-1/sets': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    pick('Aurore')
    pick('Cyan')
    // Cyan's is planned already: Brume's is then the only one.
    fireEvent.click(screen.getByRole('button', { name: 'retirer Aurore' }))
    pick('Brume')
    expect(applicationPicker()).toHaveValue('Brume, reçue le 20 août 2026')
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le set' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions/session-1/sets')).toHaveLength(1))
    expect(jsonBody(requestsTo('POST', '/api/admin/sessions/session-1/sets')[0])).toMatchObject({ performers: [{ id: 'artist-3' }, { id: 'artist-2' }], application: 'application-4' })
  })

  it("takes away an application that isn't its performers' anymore when they have none that's new or accepted, or several", async () => {
    const brumes = application('application-6', { artistId: 'artist-2' }, '2026-09-05T16:00:00.000Z', 'new', ['2026-12-12'])
    mockFetch({ ...SET_PAGE, '/api/admin/applications': { ok: true, total: 5, applications: [brumes, ...APPLICATIONS_LIST] } })
    renderAt('/admin/sessions/session-1')

    // Cyan's is planned already.
    await openNew()
    pick('Aurore')
    pick('Cyan')
    fireEvent.click(screen.getByRole('button', { name: 'retirer Aurore' }))
    expect(applicationPicker()).toHaveValue('Aucune candidature')
    fireEvent.click(screen.getByRole('button', { name: 'annuler' }))

    // Brume has two.
    await openNew()
    pick('Aurore')
    pick('Brume')
    expect(applicationPicker()).toHaveValue('Aurore, reçue le 15 août 2026')
    fireEvent.click(screen.getByRole('button', { name: 'retirer Aurore' }))
    expect(applicationPicker()).toHaveValue('Aucune candidature')
  })

  it.each(['done', 'cancelled'] as const)("takes a %s set's application away once it isn't its performers', without picking another", async (status) => {
    mockFetch({ ...SET_PAGE, '/api/admin/sessions/session-1': { ok: true, session: withStatus(SESSION, status) } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Cyan' }))
    await screen.findByRole('heading', { name: 'Set de Cyan' })
    expect(applicationPicker()).toHaveValue('Cyan, reçue le 2 septembre 2026')
    pick('Aurore')
    expect(applicationPicker()).toHaveValue('Cyan, reçue le 2 septembre 2026')
    // Not Aurore's, though it's her only one, and no longer its own.
    fireEvent.click(screen.getByRole('button', { name: 'retirer Cyan' }))
    expect(applicationPicker()).toHaveValue('Aucune candidature')
    fireEvent.click(applicationPicker())
    expect(options()).toEqual(['Aucune candidature', 'Aurore, reçue le 15 août 2026nouvelle · 14 nov. 2026, 21 nov. 2026, 28 nov. 2026 (+1)'])
  })

  it("doesn't pick a planned application, which can be picked by hand, but picks a new one alongside it", async () => {
    // Aurore has another one, planned already.
    const planned = application('application-7', { artistId: 'artist-1' }, '2026-07-01T16:00:00.000Z', 'planned', ['2026-10-10'])
    mockFetch({ ...SET_PAGE, '/api/admin/applications': { ok: true, total: 5, applications: [...APPLICATIONS_LIST, planned] } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    pick('Cyan')
    expect(applicationPicker()).toHaveValue('Aucune candidature')
    fireEvent.click(applicationPicker())
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Cyan, reçue le 2 septembre 2026/ }))
    // Kept, since it's still one of theirs, though Aurore has one that's new, which replaces it once Cyan is taken out.
    pick('Aurore')
    expect(applicationPicker()).toHaveValue('Cyan, reçue le 2 septembre 2026')
    fireEvent.click(screen.getByRole('button', { name: 'retirer Cyan' }))
    expect(applicationPicker()).toHaveValue('Aurore, reçue le 15 août 2026')
  })

  it.each([
    ['planned', 'Brume, reçue le 20 août 2026'],
    ['done', 'Aucune candidature'],
    ['cancelled', 'Aucune candidature'],
  ] as const)("doesn't pick a %s set's application as its form opens, nor once an artist is added unless it's planned", async (status, picked) => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/sessions/session-2': { ok: true, session: withStatus(UNDATED, status) } })
    renderAt('/admin/sessions/session-2')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Brume' }))
    await screen.findByRole('heading', { name: 'Set de Brume' })
    // Brume's only one, since the set can be meant to have none.
    expect(applicationPicker()).toHaveValue('Aucune candidature')
    // Cyan's is planned already.
    pick('Cyan')
    expect(applicationPicker()).toHaveValue(picked)
  })

  it('picks no application for a cancelled set in a planned session', async () => {
    mockFetch(SET_PAGE)
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set' }))
    await screen.findByRole('heading', { name: 'Set' })
    pick('Aurore')
    expect(applicationPicker()).toHaveValue('Aucune candidature')
  })

  it("picks a new set's application in a done session", async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/sessions/session-2': { ok: true, session: withStatus(UNDATED, 'done') } })
    renderAt('/admin/sessions/session-2')

    await openNew()
    pick('Aurore')
    expect(applicationPicker()).toHaveValue('Aurore, reçue le 15 août 2026')
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
    mockFetch({ ...PAGE, ...ARTISTS, '/api/admin/applications': { ok: false, error: 'Boom' }, 'PATCH /api/admin/sets/set-2': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier : Set de Cyan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Les candidatures n'ont pas pu être chargées : Boom")
    // Named by when it was received only, since whose it is isn't known, which changing the performers doesn't change.
    expect(applicationPicker()).toHaveValue('Reçue le 2 septembre 2026')
    fireEvent.click(screen.getByRole('button', { name: 'retirer Cyan' }))
    pick('Aurore')
    expect(applicationPicker()).toHaveValue('Reçue le 2 septembre 2026')
    fireEvent.click(applicationPicker())
    expect(options()).toEqual(['Aucune candidature', 'Reçue le 2 septembre 2026'])
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Aucune candidature' }))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(requestsTo('PATCH', '/api/admin/sets/set-2')).toHaveLength(1))
    expect(jsonBody(requestsTo('PATCH', '/api/admin/sets/set-2')[0])).toMatchObject({ application: null })
  })

  it('says when the artists could not be loaded', async () => {
    mockFetch({ ...PAGE, ...APPLICATIONS, '/api/admin/artists': { ok: false, error: 'Boom' } })
    renderAt('/admin/sessions/session-1')

    await openNew()
    expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom")
    expect(screen.getByRole('combobox', { name: 'Ajouter un artiste' })).toBeDisabled()
  })

  describe("in a takeover's set", () => {
    const LE_BRUME = artist('artist-4', 'Le Brume', ['ambient'])
    // Ondes' artists, out of the order of their names, one of whom was deleted since.
    const members = [
      { id: 'artist-3', name: 'Cyan' },
      { id: 'artist-1', name: 'Aurore' },
      { id: 'artist-9', name: 'Zéphyr' },
      { id: 'artist-4', name: 'Le Brume' },
    ]
    const TAKEOVER_PAGE = {
      ...PAGE,
      ...APPLICATIONS,
      '/api/admin/artists': { ok: true, artists: [AURORE, BRUME, CYAN, LE_BRUME] },
      '/api/admin/collectives/collective-1': { ok: true, collective: { ...ONDES, members } },
    }
    const picker = () => screen.getByRole('combobox', { name: 'Ajouter un artiste' })

    it("picks a member's own application, never its collective's", async () => {
      mockFetch(TAKEOVER_PAGE)
      renderAt('/admin/sessions/session-1')

      await openNew()
      pick('Le Brume')
      expect(applicationPicker()).toHaveValue('')
      pick('Aurore')
      expect(applicationPicker()).toHaveValue('Aurore, reçue le 15 août 2026')
    })

    it("offers its collective's artists first, in its order, marked with its name, which stay first while a name is typed, but not the set's", async () => {
      mockFetch(TAKEOVER_PAGE)
      renderAt('/admin/sessions/session-1')

      await openNew()
      pick('Cyan')
      fireEvent.click(picker())
      expect(options()).toEqual(['AuroreOndes', 'Le BrumeOndes', 'Brumebrume@example.com'])
      fireEvent.keyDown(picker(), { key: 'Escape' })

      // Ahead of Brume, whose name starts with it.
      fireEvent.change(picker(), { target: { value: 'brume' } })
      expect(options()).toEqual(['Le BrumeOndes', 'Brumebrume@example.com'])
      fireEvent.keyDown(picker(), { key: 'Enter' })
      expect(screen.getByRole('button', { name: 'retirer Le Brume' })).toBeInTheDocument()
    })

    it('waits for its collective before it shows', async () => {
      let answer: (value: Response) => void = () => {}
      const answered: string[] = []
      mockFetch(TAKEOVER_PAGE)
      const answering = vi.mocked(fetch).getMockImplementation()!
      // The collective is held back until it's answered.
      vi.mocked(fetch).mockImplementation(async (input, options) => {
        const url = input instanceof Request ? input.url : String(input)
        if (url.endsWith('/api/admin/collectives/collective-1')) return new Promise((resolve) => (answer = resolve))
        const response = await answering(input, options)
        answered.push(new URL(url, 'http://localhost').pathname)
        return response
      })
      renderAt('/admin/sessions/session-1')

      fireEvent.click(await screen.findByRole('button', { name: 'ajouter un set' }))
      await waitFor(() => expect(answered).toEqual(expect.arrayContaining(['/api/admin/artists', '/api/admin/applications'])))
      // Time enough for the form to show, if it didn't wait.
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
      expect(screen.queryByRole('heading', { name: 'Nouveau set' })).not.toBeInTheDocument()

      answer(Response.json({ ok: true, collective: { ...ONDES, members } }))
      await screen.findByRole('heading', { name: 'Nouveau set' })
      fireEvent.click(picker())
      expect(options()).toEqual(['CyanOndes', 'AuroreOndes', 'Le BrumeOndes', 'Brumebrume@example.com'])
    })

    it('says when its collective could not be loaded, and offers the artists as in other sets', async () => {
      mockFetch({ ...TAKEOVER_PAGE, '/api/admin/collectives/collective-1': { ok: false, error: 'Boom' } })
      renderAt('/admin/sessions/session-1')

      await openNew()
      expect(screen.getByRole('alert')).toHaveTextContent("Le collectif du takeover n'a pas pu être chargé : Boom")
      fireEvent.click(picker())
      expect(options()).toEqual(['Auroreaurore@example.com', 'Brumebrume@example.com', 'Cyancyan@example.com', 'Le Brumele brume@example.com'])
    })

    it("doesn't load a collective for another type's set", async () => {
      mockFetch({ ...TAKEOVER_PAGE, '/api/admin/sessions/session-1': { ok: true, session: { ...SESSION, type: 'guest-mixes', takeover: null, application: null, title: 'GUEST MIXES' } } })
      renderAt('/admin/sessions/session-1')

      await openNew()
      fireEvent.click(picker())
      expect(options()).toEqual(['Auroreaurore@example.com', 'Brumebrume@example.com', 'Cyancyan@example.com', 'Le Brumele brume@example.com'])
      expect(requestsTo('GET', '/api/admin/collectives/collective-1')).toEqual([])
    })
  })
})

describe('Moving a set to another session', () => {
  // The next Saturday, from 21:00 to 22:00 in Québec, with a set of an hour, which is planned.
  const NEXT: Session = {
    ...UNDATED,
    id: 'session-5',
    start: '2026-11-22T02:00:00.000Z',
    end: '2026-11-22T03:00:00.000Z',
    durationMinutes: 60,
    name: 'SOIRÉE SUIVANTE',
    title: 'SOIRÉE SUIVANTE',
    sets: [studioSet('set-7', { performers: [{ id: 'artist-2', name: 'Brume' }], durationMinutes: 60 })],
  }
  const CANCELLED = SESSIONS[3]
  const MOVE_PAGE = { ...PAGE, ...ARTISTS, '/api/admin/sessions': { ok: true, total: 5, sessions: [UNDATED, NEXT, ...SESSIONS.slice(1)] } }
  const picker = () => screen.getByRole('combobox', { name: 'Session' })
  const go = () => screen.getByRole('button', { name: 'déplacer' })
  const notice = () => screen.queryByText(/a été déplacé dans la session/)

  it('picks the session among the others, the planned ones first, moves the set there, and says where it went, the focus on the next set', async () => {
    const left = { ...SESSION, status: 'done' as const, sets: [CYAN_SET, SESSION.sets[2]] }
    mockFetch({ ...MOVE_PAGE, 'PUT /api/admin/sets/set-1/session': { ok: true, session: { ...NEXT, sets: [...NEXT.sets, SET] }, previousSession: left } })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'déplacer : Set de Aurore et Brume' }))
    expect(screen.getByRole('heading', { level: 3, name: 'Déplacer le set de Aurore et Brume' })).toBeInTheDocument()
    await waitFor(() => expect(picker()).toHaveAttribute('placeholder', 'choisir une session…'))
    expect(picker()).toHaveFocus()
    expect(go()).toHaveAttribute('aria-disabled', 'true')
    expect(go()).toHaveAccessibleDescription("Choisissez d'abord une session.")

    // Not the session itself: the planned ones in the order of the list's default view, then the others, in the order
    // of its « toutes » view, with their status.
    fireEvent.click(picker())
    expect(options()).toEqual([
      'SOIRÉE SUIVANTE, sam. 21 nov. 202621 h – 22 h',
      'GUEST MIXES, date à déterminer3 h',
      'SOIRÉE, ven. 2 oct. 202620 h – 21 h · jouée',
      'LIVE PERFORMANCE, lun. 31 août 202620 h – 21 h · annulée',
    ])
    // Searched as the list of sessions is.
    fireEvent.change(picker(), { target: { value: 'samedi' } })
    expect(options()).toEqual(['SOIRÉE SUIVANTE, sam. 21 nov. 202621 h – 22 h'])
    fireEvent.mouseDown(screen.getByRole('option', { name: /^SOIRÉE SUIVANTE/ }))
    expect(go()).not.toHaveAttribute('aria-disabled')
    fireEvent.click(go())

    // The focus goes to the next set's « déplacer », in the commit that removes the row (see the tests of deleting one).
    let focused: Element | null = null
    await waitFor(() => {
      expect(rows(setsTable())).toHaveLength(2)
      focused = document.activeElement
    })
    expect(focused).toBe(screen.getByRole('button', { name: 'déplacer : Set de Cyan' }))
    expect(jsonBody(requestsTo('PUT', '/api/admin/sets/set-1/session')[0])).toEqual({ session: 'session-5' })
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
    // The session it left, as the server then has it, which is now jouée.
    expect(within(screen.getByRole('group', { name: 'Statut' })).getByRole('button', { name: 'jouée' })).toHaveAttribute('aria-pressed', 'true')
    expect(notice()).toHaveTextContent(/^Le set de Aurore et Brume a été déplacé dans la session SOIRÉE SUIVANTE, sam\. 21 nov\. 2026\.$/)
    expect(within(notice()!).getByRole('link')).toHaveAttribute('href', '/admin/sessions/session-5')
    // It doesn't say that the sets of the session the set went to now add up to more than it: that session's page does.
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument()

    // Until another form opens.
    fireEvent.click(screen.getByRole('button', { name: 'ajouter un set' }))
    expect(notice()).not.toBeInTheDocument()
  })

  it("moves the focus to the previous set's « déplacer » once the last one is moved, or to the heading once there are none", async () => {
    const two = { ...SESSION, sets: [SET, CYAN_SET] }
    mockFetch({
      ...MOVE_PAGE,
      '/api/admin/sessions/session-1': { ok: true, session: two },
      'PUT /api/admin/sets/set-2/session': { ok: true, session: { ...NEXT, sets: [...NEXT.sets, CYAN_SET] }, previousSession: { ...two, sets: [SET] } },
      'PUT /api/admin/sets/set-1/session': { ok: true, session: { ...NEXT, sets: [...NEXT.sets, CYAN_SET, SET] }, previousSession: { ...two, sets: [] } },
    })
    renderAt('/admin/sessions/session-1')

    for (const [name, next] of [
      ['Set de Cyan', () => screen.getByRole('button', { name: 'déplacer : Set de Aurore et Brume' })],
      ['Set de Aurore et Brume', () => screen.getByRole('heading', { level: 2, name: 'Sets' })],
    ] as const) {
      fireEvent.click(await screen.findByRole('button', { name: `déplacer : ${name}` }))
      await waitFor(() => expect(picker()).toHaveAttribute('placeholder', 'choisir une session…'))
      fireEvent.click(picker())
      fireEvent.mouseDown(screen.getByRole('option', { name: /^SOIRÉE SUIVANTE/ }))
      fireEvent.click(go())
      let focused: Element | null = null
      await waitFor(() => {
        expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
        focused = document.activeElement
      })
      expect(focused).toBe(next())
      expect(notice()).toBeInTheDocument()
    }
  })

  it("can't move a set that isn't cancelled to a cancelled session, which it says, but moves a cancelled one, and says why the server refused", async () => {
    mockFetch({
      ...MOVE_PAGE,
      'PUT /api/admin/sets/set-3/session': { ok: false, error: 'This session is cancelled', session: CANCELLED, set: null },
    })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'déplacer : Set de Cyan' }))
    await waitFor(() => expect(picker()).toHaveAttribute('placeholder', 'choisir une session…'))
    fireEvent.click(picker())
    fireEvent.mouseDown(screen.getByRole('option', { name: /^LIVE PERFORMANCE/ }))
    expect(go()).toHaveAttribute('aria-disabled', 'true')
    expect(go()).toHaveAccessibleDescription('La session est annulée : on ne peut pas y déplacer le set.')
    fireEvent.click(go())
    expect(requestsTo('PUT', '/api/admin/sets/set-2/session')).toHaveLength(0)
    // A session that's played can be picked.
    fireEvent.click(picker())
    fireEvent.mouseDown(screen.getByRole('option', { name: /^SOIRÉE,/ }))
    expect(go()).not.toHaveAttribute('aria-disabled')

    // Closed, the focus goes back to the button that opened it.
    fireEvent.click(screen.getByRole('button', { name: 'annuler' }))
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'déplacer : Set de Cyan' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'déplacer : Set' }))
    await waitFor(() => expect(picker()).toHaveAttribute('placeholder', 'choisir une session…'))
    fireEvent.click(picker())
    fireEvent.mouseDown(screen.getByRole('option', { name: /^LIVE PERFORMANCE/ }))
    expect(go()).not.toHaveAttribute('aria-disabled')
    fireEvent.click(go())
    // In the panel, which stays open, naming the session in the way, linked.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      /^Le set « Set » n'a pas pu être déplacé dans une autre session : This session is cancelled \(LIVE PERFORMANCE, lun\. 31 août 2026\)$/,
    )
    expect(within(alert).getByRole('link')).toHaveAttribute('href', '/admin/sessions/session-4')
    expect(screen.getByRole('heading', { level: 3, name: 'Déplacer le set' })).toBeInTheDocument()
    expect(rows(setsTable())).toHaveLength(3)
  })

  it("is one of the forms open one at a time, closed once its set is deleted, and says when the sessions can't be loaded", async () => {
    mockFetch({
      ...MOVE_PAGE,
      '/api/admin/sessions': { ok: false, error: 'Boom' },
      'DELETE /api/admin/sets/set-2': { ok: true, session: { ...SESSION, sets: [SET, SESSION.sets[2]] } },
    })
    renderAt('/admin/sessions/session-1')

    fireEvent.click(await screen.findByRole('button', { name: 'déplacer : Set de Cyan' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les sessions n'ont pas pu être chargées : Boom"))
    fireEvent.click(picker())
    expect(options()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'modifier : Set de Cyan' }))
    expect(await screen.findByRole('heading', { level: 3, name: 'Set de Cyan' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Session' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'déplacer : Set de Cyan' }))
    expect(screen.getByRole('heading', { level: 3, name: 'Déplacer le set de Cyan' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Set de Cyan' })).not.toBeInTheDocument()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'supprimer : Set de Cyan' }))
    await waitFor(() => expect(rows(setsTable())).toHaveLength(2))
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
  })
})

// Fills a new session's form in, from 21:00 on Saturday, November 14, 2026, to 1:00 the next day, as guest mixes, unless
// it's told otherwise.
async function fillIn({ day = '2026-11-14', start = '21:00', endDay = '2026-11-15', end = '01:00', type = 'Guest mixes' as string | null } = {}) {
  await screen.findByRole('group', { name: 'Début' })
  fireEvent.change(dayInput('Début'), { target: { value: day } })
  typeTime(timeField('Début'), start)
  fireEvent.change(dayInput('Fin'), { target: { value: endDay } })
  typeTime(timeField('Fin'), end)
  if (type) fireEvent.click(screen.getByRole('radio', { name: type }))
}

describe('Adding a session', () => {
  const NEW = { ...LOGGED_IN, ...COLLECTIVES, ...RA_EVENTS }

  it('adds a session, from its start to its end, each a day and a time, and goes to its page', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')

    await fillIn()
    expect(lasts()).toHaveTextContent(/^Dure 4 h\.$/)
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

  it("fills its times in from one of the programmation's time slots, picked before its day, or only its duration without a date", async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')

    await screen.findByRole('group', { name: 'Début' })
    fireEvent.click(slot('13 h – 17 h'))
    expect(slot('13 h – 17 h')).toHaveAttribute('aria-pressed', 'true')
    expect(shownTime(timeField('Début'))).toBe('13 h 00')
    expect(shownTime(timeField('Fin'))).toBe('17 h 00')
    // The end takes the start's day once it has one.
    fireEvent.change(dayInput('Début'), { target: { value: '2026-11-14' } })
    expect(dayInput('Fin')).toHaveValue('2026-11-14')
    expect(slot('13 h – 17 h')).toHaveAttribute('aria-pressed', 'true')

    // Without a date, a slot only gives the session its length, and none shows as picked.
    fireEvent.click(screen.getByLabelText('date à déterminer'))
    const duration = within(screen.getByRole('group', { name: 'Durée' }))
    fireEvent.change(duration.getByLabelText('heures'), { target: { value: '2' } })
    expect(slot('13 h – 17 h')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(slot('11 h – 15 h'))
    expect(duration.getByLabelText('heures')).toHaveValue(4)
    expect(duration.getByLabelText('minutes')).toHaveValue(0)
    expect(slot('11 h – 15 h')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('radio', { name: 'Guest mixes' }))
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ start: null, durationMinutes: 240 })
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
    typeTime(timeField('Début'), '23:00')
    expect(shownTime(timeField('Fin'))).toBe('–– h ––')
    fireEvent.change(dayInput('Début'), { target: { value: '2026-11-14' } })
    expect(dayInput('Fin')).toHaveValue('2026-11-15')
    expect(shownTime(timeField('Fin'))).toBe('1 h 30')
    expect(lasts()).toHaveTextContent(/^Dure 2 h 30\.$/)
  })

  it('adds a session that lasts several days', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')

    await fillIn({ day: '2026-11-13', start: '18:00', endDay: '2026-11-15', end: '02:00' })
    expect(lasts()).toHaveTextContent(/^Dure 32 h\.$/)
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
    expect(timeHour('Fin')).toHaveAttribute('aria-invalid', 'true')
    expect(lasts()).not.toBeInTheDocument()
    expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(0)
  })

  it("gives the end the start's day, then keeps its distance in days from it, even when the start's day is cleared on the way", async () => {
    mockFetch(NEW)
    renderAt('/admin/sessions/nouvelle')

    await screen.findByRole('group', { name: 'Début' })
    fireEvent.change(dayInput('Début'), { target: { value: '2026-11-14' } })
    expect(dayInput('Fin')).toHaveValue('2026-11-14')
    // Changed by hand, it keeps that distance.
    fireEvent.change(dayInput('Fin'), { target: { value: '2026-11-16' } })
    fireEvent.change(dayInput('Début'), { target: { value: '2026-11-20' } })
    expect(dayInput('Fin')).toHaveValue('2026-11-22')
    // As browsers do while a day is typed.
    fireEvent.change(dayInput('Début'), { target: { value: '' } })
    expect(dayInput('Fin')).toHaveValue('2026-11-22')
    fireEvent.change(dayInput('Début'), { target: { value: '2026-11-02' } })
    fireEvent.change(dayInput('Début'), { target: { value: '2026-11-27' } })
    expect(dayInput('Fin')).toHaveValue('2026-11-29')
  })

  it("refuses a time that the clocks skip, at the start or at the end", async () => {
    mockFetch(NEW)
    renderAt('/admin/sessions/nouvelle')

    const skipped = "Cette heure n'existe pas cette nuit-là, au passage à l'heure d'été."
    await fillIn({ day: '2026-03-08', start: '02:30', endDay: '2026-03-08', end: '04:00' })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    expect(await screen.findByText(skipped)).toBeInTheDocument()
    expect(timeHour('Début')).toHaveAttribute('aria-invalid', 'true')

    await fillIn({ day: '2026-03-07', start: '23:00', endDay: '2026-03-08', end: '02:30' })
    expect(await screen.findByText(skipped)).toBeInTheDocument()
    expect(timeHour('Fin')).toHaveAttribute('aria-invalid', 'true')
    expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(0)
  })

  it('picks the event on RA among every one read from RA, the upcoming ones first, found by title, day or number', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/sessions': { ok: true, session: SESSION } })
    renderAt('/admin/sessions/nouvelle')
    await fillIn()

    expect(screen.queryByLabelText("Lien de l'événement")).not.toBeInTheDocument()
    const picker = screen.getByRole('combobox', { name: 'Événement RA' })
    await waitFor(() => expect(picker).not.toHaveAttribute('placeholder', 'chargement des événements…'))
    expect(requestsTo('GET', RA_EVENTS_URL)).toHaveLength(1)
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
    expect(spaced((picker as HTMLInputElement).value)).toBe('PLUS TÔT, mar. 1 sept. 2026')
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
    // Its application, the collective's only one, is picked with it.
    expect(screen.getByRole('combobox', { name: 'Candidature' })).toHaveValue('Reçue le 1 septembre 2026')
    fireEvent.click(screen.getByRole('combobox', { name: 'Candidature' }))
    expect(options()).toEqual(['Aucune candidature', 'Reçue le 1 septembre 2026retenue · 14 nov. 2026, 21 nov. 2026'])
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Candidature' }), { key: 'Escape' })
    await fillIn({ type: null })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/sessions')).toHaveLength(1))
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0])).toMatchObject({ type: 'takeover', takeover: 'collective-1', application: 'application-1' })
    first.unmount()

    renderAt('/admin/sessions/nouvelle?takeover=unknown')
    expect(await screen.findByRole('radio', { name: 'Takeover' })).not.toBeChecked()
    expect(screen.queryByRole('combobox', { name: 'Collectif' })).not.toBeInTheDocument()
  })

  it("picks the application of the collective of the link as when the collective is picked in the form", async () => {
    const VAGUES: Collective = { ...ONDES, id: 'collective-2', name: 'Vagues', email: 'vagues@example.com' }
    mockFetch({ ...NEW, '/api/admin/collectives': { ok: true, collectives: [ONDES, VAGUES] } })
    renderAt('/admin/sessions/nouvelle?takeover=collective-1')

    const picker = await screen.findByRole('combobox', { name: 'Candidature' })
    expect(picker).toHaveValue('Reçue le 1 septembre 2026')
    // Taken away with another collective, which has none, and picked again with Ondes.
    fireEvent.click(screen.getByRole('combobox', { name: 'Collectif' }))
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Vagues/ }))
    expect(picker).toHaveValue('')
    expect(picker).toHaveAttribute('placeholder', 'Aucune candidature de ce collectif.')
    fireEvent.click(screen.getByRole('combobox', { name: 'Collectif' }))
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Ondes/ }))
    expect(picker).toHaveValue('Reçue le 1 septembre 2026')
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
    // Ondes' only one is picked with it.
    fireEvent.click(screen.getByRole('combobox', { name: 'Collectif' }))
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Ondes/ }))
    expect(picker).toHaveValue('Reçue le 1 septembre 2026')
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
  const NEW = { ...LOGGED_IN, ...COLLECTIVES, ...RA_EVENTS, ...ARTISTS }

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

  it('lists sets in the order they are added, which dragging them changes, and sends them with the session in that order', async () => {
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

    // Moved down two places with its handle, which keeps the focus, while another set's form is open, which stays that
    // set's, though it's moved up.
    fireEvent.click(screen.getByRole('button', { name: 'modifier : Set de Cyan' }))
    await screen.findByRole('heading', { name: 'Set de Cyan' })
    await moveWithKeyboard(screen.getByRole('button', { name: 'réordonner : Set de Brume' }), 2)
    expect(rows(setsTable()).map((row) => row[1])).toEqual(['Cyan', 'Aurore', 'Brume'])
    expect(screen.getByRole('button', { name: 'réordonner : Set de Brume' })).toHaveFocus()
    lasting('0', '45')(setForm('Set de Cyan'))
    fireEvent.click(setForm('Set de Cyan').getByRole('button', { name: 'enregistrer' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Set de Cyan' })).not.toBeInTheDocument())
    expect(rows(setsTable()).map((row) => row.slice(0, 2))).toEqual([
      ['45 min', 'Cyan'],
      ['à déterminer', 'Aurore'],
      ['1 h', 'Brume'],
    ])
    fireEvent.click(screen.getByRole('button', { name: 'retirer : Set de Cyan' }))
    expect(rows(setsTable()).map((row) => row[1])).toEqual(['Aurore', 'Brume'])

    fireEvent.click(screen.getByRole('button', { name: 'ajouter la session' }))
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/sessions\/session-1$/))
    const empty = { performanceTypes: [], otherPerformanceType: '', genres: [], soundcloudTrack: null }
    // With their artists' applications, picked as they were added.
    expect(sentSession(requestsTo('POST', '/api/admin/sessions')[0]).sets).toEqual([
      { ...empty, performers: [{ id: 'artist-1' }], durationMinutes: null, youtubeVideo: 'dQw4w9WgXcQ', application: 'application-3' },
      { ...empty, performers: [{ id: 'artist-2' }], durationMinutes: 60, youtubeVideo: null, application: 'application-4' },
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
    typeTime(timeField('Fin'), '02:00')
    expect(tooLong()).toBeNull()
    typeTime(timeField('Fin'), '01:00')
    expect(tooLong()).not.toBeNull()
    // Nothing while they aren't.
    fireEvent.change(dayInput('Début'), { target: { value: '' } })
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
    fireEvent.change(dayInput('Début'), { target: { value: '' } })
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
    // Only greyed out, so that it would keep the focus (see sortable.tsx).
    expect(screen.getByRole('button', { name: 'réordonner : Set de Aurore' })).toHaveAttribute('aria-disabled', 'true')
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

  it("offers the artists of the takeover's collective first in a set's form, which follows the collective and the type", async () => {
    const VAGUES: Collective = { ...ONDES, id: 'collective-2', name: 'Vagues', email: 'vagues@example.com', members: [{ id: 'artist-3', name: 'Cyan' }, { id: 'artist-2', name: 'Brume' }] }
    mockFetch({ ...NEW, '/api/admin/collectives': { ok: true, collectives: [ONDES, VAGUES] } })
    renderAt('/admin/sessions/nouvelle')

    await fillIn({ type: 'Takeover' })
    fireEvent.click(screen.getByRole('combobox', { name: 'Collectif' }))
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Ondes/ }))
    fireEvent.click(screen.getByRole('button', { name: 'ajouter un set' }))
    await screen.findByRole('heading', { name: 'Nouveau set' })
    const form = setForm('Nouveau set')
    const picker = () => form.getByRole('combobox', { name: 'Ajouter un artiste' })
    fireEvent.click(picker())
    fireEvent.mouseDown(form.getByRole('option', { name: /^Cyan/ }))
    lasting('0', '45')(form)
    fireEvent.click(picker())
    expect(options()).toEqual(['AuroreOndes', 'Brumebrume@example.com'])
    fireEvent.keyDown(picker(), { key: 'Escape' })

    // The set's form follows it, with what it has.
    fireEvent.click(screen.getByRole('combobox', { name: 'Collectif' }))
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Vagues/ }))
    expect(form.getByRole('button', { name: 'retirer Cyan' })).toBeInTheDocument()
    expect(durationIn(form)).toEqual(['0', '45'])
    fireEvent.click(picker())
    expect(options()).toEqual(['BrumeVagues', 'Auroreaurore@example.com'])
    fireEvent.keyDown(picker(), { key: 'Escape' })
    fireEvent.click(screen.getByRole('radio', { name: 'Guest mixes' }))
    fireEvent.click(picker())
    expect(options()).toEqual(['Auroreaurore@example.com', 'Brumebrume@example.com'])
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
      const first = renderAt('/admin/sessions/session-1?application=application-3')
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
    const NEW = { ...LOGGED_IN, ...COLLECTIVES, ...RA_EVENTS, ...WITH_AURORES }
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
      expect(dayInput('Début')).toHaveValue('')
      expect(shownTime(timeField('Début'))).toBe('–– h ––')
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
      // The collective's own, as without the application.
      expect(screen.getByRole('combobox', { name: 'Candidature' })).toHaveValue('Reçue le 1 septembre 2026')
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
