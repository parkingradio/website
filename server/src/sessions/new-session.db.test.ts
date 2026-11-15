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
import type { Photos } from '../artists/store.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { NOT_THE_SETS_APPLICATION } from './fields.js'
import { sessionsRoutes } from './routes.js'
import { sessionsStore } from './store.js'
import { checkSessionsInvariants } from './test-invariants.js'

// Adding a session with its sets, against a real database: all of them or nothing, the first set that fails saying which
// it is, and what's in the way, another session's set, or another set of the same request, and the sets in the order
// they were sent (see `POST /api/admin/sessions` in docs/design/server/sessions.md).

// Photos and flyers aren't sent, so there are none to read or delete.
const NO_PHOTOS: Photos = {
  store: async () => {
    throw new Error('No photos in these tests')
  },
  read: async () => null,
  delete: async () => {},
}

// The SoundCloud tracks, by the links that lead to them: two links lead to the same track, e.g. once it's renamed.
const TRACKS: Record<string, string> = {
  'https://soundcloud.com/parkingdotradio/a': '1',
  'https://soundcloud.com/parkingdotradio/b': '2',
  'https://soundcloud.com/parkingdotradio/b-renamed': '2',
}

let database: TestDatabase
let app: FastifyInstance

async function request(method: 'GET' | 'POST', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies: await sessionCookies() })
}

async function sendForm(url: string, part: string, fields: object) {
  return app.inject({ method: 'POST', url, ...multipartBody({ [part]: JSON.stringify(fields) }), cookies: await sessionCookies() })
}

async function createArtist(name: string): Promise<string> {
  return (await sendForm('/api/admin/artists', 'artist', { name })).json().artist.id
}

async function createApplication(artistId: string): Promise<string> {
  const fields = { dates: ['2026-11-14'], timeSlots: [], performanceTypes: [], otherPerformanceType: '', details: '' }
  return (await request('POST', '/api/admin/applications', { ...fields, artistId })).json().application.id
}

function set(fields: object) {
  return { performers: [], offsetMinutes: null, durationMinutes: null, performanceTypes: [], otherPerformanceType: '', genres: [], soundcloudTrack: null, youtubeVideo: null, application: null, ...fields }
}

async function createSession(fields: object, sets: object[]) {
  const session = { start: '2026-11-14T21:00-05:00', durationMinutes: 180, type: 'guest-mixes', takeover: null, application: null, name: '', raEvent: null, description: '', ...fields }
  return sendForm('/api/admin/sessions', 'session', { ...session, sets })
}

async function count(table: 'sessions' | 'sets'): Promise<number> {
  const { rows } = await database.db.execute<{ count: number }>(sql`select count(*)::int as count from ${sql.identifier(table)}`)
  return rows[0].count
}

// Checks that `response` failed with `body`, and that nothing was saved: there are as many sessions and sets as `before`.
async function expectRefused(response: LightMyRequestResponse, status: number, body: object, before: { sessions: number; sets: number }) {
  expect(response.statusCode).toBe(status)
  expect(response.json()).toEqual({ ok: false, ...body })
  expect({ sessions: await count('sessions'), sets: await count('sets') }).toEqual(before)
  await checkSessionsInvariants(database.db)
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret'
  database = await testDatabase()
  app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  const sessions = sessionsStore(database.db)
  await app.register(sessionsRoutes, { store: sessions, photos: NO_PHOTOS, resolveTrack: async (link) => TRACKS[link] ?? null })
  await app.register(artistsRoutes, { store: artistsStore(database.db), photos: NO_PHOTOS })
  await app.register(applicationsRoutes, { store: applicationsStore(database.db), settings: applicationsSettingsStore(database.db), sessions })
})

afterAll(async () => {
  await app?.close()
  await database?.drop()
})

beforeEach(async () => {
  await database.db.execute(sql`truncate sessions, artists, collectives cascade`)
})

