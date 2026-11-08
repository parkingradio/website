import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import type { Application } from '../../application-fields'
import App from '../../app'
import type { Artist } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import { jsonBody, mockFetch, requestsTo } from '../../test-utils'

const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' } }

function artist(id: string, name: string): Artist {
  return {
    id,
    hasPhoto: true,
    createdAt: '2026-10-01T16:00:00.000Z',
    createdBy: 'admin@example.com',
    name,
    country: 'CA',
    city: 'Montréal',
    genres: ['techno'],
    bio: 'Une bio.',
    links: { soundcloud: name.toLowerCase() },
    email: `${name.toLowerCase()}@example.com`,
    phone: '514 555 0101',
    updatedBy: null,
    updatedAt: null,
    collectives: [],
  }
}

const AURORE: Artist = { ...artist('artist-1', 'Aurore'), genres: ['techno', 'ambient'] }
// An admin left out her city, genres and email.
const BRUME: Artist = { ...artist('artist-2', 'Brume'), city: '', genres: [], email: null }
// A collective, of Brume and Aurore, whose genres are theirs.
const ONDES: Collective = {
  id: 'collective-1',
  hasPhoto: false,
  createdAt: '2026-10-01T16:00:00.000Z',
  createdBy: 'admin@example.com',
  name: 'Ondes',
  members: [
    { id: 'artist-2', name: 'Brume' },
    { id: 'artist-1', name: 'Aurore' },
  ],
  country: 'CA',
  city: 'Québec',
  description: '',
  links: {},
  email: 'ondes@example.com',
  phone: '',
  updatedBy: null,
  updatedAt: null,
}
// Who applications can be for: the artists, and the collectives.
const ARTISTS = { '/api/admin/artists': { ok: true, artists: [AURORE, BRUME] }, '/api/admin/collectives': { ok: true, collectives: [ONDES] } }

const APPLICATION: Application = {
  id: 'application-1',
  artistId: 'artist-1',
  collectiveId: null,
  receivedAt: '2026-10-05T16:00:00.000Z',
  createdAt: '2026-10-05T16:00:00.000Z',
  createdBy: 'admin@example.com',
  dates: ['2026-12-10', '2026-12-17', '2027-01-07', '2027-01-14'],
  timeSlots: [{ start: '18:00', end: '22:00' }],
  performanceTypes: ['dj'],
  otherPerformanceType: 'Vinyle seulement',
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
  { ...APPLICATION, id: 'application-4', receivedAt: '2026-10-08T16:00:00.000Z', createdAt: '2026-10-08T16:00:00.000Z', dates: ['2026-10-29'], performanceTypes: ['vinyl'], otherPerformanceType: '', status: 'done' },
  { ...APPLICATION, id: 'application-3', artistId: 'artist-2', receivedAt: '2026-10-07T16:00:00.000Z', createdAt: '2026-10-07T16:00:00.000Z', dates: ['2026-11-05'], performanceTypes: ['rap'], status: 'rejected' },
  { ...APPLICATION, id: 'application-2', receivedAt: '2026-10-06T16:00:00.000Z', createdAt: '2026-10-06T16:00:00.000Z', dates: ['2026-11-12'], performanceTypes: ['full-band'], otherPerformanceType: '', status: 'accepted' },
  { ...APPLICATION, receivedAt: '2026-03-28T14:00:00.000Z', createdAt: '2026-10-09T16:00:00.000Z' },
]

function CurrentPath() {
  const location = useLocation()
  return <div data-testid="path">{location.pathname + location.search}</div>
}

