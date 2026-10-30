import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { Data, Schema } from '../../api/client'
import { jsonBody, mockFetch, requestsTo } from '../../test-utils'
import { Rotation } from './rotation'

type RadioTrack = Schema<'RadioTrack'>
type RadioPlaylist = Schema<'RadioPlaylist'>

const MINUTE = 60 * 1000

function track(id: string, artist: string, minutes: number): RadioTrack {
  return { id, artist, event: null, date: '2026-09-13', durationMs: minutes * MINUTE }
}

const onRadio = (track: RadioTrack): Schema<'RadioPlaylistTrack'> => ({ kind: 'rotation', track })

// The playlist's order, with B on air (see ON_AIR).
const ROTATION: RadioPlaylist = {
  url: 'https://soundcloud.com/parkingdotradio/sets/rotation',
  title: 'Rotation',
  private: false,
  account: { name: 'parking.radio', url: 'https://soundcloud.com/parkingdotradio' },
  tracks: [
    onRadio(track('a', 'A', 60)),
    { kind: 'left-out', track: { ...track('t', 'TEASER', 2), date: '2026-09-01' }, reason: 'preview' },
    onRadio(track('b', 'B', 65)),
    onRadio(track('c', 'C', 30)),
  ],
}

const CHOSEN: Schema<'ChosenPlaylist'> = {
  url: ROTATION.url,
  title: 'Rotation',
  chosenBy: 'someone@example.com',
  chosenAt: '2026-09-30T12:00:00.000Z',
  playlist: ROTATION,
  error: null,
}

const CURRENT: Data<'get', '/api/admin/radio'> = { ok: true, credentialsEntered: true, current: CHOSEN }

// Midday, local time, so that the tracks of the rotation all begin the same day.
const STARTED_AT = new Date(2026, 9, 1, 12, 0).getTime()

function onAir(id: string, startedAt = STARTED_AT): Schema<'Radio'> {
  const playlistTrack = ROTATION.tracks.find((t) => t.kind === 'rotation' && t.track.id === id) as { track: RadioTrack }
  return { current: { track: playlistTrack.track, startedAt: new Date(startedAt).toISOString() }, upcoming: [] }
}

const LINK = 'https://soundcloud.com/parkingdotradio/sets/other/s-AbC123'
const OTHER: RadioPlaylist = {
  ...ROTATION,
  url: LINK,
  title: 'Other',
  private: true,
  tracks: [onRadio(track('h', 'H', 60)), onRadio(track('i', 'I', 60))],
}

const time = (at: number) => new Intl.DateTimeFormat('fr-CA', { hour: '2-digit', minute: '2-digit' }).format(at)
const day = (at: number) => new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' }).format(at)

// The text of each row of the list of tracks in `container`.
const rows = (container: HTMLElement = document.body) =>
  within(container)
    .getAllByRole('listitem')
    .map((row) => row.textContent)

function preview(link: string) {
  fireEvent.change(screen.getByLabelText('Lien de la playlist'), { target: { value: link } })
  fireEvent.click(screen.getByRole('button', { name: 'prévisualiser' }))
}

const previewBox = () => document.querySelector<HTMLElement>('.radio-preview')!

