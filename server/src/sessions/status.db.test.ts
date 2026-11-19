import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import { multipartBody } from '../api/test-multipart.js'
import { TEST_ADMIN, acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { artistsRoutes } from '../artists/routes.js'
import { artistsStore } from '../artists/store.js'
import { memoryPhotos } from '../artists/test-photos.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { sessionsRoutes } from './routes.js'
import { sessionsStore } from './store.js'
import { checkSessionsInvariants } from './test-invariants.js'

// How a session's status and its sets' change each other, against a real database: marking a session done marks its
// planned sets done, a done session that gets a planned set is planned again, and a planned session becomes done once
// its sets are played, even with requests sent at the same time (see "Status" in docs/design/server/sessions.md). The
// property-based tests of rules.db.test.ts check these after random requests too.

// Photos and flyers aren't sent here.
const NO_PHOTOS = memoryPhotos()

// Another admin than the one who adds the sessions, to tell who changed a status.
const OTHER_ADMIN = { ...TEST_ADMIN, id: 'other-admin-id', email: 'other@example.com' }

type Tracked = {
  id: string
  createdAt: string
  updatedAt: string | null
  status: string
  statusUpdatedBy: string | null
  statusUpdatedAt: string | null
}
type Session = Tracked & { sets: Tracked[] }

let database: TestDatabase
let app: FastifyInstance
let artist: string

async function request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, admin = TEST_ADMIN) {
  return app.inject({ method, url, payload, cookies: await sessionCookies(admin) })
}

// A set of Aurore's, as adding one sends it.
const newSet = () => ({
  performers: [{ id: artist }],
  durationMinutes: 60,
  performanceTypes: [],
  otherPerformanceType: '',
  genres: [],
  soundcloudTrack: null,
  youtubeVideo: null,
  application: null,
})

// Adds a session with as many sets as `statuses`, then gives each set its status, in order, and returns the session's id
// and its sets', in order.
async function sessionWithSets(statuses: string[]): Promise<{ session: string; sets: string[] }> {
  const session = { start: null, durationMinutes: 240, type: 'guest-mixes', takeover: null, application: null, name: '', raEvent: null, description: '' }
  const response = await app.inject({
    method: 'POST',
    url: '/api/admin/sessions',
    ...multipartBody({ session: JSON.stringify({ ...session, sets: statuses.map(newSet) }) }),
    cookies: await sessionCookies(),
  })
  expect(response.statusCode).toBe(200)
  const added: Session = response.json().session
  const sets = added.sets.map(({ id }) => id)
  for (const [i, status] of statuses.entries()) {
    if (status !== 'planned') expect((await setStatus(sets[i], status)).statusCode).toBe(200)
  }
  return { session: added.id, sets }
}

const setStatus = (id: string, status: string, admin = TEST_ADMIN) => request('PUT', `/api/admin/sets/${id}/status`, { status }, admin)
const sessionStatus = (id: string, status: string, admin = TEST_ADMIN) => request('PUT', `/api/admin/sessions/${id}/status`, { status }, admin)
const moveTo = (id: string, session: string, admin = TEST_ADMIN) => request('PUT', `/api/admin/sets/${id}/session`, { session }, admin)

async function sessionOf(id: string): Promise<Session> {
  return (await request('GET', `/api/admin/sessions/${id}`)).json().session
}

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