function renderAt(path: string) {
  return render(
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
    renderAt('/admin/candidatures?status=all')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    // Brume's genres are left out, and so is her city, which leaves her country.
    expect(rows()).toEqual([
      ['8 octobre 2026', 'Aurore', 'Montréal, Canada', 'techno, ambient', '29 oct. 2026', 'Vinyl', 'faite'],
      ['7 octobre 2026', 'Brume', 'Canada', '-', '5 nov. 2026', 'Rap, autre : Vinyle seulement', 'refusée'],
      ['6 octobre 2026', 'Aurore', 'Montréal, Canada', 'techno, ambient', '12 nov. 2026', 'Full Band', 'retenue'],
      ['28 mars 2026', 'Aurore', 'Montréal, Canada', 'techno, ambient', '10 déc. 2026, 17 déc. 2026, 7 janv. 2027 (+1)', 'DJ, autre : Vinyle seulement', 'nouvelle'],
    ])
    // Colored by status on the whole row, but only the status of a new one is bold.
    const statusRows = screen.getAllByRole('row').slice(1)
    expect(statusRows[0]).toHaveClass('admin-status-done')
    expect(statusRows[1]).toHaveClass('admin-status-rejected')
    expect(statusRows[2]).toHaveClass('admin-status-accepted')
    expect(statusRows[3]).toHaveClass('admin-status-new')
    expect(screen.getByRole('cell', { name: 'nouvelle' })).toHaveClass('admin-status')
    expect(screen.getByRole('link', { name: '28 mars 2026' })).toHaveAttribute('href', '/admin/candidatures/application-1')
    expect(screen.getByRole('link', { name: 'Brume' })).toHaveAttribute('href', '/admin/artistes/artist-2')
    expect(screen.getByRole('link', { name: 'nouvelle candidature' })).toHaveAttribute('href', '/admin/candidatures/nouvelle')
    // Where who they're emailed to is chosen.
    expect(within(screen.getByText(/se choisissent dans la/)).getByRole('link')).toHaveAttribute('href', '/admin/configuration')
  })

  it('lists only the applications with a status, once it is picked', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/applications': { ok: true, applications: APPLICATIONS } })
    renderAt('/admin/candidatures?status=all')

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
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures\?status=accepted$/)
    expect(filters.getByRole('button', { name: 'retenues (1)' })).toHaveAttribute('aria-pressed', 'true')
    expect(rows().map((row) => row[0])).toEqual(['6 octobre 2026'])

    fireEvent.click(filters.getByRole('button', { name: 'toutes (4)' }))
    expect(rows()).toHaveLength(4)
  })

  it('lists the applications of collectives, with their cities and their artists’ genres, saying that they are collectives', async () => {
    const applications = [
      { ...APPLICATION, id: 'application-5', artistId: null, collectiveId: 'collective-1' },
      { ...APPLICATION, id: 'application-6', artistId: 'artist-1' },
    ]
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/applications': { ok: true, applications } })
    renderAt('/admin/candidatures?status=all')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(rows().map((row) => row.slice(1, 4))).toEqual([
      ['Ondes (collectif)', 'Québec, Canada', 'techno, ambient'],
      ['Aurore', 'Montréal, Canada', 'techno, ambient'],
    ])
    expect(screen.getByRole('link', { name: 'Ondes' })).toHaveAttribute('href', '/admin/artistes/collectifs/collective-1')
    expect(screen.getByRole('link', { name: 'Aurore' })).toHaveAttribute('href', '/admin/artistes/artist-1')
  })

  it('lists the applications without their collectives when those could not be loaded', async () => {
    const applications = [{ ...APPLICATION, id: 'application-5', artistId: null, collectiveId: 'collective-1' }, APPLICATION]
    mockFetch({
      ...LOGGED_IN,
      ...ARTISTS,
      '/api/admin/collectives': { ok: false, error: 'Boom' },
      '/api/admin/applications': { ok: true, applications },
    })
    renderAt('/admin/candidatures?status=all')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent("Les collectifs n'ont pas pu être chargés : Boom")
    expect(rows().map((row) => row.slice(1, 4))).toEqual([
      ['collectif inconnu', '', ''],
      ['Aurore', 'Montréal, Canada', 'techno, ambient'],
    ])
    expect(screen.getByRole('link', { name: 'collectif inconnu' })).toHaveAttribute('href', '/admin/artistes/collectifs/collective-1')
  })

  it('lists the applications without their artists when those could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/artists': { ok: false, error: 'Boom' }, '/api/admin/applications': { ok: true, applications: APPLICATIONS } })
    renderAt('/admin/candidatures?status=all')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom")
    // Their places and genres are unknown too, rather than left out.
    expect(rows().map((row) => row.slice(1, 4))).toEqual(Array(4).fill(['artiste inconnu', '', '']))
  })

  it("leaves a collective's genres blank, rather than left out, when the artists could not be loaded", async () => {
    const applications = [{ ...APPLICATION, artistId: null, collectiveId: 'collective-1' }]
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/artists': { ok: false, error: 'Boom' }, '/api/admin/applications': { ok: true, applications } })
    renderAt('/admin/candidatures?status=all')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom")
    expect(rows().map((row) => row.slice(1, 4))).toEqual([['Ondes (collectif)', 'Québec, Canada', '']])
  })

  it('says when there are no applications', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/applications': { ok: true, applications: [] } })
    renderAt('/admin/candidatures?status=new')

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
    renderAt('/admin/candidatures?status=all')

    await expectSearch('brume', ['7 octobre 2026'])
    await expectSearch('aurore@example.com', ['8 octobre 2026', '6 octobre 2026', '28 mars 2026'])
  })

  it('finds the applications of collectives by the collective, its artists’ names and their genres', async () => {
    const collectives = { ...APPLICATION, id: 'application-5', artistId: null, collectiveId: 'collective-1', receivedAt: '2026-10-09T16:00:00.000Z' }
    mockFetch({ ...LISTED, '/api/admin/applications': { ok: true, applications: [collectives, ...SEARCHED] } })
    renderAt('/admin/candidatures?status=all')

    await expectSearch('ondes', ['9 octobre 2026'])
    await expectSearch('quebec', ['9 octobre 2026'])
    await expectSearch('brume', ['9 octobre 2026', '7 octobre 2026'])
    await expectSearch('ambient', ['9 octobre 2026', '8 octobre 2026', '6 octobre 2026', '28 mars 2026'])
  })

  it('finds applications by their performance types and details', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?status=all')

    await expectSearch('rap', ['7 octobre 2026'])
    // "Vinyl", and "Vinyle seulement" for the others.
    await expectSearch('vinyl', ['8 octobre 2026', '7 octobre 2026', '28 mars 2026'])
    await expectSearch('soiree', ['6 octobre 2026'])
    // Those with something else they'd do, as the list says.
    await expectSearch('autre', ['7 octobre 2026', '28 mars 2026'])
  })

  it('finds applications by the days their artists would like to play, by month, weekday or day', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?status=all')

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

  it('finds applications by a day of the month with a month or a weekday, only on that day, written as it may be typed', async () => {
    const on = (day: number, dates: string[], changes: Partial<Application> = {}) => ({
      ...APPLICATION,
      id: `application-${day}`,
      receivedAt: `2026-10-0${day}T16:00:00.000Z`,
      createdAt: `2026-10-0${day}T16:00:00.000Z`,
      dates,
      ...changes,
    })
    const applications = [
      on(6, ['2026-11-12'], { details: 'Dispo le samedi 26 ou le dimanche 27.' }),
      on(5, ['2026-12-26']),
      on(4, ['2026-11-26', '2026-12-03'], { details: 'J’ai décidé de postuler.' }),
      on(3, ['2025-12-26'], { artistId: 'artist-2' }),
      on(2, ['2026-12-11', '2026-12-21', '2027-03-01']),
      on(1, ['2026-12-01']),
    ]
    mockFetch({ ...LISTED, '/api/admin/applications': { ok: true, applications } })
    renderAt('/admin/candidatures?status=all')

    // Not by "26" in "2026", or another day, or "dec" in "décidé".
    await expectSearch('dec 26', ['5 octobre 2026', '3 octobre 2026'])
    await expectSearch('26 déc', ['5 octobre 2026', '3 octobre 2026'])
    await expectSearch('Déc. 26', ['5 octobre 2026', '3 octobre 2026'])
    await expectSearch('26 décembre 2026', ['5 octobre 2026'])
    await expectSearch('dec 26 2025', ['3 octobre 2026'])
    await expectSearch('brume 26 dec', ['3 octobre 2026'])
    await expectSearch('1 déc', ['1 octobre 2026'])
    await expectSearch('1er decembre', ['1 octobre 2026'])
    await expectSearch('01 dec', ['1 octobre 2026'])
    await expectSearch('31 nov', [])
    // "3 déc", then "26", which is in "2026".
    await expectSearch('3 déc 26', ['4 octobre 2026'])
    // "déc 3", then "nov 26".
    await expectSearch('déc 3 nov 26', ['4 octobre 2026'])

    // A weekday and a day, before or after it: Saturday, December 26th, 2026, not the other 26ths, nor "samedi 26" in
    // details.
    await expectSearch('sam 26', ['5 octobre 2026'])
    await expectSearch('26 samedi', ['5 octobre 2026'])
    await expectSearch('déc 26 sam', ['5 octobre 2026'])
    await expectSearch('jeu 26', ['4 octobre 2026'])
    await expectSearch('jeu 26 jeu 3', ['4 octobre 2026'])
    // Not Friday, December 11th.
    await expectSearch('ven 1', [])
    await expectSearch('lun 26 déc 2026', [])
    // "mar" is mardi or mars, unless it's with another month or weekday: Tuesday, December 1st, 2026, and Monday, March
    // 1st, 2027.
    await expectSearch('mar 1', ['2 octobre 2026', '1 octobre 2026'])
    await expectSearch('1 mar', ['2 octobre 2026', '1 octobre 2026'])
    await expectSearch('mar 1 2026', ['1 octobre 2026'])
    await expectSearch('1 mar 2027', ['2 octobre 2026'])
    await expectSearch('mar 1 déc', ['1 octobre 2026'])
    await expectSearch('mar. 1 déc. 2026', ['1 octobre 2026'])
    await expectSearch('lun 1 mar', ['2 octobre 2026'])
    await expectSearch('mars 1', ['2 octobre 2026'])
    // Without a day, words.
    await expectSearch('mar', ['2 octobre 2026', '1 octobre 2026'])
    await expectSearch('mardi', ['1 octobre 2026'])
    await expectSearch('1 déc mar', ['1 octobre 2026'])
  })

  it('counts the applications the search finds, by status, and keeps both in the URL', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?status=all')

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
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures\?status=accepted&search=aurore$/)
    expect(received()).toEqual(['6 octobre 2026'])
  })

  it('says there are none with a status, rather than that none matches, when there are none with it at all', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?status=scheduled&search=aurore')

    await waitFor(() => expect(screen.getByText('Aucune candidature avec ce statut.')).toBeInTheDocument())
  })

  it('says when no application matches', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?status=all&search=zzzzzz')

    await waitFor(() => expect(screen.getByText('Aucune candidature ne correspond à la recherche.')).toBeInTheDocument())
    expect(screen.getByRole('searchbox', { name: 'Rechercher' })).toHaveValue('zzzzzz')
  })

  it('still finds applications by what they say when the artists could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: false, error: 'Boom' }, '/api/admin/applications': { ok: true, applications: SEARCHED } })
    renderAt('/admin/candidatures?status=all&search=soiree')

    await waitFor(() => expect(received()).toEqual(['6 octobre 2026']))
  })
})

