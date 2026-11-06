import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { BoundFunctions, queries } from '@testing-library/react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { GENRES, PHOTO_MAX_BYTES } from '../artist-profile'
import { CONFIG, requestsTo } from '../test-utils'
import { ConfigContext } from '../config-context'
import type { ConfigState } from '../config-context'
import { Appliquer } from './appliquer'
import { GENRE_GROUPS } from './appliquer/choices'
import type { TurnstileApi } from './appliquer/turnstile'

const fetchMock = vi.fn()

const GEONAMES = 'https://secure.geonames.org/searchJSON?'

// What GeoNames answers, trimmed to the fields the form reads.
const geonamesResults = {
  geonames: [
    { geonameId: 6325521, name: 'Levis', toponymName: 'Lévis', fcode: 'PPL', adminName1: 'Québec', adminCodes1: { ISO3166_2: 'QC' } },
    { geonameId: 1, name: 'Levis 01', toponymName: 'Lévis 01', fcode: 'PPLX', adminName1: 'Québec', adminCodes1: { ISO3166_2: 'QC' } },
  ],
}

// Cloudflare's test site key, and the token its first widget gives, then the one the widgets after it give.
const SITE_KEY = '1x00000000000000000000AA'
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const NEXT_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX.2'

// Stands in for Turnstile's script, which vouches for the artist right away unless told otherwise.
const turnstile = {
  vouches: true,
  callbacks: null as Parameters<TurnstileApi['render']>[1] | null,
  render: vi.fn<TurnstileApi['render']>(),
  remove: vi.fn<TurnstileApi['remove']>(),
}

const LOADED: ConfigState = { kind: 'loaded', config: { ...CONFIG, turnstileSiteKey: SITE_KEY } }

function page(state: ConfigState) {
  return (
    <ConfigContext value={state}>
      <Appliquer />
    </ConfigContext>
  )
}

// Once the configuration has been fetched, unless told otherwise.
function renderForm(state: ConfigState = LOADED) {
  return render(page(state))
}

// The applications that were sent, oldest first.
const applications = () => requestsTo('POST', '/api/applications')

// GeoNames gets URLs, and the server gets `Request`s, from the typed client.
const isGeonames = (input: string | Request): input is string => typeof input === 'string' && input.startsWith(GEONAMES)

// The calls to GeoNames, by their URLs.
const geonamesCalls = () => fetchMock.mock.calls.map(([input]) => input).filter(isGeonames)

// What the server and GeoNames answer, unless a test says otherwise: GeoNames finds Lévis, and the server takes the
// application.
function answer(input: string | Request) {
  if (isGeonames(input)) return Promise.resolve(Response.json(geonamesResults))
  if (input instanceof Request && new URL(input.url).pathname === '/api/applications') return Promise.resolve(Response.json({ ok: true }))
  throw new Error(`Unexpected fetch to ${typeof input === 'string' ? input : input.url}`)
}

// The server refuses the application with `error`.
const refused = (error: string, status = 400) => Promise.resolve(Response.json({ ok: false, error }, { status }))

// The parts of the last application that was sent.
function sentParts() {
  const body = applications().at(-1)!.body as FormData
  return {
    artist: JSON.parse(body.get('artist') as string),
    application: JSON.parse(body.get('application') as string),
    photo: body.get('photo') as File | null,
    memberPhotos: body.getAll('memberPhoto') as File[],
    turnstileToken: body.get('turnstileToken'),
  }
}

async function send() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'envoyer ma candidature' }))
  })
}

beforeEach(() => {
  turnstile.vouches = true
  turnstile.render.mockReset().mockImplementation((_container, options) => {
    turnstile.callbacks = options
    if (turnstile.vouches) options.callback(turnstile.render.mock.calls.length === 1 ? TOKEN : NEXT_TOKEN)
    return 'widget'
  })
  turnstile.remove.mockReset()
  window.turnstile = turnstile
  // Rather than mockFetch's, which setupTests.ts calls, but whose `Request` still keeps the FormData each request is made
  // with (see requestsTo).
  fetchMock.mockReset()
  fetchMock.mockImplementation(answer)
  vi.stubGlobal('fetch', fetchMock)
  // jsdom has neither, and the form uses both.
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

// The calendar's days, e.g. "ven 4 décembre 2026". `\p{L}` rather than `\w`, which doesn't match accented
// letters, so that the days of février, août and décembre are found too.
const CALENDAR_DAY = /^\w{3} \d+ \p{L}+ \d{4}$/u

type Queries = BoundFunctions<typeof queries>

// The part of the form with this title, to look for its fields in. A query over the whole form takes tens of milliseconds
// in jsdom, which goes through the whole page for the labels and styles of each of its many buttons (genres, days).
function part(title: string): Queries {
  return within(screen.getByRole('heading', { level: 2, name: title }).closest('section')!)
}

// Types `value` in a text field.
function type(label: string | RegExp, value: string, scope: Queries = screen) {
  fireEvent.change(scope.getByRole('textbox', { name: label }), { target: { value } })
}

// Types in a search field, then picks an option from its list (which may take a request to show up).
//
// The city's suggestions are only searched once the artist stops typing: rather than wait for that, the timer that
// searches is run right away, whatever its delay. Real timers come back before looking for the option, whose polling
// uses them. Coming back to real timers also stops faking the date, so this can't be used once the date is faked.
async function pick(label: RegExp, query: string, option: RegExp, scope: Queries = screen) {
  const input = scope.getByRole('combobox', { name: label })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: query } })
    await act(() => vi.runOnlyPendingTimersAsync())
  } finally {
    vi.useRealTimers()
  }
  fireEvent.mouseDown(await scope.findByRole('option', { name: option }))
}

