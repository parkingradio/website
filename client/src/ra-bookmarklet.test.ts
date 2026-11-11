// @vitest-environment-options {"url": "https://ra.co/pro/event/create"}
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SCRIPT from '../public/ra-bookmarklet.js?raw'

// The bookmarklet's script (see docs/design/client/admin/publier-sur-ra.md), run as RA's page would run it, with RA
// answering as these tests say: nothing is ever sent to RA.

const SITE = 'https://parking.radio'

// What a session's page puts in the address.
const EVENT = {
  title: 'GUEST MIXES',
  start: '2026-11-20T21:00:00-05:00',
  end: '2026-11-21T01:00:00-05:00',
  lineup: 'Aurore\nBrume',
  venueId: '288529',
  promoterIds: ['183980'],
  content: 'LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC',
}
const PAYLOAD = { site: SITE, environment: 'production', session: 'session-1', event: EVENT }

// What the bookmarklet sends to create it.
const EVENT_INPUT = {
  title: 'GUEST MIXES',
  startTime: '2026-11-20T21:00:00.000',
  endTime: '2026-11-21T01:00:00.000',
  lineup: 'Aurore\nBrume',
  venueId: '288529',
  promoterIds: ['183980'],
  content: 'LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC',
  submissionSource: 'SUBMITEVENTPAGE',
}

const field = (name: string, kind = 'SCALAR', defaultValue: string | null = null) => ({ name, defaultValue, type: { kind } })
// What RA says of itself when nothing changed: it takes every field sent, and others, some required but with a default.
const FIELDS = [...Object.keys(EVENT_INPUT).map((name) => field(name)), field('images', 'LIST'), field('ticketed', 'NON_NULL', 'false')]
function checks(changes: object = {}) {
  return {
    data: {
      user: { username: 'parkingradio' },
      venue: { name: 'Parking Radio' },
      input: { inputFields: FIELDS },
      schema: { mutationType: { fields: [{ name: 'createEvent' }, { name: 'updateEvent' }] } },
      ...changes,
    },
  }
}

// RA's answers: to the checks, then to creating the event.
let answers: { checks: () => Response; create: () => Response }
const fetch = vi.fn(async (_url: string, init: RequestInit) => {
  const { query } = JSON.parse(init.body as string)
  return query.startsWith('mutation createEvent') ? answers.create() : answers.checks()
})
const sentQueries = () => fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string).query as string)
const creations = () => sentQueries().filter((query) => query.startsWith('mutation'))

function run({ payload = PAYLOAD as object | null, from = SITE } = {}) {
  location.hash = payload ? `#parking-radio=${encodeURIComponent(JSON.stringify(payload))}` : ''
  Object.defineProperty(document, 'currentScript', { value: { src: `${from}/ra-bookmarklet.js?1794319166924` }, configurable: true })
  new Function(SCRIPT)()
}

const panel = () => screen.getByRole('dialog', { name: 'Parking Radio → RA' })

beforeEach(() => {
  vi.stubGlobal('fetch', fetch)
  fetch.mockClear()
  answers = { checks: () => Response.json(checks()), create: () => Response.json({ data: { createEvent: { id: '2400123' } } }) }
  document.cookie = 'next_id_token=the-token'
})

afterEach(() => {
  document.body.replaceChildren()
  document.cookie = 'next_id_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  vi.unstubAllGlobals()
})

describe('The bookmarklet', () => {
  it('checks RA, shows the event, and creates it only once confirmed, then leads back to the session', async () => {
    run()
    expect(await screen.findByText('Connecté à RA en tant que parkingradio. Vérifiez l’événement avant de le créer :')).toBeInTheDocument()
    expect(panel()).toHaveTextContent('GUEST MIXES')
    expect(panel()).toHaveTextContent('vendredi 20 novembre 2026 à 21 h 00 → samedi 21 novembre 2026 à 01 h 00')
    expect(panel()).toHaveTextContent('Parking Radio')
    expect(panel()).toHaveTextContent('Line-upAurore Brume')
    expect(panel()).not.toHaveTextContent('Attention')
    // One request, as the admin logged in to RA, that changes nothing.
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/graphql')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer the-token' } })
    expect(JSON.parse(init.body as string).variables).toEqual({ venue: '288529' })
    expect(creations()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Créer sur RA' }))
    const link = await screen.findByRole('link', { name: 'Enregistrer l’événement dans la session' })
    expect(link).toHaveAttribute('href', `${SITE}/admin/sessions/session-1?raEvent=2400123`)
    expect(screen.getByRole('link', { name: 'https://ra.co/events/2400123' })).toHaveAttribute('href', 'https://ra.co/events/2400123')
    expect(panel()).toHaveTextContent('Ajoutez le flyer à la main')
    // Clicking the bookmarklet again on this page doesn't offer to create it again.
    expect(location.hash).toBe('')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetch.mock.calls[1][1].body as string)).toEqual({
      query: 'mutation createEvent($eventInput: EventInput) { createEvent(eventInput: $eventInput) { id } }',
      variables: { eventInput: EVENT_INPUT },
    })
  })

  it('warns, outside production, that the event will be created on RA all the same', async () => {
    run({ payload: { ...PAYLOAD, environment: 'test' } })
    const warning = await screen.findByText('Attention : l’événement sera vraiment créé sur RA, à partir d’une session de TEST.')
    expect(warning.compareDocumentPosition(screen.getByRole('button', { name: 'Créer sur RA' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    document.body.replaceChildren()
    run({ payload: { ...PAYLOAD, environment: 'development' } })
    expect(await screen.findByText(/à partir d’une session de DEV\.$/)).toBeInTheDocument()
  })

  it('creates nothing when it is closed or cancelled', async () => {
    run()
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(creations()).toEqual([])
  })

  it('shows what it is given as text', async () => {
    run({ payload: { ...PAYLOAD, event: { ...EVENT, title: '<img src=x onerror=alert(1)>' } } })
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(panel().querySelector('img')).toBeNull()
  })

  it('says that RA changed, and to create the event by hand, when RA no longer takes what it sends', async () => {
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
  })

  it('needs the event a session page gave, from the site it was installed from', async () => {
    run({ payload: null })
    expect(screen.getByText(/^Aucun événement à créer/)).toBeInTheDocument()
    document.body.replaceChildren()
    run({ payload: { site: SITE, session: 'session-1' } })
    expect(screen.getByText(/^Aucun événement à créer/)).toBeInTheDocument()
    document.body.replaceChildren()
    run({ from: 'https://elsewhere.example' })
    expect(screen.getByText(`Cet événement vient de ${SITE}, et ce favori de https://elsewhere.example.`)).toBeInTheDocument()
    await waitFor(() => expect(fetch).not.toHaveBeenCalled())
  })
})
