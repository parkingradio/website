import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { Schema } from '../../api/client'
import { held, jsonBody, mockFetch, moveWithKeyboard, named, requestsTo, spaced } from '../../test-utils'
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

// From the play head, as the server gives them: B, on air, C, A, then K, which is skipped.
const A = rotationSet('a', ['Aurore'], 30, { startsAt: at(ON_AIR_AT + 95 * MINUTE) })
const K = rotationSet('k', ['Kwame'], 62, { skipped: ['preview'] })
const B = rotationSet('b', ['Brume', 'Cyan'], 65, { startsAt: at(ON_AIR_AT) })
const C = rotationSet('c', ['Écume'], 30, { startsAt: at(ON_AIR_AT + 65 * MINUTE) })

const ROTATION: RadioRotation = {
  ok: true,
  updatedBy: 'someone@example.com',
  updatedAt: '2026-09-30T12:00:00.000Z',
  current: { setId: 'b', startedAt: at(ON_AIR_AT) },
  sets: [B, C, A, K],
}

// Two sets that can be added: the most recent session first.
const candidate = (id: string, name: string, session: RotationSet['session']): Schema<'RotationCandidate'> => {
  const { performers, soundcloudTrack, youtubeVideo } = rotationSet(id, [name], 60)
  return { id, performers, soundcloudTrack, youtubeVideo, session }
}
const F = candidate('f', 'Fréquence Boréale', HAUTE_RIVE)
const G = candidate('g', 'Gaïa', GUEST_MIXES)
const CANDIDATES = { ok: true, total: 2, sets: [F, G] }

const CREDENTIALS = { ok: true, credentials: { clientId: 'id', updatedBy: 'someone@example.com', updatedAt: '2026-09-01T12:00:00.000Z', error: null } }

function renderPage(bodies: Record<string, Body | Promise<Body>> = {}) {
  mockFetch({ [ROTATION_URL]: ROTATION, [CREDENTIALS_URL]: CREDENTIALS, [CANDIDATES_URL]: CANDIDATES, ...bodies })
  render(
    <MemoryRouter>
      <Rotation />
    </MemoryRouter>,
  )
}

const list = () => document.querySelector<HTMLElement>('.rotation-sets')!
// The text of each row of the list, the days between them included.
const rows = () =>
  within(list())
    .getAllByRole('listitem')
    .map((row) => spaced(row.textContent))
const loaded = () => screen.findByRole('button', { name: 'modifier' })

// What's being changed: each set's number and performers, and its session's title and day.
const draft = () =>
  Array.from(document.querySelectorAll('.admin-ordered > li')).map((item) => spaced(`${item.querySelector('b')!.textContent} ${item.querySelector('.admin-ordered-text')!.textContent}`))

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
// A row's text, or a set's being changed, up to its session.
const performersOf = (text: string | null) => text!.replace(/(HAUTE RIVE TAKEOVER|GUEST MIXES),.*$/, '')

afterEach(() => {
  vi.useRealTimers()
})

