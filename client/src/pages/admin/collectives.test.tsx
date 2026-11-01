import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import App from '../../app'
import type { Application } from '../../application-fields'
import type { Artist } from '../../artist-profile'
import type { Collective, CollectiveProfile } from '../../collective-profile'
import { mockFetch, requestsTo } from '../../test-utils'

const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' } }

beforeEach(() => {
  // jsdom has neither, and the form uses both to show the photo picked.
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

function artist(id: string, name: string, changes: Partial<Artist> = {}): Artist {
  return {
    id,
    hasPhoto: false,
    createdAt: '2026-10-01T16:00:00.000Z',
    createdBy: 'admin@example.com',
    kind: 'artist',
    name,
    members: [],
    country: 'CA',
    city: 'Montréal',
    genres: [],
    bio: '',
    links: {},
    email: `${name.toLowerCase()}@example.com`,
    phone: '',
    updatedBy: null,
    updatedAt: null,
    collectives: [],
    ...changes,
  }
}

const AURORE = artist('artist-1', 'Aurore', { genres: ['techno', 'ambient'] })
// An artist whose `kind` is "collective", as collectives were before they had their own profiles.
const BRUME = artist('artist-2', 'Brume', { kind: 'collective', members: ['Ana'] })
// Without an email, they're told apart by where they're from, or else by their collectives.
const CYAN = artist('artist-3', 'Cyan', { email: null, city: 'Bruxelles', country: 'BE', genres: ['electro', 'house', 'techno'] })
const DORA = artist('artist-4', 'Dora', { email: null, city: '', country: '', collectives: [{ id: 'collective-2', name: 'Brise' }] })
const ARTISTS = [AURORE, BRUME, CYAN, DORA]

const ONDES: Collective = {
  id: 'collective-1',
  hasPhoto: true,
  createdAt: '2026-10-02T16:00:00.000Z',
  createdBy: 'admin@example.com',
  name: 'Ondes',
  members: [
    { id: 'artist-1', name: 'Aurore' },
    { id: 'artist-3', name: 'Cyan' },
  ],
  country: 'CA',
  city: 'Québec',
  description: 'Première ligne.\nDeuxième ligne.',
  links: { instagram: 'ondes.qc' },
  email: 'ondes@example.com',
  phone: '418 555 0101',
  updatedBy: null,
  updatedAt: null,
}

// Its page: the collective, its artists, for its genres, its applications, and every artist, for its form.
const ONDES_PAGE = {
  ...LOGGED_IN,
  '/api/admin/collectives/collective-1': { ok: true, collective: ONDES },
  '/api/admin/artists?collective=collective-1': { ok: true, artists: [AURORE, CYAN] },
  '/api/admin/applications?collective=collective-1': { ok: true, applications: [] },
  '/api/admin/artists': { ok: true, artists: ARTISTS },
}

const APPLICATION: Application = {
  id: 'application-1',
  artistId: null,
  collectiveId: 'collective-1',
  receivedAt: '2026-10-05T16:00:00.000Z',
  createdAt: '2026-10-05T16:00:00.000Z',
  createdBy: 'admin@example.com',
  dates: ['2026-12-10'],
  timeSlots: [],
  prestations: ['dj', 'full-band'],
  otherPrestation: '',
  details: '',
  updatedBy: null,
  updatedAt: null,
  status: 'accepted',
  statusUpdatedBy: null,
  statusUpdatedAt: null,
}

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

// What was sent as the collective's profile and photo in a request to save one, and whether to remove its photo.
function sent(request: RequestInit) {
  const form = request.body as FormData
  return {
    profile: JSON.parse(form.get('collective') as string) as CollectiveProfile,
    photo: form.get('photo'),
    removePhoto: form.get('removePhoto'),
  }
}

// Opens the collective's form, once its page is shown, and waits for it, once it has loaded the artists.
async function edit() {
  fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
  await screen.findByLabelText('Nom du collectif')
}

// What a term of the collective's page says.
const described = (term: string) => screen.getByText(term, { selector: 'dt' }).nextElementSibling
// The error shown under a field, found from its input.
const errorOf = (input: HTMLElement) => input.closest('.admin-field, fieldset')?.querySelector('.admin-field-error')?.textContent ?? null
// The collective's artists in the form, as they read, e.g. "1Aurore↑↓×".
const chosen = () =>
  within(membersField())
    .queryAllByRole('listitem')
    .map((item) => item.textContent)
const membersField = () => screen.getByRole('group', { name: 'Artistes du collectif' })
const picker = () => screen.getByRole('combobox', { name: 'Ajouter un artiste connu' })
const newArtist = () => screen.getByLabelText('Ajouter un nouvel artiste')

// Picks one of the known artists, by the start of what their option says.
function pick(name: string) {
  fireEvent.click(picker())
  fireEvent.mouseDown(screen.getByRole('option', { name: new RegExp(`^${name}`) }))
}

// Adds a new artist by name, with + or else with Enter.
function addNew(name: string, { enter = false } = {}) {
  fireEvent.change(newArtist(), { target: { value: name } })
  if (enter) fireEvent.keyDown(newArtist(), { key: 'Enter' })
  else fireEvent.click(screen.getByRole('button', { name: 'ajouter ce nouvel artiste au collectif' }))
}

describe('A collective’s page', () => {
  it('shows everything about the collective, with its artists in order, linking to them, and their genres', async () => {
    mockFetch(ONDES_PAGE)
    renderAt('/admin/artistes/collectifs/collective-1')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Ondes' })).toBeInTheDocument())
    expect(screen.getByText(/^collectif, ajouté par/)).toHaveTextContent(/^collectif, ajouté par admin@example.com le 2 octobre 2026/)
    expect(screen.queryByText(/^Modifié par/)).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Photo de Ondes' }).getAttribute('src')).toMatch(/^\/api\/admin\/collectives\/collective-1\/photo\?v=/)
    const members = within(described('Artistes du collectif') as HTMLElement).getAllByRole('link')
    expect(members.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Aurore', '/admin/artistes/artist-1'],
      ['Cyan', '/admin/artistes/artist-3'],
    ])
    expect(described('Ville')).toHaveTextContent('Québec, Canada')
    // Each artist's first genre, then each one's second, and so on.
    expect(described('Genres de ses artistes')).toHaveTextContent('techno, électro, ambient, house')
    expect(screen.getByRole('link', { name: 'ondes.qc' })).toHaveAttribute('href', 'https://instagram.com/ondes.qc')
    expect(screen.getByRole('link', { name: 'ondes@example.com' })).toHaveAttribute('href', 'mailto:ondes@example.com')
    expect(screen.getByRole('link', { name: '418 555 0101' })).toHaveAttribute('href', 'tel:418 555 0101')
    expect(described('Description')).toHaveTextContent('Première ligne. Deuxième ligne.')
    // It's in the artists section.
    expect(screen.getByRole('link', { name: 'artistes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '← tous les artistes' })).toHaveAttribute('href', '/admin/artistes')
    expect(screen.getByRole('link', { name: 'nouvelle candidature' })).toHaveAttribute('href', '/admin/candidatures/nouvelle?collectif=collective-1')
    expect(screen.getByText('Aucune candidature.')).toBeInTheDocument()
  })

  it('lists its applications, without the collective', async () => {
    mockFetch({ ...ONDES_PAGE, '/api/admin/applications?collective=collective-1': { ok: true, applications: [APPLICATION] } })
    renderAt('/admin/artistes/collectifs/collective-1')

    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Reçue le', 'Dates', 'Prestations', 'Statut'])
    expect(within(table).getByRole('link', { name: '5 octobre 2026' })).toHaveAttribute('href', '/admin/candidatures/application-1')
    expect(within(table).getByText('DJ, Full Band')).toBeInTheDocument()
  })

  it('says when its applications could not be loaded', async () => {
    mockFetch({ ...ONDES_PAGE, '/api/admin/applications?collective=collective-1': { ok: false, error: 'Boom' } })
    renderAt('/admin/artistes/collectifs/collective-1')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les candidatures n'ont pas pu être chargées : Boom"))
    expect(described('Genres de ses artistes')).toHaveTextContent('techno, électro, ambient, house')
  })

  it('says when it has no artists, e.g. once they were deleted, and that it applied by itself', async () => {
    const left: Collective = { ...ONDES, hasPhoto: false, members: [], createdBy: null, links: {}, phone: '', description: '' }
    mockFetch({ ...ONDES_PAGE, '/api/admin/collectives/collective-1': { ok: true, collective: left } })
    renderAt('/admin/artistes/collectifs/collective-1')

    await waitFor(() => expect(described('Artistes du collectif')).toHaveTextContent('Aucun artiste.'))
    expect(screen.getByText(/^collectif, inscrit/)).toHaveTextContent('collectif, inscrit par le formulaire « appliquer » le 2 octobre 2026.')
    expect(screen.getByText('Pas de photo')).toBeInTheDocument()
    for (const term of ['Genres de ses artistes', 'Liens', 'Téléphone du contact', 'Description']) {
      expect(described(term)).toHaveTextContent(/^-$/)
    }
  })

  it('says when the collective could not be loaded', async () => {
    mockFetch({ ...ONDES_PAGE, '/api/admin/collectives/collective-1': { ok: false, error: 'No such collective' } })
    renderAt('/admin/artistes/collectifs/collective-1')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Le collectif n'a pas pu être chargé : No such collective"))
  })

  it('shows the collective when its artists could not be loaded, without its genres', async () => {
    mockFetch({ ...ONDES_PAGE, '/api/admin/artists?collective=collective-1': { ok: false, error: 'Boom' } })
    renderAt('/admin/artistes/collectifs/collective-1')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom"))
    expect(screen.getByRole('heading', { level: 1, name: 'Ondes' })).toBeInTheDocument()
    expect(described('Genres de ses artistes')).toHaveTextContent(/^$/)
    expect(within(described('Artistes du collectif') as HTMLElement).getAllByRole('link')).toHaveLength(2)
  })

  it('only adds new artists when every artist could not be loaded for its form', async () => {
    const changed: Collective = { ...ONDES, members: [...ONDES.members, { id: 'artist-5', name: 'Élise' }] }
    mockFetch({
      ...ONDES_PAGE,
      '/api/admin/artists': { ok: false, error: 'Boom' },
      'PUT /api/admin/collectives/collective-1': { ok: true, collective: changed },
    })
    renderAt('/admin/artistes/collectifs/collective-1')

    await edit()
    expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom")
    expect(picker()).toBeDisabled()
    expect(picker()).toHaveAttribute('placeholder', "les artistes n'ont pas pu être chargés")
    addNew('Élise')
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(screen.getByRole('link', { name: 'Élise' })).toBeInTheDocument())
    expect(sent(requestsTo('PUT', '/api/admin/collectives/collective-1')[0]).profile.members).toEqual([
      { id: 'artist-1' },
      { id: 'artist-3' },
      { name: 'Élise' },
    ])
  })

  it('still shows the collective just saved when the artists can no longer be loaded', async () => {
    const changed: Collective = { ...ONDES, members: [...ONDES.members, { id: 'artist-5', name: 'Élise' }] }
    mockFetch(ONDES_PAGE)
    renderAt('/admin/artistes/collectifs/collective-1')

    await edit()
    mockFetch({
      ...ONDES_PAGE,
      '/api/admin/artists?collective=collective-1': { ok: false, error: 'Boom' },
      'PUT /api/admin/collectives/collective-1': { ok: true, collective: changed },
    })
    addNew('Élise')
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom"))
    expect(screen.getByRole('link', { name: 'Élise' })).toBeInTheDocument()
    expect(described('Genres de ses artistes')).toHaveTextContent(/^$/)
  })

  it('loads its artists again whenever it is saved, and every artist whenever its form opens', async () => {
    const changed: Collective = { ...ONDES, name: 'Ondes 2', members: [...ONDES.members, { id: 'artist-4', name: 'Dora' }] }
    mockFetch({ ...ONDES_PAGE, 'PUT /api/admin/collectives/collective-1': { ok: true, collective: changed } })
    renderAt('/admin/artistes/collectifs/collective-1')

    await screen.findByRole('button', { name: 'modifier' })
    expect(requestsTo('GET', '/api/admin/artists')).toHaveLength(0)
    await edit()
    pick('Dora')
    mockFetch({
      ...ONDES_PAGE,
      '/api/admin/artists?collective=collective-1': { ok: true, artists: [AURORE, CYAN, { ...DORA, genres: ['jazz'] }] },
      'PUT /api/admin/collectives/collective-1': { ok: true, collective: changed },
    })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    // An artist picked brings their genres.
    await waitFor(() => expect(described('Genres de ses artistes')).toHaveTextContent('techno, électro, jazz, ambient, house'))
    expect(requestsTo('GET', '/api/admin/artists?collective=collective-1')).toHaveLength(1)
    expect(requestsTo('GET', '/api/admin/artists')).toHaveLength(0)
    await edit()
    expect(requestsTo('GET', '/api/admin/artists')).toHaveLength(1)
  })

  it('leads from the address of every collective to the list, where they are', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists: [] }, '/api/admin/collectives': { ok: true, collectives: [] } })
    renderAt('/admin/artistes/collectifs')

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/artistes$/))
    expect(await screen.findByRole('heading', { level: 1, name: 'Artistes' })).toBeInTheDocument()
  })

  it('changes the collective, its artists picked or added by name, in order', async () => {
    const changed: Collective = { ...ONDES, name: 'Ondes 2', updatedBy: 'other@example.com', updatedAt: '2026-10-06T16:00:00.000Z' }
    mockFetch({ ...ONDES_PAGE, 'PUT /api/admin/collectives/collective-1': { ok: true, collective: changed } })
    renderAt('/admin/artistes/collectifs/collective-1')

    await edit()
    expect(screen.getByLabelText('Nom du collectif')).toHaveValue('Ondes')
    expect(screen.getByLabelText('Adresse e-mail du contact')).toHaveValue('ondes@example.com')
    expect(screen.getByRole('img', { name: 'Photo actuelle' }).getAttribute('src')).toMatch(/^\/api\/admin\/collectives\/collective-1\/photo\?v=/)
    expect(chosen()).toEqual(['1Aurore↑↓×', '2Cyan↑↓×'])
    expect(screen.getByRole('button', { name: 'monter Aurore' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'descendre Cyan' })).toBeDisabled()

    pick('Dora')
    addNew('Élise')
    addNew('Fé', { enter: true })
    fireEvent.click(screen.getByRole('button', { name: 'monter Fé' }))
    fireEvent.click(screen.getByRole('button', { name: 'descendre Aurore' }))
    fireEvent.click(screen.getByRole('button', { name: 'retirer Élise' }))
    expect(chosen()).toEqual(['1Cyan↑↓×', '2Aurore↑↓×', '3Dora↑↓×', '4Fé (nouveau)↑↓×'])
    expect(picker()).toHaveValue('')
    expect(newArtist()).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Nom du collectif'), { target: { value: 'Ondes 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Ondes 2' })).toBeInTheDocument())
    const { profile, photo, removePhoto } = sent(requestsTo('PUT', '/api/admin/collectives/collective-1')[0])
    expect(profile).toEqual({
      name: 'Ondes 2',
      members: [{ id: 'artist-3' }, { id: 'artist-1' }, { id: 'artist-4' }, { name: 'Fé' }],
      country: 'CA',
      city: 'Québec',
      description: 'Première ligne.\nDeuxième ligne.',
      links: { instagram: 'ondes.qc' },
      email: 'ondes@example.com',
      phone: '418 555 0101',
    })
    expect(photo).toBeNull()
    expect(removePhoto).toBeNull()
    expect(screen.getByText(/^Modifié par/)).toHaveTextContent(/^Modifié par other@example.com le 6 octobre 2026/)
  })

  it('picks among the artists who can be members, telling apart those without an email', async () => {
    mockFetch(ONDES_PAGE)
    renderAt('/admin/artistes/collectifs/collective-1')

    await edit()
    fireEvent.click(picker())
    // Neither its artists, nor Brume, who's a collective.
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['DoraBrise'])
    fireEvent.click(screen.getByRole('button', { name: 'retirer Cyan' }))
    fireEvent.change(picker(), { target: { value: 'cy' } })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['CyanBruxelles, Belgique'])
    fireEvent.keyDown(picker(), { key: 'Enter' })
    expect(chosen()).toEqual(['1Aurore↑↓×', '2Cyan↑↓×'])
  })

  it('says when a new artist has the name of a known one', async () => {
    mockFetch(ONDES_PAGE)
    renderAt('/admin/artistes/collectifs/collective-1')

    await edit()
    fireEvent.change(newArtist(), { target: { value: 'dora' } })
    expect(screen.getByText(/^Un artiste s'appelle déjà/)).toHaveTextContent(
      "Un artiste s'appelle déjà « Dora » : le choisir parmi les artistes connus évite de créer un doublon.",
    )
    // Not for a collective.
    fireEvent.change(newArtist(), { target: { value: 'Brume' } })
    expect(screen.queryByText(/^Un artiste s'appelle déjà/)).not.toBeInTheDocument()
    addNew('Brume')
    addNew('  ')
    expect(chosen()).toEqual(['1Aurore↑↓×', '2Cyan↑↓×', '3Brume (nouveau)↑↓×'])
  })

  it('does not add the name of one of its artists, and says so, keeping it typed', async () => {
    mockFetch(ONDES_PAGE)
    renderAt('/admin/artistes/collectifs/collective-1')

    await edit()
    // An artist it has, rather than one to pick.
    addNew('aurore')
    expect(screen.getByText(/est déjà parmi/)).toHaveTextContent('« Aurore » est déjà parmi les artistes du collectif.')
    expect(screen.queryByText(/^Un artiste s'appelle déjà/)).not.toBeInTheDocument()
    expect(newArtist()).toHaveValue('aurore')

    // A new artist it has, whatever the case and accents.
    addNew('Élise')
    addNew('ELISE', { enter: true })
    expect(screen.getByText(/est déjà parmi/)).toHaveTextContent('« Élise » est déjà parmi les artistes du collectif.')
    expect(newArtist()).toHaveValue('ELISE')
    expect(chosen()).toEqual(['1Aurore↑↓×', '2Cyan↑↓×', '3Élise (nouveau)↑↓×'])

    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(errorOf(membersField())).toBe('« ELISE » est déjà parmi les artistes du collectif : effacez ce nom.')
    expect(screen.getAllByText(/est déjà parmi/)).toHaveLength(1)
    expect(requestsTo('PUT', '/api/admin/collectives/collective-1')).toHaveLength(0)
  })

  it('keeps the focus on the member moved or after the one removed, so that the keyboard can go on', async () => {
    mockFetch(ONDES_PAGE)
    renderAt('/admin/artistes/collectifs/collective-1')

    await edit()
    pick('Dora')
    const button = (name: string) => screen.getByRole('button', { name })
    fireEvent.click(button('descendre Aurore'))
    expect(button('descendre Aurore')).toHaveFocus()
    // Once it's last, the other arrow, rather than the one that's now disabled.
    fireEvent.click(button('descendre Aurore'))
    expect(chosen()).toEqual(['1Cyan↑↓×', '2Dora↑↓×', '3Aurore↑↓×'])
    expect(button('monter Aurore')).toHaveFocus()
    fireEvent.click(button('monter Dora'))
    expect(button('descendre Dora')).toHaveFocus()

    // The next member's ×, or else the field that picks an artist.
    fireEvent.click(button('retirer Dora'))
    expect(button('retirer Cyan')).toHaveFocus()
    fireEvent.click(button('retirer Aurore'))
    expect(picker()).toHaveFocus()
  })

  it('needs at least one artist, and none left typed without being added', async () => {
    mockFetch(ONDES_PAGE)
    renderAt('/admin/artistes/collectifs/collective-1')

    await edit()
    fireEvent.click(screen.getByRole('button', { name: 'retirer Aurore' }))
    fireEvent.click(screen.getByRole('button', { name: 'retirer Cyan' }))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(errorOf(membersField())).toBe('Indiquez au moins un artiste du collectif.')
    await waitFor(() => expect(picker()).toHaveFocus())

    // A name left typed would be lost.
    fireEvent.change(newArtist(), { target: { value: 'Élise' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(errorOf(membersField())).toBe("« Élise » n'est pas ajouté : appuyer sur + pour l'ajouter.")
    await waitFor(() => expect(newArtist()).toHaveFocus())
    expect(requestsTo('PUT', '/api/admin/collectives/collective-1')).toHaveLength(0)
  })

  it("needs the contact's email, and shows why the server refused the collective", async () => {
    mockFetch({
      ...ONDES_PAGE,
      'PUT /api/admin/collectives/collective-1': { ok: false, error: 'Another collective has this email address' },
    })
    renderAt('/admin/artistes/collectifs/collective-1')

    await edit()
    const email = screen.getByLabelText('Adresse e-mail du contact')
    fireEvent.change(email, { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    expect(errorOf(email)).toBe('Indiquez votre adresse e-mail.')
    expect(requestsTo('PUT', '/api/admin/collectives/collective-1')).toHaveLength(0)

    fireEvent.change(email, { target: { value: 'brise@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("Le collectif n'a pas pu être enregistré : Another collective has this email address"),
    )
    fireEvent.click(screen.getByRole('button', { name: 'annuler' }))
    expect(screen.getByRole('button', { name: 'modifier' })).toBeInTheDocument()
  })

  it('removes the photo with its ×, once the collective is saved', async () => {
    mockFetch({ ...ONDES_PAGE, 'PUT /api/admin/collectives/collective-1': { ok: true, collective: { ...ONDES, hasPhoto: false } } })
    renderAt('/admin/artistes/collectifs/collective-1')

    await edit()
    fireEvent.click(screen.getByRole('button', { name: 'retirer la photo' }))
    fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

    await waitFor(() => expect(screen.getByText('Pas de photo')).toBeInTheDocument())
    expect(sent(requestsTo('PUT', '/api/admin/collectives/collective-1')[0]).removePhoto).toBe('true')
  })

  it('deletes the collective and its applications once confirmed, but not its artists, and goes back to the list', async () => {
    mockFetch({
      ...ONDES_PAGE,
      '/api/admin/applications?collective=collective-1': { ok: true, applications: [APPLICATION, { ...APPLICATION, id: 'application-2' }] },
      'DELETE /api/admin/collectives/collective-1': { ok: true },
      '/api/admin/collectives': { ok: true, collectives: [] },
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderAt('/admin/artistes/collectifs/collective-1')

    expect(await screen.findByText(/^Le collectif, sa photo et ses candidatures seront supprimés/)).toHaveTextContent(
      'Le collectif, sa photo et ses candidatures seront supprimés pour de bon. Ses artistes restent, avec leurs propres candidatures.',
    )
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'supprimer le collectif' }))
    expect(confirm).toHaveBeenLastCalledWith('Supprimer définitivement Ondes, sa photo et ses candidatures (2) ? Ses artistes restent.')
    expect(requestsTo('DELETE', '/api/admin/collectives/collective-1')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'supprimer le collectif' }))
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/admin\/artistes$/))
    expect(requestsTo('DELETE', '/api/admin/collectives/collective-1')).toHaveLength(1)
  })

  it('says what deleting a collective without a photo or applications does', async () => {
    mockFetch({ ...ONDES_PAGE, '/api/admin/collectives/collective-1': { ok: true, collective: { ...ONDES, hasPhoto: false } } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    renderAt('/admin/artistes/collectifs/collective-1')

    expect(await screen.findByText(/^Le collectif et ses candidatures/)).toHaveTextContent(
      'Le collectif et ses candidatures seront supprimés pour de bon. Ses artistes restent, avec leurs propres candidatures.',
    )
    await screen.findByText('Aucune candidature.')
    fireEvent.click(screen.getByRole('button', { name: 'supprimer le collectif' }))
    expect(confirm).toHaveBeenLastCalledWith('Supprimer définitivement Ondes ? Ses artistes restent.')
  })
})

describe('Adding a collective', () => {
  it('sends the profile, its artists and the photo, then shows the new collective', async () => {
    const added: Collective = { ...ONDES, id: 'collective-3', name: 'Brise' }
    mockFetch({
      ...LOGGED_IN,
      '/api/admin/artists': { ok: true, artists: ARTISTS },
      'POST /api/admin/collectives': { ok: true, collective: added },
      '/api/admin/collectives/collective-3': { ok: true, collective: added },
    })
    renderAt('/admin/artistes/collectifs/nouveau')

    // Once the artists are loaded.
    await screen.findByLabelText('Nom du collectif')
    expect(screen.getByRole('heading', { level: 1, name: 'Nouveau collectif' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'artistes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('group', { name: 'Tous les genres' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Pays' })).toHaveValue('Canada')
    fireEvent.change(screen.getByLabelText('Nom du collectif'), { target: { value: 'Brise' } })
    pick('Aurore')
    addNew('Élise')
    fireEvent.change(screen.getByLabelText('Ville'), { target: { value: 'Gaspé' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Une description.' } })
    fireEvent.change(screen.getByLabelText('Instagram'), { target: { value: 'https://instagram.com/brise' } })
    fireEvent.change(screen.getByLabelText('Adresse e-mail du contact'), { target: { value: 'brise@example.com' } })
    fireEvent.change(screen.getByLabelText('Téléphone du contact'), { target: { value: '418 555 0102' } })
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [new File(['photo'], 'brise.jpg', { type: 'image/jpeg' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter le collectif' }))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/admin/artistes/collectifs/collective-3'))
    const { profile, photo } = sent(requestsTo('POST', '/api/admin/collectives')[0])
    expect(profile).toEqual({
      name: 'Brise',
      members: [{ id: 'artist-1' }, { name: 'Élise' }],
      country: 'CA',
      city: 'Gaspé',
      description: 'Une description.',
      links: { instagram: 'brise' },
      email: 'brise@example.com',
      phone: '418 555 0102',
    })
    expect((photo as File).name).toBe('brise.jpg')
  })

  it('says what is wrong with every field when the form is sent, and sends nothing', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists: ARTISTS } })
    renderAt('/admin/artistes/collectifs/nouveau')

    fireEvent.click(await screen.findByRole('button', { name: 'ajouter le collectif' }))
    expect(errorOf(screen.getByLabelText('Nom du collectif'))).toBe('Indiquez le nom du collectif.')
    expect(errorOf(membersField())).toBe('Indiquez au moins un artiste du collectif.')
    expect(errorOf(screen.getByLabelText('Adresse e-mail du contact'))).toBe('Indiquez votre adresse e-mail.')
    // Admins can leave these out, and the photo is optional.
    for (const label of ['Ville', 'Description', 'SoundCloud', 'Téléphone du contact', 'Photo']) {
      expect(errorOf(screen.getByLabelText(label))).toBeNull()
    }
    await waitFor(() => expect(screen.getByLabelText('Nom du collectif')).toHaveFocus())
    expect(requestsTo('POST', '/api/admin/collectives')).toHaveLength(0)
  })

  it('says when the artists could not be loaded, and only adds new ones', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: false, error: 'Boom' } })
    renderAt('/admin/artistes/collectifs/nouveau')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom"))
    expect(picker()).toBeDisabled()
    expect(newArtist()).toBeEnabled()
  })
})
