import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import type { Application } from '../../application-fields'
import App from '../../app'
import type { Artist, Profile } from '../../artist-profile'
import type { Collective } from '../../collective-profile'
import type { Session, StudioSet } from '../../session-fields'
import { mockFetch, requestsTo } from '../../test-utils'

// Logged in, and without collectives, unless a test says otherwise.
const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' }, '/api/admin/collectives': { ok: true, collectives: [] } }

beforeEach(() => {
  // jsdom has neither, and the form uses both to show the photo picked.
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

const AURORE: Artist = {
  id: 'artist-1',
  hasPhoto: true,
  createdAt: '2026-10-01T16:00:00.000Z',
  createdBy: 'admin@example.com',
  name: 'Aurore',
  country: 'CA',
  city: 'Montréal',
  genres: ['techno', 'ambient'],
  bio: 'Première ligne.\nDeuxième ligne.',
  links: { soundcloud: 'aurore', web: 'https://aurore.example' },
  email: 'aurore@example.com',
  phone: '514 555 0101',
  updatedBy: null,
  updatedAt: null,
  collectives: [],
}

const BRUME: Artist = {
  ...AURORE,
  id: 'artist-2',
  createdBy: null,
  name: 'Brume',
  country: 'FR',
  city: 'Lyon',
  genres: ['house'],
  email: 'brume@example.com',
}

const CYAN: Artist = {
  ...AURORE,
  id: 'artist-3',
  name: 'Cyan',
  city: 'Bruxelles',
  country: 'BE',
  genres: ['electro', 'techno', 'house'],
  links: { instagram: 'cyan.sons' },
  email: 'cyan@courriel.test',
  phone: '+32 2 555 01 23',
}

// A collective, whose genres are its artists'.
const ONDES: Collective = {
  id: 'collective-1',
  hasPhoto: false,
  createdAt: '2026-10-02T16:00:00.000Z',
  createdBy: 'admin@example.com',
  name: 'Ondes',
  members: [
    { id: 'artist-1', name: 'Aurore' },
    { id: 'artist-3', name: 'Cyan' },
  ],
  country: 'CA',
  city: 'Québec',
  description: 'Une description.',
  links: { instagram: 'vagues.qc' },
  email: 'ondes@example.com',
  phone: '418 222 3344',
  updatedBy: null,
  updatedAt: null,
}

// What admins can leave out of a profile, as it's saved when they do.
// A set, and its session, for the lists of an artist's sets.
const STUB_SET: StudioSet = {
  id: 'set-1',
  performers: [{ id: 'artist-1', name: 'Aurore' }],
  offsetMinutes: 0,
  durationMinutes: 60,
  start: '2026-11-15T02:00:00.000Z',
  end: '2026-11-15T03:00:00.000Z',
  performanceTypes: ['dj'],
  otherPerformanceType: '',
  genres: [],
  soundcloudTrack: null,
  youtubeVideo: null,
  createdAt: '2026-10-01T16:00:00.000Z',
  createdBy: 'admin@example.com',
  updatedBy: null,
  updatedAt: null,
  status: 'planned',
  statusUpdatedBy: null,
  statusUpdatedAt: null,
}

function stubSession(sets: StudioSet[]): Session {
  return {
    ...STUB_SET,
    id: 'session-1',
    durationMinutes: 180,
    end: '2026-11-15T05:00:00.000Z',
    takeover: { id: 'collective-1', name: 'Ondes' },
    name: '',
    raEvent: null,
    sets,
  }
}

const LEFT_OUT: Partial<Profile> = { country: '', city: '', genres: [], bio: '', links: {}, email: null, phone: '' }

function application(id: string, artistId: string, changes: Partial<Application> = {}): Application {
  return {
    id,
    artistId,
    collectiveId: null,
    receivedAt: '2026-10-05T16:00:00.000Z',
    createdAt: '2026-10-05T16:00:00.000Z',
    createdBy: 'admin@example.com',
    dates: ['2026-12-10'],
    timeSlots: [],
    performanceTypes: ['dj'],
    otherPerformanceType: '',
    details: '',
    updatedBy: null,
    updatedAt: null,
    status: 'new',
    statusUpdatedBy: null,
    statusUpdatedAt: null,
    ...changes,
  }
}

const APPLICATIONS = [application('application-1', 'artist-1'), application('application-2', 'artist-1')]

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

// What was sent as the artist's profile and photo in a request to save one, and whether to remove their photo.
function sent(request: RequestInit) {
  const form = request.body as FormData
  return { profile: JSON.parse(form.get('artist') as string) as Profile, photo: form.get('photo'), removePhoto: form.get('removePhoto') }
}

const rows = () =>
  screen
    .queryAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
const names = () => rows().map((row) => row[0])

// Searches for `query`, and waits for the list to show `found`, by their first column.
async function expectSearch(query: string, found: string[]) {
  const field = await screen.findByRole('searchbox', { name: 'Rechercher' })
  fireEvent.change(field, { target: { value: query } })
  expect(field).toHaveValue(query)
  await waitFor(() => expect(names()).toEqual(found))
}

describe('The list of artists', () => {
  it('lists the artists', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists: [AURORE, BRUME] } })
    renderAt('/admin/artistes')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Nom ↑', 'Type', 'Ville', 'Genres'])
    expect(rows()).toEqual([
      ['Aurore', 'artiste', 'Montréal, Canada', 'techno, ambient'],
      ['Brume', 'artiste', 'Lyon, France', 'house'],
    ])
    expect(screen.getByRole('link', { name: 'Aurore' })).toHaveAttribute('href', '/admin/artistes/artist-1')
    expect(screen.getByRole('link', { name: 'ajouter un artiste' })).toHaveAttribute('href', '/admin/artistes/nouveau')
    expect(screen.getByRole('link', { name: 'ajouter un collectif' })).toHaveAttribute('href', '/admin/artistes/collectifs/nouveau')
    // Their applications are on their pages.
    expect(requestsTo('GET', '/api/admin/applications')).toHaveLength(0)
  })

  it('shows what the artists left out, e.g. those who applied through the original Google Form', async () => {
    const artists = [
      { ...AURORE, country: '', genres: [] },
      { ...BRUME, city: '' },
      { ...AURORE, id: 'artist-3', name: 'Cyan', country: '', city: '' },
    ]
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists } })
    renderAt('/admin/artistes')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(rows()).toEqual([
      ['Aurore', 'artiste', 'Montréal', '-'],
      ['Brume', 'artiste', 'France', 'house'],
      ['Cyan', 'artiste', '-', 'techno, ambient'],
    ])
  })

  it('lists the collectives with the artists, by name, with their artists’ genres, and links each one to its page', async () => {
    const empty: Collective = { ...ONDES, id: 'collective-2', name: 'Aube', members: [], city: '', country: '' }
    mockFetch({
      ...LOGGED_IN,
      '/api/admin/artists': { ok: true, artists: [AURORE, BRUME, CYAN] },
      '/api/admin/collectives': { ok: true, collectives: [ONDES, empty] },
    })
    renderAt('/admin/artistes')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(rows()).toEqual([
      // Without artists, it has no genres.
      ['Aube', 'collectif', '-', '-'],
      ['Aurore', 'artiste', 'Montréal, Canada', 'techno, ambient'],
      ['Brume', 'artiste', 'Lyon, France', 'house'],
      ['Cyan', 'artiste', 'Bruxelles, Belgique', 'électro, techno, house'],
      // Each artist's first genre, then each one's second, and so on.
      ['Ondes', 'collectif', 'Québec, Canada', 'techno, électro, ambient, house'],
    ])
    expect(screen.getByRole('link', { name: 'Ondes' })).toHaveAttribute('href', '/admin/artistes/collectifs/collective-1')
    expect(screen.getByRole('link', { name: 'Brume' })).toHaveAttribute('href', '/admin/artistes/artist-2')
  })

  it('says when there are no artists or collectives', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists: [] } })
    renderAt('/admin/artistes')

    await waitFor(() => expect(screen.getByText('Aucun artiste ni collectif.')).toBeInTheDocument())
  })

  it('says when the artists could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: false, error: 'Boom' } })
    renderAt('/admin/artistes')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom"))
  })

  it('says when the collectives could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists: [AURORE] }, '/api/admin/collectives': { ok: false, error: 'Boom' } })
    renderAt('/admin/artistes')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les collectifs n'ont pas pu être chargés : Boom"))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('Searching the list of artists', () => {
  const CYAN_SEARCHED: Artist = { ...CYAN, genres: ['electro'], bio: 'Fan de Montréal.' }

  beforeEach(() => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists: [AURORE, BRUME, CYAN_SEARCHED] } })
    renderAt('/admin/artistes')
  })

  it('finds artists by their names', async () => {
    await expectSearch('cyan', ['Cyan'])
  })

  it('finds artists whatever the case and accents, and despite a typo', async () => {
    await expectSearch('MONTREAL', ['Aurore'])
    await expectSearch('monreal', ['Aurore'])
    await expectSearch('electro', ['Cyan'])
  })

  it('finds artists by the start of a word, as it is typed', async () => {
    await expectSearch('brux', ['Cyan'])
  })

  it('finds artists by where they are from, their genres, links, email and phone, but not their bio', async () => {
    await expectSearch('belgique', ['Cyan'])
    await expectSearch('house', ['Brume'])
    await expectSearch('cyan.sons', ['Cyan'])
    await expectSearch('brume@example.com', ['Brume'])
    await expectSearch('5145550101', ['Aurore', 'Brume'])
    await expectSearch('Fan', [])
  })

  it('finds the artists that have every word searched for, in any of their fields', async () => {
    await expectSearch('house lyon', ['Brume'])
    await expectSearch('house bruxelles', [])
  })

  it('lists every artist while the search has no letters or digits, e.g. the start of a phone number', async () => {
    await expectSearch('+', ['Aurore', 'Brume', 'Cyan'])
    await expectSearch('+32', ['Cyan'])
  })

  it('says when no artist matches, and lists them all again once the search is cleared', async () => {
    await expectSearch('zzzzzz', [])
    expect(screen.getByText('Aucun artiste ni collectif ne correspond à la recherche.')).toBeInTheDocument()
    await expectSearch('', ['Aurore', 'Brume', 'Cyan'])
  })

  it('empties the field when the menu leads back to every artist', async () => {
    await expectSearch('lyon', ['Brume'])
    fireEvent.click(screen.getByRole('link', { name: 'artistes' }))
    await waitFor(() => expect(names()).toEqual(['Aurore', 'Brume', 'Cyan']))
    expect(screen.getByRole('searchbox', { name: 'Rechercher' })).toHaveValue('')
  })

  it('keeps the search in the URL', async () => {
    await expectSearch('lyon', ['Brume'])
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/artistes\?search=lyon$/)
    await expectSearch('', ['Aurore', 'Brume', 'Cyan'])
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/artistes$/)
  })
})