describe('The default view of the list of applications', () => {
  // Another new one, received after the others.
  const LATEST = { ...APPLICATION, id: 'application-5', receivedAt: '2026-10-09T16:00:00.000Z', createdAt: '2026-10-09T16:00:00.000Z' }
  const LISTED = { ...LOGGED_IN, ...ARTISTS, '/api/admin/applications': { ok: true, applications: [LATEST, ...APPLICATIONS] } }
  const header = () => screen.getByRole('columnheader', { name: 'Reçue le' })

  it('opens on the new applications, the oldest received first', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures')

    await waitFor(() => expect(received()).toEqual(['28 mars 2026', '9 octobre 2026']))
    expect(header()).toHaveAttribute('aria-sort', 'ascending')
    expect(header()).toHaveTextContent('Reçue le ↑')
    expect(screen.getByRole('button', { name: 'nouvelles (2)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures$/)
  })

  it('is the same view once its status is picked with its button', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?status=all')

    fireEvent.click(await screen.findByRole('button', { name: 'nouvelles (2)' }))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures\?status=new$/)
    expect(received()).toEqual(['28 mars 2026', '9 octobre 2026'])
    expect(header()).toHaveAttribute('aria-sort', 'ascending')
  })

  it('lists every application, or those with another status, the most recently received first', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures')

    fireEvent.click(await screen.findByRole('button', { name: 'toutes (5)' }))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures\?status=all$/)
    expect(received()).toEqual(['9 octobre 2026', '8 octobre 2026', '7 octobre 2026', '6 octobre 2026', '28 mars 2026'])
    expect(header()).toHaveAttribute('aria-sort', 'descending')

    fireEvent.click(screen.getByRole('button', { name: 'faites (1)' }))
    expect(header()).toHaveAttribute('aria-sort', 'descending')
  })

  it('lists the accepted ones the oldest received first too, until the first click on the column', async () => {
    const accepted = { ...APPLICATION, id: 'application-6', receivedAt: '2026-10-10T16:00:00.000Z', createdAt: '2026-10-10T16:00:00.000Z', status: 'accepted' }
    mockFetch({ ...LISTED, '/api/admin/applications': { ok: true, applications: [accepted, ...APPLICATIONS] } })
    renderAt('/admin/candidatures?status=accepted')

    await waitFor(() => expect(received()).toEqual(['6 octobre 2026', '10 octobre 2026']))
    expect(header()).toHaveAttribute('aria-sort', 'ascending')
    expect(header()).toHaveTextContent('Reçue le ↑')

    fireEvent.click(within(header()).getByRole('button'))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures\?status=accepted&sort=received&order=desc$/)
    expect(received()).toEqual(['10 octobre 2026', '6 octobre 2026'])
    expect(header()).toHaveAttribute('aria-sort', 'descending')
  })

  it('sorts the other way around with the first click on the column, and then keeps to it', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures')

    await waitFor(() => expect(received()).toHaveLength(2))
    fireEvent.click(within(header()).getByRole('button'))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures\?sort=received&order=desc$/)
    expect(received()).toEqual(['9 octobre 2026', '28 mars 2026'])
    expect(header()).toHaveAttribute('aria-sort', 'descending')
  })

  it('starts from the oldest when the column is sorted by again, or the URL does not say which way', async () => {
    mockFetch(LISTED)
    const { unmount } = renderAt('/admin/candidatures')

    fireEvent.click(await screen.findByRole('button', { name: 'Artiste' }))
    fireEvent.click(within(header()).getByRole('button'))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures\?sort=received&order=asc$/)
    expect(received()).toEqual(['28 mars 2026', '9 octobre 2026'])
    unmount()

    renderAt('/admin/candidatures?sort=received')
    await waitFor(() => expect(received()).toEqual(['28 mars 2026', '9 octobre 2026']))
    expect(header()).toHaveAttribute('aria-sort', 'ascending')
  })

  it('says when there are none with its status, though there are others', async () => {
    const others = APPLICATIONS.filter((application) => application.status !== 'new')
    mockFetch({ ...LISTED, '/api/admin/applications': { ok: true, applications: others } })
    renderAt('/admin/candidatures')

    expect(await screen.findByText('Aucune candidature avec ce statut.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'toutes (3)' })).toBeInTheDocument()
  })

  it('searches within it, while the buttons count what the search finds in every status', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures')

    await expectSearch('aurore', ['28 mars 2026', '9 octobre 2026'])
    expect(
      within(screen.getByRole('group', { name: 'Statut' }))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['toutes (4)', 'nouvelles (2)', 'retenues (1)', 'planifiées (0)', 'faites (1)', 'refusées (0)'])
  })
})