describe('a session added with its sets', () => {
  it('has them, in the order they were sent where they are otherwise in the same place, with their performers and applications', async () => {
    const [aurore, brume] = [await createArtist('Aurore'), await createArtist('Brume')]
    const application = await createApplication(aurore)
    const response = await createSession({}, [
      set({ performers: [{ id: brume }], durationMinutes: 60 }),
      set({ performers: [{ id: aurore }, { id: brume }], offsetMinutes: 60, durationMinutes: 60, application }),
      set({ performers: [{ id: aurore }], soundcloudTrack: 'https://soundcloud.com/parkingdotradio/a' }),
      set({ performers: [{ id: brume }], offsetMinutes: 60, durationMinutes: 30, youtubeVideo: 'aaaaaaaaaaa' }),
      // Sharing the application of another set.
      set({ performers: [{ id: aurore }], offsetMinutes: 0, durationMinutes: 60, application }),
    ])

    expect(response.statusCode).toBe(200)
    const { sets } = response.json().session
    expect(sets.map(({ performers }: { performers: { name: string }[] }) => performers.map(({ name }) => name).join(' & '))).toEqual([
      'Aurore',
      'Aurore & Brume',
      'Brume',
      'Brume',
      'Aurore',
    ])
    expect(sets.map(({ offsetMinutes }: { offsetMinutes: number | null }) => offsetMinutes)).toEqual([0, 60, 60, null, null])
    expect(sets[1].application.id).toBe(application)
    expect(sets[3].durationMinutes).toBe(60)
    expect(sets[4].soundcloudTrack).toEqual({ id: '1', url: 'https://soundcloud.com/parkingdotradio/a' })
    expect(sets.every(({ status }: { status: string }) => status === 'planned')).toBe(true)
    // As the session is read again, which doesn't depend on the order the database happens to return them in.
    expect((await request('GET', `/api/admin/sessions/${response.json().session.id}`)).json().session.sets).toEqual(sets)
    const { rows } = await database.db.execute<{ count: number }>(sql`select count(distinct created_at)::int as count from sets`)
    expect(rows[0].count).toBe(5)
    await checkSessionsInvariants(database.db)
  })

  it("saves nothing when one of them can't be added, saying which, the first one that fails", async () => {
    const [aurore, brume] = [await createArtist('Aurore'), await createArtist('Brume')]
    const before = { sessions: 0, sets: 0 }
    const valid = set({ performers: [{ id: aurore }], youtubeVideo: 'aaaaaaaaaaa' })

    let response = await createSession({}, [valid, set({ performers: [{ id: '00000000-0000-4000-8000-000000000000' }] }), set({ performers: [] })])
    // The last one's performers are said to be missing before anything is checked against the database.
    await expectRefused(response, 400, { error: 'A set has at least one performer', setIndex: 2 }, before)
    response = await createSession({}, [valid, set({ performers: [{ id: '00000000-0000-4000-8000-000000000000' }] })])
    await expectRefused(response, 400, { error: 'No such artist', setIndex: 1 }, before)
    response = await createSession({}, [valid, valid, set({ performers: [{ id: brume }], application: await createApplication(aurore) })])
    // The second one is in the way of the first one before the third one's application is checked.
    await expectRefused(response, 409, { error: "This YouTube video is another set's", session: null, set: null, setIndex: 1, otherSetIndex: 0 }, before)
    response = await createSession({}, [valid, set({ performers: [{ id: brume }], application: await createApplication(aurore) })])
    await expectRefused(response, 400, { error: NOT_THE_SETS_APPLICATION, setIndex: 1 }, before)
  })

  it('refuses a track that is that of another set of the request, as SoundCloud resolves it, or of another session, which it names', async () => {
    const aurore = await createArtist('Aurore')
    const performers = [{ id: aurore }]
    let response = await createSession({}, [
      set({ performers, soundcloudTrack: 'https://soundcloud.com/parkingdotradio/a' }),
      set({ performers, soundcloudTrack: 'https://soundcloud.com/parkingdotradio/b' }),
      set({ performers, soundcloudTrack: 'https://soundcloud.com/parkingdotradio/b-renamed' }),
    ])
    await expectRefused(response, 409, { error: "This SoundCloud track is another set's", session: null, set: null, setIndex: 2, otherSetIndex: 1 }, { sessions: 0, sets: 0 })

    const other = (await createSession({ start: null }, [set({ performers, soundcloudTrack: 'https://soundcloud.com/parkingdotradio/b' })])).json().session
    response = await createSession({}, [set({ performers }), set({ performers, soundcloudTrack: 'https://soundcloud.com/parkingdotradio/b-renamed' })])
    await expectRefused(response, 409, { error: "This SoundCloud track is another set's", session: other, set: other.sets[0], setIndex: 1 }, { sessions: 1, sets: 1 })
  })

  it("is refused without a set's index when it's the session that can't be added", async () => {
    const aurore = await createArtist('Aurore')
    const other = (await createSession({}, [])).json().session
    const response = await createSession({ start: '2026-11-14T22:00-05:00' }, [set({ performers: [{ id: aurore }] })])
    await expectRefused(response, 409, { error: 'Another session overlaps this one', session: other, set: null }, { sessions: 1, sets: 0 })
  })
})
