import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { sql } from 'drizzle-orm'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import { multipartBody } from '../api/test-multipart.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { applicationsRoutes } from '../applications/routes.js'
import { applicationsSettingsStore } from '../applications/settings.js'
import { applicationsStore } from '../applications/store.js'
import { artistsRoutes } from '../artists/routes.js'
import { artistsStore } from '../artists/store.js'
import { memoryPhotos } from '../artists/test-photos.js'
import { collectivesRoutes } from '../collectives/routes.js'
import { collectivesStore } from '../collectives/store.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { REJECTED_APPLICATION } from '../applications/fields.js'
import { NOT_THE_SESSIONS_APPLICATION, NOT_THE_SETS_APPLICATION } from './fields.js'
import { sessionsRoutes } from './routes.js'
import { sessionsStore } from './store.js'
import { checkSessionsInvariants } from './test-invariants.js'

// The applications that sets and sessions come from, against a real database: the rules of what a set's or a session's
// application can be, checked on the set or the session as it would then be, what deleting an application or an artist
// does to them, what applications list of them, the statuses they give applications, and what a rejected application
// keeps them from (see "Applications" in docs/design/server/sessions.md, and "Status" in
// docs/design/server/applications.md).

// Photos and flyers aren't sent here.
const NO_PHOTOS = memoryPhotos()

let database: TestDatabase
let app: FastifyInstance

async function request(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies: await sessionCookies() })
}

async function sendForm(url: string, part: string, fields: object) {
  return app.inject({ method: 'POST', url, ...multipartBody({ [part]: JSON.stringify(fields) }), cookies: await sessionCookies() })
}

async function createArtist(name: string): Promise<string> {
  return (await sendForm('/api/admin/artists', 'artist', { name })).json().artist.id
}

async function createCollective(name: string, members: object[]): Promise<string> {
  return (await sendForm('/api/admin/collectives', 'collective', { name, members })).json().collective.id
}

// Adds an application for the artist or the collective, received on `receivedAt`, and returns its id.
async function createApplication(owner: { artistId: string } | { collectiveId: string }, receivedAt = '2026-10-01T12:00-04:00'): Promise<string> {
  const fields = { dates: ['2026-11-14'], timeSlots: [], performanceTypes: [], otherPerformanceType: '', details: '', receivedAt }
  const response = await request('POST', '/api/admin/applications', { ...fields, ...owner })
  expect(response.statusCode).toBe(200)
  return response.json().application.id
}

async function createSession(fields: object) {
  const session = { start: '2026-11-14T21:00-05:00', durationMinutes: 180, type: 'guest-mixes', takeover: null, application: null, name: '', raEvent: null, description: '', ...fields }
  return sendForm('/api/admin/sessions', 'session', session)
}

async function addSet(sessionId: string, fields: object) {
  const set = { performers: [], durationMinutes: null, performanceTypes: [], otherPerformanceType: '', genres: [], soundcloudTrack: null, youtubeVideo: null, application: null, ...fields }
  return request('POST', `/api/admin/sessions/${sessionId}/sets`, set)
}

async function sessionId(fields: object): Promise<string> {
  const response = await createSession(fields)
  expect(response.statusCode).toBe(200)
  return response.json().session.id
}

// Adds a set to the session, and returns its id.
async function setId(sessionId: string, fields: object): Promise<string> {
  const response = await addSet(sessionId, fields)
  expect(response.statusCode).toBe(200)
  return response.json().session.sets.at(-1).id
}

async function application(id: string) {
  return (await request('GET', `/api/admin/applications/${id}`)).json().application
}

// The statuses of the applications `ids`, in order.
async function statuses(...ids: string[]) {
  return Promise.all(ids.map(async (id) => (await application(id)).status))
}

// What admins decide about the application `id`.
async function decide(id: string, decision: string) {
  return request('PUT', `/api/admin/applications/${id}/decision`, { decision })
}

