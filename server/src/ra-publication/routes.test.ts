import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import sharp from 'sharp'
import fastifyCookie from '@fastify/cookie'
import { useZodSchemas } from '../api/schemas.js'
import { TEST_ADMIN, sessionCookies } from '../admins/test-sessions.js'
import type { AdminsStore } from '../admins/store.js'
import { Conflict, HAS_RA_EVENT } from '../sessions/store.js'
import type { SessionsStore, StoredSession } from '../sessions/store.js'
import { storedSession, storedSet as set } from '../sessions/test-rows.js'
import { memoryPhotos, testImage } from '../artists/test-photos.js'
import { raPublicationRoutes } from './routes.js'
import { signRaPublicationToken } from './token.js'

// What the bookmarklet gets from the server, and the token it gets it with (see docs/design/server/ra-publication.md),
// without a database: the integration tests cover them against a real one (see integration-tests/032-ra-publication.sh).

// Les Ondes' takeover, unannounced, on November 14, 2026, from 21:00 to 1:00 in Québec, unless `fields` say otherwise.
const session = (fields: Partial<StoredSession> = {}) =>
  storedSession({ durationMinutes: 240, type: 'takeover', takeoverId: 'collective-1', takeover: { id: 'collective-1', name: 'Les Ondes' }, announced: false, ...fields })

let rows: StoredSession[] = []
const find = (id: string) => rows.find((row) => row.id === id) ?? null
const store = {
  get: vi.fn(async (id: string) => find(id)),
  // As the database does it.
  setRaEvent: vi.fn<SessionsStore['setRaEvent']>(async (id, change) => {
    const row = find(id)
    if (!row) return null
    if (row.raEventId !== null) throw new Conflict(HAS_RA_EVENT, null)
    return Object.assign(row, change)
  }),
}
// The version of each admin's sessions, as the database has it: every admin's is 0, unless they were revoked (null).
const versions = new Map<string, number | null>()
const sessionVersion = vi.fn<AdminsStore['sessionVersion']>(async (id) => (versions.has(id) ? versions.get(id)! : 0))
// Every admin is TEST_ADMIN, by their email.
const emailAndSessionVersion = vi.fn<AdminsStore['emailAndSessionVersion']>(async (id) => {
  const version = await sessionVersion(id)
  return version === null ? null : { email: TEST_ADMIN.email, sessionVersion: version }
})
// Where the flyers are kept: FLYER_KEY is a PNG of 3000 × 1500 pixels.
const photos = memoryPhotos()
const FLYER_KEY = 'sessions/flyer.png'
const withFlyer = (fields: Partial<StoredSession> = {}) => session({ flyerKey: FLYER_KEY, flyerType: 'image/png', ...fields })

beforeEach(async () => {
  process.env.JWT_SECRET = 'test-secret'
  rows = [session()]
  photos.stored.set(FLYER_KEY, await testImage('png', 3000, 1500))
})

afterEach(() => {
  vi.clearAllMocks()
  photos.reset()
  versions.clear()
  delete process.env.JWT_SECRET
})

async function buildApp(environment = 'production') {
  const app = Fastify({ logger: false })
  useZodSchemas(app)
  await app.register(fastifyCookie)
  app.decorate('adminSessions', { sessionVersion })
  await app.register(raPublicationRoutes, { store: store as unknown as SessionsStore, admins: { emailAndSessionVersion }, photos, environment })
  return app
}
type App = Awaited<ReturnType<typeof buildApp>>

const issue = async (app: App, id = 'session-1') =>
  app.inject({ method: 'POST', url: `/api/admin/sessions/${id}/ra-publication`, cookies: await sessionCookies() })
// A request to `url`, with `token`, if any, as the bookmarklet sends it: a GET, unless it sends a `payload`.
const withToken = (app: App, url: string, token: string | null, headers: Record<string, string> = {}, payload?: unknown) =>
  app.inject({
    method: payload === undefined ? 'GET' : 'PUT',
    url,
    payload: payload as object | undefined,
    headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...headers },
  })
const publication = (app: App, token: string | null, headers: Record<string, string> = {}) => withToken(app, '/api/ra-publication', token, headers)
const flyer = (app: App, token: string | null, headers: Record<string, string> = {}) => withToken(app, '/api/ra-publication/flyer', token, headers)
const tokenFor = async (app: App, id = 'session-1') => (await issue(app, id)).json().token as string
// Saving an event as the session's, with `token`, as the bookmarklet does once it created it.
const SAVED = { raEvent: '2400123' }
const save = (app: App, token: string | null, payload: unknown = SAVED, headers: Record<string, string> = {}) =>
  withToken(app, '/api/ra-publication/ra-event', token, headers, payload)

