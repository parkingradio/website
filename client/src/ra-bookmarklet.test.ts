// @vitest-environment-options {"url": "https://ra.co/pro/event/create"}
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SCRIPT from '../public/ra-bookmarklet.js?raw'

// The bookmarklet's script (see docs/design/client/admin/publier-sur-ra.md), run as RA's page would run it, with the site
// and RA answering as these tests say: nothing is ever sent to either.

const SITE = 'https://parking.radio'
const TOKEN = 'the.publication.token'

// The event, as the site gives it, which the bookmarklet sends to RA as it is.
const EVENT_INPUT = {
  title: 'GUEST MIXES',
  startTime: '2026-11-20T21:00:00.000',
  endTime: '2026-11-21T01:00:00.000',
  lineup: 'Aurore\nBrume',
  venueId: '288529',
  promoterIds: ['183980'],
  content: 'LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC',
  promotionalLinks: [
    { title: 'parking.radio', url: 'https://parking.radio' },
    { title: 'instagram', url: 'https://www.instagram.com/parking.radio' },
  ],
  playerLinks: [{ sourceId: 'https://www.youtube.com/@parkingdotradio' }, { sourceId: 'https://soundcloud.com/parkingdotradio' }],
  submissionSource: 'SUBMITEVENTPAGE',
}

const PUBLICATION = { ok: true, environment: 'production', session: 'session-1', hasFlyer: false, event: EVENT_INPUT }

// The session's flyer, as the site gives it: a JPEG, which these tests never read.
const FLYER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const jpeg = () => new Response(FLYER, { headers: { 'Content-Type': 'image/jpeg' } })
const UPLOADER = 'https://image-uploader.ra.co/upload'
const FILENAME = 'https://images.ra.co/0123456789abcdef.jpg'

const field = (name: string, kind = 'SCALAR', defaultValue: string | null = null) => ({ name, defaultValue, type: { kind } })
// What RA says of itself when nothing changed: it takes every field sent, and others, some required but with a default.
const FIELDS = [...Object.keys(EVENT_INPUT).map((name) => field(name)), field('images', 'LIST'), field('ticketed', 'NON_NULL', 'false')]
// And of an event's images, which it only asks about when it sends the flyer.
const IMAGE_FIELDS = [field('id'), field('filename', 'NON_NULL'), field('alt'), field('crop', 'INPUT_OBJECT'), field('type', 'ENUM')]
function checks(changes: object = {}) {
  return {
    data: {
      user: { username: 'parkingradio' },
      venue: { name: 'Parking Radio' },
      input: { inputFields: FIELDS },
      image: { inputFields: IMAGE_FIELDS },
      schema: { mutationType: { fields: [{ name: 'createEvent' }, { name: 'updateEvent' }] } },
      ...changes,
    },
  }
}

// The site's answers, to the event and the flyer, then RA's: to the checks, to uploading the flyer, then to creating the
// event.
let answers: { publication: () => Response; flyer: () => Response; checks: () => Response; upload: () => Response | Promise<Response>; create: () => Response }
const fetch = vi.fn(async (url: string, init: RequestInit) => {
  if (url.endsWith('/api/ra-publication')) return answers.publication()
  if (url.endsWith('/api/ra-publication/flyer')) return answers.flyer()
  if (url === UPLOADER) return answers.upload()
  const { query } = JSON.parse(init.body as string)
  return query.startsWith('mutation createEvent') ? answers.create() : answers.checks()
})
const toRa = () => fetch.mock.calls.filter(([url]) => url === '/graphql')
const uploads = () => fetch.mock.calls.filter(([url]) => url === UPLOADER)
// The event that was created, as it was sent to RA.
const created = () => JSON.parse(toRa().find(([, init]) => JSON.parse(init.body as string).query.startsWith('mutation'))![1].body as string).variables.eventInput
// An answer that never comes, since the request fails.
const throws = (error: Error) => () => {
  throw error
}
const sentQueries = () => toRa().map(([, init]) => JSON.parse(init.body as string).query as string)
const creations = () => sentQueries().filter((query) => query.startsWith('mutation'))

// Runs the script, as the bookmarklet adds it to RA's page, from `from`, or from nowhere the browser can tell when null.
function run({ token = TOKEN as string | null, from = SITE as string | null } = {}) {
  location.hash = token === null ? '' : `#parking-radio=${token}`
  const script = document.createElement('script')
  script.src = `${from}/ra-bookmarklet.js?1794319166924`
  vi.spyOn(Document.prototype, 'currentScript', 'get').mockReturnValue(from === null ? null : script)
  new Function(SCRIPT)()
}