describe('Searching the list of artists, with ligatures', () => {
  it('finds artists whatever their ligatures, in the search or in what is searched', async () => {
    const artists = [{ ...AURORE, name: 'Les Sœurs Ondes' }, { ...BRUME, name: 'Soeur Marie' }]
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists } })
    renderAt('/admin/artistes')

    await expectSearch('soeurs ondes', ['Les Sœurs Ondes'])
    await expectSearch('sœur marie', ['Soeur Marie'])
  })
})

describe('Searching the collectives', () => {
  const BRISE: Collective = {
    ...ONDES,
    id: 'collective-2',
    name: 'Brise',
    members: [{ id: 'artist-1', name: 'Aurore' }],
    city: 'Gaspé',
    links: {},
    email: 'brise@example.com',
    phone: '',
  }

  beforeEach(() => {
    mockFetch({
      ...LOGGED_IN,
      '/api/admin/artists': { ok: true, artists: [AURORE, CYAN] },
      '/api/admin/collectives': { ok: true, collectives: [ONDES, BRISE] },
    })
    renderAt('/admin/artistes')
  })

  it('finds a collective by its artists’ names, along with the artists themselves', async () => {
    await expectSearch('cyan', ['Cyan', 'Ondes'])
    await expectSearch('aurore', ['Aurore', 'Brise', 'Ondes'])
  })

  it('finds a collective by its artists’ genres', async () => {
    await expectSearch('electro', ['Cyan', 'Ondes'])
  })

  it('finds a collective by where it is from, its links, email and phone, but not its description', async () => {
    await expectSearch('gaspe', ['Brise'])
    await expectSearch('vagues.qc', ['Ondes'])
    await expectSearch('brise@example.com', ['Brise'])
    await expectSearch('4182223344', ['Ondes'])
    await expectSearch('description', [])
  })
})

