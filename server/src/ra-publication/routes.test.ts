import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { useZodSchemas } from '../api/schemas.js'
import { TEST_ADMIN, sessionCookies } from '../admins/test-sessions.js'
import type { AdminsStore } from '../admins/store.js'
import type { SessionsStore, StoredSession } from '../sessions/store.js'
import { storedSession, storedSet as set } from '../sessions/test-rows.js'
import { raPublicationRoutes } from './routes.js'
import { signRaPublicationToken } from './token.js'

// What the bookmarklet gets from the server, and the token it gets it with (see docs/design/server/ra-publication.md),
// without a database: the integration tests cover them against a real one (see integration-tests/032-ra-publication.sh).

// Les Ondes' takeover, unannounced, on November 14, 2026, from 21:00 to 1:00 in Québec, unless `fields` say otherwise.
const session = (fields: Partial<StoredSession> = {}) =>
  storedSession({ durationMinutes: 240, type: 'takeover', takeoverId: 'collective-1', takeover: { id: 'collective-1', name: 'Les Ondes' }, announced: false, ...fields })

let rows: StoredSession[] = []
const store = { get: vi.fn(async (id: string) => rows.find((row) => row.id === id) ?? null) }
// The version of each admin's sessions, as the database has it: every admin's is 0, unless they were revoked (null).
const versions = new Map<string, number | null>()
const sessionVersion = vi.fn<AdminsStore['sessionVersion']>(async (id) => (versions.has(id) ? versions.get(id)! : 0))

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret'
  rows = [session()]
})

afterEach(() => {
  vi.clearAllMocks()
  versions.clear()
  delete process.env.JWT_SECRET
})

async function buildApp(environment = 'production') {
  const app = Fastify({ logger: false })
  useZodSchemas(app)
  await app.register(fastifyCookie)
  app.decorate('adminSessions', { sessionVersion })
  await app.register(raPublicationRoutes, { store: store as unknown as SessionsStore, environment })
  return app
}
type App = Awaited<ReturnType<typeof buildApp>>

const issue = async (app: App, id = 'session-1') =>
  app.inject({ method: 'POST', url: `/api/admin/sessions/${id}/ra-publication`, cookies: await sessionCookies() })
const publication = (app: App, token: string | null, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: '/api/ra-publication', headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...headers } })
const tokenFor = async (app: App, id = 'session-1') => (await issue(app, id)).json().token as string

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
    expect(sessionVersion).toHaveBeenLastCalledWith(TEST_ADMIN.id)
  })

  it('responds 404 once the session is deleted, and 409 when it has no start', async () => {
    rows.push(session({ id: 'session-2', startAt: null }))
    const app = await buildApp()
    const deleted = await tokenFor(app)
    rows.shift()
    const response = await publication(app, deleted)
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ ok: false, error: 'No such session' })
    const undated = await publication(app, await tokenFor(app, 'session-2'))
    expect(undated.statusCode).toBe(409)
    expect(undated.json()).toEqual({ ok: false, error: 'The session has no start' })
  })

  it("lets RA's pages, and only them, read its responses, errors included, after asking with a preflight", async () => {
    const app = await buildApp()
    const token = await tokenFor(app)
    for (const origin of ['https://ra.co', 'https://fr.ra.co']) {
      for (const response of [await publication(app, token, { origin }), await publication(app, 'not-a-token', { origin })]) {
        expect(response.headers['access-control-allow-origin']).toBe(origin)
        expect(response.headers.vary).toBe('Origin')
        expect(response.headers['access-control-allow-credentials']).toBeUndefined()
      }
      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/api/ra-publication',
        headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
      })
      expect(preflight.statusCode).toBe(204)
      expect(preflight.headers).toMatchObject({
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET',
        'access-control-allow-headers': 'Authorization',
        'cache-control': 'no-store',
      })
    }
    for (const origin of ['https://notra.co', 'http://ra.co', 'https://ra.co.example', 'https://parking.radio', 'null']) {
      expect((await publication(app, token, { origin })).headers['access-control-allow-origin']).toBeUndefined()
      const preflight = await app.inject({ method: 'OPTIONS', url: '/api/ra-publication', headers: { origin, 'access-control-request-method': 'GET' } })
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
      expect(preflight.headers['access-control-allow-headers']).toBeUndefined()
    }
    expect((await publication(app, token)).headers['access-control-allow-origin']).toBeUndefined()
  })
})