const panel = () => screen.getByRole('dialog', { name: 'Parking Radio → RA' })
const withFlyer = () => (answers.publication = () => Response.json({ ...PUBLICATION, hasFlyer: true }))
// Clicks « Créer sur RA », once it's there, and waits for the event to be created.
async function createOnRa() {
  fireEvent.click(await screen.findByRole('button', { name: 'Créer sur RA' }))
  await screen.findByRole('link', { name: 'Enregistrer l’événement dans la session' })
}

// The page's address, as the environment's options above give it, which vitest's jsdom environment can change, e.g. to
// RA's site in another language.
const RA_PAGE = location.href
const goTo = (url: string) => (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom.reconfigure({ url })

beforeEach(() => {
  vi.stubGlobal('fetch', fetch)
  fetch.mockClear()
  answers = {
    publication: () => Response.json(PUBLICATION),
    flyer: jpeg,
    checks: () => Response.json(checks()),
    upload: () => Response.json({ filename: FILENAME }),
    create: () => Response.json({ data: { createEvent: { id: '2400123' } } }),
  }
  // The flyer's preview's address, which jsdom doesn't make.
  URL.createObjectURL = vi.fn(() => 'blob:https://ra.co/flyer')
  URL.revokeObjectURL = vi.fn()
  document.cookie = 'next_id_token=the-token'
})

afterEach(() => {
  document.body.replaceChildren()
  document.cookie = 'next_id_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  goTo(RA_PAGE)
})

describe('The bookmarklet', () => {
  it('gets the event from its site, checks RA, shows the event, and creates it only once confirmed, then leads back to the session', async () => {
    // The address when the site is asked for the event.
    let address = ''
    fetch.mockImplementationOnce(async () => {
      address = location.href
      return answers.publication()
    })
    run()
    expect(await screen.findByText('Connecté à RA en tant que parkingradio. Vérifiez l’événement avant de le créer :')).toBeInTheDocument()
    expect(panel()).toHaveTextContent('GUEST MIXES')
    expect(panel()).toHaveTextContent('vendredi 20 novembre 2026 à 21 h 00 → samedi 21 novembre 2026 à 01 h 00')
    expect(panel()).toHaveTextContent('Parking Radio')
    expect(panel()).toHaveTextContent('Line-upAurore Brume')
    expect(panel()).toHaveTextContent('Liens promotionnelsparking.radio : https://parking.radio instagram : https://www.instagram.com/parking.radio')
    expect(panel()).toHaveTextContent('Liens médiahttps://www.youtube.com/@parkingdotradio https://soundcloud.com/parkingdotradio')
    expect(panel()).toHaveTextContent('FlyerPas de flyer')
    expect(panel()).not.toHaveTextContent('Attention')
    // The event, from the site it was loaded from, with the token in a header, without cookies, once the token is no
    // longer in the address.
    expect(fetch.mock.calls[0]).toEqual([`${SITE}/api/ra-publication`, { headers: { Authorization: `Bearer ${TOKEN}` }, credentials: 'omit', cache: 'no-store' }])
    expect(address).toBe('https://ra.co/pro/event/create')
    // Then one request to RA, as the admin logged in to RA, that changes nothing.
    expect(toRa()).toHaveLength(1)
    const [url, init] = toRa()[0]
    expect(url).toBe('/graphql')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer the-token' } })
    expect(JSON.parse(init.body as string).variables).toEqual({ venue: '288529' })
    expect(sentQueries()[0]).not.toContain('ImageInput')
    expect(creations()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Créer sur RA' }))
    const link = await screen.findByRole('link', { name: 'Enregistrer l’événement dans la session' })
    expect(link).toHaveAttribute('href', `${SITE}/admin/sessions/session-1?raEvent=2400123`)
    expect(screen.getByRole('link', { name: 'https://ra.co/events/2400123' })).toHaveAttribute('href', 'https://ra.co/events/2400123')
    expect(panel()).toHaveTextContent('Ajoutez le flyer à la main, sur la page de l’événement sur RA.')
    expect(uploads()).toEqual([])
    expect(toRa()).toHaveLength(2)
    expect(JSON.parse(toRa()[1][1].body as string)).toEqual({
      query: 'mutation createEvent($eventInput: EventInput) { createEvent(eventInput: $eventInput) { id } }',
      variables: { eventInput: EVENT_INPUT },
    })
  })

  it('warns, outside production, that the event will be created on RA all the same', async () => {
    answers.publication = () => Response.json({ ...PUBLICATION, environment: 'test' })
    run()
    const warning = await screen.findByText('Attention : l’événement sera vraiment créé sur RA, à partir d’une session de TEST.')
    expect(warning.compareDocumentPosition(screen.getByRole('button', { name: 'Créer sur RA' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    document.body.replaceChildren()
    answers.publication = () => Response.json({ ...PUBLICATION, environment: 'development' })
    run()
    expect(await screen.findByText(/à partir d’une session de DEV\.$/)).toBeInTheDocument()
  })

  it('creates nothing when it is closed or cancelled', async () => {
    run()
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(creations()).toEqual([])
  })

  it('shows what it is given as text', async () => {
    const promotionalLinks = [{ title: '<img src=x onerror=alert(2)>', url: 'javascript:alert(3)' }]
    answers.publication = () => Response.json({ ...PUBLICATION, event: { ...EVENT_INPUT, title: '<img src=x onerror=alert(1)>', promotionalLinks } })
    run()
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(panel()).toHaveTextContent('<img src=x onerror=alert(2)> : javascript:alert(3)')
    expect(panel().querySelector('img, a')).toBeNull()
  })

  it('says that RA changed when RA no longer takes the fields the site gives', async () => {
    const inputFields = [...FIELDS.filter(({ name }) => name !== 'lineup'), field('category', 'NON_NULL')]
    answers.checks = () => Response.json(checks({ input: { inputFields }, schema: { mutationType: { fields: [] } } }))
    run()
    expect(await screen.findByText('RA a changé : createEvent n’existe plus, le champ lineup n’existe plus, le champ category est requis.')).toBeInTheDocument()
    expect(creations()).toEqual([])
  })

  it("shows RA's errors as they come, whatever the status, without trying again", async () => {
    answers.create = () => Response.json({ data: { createEvent: null }, errors: [{ message: 'You cannot post events for this promoter.' }] })
    run()
    fireEvent.click(await screen.findByRole('button', { name: 'Créer sur RA' }))
    expect(await screen.findByText('RA a refusé de créer l’événement : You cannot post events for this promoter.')).toBeInTheDocument()
    expect(creations()).toHaveLength(1)

    document.body.replaceChildren()
    answers.create = () => Response.json({ errors: [{ message: 'Variable "$eventInput" got invalid value.' }] }, { status: 400 })
    run()
    fireEvent.click(await screen.findByRole('button', { name: 'Créer sur RA' }))
    expect(await screen.findByText('RA a refusé de créer l’événement : Variable "$eventInput" got invalid value.')).toBeInTheDocument()

    document.body.replaceChildren()
    answers.checks = () => Response.json({ data: null, errors: [{ message: 'Unknown type "EventInput".' }] }, { status: 400 })
    run()
    expect(await screen.findByText('Quelque chose n’a pas fonctionné : Unknown type "EventInput".')).toBeInTheDocument()
  })

  it('says something went wrong otherwise', async () => {
    answers.create = () => new Response('Bad gateway', { status: 502 })
    run()
    fireEvent.click(await screen.findByRole('button', { name: 'Créer sur RA' }))
    expect(await screen.findByText('Quelque chose n’a pas fonctionné : RA a répondu 502.')).toBeInTheDocument()
  })

  it('says to log in to RA, then to publish again', async () => {
    answers.checks = () => Response.json(checks({ user: null }))
    run()
    expect(await screen.findByText(/^RA ne reconnaît pas votre connexion\. Connectez-vous à RA/)).toBeInTheDocument()

    document.body.replaceChildren()
    document.cookie = 'next_id_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    fetch.mockClear()
    run()
    expect(screen.getByText(/^Vous n’êtes pas connecté à RA\. Connectez-vous à RA/)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    // Without the token, which it removed from the address.
    expect(location.hash).toBe('')
  })

  it("runs on ra.co's subdomains, e.g. RA's site in French", async () => {
    goTo('https://fr.ra.co/pro/event/create')
    document.cookie = 'next_id_token=the-token'
    run()
    expect(await screen.findByRole('button', { name: 'Créer sur RA' })).toBeInTheDocument()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${SITE}/api/ra-publication`, '/graphql'])
  })

  it.each(['https://notra.co/pro/event/create', 'https://example.com/'])('only runs on RA\'s site, not on %s', (page) => {
    goTo(page)
    run()
    expect(screen.getByText('Ce favori s’utilise sur ra.co, sur la page qu’ouvre « Publier sur RA ».')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('needs a token in the address, and only reads it once', async () => {
    run({ token: null })
    expect(screen.getByText('Aucun événement à créer : cliquez sur « Publier sur RA » sur la page de la session, puis sur ce favori.')).toBeInTheDocument()
    document.body.replaceChildren()
    run({ token: '' })
    expect(screen.getByText(/^Aucun événement à créer/)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()

    document.body.replaceChildren()
    run()
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }))
    new Function(SCRIPT)()
    expect(screen.getByText(/^Aucun événement à créer/)).toBeInTheDocument()
  })

  it('gets the event from the site it was loaded from, and says to publish again when the site refuses the token', async () => {
    answers.publication = () => Response.json({ ok: false, error: "The token isn't valid, or has expired" }, { status: 403 })
    run({ from: 'https://test.parking.radio' })
    expect(
      await screen.findByText(
        'Ce lien de publication a expiré, ou ne vient pas de https://test.parking.radio : cliquez de nouveau sur « Publier sur RA » sur la page de la session, puis sur le favori de ce site.',
      ),
    ).toBeInTheDocument()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://test.parking.radio/api/ra-publication'])
  })

  it("says when the site can't be reached, or fails", async () => {
    answers.publication = throws(new TypeError('Failed to fetch'))
    run()
    expect(await screen.findByText(`${SITE} n’a pas pu être joint.`)).toBeInTheDocument()

    document.body.replaceChildren()
    answers.publication = () => Response.json({ ok: false, error: 'The session has no start' }, { status: 409 })
    run()
    expect(await screen.findByText('Quelque chose n’a pas fonctionné : The session has no start.')).toBeInTheDocument()

    document.body.replaceChildren()
    answers.publication = () => new Response('Bad gateway', { status: 502 })
    run()
    expect(await screen.findByText(`Quelque chose n’a pas fonctionné : ${SITE} a répondu 502.`)).toBeInTheDocument()
    expect(creations()).toEqual([])
    expect(toRa()).toEqual([])
  })

  it('only trusts the browser to say which site it was loaded from', async () => {
    // An element of RA's page named currentScript, which `document.currentScript` would give.
    Object.defineProperty(document, 'currentScript', { value: { src: 'https://elsewhere.example/ra-bookmarklet.js' }, configurable: true })
    run()
    expect(await screen.findByRole('button', { name: 'Créer sur RA' })).toBeInTheDocument()
    expect(fetch.mock.calls[0][0]).toBe(`${SITE}/api/ra-publication`)

    document.body.replaceChildren()
    fetch.mockClear()
    run({ from: null })
    expect(screen.getByText('Ce favori n’a pas pu savoir de quel site il vient.')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    delete (document as { currentScript?: unknown }).currentScript
  })

  it('gets the flyer from its site, shows it, uploads it to RA once confirmed, then creates the event with it', async () => {
    withFlyer()
    run()
    const image = await screen.findByRole('img', { name: 'Flyer' })
    // From what the site sent, with the token, as for the event.
    expect(fetch.mock.calls[1]).toEqual([`${SITE}/api/ra-publication/flyer`, { headers: { Authorization: `Bearer ${TOKEN}` }, credentials: 'omit', cache: 'no-store' }])
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(FLYER)
    expect(image).toHaveAttribute('src', 'blob:https://ra.co/flyer')
    fireEvent.load(image)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:https://ra.co/flyer')
    // RA is asked whether it still takes the flyer's fields too.
    expect(sentQueries()[0]).toContain('__type(name: "ImageInput")')
    expect(uploads()).toEqual([])

    await createOnRa()
    expect(uploads()).toHaveLength(1)
    const [, init] = uploads()[0]
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', headers: { Authorization: 'Bearer the-token' } })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const sent = (init.body as FormData).get('data') as File
    expect(new Uint8Array(await sent.arrayBuffer())).toEqual(FLYER)
    expect(created()).toEqual({ ...EVENT_INPUT, images: [{ filename: FILENAME, type: 'FLYERFRONT' }] })
    expect(panel()).not.toHaveTextContent('Ajoutez')
  })

  it.each<[string, () => Response]>([
    ['RA a répondu 413', () => new Response('Too large', { status: 413 })],
    ['RA n’a pas répondu comme prévu', () => Response.json({ filename: '' })],
    ['RA n’a pas pu être joint', throws(new TypeError('Failed to fetch'))],
    ['RA n’a pas répondu à temps', throws(new DOMException('The operation timed out.', 'TimeoutError'))],
  ])('creates the event without the flyer when RA does not take it, and says to add it by hand: %s', async (why, upload) => {
    withFlyer()
    answers.upload = upload
    run()
    await createOnRa()
    expect(created()).toEqual(EVENT_INPUT)
    expect(panel()).toHaveTextContent(`Le flyer n’a pas pu être envoyé à RA : ${why}. Ajoutez-le à la main, sur la page de l’événement sur RA.`)
  })

  it.each<[string, () => Response]>([
    ['The flyer of this session is missing', () => Response.json({ ok: false, error: 'The flyer of this session is missing' }, { status: 404 })],
    [`${SITE} a répondu 502`, () => new Response('Bad gateway', { status: 502 })],
    [`${SITE} n’a pas envoyé d’image JPEG`, () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } })],
    [`${SITE} n’a pas pu être joint`, throws(new TypeError('Failed to fetch'))],
  ])("says when the flyer can't be had from the site, and creates the event without it: %s", async (why, flyer) => {
    withFlyer()
    answers.flyer = flyer
    run()
    expect(await screen.findByText(`Le flyer n’a pas pu être chargé : ${why}. L’événement sera créé sans flyer : ajoutez-le à la main sur RA.`)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(sentQueries()[0]).not.toContain('ImageInput')
    await createOnRa()
    expect(uploads()).toEqual([])
    expect(created()).toEqual(EVENT_INPUT)
    expect(panel()).toHaveTextContent('Ajoutez le flyer à la main, sur la page de l’événement sur RA.')
  })

  it("says when the flyer can't be shown on RA's page, which still sends it", async () => {
    withFlyer()
    run()
    fireEvent.error(await screen.findByRole('img', { name: 'Flyer' }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(panel()).toHaveTextContent('Aperçu impossible ici, mais le flyer sera tout de même envoyé.')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:https://ra.co/flyer')
    await createOnRa()
    expect(created().images).toEqual([{ filename: FILENAME, type: 'FLYERFRONT' }])
  })

  it('says that RA changed when RA no longer takes the flyer, only when it sends one', async () => {
    const inputFields = FIELDS.filter(({ name }) => name !== 'images')
    answers.checks = () => Response.json(checks({ input: { inputFields }, image: { inputFields: [...IMAGE_FIELDS, field('width', 'NON_NULL')] } }))
    withFlyer()
    run()
    expect(await screen.findByText('RA a changé : le champ images n’existe plus, le champ images.width est requis.')).toBeInTheDocument()

    document.body.replaceChildren()
    answers.checks = () => Response.json(checks({ image: { inputFields: IMAGE_FIELDS.filter(({ name }) => name !== 'type') } }))
    run()
    expect(await screen.findByText('RA a changé : le champ images.type n’existe plus.')).toBeInTheDocument()
    expect(creations()).toEqual([])
    expect(uploads()).toEqual([])

    // Without a flyer, RA doesn't need to take one.
    document.body.replaceChildren()
    answers.publication = () => Response.json(PUBLICATION)
    answers.checks = () => Response.json(checks({ input: { inputFields }, image: null }))
    run()
    await createOnRa()
    expect(created()).toEqual(EVENT_INPUT)
  })

  it('leaves the panel as it is when clicked again while it creates the event, so that it creates it only once', async () => {
    withFlyer()
    // An upload that only ends when the test says.
    let uploaded: (answer: Response) => void = () => {}
    answers.upload = () => new Promise((resolve) => (uploaded = resolve))
    run()
    fireEvent.click(await screen.findByRole('button', { name: 'Créer sur RA' }))
    await vi.waitFor(() => expect(uploads()).toHaveLength(1))
    const busy = panel()
    new Function(SCRIPT)()
    expect(panel()).toBe(busy)
    expect(busy).toHaveTextContent('Envoi du flyer…')
    expect(screen.queryByText(/^Aucun événement à créer/)).not.toBeInTheDocument()

    uploaded(Response.json({ filename: FILENAME }))
    await screen.findByRole('link', { name: 'Enregistrer l’événement dans la session' })
    expect(creations()).toHaveLength(1)
    // Once it's done, clicking the bookmarklet again replaces the panel.
    new Function(SCRIPT)()
    expect(panel()).not.toBe(busy)
    expect(screen.getByText(/^Aucun événement à créer/)).toBeInTheDocument()
  })
})