describe('a planned session', () => {
  it('becomes done once none of its sets is planned, a cancelled one counting as finished, as the admin who changed the last one, at the same time', async () => {
    const { sets } = await sessionWithSets(['done', 'planned', 'planned'])
    expect((await setStatus(sets[1], 'cancelled')).json().session.status).toBe('planned')

    const response = await setStatus(sets[2], 'done', OTHER_ADMIN)
    expect(response.statusCode).toBe(200)
    const changed: Session = response.json().session
    expect(changed).toMatchObject({ status: 'done', statusUpdatedBy: OTHER_ADMIN.email, statusUpdatedAt: changed.sets[2].statusUpdatedAt })
    expect(changed.sets[2]).toMatchObject({ status: 'done', statusUpdatedBy: OTHER_ADMIN.email })
    await checkSessionsInvariants(database.db)
  })

  it('becomes done once its last planned set is deleted, which responds with it', async () => {
    const { session, sets } = await sessionWithSets(['done', 'planned'])
    const response = await request('DELETE', `/api/admin/sets/${sets[1]}`, undefined, OTHER_ADMIN)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true, session: { id: session, status: 'done', statusUpdatedBy: OTHER_ADMIN.email, sets: [{ id: sets[0] }] } })
  })

  it("stays planned while none of its sets is done, even when they're all cancelled", async () => {
    const { session, sets } = await sessionWithSets(['cancelled', 'planned'])
    expect((await setStatus(sets[1], 'cancelled')).json().session.status).toBe('planned')
    expect((await request('DELETE', `/api/admin/sets/${sets[1]}`)).json().session.status).toBe('planned')
    expect((await sessionOf(session)).statusUpdatedBy).toBeNull()
  })

  it('becomes done when two of its sets are marked done at the same time', async () => {
    const { session, sets } = await sessionWithSets(['done', 'planned', 'planned'])
    const responses = await Promise.all([setStatus(sets[1], 'done'), setStatus(sets[2], 'done')])
    expect(responses.map(({ statusCode }) => statusCode)).toEqual([200, 200])
    expect((await sessionOf(session)).status).toBe('done')
  })

  it("stays planned once it's marked planned by hand, until one of its sets' status is set, or one of them is deleted", async () => {
    const { session, sets } = await sessionWithSets(['done', 'done', 'done'])
    expect((await sessionStatus(session, 'planned')).json().session.status).toBe('planned')
    // Moving a set doesn't.
    expect((await request('PUT', `/api/admin/sets/${sets[0]}/position`, { position: 2 })).json().session.status).toBe('planned')
    expect((await setStatus(sets[0], 'done')).json().session.status).toBe('done')

    expect((await sessionStatus(session, 'planned')).statusCode).toBe(200)
    expect((await request('DELETE', `/api/admin/sets/${sets[1]}`)).json().session.status).toBe('done')
  })
})

describe('a session that is done', () => {
  it('is planned again when one of its sets is, from done or from cancelled, as the admin who did it, at the same time', async () => {
    const { session, sets } = await sessionWithSets(['done', 'cancelled'])
    expect((await sessionOf(session)).status).toBe('done')
    const changed: Session = (await setStatus(sets[0], 'planned', OTHER_ADMIN)).json().session
    expect(changed).toMatchObject({ status: 'planned', statusUpdatedBy: OTHER_ADMIN.email, statusUpdatedAt: changed.sets[0].statusUpdatedAt })
    // Undoing that makes it done again.
    expect((await setStatus(sets[0], 'done')).json().session.status).toBe('done')
    expect((await setStatus(sets[1], 'planned')).json().session.status).toBe('planned')
    await checkSessionsInvariants(database.db)
  })

  it('is planned again when a set is added to it, as the admin who added it, when they did, and done again once that set is', async () => {
    const { session } = await sessionWithSets(['done'])
    const changed: Session = (await request('POST', `/api/admin/sessions/${session}/sets`, newSet(), OTHER_ADMIN)).json().session
    const added = changed.sets[1]
    expect(changed).toMatchObject({ status: 'planned', statusUpdatedBy: OTHER_ADMIN.email, statusUpdatedAt: added.createdAt })
    await checkSessionsInvariants(database.db)
    expect((await setStatus(added.id, 'done')).json().session.status).toBe('done')
  })
})

describe('marking a session done', () => {
  it('marks its planned sets done, as the same admin, at the same time, and leaves the others as they are', async () => {
    const { session, sets } = await sessionWithSets(['done', 'cancelled', 'planned', 'planned'])
    const before = await sessionOf(session)
    const response = await sessionStatus(session, 'done', OTHER_ADMIN)
    expect(response.statusCode).toBe(200)
    const changed: Session = response.json().session
    const marked = { status: 'done', statusUpdatedBy: OTHER_ADMIN.email, statusUpdatedAt: changed.statusUpdatedAt }
    expect(changed).toMatchObject(marked)
    expect(changed.sets).toEqual([
      expect.objectContaining(before.sets[0]),
      expect.objectContaining(before.sets[1]),
      expect.objectContaining({ id: sets[2], ...marked }),
      expect.objectContaining({ id: sets[3], ...marked }),
    ])

    // Planning it again leaves them as they are.
    const planned: Session = (await sessionStatus(session, 'planned')).json().session
    expect(planned.sets.map(({ status }) => status)).toEqual(['done', 'cancelled', 'done', 'done'])
  })

  it("marks none of a cancelled session's sets, which are all cancelled", async () => {
    const { session } = await sessionWithSets(['done', 'planned'])
    expect((await sessionStatus(session, 'cancelled')).statusCode).toBe(200)
    const done: Session = (await sessionStatus(session, 'done')).json().session
    expect(done.sets.map(({ status }) => status)).toEqual(['cancelled', 'cancelled'])
    await checkSessionsInvariants(database.db)
  })
})