describe('Sorting the list of artists', () => {
  const CYAN: Artist = { ...AURORE, id: 'artist-3', name: 'Cyan', country: 'BE', city: 'Bruxelles' }
  const DORA: Artist = { ...AURORE, id: 'artist-4', name: 'Dora', city: '', country: '' }
  const ARTISTS = { ...LOGGED_IN, '/api/admin/artists': { ok: true, artists: [AURORE, BRUME, CYAN, DORA] } }

  it('sorts the artists by a column, then the other way around', async () => {
    mockFetch(ARTISTS)
    renderAt('/admin/artistes')

    const header = await screen.findByRole('columnheader', { name: 'Nom' })
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(within(header).getByRole('button'))
    expect(header).toHaveAttribute('aria-sort', 'descending')
    expect(names()).toEqual(['Dora', 'Cyan', 'Brume', 'Aurore'])
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/artistes\?sort=name&order=desc$/)
  })

  it('sorts artists before collectives, by name', async () => {
    const collectives = [
      { ...ONDES, name: 'Bise' },
      { ...ONDES, id: 'collective-2', name: 'Avril' },
    ]
    mockFetch({ ...ARTISTS, '/api/admin/collectives': { ok: true, collectives } })
    renderAt('/admin/artistes')

    fireEvent.click(await screen.findByRole('button', { name: 'Type' }))
    expect(screen.getByRole('columnheader', { name: 'Type' })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: 'Nom' })).not.toHaveAttribute('aria-sort')
    // Artists of the same type stay by name.
    expect(names()).toEqual(['Aurore', 'Brume', 'Cyan', 'Dora', 'Avril', 'Bise'])
    fireEvent.click(screen.getByRole('button', { name: 'Type' }))
    expect(names()).toEqual(['Avril', 'Bise', 'Aurore', 'Brume', 'Cyan', 'Dora'])
  })

  it('sorts artists by city, those without one first', async () => {
    mockFetch(ARTISTS)
    renderAt('/admin/artistes')

    fireEvent.click(await screen.findByRole('button', { name: 'Ville' }))
    expect(names()).toEqual(['Dora', 'Cyan', 'Brume', 'Aurore'])
  })

  it('sorts the artists as the URL says, along with the search', async () => {
    mockFetch(ARTISTS)
    renderAt('/admin/artistes?search=techno&sort=city&order=desc')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getByRole('searchbox', { name: 'Rechercher' })).toHaveValue('techno')
    // Brume's genre is house.
    expect(names()).toEqual(['Aurore', 'Cyan', 'Dora'])
  })
})