function expectError(response: { statusCode: number; json(): unknown }, error: string) {
  expect(response.statusCode).toBe(400)
  expect(response.json()).toEqual({ ok: false, error })
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret'
  database = await testDatabase()
  app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  const sessions = sessionsStore(database.db)
  await app.register(sessionsRoutes, { store: sessions, photos: NO_PHOTOS, resolveTrack: async () => null })
  await app.register(artistsRoutes, { store: artistsStore(database.db), photos: NO_PHOTOS })
  await app.register(collectivesRoutes, { store: collectivesStore(database.db), photos: NO_PHOTOS })
  await app.register(applicationsRoutes, { store: applicationsStore(database.db), settings: applicationsSettingsStore(database.db), sessions })
})

afterAll(async () => {
  await app?.close()
  await database?.drop()
})

beforeEach(async () => {
  await database.db.execute(sql`truncate sessions, artists, collectives cascade`)
})

describe("a set's application", () => {
  it("is one of its performers' applications, which lists it, with its session", async () => {
    const [aurore, brume] = [await createArtist('Aurore'), await createArtist('Brume')]
    const applied = await createApplication({ artistId: aurore })
    const session = await sessionId({ name: 'SOIRÉE' })
    const response = await addSet(session, { performers: [{ id: brume }, { id: aurore }], durationMinutes: 60, application: applied.toUpperCase() })
    expect(response.statusCode).toBe(200)
    const set = response.json().session.sets[0]
    expect(set.application).toEqual({ id: applied, receivedAt: '2026-10-01T12:00:00-04:00' })
    expect(await application(applied)).toMatchObject({
      sets: [{ id: set.id, durationMinutes: 60, status: 'planned', session: { id: session, title: 'SOIRÉE', start: '2026-11-14T21:00:00-05:00' } }],
      sessions: [],
      // It doesn't count as changing the application.
      updatedBy: null,
    })
    await checkSessionsInvariants(database.db)
  })

  it("can't be a collective's application, another artist's, or one that doesn't exist", async () => {
    const [aurore, brume] = [await createArtist('Aurore'), await createArtist('Brume')]
    const collective = await createCollective('Haute Rive', [{ id: aurore }])
    const session = await sessionId({})
    const performers = [{ id: aurore }]
    expectError(await addSet(session, { performers, application: await createApplication({ collectiveId: collective }) }), NOT_THE_SETS_APPLICATION)
    expectError(await addSet(session, { performers, application: await createApplication({ artistId: brume }) }), NOT_THE_SETS_APPLICATION)
    expectError(await addSet(session, { performers, application: '00000000-0000-4000-8000-000000000000' }), 'No such application')
    expectError(await addSet(session, { performers, application: 'not-a-uuid' }), 'No such application')
    // A performer that doesn't exist is said first.
    expectError(await addSet(session, { performers: [{ id: 'not-a-uuid' }], application: 'not-a-uuid' }), 'No such artist')
    expect((await request('GET', `/api/admin/sessions/${session}`)).json().session.sets).toEqual([])
  })

  it('is checked against the performers it already has when a change only sends it, and the other way around', async () => {
    const [aurore, brume] = [await createArtist('Aurore'), await createArtist('Brume')]
    const [auroreApplied, brumeApplied] = [await createApplication({ artistId: aurore }), await createApplication({ artistId: brume })]
    const session = await sessionId({})
    const set = await setId(session, { performers: [{ id: aurore }] })

    expectError(await request('PATCH', `/api/admin/sets/${set}`, { application: brumeApplied }), NOT_THE_SETS_APPLICATION)
    const linked = await request('PATCH', `/api/admin/sets/${set}`, { application: auroreApplied })
    expect(linked.statusCode).toBe(200)
    expect(linked.json().session.sets[0]).toMatchObject({ application: { id: auroreApplied }, updatedBy: 'admin@example.com' })

    // Its performers alone, which must still have the application's artist.
    expectError(await request('PATCH', `/api/admin/sets/${set}`, { performers: [{ id: brume }] }), NOT_THE_SETS_APPLICATION)
    const both = await request('PATCH', `/api/admin/sets/${set}`, { performers: [{ id: brume }, { id: aurore }] })
    expect(both.json().session.sets[0]).toMatchObject({ performers: [{ id: brume }, { id: aurore }], application: { id: auroreApplied } })
    // Or with another application, or none, in the same request.
    const replaced = await request('PATCH', `/api/admin/sets/${set}`, { performers: [{ id: brume }], application: brumeApplied })
    expect(replaced.json().session.sets[0]).toMatchObject({ performers: [{ id: brume }], application: { id: brumeApplied } })
    const removed = await request('PATCH', `/api/admin/sets/${set}`, { performers: [{ id: aurore }], application: null })
    expect(removed.json().session.sets[0]).toMatchObject({ performers: [{ id: aurore }], application: null })

    // A change that fails leaves the set as it was.
    await request('PATCH', `/api/admin/sets/${set}`, { application: auroreApplied })
    const before = (await request('GET', `/api/admin/sessions/${session}`)).json().session.sets[0]
    expectError(await request('PATCH', `/api/admin/sets/${set}`, { performers: [{ id: brume }], genres: ['ambient'] }), NOT_THE_SETS_APPLICATION)
    expect((await request('GET', `/api/admin/sessions/${session}`)).json().session.sets[0]).toEqual(before)
    await checkSessionsInvariants(database.db)
  })

  it("can be several sets', e.g. a cancelled set's and the one that replaces it, which the application lists in order", async () => {
    const aurore = await createArtist('Aurore')
    const applied = await createApplication({ artistId: aurore })
    const later = await sessionId({ start: '2026-11-21T21:00-05:00', name: 'PLUS TARD' })
    const undated = await sessionId({ start: null, name: 'UN JOUR' })
    const first = await sessionId({ name: 'ANNULÉE' })
    const cancelled = await setId(first, { performers: [{ id: aurore }], application: applied })
    expect((await request('PUT', `/api/admin/sets/${cancelled}/status`, { status: 'cancelled' })).statusCode).toBe(200)
    const rebooked = await setId(later, { performers: [{ id: aurore }], durationMinutes: 60, application: applied })
    const someday = await setId(undated, { performers: [{ id: aurore }], application: applied })

    const { sets } = await application(applied)
    // In the order of the list of sessions: those without a start first, then the most recent first.
    expect(sets).toEqual([
      { id: someday, durationMinutes: null, status: 'planned', session: { id: undated, title: 'UN JOUR', start: null } },
      { id: rebooked, durationMinutes: 60, status: 'planned', session: { id: later, title: 'PLUS TARD', start: '2026-11-21T21:00:00-05:00' } },
      { id: cancelled, durationMinutes: null, status: 'cancelled', session: { id: first, title: 'ANNULÉE', start: '2026-11-14T21:00:00-05:00' } },
    ])
    const listed = (await request('GET', `/api/admin/applications?artist=${aurore}`)).json().applications
    expect(listed).toEqual([expect.objectContaining({ id: applied, sets, sessions: [] })])
  })
})