// Picks Lévis from GeoNames' suggestions, unless given a city to type instead.
async function fillIn({ city }: { city?: string } = {}) {
  const artist = part("L'artiste")
  fireEvent.click(artist.getByRole('radio', { name: /^Artiste/ }))
  type(/Nom d'artiste/, 'DJ Test', artist)
  await pick(/^Pays/, 'canada', /^Canada/, artist)
  if (city) fireEvent.change(artist.getByRole('combobox', { name: /^Ville/ }), { target: { value: city } })
  else await pick(/^Ville/, 'levis', /^Lévis/, artist)
  fireEvent.click(artist.getByRole('button', { name: 'techno' }))
  const presentation = part('Présentation')
  const photo = new File(['fake'], 'presse.jpg', { type: 'image/jpeg' })
  fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [photo] } })
  type(/^Bio/, 'Une bio.', presentation)
  type('SoundCloud', 'https://soundcloud.com/parkingdotradio/wobbla', presentation)
  fireEvent.click(part('Prestation').getByRole('checkbox', { name: 'DJ' }))
  const contact = part('Contact')
  type(/Adresse e-mail/, 'artiste@example.com', contact)
  type(/Numéro de téléphone/, '418 555-0123', contact)
  const dates = part('Dates')
  fireEvent.click(dates.getAllByRole('button', { name: CALENDAR_DAY }).find((day) => !day.hasAttribute('disabled'))!)
  fireEvent.click(dates.getByRole('checkbox', { name: '18 h – 22 h' }))
  fireEvent.click(dates.getByRole('checkbox', { name: '11 h – 15 h' }))
}

// The profile of the nth artist of the collective, when it's shown, whose legend is "Artiste <n>", followed by their name
// once it's typed.
function memberProfile(n: number) {
  return screen.getByRole('group', { name: new RegExp(`^Artiste ${n}( —|$)`) })
}

// Picks a photo with the file input in `scope`, which only the button that opens it shows.
function pickPhoto(scope: HTMLElement, photo: File) {
  fireEvent.change(scope.querySelector('input[type=file]')!, { target: { files: [photo] } })
}

// A JPEG photo just over the size limit, which only claims to be that large, since only its size is checked.
function tooLarge(name: string) {
  const photo = new File(['fake'], name, { type: 'image/jpeg' })
  Object.defineProperty(photo, 'size', { value: PHOTO_MAX_BYTES + 1 })
  return photo
}