describe('An artist’s page', () => {
  const AURORE_PAGE = {
    ...LOGGED_IN,
    '/api/admin/artists/artist-1': { ok: true, artist: AURORE },
    '/api/admin/applications?artist=artist-1': { ok: true, applications: APPLICATIONS },
    '/api/admin/sessions?artist=artist-1': { ok: true, sessions: [] },
  }

  it('lists their applications, without sorting them since there are few, or the columns about the artist', async () => {
    mockFetch(AURORE_PAGE)
    renderAt('/admin/artistes/artist-1')

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(within(screen.getByRole('table')).queryAllByRole('button')).toHaveLength(0)
    // They're all theirs, so nothing about the artist is listed.
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Reçue le', 'Dates', 'Prestations', 'Statut'])
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('shows everything about the artist, and their applications', async () => {
    mockFetch(AURORE_PAGE)
    renderAt('/admin/artistes/artist-1')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Aurore' })).toBeInTheDocument())
    expect(screen.getByText(/^artiste, ajouté par/)).toHaveTextContent(/^artiste, ajouté par admin@example.com le 1 octobre 2026/)
    expect(screen.getByRole('img', { name: 'Photo de Aurore' }).getAttribute('src')).toMatch(/^\/api\/admin\/artists\/artist-1\/photo\?v=/)
    expect(screen.getByRole('link', { name: 'aurore' })).toHaveAttribute('href', 'https://soundcloud.com/aurore')
    expect(screen.getByRole('link', { name: 'https://aurore.example' })).toHaveAttribute('href', 'https://aurore.example')
    expect(screen.getByRole('link', { name: 'aurore@example.com' })).toHaveAttribute('href', 'mailto:aurore@example.com')
    expect(screen.getByText('techno, ambient')).toBeInTheDocument()
    expect(screen.getByText(/^Première ligne/)).toHaveTextContent('Première ligne. Deuxième ligne.')
    expect(screen.queryByText('Artistes du collectif')).not.toBeInTheDocument()
    // She's in no collective.
    expect(screen.queryByText('Collectifs')).not.toBeInTheDocument()
    expect(screen.queryByText(/retiré de ses collectifs/)).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getAllByRole('link', { name: '5 octobre 2026' })).toHaveLength(2))
    expect(screen.getAllByRole('link', { name: '5 octobre 2026' })[0]).toHaveAttribute('href', '/admin/candidatures/application-1')
    expect(screen.getByRole('link', { name: 'nouvelle candidature' })).toHaveAttribute('href', '/admin/candidatures/nouvelle?artist=artist-1')
  })

  it('shows what the artist left out, e.g. one who applied through the original Google Form', async () => {
    mockFetch({
      ...LOGGED_IN,
      '/api/admin/artists/artist-1': { ok: true, artist: { ...AURORE, ...LEFT_OUT } },
      '/api/admin/applications?artist=artist-1': { ok: true, applications: [] },
      '/api/admin/sessions?artist=artist-1': { ok: true, sessions: [] },
    })
    renderAt('/admin/artistes/artist-1')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Aurore' })).toBeInTheDocument())
    for (const term of ['Ville', 'Genres', 'Liens', 'Adresse e-mail', 'Téléphone', 'Bio']) {
      expect(screen.getByText(term, { selector: 'dt' }).nextElementSibling).toHaveTextContent(/^-$/)
    }
  })

  it('says that an artist came through the form', async () => {
    mockFetch({
      ...LOGGED_IN,
      '/api/admin/artists/artist-2': { ok: true, artist: BRUME },
      '/api/admin/applications?artist=artist-2': { ok: true, applications: [] },
      '/api/admin/sessions?artist=artist-2': { ok: true, sessions: [] },
    })
    renderAt('/admin/artistes/artist-2')

    await waitFor(() => expect(screen.getByText(/^artiste, inscrit/)).toBeInTheDocument())
    expect(screen.getByText(/^artiste, inscrit/)).toHaveTextContent('artiste, inscrit par le formulaire « appliquer » le 1 octobre 2026.')
    expect(screen.getByText('Aucune candidature.')).toBeInTheDocument()
  })

  it('lists the collectives they are in, linking to them, and says that deleting them takes them out', async () => {
    const collectives = [
      { id: 'collective-2', name: 'Brise' },
      { id: 'collective-1', name: 'Ondes' },
    ]
    mockFetch({ ...AURORE_PAGE, '/api/admin/artists/artist-1': { ok: true, artist: { ...AURORE, collectives } } })
    renderAt('/admin/artistes/artist-1')

    const links = await screen.findAllByRole('link', { name: /^(Brise|Ondes)$/ })
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/admin/artistes/collectifs/collective-2', '/admin/artistes/collectifs/collective-1'])
    expect(screen.getByText('Collectifs', { selector: 'dt' })).toBeInTheDocument()
    expect(screen.getByText(/seront supprimés pour de bon/)).toHaveTextContent("L'artiste sera aussi retiré de ses collectifs, qui restent.")
  })

  it("lists the sets they played, but not their sessions' other sets, only showing them, and says that deleting them takes them out", async () => {
    // Cancelled, and with another artist, in a session that has another artist's set too.
    const played: StudioSet = { ...STUB_SET, performers: [...STUB_SET.performers, { id: 'artist-2', name: 'Brume' }], status: 'cancelled' }
    const other: StudioSet = { ...STUB_SET, id: 'set-2', performers: [{ id: 'artist-2', name: 'Brume' }], offsetMinutes: 60, start: '2026-11-15T03:00:00.000Z', end: '2026-11-15T04:00:00.000Z' }
    mockFetch({ ...AURORE_PAGE, '/api/admin/sessions?artist=artist-1': { ok: true, sessions: [stubSession([played, other])] } })
    renderAt('/admin/artistes/artist-1')

    const table = await screen.findByRole('table', { name: 'Sets' })
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent)),
    ).toEqual([['sam. 14 nov. 2026', '21 h – 22 h', 'Takeover de Ondes', 'Aurore, Brume', 'DJ', '-', '', 'annulé']])
    expect(within(table).getAllByRole('row')[1]).toHaveClass('admin-status-cancelled')
    expect(within(table).getByRole('link', { name: 'Takeover de Ondes' })).toHaveAttribute('href', '/admin/sessions/session-1')
    expect(within(table).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /set/ })).not.toBeInTheDocument()
    expect(screen.getByText(/seront supprimés pour de bon/)).toHaveTextContent("L'artiste sera aussi retiré de ses sets, qui restent.")
  })

  it.each([
    [[{ id: 'collective-1', name: 'Ondes' }], [], "L'artiste sera aussi retiré de ses collectifs, qui restent."],
    [[], [{ id: 'set-1' }], "L'artiste sera aussi retiré de ses sets, qui restent."],
    [[{ id: 'collective-1', name: 'Ondes' }], [{ id: 'set-1' }], "L'artiste sera aussi retiré de ses collectifs et de ses sets, qui restent."],
  ])('says what deleting the artist takes them out of, when they are in collectives (%j) and sets (%j)', async (collectives, sets, text) => {
    mockFetch({
      ...AURORE_PAGE,
      '/api/admin/artists/artist-1': { ok: true, artist: { ...AURORE, collectives } },
      '/api/admin/sessions?artist=artist-1': { ok: true, sessions: sets.length > 0 ? [stubSession(sets.map(({ id }) => ({ ...STUB_SET, id })))] : [] },
    })
    renderAt('/admin/artistes/artist-1')

    await waitFor(() => expect(screen.getByText(/seront supprimés pour de bon/)).toHaveTextContent(text))
  })

  it('changes the artist, keeping their photo unless another one is chosen', async () => {
    const changed: Artist = { ...AURORE, bio: 'Une bio corrigée.', updatedBy: 'other@example.com', updatedAt: '2026-10-06T16:00:00.000Z' }
    mockFetch({ ...AURORE_PAGE, 'PUT /api/admin/artists/artist-1': { ok: true, artist: changed } })
    renderAt('/admin/artistes/artist-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    expect(screen.getByLabelText("Nom d'artiste")).toHaveValue('Aurore')
    expect(screen.getByLabelText('SoundCloud')).toHaveValue('aurore')
    expect(screen.getByLabelText('Photo')).not.toBeRequired()
    expect(screen.getByRole('img', { name: 'Photo actuelle' }).getAttribute('src')).toMatch(/^\/api\/admin\/artists\/artist-1\/photo\?v=/)
    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'Une bio corrigée.' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(screen.getByText('Une bio corrigée.')).toBeInTheDocument())
    const [request] = requestsTo('PUT', '/api/admin/artists/artist-1')
    const { profile, photo, removePhoto } = sent(request)
    expect(profile).toEqual({
      name: 'Aurore',
      country: 'CA',
      city: 'Montréal',
      genres: ['techno', 'ambient'],
      bio: 'Une bio corrigée.',
      links: { soundcloud: 'aurore', web: 'https://aurore.example' },
      email: 'aurore@example.com',
      phone: '514 555 0101',
    })
    expect(photo).toBeNull()
    expect(removePhoto).toBeNull()
    expect(screen.getByText(/^Modifié par/)).toHaveTextContent(/^Modifié par other@example.com le 6 octobre 2026/)
  })

  it("takes out the artist's bio and email, which are then sent empty and null", async () => {
    const changed: Artist = { ...AURORE, bio: '', email: null, updatedBy: 'other@example.com', updatedAt: '2026-10-06T16:00:00.000Z' }
    mockFetch({ ...AURORE_PAGE, 'PUT /api/admin/artists/artist-1': { ok: true, artist: changed } })
    renderAt('/admin/artistes/artist-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: ' ' } })
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(screen.getByText(/^Modifié par/)).toBeInTheDocument())
    expect(sent(requestsTo('PUT', '/api/admin/artists/artist-1')[0]).profile).toMatchObject({ bio: '', email: null })
    expect(screen.getByText('Adresse e-mail', { selector: 'dt' }).nextElementSibling).toHaveTextContent(/^-$/)
    // An artist without an email is changed with the field empty.
    fireEvent.click(screen.getByRole('button', { name: 'modifier' }))
    expect(screen.getByLabelText('Adresse e-mail')).toHaveValue('')
  })

  it('checks another photo, if one is chosen', async () => {
    mockFetch(AURORE_PAGE)
    renderAt('/admin/artistes/artist-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    const photo = screen.getByLabelText('Photo')
    fireEvent.change(photo, { target: { files: [new File(['gif'], 'aurore.gif', { type: 'image/gif' })] } })
    expect(photo.closest('.admin-field')?.querySelector('.admin-field-error')).toHaveTextContent('La photo doit être en JPEG, PNG ou WebP.')
    // The focus stays on the input, so the error is announced, and again for another wrong photo.
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('La photo doit être en JPEG, PNG ou WebP.')
    fireEvent.change(photo, { target: { files: [new File(['gif'], 'autre.gif', { type: 'image/gif' })] } })
    expect(screen.getByRole('alert')).not.toBe(alert)
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(requestsTo('PUT', '/api/admin/artists/artist-1')).toHaveLength(0)
  })

  it('removes the photo with its ×, once the artist is saved', async () => {
    const changed: Artist = { ...AURORE, hasPhoto: false, updatedBy: 'other@example.com', updatedAt: '2026-10-06T16:00:00.000Z' }
    mockFetch({ ...AURORE_PAGE, 'PUT /api/admin/artists/artist-1': { ok: true, artist: changed } })
    renderAt('/admin/artistes/artist-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.click(screen.getByRole('button', { name: 'retirer la photo' }))
    expect(screen.queryByRole('img', { name: 'Photo actuelle' })).not.toBeInTheDocument()
    expect(screen.getByText(/La photo actuelle sera retirée à l'enregistrement\./)).toBeInTheDocument()
    // The × is gone, so the focus moves to the input that picks a photo.
    expect(screen.getByLabelText('Photo')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(screen.getByText('Pas de photo')).toBeInTheDocument())
    const { photo, removePhoto } = sent(requestsTo('PUT', '/api/admin/artists/artist-1')[0])
    expect(photo).toBeNull()
    expect(removePhoto).toBe('true')
    expect(screen.queryByRole('img', { name: 'Photo de Aurore' })).not.toBeInTheDocument()
  })

  it('shows the photo picked in place of the current one, with an × that brings the current one back', async () => {
    mockFetch(AURORE_PAGE)
    renderAt('/admin/artistes/artist-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    const input = screen.getByLabelText('Photo')
    fireEvent.change(input, { target: { files: [new File(['photo'], 'aurore.png', { type: 'image/png' })] } })
    expect(screen.getByRole('img', { name: 'Photo choisie' })).toHaveAttribute('src', 'blob:preview')
    expect(screen.queryByRole('img', { name: 'Photo actuelle' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'retirer la photo choisie' }))
    expect(screen.queryByRole('img', { name: 'Photo choisie' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Photo actuelle' })).toBeInTheDocument()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
  })

  it('sends a photo picked after removing the current one, rather than removing it', async () => {
    mockFetch({ ...AURORE_PAGE, 'PUT /api/admin/artists/artist-1': { ok: true, artist: AURORE } })
    renderAt('/admin/artistes/artist-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.click(screen.getByRole('button', { name: 'retirer la photo' }))
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [new File(['photo'], 'aurore.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(requestsTo('PUT', '/api/admin/artists/artist-1')).toHaveLength(1))
    const { photo, removePhoto } = sent(requestsTo('PUT', '/api/admin/artists/artist-1')[0])
    expect((photo as File).name).toBe('aurore.png')
    expect(removePhoto).toBeNull()
  })

  it("shows that an artist has no photo, and doesn't offer to remove it", async () => {
    const withoutPhoto: Artist = { ...AURORE, hasPhoto: false }
    mockFetch({ ...AURORE_PAGE, '/api/admin/artists/artist-1': { ok: true, artist: withoutPhoto } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    renderAt('/admin/artistes/artist-1')

    expect(await screen.findByText('Pas de photo')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Photo de Aurore' })).not.toBeInTheDocument()
    expect(screen.getByText(/^L'artiste et ses candidatures seront supprimés/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByRole('link', { name: '5 octobre 2026' })).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: "supprimer l'artiste" }))
    expect(confirm).toHaveBeenLastCalledWith('Supprimer définitivement Aurore et ses candidatures (2) ?')

    fireEvent.click(screen.getByRole('button', { name: 'modifier' }))
    expect(screen.queryByRole('img', { name: 'Photo actuelle' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'retirer la photo' })).not.toBeInTheDocument()
  })

  it('shows why the artist could not be changed, and keeps the form', async () => {
    mockFetch({ ...AURORE_PAGE, 'PUT /api/admin/artists/artist-1': { ok: false, error: 'Another artist has this email address' } })
    renderAt('/admin/artistes/artist-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("L'artiste n'a pas pu être enregistré : Another artist has this email address"),
    )
    expect(screen.getByRole('button', { name: 'enregistrer' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'annuler' }))
    expect(screen.getByRole('button', { name: 'modifier' })).toBeInTheDocument()
  })

  it('deletes the artist once confirmed, and goes back to the list', async () => {
    mockFetch({
      ...AURORE_PAGE,
      'DELETE /api/admin/artists/artist-1': { ok: true },
      '/api/admin/artists': { ok: true, artists: [] },
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderAt('/admin/artistes/artist-1')

    await waitFor(() => expect(screen.getAllByRole('link', { name: '5 octobre 2026' })).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: "supprimer l'artiste" }))
    expect(confirm).toHaveBeenLastCalledWith('Supprimer définitivement Aurore, sa photo et ses candidatures (2) ?')
    expect(requestsTo('DELETE', '/api/admin/artists/artist-1')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: "supprimer l'artiste" }))
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/artistes$/))
    expect(requestsTo('DELETE', '/api/admin/artists/artist-1')).toHaveLength(1)
  })
})

// Fills in a valid artist, in the form for a new one.
function fillValidArtist() {
  fireEvent.change(screen.getByLabelText("Nom d'artiste"), { target: { value: 'Aurore' } })
  fireEvent.change(screen.getByLabelText('Ville'), { target: { value: 'Montréal' } })
  fireEvent.click(screen.getByRole('button', { name: 'techno' }))
  fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'Une bio.' } })
  fireEvent.change(screen.getByLabelText('SoundCloud'), { target: { value: 'aurore' } })
  fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'aurore@example.com' } })
  fireEvent.change(screen.getByLabelText('Téléphone'), { target: { value: '514 555 0101' } })
  fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [new File(['photo'], 'aurore.jpg', { type: 'image/jpeg' })] } })
}

const submitButton = (name: string) => screen.getByRole('button', { name })
// The error shown under a field, found from its input.
const errorOf = (input: HTMLElement) => input.closest('.admin-field, fieldset')?.querySelector('.admin-field-error')?.textContent ?? null

describe('Deleting an artist before their applications are loaded', () => {
  it('still says that their applications go with them', async () => {
    mockFetch({
      ...LOGGED_IN,
      '/api/admin/artists/artist-1': { ok: true, artist: AURORE },
      '/api/admin/applications?artist=artist-1': { ok: false, error: 'Boom' },
      '/api/admin/sessions?artist=artist-1': { ok: true, sessions: [] },
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    renderAt('/admin/artistes/artist-1')

    fireEvent.click(await screen.findByRole('button', { name: "supprimer l'artiste" }))
    expect(confirm).toHaveBeenLastCalledWith('Supprimer définitivement Aurore, sa photo et ses candidatures ?')
  })
})

describe('Adding an artist', () => {
  const NEW = { ...LOGGED_IN }

  it('sends the profile and the photo, then shows the new artist', async () => {
    const added: Artist = { ...BRUME, id: 'artist-3', createdBy: 'admin@example.com' }
    mockFetch({
      ...LOGGED_IN,
      'POST /api/admin/artists': { ok: true, artist: added },
      '/api/admin/artists/artist-3': { ok: true, artist: added },
      '/api/admin/applications?artist=artist-3': { ok: true, applications: [] },
      '/api/admin/sessions?artist=artist-3': { ok: true, sessions: [] },
    })
    renderAt('/admin/artistes/nouveau')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Nouvel artiste' })).toBeInTheDocument())
    expect(screen.getByLabelText('Photo')).not.toBeRequired()
    expect(screen.queryByRole('button', { name: 'retirer la photo' })).not.toBeInTheDocument()
    // Collectives are added with their own form.
    expect(screen.queryByRole('group', { name: 'Type' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Nom d'artiste"), { target: { value: 'Brume' } })
    const country = screen.getByRole('combobox', { name: 'Pays' })
    fireEvent.change(country, { target: { value: 'fran' } })
    fireEvent.keyDown(country, { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Ville'), { target: { value: 'Lyon' } })
    fireEvent.click(screen.getByRole('button', { name: 'house' }))
    fireEvent.click(screen.getByRole('button', { name: 'disco' }))
    fireEvent.click(screen.getByRole('button', { name: 'techno' }))
    fireEvent.click(screen.getByRole('button', { name: 'disco' }))
    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'Une bio.' } })
    fireEvent.change(screen.getByLabelText('Instagram'), { target: { value: 'https://instagram.com/brume' } })
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'brume@example.com' } })
    fireEvent.change(screen.getByLabelText('Téléphone'), { target: { value: '+33 6 00 00 00 00' } })
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [new File(['photo'], 'brume.jpg', { type: 'image/jpeg' })] } })
    fireEvent.click(submitButton("ajouter l'artiste"))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/admin/artistes/artist-3'))
    const [request] = requestsTo('POST', '/api/admin/artists')
    // As multipart/form-data, with the boundary between its parts, as the browser sets it.
    expect(new Headers(request.headers).get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/)
    const { profile, photo } = sent(request)
    // What's saved of it, e.g. the profile name rather than the address of the Instagram profile.
    expect(profile).toEqual({
      name: 'Brume',
      country: 'FR',
      city: 'Lyon',
      genres: ['house', 'techno'],
      bio: 'Une bio.',
      links: { instagram: 'brume' },
      email: 'brume@example.com',
      phone: '+33 6 00 00 00 00',
    })
    expect(photo).toBeInstanceOf(File)
    expect((photo as File).name).toBe('brume.jpg')
  })

  it('adds an artist without a photo', async () => {
    const added: Artist = { ...AURORE, id: 'artist-3', hasPhoto: false }
    mockFetch({
      ...LOGGED_IN,
      'POST /api/admin/artists': { ok: true, artist: added },
      '/api/admin/artists/artist-3': { ok: true, artist: added },
      '/api/admin/applications?artist=artist-3': { ok: true, applications: [] },
      '/api/admin/sessions?artist=artist-3': { ok: true, sessions: [] },
    })
    renderAt('/admin/artistes/nouveau')

    await screen.findByLabelText("Nom d'artiste")
    fillValidArtist()
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [] } })
    fireEvent.click(submitButton("ajouter l'artiste"))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/admin/artistes/artist-3'))
    expect(sent(requestsTo('POST', '/api/admin/artists')[0]).photo).toBeNull()
  })

  it('says what is wrong with every field when the form is sent, and sends nothing', async () => {
    mockFetch(NEW)
    renderAt('/admin/artistes/nouveau')

    fireEvent.change(await screen.findByLabelText('Adresse e-mail'), { target: { value: 'brume@' } })
    expect(document.querySelectorAll('.admin-field-error')).toHaveLength(0)
    fireEvent.click(submitButton("ajouter l'artiste"))

    expect(errorOf(screen.getByLabelText("Nom d'artiste"))).toBe("Indiquez le nom d'artiste.")
    expect(errorOf(screen.getByLabelText('Adresse e-mail'))).toBe('Indiquez une adresse e-mail valide.')
    // Admins can leave these out, unlike artists, and the photo is optional.
    expect(errorOf(screen.getByLabelText('Ville'))).toBeNull()
    expect(errorOf(screen.getByRole('group', { name: 'Tous les genres' }))).toBeNull()
    expect(errorOf(screen.getByLabelText('Bio'))).toBeNull()
    expect(errorOf(screen.getByLabelText('SoundCloud'))).toBeNull()
    expect(errorOf(screen.getByLabelText('Téléphone'))).toBeNull()
    expect(errorOf(screen.getByLabelText('Photo'))).toBeNull()
    // The first field to fix gets the focus.
    await waitFor(() => expect(screen.getByLabelText("Nom d'artiste")).toHaveFocus())
    expect(requestsTo('POST', '/api/admin/artists')).toHaveLength(0)
  })

  it('says what is wrong with a field once it is left, rather than while it is being filled', async () => {
    mockFetch(NEW)
    renderAt('/admin/artistes/nouveau')

    const email = await screen.findByLabelText('Adresse e-mail')
    fireEvent.change(email, { target: { value: 'aurore@' } })
    expect(errorOf(email)).toBeNull()
    fireEvent.blur(email)
    expect(errorOf(email)).toBe('Indiquez une adresse e-mail valide.')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(email, { target: { value: 'aurore@example.com' } })
    expect(errorOf(email)).toBeNull()

    // Other fields aren't concerned.
    expect(errorOf(screen.getByLabelText('Ville'))).toBeNull()
  })

  it('checks each link once it is left, and keeps only the profile name of an address', async () => {
    mockFetch(NEW)
    renderAt('/admin/artistes/nouveau')

    const soundcloud = await screen.findByLabelText('SoundCloud')
    fireEvent.change(soundcloud, { target: { value: 'https://soundcloud.com/discover' } })
    expect(errorOf(soundcloud)).toBeNull()
    fireEvent.blur(soundcloud)
    expect(errorOf(soundcloud)).toBe("copiez l'adresse de la page de profil, qui commence par soundcloud.com/")
    // The field's own error, that there's no link, isn't shown on top.
    expect(screen.queryByText('Ajoutez au moins un lien.')).not.toBeInTheDocument()

    fireEvent.change(soundcloud, { target: { value: 'https://soundcloud.com/aurore/un-set?si=1' } })
    fireEvent.blur(soundcloud)
    expect(soundcloud).toHaveValue('aurore')
    expect(errorOf(soundcloud)).toBeNull()
    expect(screen.getByRole('link', { name: 'vérifier ↗' })).toHaveAttribute('href', 'https://soundcloud.com/aurore')
  })

  it('brings the first wrong link into focus when the form is sent', async () => {
    mockFetch(NEW)
    renderAt('/admin/artistes/nouveau')

    await screen.findByLabelText("Nom d'artiste")
    fillValidArtist()
    fireEvent.change(screen.getByLabelText('Instagram'), { target: { value: 'https://soundcloud.com/aurore' } })
    fireEvent.click(submitButton("ajouter l'artiste"))

    expect(errorOf(screen.getByLabelText('Instagram'))).toBe("ce n'est pas une adresse Instagram")
    await waitFor(() => expect(screen.getByLabelText('Instagram')).toHaveFocus())
    expect(requestsTo('POST', '/api/admin/artists')).toHaveLength(0)
  })

  it('adds an artist without a country, city, genres, bio, links, email or phone, e.g. one who applied through the original Google Form', async () => {
    const added: Artist = { ...AURORE, id: 'artist-3', ...LEFT_OUT }
    mockFetch({
      ...NEW,
      'POST /api/admin/artists': { ok: true, artist: added },
      '/api/admin/artists/artist-3': { ok: true, artist: added },
      '/api/admin/applications?artist=artist-3': { ok: true, applications: [] },
      '/api/admin/sessions?artist=artist-3': { ok: true, sessions: [] },
    })
    renderAt('/admin/artistes/nouveau')

    await screen.findByLabelText("Nom d'artiste")
    fireEvent.change(screen.getByLabelText("Nom d'artiste"), { target: { value: 'Aurore' } })
    const country = screen.getByRole('combobox', { name: 'Pays' })
    fireEvent.change(country, { target: { value: 'inconnu' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Pays inconnu' }))
    expect(country).toHaveValue('Pays inconnu')
    fireEvent.click(submitButton("ajouter l'artiste"))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/admin/artistes/artist-3'))
    expect(sent(requestsTo('POST', '/api/admin/artists')[0]).profile).toEqual({
      name: 'Aurore',
      country: '',
      city: '',
      genres: [],
      bio: '',
      links: {},
      email: null,
      phone: '',
    })
  })

  it('leaves the type of a photo the browser does not know to the server', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/artists': { ok: false, error: 'Stop' } })
    renderAt('/admin/artistes/nouveau')

    await screen.findByLabelText("Nom d'artiste")
    fillValidArtist()
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [new File(['photo'], 'aurore', { type: '' })] } })
    fireEvent.click(submitButton("ajouter l'artiste"))

    await waitFor(() => expect(requestsTo('POST', '/api/admin/artists')).toHaveLength(1))
  })

  it('pins genres by clicking them, most important first, and unpins them the same way', async () => {
    mockFetch(NEW)
    renderAt('/admin/artistes/nouveau')

    const tags = within(await screen.findByRole('group', { name: 'Tous les genres' }))
    fireEvent.click(tags.getByRole('button', { name: 'acid' }))
    fireEvent.click(tags.getByRole('button', { name: 'house' }))
    fireEvent.click(tags.getByRole('button', { name: 'jungle' }))
    expect(tags.getByRole('button', { name: 'house' })).toHaveAttribute('aria-pressed', 'true')
    expect(tags.getByRole('button', { name: 'disco' })).toHaveAttribute('aria-pressed', 'false')
    const pinned = () => screen.getAllByRole('button', { name: /^retirer / }).map((button) => button.getAttribute('aria-label'))
    expect(pinned()).toEqual(['retirer acid', 'retirer house', 'retirer jungle'])

    fireEvent.click(tags.getByRole('button', { name: 'acid' }))
    fireEvent.click(screen.getByRole('button', { name: 'retirer jungle' }))
    expect(pinned()).toEqual(['retirer house'])
    expect(tags.getByRole('button', { name: 'acid' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('suggests countries by name in French, whatever their case and accents, or by code', async () => {
    mockFetch(NEW)
    renderAt('/admin/artistes/nouveau')

    const country = await screen.findByRole('combobox', { name: 'Pays' })
    expect(country).toHaveValue('Canada')
    const suggested = () => screen.getAllByRole('option').map((option) => option.textContent)

    fireEvent.change(country, { target: { value: 'etats' } })
    expect(suggested()[0]).toBe('États-Unis')
    fireEvent.change(country, { target: { value: 'ALLE' } })
    expect(suggested()[0]).toBe('Allemagne')
    fireEvent.change(country, { target: { value: 'be' } })
    // Those that start with it first.
    expect(suggested().slice(0, 2)).toEqual(['Belgique', 'Belize'])
    fireEvent.change(country, { target: { value: 'xyz' } })
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByText('aucun résultat')).toBeVisible()

    fireEvent.change(country, { target: { value: 'fr' } })
    fireEvent.keyDown(country, { key: 'ArrowDown' })
    fireEvent.mouseDown(screen.getByRole('option', { name: 'France' }))
    expect(country).toHaveValue('France')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('keeps the country picked when the field is left without picking another one, unless its name was typed', async () => {
    mockFetch(NEW)
    renderAt('/admin/artistes/nouveau')

    const country = await screen.findByRole('combobox', { name: 'Pays' })
    fireEvent.change(country, { target: { value: 'Fran' } })
    fireEvent.blur(country)
    expect(country).toHaveValue('Canada')

    fireEvent.change(country, { target: { value: 'belgique' } })
    fireEvent.blur(country)
    expect(country).toHaveValue('Belgique')
  })

  it('starts from the country picked when every country is shown, so that Enter keeps it', async () => {
    mockFetch(NEW)
    renderAt('/admin/artistes/nouveau')

    const country = await screen.findByRole('combobox', { name: 'Pays' })
    fireEvent.click(country)
    expect(screen.getByRole('option', { name: 'Canada' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(country, { key: 'Enter' })
    expect(country).toHaveValue('Canada')

    // Also once what was typed is erased, which shows every country again.
    fireEvent.click(country)
    fireEvent.change(country, { target: { value: 'f' } })
    fireEvent.change(country, { target: { value: '' } })
    fireEvent.keyDown(country, { key: 'Enter' })
    expect(country).toHaveValue('Canada')

    fireEvent.keyDown(country, { key: 'ArrowDown' })
    fireEvent.keyDown(country, { key: 'ArrowDown' })
    fireEvent.keyDown(country, { key: 'Enter' })
    expect(country).toHaveValue('Cap-Vert')
  })
})