describe('Rotation', () => {
  it('shows the playlist on air, and its tracks from the one on air, around the playlist and back, with when each begins', async () => {
    mockFetch({ '/api/admin/radio': CURRENT, '/api/radio?upcoming=0': onAir('b') })
    render(<Rotation />)

    await waitFor(() => expect(screen.getByText('en cours')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Rotation' })).toHaveAttribute('href', ROTATION.url)
    expect(screen.getByText(/^Playlist publique de/)).toHaveTextContent('Playlist publique de parking.radio')
    expect(screen.getByRole('link', { name: 'parking.radio' })).toHaveAttribute('href', ROTATION.account.url)
    expect(screen.getByText(/^Choisie par/)).toHaveTextContent(/^Choisie par someone@example.com le 30 septembre 2026/)
    expect(rows()).toEqual([
      `${time(STARTED_AT)}B · 2026-09-13en cours`,
      `${time(STARTED_AT + 65 * MINUTE)}C · 2026-09-13`,
      `${time(STARTED_AT + 95 * MINUTE)}A · 2026-09-13`,
      'TEASER · 2026-09-01',
    ])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows tracks left out of the rotation in red, with why when hovered or clicked', async () => {
    mockFetch({ '/api/admin/radio': CURRENT, '/api/radio?upcoming=0': onAir('b') })
    render(<Rotation />)

    const teaser = await screen.findByRole('button', { name: 'TEASER · 2026-09-01' })
    expect(teaser.closest('li')).toHaveClass('radio-track-left-out')
    const reason = 'Track marquée comme preview sur SoundCloud'
    expect(teaser).toHaveAttribute('title', reason)
    expect(screen.queryByText(reason)).not.toBeInTheDocument()

    fireEvent.click(teaser)
    expect(screen.getByText(reason)).toBeInTheDocument()
    fireEvent.click(teaser)
    expect(screen.queryByText(reason)).not.toBeInTheDocument()
  })

  it('shows tracks that SoundCloud describes unexpectedly by what is known of them', async () => {
    const playlist = { ...ROTATION, tracks: [...ROTATION.tracks, { kind: 'unexpected' as const, title: 'soundcloud:tracks:99' }] }
    mockFetch({ '/api/admin/radio': { ...CURRENT, current: { ...CHOSEN, playlist } }, '/api/radio?upcoming=0': onAir('b') })
    render(<Rotation />)

    const unexpected = await screen.findByRole('button', { name: 'soundcloud:tracks:99' })
    expect(unexpected.closest('li')).toHaveClass('radio-track-left-out')
    expect(unexpected).toHaveAttribute('title', 'Erreur lors de la lecture de la description')
  })

  it('introduces the tracks that begin on another day with that day', async () => {
    const lateEvening = new Date(2026, 9, 1, 23, 30).getTime()
    mockFetch({ '/api/admin/radio': CURRENT, '/api/radio?upcoming=0': onAir('b', lateEvening) })
    render(<Rotation />)

    await waitFor(() => expect(screen.getByText('en cours')).toBeInTheDocument())
    expect(rows()).toEqual([
      `${time(lateEvening)}B · 2026-09-13en cours`,
      day(lateEvening + 65 * MINUTE),
      `${time(lateEvening + 65 * MINUTE)}C · 2026-09-13`,
      `${time(lateEvening + 95 * MINUTE)}A · 2026-09-13`,
      'TEASER · 2026-09-01',
    ])
  })

  it('lists 10 tracks at first, and 25 more each time more are asked for', async () => {
    const tracks = Array.from({ length: 40 }, (_, i) => onRadio(track(String(i), `T${i}`, 1)))
    const playlist = { ...ROTATION, tracks }
    mockFetch({
      '/api/admin/radio': { ...CURRENT, current: { ...CHOSEN, playlist } },
      '/api/radio?upcoming=0': { ...onAir('b'), current: { track: track('0', 'T0', 1), startedAt: new Date(STARTED_AT).toISOString() } },
    })
    render(<Rotation />)

    await waitFor(() => expect(rows()).toHaveLength(10))
    fireEvent.click(screen.getByRole('button', { name: 'afficher plus' }))
    expect(rows()).toHaveLength(35)
    fireEvent.click(screen.getByRole('button', { name: 'afficher plus' }))
    expect(rows()).toHaveLength(40)
    expect(screen.queryByRole('button', { name: 'afficher plus' })).not.toBeInTheDocument()
  })

  it('says when no playlist has been chosen yet', async () => {
    mockFetch({
      '/api/admin/radio': { ...CURRENT, current: null },
      '/api/radio?upcoming=0': { ok: false, error: 'No playlist has been chosen for the radio yet' },
    })
    render(<Rotation />)

    expect(await screen.findByText("Aucune playlist n'a encore été choisie : la radio est hors ondes.")).toBeInTheDocument()
  })

  it('says that the radio cannot read any playlist until the credentials of the SoundCloud app are entered', async () => {
    mockFetch({
      '/api/admin/radio': { ...CURRENT, credentialsEntered: false, current: { ...CHOSEN, playlist: null } },
      '/api/radio?upcoming=0': { ok: false, error: 'The radio is unavailable right now' },
    })
    render(
      <MemoryRouter>
        <Rotation />
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "La radio ne peut lire aucune playlist sur SoundCloud tant que les identifiants de son application n'ont pas été entrés dans la configuration.",
      ),
    )
    expect(within(screen.getByRole('alert')).getByRole('link', { name: 'configuration' })).toHaveAttribute('href', '/admin/configuration')
  })

  it('says why the playlist could not be read, and that the radio goes on with what it read before', async () => {
    mockFetch({
      '/api/admin/radio': { ...CURRENT, current: { ...CHOSEN, error: 'SoundCloud shows no such playlist' } },
      '/api/radio?upcoming=0': onAir('b'),
    })
    render(<Rotation />)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "La playlist n'a pas pu être lue sur SoundCloud : SoundCloud shows no such playlist. La radio continue avec ce qui en avait été lu avant.",
      ),
    )
    expect(rows()).toHaveLength(4)
  })

  it('shows the title of the playlist when it could never be read, and that the radio is off air', async () => {
    mockFetch({
      '/api/admin/radio': { ...CURRENT, current: { ...CHOSEN, playlist: null, error: 'SoundCloud responded with 500' } },
      '/api/radio?upcoming=0': { ok: false, error: 'The radio is unavailable right now' },
    })
    render(<Rotation />)

    await waitFor(() => expect(screen.getByText('Hors ondes : The radio is unavailable right now')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Rotation' })).toHaveAttribute('href', ROTATION.url)
    expect(screen.getByRole('alert')).toHaveTextContent("La playlist n'a pas pu être lue sur SoundCloud : SoundCloud responded with 500")
    expect(screen.getByRole('alert')).not.toHaveTextContent('La radio continue')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('lists the tracks from the top, without when they begin, when what is on air is unknown', async () => {
    mockFetch({ '/api/admin/radio': CURRENT, '/api/radio?upcoming=0': { ok: false, error: 'The radio is unavailable right now' } })
    render(<Rotation />)

    await waitFor(() => expect(screen.getByText('Hors ondes : The radio is unavailable right now')).toBeInTheDocument())
    expect(rows()).toEqual(['A · 2026-09-13', 'TEASER · 2026-09-01', 'B · 2026-09-13', 'C · 2026-09-13'])
  })

  it('previews a playlist, then chooses it', async () => {
    mockFetch({
      '/api/admin/radio': CURRENT,
      '/api/radio?upcoming=0': onAir('b'),
      '/api/admin/radio/preview': { ok: true, playlist: OTHER },
      '/api/admin/radio/playlist': { ok: true },
    })
    render(<Rotation />)
    await waitFor(() => expect(screen.getByText('en cours')).toBeInTheDocument())

    preview(LINK)

    await waitFor(() => expect(screen.getByRole('button', { name: 'jouer cette playlist' })).toBeInTheDocument())
    expect(within(previewBox()).getByRole('link', { name: 'Other' })).toHaveAttribute('href', LINK)
    expect(within(previewBox()).getByText(/^Playlist privée de/)).toBeInTheDocument()
    expect(rows(previewBox())).toEqual(['H · 2026-09-13', 'I · 2026-09-13'])
    expect(
      within(previewBox()).getByText('La radio passera tout de suite au début de cette playlist (sans couper les auditeurs en cours).'),
    ).toBeInTheDocument()
    expect(requestsTo('POST', '/api/admin/radio/preview').map(jsonBody)).toEqual([{ link: LINK }])

    fireEvent.click(screen.getByRole('button', { name: 'jouer cette playlist' }))

    await waitFor(() => expect(screen.getByText('La radio joue maintenant « Other ».')).toBeInTheDocument())
    expect(requestsTo('POST', '/api/admin/radio/playlist').map(jsonBody)).toEqual([{ link: LINK }])
    expect(screen.queryByRole('button', { name: 'jouer cette playlist' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Lien de la playlist')).toHaveValue('')
    await waitFor(() => expect(requestsTo('GET', '/api/admin/radio')).toHaveLength(2))
    expect(requestsTo('GET', '/api/radio?upcoming=0')).toHaveLength(2)
  })

  it('does not let a playlist none of whose tracks can be played be chosen', async () => {
    mockFetch({
      '/api/admin/radio': CURRENT,
      '/api/radio?upcoming=0': onAir('b'),
      '/api/admin/radio/preview': { ok: true, playlist: { ...OTHER, tracks: [{ kind: 'left-out', track: track('h', 'H', 60), reason: 'blocked' }] } },
    })
    render(<Rotation />)

    preview(LINK)

    await waitFor(() => expect(screen.getByText(/Aucune piste de cette playlist ne peut être jouée en entier/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'jouer cette playlist' })).not.toBeInTheDocument()
  })

  it('drops the preview when the link changes, so that only what was previewed can be chosen', async () => {
    mockFetch({
      '/api/admin/radio': CURRENT,
      '/api/radio?upcoming=0': onAir('b'),
      '/api/admin/radio/preview': { ok: true, playlist: OTHER },
    })
    render(<Rotation />)
    preview(LINK)
    await waitFor(() => expect(screen.getByRole('button', { name: 'jouer cette playlist' })).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Lien de la playlist'), { target: { value: `${LINK}x` } })

    expect(screen.queryByRole('button', { name: 'jouer cette playlist' })).not.toBeInTheDocument()
  })

  it('says when the link is not to a playlist, without asking the server', async () => {
    mockFetch({ '/api/admin/radio': CURRENT, '/api/radio?upcoming=0': onAir('b') })
    render(<Rotation />)

    preview('https://soundcloud.com/parkingdotradio')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Ce n'est pas un lien vers une playlist SoundCloud."))
    expect(requestsTo('POST', '/api/admin/radio/preview')).toHaveLength(0)
  })

  it('shows why a playlist could not be previewed', async () => {
    mockFetch({
      '/api/admin/radio': CURRENT,
      '/api/radio?upcoming=0': onAir('b'),
      '/api/admin/radio/preview': { ok: false, error: 'SoundCloud shows no playlist at this link' },
    })
    render(<Rotation />)

    preview(LINK)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("La playlist n'a pas pu être lue : SoundCloud shows no playlist at this link"),
    )
  })
})