describe('moving a set to another session', () => {
  it('makes the session it leaves follow its sets, as if it were deleted, and the one it joins, as if it were added, as the admin who moved it, when they did', async () => {
    const from = await sessionWithSets(['done', 'planned'])
    const to = await sessionWithSets(['done'])
    const response = await moveTo(from.sets[1], to.session, OTHER_ADMIN)
    expect(response.statusCode).toBe(200)
    const { session, previousSession }: { session: Session; previousSession: Session } = response.json()
    const moved = session.sets[1]
    // The set keeps its status, but counts as changed.
    expect(moved).toMatchObject({ id: from.sets[1], status: 'planned', statusUpdatedBy: null })
    const marked = { statusUpdatedBy: OTHER_ADMIN.email, statusUpdatedAt: moved.updatedAt }
    expect(previousSession).toMatchObject({ id: from.session, status: 'done', ...marked })
    expect(session).toMatchObject({ id: to.session, status: 'planned', ...marked })
    await checkSessionsInvariants(database.db)
  })

  it('makes a planned session done when a done set is moved into it, even without other sets', async () => {
    const from = await sessionWithSets(['done', 'planned'])
    const empty = await sessionWithSets([])
    const planned = await sessionWithSets(['planned'])
    let response = await moveTo(from.sets[0], empty.session)
    expect(response.json().session.status).toBe('done')
    // And not one that has a planned set, while the one it leaves still has one.
    response = await moveTo(response.json().session.sets[0].id, planned.session)
    expect(response.json().session.status).toBe('planned')
    expect(response.json().previousSession).toMatchObject({ id: empty.session, status: 'done', sets: [] })
    expect((await sessionOf(from.session)).status).toBe('planned')
    await checkSessionsInvariants(database.db)
  })

  it("doesn't move a set that isn't cancelled into a cancelled session, but moves a cancelled one anywhere, still cancelled", async () => {
    const cancelled = await sessionWithSets(['planned', 'done'])
    expect((await sessionStatus(cancelled.session, 'cancelled')).statusCode).toBe(200)
    const other = await sessionWithSets(['planned', 'cancelled'])
    for (const status of ['planned', 'done']) {
      expect((await setStatus(other.sets[0], status)).statusCode).toBe(200)
      const response = await moveTo(other.sets[0], cancelled.session)
      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: 'This session is cancelled', session: { id: cancelled.session, status: 'cancelled' }, set: null })
    }
    expect((await sessionOf(other.session)).sets.map(({ id }) => id)).toEqual(other.sets)

    let response = await moveTo(other.sets[1], cancelled.session)
    expect(response.statusCode).toBe(200)
    expect(response.json().session.sets.map(({ status }: Tracked) => status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
    // Out of the cancelled session, it stays cancelled too, to be un-cancelled by hand.
    response = await moveTo(cancelled.sets[1], other.session)
    expect(response.statusCode).toBe(200)
    expect(response.json().session.sets[1]).toMatchObject({ id: cancelled.sets[1], status: 'cancelled' })
    expect(response.json().session.status).toBe('done')
    await checkSessionsInvariants(database.db)
  })

  it("doesn't change any status when the set is moved to the session it's in", async () => {
    const { session, sets } = await sessionWithSets(['done', 'done'])
    expect((await sessionStatus(session, 'planned')).statusCode).toBe(200)
    const response = await moveTo(sets[0], session, OTHER_ADMIN)
    expect(response.statusCode).toBe(200)
    expect(response.json().session).toMatchObject({ status: 'planned', statusUpdatedBy: TEST_ADMIN.email })
  })
})