describe('POST /api/admin/sessions/:id/ra-publication', () => {
  it('requires a session', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'POST', url: '/api/admin/sessions/session-1/ra-publication' })
    expect(response.statusCode).toBe(401)
  })

  it("gives a token for the session, and responds 404 for a session that doesn't exist", async () => {
    const app = await buildApp()
    const response = await issue(app)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, token: expect.any(String) })
    expect((await issue(app, 'session-9')).statusCode).toBe(404)
  })
})

describe('GET /api/ra-publication', () => {
  it("gives the session's event, as RA's EventInput, with its performers in order, once, from its sets that aren't cancelled", async () => {
    rows = [session({ sets: [set(['Ana', 'Brume']), set(['Brume', 'Cyan']), set(['Dune']), set(['Ana', 'Eole'], 'cancelled')] })]
    const app = await buildApp('test')
    const response = await publication(app, await tokenFor(app))
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      ok: true,
      environment: 'test',
      session: 'session-1',
      hasFlyer: false,
      event: {
        title: 'LES ONDES TAKEOVER',
        startTime: '2026-11-14T21:00:00.000',
        endTime: '2026-11-15T01:00:00.000',
        lineup: 'Ana\nBrume\nCyan\nDune',
        venueId: '288529',
        promoterIds: ['183980'],
        content: 'LIVE STREAMING FROM QUÉBEC CITY. SPACE OPEN TO PUBLIC',
        promotionalLinks: [
          { title: 'parking.radio', url: 'https://parking.radio' },
          { title: 'instagram', url: 'https://www.instagram.com/parking.radio' },
        ],
        playerLinks: [{ sourceId: 'https://www.youtube.com/@parkingdotradio' }, { sourceId: 'https://soundcloud.com/parkingdotradio' }],
        submissionSource: 'SUBMITEVENTPAGE',
      },
    })
  })

  it('says whether the session has a flyer', async () => {
    rows = [withFlyer()]
    const app = await buildApp()
    expect((await publication(app, await tokenFor(app))).json().hasFlyer).toBe(true)
  })

  it('gives its start and end in Québec time, without their offset, across the night the clocks go back', async () => {
    rows = [session({ startAt: new Date('2026-07-02T01:00:00Z'), durationMinutes: 120 }), session({ id: 'session-2', startAt: new Date('2026-11-01T03:00:00Z') })]
    const app = await buildApp()
    const times = async (id: string) => {
      const { startTime, endTime } = (await publication(app, await tokenFor(app, id))).json().event
      return [startTime, endTime]
    }
    expect(await times('session-1')).toEqual(['2026-07-01T21:00:00.000', '2026-07-01T23:00:00.000'])
    expect(await times('session-2')).toEqual(['2026-10-31T23:00:00.000', '2026-11-01T02:00:00.000'])
  })

  it('has OPEN JAM as the lineup of a synth meetup without performers, or else its title, and its own description', async () => {
    rows = [
      session({ type: 'synth-meetup', takeoverId: null, takeover: null }),
      session({ id: 'session-2', type: 'other', takeoverId: null, takeover: null, name: 'LISTENING PARTY', description: 'Une écoute.' }),
      session({ id: 'session-3', type: 'guest-mixes', takeoverId: null, takeover: null, sets: [set(['Ana'], 'cancelled')] }),
    ]
    const app = await buildApp()
    const event = async (id: string) => (await publication(app, await tokenFor(app, id))).json().event
    const meetup = await event('session-1')
    expect(meetup).toMatchObject({ title: 'SYNTH MEETUPS', lineup: 'OPEN JAM' })
    expect(meetup.content).toMatch(/^SYNTH MEETUPS\n\nRencontres hebdomadaires/)
    expect(await event('session-2')).toMatchObject({ title: 'LISTENING PARTY', lineup: 'LISTENING PARTY', content: 'Une écoute.' })
    expect(await event('session-3')).toMatchObject({ title: 'GUEST MIXES', lineup: 'GUEST MIXES' })
  })

  it("refuses requests without a valid token in Authorization, before anything else is read, without quoting it", async () => {
    const app = await buildApp()
    const token = await tokenFor(app)
    store.get.mockClear()
    const other = await signRaPublicationToken({ session: 'session-1', admin: TEST_ADMIN.id, sessionVersion: 1 })
    const requests = [
      publication(app, null),
      publication(app, ''),
      publication(app, 'not-a-token'),
      publication(app, null, { authorization: token }),
      publication(app, null, { authorization: `Basic ${token}` }),
      // Its admin chose a new password since.
      publication(app, other),
      // A token in the query, which it never takes.
      app.inject({ method: 'GET', url: `/api/ra-publication?token=${token}` }),
    ]
    for (const response of await Promise.all(requests)) {
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ ok: false, error: "The token isn't valid, or has expired" })
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.body).not.toContain(token)
    }
    expect(store.get).not.toHaveBeenCalled()
  })

  it('refuses the tokens of admins who were revoked since', async () => {
    const app = await buildApp()
    const token = await tokenFor(app)
    versions.set(TEST_ADMIN.id, null)
    expect((await publication(app, token)).statusCode).toBe(403)
    expect(emailAndSessionVersion).toHaveBeenLastCalledWith(TEST_ADMIN.id)
  })

  it('responds 404 once the session is deleted, and 409 when it has no start, is cancelled, or has an event on RA', async () => {
    rows.push(session({ id: 'session-2', startAt: null }), session({ id: 'session-3' }), session({ id: 'session-4', raEventId: '2400123' }))
    const app = await buildApp()
    const deleted = await tokenFor(app)
    rows.shift()
    const response = await publication(app, deleted)
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ ok: false, error: 'No such session' })
    const undated = await publication(app, await tokenFor(app, 'session-2'))
    expect(undated.statusCode).toBe(409)
    expect(undated.json()).toEqual({ ok: false, error: 'The session has no start' })
    // Cancelled once the token was given.
    const token = await tokenFor(app, 'session-3')
    find('session-3')!.status = 'cancelled'
    const cancelled = await publication(app, token)
    expect(cancelled.statusCode).toBe(409)
    expect(cancelled.json()).toEqual({ ok: false, error: 'This session is cancelled' })
    const published = await publication(app, await tokenFor(app, 'session-4'))
    expect(published.statusCode).toBe(409)
    expect(published.json()).toEqual({ ok: false, error: 'This session already has an event on RA' })
  })

})

