import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import { multipartBody } from '../api/test-multipart.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { artistsRoutes } from '../artists/routes.js'
import { artistsStore } from '../artists/store.js'
import { NO_PHOTOS } from '../artists/test-photos.js'
import { collectivesRoutes } from '../collectives/routes.js'
import { collectivesStore } from '../collectives/store.js'
import { artists, collectiveMembers } from '../db/schema.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { sessionsRoutes } from './routes.js'
import { sessionsStore } from './store.js'
import { checkSessionsInvariants } from './test-invariants.js'

// Changing some of the fields of sessions, sets and collectives with PATCH, against a real database: the stores apply the
// changes to what's saved, in the transaction that saves them, and check the rules on the result (see "Changes" in
// docs/design/server/README.md). The property-based tests of rules.db.test.ts send random PATCHes too.

const TRACK = 'https://soundcloud.com/parkingdotradio/3tons'

let database: TestDatabase
let app: FastifyInstance
// How many times SoundCloud was asked to resolve a track.
let resolved = 0

async function request(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies: await sessionCookies() })
}

async function sendForm(method: 'POST' | 'PUT', url: string, part: string, fields: object) {
  return app.inject({ method, url, ...multipartBody({ [part]: JSON.stringify(fields) }), cookies: await sessionCookies() })
}

async function createArtist(name: string): Promise<string> {
  return (await sendForm('POST', '/api/admin/artists', 'artist', { name })).json().artist.id
}

async function createCollective(name: string, members: object[]): Promise<string> {
  const response = await sendForm('POST', '/api/admin/collectives', 'collective', { name, members })
  expect(response.statusCode).toBe(200)
  return response.json().collective.id
}

async function createSession(fields: object): Promise<string> {
  const session = { start: '2026-11-14T21:00-05:00', durationMinutes: 120, type: 'guest-mixes', takeover: null, application: null, name: '', raEvent: null, description: '', ...fields }
  const response = await sendForm('POST', '/api/admin/sessions', 'session', session)
  expect(response.statusCode).toBe(200)
  return response.json().session.id
}

// Adds a set to the session, and returns its id.
async function createSet(sessionId: string, fields: object): Promise<string> {
  const set = { performers: [], durationMinutes: null, performanceTypes: [], otherPerformanceType: '', genres: [], soundcloudTrack: null, youtubeVideo: null, application: null, ...fields }
  const response = await request('POST', `/api/admin/sessions/${sessionId}/sets`, set)
  expect(response.statusCode).toBe(200)
  return response.json().session.sets.at(-1).id
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret'
  database = await testDatabase()
  app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  const resolveTrack = async (link: string) => {
    resolved++
    return link === TRACK ? '42' : null
  }
  await app.register(sessionsRoutes, { store: sessionsStore(database.db), photos: NO_PHOTOS, resolveTrack })
  await app.register(artistsRoutes, { store: artistsStore(database.db), photos: NO_PHOTOS })
  await app.register(collectivesRoutes, { store: collectivesStore(database.db), photos: NO_PHOTOS })
})

afterAll(async () => {
  await app?.close()
  await database?.drop()
})

beforeEach(async () => {
  await database.db.execute(sql`truncate sessions, artists, collectives cascade`)
  resolved = 0
})

