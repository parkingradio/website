import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { BoundFunctions, queries } from '@testing-library/react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { GENRES } from '../artist-profile'
import { requestsTo } from '../test-utils'
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

const LOADED: ConfigState = { kind: 'loaded', config: { assetsDomain: 'assets.example.test', turnstileSiteKey: SITE_KEY, features: {} } }

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
    for (const missing of ['Choisissez votre pays.', 'Indiquez votre ville.', 'Choisissez au moins un genre.', 'Ajoutez au moins un lien.', 'Indiquez votre numéro de téléphone.']) {
      expect(screen.getByText(missing)).toBeInTheDocument()
    }
    expect(applications()).toEqual([])
  })

  it('sends the profile and the application with the photo, then thanks the artist', async () => {
    renderForm()
    await fillIn()
    await send()

    expect(await screen.findByText('Candidature envoyée')).toBeInTheDocument()
    expect(screen.getByText('artiste@example.com')).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByText('Candidature envoyée').closest('section'))

    const { artist, application, photo, turnstileToken } = sentParts()
    expect(photo?.name).toBe('presse.jpg')
    expect(turnstileToken).toBe(TOKEN)
    expect(artist).toEqual({
      kind: 'artist',
      name: 'DJ Test',
      members: [],
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
      prestations: ['dj'],
      otherPrestation: '',
      details: '',
    })
  })

  it('sends the prestations by their ids, in the order of the list, and the other one', async () => {
    renderForm()
    await fillIn()
    fireEvent.click(screen.getByLabelText('Full Band'))
    fireEvent.click(screen.getByLabelText('Performance Live'))
    fireEvent.click(screen.getByLabelText('Autre'))
    type('Autre type de prestation', ' Synthé modulaire ')
    await send()

    expect(sentParts().application).toMatchObject({ prestations: ['dj', 'live-performance', 'full-band'], otherPrestation: 'Synthé modulaire' })
  })

  it('takes "Autre" alone, once it says what it is', async () => {
    renderForm()
    await fillIn()
    fireEvent.click(screen.getByLabelText('DJ'))
    fireEvent.click(screen.getByLabelText('Autre'))
    await send()
    expect(screen.getByText('Précisez votre autre type de prestation.')).toBeInTheDocument()
    expect(applications()).toEqual([])

    type('Autre type de prestation', 'B2B')
    await send()
    expect(sentParts().application).toMatchObject({ prestations: [], otherPrestation: 'B2B' })
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

  it('asks a collective for its artists, up to 4, and tells it about the flyer', async () => {
    renderForm()
    const artist = part("L'artiste")
    expect(screen.queryByText(/nous demandons aux collectifs de produire un flyer/)).not.toBeInTheDocument()
    const collective = artist.getByRole('radio', { name: /^Collectif/ })
    fireEvent.click(collective)
    expect(collective).toHaveAccessibleName(expect.stringContaining("plage d'environ 4 h"))
    expect(artist.getByRole('textbox', { name: /Nom du collectif/ })).toBeInTheDocument()
    expect(artist.getByText(/nous demandons aux collectifs de produire un flyer/)).toBeInTheDocument()

    type('Artiste 1 du collectif', 'Zefra', artist)
    for (let i = 0; i < 3; ++i) fireEvent.click(artist.getByRole('button', { name: /ajouter un artiste/ }))
    expect(artist.queryByRole('button', { name: /ajouter un artiste/ })).not.toBeInTheDocument()
    type('Artiste 3 du collectif', 'Mlle Zed', artist)
    fireEvent.click(artist.getByRole('button', { name: "Enlever l'artiste 2" }))

    await fillIn()
    // fillIn() picks "Artiste": go back to the collective, whose artists are kept.
    fireEvent.click(collective)
    await send()
    expect(sentParts().artist).toMatchObject({ kind: 'collective', name: 'DJ Test', members: ['Zefra', 'Mlle Zed'] })
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
    expect(screen.getByRole('img', { name: 'Aperçu de votre photo' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'retirer la photo' }))
    expect(screen.queryByRole('img', { name: 'Aperçu de votre photo' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Photo/)).toHaveTextContent('choisir une photo')
    // The button that was clicked is gone, so the focus moves to the one that picks a photo.
    expect(screen.getByLabelText(/^Photo/)).toHaveFocus()
    // So that picking the same file again still counts as a change.
    expect(document.querySelector('input[type=file]')).toHaveValue('')
    await send()

    expect(await screen.findByText('Candidature envoyée')).toBeInTheDocument()
    expect(sentParts().photo).toBeNull()
  })

  it('says what is wrong with a photo that is not an image, and sends nothing', async () => {
    renderForm()
    await fillIn()
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [new File(['gif'], 'presse.gif', { type: 'image/gif' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'envoyer ma candidature' }))

    expect(await screen.findByText('La photo doit être en JPEG, PNG ou WebP.')).toBeInTheDocument()
    expect(applications()).toEqual([])
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
