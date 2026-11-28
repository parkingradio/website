import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { Schema } from '../../api/client'
import { held, jsonBody, mockFetch, mockListLayout, moveWithKeyboard, named, pickUp, requestsTo, spaced } from '../../test-utils'
import type { Body } from '../../test-utils'
import { Rotation } from './rotation'

type RotationSet = Schema<'RotationSet'>
type RadioRotation = Schema<'RadioRotation'>

const MINUTE = 60 * 1000
const ROTATION_URL = '/api/admin/radio/rotation'
const CANDIDATES_URL = '/api/admin/radio/rotation/candidates'
const CREDENTIALS_URL = '/api/admin/radio/credentials'

// Saturday, September 12, 2026, at 20:00 in Québec, and Sunday, August 2, 2026.
const HAUTE_RIVE = { id: 'session-1', title: 'HAUTE RIVE TAKEOVER', start: '2026-09-13T00:00:00.000Z' }
const GUEST_MIXES = { id: 'session-2', title: 'GUEST MIXES', start: '2026-08-02T23:00:00.000Z' }

// B goes on air at 23:00 in Québec, on Thursday, October 1, and lasts 65 minutes, so that C starts the next day.
const ON_AIR_AT = Date.parse('2026-10-01T23:00:00-04:00')

function rotationSet(id: string, names: string[], minutes: number | null, changes: Partial<RotationSet> = {}): RotationSet {
  return {
    id,
    performers: names.map((name) => ({ id: `artist-${name}`, name })),
    genres: [],
    soundcloudTrack: { id: `track-${id}`, url: `https://soundcloud.com/parkingdotradio/${id}` },
    youtubeVideo: { id: `video-${id}`, url: `https://www.youtube.com/watch?v=video-${id}` },
    session: HAUTE_RIVE,
    durationMs: minutes === null ? null : minutes * MINUTE,
    readError: null,
    skipped: [],
    startsAt: null,
    ...changes,
  }
}

const at = (time: number) => new Date(time).toISOString()

// From the play head, as the server gives them: B, on air, C, A, then K, which is skipped. C has no genres.
const A = rotationSet('a', ['Aurore'], 30, { genres: ['tech-house', 'deep-house'], startsAt: at(ON_AIR_AT + 95 * MINUTE) })
const K = rotationSet('k', ['Kwame'], 62, { genres: ['ambient'], skipped: ['preview'] })
const B = rotationSet('b', ['Brume', 'Cyan'], 65, { genres: ['house', 'techno'], startsAt: at(ON_AIR_AT) })
const C = rotationSet('c', ['Écume'], 30, { startsAt: at(ON_AIR_AT + 65 * MINUTE) })

const ROTATION: RadioRotation = {
  ok: true,
  updatedBy: 'someone@example.com',
  updatedAt: '2026-09-30T12:00:00.000Z',
  current: { setId: 'b', startedAt: at(ON_AIR_AT) },
  sets: [B, C, A, K],
}

// Two sets that can be added: the most recent session first.
const candidate = (id: string, name: string, session: RotationSet['session'], genres: RotationSet['genres']): Schema<'RotationCandidate'> => {
  const { performers, soundcloudTrack, youtubeVideo } = rotationSet(id, [name], 60)
  return { id, performers, genres, soundcloudTrack, youtubeVideo, session }
}
const F = candidate('f', 'Fréquence Boréale', HAUTE_RIVE, ['house'])
const G = candidate('g', 'Gaïa', GUEST_MIXES, ['deep-house', 'ambient'])
const CANDIDATES = { ok: true, total: 2, sets: [F, G] }
// What reading the track of a set that can be added answers: by default, nothing yet.
const candidateUrl = (set: { id: string }) => `${CANDIDATES_URL}/${set.id}`
const NO_ANSWER = new Promise<Body>(() => {})
const withTrack = (set: Schema<'RotationCandidate'>, minutes: number | null, changes: Partial<RotationSet> = {}): Body => ({
  ok: true,
  set: { ...set, durationMs: minutes === null ? null : minutes * MINUTE, readError: null, skipped: [], ...changes },
})

const CREDENTIALS = { ok: true, credentials: { clientId: 'id', updatedBy: 'someone@example.com', updatedAt: '2026-09-01T12:00:00.000Z', error: null } }

function renderPage(bodies: Record<string, Body | Promise<Body>> = {}) {
  mockFetch({
    [ROTATION_URL]: ROTATION,
    [CREDENTIALS_URL]: CREDENTIALS,
    [CANDIDATES_URL]: CANDIDATES,
    [candidateUrl(F)]: NO_ANSWER,
    [candidateUrl(G)]: NO_ANSWER,
    ...bodies,
  })
  render(
    <MemoryRouter>
      <Rotation />
    </MemoryRouter>,
  )
}

const list = () => document.querySelector<HTMLElement>('.rotation-sets')!
// The text of `element`, but for how far into the set under the play head the radio is, which `progress` gives, what
// only screen readers are told, which `onAirSaid` gives, and the genres, which `genresOf` gives.
function textOf(element: Element): string {
  const copy = element.cloneNode(true) as Element
  copy.querySelectorAll('.rotation-progress, .visually-hidden, .rotation-genres').forEach((hidden) => hidden.remove())
  return spaced(copy.textContent)
}
// The genres of each row of `rows`, as screen readers read them, e.g. "house, techno", or null without any, and as they're
// shown, one label each.
const genresOf = (rows: Element[]) =>
  rows.map((row) => {
    const genres = row.querySelector('.rotation-genres')
    return genres && { read: genres.textContent, shown: Array.from(genres.querySelectorAll('.rotation-genre'), (genre) => genre.textContent) }
  })
// The text of each row of the list, the days between them included.
const rows = () => within(list()).getAllByRole('listitem').map(textOf)

// What `genresOf` gives for B, C, A and K, in that order.
const GENRES = [
  { read: 'house, techno', shown: ['house', 'techno'] },
  null,
  { read: 'tech house, deep house', shown: ['tech house', 'deep house'] },
  { read: 'ambient', shown: ['ambient'] },
]

// The rows are laid out 100px apart, in their list, so that where the play head is drawn says which row it's over.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return this.tagName === 'LI' && this.parentElement ? Array.prototype.indexOf.call(this.parentElement.children, this) * 100 : 0
  })
})