describe('Sorting the list of applications', () => {
  const LISTED = { ...LOGGED_IN, ...ARTISTS, '/api/admin/applications': { ok: true, applications: APPLICATIONS } }

  it('lists the most recently received first, then the other way around', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?status=all')

    const header = await screen.findByRole('columnheader', { name: 'Reçue le' })
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Reçue le ↓', 'Artiste', 'Ville', 'Genres', 'Dates', 'Prestations', 'Statut'])
    // There's no order to genres or performance types.
    expect(within(screen.getByRole('columnheader', { name: 'Genres' })).queryByRole('button')).not.toBeInTheDocument()
    expect(within(screen.getByRole('columnheader', { name: 'Prestations' })).queryByRole('button')).not.toBeInTheDocument()

    fireEvent.click(within(header).getByRole('button'))
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    expect(received()).toEqual(['28 mars 2026', '6 octobre 2026', '7 octobre 2026', '8 octobre 2026'])
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures\?status=all&sort=received&order=asc$/)
  })

  it('sorts the applications the way their column first sorts them when the URL does not say which way', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?status=all&sort=received')

    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Reçue le' })).toHaveAttribute('aria-sort', 'descending'))
    expect(received()).toEqual(['8 octobre 2026', '7 octobre 2026', '6 octobre 2026', '28 mars 2026'])
  })

  it('ignores a column, a direction or a status that the URL gives but it does not know', async () => {
    mockFetch(LISTED)
    const { unmount } = renderAt('/admin/candidatures?sort=ville&order=desc&status=nouvelle')

    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Reçue le' })).toHaveAttribute('aria-sort', 'ascending'))
    expect(received()).toEqual(['28 mars 2026'])
    expect(screen.getByRole('button', { name: 'nouvelles (1)' })).toHaveAttribute('aria-pressed', 'true')
    unmount()

    renderAt('/admin/candidatures?status=all&sort=city&order=up')
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Ville' })).toHaveAttribute('aria-sort', 'ascending'))
  })

  it('ignores the parameters of old addresses, which were in French', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?recherche=aurore&tri=ville&ordre=desc&statut=accepted')

    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Reçue le' })).toHaveAttribute('aria-sort', 'ascending'))
    expect(received()).toEqual(['28 mars 2026'])
    expect(screen.getByRole('button', { name: 'nouvelles (1)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('searchbox', { name: 'Rechercher' })).toHaveValue('')
  })

  it('sorts the applications by artist, each artist’s the most recently received first', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?status=all')

    fireEvent.click(await screen.findByRole('button', { name: 'Artiste' }))
    expect(rows().map((row) => row.slice(0, 2))).toEqual([
      ['8 octobre 2026', 'Aurore'],
      ['6 octobre 2026', 'Aurore'],
      ['28 mars 2026', 'Aurore'],
      ['7 octobre 2026', 'Brume'],
    ])
  })

  it('sorts the applications of collectives by their names, with those of artists', async () => {
    const collectives = { ...APPLICATION, id: 'application-5', artistId: null, collectiveId: 'collective-1', receivedAt: '2026-10-09T16:00:00.000Z' }
    mockFetch({ ...LISTED, '/api/admin/applications': { ok: true, applications: [collectives, ...APPLICATIONS] } })
    renderAt('/admin/candidatures?status=all')

    fireEvent.click(await screen.findByRole('button', { name: 'Artiste' }))
    expect(rows().map((row) => row[1])).toEqual(['Aurore', 'Aurore', 'Aurore', 'Brume', 'Ondes (collectif)'])
    fireEvent.click(screen.getByRole('button', { name: 'Ville' }))
    expect(rows().map((row) => row[2])).toEqual(['Canada', 'Montréal, Canada', 'Montréal, Canada', 'Montréal, Canada', 'Québec, Canada'])
  })

  it('sorts the applications by their artists’ places, those left out first', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?status=all')

    fireEvent.click(await screen.findByRole('button', { name: 'Ville' }))
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/candidatures\?status=all&sort=city&order=asc$/)
    expect(rows().map((row) => [row[0], row[2]])).toEqual([
      ['7 octobre 2026', 'Canada'],
      ['8 octobre 2026', 'Montréal, Canada'],
      ['6 octobre 2026', 'Montréal, Canada'],
      ['28 mars 2026', 'Montréal, Canada'],
    ])
  })

  it('sorts the applications by the first day their artists would like to play', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?status=all&sort=received&order=asc')

    fireEvent.click(await screen.findByRole('button', { name: 'Dates' }))
    expect(rows().map((row) => row[4])).toEqual(['29 oct. 2026', '5 nov. 2026', '12 nov. 2026', '10 déc. 2026, 17 déc. 2026, 7 janv. 2027 (+1)'])
  })

  it('sorts the applications by status, in the order they usually go through them', async () => {
    mockFetch(LISTED)
    renderAt('/admin/candidatures?status=all')

    fireEvent.click(await screen.findByRole('button', { name: 'Statut' }))
    expect(rows().map((row) => row[6])).toEqual(['nouvelle', 'retenue', 'faite', 'refusée'])
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
    expect(screen.getByRole('heading', { level: 2, name: 'Artiste' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Aurore' })).toHaveAttribute('href', '/admin/artistes/artist-1')
    expect(screen.getByText('Genres', { selector: 'dt' }).nextElementSibling).toHaveTextContent('techno, ambient')
    expect(screen.getByRole('link', { name: 'aurore@example.com' })).toHaveAttribute('href', 'mailto:aurore@example.com')
    expect(screen.getByText(/^La candidature sera supprimée/)).toHaveTextContent("La candidature sera supprimée pour de bon. L'artiste reste.")
    expect(screen.getByText('jeudi 10 décembre 2026')).toBeInTheDocument()
    expect(screen.getByText('jeudi 14 janvier 2027')).toBeInTheDocument()
    expect(screen.getByText('18:00 à 22:00')).toBeInTheDocument()
    expect(screen.getByText('DJ, autre : Vinyle seulement')).toBeInTheDocument()
    expect(screen.getByText(/^Une question/)).toHaveTextContent('Une question ? Une autre.')
  })

  it('says when an application has no time slot, performance type or details', async () => {
    const bare = { ...APPLICATION, timeSlots: [], performanceTypes: [], otherPerformanceType: '', details: '' }
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
      performanceTypes: ['dj', 'rap'],
      otherPerformanceType: 'Vinyle, surtout',
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
    // Its midnight in Québec time, like the admin pages show dates, with Québec's offset then.
    expect(jsonBody(requestsTo('PUT', '/api/admin/applications/application-1')[0]).receivedAt).toBe('2026-03-28T00:00-04:00')
  })

  it("shows and sends the day the application was received in Québec time, whatever the browser's time zone", async () => {
    // Loaded again in Tokyo's time zone, since formatters keep the one they're created in, where the application was
    // received on October 6, and created on October 7.
    const application = { ...APPLICATION, receivedAt: '2026-10-05T23:30:00-04:00', createdAt: '2026-10-06T16:00:00-04:00' }
    vi.stubEnv('TZ', 'Asia/Tokyo')
    vi.resetModules()
    try {
      const { default: TokyoApp } = await import('../../app')
      const { MemoryRouter: TokyoRouter } = await import('react-router')
      mockFetch({
        ...PAGE,
        '/api/admin/applications/application-1': { ok: true, application },
        'PUT /api/admin/applications/application-1': { ok: true, application },
      })
      render(
        <TokyoRouter initialEntries={['/admin/candidatures/application-1']} useTransitions={false}>
          <TokyoApp />
        </TokyoRouter>,
      )

      expect(await screen.findByText(/^Reçue le/)).toHaveTextContent('Reçue le 5 octobre 2026.')
      fireEvent.click(screen.getByRole('button', { name: 'modifier' }))
      expect(screen.getByLabelText('Reçue le')).toHaveValue('2026-10-05')
      fireEvent.change(screen.getByLabelText('Reçue le'), { target: { value: '2026-01-15' } })
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

      await waitFor(() => expect(requestsTo('PUT', '/api/admin/applications/application-1')).toHaveLength(1))
      expect(jsonBody(requestsTo('PUT', '/api/admin/applications/application-1')[0]).receivedAt).toBe('2026-01-15T00:00-05:00')
    } finally {
      vi.unstubAllEnvs()
    }
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

  it('sends the performance types in the order of the list, whatever order they were checked in', async () => {
    mockFetch({ ...PAGE, 'PUT /api/admin/applications/application-1': { ok: true, application: APPLICATION } })
    renderAt('/admin/candidatures/application-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.click(screen.getByLabelText('Full Band'))
    fireEvent.click(screen.getByLabelText('Vinyl'))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(requestsTo('PUT', '/api/admin/applications/application-1')).toHaveLength(1))
    expect(jsonBody(requestsTo('PUT', '/api/admin/applications/application-1')[0]).performanceTypes).toEqual(['dj', 'vinyl', 'full-band'])
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

  describe('of a collective', () => {
    const OF_ONDES = { ...APPLICATION, artistId: null, collectiveId: 'collective-1' }
    const COLLECTIVE_PAGE = {
      ...LOGGED_IN,
      '/api/admin/applications/application-1': { ok: true, application: OF_ONDES },
      '/api/admin/collectives/collective-1': { ok: true, collective: ONDES },
      '/api/admin/artists?collective=collective-1': { ok: true, artists: [BRUME, AURORE] },
    }
    const described = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling

    it('shows who the collective is, with its artists and their genres', async () => {
      mockFetch(COLLECTIVE_PAGE)
      renderAt('/admin/candidatures/application-1')

      await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Candidature de Ondes' })).toBeInTheDocument())
      expect(screen.getByRole('heading', { level: 2, name: 'Collectif' })).toBeInTheDocument()
      expect(described('Nom')).toHaveTextContent('Ondes (collectif)')
      expect(screen.getByRole('link', { name: 'Ondes' })).toHaveAttribute('href', '/admin/artistes/collectifs/collective-1')
      expect(described('Ville')).toHaveTextContent('Québec, Canada')
      expect(described('Genres de ses artistes')).toHaveTextContent('techno, ambient')
      expect(within(described('Artistes du collectif') as HTMLElement).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
        '/admin/artistes/artist-2',
        '/admin/artistes/artist-1',
      ])
      expect(screen.getByRole('link', { name: 'ondes@example.com' })).toHaveAttribute('href', 'mailto:ondes@example.com')
      expect(described('Téléphone du contact')).toHaveTextContent(/^-$/)
      expect(screen.getByText(/^La candidature sera supprimée/)).toHaveTextContent('La candidature sera supprimée pour de bon. Le collectif reste.')
      expect(requestsTo('GET', '/api/admin/artists')).toHaveLength(0)
    })

    it('shows "-" in place of the email of a collective without one', async () => {
      mockFetch({ ...COLLECTIVE_PAGE, '/api/admin/collectives/collective-1': { ok: true, collective: { ...ONDES, email: null } } })
      renderAt('/admin/candidatures/application-1')

      await waitFor(() => expect(described('Adresse e-mail du contact')).toHaveTextContent(/^-$/))
      expect(screen.queryByRole('link', { name: /@/ })).not.toBeInTheDocument()
    })

    it('shows the collective without its genres when its artists could not be loaded', async () => {
      mockFetch({ ...COLLECTIVE_PAGE, '/api/admin/artists?collective=collective-1': { ok: false, error: 'Boom' } })
      renderAt('/admin/candidatures/application-1')

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom"))
      expect(described('Genres de ses artistes')).toHaveTextContent(/^$/)
      expect(described('Ville')).toHaveTextContent('Québec, Canada')
    })

    it('says when the collective could not be loaded', async () => {
      mockFetch({ ...COLLECTIVE_PAGE, '/api/admin/collectives/collective-1': { ok: false, error: 'No such collective' } })
      renderAt('/admin/candidatures/application-1')

      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Le collectif n'a pas pu être chargé : No such collective"))
      expect(screen.getByRole('heading', { level: 1, name: 'Candidature' })).toBeInTheDocument()
    })
  })

  it('says when the application could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/applications/nope': { ok: false, error: 'No such application' } })
    renderAt('/admin/candidatures/nope')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("La candidature n'a pas pu être chargée : No such application"))
  })
})