describe('The endpoints that take the token', () => {
  // Each endpoint, with the headers the bookmarklet sends it, which its preflight asks for.
  it.each([
    ['GET', '/api/ra-publication', 'authorization'],
    ['GET', '/api/ra-publication/flyer', 'authorization'],
    ['PUT', '/api/ra-publication/ra-event', 'authorization,content-type'],
  ] as const)("let RA's pages, and only them, read the responses of %s %s, errors included, after asking with a preflight", async (method, url, requested) => {
    rows = [withFlyer()]
    const app = await buildApp()
    const token = await tokenFor(app)
    const get = (token: string, headers: Record<string, string>) => withToken(app, url, token, headers, method === 'PUT' ? SAVED : undefined)
    for (const origin of ['https://ra.co', 'https://fr.ra.co']) {
      for (const response of [await get(token, { origin }), await get('not-a-token', { origin })]) {
        expect(response.headers['access-control-allow-origin']).toBe(origin)
        expect(response.headers.vary).toBe('Origin')
        expect(response.headers['access-control-allow-credentials']).toBeUndefined()
      }
      const preflight = await app.inject({
        method: 'OPTIONS',
        url,
        headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': requested },
      })
      expect(preflight.statusCode).toBe(204)
      expect(preflight.headers).toMatchObject({
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, PUT',
        'access-control-allow-headers': 'Authorization, Content-Type',
        'cache-control': 'no-store',
      })
    }
    for (const origin of ['https://notra.co', 'http://ra.co', 'https://ra.co.example', 'https://parking.radio', 'null']) {
      expect((await get(token, { origin })).headers['access-control-allow-origin']).toBeUndefined()
      const preflight = await app.inject({ method: 'OPTIONS', url, headers: { origin, 'access-control-request-method': method } })
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
      expect(preflight.headers['access-control-allow-headers']).toBeUndefined()
    }
    expect((await get(token, {})).headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('GET /api/ra-publication/flyer', () => {
  it("gives the session's flyer as a JPEG within RA's limits, never kept", async () => {
    rows = [withFlyer()]
    const app = await buildApp()
    const response = await flyer(app, await tokenFor(app), { origin: 'https://ra.co' })
    expect(response.statusCode).toBe(200)
    expect(response.headers).toMatchObject({
      'content-type': 'image/jpeg',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'access-control-allow-origin': 'https://ra.co',
    })
    expect(await sharp(response.rawPayload).metadata()).toMatchObject({ format: 'jpeg', width: 2000, height: 1000 })
    expect(photos.read).toHaveBeenCalledWith(FLYER_KEY)
  })

  it('refuses requests without a valid token, before anything else is read', async () => {
    rows = [withFlyer()]
    const app = await buildApp()
    const token = await tokenFor(app)
    store.get.mockClear()
    versions.set(TEST_ADMIN.id, null)
    for (const response of [await flyer(app, null), await flyer(app, 'not-a-token'), await flyer(app, token)]) {
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ ok: false, error: "The token isn't valid, or has expired" })
      expect(response.headers['cache-control']).toBe('no-store')
    }
    expect(store.get).not.toHaveBeenCalled()
    expect(photos.read).not.toHaveBeenCalled()
  })

  it('responds 404 once the session is deleted, when it has no flyer, or when its flyer is missing', async () => {
    rows = [session(), withFlyer({ id: 'session-2', flyerKey: 'sessions/missing.png' })]
    const app = await buildApp()
    const deleted = await tokenFor(app, 'session-1')
    const missing = await tokenFor(app, 'session-2')
    expect((await flyer(app, deleted)).json()).toEqual({ ok: false, error: 'This session has no flyer' })
    rows.shift()
    for (const [token, error] of [
      [deleted, 'No such session'],
      [missing, 'The flyer of this session is missing'],
    ]) {
      const response = await flyer(app, token)
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error })
      expect(response.headers['cache-control']).toBe('no-store')
    }
  })
})

describe('PUT /api/ra-publication/ra-event', () => {
  it("saves the event as the session's, as the token's admin, now, only while it has none, and never kept", async () => {
    const app = await buildApp()
    const token = await tokenFor(app)
    const before = Date.now()
    const response = await save(app, token, { raEvent: '2400123' }, { origin: 'https://ra.co' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(store.setRaEvent).toHaveBeenCalledWith('session-1', { raEventId: '2400123', updatedBy: TEST_ADMIN.email, updatedAt: expect.any(Date) })
    expect(find('session-1')!.updatedAt!.getTime()).toBeGreaterThanOrEqual(before)
    expect(find('session-1')!.raEventId).toBe('2400123')

    // Not again, whatever it's sent, the same event included.
    for (const raEvent of ['2400124', '2400123']) {
      const again = await save(app, token, { raEvent })
      expect(again.statusCode).toBe(409)
      expect(again.json()).toEqual({ ok: false, error: 'This session already has an event on RA' })
      expect(again.headers['cache-control']).toBe('no-store')
    }
    expect(find('session-1')!.raEventId).toBe('2400123')
  })

  it("takes the event as a session's raEvent does, an id or a link to it, and nothing else", async () => {
    rows = [session(), session({ id: 'session-2' })]
    const app = await buildApp()
    expect((await save(app, await tokenFor(app), { raEvent: ' https://fr.ra.co/events/2400123/ ' })).statusCode).toBe(200)
    expect(find('session-1')!.raEventId).toBe('2400123')
    const token = await tokenFor(app, 'session-2')
    for (const payload of [{}, { raEvent: null }, { raEvent: '' }, { raEvent: '  ' }, { raEvent: 2400123 }, { raEvent: 'abc' }, { raEvent: 'https://example.com/events/1' }, { raEvent: '\u0000https://ra.co/events/1' }]) {
      const response = await save(app, token, payload)
      expect(response.statusCode).toBe(400)
    }
    expect(find('session-2')!.raEventId).toBeNull()
  })

  it("saves it whatever the session's status or start, since the event is on RA already", async () => {
    rows = [session({ status: 'cancelled' }), session({ id: 'session-2', startAt: null })]
    const app = await buildApp()
    expect((await save(app, await tokenFor(app, 'session-1'))).statusCode).toBe(200)
    expect((await save(app, await tokenFor(app, 'session-2'))).statusCode).toBe(200)
  })

  it('refuses requests without a valid token, before anything else is read, the body included', async () => {
    const app = await buildApp()
    const token = await tokenFor(app)
    const invalid = { 'content-type': 'application/json' }
    const requests = [
      save(app, null),
      save(app, 'not-a-token'),
      app.inject({ method: 'PUT', url: '/api/ra-publication/ra-event', payload: '{not json', headers: { ...invalid, authorization: 'Bearer not-a-token' } }),
    ]
    for (const response of await Promise.all(requests)) {
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({ ok: false, error: "The token isn't valid, or has expired" })
    }
    versions.set(TEST_ADMIN.id, null)
    expect((await save(app, token)).statusCode).toBe(403)
    expect(store.setRaEvent).not.toHaveBeenCalled()
  })

  it('responds 404 once the session is deleted', async () => {
    const app = await buildApp()
    const token = await tokenFor(app)
    rows = []
    const response = await save(app, token)
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ ok: false, error: 'No such session' })
  })
})