// The row the play head is drawn over, as `rows` or `draft` give it, or null when there's none.
function underHead(): string | null {
  const head = document.querySelector<HTMLElement>('.rotation-head')
  if (!head) return null
  const row = head.closest('.rotation-frame')!.querySelectorAll('ol > li')[parseInt(head.style.top) / 100]
  return row.querySelector('b') ? draftOf(row) : textOf(row)
}

// The rows that screen readers are told are on air, by their text, which is only the row under the play head.
const onAirSaid = () =>
  Array.from(document.querySelectorAll('.visually-hidden'))
    .filter((hidden) => hidden.textContent!.trim() === 'en ondes')
    .map((hidden) => {
      const row = hidden.closest('li')!
      return row.querySelector('b') ? draftOf(row) : textOf(row)
    })

// How far into the set under the play head the radio is, as it's shown, and as it's said, or null without it.
function progress(): { shown: string; said: string | null; now: string | null; max: string | null } | null {
  const bar = screen.queryByRole('progressbar', { name: 'Avancement du set' })
  if (!bar) return null
  return {
    shown: spaced(bar.closest('.rotation-progress')!.textContent),
    said: spaced(bar.getAttribute('aria-valuetext')),
    now: bar.getAttribute('aria-valuenow'),
    max: bar.getAttribute('aria-valuemax'),
  }
}
const loaded = () => screen.findByRole('button', { name: 'modifier' })

// What's being changed: each set's number and performers, and its session's title and day.
const draftOf = (item: Element) => `${item.querySelector('b')!.textContent} ${textOf(item.querySelector('.admin-ordered-text')!)}`
const draft = () => Array.from(document.querySelectorAll('.admin-ordered > li')).map(draftOf)
// When each set being changed would go on air, with the day above its row whenever it changes, or '' when it has no time.
const draftTimes = () =>
  Array.from(document.querySelectorAll('.admin-ordered > li')).map((item) =>
    spaced(
      Array.from(item.querySelectorAll('.rotation-day, .rotation-set-time'), (part) => part.textContent).join(' '),
    ),
  )

async function modify(bodies?: Record<string, Body | Promise<Body>>) {
  renderPage(bodies)
  fireEvent.click(await loaded())
  await waitFor(() => expect(picker()).toHaveAttribute('placeholder', 'choisir un set…'))
}

const picker = () => screen.getByRole('combobox', { name: 'Ajouter un set' })
const options = () => screen.queryAllByRole('option').map((option) => spaced(option.textContent))

function search(query: string) {
  fireEvent.click(picker())
  fireEvent.change(picker(), { target: { value: query } })
}

function pick(name: string) {
  picker().focus()
  fireEvent.click(picker())
  fireEvent.mouseDown(screen.getByRole('option', { name: new RegExp(`^${name}`) }))
}