describe("a session's application", () => {
  it("is the application of the collective whose takeover it is, which lists it", async () => {
    const aurore = await createArtist('Aurore')
    const collective = await createCollective('Haute Rive', [{ id: aurore }])
    const applied = await createApplication({ collectiveId: collective })
    const response = await createSession({ type: 'takeover', takeover: collective, application: applied })
    expect(response.statusCode).toBe(200)
    const { id } = response.json().session
    expect(response.json().session.application).toEqual({ id: applied, receivedAt: '2026-10-01T12:00:00-04:00' })
    expect(await application(applied)).toMatchObject({
      sets: [],
      sessions: [{ id, title: 'HAUTE RIVE TAKEOVER', start: '2026-11-14T21:00:00-05:00', end: '2026-11-15T00:00:00-05:00', durationMinutes: 180, status: 'planned' }],
    })
    await checkSessionsInvariants(database.db)
  })

  it("can't be an artist's application, another collective's, one that doesn't exist, or that of a session of another type", async () => {
    const aurore = await createArtist('Aurore')
    const [collective, other] = [await createCollective('Haute Rive', [{ id: aurore }]), await createCollective('Les Ondes', [{ id: aurore }])]
    const takeover = { type: 'takeover', takeover: collective }
    expectError(await createSession({ ...takeover, application: await createApplication({ artistId: aurore }) }), NOT_THE_SESSIONS_APPLICATION)
    expectError(await createSession({ ...takeover, application: await createApplication({ collectiveId: other }) }), NOT_THE_SESSIONS_APPLICATION)
    expectError(await createSession({ ...takeover, application: '00000000-0000-4000-8000-000000000000' }), 'No such application')
    const applied = await createApplication({ collectiveId: collective })
    expectError(await createSession({ application: applied }), 'Only a takeover has an application')
    // The collective is checked first.
    expectError(await createSession({ type: 'takeover', takeover: '00000000-0000-4000-8000-000000000000', application: applied }), 'No such collective')
    expect((await request('GET', '/api/admin/sessions')).json().sessions).toEqual([])
  })

  it('takes changing its type or its collective to send another application, or none, in the same request', async () => {
    const aurore = await createArtist('Aurore')
    const [collective, other] = [await createCollective('Haute Rive', [{ id: aurore }]), await createCollective('Les Ondes', [{ id: aurore }])]
    const [applied, othersApplied] = [await createApplication({ collectiveId: collective }), await createApplication({ collectiveId: other })]
    const id = await sessionId({ type: 'takeover', takeover: collective })

    // Its application alone is checked against the collective it has.
    expectError(await request('PATCH', `/api/admin/sessions/${id}`, { application: othersApplied }), NOT_THE_SESSIONS_APPLICATION)
    expect((await request('PATCH', `/api/admin/sessions/${id}`, { application: applied })).statusCode).toBe(200)

    // Its collective, or its type, alone, are checked against the application it has.
    expectError(await request('PATCH', `/api/admin/sessions/${id}`, { takeover: other }), NOT_THE_SESSIONS_APPLICATION)
    expectError(await request('PATCH', `/api/admin/sessions/${id}`, { type: 'guest-mixes', takeover: null }), 'Only a takeover has an application')
    const kept = (await request('GET', `/api/admin/sessions/${id}`)).json().session
    expect(kept).toMatchObject({ type: 'takeover', takeover: { id: collective }, application: { id: applied } })

    const moved = await request('PATCH', `/api/admin/sessions/${id}`, { takeover: other, application: othersApplied })
    expect(moved.json().session).toMatchObject({ takeover: { id: other }, application: { id: othersApplied } })
    const changed = await request('PATCH', `/api/admin/sessions/${id}`, { type: 'guest-mixes', takeover: null, application: null })
    expect(changed.json().session).toMatchObject({ type: 'guest-mixes', takeover: null, application: null })
    await checkSessionsInvariants(database.db)
  })
})