// Fills the profile of the nth artist of the collective, which is shown.
async function fillInMember(n: number, name: string, { photo }: { photo?: File } = {}) {
  const element = memberProfile(n)
  const profile = within(element)
  type(/Nom d'artiste/, name, profile)
  await pick(/^Pays/, 'france', /^France/, profile)
  fireEvent.change(profile.getByRole('combobox', { name: /^Ville/ }), { target: { value: 'Lyon' } })
  fireEvent.click(profile.getByRole('button', { name: 'house' }))
  if (photo) pickPhoto(element, photo)
  type(/^Bio/, `La bio de ${name}.`, profile)
  type('SoundCloud', name.toLowerCase(), profile)
}

// The tabs of the collective's artists, and the buttons that add and take them out.
function memberTabs(): Queries {
  return within(screen.getByRole('group', { name: 'Artistes du collectif' }))
}

// The tab of the nth artist of the collective, with their name and whether their profile is complete.
function memberTab(n: number, state?: string) {
  return memberTabs().getByRole('button', { name: new RegExp(`^Artiste ${n}( — [^,]*)?, ${state ?? ''}`) })
}

function addMember() {
  fireEvent.click(memberTabs().getByRole('button', { name: /ajouter un artiste/ }))
}

// Fills the form as a collective, with its first artist, but not their profile: the rest is filled in like fillIn's.
async function fillInCollective() {
  await fillIn()
  const collective = part("L'artiste")
  fireEvent.click(collective.getByRole('radio', { name: /^Collectif/ }))
  type(/Nom du collectif/, 'Le Collectif', collective)
  type(/^Description/, 'Une description.')
}

describe('Appliquer', () => {
  it('shows the form before the configuration has been fetched, and Turnstile once it has', () => {
    const { rerender } = renderForm({ kind: 'loading' })
    expect(screen.getByRole('heading', { name: 'Appliquer' })).toBeInTheDocument()
    expect(turnstile.render).not.toHaveBeenCalled()

    rerender(page(LOADED))
    expect(turnstile.render).toHaveBeenCalledOnce()
    expect(turnstile.render.mock.calls[0][1]).toMatchObject({ sitekey: SITE_KEY })
  })

  it("can't send the application when the configuration can't be fetched, since Turnstile needs it", async () => {
    renderForm({ kind: 'failed' })
    await fillIn()
    await send()

    expect(turnstile.render).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Le formulaire ne peut pas être envoyé pour le moment. Rechargez la page.')
    expect(applications()).toEqual([])
  })

  it('shows what is missing when sending an empty form, without sending it', async () => {
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'envoyer ma candidature' }))

    // The photo is optional.
    expect(await screen.findByRole('alert')).toHaveTextContent('11 champs sont à remplir ou à corriger.')
    expect(screen.getByLabelText(/^Photo/)).not.toHaveAttribute('aria-invalid')
    expect(screen.getByText('Choisissez au moins une date.')).toBeInTheDocument()
    expect(screen.getByText('Choisissez au moins un type de prestation.')).toBeInTheDocument()
    // Which admins can leave out, but artists can't.
    for (const missing of ['Choisissez le pays.', 'Indiquez la ville.', 'Choisissez au moins un genre.', 'Ajoutez au moins un lien.', 'Indiquez votre numéro de téléphone.']) {
      expect(screen.getByText(missing)).toBeInTheDocument()
    }
    expect(applications()).toEqual([])
  })

  it('asks for a profile photo of the artist, or of the collective and of each of its artists', () => {
    renderForm()
    expect(part('Présentation').getByLabelText("Photo de profil — une photo de presse de l'artiste, en bonne qualité")).toBeInTheDocument()

    fireEvent.click(part("L'artiste").getByRole('radio', { name: /^Collectif/ }))
    expect(part('Présentation').getByLabelText('Photo de profil — une photo de presse du collectif, en bonne qualité')).toBeInTheDocument()
    expect(within(memberProfile(1)).getByLabelText("Photo de profil — une photo de presse de l'artiste, en bonne qualité")).toBeInTheDocument()
  })

  it('sends the profile and the application with the photo, then thanks the artist', async () => {
    renderForm()
    await fillIn()
    await send()

    expect(await screen.findByText('Candidature envoyée')).toBeInTheDocument()
    expect(screen.getByText('artiste@example.com')).toBeInTheDocument()
    expect(
      screen.getByText(
        "En raison d'un volume élevé de candidatures, le traitement des demandes peut prendre jusqu'à un mois. Seuls les artistes et " +
          "collectifs retenus seront contactés par courriel. Si vous n'avez reçu aucune réponse dans les trois mois suivant votre " +
          "candidature, n'hésitez pas à postuler de nouveau. Nous ferons notre possible pour vous trouver une place dans notre programmation.",
      ),
    ).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByText('Candidature envoyée').closest('section'))

    const { artist, application, photo, turnstileToken } = sentParts()
    expect(photo?.name).toBe('presse.jpg')
    expect(turnstileToken).toBe(TOKEN)
    expect(artist).toEqual({
      kind: 'artist',
      name: 'DJ Test',
      country: 'CA',
      // Only the city's name.
      city: 'Lévis',
      genres: ['techno'],
      bio: 'Une bio.',
      links: { soundcloud: 'parkingdotradio' },
      email: 'artiste@example.com',
      phone: '418 555-0123',
    })
    expect(application).toEqual({
      dates: [expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)],
      // As the times they start and end, in order.
      timeSlots: [
        { start: '11:00', end: '15:00' },
        { start: '18:00', end: '22:00' },
      ],
      performanceTypes: ['dj'],
      otherPerformanceType: '',
      details: '',
    })
  })

  it('sends the performance types by their ids, in the order of the list, and the other one', async () => {
    renderForm()
    await fillIn()
    const performanceType = part('Prestation')
    fireEvent.click(performanceType.getByLabelText('Full Band'))
    fireEvent.click(performanceType.getByLabelText('Performance Live'))
    fireEvent.click(performanceType.getByLabelText('Autre'))
    type('Autre type de prestation', ' Synthé modulaire ', performanceType)
    await send()

    expect(sentParts().application).toMatchObject({ performanceTypes: ['dj', 'live-performance', 'full-band'], otherPerformanceType: 'Synthé modulaire' })
  })

  it('takes "Autre" alone, once it says what it is', async () => {
    renderForm()
    await fillIn()
    const performanceType = part('Prestation')
    fireEvent.click(performanceType.getByLabelText('DJ'))
    fireEvent.click(performanceType.getByLabelText('Autre'))
    await send()
    expect(performanceType.getByText('Précisez votre autre type de prestation.')).toBeInTheDocument()
    expect(applications()).toEqual([])

    type('Autre type de prestation', 'B2B', performanceType)
    await send()
    expect(sentParts().application).toMatchObject({ performanceTypes: [], otherPerformanceType: 'B2B' })
  })

  it("renders Turnstile with the site key from the server's configuration, in French, only shown when it's needed", () => {
    renderForm()
    expect(turnstile.render).toHaveBeenCalledOnce()
    expect(turnstile.render.mock.calls[0][1]).toMatchObject({ sitekey: SITE_KEY, language: 'fr', appearance: 'interaction-only' })
  })

  it("doesn't send the application until Turnstile vouches for the artist", async () => {
    turnstile.vouches = false
    renderForm()
    await fillIn()
    await send()

    expect(await screen.findByRole('alert')).toHaveTextContent("La vérification anti-robot n'est pas terminée.")
    expect(applications()).toEqual([])

    act(() => turnstile.callbacks!.callback(TOKEN))
    await send()
    expect(await screen.findByText('Candidature envoyée')).toBeInTheDocument()
  })

  it("doesn't send a token that expired", async () => {
    renderForm()
    await fillIn()
    act(() => turnstile.callbacks!['expired-callback']())
    await send()

    expect(await screen.findByRole('alert')).toHaveTextContent("La vérification anti-robot n'est pas terminée.")
    expect(applications()).toEqual([])
  })

  it('gets a new token from Turnstile once an application is refused, since a token can only be checked once', async () => {
    renderForm()
    await fillIn()
    fetchMock.mockImplementationOnce(() => refused('La vérification anti-robot a échoué. Réessayez.'))
    await send()
    expect(await screen.findByRole('alert')).toHaveTextContent('La vérification anti-robot a échoué. Réessayez.')
    expect(turnstile.remove).toHaveBeenCalledWith('widget')
    expect(turnstile.render).toHaveBeenCalledTimes(2)

    await send()
    expect(await screen.findByText('Candidature envoyée')).toBeInTheDocument()
    expect(applications().map((init) => (init.body as FormData).get('turnstileToken'))).toEqual([
      TOKEN,
      NEXT_TOKEN,
    ])
  })

  it("asks a collective for its own profile and each of its artists', with their photos, then sends them", async () => {
    renderForm()
    expect(screen.queryByText(/nous demandons aux collectifs de produire un flyer/)).not.toBeInTheDocument()
    await fillInCollective()
    const collective = part('Le collectif')
    expect(collective.getByRole('radio', { name: /^Collectif/ })).toHaveAccessibleName(expect.stringContaining("plage d'environ 4 h"))
    expect(collective.getByText(/nous demandons aux collectifs de produire un flyer/)).toBeInTheDocument()
    // Its genres are its artists'.
    const genres = collective.getAllByRole('group', { name: /^Genres musicaux/ })
    expect(genres).toHaveLength(1)
    expect(memberProfile(1)).toContainElement(genres[0])
    expect(part('Contact').getByText(/La personne-contact du collectif/)).toBeInTheDocument()
    expect(part('Prestation')).toBeTruthy()

    await fillInMember(1, 'Une')
    fireEvent.click(memberTabs().getByRole('button', { name: '+ ajouter un artiste (1 / 4)' }))
    const photo = new File(['deux'], 'deux.png', { type: 'image/png' })
    await fillInMember(2, 'Deux', { photo })
    await send()

    expect(await screen.findByText('Candidature envoyée')).toBeInTheDocument()
    const { artist, photo: collectivePhoto, memberPhotos } = sentParts()
    const member = (name: string) => ({ name, country: 'FR', city: 'Lyon', genres: ['house'], bio: `La bio de ${name}.`, links: { soundcloud: name.toLowerCase() } })
    expect(artist).toEqual({
      kind: 'collective',
      name: 'Le Collectif',
      country: 'CA',
      city: 'Lévis',
      description: 'Une description.',
      links: { soundcloud: 'parkingdotradio' },
      email: 'artiste@example.com',
      phone: '418 555-0123',
      members: [member('Une'), member('Deux')],
    })
    expect(collectivePhoto?.name).toBe('presse.jpg')
    // A part for each artist, an empty one for an artist without a photo.
    expect(memberPhotos.map((sent) => sent.size)).toEqual([0, photo.size])
    expect(memberPhotos[1].name).toBe('deux.png')
  })

  it('sends no photos of artists for a collective that has none, or once it applies as an artist again', async () => {
    renderForm()
    await fillInCollective()
    await fillInMember(1, 'Une', { photo: new File(['une'], 'une.png', { type: 'image/png' }) })
    fireEvent.click(part('Le collectif').getByRole('radio', { name: /^Artiste/ }))
    await send()
    expect(sentParts().artist).toMatchObject({
      kind: 'artist',
      name: 'Le Collectif',
      country: 'CA',
      city: 'Lévis',
      genres: ['techno'],
      bio: 'Une description.',
    })
    expect(sentParts().memberPhotos).toEqual([])
  })

  it('has 1 to 4 artists, as tabs that say whether their profile is complete, and focuses the profile of one added', async () => {
    renderForm()
    await fillInCollective()
    expect(memberTab(1, 'à compléter')).toHaveAttribute('aria-current', 'true')
    // There's always one.
    expect(memberTabs().queryByRole('button', { name: /^Enlever/ })).not.toBeInTheDocument()

    await fillInMember(1, 'Une')
    expect(memberTab(1, 'complet')).toHaveAccessibleName('Artiste 1 — Une, complet')
    for (let n = 2; n <= 4; ++n) {
      fireEvent.click(memberTabs().getByRole('button', { name: `+ ajouter un artiste (${n - 1} / 4)` }))
      expect(memberTab(n, 'à compléter')).toHaveAttribute('aria-current', 'true')
      expect(within(memberProfile(n)).getByRole('textbox', { name: /Nom d'artiste/ })).toHaveFocus()
    }
    expect(memberTabs().queryByRole('button', { name: /ajouter un artiste/ })).not.toBeInTheDocument()
    // Only the profile of the artist selected shows.
    expect(screen.getAllByRole('group', { name: /^Artiste \d/ })).toHaveLength(1)
    fireEvent.click(memberTab(1))
    expect(memberProfile(1)).toBeVisible()
    expect(within(memberProfile(1)).getByRole('textbox', { name: /Nom d'artiste/ })).toHaveValue('Une')
  })

  it('takes out an artist, after confirming once their profile has something, and keeps each photo with its artist', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    onTestFinished(() => confirm.mockRestore())
    renderForm()
    await fillInCollective()
    const photos = ['une', 'deux', 'trois'].map((name) => new File([name], `${name}.png`, { type: 'image/png' }))
    await fillInMember(1, 'Une', { photo: photos[0] })
    addMember()
    await fillInMember(2, 'Deux', { photo: photos[1] })
    addMember()
    await fillInMember(3, 'Trois', { photo: photos[2] })
    // An empty one goes without asking.
    addMember()
    fireEvent.click(memberTabs().getByRole('button', { name: 'Enlever Artiste 4 du collectif' }))
    expect(confirm).not.toHaveBeenCalled()
    // The one before the last one, which was selected, is selected, and focused.
    expect(memberTab(3)).toHaveFocus()

    fireEvent.click(memberTab(2))
    fireEvent.click(memberTabs().getByRole('button', { name: 'Enlever Artiste 2 — Deux du collectif' }))
    expect(confirm).toHaveBeenCalledWith('Enlever Artiste 2 — Deux du collectif ? Sa fiche sera effacée.')
    // The one after it takes its place.
    expect(memberTab(2)).toHaveAccessibleName('Artiste 2 — Trois, complet')
    expect(memberTab(2)).toHaveFocus()
    await send()

    expect(sentParts().artist.members.map((member: { name: string }) => member.name)).toEqual(['Une', 'Trois'])
    expect(sentParts().memberPhotos.map((photo) => photo.name)).toEqual(['une.png', 'trois.png'])
  })

  it('keeps the artist selected when one before them is taken out', async () => {
    renderForm()
    await fillInCollective()
    addMember()
    addMember()
    type(/Nom d'artiste/, 'Trois', within(memberProfile(3)))
    // The first one is empty, so it goes without asking.
    fireEvent.click(memberTabs().getByRole('button', { name: 'Enlever Artiste 1 du collectif' }))
    expect(memberTab(2)).toHaveAccessibleName('Artiste 2 — Trois, à compléter')
    expect(memberTab(2)).toHaveAttribute('aria-current', 'true')
    expect(memberTab(2)).toHaveFocus()
    expect(within(memberProfile(2)).getByRole('textbox', { name: /Nom d'artiste/ })).toHaveValue('Trois')
  })

  it("keeps what an artist's profile shows while another one is shown", async () => {
    renderForm()
    await fillInCollective()
    fireEvent.click(within(memberProfile(1)).getByRole('button', { name: '+ Mixcloud' }))
    addMember()
    fireEvent.click(memberTab(1))
    expect(within(memberProfile(1)).getByRole('textbox', { name: 'Mixcloud' })).toBeInTheDocument()
  })

  it("asks for an artist's profile in the same neutral words, whether they apply alone or with a collective", async () => {
    // What a profile's fields say to fill them in: their placeholders and hints.
    const prompts = (elements: HTMLElement[]) =>
      elements.flatMap((element) =>
        [...element.querySelectorAll('[placeholder], .hint, .placeholder')].map((prompt) => prompt.getAttribute('placeholder') ?? prompt.textContent),
      )
    renderForm()
    const artist = part("L'artiste")
    fireEvent.click(artist.getByRole('radio', { name: /^Artiste/ }))
    await pick(/^Pays/, 'canada', /^Canada/, artist)
    const alone = prompts(["L'artiste", 'Présentation'].map((title) => screen.getByRole('heading', { level: 2, name: title }).closest('section')!))
    expect(alone).toEqual(
      expect.arrayContaining([
        'nom de la ville',
        "— jusqu'à 3, dans l'ordre : le premier est le genre principal",
        'cliquez sur un genre ci-dessous · le premier choisi sera le genre principal',
        "Quelques lignes sur l'artiste ou le projet.",
      ]),
    )
    for (const prompt of alone) expect(prompt).not.toMatch(/\b(vous|votre|vos|son|sa|ses)\b/i)

    fireEvent.click(artist.getByRole('radio', { name: /^Collectif/ }))
    await pick(/^Pays/, 'france', /^France/, within(memberProfile(1)))
    expect(prompts([memberProfile(1)])).toEqual(alone)
  })

  it('says when the collective has no description', async () => {
    renderForm()
    fireEvent.click(part("L'artiste").getByRole('radio', { name: /^Collectif/ }))
    await send()
    const description = part('Présentation').getByRole('textbox', { name: /^Description/ })
    expect(description).toHaveAttribute('aria-invalid', 'true')
    expect(part('Présentation').getByText('Écrivez quelques lignes de description.')).toBeInTheDocument()
  })

  it("shows what is wrong in each artist's profile, bringing the artist to the first one", async () => {
    renderForm()
    await fillInCollective()
    await fillInMember(1, 'Une')
    addMember()
    addMember()
    type(/Nom d'artiste/, 'Trois', within(memberProfile(3)))
    fireEvent.click(memberTab(1))
    await send()

    // Each field to fix in their profiles counts.
    expect(await screen.findByRole('alert')).toHaveTextContent('11 champs sont à remplir ou à corriger.')
    expect(memberTab(1, 'complet')).toBeInTheDocument()
    expect(memberTab(3, 'à corriger')).toBeInTheDocument()
    // The second artist's profile is shown, with what's wrong in it, and the first field to fix has the focus.
    expect(memberTab(2, 'à corriger')).toHaveAttribute('aria-current', 'true')
    const profile = within(memberProfile(2))
    expect(profile.getByRole('textbox', { name: /Nom d'artiste/ })).toHaveFocus()
    for (const error of ["Indiquez le nom d'artiste.", 'Choisissez le pays.', 'Indiquez la ville.', 'Choisissez au moins un genre.', 'Écrivez quelques lignes de bio.']) {
      expect(profile.getByText(error)).toBeInTheDocument()
    }
    expect(applications()).toEqual([])
  })

  it("shows what is wrong in the profile of an artist added after the form was sent only once it's sent with them", async () => {
    renderForm()
    await fillInCollective()
    await fillInMember(1, 'Une')
    type(/Adresse e-mail/, '', part('Contact'))
    await send()
    expect(await screen.findByRole('alert')).toHaveTextContent('Il manque un champ obligatoire ou un champ est à corriger.')

    addMember()
    expect(memberTab(2, 'à compléter')).toHaveAttribute('aria-current', 'true')
    expect(memberProfile(2).querySelector('[aria-invalid="true"]')).toBeNull()
    expect(within(memberProfile(2)).queryByText("Indiquez le nom d'artiste.")).not.toBeInTheDocument()
    // Their errors don't count yet either.
    expect(screen.getByRole('alert')).toHaveTextContent('Il manque un champ obligatoire ou un champ est à corriger.')

    await send()
    expect(screen.getByRole('alert')).toHaveTextContent('7 champs sont à remplir ou à corriger.')
    expect(memberTab(2, 'à corriger')).toHaveAttribute('aria-current', 'true')
    const profile = within(memberProfile(2))
    expect(profile.getByRole('textbox', { name: /Nom d'artiste/ })).toHaveFocus()
    expect(profile.getByText("Indiquez le nom d'artiste.")).toBeInTheDocument()
  })

  it('shows no errors in the profile of an artist added in place of one the form was sent with', async () => {
    renderForm()
    await fillInCollective()
    await fillInMember(1, 'Une')
    addMember()
    await send()
    expect(memberTab(2, 'à corriger')).toBeInTheDocument()

    fireEvent.click(memberTabs().getByRole('button', { name: 'Enlever Artiste 2 du collectif' }))
    addMember()
    expect(memberTab(2, 'à compléter')).toHaveAttribute('aria-current', 'true')
    expect(memberProfile(2).querySelector('[aria-invalid="true"]')).toBeNull()
  })

  it('shows no errors in the profile of the first artist of a collective once the form was sent as an artist', async () => {
    renderForm()
    fireEvent.click(part("L'artiste").getByRole('radio', { name: /^Artiste/ }))
    await send()
    fireEvent.click(part("L'artiste").getByRole('radio', { name: /^Collectif/ }))
    expect(memberTab(1, 'à compléter')).toBeInTheDocument()
    expect(memberProfile(1).querySelector('[aria-invalid="true"]')).toBeNull()
  })

  it("shows the server's error about one of the artists", async () => {
    renderForm()
    await fillInCollective()
    await fillInMember(1, 'Une')
    fetchMock.mockImplementationOnce(() => refused('Artiste 1 : Indiquez la ville.'))
    await send()
    expect(await screen.findByRole('alert')).toHaveTextContent('Artiste 1 : Indiquez la ville.')
  })

  it('finds countries whatever their accents, case, hyphens and apostrophes', async () => {
    renderForm()
    const country = screen.getByLabelText(/^Pays/)
    for (const [typed, found] of [
      ['etats unis', /^États-Unis/],
      ['cote d ivoire', /^Côte d’Ivoire/],
      ["Côte-d'Ivoire", /^Côte d’Ivoire/],
      ['guinee bissau', /^Guinée-Bissau/],
    ] as const) {
      fireEvent.change(country, { target: { value: typed } })
      expect(screen.getAllByRole('option')[0]).toHaveAccessibleName(found)
    }
  })

  it("suggests the country's cities from GeoNames", async () => {
    renderForm()
    await pick(/^Pays/, 'canada', /^Canada/)
    const city = screen.getByLabelText(/^Ville/)
    fireEvent.change(city, { target: { value: 'levis' } })

    const options = await screen.findAllByRole('option')
    // Parts of a city aren't suggested.
    expect(options.map((option) => option.textContent)).toEqual(['LévisQC'])
    const [url] = geonamesCalls()
    expect(Object.fromEntries(new URL(url).searchParams)).toMatchObject({ name_startsWith: 'levis', country: 'CA', username: 'parkingradio' })

    // A single letter doesn't search.
    fetchMock.mockClear()
    fireEvent.change(city, { target: { value: 'l' } })
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('opens the city suggestions again with the arrow keys', async () => {
    renderForm()
    await pick(/^Pays/, 'canada', /^Canada/)
    const city = screen.getByLabelText(/^Ville/)
    fireEvent.change(city, { target: { value: 'levis' } })
    await screen.findAllByRole('option')
    fireEvent.keyDown(city, { key: 'Escape' })
    expect(city).toHaveAttribute('aria-expanded', 'false')

    fireEvent.keyDown(city, { key: 'ArrowDown' })
    expect(city).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['LévisQC'])
  })

  it('goes through the city suggestions from either end with the arrow keys', async () => {
    const cities = ['Lévis', 'Lévisville', 'Lévis-Est'].map((name, i) => ({ geonameId: i + 1, name, toponymName: name, fcode: 'PPL' }))
    fetchMock.mockImplementation((input: string | Request) =>
      isGeonames(input) ? Promise.resolve(Response.json({ geonames: cities })) : answer(input),
    )
    renderForm()
    await pick(/^Pays/, 'canada', /^Canada/)
    const city = screen.getByLabelText(/^Ville/)
    const active = () => document.getElementById(city.getAttribute('aria-activedescendant') ?? '')?.textContent

    fireEvent.change(city, { target: { value: 'levis' } })
    await screen.findAllByRole('option')
    // None is highlighted until the arrow keys are used.
    expect(city).not.toHaveAttribute('aria-activedescendant')
    fireEvent.keyDown(city, { key: 'ArrowUp' })
    expect(active()).toBe('Lévis-Est')

    fireEvent.change(city, { target: { value: 'levi' } })
    await waitFor(() => expect(city).not.toHaveAttribute('aria-activedescendant'))
    await screen.findAllByRole('option')
    fireEvent.keyDown(city, { key: 'ArrowDown' })
    expect(active()).toBe('Lévis')
  })

  it('takes a city the artist types, even when GeoNames is unavailable', async () => {
    fetchMock.mockImplementation((input: string | Request) => {
      if (isGeonames(input)) {
        return Promise.resolve(Response.json({ status: { message: 'the daily limit of 10000 credits has been exceeded', value: 18 } }))
      }
      return answer(input)
    })
    renderForm()
    await fillIn({ city: ' Saint-Glinglin ' })
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)))
    expect(screen.getByLabelText(/^Ville/)).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryAllByRole('option')).toHaveLength(0)

    await send()
    expect(sentParts().artist.city).toBe('Saint-Glinglin')
  })

  it("shows the server's error when the application is refused", async () => {
    renderForm()
    await fillIn()
    fetchMock.mockImplementation((input: string | Request) =>
      input instanceof Request ? refused('Trop de candidatures envoyées depuis votre connexion. Réessayez plus tard.', 429) : Promise.resolve(Response.json({ geonames: [] })),
    )
    await send()

    expect(await screen.findByRole('alert')).toHaveTextContent('Trop de candidatures envoyées depuis votre connexion. Réessayez plus tard.')
  })

  it('says when an artist already has that email address', async () => {
    renderForm()
    await fillIn()
    fetchMock.mockImplementationOnce(() => refused('Un artiste est déjà inscrit avec cette adresse e-mail.', 409))
    await send()
    expect(await screen.findByRole('alert')).toHaveTextContent('Un artiste est déjà inscrit avec cette adresse e-mail.')
    expect(screen.queryByText('Candidature envoyée')).not.toBeInTheDocument()

    // Until the artist changes something.
    type(/Adresse e-mail/, 'autre@example.com')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("says the application couldn't be sent when the answer isn't the server's", async () => {
    renderForm()
    await fillIn()
    // E.g. the proxy in front of the server, refusing a photo that's too large.
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response('<html>413 Request Entity Too Large</html>', { status: 413 })))
    await send()
    expect(await screen.findByRole('alert')).toHaveTextContent("La candidature n'a pas pu être envoyée. Réessayez dans un moment.")
    expect(turnstile.remove).toHaveBeenCalledWith('widget')
    expect(turnstile.render).toHaveBeenCalledTimes(2)
  })

  it("says the application couldn't be sent when the server can't be reached", async () => {
    renderForm()
    await fillIn()
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
    await send()
    expect(await screen.findByRole('alert')).toHaveTextContent("La candidature n'a pas pu être envoyée. Réessayez dans un moment.")
    expect(turnstile.render).toHaveBeenCalledTimes(2)
  })

  it("takes a photo whose type the browser doesn't know, which the server tells from its contents", async () => {
    renderForm()
    await fillIn()
    const photo = new File(['fake'], 'presse.heic', { type: '' })
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [photo] } })
    await send()
    expect(sentParts().photo?.name).toBe('presse.heic')
  })

  it('sends the application without a photo, once the one picked is removed', async () => {
    renderForm()
    await fillIn()
    expect(screen.getByRole('img', { name: 'Aperçu de la photo' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'retirer la photo' }))
    expect(screen.queryByRole('img', { name: 'Aperçu de la photo' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Photo/)).toHaveTextContent('choisir une photo')
    // The button that was clicked is gone, so the focus moves to the one that picks a photo.
    expect(screen.getByLabelText(/^Photo/)).toHaveFocus()
    // So that picking the same file again still counts as a change.
    expect(document.querySelector('input[type=file]')).toHaveValue('')
    await send()

    expect(await screen.findByText('Candidature envoyée')).toBeInTheDocument()
    expect(sentParts().photo).toBeNull()
  })

  it('says right away what is wrong with a photo that is not an image, and sends nothing', async () => {
    renderForm()
    await fillIn()
    pickPhoto(document.body, new File(['gif'], 'presse.gif', { type: 'image/gif' }))
    expect(screen.getByRole('alert')).toHaveTextContent('La photo doit être en JPEG, PNG ou WebP.')

    await send()
    expect(applications()).toEqual([])
  })

  it('says right away that a photo is too large, keeps it until it is changed or removed, and sends nothing', async () => {
    renderForm()
    await fillIn()
    const button = screen.getByLabelText(/^Photo/)
    pickPhoto(document.body, tooLarge('grande.jpg'))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('La photo dépasse 10 Mo.')
    expect(button).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('grande.jpg')).toBeInTheDocument()

    // Another one that's too large is announced again.
    pickPhoto(document.body, tooLarge('encore.jpg'))
    expect(screen.getByRole('alert')).not.toBe(alert)
    expect(screen.getByRole('alert')).toHaveTextContent('La photo dépasse 10 Mo.')

    await send()
    expect(button).toHaveFocus()
    expect(applications()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'retirer la photo' }))
    expect(screen.queryByText('La photo dépasse 10 Mo.')).not.toBeInTheDocument()
    expect(button).not.toHaveAttribute('aria-invalid')
  })

  it('shows only the photo error before the form is sent, even when the rest is empty', () => {
    renderForm()
    pickPhoto(document.body, tooLarge('grande.jpg'))

    expect([...document.querySelectorAll('.error')].map((error) => error.textContent)).toEqual(['La photo dépasse 10 Mo.'])
    expect(screen.queryByText(/champs sont à remplir|Il manque un champ/)).not.toBeInTheDocument()
  })

  it("says right away that a photo of one of a collective's artists is too large", async () => {
    renderForm()
    await fillInCollective()
    await fillInMember(1, 'Une', { photo: tooLarge('une.jpg') })

    expect(within(memberProfile(1)).getByRole('alert')).toHaveTextContent('La photo dépasse 10 Mo.')
    expect(within(memberProfile(1)).getByLabelText(/^Photo/)).toHaveAttribute('aria-invalid', 'true')
  })

  it("doesn't ask GeoNames again for a city that was picked from its suggestions", async () => {
    renderForm()
    await pick(/^Pays/, 'canada', /^Canada/)
    await pick(/^Ville/, 'levis', /^Lévis/)
    expect(screen.getByLabelText(/^Ville/)).toHaveValue('Lévis')
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)))
    expect(geonamesCalls()).toHaveLength(1)
  })

  it('asks GeoNames once for a city typed again', async () => {
    renderForm()
    await pick(/^Pays/, 'canada', /^Canada/)
    const city = screen.getByLabelText(/^Ville/)
    fireEvent.change(city, { target: { value: 'levis' } })
    await screen.findAllByRole('option')
    fireEvent.change(city, { target: { value: 'lev' } })
    fireEvent.change(city, { target: { value: 'Levis ' } })
    await screen.findAllByRole('option')
    expect(geonamesCalls()).toHaveLength(1)
  })

  it('offers every genre, once', () => {
    expect(GENRE_GROUPS.flatMap((group) => group.genres).toSorted()).toEqual(GENRES.toSorted())
  })

  it('lets the artist pick up to 3 genres, numbered in order', () => {
    renderForm()
    for (const genre of ['techno', 'acid', 'ambient']) fireEvent.click(screen.getByRole('button', { name: genre }))

    expect(screen.getByRole('button', { name: 'acid' })).toHaveAttribute('data-rank', '2')
    expect(screen.getByRole('button', { name: 'house' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Enlever techno' }))
    expect(screen.getByRole('button', { name: 'acid' })).toHaveAttribute('data-rank', '1')
    expect(screen.getByRole('button', { name: 'house' })).toBeEnabled()
  })

  it('reduces a pasted address to the profile name, and flags one from the wrong site', () => {
    renderForm()
    const soundcloud = screen.getByLabelText('SoundCloud')
    fireEvent.change(soundcloud, { target: { value: 'https://soundcloud.com/parkingdotradio/wobbla' } })
    fireEvent.blur(soundcloud)
    expect(soundcloud).toHaveValue('parkingdotradio')
    expect(screen.getByRole('link', { name: 'vérifier le lien ↗' })).toHaveAttribute('href', 'https://soundcloud.com/parkingdotradio')

    const instagram = screen.getByLabelText('Instagram')
    fireEvent.change(instagram, { target: { value: 'https://soundcloud.com/foo' } })
    fireEvent.blur(instagram)
    expect(screen.getByText("ce n'est pas une adresse Instagram")).toBeInTheDocument()
  })

  // Pastes `text` in a field, and returns whether it was pasted as is, rather than replaced.
  function paste(field: HTMLElement, text: string): boolean {
    return fireEvent.paste(field, { clipboardData: { getData: () => text } })
  }

  it('brings the artist to the links when there are none', async () => {
    renderForm()
    await fillIn()
    type('SoundCloud', '')
    await send()
    expect(screen.getByText('Ajoutez au moins un lien.')).toBeInTheDocument()
    expect(screen.getByLabelText('SoundCloud')).toHaveFocus()
    expect(applications()).toEqual([])
  })

  it('says once what is wrong with a link, next to it, and to fix the links in red under them', async () => {
    renderForm()
    await fillIn()
    type('SoundCloud', 'https://on.soundcloud.com/AbC123')
    await send()
    expect(screen.getAllByText(/lien court/)).toHaveLength(1)
    expect(screen.getByText('Corrigez les liens en rouge.')).toBeInTheDocument()
    expect(screen.getByLabelText('SoundCloud')).toHaveFocus()
  })

  it('reduces a pasted address to the profile name right away', () => {
    renderForm()
    const soundcloud = screen.getByLabelText('SoundCloud')
    expect(paste(soundcloud, 'https://soundcloud.com/exemple-dj')).toBe(false)
    expect(soundcloud).toHaveValue('exemple-dj')
    expect(screen.getByRole('link', { name: 'vérifier le lien ↗' })).toHaveAttribute('href', 'https://soundcloud.com/exemple-dj')
    expect(screen.getByText('soundcloud.com/')).toBeInTheDocument()

    // Whatever was there before.
    expect(paste(soundcloud, 'soundcloud.com/parkingdotradio/sets/rotation')).toBe(false)
    expect(soundcloud).toHaveValue('parkingdotradio')
  })

  it('reduces what is pasted for every site to what is kept', () => {
    renderForm()
    const fields: [string, string, string][] = [
      ['Instagram', '@parking.radio', 'parking.radio'],
      ['Bandcamp', 'https://exemple.bandcamp.com/album/premier', 'exemple'],
      ['Site web', 'parking.radio/', 'https://parking.radio'],
    ]
    for (const [label, pasted, kept] of fields) {
      paste(screen.getByLabelText(label), pasted)
      expect(screen.getByLabelText(label)).toHaveValue(kept)
    }
    expect(screen.getByText('.bandcamp.com')).toBeInTheDocument()
  })

  it('pastes a profile name as is, which can go anywhere in the field', () => {
    renderForm()
    expect(paste(screen.getByLabelText('SoundCloud'), 'exemple-dj')).toBe(true)
  })

  it("says right away why a pasted address can't be read, and shows it without the site's address around it", () => {
    renderForm()
    const soundcloud = screen.getByLabelText('SoundCloud')
    expect(paste(soundcloud, 'https://on.soundcloud.com/AbC123')).toBe(true)
    // What the browser pastes.
    fireEvent.change(soundcloud, { target: { value: 'https://on.soundcloud.com/AbC123' } })
    expect(screen.getByText(/lien court/)).toBeInTheDocument()
    expect(screen.queryByText('soundcloud.com/')).not.toBeInTheDocument()
  })

  it("shows an address being typed without the site's address around it, until it's reduced", () => {
    renderForm()
    const soundcloud = screen.getByLabelText('SoundCloud')
    fireEvent.change(soundcloud, { target: { value: 'https://soundcloud.com/exemple' } })
    expect(screen.queryByText('soundcloud.com/')).not.toBeInTheDocument()
    fireEvent.blur(soundcloud)
    expect(soundcloud).toHaveValue('exemple')
    expect(screen.getByText('soundcloud.com/')).toBeInTheDocument()
  })

  it('only lets the artist pick dates from 2 months ahead, up to 14 of them', () => {
    // Not the 1st of a month, so that the month the calendar opens on starts with days that are too soon.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-04T12:00:00-04:00'))
    onTestFinished(() => {
      vi.useRealTimers()
    })

    renderForm()
    const days = () => screen.getAllByRole('button', { name: CALENDAR_DAY })
    // The calendar opens on the first month that has dates to pick.
    expect(screen.getByRole('button', { name: 'jeu 3 décembre 2026' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'ven 4 décembre 2026' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Mois suivant' }))
    const available = days().filter((day) => !day.hasAttribute('disabled'))
    for (const day of available.slice(0, 14)) fireEvent.click(day)

    expect(screen.getByText('14 / 14')).toBeInTheDocument()
    expect(screen.getByText(/maximum atteint/)).toBeInTheDocument()
    expect(days().filter((day) => !day.hasAttribute('disabled'))).toHaveLength(14)
  })
})