const SATURDAY = 'HAUTE RIVE TAKEOVER, sam. 12 sept. 2026'
const AUGUST = 'GUEST MIXES, dim. 2 août 2026'
// A row's text, or a set's being changed, up to its session.
const performersOf = (text: string | null) => text!.replace(/(HAUTE RIVE TAKEOVER|GUEST MIXES),.*$/, '')

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Rotation', () => {
  describe('the rotation', () => {
    it('lists the sets as the server gives them, from the one on air, with when each one starts, and the day whenever it changes', async () => {
      renderPage()
      await loaded()

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Rotation radio')
      expect(spaced(screen.getByText(/^Modifiée par/).textContent)).toBe('Modifiée par someone@example.com le 30 septembre 2026 à 08 h 00.')
      expect(rows()).toEqual([
        `23 h 00Brume, Cyan${SATURDAY}1 h 05`,
        'vendredi 2 octobre',
        `00 h 05Écume${SATURDAY}30 min`,
        `00 h 35Aurore${SATURDAY}30 min`,
        `Kwame${SATURDAY}Pas diffusé : seul un extrait de 30 secondes de la piste peut être joué.1 h 02`,
      ])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it("shows each set's genres, in order, as labels that screen readers read as text, and none for a set without any", async () => {
      renderPage()
      await loaded()

      const sets = within(list()).getAllByRole('listitem').filter((row) => row.matches('[data-set]'))
      expect(genresOf(sets)).toEqual(GENRES)
      // Among the lines of what the set is, after its session, before its length.
      expect(sets[0].querySelector('.rotation-set-session + .rotation-genres')).toHaveTextContent('house, techno')
      expect(sets[0].lastElementChild).toHaveClass('rotation-set-length')
      // Not buttons, nor anything else that could be clicked.
      expect(within(sets[0]).queryAllByRole('button')).toEqual([])
    })

    it('draws the play head over the set on air, which shows how far into it the radio is, every second', async () => {
      // 23 minutes and 14 seconds into B. Only the clock and the timers that move the bar on are faked.
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      vi.setSystemTime(ON_AIR_AT + 23 * MINUTE + 14 * 1000)
      renderPage()
      await loaded()

      expect(document.querySelector('.rotation-head')).toHaveTextContent('▶ en ondes')
      expect(underHead()).toBe(rows()[0])
      // Which screen readers are told, since the play head is only drawn.
      expect(onAirSaid()).toEqual([rows()[0]])
      expect(rows()[0]).toMatch(/^23 h 00Brume, Cyan/)
      expect(progress()).toEqual({ shown: '23:14 / 1:05:00', said: '23 min sur 1 h 05', now: '1394', max: '3900' })
      await act(() => vi.advanceTimersByTime(2000))
      expect(progress()).toMatchObject({ shown: '23:16 / 1:05:00', now: '1396' })
      // Once it's over, until the rotation is loaded again.
      await act(() => vi.advanceTimersByTime(60 * MINUTE))
      expect(progress()).toMatchObject({ shown: '1:05:00 / 1:05:00', said: '1 h 05 sur 1 h 05' })
    })

    it('draws no play head off air', async () => {
      const skipped = (set: RotationSet): RotationSet => ({ ...set, skipped: ['cancelled'], startsAt: null })
      renderPage({ [ROTATION_URL]: { ...ROTATION, current: null, sets: ROTATION.sets.map(skipped) } })
      await loaded()

      expect(underHead()).toBeNull()
      expect(onAirSaid()).toEqual([])
      expect(progress()).toBeNull()
    })

    it('says the length of a set to the nearest minute, in its row as in its bar', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      vi.setSystemTime(ON_AIR_AT + 10 * MINUTE)
      renderPage({ [ROTATION_URL]: { ...ROTATION, sets: [{ ...B, durationMs: 64 * MINUTE + 45 * 1000 }, C, A, K] } })
      await loaded()

      expect(rows()[0]).toMatch(/1 h 05$/)
      expect(progress()).toEqual({ shown: '10:00 / 1:04:45', said: '10 min sur 1 h 05', now: '600', max: '3885' })
    })

    it('links to the performers and the session, but not the track or the video, and fades out the sets that are skipped', async () => {
      renderPage()
      await loaded()

      const b = within(list()).getAllByRole('listitem')[0]
      expect(within(b).getByRole('link', { name: 'Brume' })).toHaveAttribute('href', '/admin/artistes/artist-Brume')
      expect(within(b).getByRole('link', { name: 'Cyan' })).toHaveAttribute('href', '/admin/artistes/artist-Cyan')
      expect(within(b).getByRole('link', { name: named(SATURDAY) })).toHaveAttribute('href', '/admin/sessions/session-1')
      expect(within(b).getAllByRole('link')).toHaveLength(3)
      expect(b).toHaveClass('rotation-set-current')
      expect(screen.getByText(/^Kwame$/).closest('li')).toHaveClass('rotation-set-skipped')
    })

    it('says why each skipped set is skipped, and leaves out the length of a set whose track has not been read', async () => {
      const unread = rotationSet('u', ['Ulysse'], null, { youtubeVideo: null, session: { ...GUEST_MIXES, start: null }, skipped: ['not-announced', 'no-youtube-video', 'unread'] })
      renderPage({ [ROTATION_URL]: { ...ROTATION, sets: [...ROTATION.sets, unread] } })
      await loaded()

      expect(rows().find((row) => row!.startsWith('Ulysse'))).toBe("UlysseGUEST MIXES, date à déterminerPas diffusé : la session n'est pas annoncée, le set n'a pas de vidéo sur YouTube, la piste n'a pas encore été lue sur SoundCloud.")
    })

    it('warns when the last read of a track failed, and that the radio goes on with what was read before, unless it never was', async () => {
      const failed = { ...C, readError: 'SoundCloud cannot be reached' }
      const never = rotationSet('n', ['Nadia'], null, { skipped: ['unread'], readError: 'SoundCloud cannot be reached' })
      renderPage({ [ROTATION_URL]: { ...ROTATION, sets: [B, failed, never, A, K] } })
      await loaded()

      const warnings = document.querySelectorAll('.rotation-set .admin-warning')
      expect(Array.from(warnings).map((warning) => spaced(warning.textContent))).toEqual([
        '\u26a0\ufe0e La piste n\'a pas pu être lue sur SoundCloud : SoundCloud cannot be reached. La radio continue avec ce qui en avait été lu avant.',
        "\u26a0\ufe0e La piste n'a pas pu être lue sur SoundCloud : SoundCloud cannot be reached.",
      ])
      expect(warnings[0].closest('li')).toHaveTextContent(/^00 h 05Écume/)
    })

    it('says when the rotation is empty, and the radio off air, and still lets sets be added', async () => {
      renderPage({ [ROTATION_URL]: { ...ROTATION, updatedBy: null, updatedAt: null, current: null, sets: [] } })
      expect(await loaded()).toBeEnabled()

      expect(spaced(screen.getByText(/^La rotation est vide/).textContent)).toBe('La rotation est vide : la radio est hors ondes.')
      expect(screen.queryByText(/^Modifiée par/)).not.toBeInTheDocument()
    })

    it('says when every set is skipped, so that the radio is off air, and lists them as the server gives them, without times', async () => {
      const skipped = (set: RotationSet): RotationSet => ({ ...set, skipped: ['cancelled'], startsAt: null })
      renderPage({ [ROTATION_URL]: { ...ROTATION, current: null, sets: [A, K, B, C].map(skipped) } })
      await loaded()

      expect(spaced(screen.getByText(/^Aucun set/).textContent)).toBe('Aucun set de la rotation ne peut être diffusé : la radio est hors ondes.')
      expect(rows().map(performersOf)).toEqual(['Aurore', 'Kwame', 'Brume, Cyan', 'Écume'])
      expect(rows()[0]).toContain('Pas diffusé : le set est annulé.')
    })

    it("says why the rotation can't be loaded, in place of the list, without « modifier »", async () => {
      renderPage({ [ROTATION_URL]: { ok: false, error: 'Internal server error' } })

      expect(spaced((await screen.findByRole('alert')).textContent)).toBe("La rotation n'a pas pu être chargée : Internal server error")
      expect(screen.queryByRole('button', { name: 'modifier' })).not.toBeInTheDocument()
      expect(document.querySelector('.rotation-sets')).not.toBeInTheDocument()
    })

    it("says that the radio can't read tracks until the credentials are entered, linking to the configuration", async () => {
      renderPage({ [CREDENTIALS_URL]: { ok: true, credentials: null } })

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/^La radio ne peut lire aucune piste sur SoundCloud tant que/)
      expect(within(alert).getByRole('link', { name: 'configuration' })).toHaveAttribute('href', '/admin/configuration')
      await loaded()
    })
  })

  describe('loading it again', () => {
    // B ends at 00:05, and C then goes on air.
    const NEXT: RadioRotation = {
      ...ROTATION,
      current: { setId: 'c', startedAt: C.startsAt! },
      sets: [C, A, K, { ...B, startsAt: at(ON_AIR_AT + 125 * MINUTE) }],
    }

    // With the timers too, or only the clock.
    function fakeTime(now: number, { timers = true } = {}) {
      vi.useFakeTimers(timers ? { toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true } : { toFake: ['Date'] })
      vi.setSystemTime(now)
    }

    // The tab shown again a minute later, by which time the server answers with `rotation`.
    async function shownAgain(rotation: Body) {
      mockFetch({ [ROTATION_URL]: rotation, [CREDENTIALS_URL]: CREDENTIALS, [CANDIDATES_URL]: CANDIDATES })
      vi.setSystemTime(Date.now() + 61 * 1000)
      await act(() => document.dispatchEvent(new Event('visibilitychange')))
    }

    it('loads it again a couple of seconds after the set on air ends', async () => {
      fakeTime(ON_AIR_AT + 60 * MINUTE)
      renderPage()
      await loaded()
      expect(requestsTo('GET', ROTATION_URL)).toHaveLength(1)

      mockFetch({ [ROTATION_URL]: NEXT, [CREDENTIALS_URL]: CREDENTIALS })
      await act(() => vi.advanceTimersByTimeAsync(5 * MINUTE))
      expect(requestsTo('GET', ROTATION_URL)).toHaveLength(0)
      await act(() => vi.advanceTimersByTimeAsync(2000))
      await waitFor(() => expect(rows()[0]).toMatch(/^00 h 05Écume/))
      expect(requestsTo('GET', ROTATION_URL)).toHaveLength(1)
    })

    it('waits 10 seconds when the set on air has ended by the browser’s clock, but not by the server’s', async () => {
      fakeTime(ON_AIR_AT + 70 * MINUTE)
      renderPage()
      await loaded()

      await act(() => vi.advanceTimersByTimeAsync(9000))
      expect(requestsTo('GET', ROTATION_URL)).toHaveLength(1)
      await act(() => vi.advanceTimersByTimeAsync(1000))
      await waitFor(() => expect(requestsTo('GET', ROTATION_URL)).toHaveLength(2))
      // The server still has B on air: 10 seconds more.
      await act(() => vi.advanceTimersByTimeAsync(9000))
      expect(requestsTo('GET', ROTATION_URL)).toHaveLength(2)
      await act(() => vi.advanceTimersByTimeAsync(1000))
      await waitFor(() => expect(requestsTo('GET', ROTATION_URL)).toHaveLength(3))
    })

    it("doesn't load it again on its own while the radio is off air", async () => {
      fakeTime(ON_AIR_AT)
      renderPage({ [ROTATION_URL]: { ...ROTATION, current: null, sets: [] } })
      await loaded()

      await act(() => vi.advanceTimersByTimeAsync(60 * MINUTE))
      expect(requestsTo('GET', ROTATION_URL)).toHaveLength(1)
    })

    it('loads it again when the tab is shown again, at most once a minute', async () => {
      fakeTime(ON_AIR_AT, { timers: false })
      renderPage()
      await loaded()

      // Less than a minute after the page loaded it.
      await act(() => document.dispatchEvent(new Event('visibilitychange')))
      expect(requestsTo('GET', ROTATION_URL)).toHaveLength(1)
      await shownAgain(NEXT)
      await waitFor(() => expect(rows()[0]).toMatch(/^00 h 05Écume/))
    })

    it('keeps what it loaded last when loading it again fails, and says why', async () => {
      fakeTime(ON_AIR_AT, { timers: false })
      renderPage()
      await loaded()

      await shownAgain({ ok: false, error: 'Internal server error' })

      expect(spaced((await screen.findByRole('alert')).textContent)).toBe("La rotation n'a pas pu être chargée à nouveau : Internal server error")
      expect(rows()[0]).toMatch(/^23 h 00Brume, Cyan/)
      expect(screen.getByRole('button', { name: 'modifier' })).toBeInTheDocument()
    })

    it('loads it again while it is being changed, leaving the changes as they are, but not what saving them does', async () => {
      fakeTime(ON_AIR_AT, { timers: false })
      await modify()
      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Aurore/ }))
      expect(draftTimes()).toEqual(['23 h 00', 'vendredi 2 octobre 00 h 05', ''])

      await shownAgain(NEXT)
      await waitFor(() => expect(requestsTo('GET', ROTATION_URL)).toHaveLength(1))
      expect(draft()).toEqual([
        `1 Brume, Cyan${SATURDAY} · 1 h 05`,
        `2 Écume${SATURDAY} · 30 min`,
        `3 Kwame${SATURDAY} · 1 h 02Pas diffusé : seul un extrait de 30 secondes de la piste peut être joué.`,
      ])
      // C is now the one on air: saving would put B back on air, from now, a minute later.
      expect(draftTimes()).toEqual(['23 h 01', 'vendredi 2 octobre 00 h 06', ''])
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      await waitFor(() => expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Le set de Brume et Cyan passera tout de suite en ondes, à la place du set de Écume.'))
      fireEvent.click(screen.getByRole('button', { name: 'revenir' }))

      // Once it's left as it is, the page shows it as it was loaded again.
      fireEvent.click(screen.getByRole('button', { name: 'annuler' }))
      expect(rows()[0]).toMatch(/^00 h 05Écume/)
    })
  })

  describe('changing it', () => {
    it('lists the sets in the order shown, numbered, with their lengths, when each would go on air, or why it is skipped', async () => {
      await modify()

      expect(draft()).toEqual([
        `1 Brume, Cyan${SATURDAY} · 1 h 05`,
        `2 Écume${SATURDAY} · 30 min`,
        `3 Aurore${SATURDAY} · 30 min`,
        `4 Kwame${SATURDAY} · 1 h 02Pas diffusé : seul un extrait de 30 secondes de la piste peut être joué.`,
      ])
      // As when it isn't being changed, the set on air going on.
      expect(draftTimes()).toEqual(['23 h 00', 'vendredi 2 octobre 00 h 05', '00 h 35', ''])
      // The day is a line of its own, above the box of the first set of that day, but in its row, which is what's dragged.
      const day = screen.getByText('vendredi 2 octobre')
      expect(draftOf(day.closest('li')!)).toBe(`2 Écume${SATURDAY} · 30 min`)
      expect(day.closest('.admin-ordered-item')).toBeNull()
      expect(day).toBeVisible()
      // Where « modifier » was.
      expect(document.activeElement).toBe(screen.getByRole('button', { name: named(`réordonner Set de Brume et Cyan, ${SATURDAY}`) }))
      expect(document.querySelector('.rotation-sets')).not.toBeInTheDocument()
      expect(screen.getByText('Seuls les sets annoncés et joués, avec un lien SoundCloud et YouTube, sont disponibles.')).toBeInTheDocument()
    })

    it("shows each set's genres as when it isn't being changed, those of a set added before and after its track is read", async () => {
      const answer = held()
      await modify({ [candidateUrl(F)]: answer.body })
      const items = () => Array.from(document.querySelectorAll('.admin-ordered > li'))
      expect(genresOf(items())).toEqual(GENRES)
      // Among the lines of its text, after its session and its length.
      expect(items()[0].querySelector('.rotation-set-session + .rotation-genres')).toHaveTextContent('house, techno')

      pick('Set de Fréquence')
      expect(genresOf(items()).at(-1)).toEqual({ read: 'house', shown: ['house'] })
      await answer.answer(withTrack(F, 45))
      expect(draft().at(-1)).toBe(`5 Fréquence Boréale${SATURDAY} · 45 min`)
      expect(genresOf(items()).at(-1)).toEqual({ read: 'house', shown: ['house'] })
    })

    it('keeps the play head over the first set that can be played, whose bar only moves on when it is the set on air', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      vi.setSystemTime(ON_AIR_AT + 23 * MINUTE + 14 * 1000)
      await modify()
      expect(underHead()).toBe(`1 Brume, Cyan${SATURDAY} · 1 h 05`)
      expect(progress()).toMatchObject({ shown: '23:14 / 1:05:00' })
      await act(() => vi.advanceTimersByTime(1000))
      expect(progress()).toMatchObject({ shown: '23:15 / 1:05:00' })

      // Another set under it starts from its start once it's saved.
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Aurore/ }), -2)
      expect(underHead()).toBe(`1 Aurore${SATURDAY} · 30 min`)
      expect(onAirSaid()).toEqual([underHead()])
      expect(progress()).toEqual({ shown: '0:00 / 30:00', said: '0 min sur 30 min', now: '0', max: '1800' })
      await act(() => vi.advanceTimersByTime(5000))
      expect(progress()).toMatchObject({ shown: '0:00 / 30:00' })
    })

    it('works out again when each set would go on air as sets are moved or taken out, skipped ones adding no time', async () => {
      await modify()

      // The day is worked out again with the times once a set is dropped, above the row of the first set of that day.
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Aurore/ }), -1)
      expect(draft().map(performersOf)).toEqual(['1 Brume, Cyan', '2 Aurore', '3 Écume', '4 Kwame'])
      expect(draftTimes()).toEqual(['23 h 00', 'vendredi 2 octobre 00 h 05', '00 h 35', ''])

      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Aurore/ }))
      expect(draftTimes()).toEqual(['23 h 00', 'vendredi 2 octobre 00 h 05', ''])

      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Kwame/ }), -1)
      expect(draft().map(performersOf)).toEqual(['1 Brume, Cyan', '2 Kwame', '3 Écume'])
      expect(draftTimes()).toEqual(['23 h 00', '', 'vendredi 2 octobre 00 h 05'])
    })

    it('leaves the days blank while a set is being moved, until it is dropped or put back', async () => {
      await modify()
      const day = () => screen.getByText('vendredi 2 octobre')
      const aurore = screen.getByRole('button', { name: /^réordonner Set de Aurore/ })
      mockListLayout()

      // Picked up, and moved, but not dropped yet: the day keeps its place, but isn't shown.
      await pickUp(aurore)
      fireEvent.keyDown(aurore, { key: 'ArrowUp', code: 'ArrowUp' })
      expect(day()).not.toBeVisible()
      expect(draftTimes()).toEqual(['23 h 00', 'vendredi 2 octobre 00 h 05', '00 h 35', ''])
      // Put back.
      fireEvent.keyDown(aurore, { key: 'Escape', code: 'Escape' })
      await act(() => new Promise((resolve) => setTimeout(resolve)))
      expect(day()).toBeVisible()

      // Dropped (see the test above for where the day is then).
      await moveWithKeyboard(aurore, -1)
      expect(day()).toBeVisible()
    })

    it('starts the set under the play head now when it is another than the set on air, so that the times move on with the clock', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      vi.setSystemTime(ON_AIR_AT + 23 * MINUTE)
      await modify()
      // Later, without the page being drawn again in the meantime.
      vi.setSystemTime(ON_AIR_AT + 30 * MINUTE)

      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Aurore/ }), -2)
      expect(draft().map(performersOf)).toEqual(['1 Aurore', '2 Brume, Cyan', '3 Écume', '4 Kwame'])
      expect(draftTimes()).toEqual(['23 h 30', 'vendredi 2 octobre 00 h 00', '01 h 05', ''])
      await act(() => vi.advanceTimersByTime(MINUTE))
      expect(draftTimes()).toEqual(['23 h 31', 'vendredi 2 octobre 00 h 01', '01 h 06', ''])
      // The page's clock, the only timer, since Aurore's bar stays at its start.
      expect(vi.getTimerCount()).toBe(1)

      // The set on air, back under the play head, goes on, and the page's clock stops: only its bar's goes on.
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Aurore/ }), 2)
      expect(draftTimes()).toEqual(['23 h 00', 'vendredi 2 octobre 00 h 05', '00 h 35', ''])
      expect(vi.getTimerCount()).toBe(1)
      await act(() => vi.advanceTimersByTime(MINUTE))
      expect(draftTimes()).toEqual(['23 h 00', 'vendredi 2 octobre 00 h 05', '00 h 35', ''])
    })

    it('gives no time to the sets after one that was not in the rotation, until its track is read, unlike one taken out and added back', async () => {
      await modify()

      pick('Set de Fréquence')
      expect(draft()[4]).toBe(`5 Fréquence Boréale${SATURDAY}`)
      expect(draftTimes()).toEqual(['23 h 00', 'vendredi 2 octobre 00 h 05', '00 h 35', '', '01 h 05'])
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Fréquence/ }), -2)
      expect(draft().map(performersOf)).toEqual(['1 Brume, Cyan', '2 Écume', '3 Fréquence Boréale', '4 Aurore', '5 Kwame'])
      expect(draftTimes()).toEqual(['23 h 00', 'vendredi 2 octobre 00 h 05', '00 h 35', '', ''])

      // Écume's set, taken out and added back, keeps its length.
      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Écume/ }))
      pick('Set de Écume')
      expect(draft()[4]).toBe(`5 Écume${SATURDAY} · 30 min`)
      expect(draftTimes()).toEqual(['23 h 00', 'vendredi 2 octobre 00 h 05', '', '', ''])
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Fréquence/ }), 3)
      expect(draft().map(performersOf)).toEqual(['1 Brume, Cyan', '2 Aurore', '3 Kwame', '4 Écume', '5 Fréquence Boréale'])
      expect(draftTimes()).toEqual(['23 h 00', 'vendredi 2 octobre 00 h 05', '', '00 h 35', '01 h 05'])
    })

    it('starts a set that was not in the rotation now, under the play head, and gives the sets after it no time', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      vi.setSystemTime(ON_AIR_AT + 10 * MINUTE)
      await modify()
      pick('Set de Fréquence')
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Fréquence/ }), -4)
      expect(draft().map(performersOf)).toEqual(['1 Fréquence Boréale', '2 Brume, Cyan', '3 Écume', '4 Aurore', '5 Kwame'])
      expect(draftTimes()).toEqual(['23 h 10', '', '', '', ''])
    })

    it('starts a set that was not in the rotation now when the radio is off air', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      vi.setSystemTime(ON_AIR_AT + 10 * MINUTE)
      const skipped = (set: RotationSet): RotationSet => ({ ...set, skipped: ['cancelled'], startsAt: null })
      await modify({ [ROTATION_URL]: { ...ROTATION, current: null, sets: [A, K, B, C].map(skipped) } })
      expect(draftTimes()).toEqual(['', '', '', ''])
      pick('Set de Fréquence')
      expect(draftTimes()).toEqual(['', '', '', '', '23 h 10'])
    })

    it('reads the track of a set that was not in the rotation each time it is added, and shows its length, and the times after it, once it answers', async () => {
      const answer = held()
      await modify({ [candidateUrl(F)]: answer.body })
      pick('Set de Fréquence')
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Fréquence/ }), -2)
      expect(draftTimes()).toEqual(['23 h 00', 'vendredi 2 octobre 00 h 05', '00 h 35', '', ''])
      expect(requestsTo('GET', candidateUrl(F))).toHaveLength(1)

      await answer.answer(withTrack(F, 45))
      expect(draft()[2]).toBe(`3 Fréquence Boréale${SATURDAY} · 45 min`)
      expect(draftTimes()).toEqual(['23 h 00', 'vendredi 2 octobre 00 h 05', '00 h 35', '01 h 20', ''])

      // Taken out and added again, it's read again, and keeps its length meanwhile.
      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Fréquence/ }))
      pick('Set de Fréquence')
      await waitFor(() => expect(requestsTo('GET', candidateUrl(F))).toHaveLength(2))
      expect(draft()[4]).toBe(`5 Fréquence Boréale${SATURDAY} · 45 min`)
      // A set that was in the rotation isn't read: by the time Gaïa's set, added after it, is, it hasn't been.
      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Écume/ }))
      pick('Set de Écume')
      pick('Set de Gaïa')
      await waitFor(() => expect(requestsTo('GET', candidateUrl(G))).toHaveLength(1))
      expect(requestsTo('GET', `${CANDIDATES_URL}/c`)).toHaveLength(0)
    })

    it('only shows the answer to the last time a set was added', async () => {
      await modify()
      // The answers to each time Fréquence Boréale's set is read, in turn.
      const answers = [held(), held()]
      let asked = 0
      const fetched = vi.mocked(fetch).getMockImplementation()!
      vi.mocked(fetch).mockImplementation((input, options) =>
        input instanceof Request && input.url.endsWith(candidateUrl(F)) ? answers[asked++].body.then((body) => Response.json(body)) : fetched(input, options),
      )
      pick('Set de Fréquence')
      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Fréquence/ }))
      pick('Set de Fréquence')
      await waitFor(() => expect(asked).toBe(2))

      await answers[0].answer(withTrack(F, 45))
      expect(draft()[4]).toBe(`5 Fréquence Boréale${SATURDAY}`)
      await answers[1].answer(withTrack(F, 50))
      await waitFor(() => expect(draft()[4]).toBe(`5 Fréquence Boréale${SATURDAY} · 50 min`))
    })

    it('shows a set that was not in the rotation skipped when its track is read so, or could not be read, saying why, and the play head moves past it', async () => {
      await modify({
        [candidateUrl(F)]: withTrack(F, 30, { skipped: ['preview'] }),
        [candidateUrl(G)]: withTrack(G, null, { skipped: ['unread'], readError: 'SoundCloud cannot be reached' }),
      })
      pick('Set de Fréquence')
      pick('Set de Gaïa')
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Fréquence/ }), -4)
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Gaïa/ }), -5)
      await waitFor(() => expect(draft()[0]).toContain('Pas diffusé'))
      expect(draft().slice(0, 2)).toEqual([
        "1 GaïaGUEST MIXES, dim. 2 août 2026Pas diffusé : la piste n'a pas encore été lue sur SoundCloud.\u26a0\ufe0e La piste n'a pas pu être lue sur SoundCloud : SoundCloud cannot be reached.",
        `2 Fréquence Boréale${SATURDAY} · 30 minPas diffusé : seul un extrait de 30 secondes de la piste peut être joué.`,
      ])
      expect(underHead()).toBe(`3 Brume, Cyan${SATURDAY} · 1 h 05`)
      expect(draftTimes()).toEqual(['', '', '23 h 00', 'vendredi 2 octobre 00 h 05', '00 h 35', ''])
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      expect(screen.getByRole('dialog', { hidden: true })).toHaveTextContent("Le set en cours continue : les changements s'appliquent dès le set suivant.")
    })

    it('keeps a set that was not in the rotation as one that can be played, whose length is not known, when reading its track gets no answer', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
      vi.setSystemTime(ON_AIR_AT + 10 * MINUTE)
      await modify({ [candidateUrl(F)]: { ok: false, error: 'Something went wrong' } })
      pick('Set de Fréquence')
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Fréquence/ }), -4)
      await waitFor(() => expect(requestsTo('GET', candidateUrl(F))).toHaveLength(1))
      await act(async () => {})
      expect(draft()[0]).toBe(`1 Fréquence Boréale${SATURDAY}`)
      expect(underHead()).toBe(draft()[0])
      expect(draftTimes()).toEqual(['23 h 10', '', '', '', ''])
    })

    it('reorders the sets with the keyboard, takes them out, and adds others at the end, keeping the focus', async () => {
      await modify()

      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Aurore/ }), -2)
      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Écume/ }))
      pick('Set de Gaïa')
      expect(document.activeElement).toBe(picker())

      expect(draft().map(performersOf)).toEqual(['1 Aurore', '2 Brume, Cyan', '3 Kwame', '4 Gaïa'])
      expect(draft()[3]).toBe('4 GaïaGUEST MIXES, dim. 2 août 2026')
    })

    it('offers the sets that can be added, the most recent session first, then those taken out, whatever they are, and searches them', async () => {
      const [gaia, kwame] = [`Set de Gaïa${AUGUST} · deep house, ambient`, `Set de Kwame${SATURDAY} · ambient`]
      await modify()
      fireEvent.click(picker())
      // With their genres, after their session.
      expect(options()).toEqual([`Set de Fréquence Boréale${SATURDAY} · house`, gaia])
      fireEvent.keyDown(picker(), { key: 'Escape' })

      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Kwame/ }))
      pick('Set de Fréquence')
      fireEvent.click(picker())
      expect(options()).toEqual([gaia, kwame])
      fireEvent.keyDown(picker(), { key: 'Escape' })

      // By performer, session title or day, whatever the case and the accents.
      search('gaia')
      expect(options()).toEqual([gaia])
      search('haute rive')
      expect(options()).toEqual([kwame])
      search('2 août')
      expect(options()).toEqual([gaia])
      search('samedi')
      expect(options()).toEqual([kwame])
      // And by genre, as the admin pages name them, even that of a set taken out, alone or with the other fields.
      search('ambient')
      expect(options()).toEqual([gaia, kwame])
      search('deep house')
      expect(options()).toEqual([gaia])
      search('ambient kwame')
      expect(options()).toEqual([kwame])

      // Kwame's set, though skipped, goes back in, with why.
      fireEvent.mouseDown(screen.getByRole('option', { name: /^Set de Kwame/ }))
      expect(draft().at(-1)).toBe(`5 Kwame${SATURDAY} · 1 h 02Pas diffusé : seul un extrait de 30 secondes de la piste peut être joué.`)
    })

    it("can't add a set when those that can be added can't be loaded, and says why", async () => {
      renderPage({ [CANDIDATES_URL]: { ok: false, error: 'Internal server error' } })
      fireEvent.click(await loaded())

      expect(spaced((await screen.findByRole('alert')).textContent)).toBe("Les sets qu'on peut ajouter n'ont pas pu être chargés : Internal server error")
      expect(picker()).toBeDisabled()
      expect(picker()).toHaveAttribute('placeholder', "les sets n'ont pas pu être chargés")
    })

    it('leaves the rotation as it is with « annuler », and with « enregistrer » when nothing changed, giving the focus back to « modifier »', async () => {
      await modify()
      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Aurore/ }))
      fireEvent.click(screen.getByRole('button', { name: 'annuler' }))
      expect(rows()).toHaveLength(5)
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'modifier' }))

      // Changed, then changed back.
      fireEvent.click(screen.getByRole('button', { name: 'modifier' }))
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Aurore/ }), -1)
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Aurore/ }), 1)
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(rows()).toHaveLength(5)
      expect(requestsTo('PUT', ROTATION_URL)).toHaveLength(0)
    })
  })

  describe('confirming', () => {
    // What the dialog says, while it's open.
    const confirmation = () => Array.from(document.querySelectorAll('.rotation-confirm[open] p')).map((p) => spaced(p.textContent))

    it('asks to confirm what the change does on the radio in a dialog, here that the set on air goes on, and goes back to the changes with « revenir »', async () => {
      await modify()
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Aurore/ }), -1)
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))

      expect(confirmation()).toEqual(["Le set en cours continue : les changements s'appliquent dès le set suivant."])
      // Which screen readers read as the focus moves into it, onto « confirmer ».
      expect(screen.getByRole('dialog', { name: 'Enregistrer la rotation', description: named("Le set en cours continue : les changements s'appliquent dès le set suivant.") })).toHaveAttribute('open')
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'confirmer' }))
      // The list can't be changed meanwhile.
      expect(screen.getByRole('button', { name: /^retirer Set de Aurore/ })).toBeDisabled()
      expect(picker()).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'revenir' }))
      expect(confirmation()).toEqual([])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'enregistrer' }))
      expect(screen.getByRole('button', { name: /^retirer Set de Aurore/ })).toBeEnabled()

      // Escape too.
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      expect(confirmation()).toHaveLength(1)
      fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
      expect(confirmation()).toEqual([])
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'enregistrer' }))
      expect(requestsTo('PUT', ROTATION_URL)).toHaveLength(0)
    })

    it('says which set goes on air right away, in place of the one on air, when another one is first', async () => {
      await modify()
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Aurore/ }), -2)
      expect(draft().slice(0, 2).map(performersOf)).toEqual(['1 Aurore', '2 Brume, Cyan'])
      expect(underHead()).toBe(`1 Aurore${SATURDAY} · 30 min`)
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      expect(confirmation()).toEqual(['Le set de Aurore passera tout de suite en ondes, à la place du set de Brume et Cyan.'])

      // A set added, which counts as one that can be played.
      fireEvent.click(screen.getByRole('button', { name: 'revenir' }))
      pick('Set de Fréquence')
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Fréquence/ }), -4)
      expect(underHead()).toBe(`1 Fréquence Boréale${SATURDAY}`)
      expect(onAirSaid()).toEqual([underHead()])
      // Its length isn't known until it's read.
      expect(progress()).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      expect(confirmation()).toEqual(['Le set de Fréquence Boréale passera tout de suite en ondes, à la place du set de Brume et Cyan.'])
    })

    it('goes by the first set that can be played, which can be the one on air', async () => {
      await modify()
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Kwame/ }), -3)
      expect(draft().map(performersOf)).toEqual(['1 Kwame', '2 Brume, Cyan', '3 Écume', '4 Aurore'])
      expect(underHead()).toBe(`2 Brume, Cyan${SATURDAY} · 1 h 05`)
      expect(draftTimes()).toEqual(['', '23 h 00', 'vendredi 2 octobre 00 h 05', '00 h 35'])
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      expect(confirmation()).toEqual(["Le set en cours continue : les changements s'appliquent dès le set suivant."])
    })

    it('says when the set on air is taken out, when only skipped sets would be left, and when the rotation would be empty', async () => {
      await modify()
      const remove = (...names: string[]) => names.forEach((name) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^retirer Set de ${name}`) })))
      remove('Brume')
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      expect(confirmation()).toEqual(['Le set de Écume passera tout de suite en ondes, à la place du set de Brume et Cyan.'])

      // Only Kwame's set, which is skipped.
      fireEvent.click(screen.getByRole('button', { name: 'revenir' }))
      remove('Écume', 'Aurore')
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      expect(confirmation()).toEqual(['Aucun set de la rotation ne pourra être diffusé : la radio sera hors ondes.'])

      fireEvent.click(screen.getByRole('button', { name: 'revenir' }))
      remove('Kwame')
      expect(document.activeElement).toBe(picker())
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      expect(confirmation()).toEqual(['La rotation sera vide : la radio sera hors ondes.'])
    })

    it('says when the radio, off air, comes back on air, with a set added, which counts as one that can be played', async () => {
      const skipped = (set: RotationSet): RotationSet => ({ ...set, skipped: ['cancelled'], startsAt: null })
      await modify({ [ROTATION_URL]: { ...ROTATION, current: null, sets: [A, K, B, C].map(skipped) } })
      pick('Set de Fréquence')
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      expect(confirmation()).toEqual(['La radio reviendra tout de suite en ondes, avec le set de Fréquence Boréale.'])

      // Without it, none can.
      fireEvent.click(screen.getByRole('button', { name: 'revenir' }))
      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Fréquence/ }))
      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Aurore/ }))
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      expect(confirmation()).toEqual(['Aucun set de la rotation ne pourra être diffusé : la radio sera hors ondes.'])
    })
  })

  describe('saving', () => {
    async function changeAndConfirm(bodies: Record<string, Body | Promise<Body>>) {
      await modify(bodies)
      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Écume/ }))
      pick('Set de Fréquence')
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      fireEvent.click(screen.getByRole('button', { name: 'confirmer' }))
    }

    it('sends the sets in the order shown, locks the list meanwhile, then shows the rotation as saved, and says so', async () => {
      const answer = held()
      await changeAndConfirm({ [`PUT ${ROTATION_URL}`]: answer.body })

      // The dialog stays open, and Escape doesn't close it.
      const sending = screen.getByRole('button', { name: 'enregistrement…' })
      expect(sending).toBeDisabled()
      expect(screen.getByRole('button', { name: 'revenir' })).toBeDisabled()
      fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
      expect(screen.getByRole('dialog')).toHaveAttribute('open')
      expect(screen.getByRole('button', { name: /^réordonner Set de Aurore/ })).toHaveAttribute('aria-disabled', 'true')
      await waitFor(() => expect(requestsTo('PUT', ROTATION_URL)).toHaveLength(1))
      expect(jsonBody(requestsTo('PUT', ROTATION_URL)[0])).toEqual({ sets: ['b', 'a', 'k', 'f'] })

      const savedF = rotationSet('f', ['Fréquence Boréale'], 60, { startsAt: at(ON_AIR_AT + 95 * MINUTE) })
      await answer.answer({ ...ROTATION, updatedBy: 'admin@example.com', updatedAt: '2026-10-02T03:30:00.000Z', sets: [B, { ...A, startsAt: at(ON_AIR_AT + 65 * MINUTE) }, K, savedF] })
      expect(screen.getByRole('status')).toHaveTextContent('La rotation a été enregistrée.')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(spaced(screen.getByText(/^Modifiée par/).textContent)).toBe('Modifiée par admin@example.com le 1 octobre 2026 à 23 h 30.')
      expect(rows().map(performersOf)).toEqual(['23 h 00Brume, Cyan', 'vendredi 2 octobre', '00 h 05Aurore', 'Kwame', '00 h 35Fréquence Boréale'])
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'modifier' }))

      // Until the rotation is changed again.
      fireEvent.click(screen.getByRole('button', { name: 'modifier' }))
      expect(screen.queryByText('La rotation a été enregistrée.')).not.toBeInTheDocument()
    })

    it('keeps the rotation as it was saved when a load sent before that answers after it', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(ON_AIR_AT)
      await modify()
      // The tab is shown again, and the load it sends is held back.
      const reload = held()
      mockFetch({ [ROTATION_URL]: reload.body, [CREDENTIALS_URL]: CREDENTIALS, [CANDIDATES_URL]: CANDIDATES, [`PUT ${ROTATION_URL}`]: { ...ROTATION, sets: [B, A, K] } })
      vi.setSystemTime(ON_AIR_AT + 61 * 1000)
      await act(() => document.dispatchEvent(new Event('visibilitychange')))
      await waitFor(() => expect(requestsTo('GET', ROTATION_URL)).toHaveLength(1))

      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Écume/ }))
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      fireEvent.click(screen.getByRole('button', { name: 'confirmer' }))
      await screen.findByText('La rotation a été enregistrée.')

      await reload.answer(ROTATION)
      expect(rows().map(performersOf)).toEqual(['23 h 00Brume, Cyan', 'vendredi 2 octobre', '00 h 35Aurore', 'Kwame'])
    })

    it("says which set can't be added, and why, keeps the changes, and loads the sets that can be added again", async () => {
      await changeAndConfirm({
        [`PUT ${ROTATION_URL}`]: { ok: false, error: "This set can't be added to the rotation", setIndex: 3, reasons: ['not-announced', 'cancelled'] },
      })

      expect(spaced((await screen.findByRole('alert')).textContent)).toBe(
        `Le set de Fréquence Boréale (${SATURDAY}) ne peut pas être ajouté à la rotation : la session n'est pas annoncée, le set est annulé.`,
      )
      expect(draft().map(performersOf)).toEqual(['1 Brume, Cyan', '2 Aurore', '3 Kwame', '4 Fréquence Boréale'])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'enregistrer' }))
      await waitFor(() => expect(requestsTo('GET', CANDIDATES_URL)).toHaveLength(2))
    })

    it('says which set no longer exists', async () => {
      await changeAndConfirm({ [`PUT ${ROTATION_URL}`]: { ok: false, error: 'No such set', setIndex: 1 } })

      expect(spaced((await screen.findByRole('alert')).textContent)).toBe(`Le set de Aurore (${SATURDAY}) n'existe plus : retirez-le de la rotation.`)
      expect(draft()).toHaveLength(4)
    })

    it("says why it can't be saved otherwise", async () => {
      await changeAndConfirm({ [`PUT ${ROTATION_URL}`]: { ok: false, error: 'Internal server error' } })

      expect(spaced((await screen.findByRole('alert')).textContent)).toBe("La rotation n'a pas pu être enregistrée : Internal server error")
      expect(draft()).toHaveLength(4)
      expect(requestsTo('GET', CANDIDATES_URL)).toHaveLength(1)
    })
  })
})