describe('PATCH /api/admin/sessions/:id', () => {
  it("checks a session's type and takeover on the session as it would be, keeping the takeover it isn't sent", async () => {
    const collective = await createCollective('Haute Rive', [{ name: 'Aurore' }])
    const id = await createSession({ type: 'takeover', takeover: collective })

    // Its start alone, without its takeover, which stays, rather than being taken for a collective that doesn't exist.
    const moved = await request('PATCH', `/api/admin/sessions/${id}`, { start: '2026-11-15T21:00-05:00' })
    expect(moved.statusCode).toBe(200)
    expect(moved.json().session).toMatchObject({ start: '2026-11-15T21:00:00-05:00', type: 'takeover', takeover: { id: collective } })

    const other = await request('PATCH', `/api/admin/sessions/${id}`, { type: 'guest-mixes' })
    expect(other.statusCode).toBe(400)
    expect(other.json()).toEqual({ ok: false, error: 'Only a takeover has a collective' })

    const changed = await request('PATCH', `/api/admin/sessions/${id}`, { type: 'guest-mixes', takeover: null })
    expect(changed.statusCode).toBe(200)
    expect(changed.json().session).toMatchObject({ type: 'guest-mixes', takeover: null, title: 'GUEST MIXES', updatedBy: 'admin@example.com' })

    expect((await request('PATCH', `/api/admin/sessions/${id}`, { type: 'other' })).json()).toEqual({ ok: false, error: 'A session of type other has a name' })
    expect((await request('PATCH', `/api/admin/sessions/${id}`, { type: 'takeover' })).json()).toEqual({ ok: false, error: 'A takeover has a collective' })
  })

  it('responds 409 when its duration alone would make it overlap another session, with that one', async () => {
    const first = await createSession({ start: '2026-11-14T21:00-05:00', durationMinutes: 60 })
    const second = await createSession({ start: '2026-11-14T22:00-05:00', durationMinutes: 60 })
    const response = await request('PATCH', `/api/admin/sessions/${first}`, { durationMinutes: 90 })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'Another session overlaps this one', session: { id: second }, set: null })

    // Without a start, it overlaps nothing, however long it lasts.
    const undated = await createSession({ start: null })
    expect((await request('PATCH', `/api/admin/sessions/${undated}`, { durationMinutes: 4320 })).statusCode).toBe(200)
  })

  it('lets a session last several days, which then overlaps the sessions of those days', async () => {
    const weekend = await createSession({ start: '2026-11-20T18:00-05:00', durationMinutes: 60 })
    const sunday = await createSession({ start: '2026-11-22T20:00-05:00', durationMinutes: 60 })
    const response = await request('PATCH', `/api/admin/sessions/${weekend}`, { durationMinutes: 56 * 60 })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: 'Another session overlaps this one', session: { id: sunday } })
    const changed = await request('PATCH', `/api/admin/sessions/${weekend}`, { durationMinutes: 50 * 60 })
    expect(changed.json().session).toMatchObject({ start: '2026-11-20T18:00:00-05:00', end: '2026-11-22T20:00:00-05:00', durationMinutes: 3000 })
  })

  const ENDS_BY_3000 = { ok: false, error: 'A session ends by the start of the year 3000, in UTC' }

  it('checks that a session ends by the start of the year 3000, in UTC, on the session as it would be', async () => {
    // A session without a start can last longer, until it's given one.
    const undated = await createSession({ start: null, durationMinutes: 120 })
    expect((await request('PATCH', `/api/admin/sessions/${undated}`, { start: '2999-12-31T18:00-05:00' })).json()).toEqual(ENDS_BY_3000)
    // Midnight in UTC, which it ends at, isn't part of it.
    expect((await request('PATCH', `/api/admin/sessions/${undated}`, { start: '2999-12-31T17:00-05:00' })).statusCode).toBe(200)
    await request('DELETE', `/api/admin/sessions/${undated}`)

    // 23:00 in UTC on December 31st, 2999.
    const late = await createSession({ start: '2999-12-31T18:00-05:00', durationMinutes: 60 })
    expect((await request('PATCH', `/api/admin/sessions/${late}`, { durationMinutes: 61 })).json()).toEqual(ENDS_BY_3000)
    expect((await request('PATCH', `/api/admin/sessions/${late}`, { durationMinutes: 30 })).statusCode).toBe(200)

    const fields = { start: '2999-12-31T18:00-05:00', durationMinutes: 61, type: 'guest-mixes', takeover: null, application: null, name: '', raEvent: null, description: '' }
    const put = await sendForm('PUT', `/api/admin/sessions/${late}`, 'session', fields)
    expect(put.statusCode).toBe(400)
    expect(put.json()).toEqual(ENDS_BY_3000)
    const post = await sendForm('POST', '/api/admin/sessions', 'session', fields)
    expect(post.statusCode).toBe(400)
    expect(post.json()).toEqual(ENDS_BY_3000)
  })

  it('keeps a session ending by the start of the year 3000 when its start and its duration are changed at the same time', async () => {
    // 21:00 in UTC on December 31st, 2999, for an hour. Either change alone ends it by midnight in UTC, but not both.
    const id = await createSession({ start: '2999-12-31T16:00-05:00', durationMinutes: 60 })
    const responses = await Promise.all([
      request('PATCH', `/api/admin/sessions/${id}`, { start: '2999-12-31T18:00-05:00' }),
      request('PATCH', `/api/admin/sessions/${id}`, { durationMinutes: 180 }),
    ])
    expect(responses.map(({ statusCode }) => statusCode).sort()).toEqual([200, 400])
    expect(responses.find(({ statusCode }) => statusCode === 400)!.json()).toEqual(ENDS_BY_3000)
    await checkSessionsInvariants(database.db)
  })

  it("checks that an announced session keeps its start on the session as it would be, keeping the start it isn't sent", async () => {
    const id = await createSession({})
    await app.inject({ method: 'PUT', url: `/api/admin/sessions/${id}/announced`, payload: { announced: true }, cookies: await sessionCookies() })
    const response = await request('PATCH', `/api/admin/sessions/${id}`, { start: null, name: 'X' })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ ok: false, error: 'An announced session has a start' })
    expect((await request('PATCH', `/api/admin/sessions/${id}`, { name: 'X' })).json().session).toMatchObject({ start: '2026-11-14T21:00:00-05:00', name: 'X', announced: true })
  })
})

