import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router'
import type { Application } from 'shared/applications'
import type { Artist, ArtistProfile } from 'shared/artists'
import App from '../../app'
import { mockFetch, requestsTo } from '../../test-utils'

const LOGGED_IN = { '/api/admin/me': { ok: true, email: 'admin@example.com' } }

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
  kind: 'artist',
  name: 'Aurore',
  members: [],
  country: 'CA',
  city: 'Montréal',
  genres: ['techno', 'ambient'],
  bio: 'Première ligne.\nDeuxième ligne.',
  links: { soundcloud: 'aurore', web: 'https://aurore.example' },
  email: 'aurore@example.com',
  phone: '514 555 0101',
  updatedBy: null,
  updatedAt: null,
}

const BRUME: Artist = {
  ...AURORE,
  id: 'artist-2',
  createdBy: null,
  kind: 'collective',
  name: 'Brume',
  members: ['Ana', 'Bo'],
  country: 'FR',
  city: 'Lyon',
  genres: ['house'],
  email: 'brume@example.com',
}

// What admins can leave out of a profile, as it's saved when they do.
const LEFT_OUT: Partial<ArtistProfile> = { country: '', city: '', genres: [], links: {}, phone: '' }

function application(id: string, artistId: string, changes: Partial<Application> = {}): Application {
  return {
    id,
    artistId,
    receivedAt: '2026-10-05T16:00:00.000Z',
    createdAt: '2026-10-05T16:00:00.000Z',
    createdBy: 'admin@example.com',
    dates: ['2026-12-10'],
    timeSlots: [],
    prestations: ['dj'],
    otherPrestation: '',
    details: '',
    updatedBy: null,
    updatedAt: null,
    status: 'new',
    statusUpdatedBy: null,
    statusUpdatedAt: null,
    ...changes,
  }
}

const APPLICATIONS = [application('application-1', 'artist-1'), application('application-2', 'artist-1'), application('application-3', 'artist-2')]

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

// What was sent as the artist's profile and photo in a request to save one, and whether to remove their photo.
function sent(request: RequestInit) {
  const form = request.body as FormData
  return { profile: JSON.parse(form.get('artist') as string) as ArtistProfile, photo: form.get('photo'), removePhoto: form.get('removePhoto') }
}

const rows = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))

describe('The list of artists', () => {
  it('lists the artists, with how many applications each one has', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists: [AURORE, BRUME] }, '/api/admin/applications': { ok: true, applications: APPLICATIONS } })
    renderAt('/admin/artistes')

    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Candidatures' })).toBeInTheDocument())
    expect(rows()).toEqual([
      ['Aurore', 'artiste', 'Montréal, Canada', 'techno, ambient', '2'],
      ['Brume', 'collectif', 'Lyon, France', 'house', '1'],
    ])
    expect(screen.getByRole('link', { name: 'Aurore' })).toHaveAttribute('href', '/admin/artistes/artist-1')
    expect(screen.getByRole('link', { name: 'ajouter un artiste' })).toHaveAttribute('href', '/admin/artistes/nouveau')
  })

  it('shows what the artists left out, e.g. those who applied through the original Google Form', async () => {
    const artists = [
      { ...AURORE, country: '', genres: [] },
      { ...BRUME, city: '' },
      { ...AURORE, id: 'artist-3', name: 'Cyan', country: '', city: '' },
    ]
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists }, '/api/admin/applications': { ok: true, applications: [] } })
    renderAt('/admin/artistes')

    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Candidatures' })).toBeInTheDocument())
    expect(rows()).toEqual([
      ['Aurore', 'artiste', 'Montréal', '-', '0'],
      ['Brume', 'collectif', 'France', 'house', '0'],
      ['Cyan', 'artiste', '-', 'techno, ambient', '0'],
    ])
  })

  it('says when there are no artists', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists: [] }, '/api/admin/applications': { ok: true, applications: [] } })
    renderAt('/admin/artistes')

    await waitFor(() => expect(screen.getByText('Aucun artiste.')).toBeInTheDocument())
  })

  it('lists the artists without how many applications they have when those could not be loaded, and says so', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: true, artists: [AURORE] }, '/api/admin/applications': { ok: false, error: 'Boom' } })
    renderAt('/admin/artistes')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les candidatures n'ont pas pu être chargées : Boom"))
    expect(rows()).toEqual([['Aurore', 'artiste', 'Montréal, Canada', 'techno, ambient']])
    expect(screen.queryByRole('columnheader', { name: 'Candidatures' })).not.toBeInTheDocument()
  })

  it('says when the artists could not be loaded', async () => {
    mockFetch({ ...LOGGED_IN, '/api/admin/artists': { ok: false, error: 'Boom' }, '/api/admin/applications': { ok: true, applications: [] } })
    renderAt('/admin/artistes')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Les artistes n'ont pas pu être chargés : Boom"))
  })
})