describe('Creating an application', () => {
  it('creates an application for the artist it was started from, then shows it', async () => {
    const created = { ...APPLICATION, id: 'application-4', artistId: 'artist-2', timeSlots: [], performanceTypes: ['dj'], otherPerformanceType: 'B2B', details: '' }
    // A collective without an email, told apart like an artist.
    const brise: Collective = { ...ONDES, id: 'collective-2', name: 'Brise', email: null, city: 'Gaspé' }
    mockFetch({
      ...LOGGED_IN,
      ...ARTISTS,
      '/api/admin/collectives': { ok: true, collectives: [ONDES, brise] },
      'POST /api/admin/applications': { ok: true, application: created },
      '/api/admin/applications/application-4': { ok: true, application: created },
      '/api/admin/artists/artist-2': { ok: true, artist: BRUME },
    })
    renderAt('/admin/candidatures/nouvelle?artist=artist-2')

    const picked = await screen.findByRole('combobox', { name: 'Artiste ou collectif' })
    expect(picked).toHaveValue('Brume')
    // By name, with their email, or else where they're from, and collectives say so.
    fireEvent.click(picked)
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Auroreaurore@example.com',
      'Brisecollectif, Gaspé, Canada',
      'BrumeCanada',
      'Ondescollectif, ondes@example.com',
    ])
    fireEvent.keyDown(picked, { key: 'Escape' })
    // Received now, unless said otherwise.
    expect(screen.getByLabelText('Reçue le')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Date 1'), { target: { value: '2026-12-10' } })
    fireEvent.click(screen.getByLabelText('DJ'))
    fireEvent.change(screen.getByLabelText('Autre'), { target: { value: 'B2B' } })
    fireEvent.click(screen.getByRole('button', { name: 'créer la candidature' }))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/admin/candidatures/application-4'))
    // Her email was left out.
    await waitFor(() => expect(screen.getByText('Adresse e-mail', { selector: 'dt' }).nextElementSibling).toHaveTextContent(/^-$/))
    expect(jsonBody(requestsTo('POST', '/api/admin/applications')[0])).toEqual({
      artistId: 'artist-2',
      dates: ['2026-12-10'],
      timeSlots: [],
      performanceTypes: ['dj'],
      otherPerformanceType: 'B2B',
      details: '',
    })
  })

  it('creates an application for the collective it was started from, or one picked, without an artist', async () => {
    const created = { ...APPLICATION, id: 'application-4', artistId: null, collectiveId: 'collective-1' }
    mockFetch({
      ...LOGGED_IN,
      ...ARTISTS,
      'POST /api/admin/applications': { ok: true, application: created },
      '/api/admin/applications/application-4': { ok: true, application: created },
      '/api/admin/collectives/collective-1': { ok: true, collective: ONDES },
      '/api/admin/artists?collective=collective-1': { ok: true, artists: [BRUME, AURORE] },
    })
    renderAt('/admin/candidatures/nouvelle?collective=collective-1')

    expect(await screen.findByRole('combobox', { name: 'Artiste ou collectif' })).toHaveValue('Ondes')
    fireEvent.change(screen.getByLabelText('Date 1'), { target: { value: '2026-12-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'créer la candidature' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Candidature de Ondes' })).toBeInTheDocument())
    expect(jsonBody(requestsTo('POST', '/api/admin/applications')[0])).toEqual({
      collectiveId: 'collective-1',
      dates: ['2026-12-10'],
      timeSlots: [],
      performanceTypes: [],
      otherPerformanceType: '',
      details: '',
    })
  })

  it('creates an application for a collective picked by its name', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, 'POST /api/admin/applications': { ok: false, error: 'Boom' } })
    renderAt('/admin/candidatures/nouvelle?artist=artist-1')

    const picker = await screen.findByRole('combobox', { name: 'Artiste ou collectif' })
    fireEvent.change(picker, { target: { value: 'ond' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Ondes/ }))
    expect(picker).toHaveValue('Ondes')
    fireEvent.change(screen.getByLabelText('Date 1'), { target: { value: '2026-12-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'créer la candidature' }))

    await waitFor(() => expect(requestsTo('POST', '/api/admin/applications')).toHaveLength(1))
    const sent = jsonBody(requestsTo('POST', '/api/admin/applications')[0])
    expect(sent).toMatchObject({ collectiveId: 'collective-1' })
    expect(sent).not.toHaveProperty('artistId')
  })

  it('sends when the application was received, if a day was picked', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, 'POST /api/admin/applications': { ok: true, application: APPLICATION } })
    renderAt('/admin/candidatures/nouvelle?artist=artist-1')

    fireEvent.change(await screen.findByLabelText('Reçue le'), { target: { value: '2026-03-28' } })
    fireEvent.change(screen.getByLabelText('Date 1'), { target: { value: '2026-12-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'créer la candidature' }))

    await waitFor(() => expect(requestsTo('POST', '/api/admin/applications')).toHaveLength(1))
    expect(jsonBody(requestsTo('POST', '/api/admin/applications')[0])).toMatchObject({
      artistId: 'artist-1',
      receivedAt: '2026-03-28T00:00-04:00',
    })
  })

  it('picks nobody when started from an unknown artist or collective, and needs one to be picked', async () => {
    for (const path of ['/admin/candidatures/nouvelle?artist=gone', '/admin/candidatures/nouvelle?collective=artist-1']) {
      mockFetch({ ...LOGGED_IN, ...ARTISTS })
      const { unmount } = renderAt(path)

      expect(await screen.findByRole('combobox', { name: 'Artiste ou collectif' })).toHaveValue('')
      fireEvent.change(screen.getByLabelText('Date 1'), { target: { value: '2026-12-10' } })
      fireEvent.click(screen.getByRole('button', { name: 'créer la candidature' }))
      expect(screen.getByText("Choisissez l'artiste ou le collectif.")).toBeInTheDocument()
      expect(requestsTo('POST', '/api/admin/applications')).toHaveLength(0)
      unmount()
    }
  })

  it('asks to add the artist or the collective first when there is none', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists: [] }, '/api/admin/collectives': { ok: true, collectives: [] } })
    renderAt('/admin/candidatures/nouvelle')

    await waitFor(() => expect(screen.getByRole('link', { name: "l'artiste" })).toHaveAttribute('href', '/admin/artistes/nouveau'))
    expect(screen.getByRole('link', { name: 'le collectif' })).toHaveAttribute('href', '/admin/artistes/collectifs/nouveau')
  })

  it('says when the collectives could not be loaded, rather than offering only the artists', async () => {
    mockFetch({ ...LOGGED_IN, ...ARTISTS, '/api/admin/collectives': { ok: false, error: 'Boom' } })
    renderAt('/admin/candidatures/nouvelle')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les collectifs n'ont pas pu être chargés : Boom"))
    expect(screen.queryByRole('button', { name: 'créer la candidature' })).not.toBeInTheDocument()
  })
})