describe('PATCH /api/admin/sets/:id', () => {
  it("changes a set's duration, or makes it unknown, without moving it", async () => {
    const artist = await createArtist('Aurore')
    const session = await createSession({})
    const first = await createSet(session, { performers: [{ id: artist }], durationMinutes: 60 })
    const second = await createSet(session, { performers: [{ id: artist }], durationMinutes: 60 })

    const longer = await request('PATCH', `/api/admin/sets/${first}`, { durationMinutes: 90 })
    expect(longer.statusCode).toBe(200)
    expect(longer.json().session.sets).toMatchObject([
      { id: first, durationMinutes: 90 },
      { id: second, durationMinutes: 60 },
    ])
    const unknown = await request('PATCH', `/api/admin/sets/${first}`, { durationMinutes: null })
    expect(unknown.json().session.sets).toMatchObject([{ id: first, durationMinutes: null }, { id: second }])
  })

  it('keeps its performers, its track and its video when they are not sent, without resolving the track again', async () => {
    const [aurore, brume] = [await createArtist('Aurore'), await createArtist('Brume')]
    const session = await createSession({})
    const id = await createSet(session, { performers: [{ id: aurore }, { id: brume }], soundcloudTrack: TRACK, youtubeVideo: 'dQw4w9WgXcQ' })
    expect(resolved).toBe(1)

    const response = await request('PATCH', `/api/admin/sets/${id}`, { genres: ['ambient'] })
    expect(response.statusCode).toBe(200)
    expect(response.json().session.sets[0]).toMatchObject({
      genres: ['ambient'],
      performers: [{ id: aurore, name: 'Aurore' }, { id: brume, name: 'Brume' }],
      soundcloudTrack: { id: '42', url: TRACK },
      youtubeVideo: { id: 'dQw4w9WgXcQ' },
      updatedBy: 'admin@example.com',
    })
    expect(resolved).toBe(1)

    const performers = await request('PATCH', `/api/admin/sets/${id}`, { performers: [{ id: brume }], youtubeVideo: null })
    expect(performers.json().session.sets[0]).toMatchObject({ performers: [{ id: brume }], soundcloudTrack: { id: '42' }, youtubeVideo: null })
  })

  it('changes a set without performers, as long as it is not sent any', async () => {
    const artist = await createArtist('Aurore')
    const session = await createSession({})
    const id = await createSet(session, { performers: [{ id: artist }] })
    await request('DELETE', `/api/admin/artists/${artist}`)

    const response = await request('PATCH', `/api/admin/sets/${id}`, { otherPerformanceType: 'Synthé modulaire' })
    expect(response.statusCode).toBe(200)
    expect(response.json().session.sets[0]).toMatchObject({ performers: [], otherPerformanceType: 'Synthé modulaire' })
    expect((await request('PATCH', `/api/admin/sets/${id}`, { performers: [] })).json()).toEqual({ ok: false, error: 'A set has at least one performer' })
  })
})

