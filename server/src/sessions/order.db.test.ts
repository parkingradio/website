import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import { multipartBody } from '../api/test-multipart.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { artistsRoutes } from '../artists/routes.js'
import { artistsStore } from '../artists/store.js'
import type { Photos } from '../artists/store.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { sessionsRoutes } from './routes.js'
import { sessionsStore } from './store.js'
import { checkSessionsInvariants } from './test-invariants.js'

// The order of a session's sets, against a real database: new sets go last, moving one leaves the others in their
// order, and so does deleting one, even with requests sent at the same time (see "Sets' order" in
// docs/design/server/sessions.md). The property-based tests of rules.db.test.ts move sets
// too.

// Photos and flyers aren't sent, so there are none to read or delete.
const NO_PHOTOS: Photos = {
  store: async () => {
    throw new Error('No photos in these tests')
  },
  read: async () => null,
  delete: async () => {},
}

let database: TestDatabase
let app: FastifyInstance
let artist: string

type Sets = { id: string; durationMinutes: number | null; updatedBy: string | null }[]

async function request(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies: await sessionCookies() })
}

// A set of Aurore's that lasts `durationMinutes`, as adding one sends it.
function set(durationMinutes: number | null) {
  return {
    performers: [{ id: artist }],
    durationMinutes,
    performanceTypes: [],
    otherPerformanceType: '',
    genres: [],
    soundcloudTrack: null,
    youtubeVideo: null,
    application: null,
  }
}

// Adds a session of 2 hours with sets of `durations`, and returns its id and theirs, in order.
async function sessionWithSets(durations: (number | null)[]): Promise<{ session: string; sets: string[] }> {
  const session = { start: null, durationMinutes: 120, type: 'guest-mixes', takeover: null, application: null, name: '', raEvent: null, description: '' }
  const response = await app.inject({
    method: 'POST',
    url: '/api/admin/sessions',
    ...multipartBody({ session: JSON.stringify({ ...session, sets: durations.map(set) }) }),
    cookies: await sessionCookies(),
  })
  expect(response.statusCode).toBe(200)
  const added = response.json().session
  return { session: added.id, sets: (added.sets as Sets).map(({ id }) => id) }
}

async function setsOf(session: string): Promise<Sets> {
  return (await request('GET', `/api/admin/sessions/${session}`)).json().session.sets
}

const ids = (sets: Sets) => sets.map(({ id }) => id)
const move = (id: string, position: unknown) => request('PUT', `/api/admin/sets/${id}/position`, { position })

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret'
  database = await testDatabase()
  app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(sessionsRoutes, { store: sessionsStore(database.db), photos: NO_PHOTOS, resolveTrack: async () => null })
  await app.register(artistsRoutes, { store: artistsStore(database.db), photos: NO_PHOTOS })
})

afterAll(async () => {
  await app?.close()
  await database?.drop()
})

beforeEach(async () => {
  await database.db.execute(sql`truncate sessions, artists, collectives cascade`)
  const response = await app.inject({
    method: 'POST',
    url: '/api/admin/artists',
    ...multipartBody({ artist: JSON.stringify({ name: 'Aurore' }) }),
    cookies: await sessionCookies(),
  })
  artist = response.json().artist.id
})

describe("a session's sets", () => {
  it('are in the order they were added, a new one last', async () => {
    const { session, sets } = await sessionWithSets([60, 30])
    const added = await request('POST', `/api/admin/sessions/${session}/sets`, set(null))
    expect(added.statusCode).toBe(200)
    const found: Sets = added.json().session.sets
    expect(ids(found).slice(0, 2)).toEqual(sets)
    expect(found).toHaveLength(3)
    await checkSessionsInvariants(database.db)
  })

  it('are moved one at a time, the others keeping their order, a position past the last moving it last', async () => {
    const { session, sets } = await sessionWithSets([10, 20, 30, 40])
    const [a, b, c, d] = sets
    let response = await move(d, 1)
    expect(response.statusCode).toBe(200)
    expect(ids(response.json().session.sets)).toEqual([a, d, b, c])
    response = await move(a, 2)
    expect(ids(response.json().session.sets)).toEqual([d, b, a, c])
    // Where it already is.
    response = await move(a, 2)
    expect(ids(response.json().session.sets)).toEqual([d, b, a, c])
    // Past the last, even past what the database's integers hold.
    for (const position of [4, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
      response = await move(d, position)
      expect(response.statusCode, String(position)).toBe(200)
      expect(ids(response.json().session.sets)).toEqual([b, a, c, d])
    }
    await checkSessionsInvariants(database.db)
    // Moving doesn't count as changing a set, neither the one that's moved nor the others.
    expect((await setsOf(session)).map(({ updatedBy }) => updatedBy)).toEqual([null, null, null, null])
  })

  it('are moved even in a cancelled session, and not when the request is wrong', async () => {
    const { session, sets } = await sessionWithSets([60, 60])
    expect((await request('PUT', `/api/admin/sessions/${session}/status`, { status: 'cancelled' })).statusCode).toBe(200)
    expect((await move(sets[1], 0)).statusCode).toBe(200)
    for (const position of [-1, 1.5, 1e20, '1', null, undefined]) expect((await move(sets[0], position)).statusCode, String(position)).toBe(400)
    expect((await request('PUT', `/api/admin/sets/${sets[0]}/position`, { position: 0, id: sets[0] })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: `/api/admin/sets/${sets[0]}/position`, cookies: await sessionCookies() })).statusCode).toBe(400)
    for (const id of ['not-a-uuid', '00000000-0000-4000-8000-000000000000']) {
      const response = await move(id, 0)
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ ok: false, error: 'No such set' })
    }
    expect(ids(await setsOf(session))).toEqual([sets[1], sets[0]])
  })

  it('keep their order when one of them is deleted', async () => {
    const { session, sets } = await sessionWithSets([10, 20, 30])
    expect((await request('DELETE', `/api/admin/sets/${sets[1]}`)).statusCode).toBe(200)
    expect(ids(await setsOf(session))).toEqual([sets[0], sets[2]])
    await checkSessionsInvariants(database.db)
    expect(ids((await move(sets[0], 5)).json().session.sets)).toEqual([sets[2], sets[0]])
  })

  it('stay in an order when they are moved, added and deleted at the same time', async () => {
    const { session, sets } = await sessionWithSets([10, 20, 30, 40, 50])
    const responses = await Promise.all([
      move(sets[0], 4),
      move(sets[4], 0),
      move(sets[2], 1),
      request('POST', `/api/admin/sessions/${session}/sets`, set(15)),
      request('DELETE', `/api/admin/sets/${sets[3]}`),
      move(sets[1], 3),
      request('POST', `/api/admin/sessions/${session}/sets`, set(15)),
    ])
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([200, 200, 200, 200, 200, 200, 200])
    expect(await setsOf(session)).toHaveLength(6)
    await checkSessionsInvariants(database.db)
  })
})