describe("the application's status", () => {
  it("is worked out from its sets and sessions, while what was decided, and who decided it, stay as they are", async () => {
    const aurore = await createArtist('Aurore')
    const collective = await createCollective('Haute Rive', [{ id: aurore }])
    const [artists, collectives] = [await createApplication({ artistId: aurore }), await createApplication({ collectiveId: collective })]
    for (const id of [artists, collectives]) {
      expect((await decide(id, 'accepted')).statusCode).toBe(200)
      expect((await request('PATCH', `/api/admin/applications/${id}`, { details: 'Changée.' })).statusCode).toBe(200)
    }
    const tracked = async (id: string) => {
      const { decision, decisionUpdatedBy, decisionUpdatedAt, updatedBy, updatedAt } = await application(id)
      return { decision, decisionUpdatedBy, decisionUpdatedAt, updatedBy, updatedAt }
    }
    const before = [await tracked(artists), await tracked(collectives)]
    expect(before[0]).toMatchObject({ decision: 'accepted', decisionUpdatedBy: 'admin@example.com', updatedBy: 'admin@example.com' })
    expect(await statuses(artists, collectives)).toEqual(['accepted', 'accepted'])

    const session = await sessionId({ type: 'takeover', takeover: collective, application: collectives })
    const set = await setId(session, { performers: [{ id: aurore }], application: artists })
    expect(await statuses(artists, collectives)).toEqual(['planned', 'planned'])
    expect((await request('PATCH', `/api/admin/sets/${set}`, { application: null })).statusCode).toBe(200)
    expect((await request('PATCH', `/api/admin/sessions/${session}`, { application: null })).statusCode).toBe(200)
    expect(await statuses(artists, collectives)).toEqual(['accepted', 'accepted'])
    expect((await request('PATCH', `/api/admin/sets/${set}`, { application: artists })).statusCode).toBe(200)
    expect((await request('PATCH', `/api/admin/sessions/${session}`, { application: collectives })).statusCode).toBe(200)
    // Marking the session done marks its set done.
    expect((await request('PUT', `/api/admin/sessions/${session}/status`, { status: 'done' })).statusCode).toBe(200)
    expect(await statuses(artists, collectives)).toEqual(['done', 'done'])
    expect([await tracked(artists), await tracked(collectives)]).toEqual(before)
    expect((await request('DELETE', `/api/admin/sets/${set}`)).statusCode).toBe(200)
    expect((await request('DELETE', `/api/admin/sessions/${session}`)).statusCode).toBe(200)
    expect(await statuses(artists, collectives)).toEqual(['accepted', 'accepted'])
    expect([await tracked(artists), await tracked(collectives)]).toEqual(before)
  })

  it('is planned while one of its sets is, even with one that is done, then accepted once they are all cancelled, and new without any', async () => {
    const aurore = await createArtist('Aurore')
    const applied = await createApplication({ artistId: aurore })
    const status = async () => (await application(applied)).status
    expect(await status()).toBe('new')
    const first = await sessionId({ name: 'PREMIÈRE' })
    const played = await setId(first, { performers: [{ id: aurore }], application: applied })
    expect(await status()).toBe('planned')
    expect((await request('PUT', `/api/admin/sets/${played}/status`, { status: 'done' })).statusCode).toBe(200)
    expect(await status()).toBe('done')
    // Booked again, in a session without a date.
    const again = await setId(await sessionId({ start: null, name: 'UN JOUR' }), { performers: [{ id: aurore }], application: applied })
    expect(await status()).toBe('planned')
    expect((await request('PUT', `/api/admin/sets/${again}/status`, { status: 'cancelled' })).statusCode).toBe(200)
    expect(await status()).toBe('done')
    expect((await request('DELETE', `/api/admin/sets/${played}`)).statusCode).toBe(200)
    expect(await status()).toBe('accepted')
    expect((await request('DELETE', `/api/admin/sets/${again}`)).statusCode).toBe(200)
    expect(await status()).toBe('new')
  })
})