describe('PUT /api/admin/sets/:id/session', () => {
  it('counts as changing the set, even to the session it is in, but changes nothing else of it, nor either session', async () => {
    const artist = await createArtist('Aurore')
    const from = await createSession({})
    const to = await createSession({ start: '2026-11-21T21:00-05:00' })
    const id = await createSet(from, { performers: [{ id: artist }], durationMinutes: 45, genres: ['ambient'], soundcloudTrack: TRACK, youtubeVideo: 'dQw4w9WgXcQ' })
    const before = (await request('GET', `/api/admin/sessions/${from}`)).json().session
    expect(before.sets[0].updatedBy).toBeNull()

    const response = await request('PUT', `/api/admin/sets/${id}/session`, { session: to })
    expect(response.statusCode).toBe(200)
    const { session, previousSession } = response.json()
    const moved = session.sets[0]
    const { updatedBy, updatedAt, ...rest } = moved
    expect(updatedBy).toBe('admin@example.com')
    expect(updatedAt).not.toBeNull()
    expect({ ...before.sets[0], updatedBy: null, updatedAt: null }).toEqual({ ...rest, updatedBy: null, updatedAt: null })
    // Neither session counts as changed.
    expect(session.updatedBy).toBeNull()
    expect(previousSession.updatedBy).toBeNull()
    expect(resolved).toBe(1)

    // Moved to the session it's in, it's still changed, by whoever did it.
    const other = { id: 'other-admin-id', email: 'other@example.com', sessionVersion: 0 }
    const again = await app.inject({ method: 'PUT', url: `/api/admin/sets/${id}/session`, payload: { session: to }, cookies: await sessionCookies(other) })
    expect(again.statusCode).toBe(200)
    expect(again.json().session.sets[0]).toMatchObject({ id, updatedBy: other.email })
  })
})

describe('PATCH /api/admin/collectives/:id', () => {
  it('keeps its members when they are not sent, even none, and replaces them when they are', async () => {
    const aurore = await createArtist('Aurore')
    const id = await createCollective('Les Ondes', [{ id: aurore }, { name: 'Brume' }])

    const renamed = await request('PATCH', `/api/admin/collectives/${id}`, { name: 'Les Ondes B' })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json().collective).toMatchObject({ name: 'Les Ondes B', members: [{ id: aurore }, { name: 'Brume' }] })

    const replaced = await request('PATCH', `/api/admin/collectives/${id}`, { members: [{ name: 'Cyan' }, { id: aurore }] })
    expect(replaced.json().collective.members.map(({ name }: { name: string }) => name)).toEqual(['Cyan', 'Aurore'])

    // Without members once they're deleted, it can still be changed, but not given no members.
    await database.db.delete(artists).where(eq(artists.name, 'Cyan'))
    await request('DELETE', `/api/admin/artists/${aurore}`)
    expect(await database.db.select().from(collectiveMembers)).toEqual([])
    const described = await request('PATCH', `/api/admin/collectives/${id}`, { description: 'Un collectif.' })
    expect(described.statusCode).toBe(200)
    expect(described.json().collective).toMatchObject({ description: 'Un collectif.', members: [] })
    expect((await request('PATCH', `/api/admin/collectives/${id}`, { members: [] })).statusCode).toBe(400)
  })
})