describe('Rotation', () => {
  describe('the rotation', () => {
    it('lists the sets as the server gives them, from the one on air, with when each one starts, and the day whenever it changes', async () => {
      renderPage()
      await loaded()

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Rotation radio')
      expect(spaced(screen.getByText(/^Modifiée par/).textContent)).toBe('Modifiée par someone@example.com le 30 septembre 2026 à 08 h 00.')
      expect(rows()).toEqual([
        `23 h 00Brume, Cyanen cours${SATURDAY} · 1 h 05 · SoundCloud · YouTube`,
        'vendredi 2 octobre',
        `00 h 05Écume${SATURDAY} · 30 min · SoundCloud · YouTube`,
        `00 h 35Aurore${SATURDAY} · 30 min · SoundCloud · YouTube`,
        `Kwame${SATURDAY} · 1 h 02 · SoundCloud · YouTube` + "Pas diffusé : seul un extrait de 30 secondes de la piste peut être joué.",
      ])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('links to the performers, the session, the track and the video, and fades out the sets that are skipped', async () => {
      renderPage()
      await loaded()

      const b = within(list()).getAllByRole('listitem')[0]
      expect(within(b).getByRole('link', { name: 'Brume' })).toHaveAttribute('href', '/admin/artistes/artist-Brume')
      expect(within(b).getByRole('link', { name: 'Cyan' })).toHaveAttribute('href', '/admin/artistes/artist-Cyan')
      expect(within(b).getByRole('link', { name: named(SATURDAY) })).toHaveAttribute('href', '/admin/sessions/session-1')
      expect(within(b).getByRole('link', { name: 'SoundCloud' })).toHaveAttribute('href', 'https://soundcloud.com/parkingdotradio/b')
      expect(within(b).getByRole('link', { name: 'YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=video-b')
      expect(b).toHaveClass('rotation-set-current')
      expect(screen.getByText(/^Kwame$/).closest('li')).toHaveClass('rotation-set-skipped')
    })

    it('says why each skipped set is skipped, and leaves out what a set has no length or link for', async () => {
      const unread = rotationSet('u', ['Ulysse'], null, { youtubeVideo: null, session: { ...GUEST_MIXES, start: null }, skipped: ['not-announced', 'no-youtube-video', 'unread'] })
      renderPage({ [ROTATION_URL]: { ...ROTATION, sets: [...ROTATION.sets, unread] } })
      await loaded()

      expect(rows().find((row) => row!.startsWith('Ulysse'))).toBe("UlysseGUEST MIXES, date à déterminer · SoundCloudPas diffusé : la session n'est pas annoncée, le set n'a pas de vidéo sur YouTube, la piste n'a pas encore été lue sur SoundCloud.")
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
      await waitFor(() => expect(rows()[0]).toMatch(/^00 h 05Écumeen cours/))
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
      await waitFor(() => expect(rows()[0]).toMatch(/^00 h 05Écumeen cours/))
    })

    it('keeps what it loaded last when loading it again fails, and says why', async () => {
      fakeTime(ON_AIR_AT, { timers: false })
      renderPage()
      await loaded()

      await shownAgain({ ok: false, error: 'Internal server error' })

      expect(spaced((await screen.findByRole('alert')).textContent)).toBe("La rotation n'a pas pu être chargée à nouveau : Internal server error")
      expect(rows()[0]).toMatch(/^23 h 00Brume, Cyanen cours/)
      expect(screen.getByRole('button', { name: 'modifier' })).toBeInTheDocument()
    })

    it('loads it again while it is being changed, leaving the changes as they are, but not what saving them does', async () => {
      fakeTime(ON_AIR_AT, { timers: false })
      await modify()
      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Aurore/ }))

      await shownAgain(NEXT)
      await waitFor(() => expect(requestsTo('GET', ROTATION_URL)).toHaveLength(1))
      expect(draft()).toEqual([`1 Brume, Cyan${SATURDAY}en ondes`, `2 Écume${SATURDAY}à suivre`, `3 Kwame${SATURDAY}Pas diffusé : seul un extrait de 30 secondes de la piste peut être joué.`])
      // C is now the one on air: saving would put B back on air.
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      await waitFor(() => expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Le set de Brume et Cyan passera tout de suite en ondes, à la place du set de Écume.'))
      fireEvent.click(screen.getByRole('button', { name: 'revenir' }))

      // Once it's left as it is, the page shows it as it was loaded again.
      fireEvent.click(screen.getByRole('button', { name: 'annuler' }))
      expect(rows()[0]).toMatch(/^00 h 05Écumeen cours/)
    })
  })

  describe('changing it', () => {
    it('lists the sets in the order shown, numbered, the first on air and the others next, or why they are skipped, without times', async () => {
      await modify()

      expect(draft()).toEqual([
        `1 Brume, Cyan${SATURDAY}en ondes`,
        `2 Écume${SATURDAY}à suivre`,
        `3 Aurore${SATURDAY}à suivre`,
        `4 Kwame${SATURDAY}Pas diffusé : seul un extrait de 30 secondes de la piste peut être joué.`,
      ])
      // Where « modifier » was.
      expect(document.activeElement).toBe(screen.getByRole('button', { name: named(`réordonner Set de Brume et Cyan, ${SATURDAY}`) }))
      expect(document.querySelector('.rotation-sets')).not.toBeInTheDocument()
      expect(screen.getByText('Seuls les sets annoncés et joués, avec un lien SoundCloud et YouTube, sont disponibles.')).toBeInTheDocument()
    })

    it('reorders the sets with the keyboard, takes them out, and adds others at the end, keeping the focus', async () => {
      await modify()

      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Aurore/ }), -2)
      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Écume/ }))
      pick('Set de Gaïa')
      expect(document.activeElement).toBe(picker())

      expect(draft().map(performersOf)).toEqual(['1 Aurore', '2 Brume, Cyan', '3 Kwame', '4 Gaïa'])
      expect(draft()[0]).toBe(`1 Aurore${SATURDAY}en ondes`)
      expect(draft()[3]).toBe('4 GaïaGUEST MIXES, dim. 2 août 2026à suivre')
    })

    it('offers the sets that can be added, the most recent session first, then those taken out, whatever they are, and searches them', async () => {
      await modify()
      fireEvent.click(picker())
      expect(options()).toEqual([`Set de Fréquence Boréale${SATURDAY}`, 'Set de GaïaGUEST MIXES, dim. 2 août 2026'])
      fireEvent.keyDown(picker(), { key: 'Escape' })

      fireEvent.click(screen.getByRole('button', { name: /^retirer Set de Kwame/ }))
      pick('Set de Fréquence')
      fireEvent.click(picker())
      expect(options()).toEqual(['Set de GaïaGUEST MIXES, dim. 2 août 2026', `Set de Kwame${SATURDAY}`])
      fireEvent.keyDown(picker(), { key: 'Escape' })

      // By performer, session title or day, whatever the case and the accents.
      search('gaia')
      expect(options()).toEqual(['Set de GaïaGUEST MIXES, dim. 2 août 2026'])
      search('haute rive')
      expect(options()).toEqual([`Set de Kwame${SATURDAY}`])
      search('2 août')
      expect(options()).toEqual(['Set de GaïaGUEST MIXES, dim. 2 août 2026'])
      search('samedi')
      expect(options()).toEqual([`Set de Kwame${SATURDAY}`])

      // Kwame's set, though skipped, goes back in, with why.
      fireEvent.mouseDown(screen.getByRole('option', { name: /^Set de Kwame/ }))
      expect(draft().at(-1)).toBe(`5 Kwame${SATURDAY}Pas diffusé : seul un extrait de 30 secondes de la piste peut être joué.`)
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
      expect(draft()[1]).toMatch(/à suivre$/)
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      expect(confirmation()).toEqual(['Le set de Aurore passera tout de suite en ondes, à la place du set de Brume et Cyan.'])

      // A set added, which counts as one that can be played.
      fireEvent.click(screen.getByRole('button', { name: 'revenir' }))
      pick('Set de Fréquence')
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Fréquence/ }), -4)
      expect(draft()[0]).toBe(`1 Fréquence Boréale${SATURDAY}en ondes`)
      fireEvent.click(screen.getByRole('button', { name: 'enregistrer' }))
      expect(confirmation()).toEqual(['Le set de Fréquence Boréale passera tout de suite en ondes, à la place du set de Brume et Cyan.'])
    })

    it('goes by the first set that can be played, which can be the one on air', async () => {
      await modify()
      await moveWithKeyboard(screen.getByRole('button', { name: /^réordonner Set de Kwame/ }), -3)
      expect(draft().map(performersOf)).toEqual(['1 Kwame', '2 Brume, Cyan', '3 Écume', '4 Aurore'])
      expect(draft()[1]).toMatch(/en ondes$/)
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
      expect(rows().map(performersOf)).toEqual(['23 h 00Brume, Cyanen cours', 'vendredi 2 octobre', '00 h 05Aurore', 'Kwame', '00 h 35Fréquence Boréale'])
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
      expect(rows().map(performersOf)).toEqual(['23 h 00Brume, Cyanen cours', 'vendredi 2 octobre', '00 h 35Aurore', 'Kwame'])
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