describe('a rejected application', () => {
  function expectConflict(response: { statusCode: number; json(): unknown }) {
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ ok: false, error: REJECTED_APPLICATION, session: null, set: null })
  }

  it("can't be rejected while it has a set or a session that's planned or done, but can with only cancelled ones, which keep it", async () => {
    const aurore = await createArtist('Aurore')
    const collective = await createCollective('Haute Rive', [{ id: aurore }])
    const [artists, collectives] = [await createApplication({ artistId: aurore }), await createApplication({ collectiveId: collective })]
    const session = await sessionId({ type: 'takeover', takeover: collective, application: collectives })
    const set = await setId(session, { performers: [{ id: aurore }], application: artists })
    for (const status of ['planned', 'done']) {
      expect((await request('PUT', `/api/admin/sessions/${session}/status`, { status })).statusCode).toBe(200)
      for (const id of [artists, collectives]) {
        const response = await decide(id, 'rejected')
        expect(response.statusCode).toBe(409)
        expect(response.json()).toEqual({ ok: false, error: REJECTED_APPLICATION })
        expect(await application(id)).toMatchObject({ status, decision: 'new', decisionUpdatedBy: null })
      }
    }
    // Cancelling the session cancels its set.
    expect((await request('PUT', `/api/admin/sessions/${session}/status`, { status: 'cancelled' })).statusCode).toBe(200)
    for (const id of [artists, collectives]) {
      expect((await decide(id, 'rejected')).json().application).toMatchObject({ status: 'rejected', decisionUpdatedBy: 'admin@example.com' })
    }
    const { session: kept } = (await request('GET', `/api/admin/sessions/${session}`)).json()
    expect(kept).toMatchObject({ application: { id: collectives }, sets: [{ id: set, application: { id: artists } }] })
    await checkSessionsInvariants(database.db)
  })

  it("can't be given to a set or a session that's planned or done, but can to a cancelled one, which can then still be changed", async () => {
    const aurore = await createArtist('Aurore')
    const collective = await createCollective('Haute Rive', [{ id: aurore }])
    const [artists, collectives] = [await createApplication({ artistId: aurore }), await createApplication({ collectiveId: collective })]
    for (const id of [artists, collectives]) expect((await decide(id, 'rejected')).statusCode).toBe(200)
    const performers = [{ id: aurore }]

    expectError(await createSession({ type: 'takeover', takeover: collective, application: collectives }), REJECTED_APPLICATION)
    const withSets = await createSession({ sets: [{ performers, durationMinutes: 60, performanceTypes: [], otherPerformanceType: '', genres: [], soundcloudTrack: null, youtubeVideo: null, application: artists }] })
    expect(withSets.statusCode).toBe(400)
    expect(withSets.json()).toEqual({ ok: false, error: REJECTED_APPLICATION, setIndex: 0 })
    const session = await sessionId({ type: 'takeover', takeover: collective })
    expectError(await addSet(session, { performers, application: artists }), REJECTED_APPLICATION)
    const set = await setId(session, { performers })
    expectError(await request('PATCH', `/api/admin/sets/${set}`, { application: artists }), REJECTED_APPLICATION)
    expectError(await request('PATCH', `/api/admin/sessions/${session}`, { application: collectives }), REJECTED_APPLICATION)
    expect((await request('PUT', `/api/admin/sets/${set}/status`, { status: 'done' })).statusCode).toBe(200)
    expectError(await request('PATCH', `/api/admin/sets/${set}`, { application: artists }), REJECTED_APPLICATION)

    // Once cancelled, they can have it, and be changed with it, e.g. as forms send it back.
    expect((await request('PUT', `/api/admin/sessions/${session}/status`, { status: 'cancelled' })).statusCode).toBe(200)
    expect((await request('PATCH', `/api/admin/sets/${set}`, { application: artists })).statusCode).toBe(200)
    expect((await request('PATCH', `/api/admin/sessions/${session}`, { application: collectives })).statusCode).toBe(200)
    expect((await request('PATCH', `/api/admin/sets/${set}`, { durationMinutes: 45, application: artists })).statusCode).toBe(200)
    expect((await request('PATCH', `/api/admin/sessions/${session}`, { durationMinutes: 90 })).statusCode).toBe(200)
    expect(await application(artists)).toMatchObject({ status: 'rejected', sets: [{ id: set, status: 'cancelled' }] })
    await checkSessionsInvariants(database.db)
  })

  it("keeps its cancelled sets and sessions from being un-cancelled, or marked done, until it isn't rejected anymore, while they can still be moved", async () => {
    const aurore = await createArtist('Aurore')
    const collective = await createCollective('Haute Rive', [{ id: aurore }])
    const [artists, collectives] = [await createApplication({ artistId: aurore }), await createApplication({ collectiveId: collective })]
    const session = await sessionId({ type: 'takeover', takeover: collective, application: collectives })
    const set = await setId(session, { performers: [{ id: aurore }], application: artists })
    const other = await sessionId({ start: '2026-11-21T21:00-05:00' })
    const kept = await setId(other, { performers: [{ id: aurore }] })
    expect((await request('PUT', `/api/admin/sessions/${session}/status`, { status: 'cancelled' })).statusCode).toBe(200)
    for (const id of [artists, collectives]) expect((await decide(id, 'rejected')).statusCode).toBe(200)

    for (const status of ['planned', 'done']) expectConflict(await request('PUT', `/api/admin/sessions/${session}/status`, { status }))
    // Its set is in a cancelled session, which is in the way first, then in another session.
    const moved = await request('PUT', `/api/admin/sets/${set}/session`, { session: other })
    expect(moved.statusCode).toBe(200)
    expect(moved.json().session.sets.map(({ id, status }: { id: string; status: string }) => [id, status])).toEqual([[kept, 'planned'], [set, 'cancelled']])
    for (const status of ['planned', 'done']) expectConflict(await request('PUT', `/api/admin/sets/${set}/status`, { status }))
    // Cancelling them again changes nothing.
    expect((await request('PUT', `/api/admin/sets/${set}/status`, { status: 'cancelled' })).statusCode).toBe(200)
    expect((await request('PUT', `/api/admin/sessions/${session}/status`, { status: 'cancelled' })).statusCode).toBe(200)
    await checkSessionsInvariants(database.db)

    for (const [id, decision] of [[artists, 'accepted'], [collectives, 'new']]) expect((await decide(id, decision)).statusCode).toBe(200)
    expect((await request('PUT', `/api/admin/sets/${set}/status`, { status: 'planned' })).statusCode).toBe(200)
    expect((await request('PUT', `/api/admin/sessions/${session}/status`, { status: 'planned' })).statusCode).toBe(200)
    expect(await statuses(artists, collectives)).toEqual(['planned', 'planned'])
  })

  // Whichever goes second finds the other done, and fails.
  it('is either rejected or has a set that is planned, never both, even when both are asked at the same time', async () => {
    const aurore = await createArtist('Aurore')
    const session = await sessionId({})
    const set = await setId(session, { performers: [{ id: aurore }] })
    // Each way of giving the application a planned set, which `prepare` readies, then the request that races its rejection,
    // which fails with 409 when it comes second, or with 400 when it gives a planned set the application.
    const ways: Record<string, { prepare?: (applied: string) => Promise<void>; book: (applied: string) => Promise<LightMyRequestResponse>; fails: number }> = {
      'un-cancelling its set': {
        prepare: async (applied: string) => {
          await request('PATCH', `/api/admin/sets/${set}`, { application: applied })
          await request('PUT', `/api/admin/sets/${set}/status`, { status: 'cancelled' })
        },
        book: () => request('PUT', `/api/admin/sets/${set}/status`, { status: 'planned' }),
        fails: 409,
      },
      'giving it to a planned set': {
        book: (applied: string) => request('PATCH', `/api/admin/sets/${set}`, { application: applied }),
        fails: 400,
      },
      'adding a set with it': {
        book: (applied: string) => addSet(session, { performers: [{ id: aurore }], application: applied }),
        fails: 400,
      },
    }
    for (const [way, { prepare, book, fails }] of Object.entries(ways)) {
      for (let i = 0; i < 10; i++) {
        const applied = await createApplication({ artistId: aurore })
        await prepare?.(applied)
        const [booked, rejected] = await Promise.all([book(applied), decide(applied, 'rejected')])
        if (booked.statusCode === 200) expect(rejected.statusCode, way).toBe(409)
        else {
          expect([booked.statusCode, rejected.statusCode], way).toEqual([fails, 200])
          expect(booked.json().error, way).toBe(REJECTED_APPLICATION)
        }
        await checkSessionsInvariants(database.db)
        // The set is free again for the next run.
        await request('PATCH', `/api/admin/sets/${set}`, { application: null })
        await request('PUT', `/api/admin/sets/${set}/status`, { status: 'planned' })
      }
    }
  })
})