describe('An artist’s page', () => {
  const AURORE_PAGE = {
    ...LOGGED_IN,
    '/api/admin/artists/artist-1': { ok: true, artist: AURORE },
    '/api/admin/applications?artist=artist-1': { ok: true, applications: APPLICATIONS.slice(0, 2) },
  }

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

    await waitFor(() => expect(screen.getAllByRole('link', { name: '5 octobre 2026' })).toHaveLength(2))
    expect(screen.getAllByRole('link', { name: '5 octobre 2026' })[0]).toHaveAttribute('href', '/admin/candidatures/application-1')
    expect(screen.getByRole('link', { name: 'nouvelle candidature' })).toHaveAttribute('href', '/admin/candidatures/nouvelle?artiste=artist-1')
  })

  it('shows what the artist left out, e.g. one who applied through the original Google Form', async () => {
    mockFetch({
      ...LOGGED_IN,
      '/api/admin/artists/artist-1': { ok: true, artist: { ...AURORE, ...LEFT_OUT } },
      '/api/admin/applications?artist=artist-1': { ok: true, applications: [] },
    })
    renderAt('/admin/artistes/artist-1')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Aurore' })).toBeInTheDocument())
    for (const term of ['Ville', 'Genres', 'Liens', 'Téléphone']) {
      expect(screen.getByText(term, { selector: 'dt' }).nextElementSibling).toHaveTextContent(/^-$/)
    }
  })

  it('shows the artists of a collective, and that it applied by itself', async () => {
    mockFetch({
      ...LOGGED_IN,
      '/api/admin/artists/artist-2': { ok: true, artist: BRUME },
      '/api/admin/applications?artist=artist-2': { ok: true, applications: [] },
    })
    renderAt('/admin/artistes/artist-2')

    await waitFor(() => expect(screen.getByText('Ana, Bo')).toBeInTheDocument())
    expect(screen.getByText(/^collectif, inscrit/)).toHaveTextContent('collectif, inscrit par le formulaire « appliquer » le 1 octobre 2026.')
    expect(screen.getByText('Aucune candidature.')).toBeInTheDocument()
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
      kind: 'artist',
      name: 'Aurore',
      members: [],
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

  it('checks another photo, if one is chosen', async () => {
    mockFetch(AURORE_PAGE)
    renderAt('/admin/artistes/artist-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    const photo = screen.getByLabelText('Photo')
    fireEvent.change(photo, { target: { files: [new File(['gif'], 'aurore.gif', { type: 'image/gif' })] } })
    expect(photo.closest('.admin-field')?.querySelector('.admin-field-error')).toHaveTextContent('La photo doit être en JPEG, PNG ou WebP.')
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
      '/api/admin/applications': { ok: true, applications: [] },
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
    })
    renderAt('/admin/artistes/nouveau')

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Nouvel artiste' })).toBeInTheDocument())
    expect(screen.getByLabelText('Photo')).not.toBeRequired()
    expect(screen.queryByRole('button', { name: 'retirer la photo' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('collectif'))
    fireEvent.change(screen.getByLabelText('Nom du collectif'), { target: { value: 'Brume' } })
    const member = screen.getByLabelText("Nom d'un artiste du collectif")
    fireEvent.change(member, { target: { value: 'Ana' } })
    fireEvent.click(screen.getByRole('button', { name: 'ajouter cet artiste au collectif' }))
    fireEvent.change(member, { target: { value: 'Bo' } })
    fireEvent.keyDown(member, { key: 'Enter' })
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
    const { profile, photo } = sent(requestsTo('POST', '/api/admin/artists')[0])
    // What's saved of it, e.g. the profile name rather than the address of the Instagram profile.
    expect(profile).toEqual({
      kind: 'collective',
      name: 'Brume',
      members: ['Ana', 'Bo'],
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
    })
    renderAt('/admin/artistes/nouveau')

    await screen.findByLabelText('collectif')
    fillValidArtist()
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [] } })
    fireEvent.click(submitButton("ajouter l'artiste"))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/admin/artistes/artist-3'))
    expect(sent(requestsTo('POST', '/api/admin/artists')[0]).photo).toBeNull()
  })

  it('says what is wrong with every field when the form is sent, and sends nothing', async () => {
    mockFetch(NEW)
    renderAt('/admin/artistes/nouveau')

    fireEvent.click(await screen.findByLabelText('collectif'))
    expect(document.querySelectorAll('.admin-field-error')).toHaveLength(0)
    fireEvent.click(submitButton("ajouter l'artiste"))

    expect(errorOf(screen.getByLabelText('Nom du collectif'))).toBe('Indiquez le nom du collectif.')
    expect(errorOf(screen.getByLabelText("Nom d'un artiste du collectif"))).toBe('Indiquez au moins un artiste du collectif.')
    expect(errorOf(screen.getByLabelText('Bio'))).toBe('Écrivez quelques lignes de bio.')
    expect(errorOf(screen.getByLabelText('Adresse e-mail'))).toBe('Indiquez votre adresse e-mail.')
    // Admins can leave these out, unlike artists, and the photo is optional.
    expect(errorOf(screen.getByLabelText('Ville'))).toBeNull()
    expect(errorOf(screen.getByRole('group', { name: 'Tous les genres' }))).toBeNull()
    expect(errorOf(screen.getByLabelText('SoundCloud'))).toBeNull()
    expect(errorOf(screen.getByLabelText('Téléphone'))).toBeNull()
    expect(errorOf(screen.getByLabelText('Photo'))).toBeNull()
    // The first field to fix gets the focus.
    await waitFor(() => expect(screen.getByLabelText('Nom du collectif')).toHaveFocus())
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
    expect(errorOf(soundcloud)).toBe("copiez l'adresse de votre page de profil, qui commence par soundcloud.com/")
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

    await screen.findByLabelText('collectif')
    fillValidArtist()
    fireEvent.change(screen.getByLabelText('Instagram'), { target: { value: 'https://soundcloud.com/aurore' } })
    fireEvent.click(submitButton("ajouter l'artiste"))

    expect(errorOf(screen.getByLabelText('Instagram'))).toBe("ce n'est pas une adresse Instagram")
    await waitFor(() => expect(screen.getByLabelText('Instagram')).toHaveFocus())
    expect(requestsTo('POST', '/api/admin/artists')).toHaveLength(0)
  })

  it('says what is wrong with a link that none of the inputs show, e.g. to a site that was taken out of the list', async () => {
    mockFetch({
      ...LOGGED_IN,
      '/api/admin/artists/artist-1': { ok: true, artist: { ...AURORE, links: { ...AURORE.links, myspace: 'aurore' } } },
      '/api/admin/applications?artist=artist-1': { ok: true, applications: [] },
    })
    renderAt('/admin/artistes/artist-1')

    fireEvent.click(await screen.findByRole('button', { name: 'modifier' }))
    fireEvent.click(submitButton('enregistrer'))

    expect(screen.getByText('Un des liens est invalide.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('SoundCloud')).toHaveFocus())
    expect(requestsTo('PUT', '/api/admin/artists/artist-1')).toHaveLength(0)
  })

  it('adds an artist without a country, city, genres, links or phone, e.g. one who applied through the original Google Form', async () => {
    const added: Artist = { ...AURORE, id: 'artist-3', ...LEFT_OUT }
    mockFetch({
      ...NEW,
      'POST /api/admin/artists': { ok: true, artist: added },
      '/api/admin/artists/artist-3': { ok: true, artist: added },
      '/api/admin/applications?artist=artist-3': { ok: true, applications: [] },
    })
    renderAt('/admin/artistes/nouveau')

    await screen.findByLabelText('collectif')
    fireEvent.change(screen.getByLabelText("Nom d'artiste"), { target: { value: 'Aurore' } })
    const country = screen.getByRole('combobox', { name: 'Pays' })
    fireEvent.change(country, { target: { value: 'inconnu' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Pays inconnu' }))
    expect(country).toHaveValue('Pays inconnu')
    fireEvent.change(screen.getByLabelText('Bio'), { target: { value: 'Une bio.' } })
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'aurore@example.com' } })
    fireEvent.click(submitButton("ajouter l'artiste"))

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/admin/artistes/artist-3'))
    expect(sent(requestsTo('POST', '/api/admin/artists')[0]).profile).toEqual({
      kind: 'artist',
      name: 'Aurore',
      members: [],
      country: '',
      city: '',
      genres: [],
      bio: 'Une bio.',
      links: {},
      email: 'aurore@example.com',
      phone: '',
    })
  })

  it('leaves the type of a photo the browser does not know to the server', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/artists': { ok: false, error: 'Stop' } })
    renderAt('/admin/artistes/nouveau')

    await screen.findByLabelText('collectif')
    fillValidArtist()
    fireEvent.change(screen.getByLabelText('Photo'), { target: { files: [new File(['photo'], 'aurore', { type: '' })] } })
    fireEvent.click(submitButton("ajouter l'artiste"))

    await waitFor(() => expect(requestsTo('POST', '/api/admin/artists')).toHaveLength(1))
  })

  it('pins the artists of a collective, and sends those pinned', async () => {
    mockFetch({ ...NEW, 'POST /api/admin/artists': { ok: false, error: 'Stop' } })
    renderAt('/admin/artistes/nouveau')

    await screen.findByLabelText('collectif')
    fillValidArtist()
    fireEvent.click(screen.getByLabelText('collectif'))
    const member = screen.getByLabelText("Nom d'un artiste du collectif")
    const add = screen.getByRole('button', { name: 'ajouter cet artiste au collectif' })
    for (const name of ['Ana', '  ', 'ana', 'Bo', 'Cy']) {
      fireEvent.change(member, { target: { value: name } })
      fireEvent.click(add)
    }
    fireEvent.click(screen.getByRole('button', { name: 'retirer Bo' }))
    expect(within(member.closest('fieldset')!).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Ana×', 'Cy×'])

    // A name left in the input would be lost, so it stops the form from being sent until it's pinned or cleared.
    fireEvent.change(member, { target: { value: 'Dee' } })
    fireEvent.blur(member)
    expect(screen.getByText("« Dee » n'est pas ajouté : appuyer sur + pour l'ajouter.")).toBeInTheDocument()
    fireEvent.click(submitButton("ajouter l'artiste"))
    expect(member).toHaveFocus()
    expect(requestsTo('POST', '/api/admin/artists')).toHaveLength(0)
    fireEvent.keyDown(member, { key: 'Enter' })
    expect(screen.queryByText(/n'est pas ajouté/)).not.toBeInTheDocument()

    fireEvent.click(submitButton("ajouter l'artiste"))
    await waitFor(() => expect(requestsTo('POST', '/api/admin/artists')).toHaveLength(1))
    expect(sent(requestsTo('POST', '/api/admin/artists')[0]).profile.members).toEqual(['Ana', 'Cy', 'Dee'])
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