describe('deleting', () => {
  it('an application takes it from its sets and sessions, which stay, without counting as a change', async () => {
    const aurore = await createArtist('Aurore')
    const collective = await createCollective('Haute Rive', [{ id: aurore }])
    const [artists, collectives] = [await createApplication({ artistId: aurore }), await createApplication({ collectiveId: collective })]
    const id = await sessionId({ type: 'takeover', takeover: collective, application: collectives })
    await setId(id, { performers: [{ id: aurore }], application: artists })

    expect((await request('DELETE', `/api/admin/applications/${artists}`)).statusCode).toBe(200)
    expect((await request('DELETE', `/api/admin/applications/${collectives}`)).statusCode).toBe(200)
    const { session } = (await request('GET', `/api/admin/sessions/${id}`)).json()
    expect(session).toMatchObject({ application: null, updatedBy: null, sets: [{ performers: [{ id: aurore }], application: null, updatedBy: null }] })
  })

  it("an artist takes their applications from their sets, and a set or a session leaves its application as it is", async () => {
    const [aurore, brume] = [await createArtist('Aurore'), await createArtist('Brume')]
    const collective = await createCollective('Haute Rive', [{ id: aurore }])
    const [auroreApplied, brumeApplied] = [await createApplication({ artistId: aurore }), await createApplication({ artistId: brume })]
    const collectives = await createApplication({ collectiveId: collective })
    const id = await sessionId({ type: 'takeover', takeover: collective, application: collectives })
    const kept = await setId(id, { performers: [{ id: aurore }, { id: brume }], application: brumeApplied })
    const lost = await setId(id, { performers: [{ id: brume }, { id: aurore }], application: auroreApplied })

    expect((await request('DELETE', `/api/admin/artists/${aurore}`)).statusCode).toBe(200)
    const { session } = (await request('GET', `/api/admin/sessions/${id}`)).json()
    expect(session.sets).toEqual([
      expect.objectContaining({ id: kept, application: expect.objectContaining({ id: brumeApplied }) }),
      expect.objectContaining({ id: lost, application: null }),
    ])

    expect((await request('DELETE', `/api/admin/sets/${kept}`)).statusCode).toBe(200)
    expect((await request('DELETE', `/api/admin/sessions/${id}`)).statusCode).toBe(200)
    expect(await application(brumeApplied)).toMatchObject({ id: brumeApplied, sets: [] })
    expect(await application(collectives)).toMatchObject({ id: collectives, sessions: [] })
  })

  it('an application while sets are given it leaves either the set with it or the application gone, never a broken rule', async () => {
    const aurore = await createArtist('Aurore')
    const session = await sessionId({})
    const set = await setId(session, { performers: [{ id: aurore }] })
    for (let i = 0; i < 10; i++) {
      const applied = await createApplication({ artistId: aurore })
      const [linked, deleted] = await Promise.all([
        request('PATCH', `/api/admin/sets/${set}`, { application: applied }),
        request('DELETE', `/api/admin/applications/${applied}`),
      ])
      expect(deleted.statusCode).toBe(200)
      // Either it was given the application, which deleting it then took away, or it found it deleted.
      if (linked.statusCode !== 200) expect(linked.json()).toEqual({ ok: false, error: 'No such application' })
      expect((await request('GET', `/api/admin/sessions/${session}`)).json().session.sets[0].application).toBeNull()
      await checkSessionsInvariants(database.db)
    }
  })
})
