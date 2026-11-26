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
import { NO_PHOTOS } from '../artists/test-photos.js'
import { collectivesRoutes } from '../collectives/routes.js'
import { collectivesStore } from '../collectives/store.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { sessionsStore } from '../sessions/store.js'
import { applicationsRoutes } from './routes.js'
import { applicationsSettingsStore } from './settings.js'
import { applicationsStore } from './store.js'

// The applications that `GET /api/admin/applications` lists by a range of days, against a real database, which finds
// them (see docs/design/server/applications.md). routes.test.ts has the other filters, and the errors.

let database: TestDatabase
let app: FastifyInstance

async function sendForm(url: string, part: string, fields: object) {
  return app.inject({ method: 'POST', url, ...multipartBody({ [part]: JSON.stringify(fields) }), cookies: await sessionCookies() })
}

// Adds an application with `dates` for the artist or the collective, received a day after the previous one, so that the
// list has them in the reverse order, and returns its id.
let received = 0
async function createApplication(owner: { artistId: string } | { collectiveId: string }, dates: string[]): Promise<string> {
  const receivedAt = `2026-10-${String(++received).padStart(2, '0')}T12:00-04:00`
  const fields = { dates, timeSlots: [], performanceTypes: [], otherPerformanceType: '', details: '', receivedAt, ...owner }
  const response = await app.inject({ method: 'POST', url: '/api/admin/applications', payload: fields, cookies: await sessionCookies() })
  expect(response.statusCode).toBe(200)
  return response.json().application.id
}

// The ids of the applications that `query` lists.
async function listed(query: string): Promise<string[]> {
  const response = await app.inject({ method: 'GET', url: `/api/admin/applications?${query}`, cookies: await sessionCookies() })
  expect(response.statusCode, query).toBe(200)
  return response.json().applications.map(({ id }: { id: string }) => id)
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret'
  database = await testDatabase()
  app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(artistsRoutes, { store: artistsStore(database.db), photos: NO_PHOTOS })
  await app.register(collectivesRoutes, { store: collectivesStore(database.db), photos: NO_PHOTOS })
  const store = applicationsStore(database.db)
  await app.register(applicationsRoutes, { store, settings: applicationsSettingsStore(database.db), sessions: sessionsStore(database.db) })
})

afterAll(async () => {
  await app?.close()
  await database?.drop()
})

beforeEach(async () => {
  received = 0
  await database.db.execute(sql`truncate artists, collectives cascade`)
})

describe('listing applications by a range of days', () => {
  it('lists those with at least one of their dates in the range, both days included, and not those whose dates are only around it', async () => {
    const artistId = (await sendForm('/api/admin/artists', 'artist', { name: 'Brumes' })).json().artist.id
    const before = await createApplication({ artistId }, ['2026-11-30'])
    const first = await createApplication({ artistId }, ['2026-12-01'])
    const inside = await createApplication({ artistId }, ['2026-11-20', '2026-12-12', '2027-01-15'])
    const around = await createApplication({ artistId }, ['2026-11-30', '2027-01-01'])
    const last = await createApplication({ artistId }, ['2026-12-31'])
    const after = await createApplication({ artistId }, ['2027-01-01'])

    expect(await listed('from=2026-12-01&to=2026-12-31')).toEqual([last, inside, first])
    expect(await listed('from=2026-12-12&to=2026-12-12')).toEqual([inside])
    expect(await listed('from=2026-12-02&to=2026-12-11')).toEqual([])
    expect(await listed('from=2026-12-31')).toEqual([after, last, around, inside])
    expect(await listed('to=2026-12-01')).toEqual([around, inside, first, before])
  })

  it("lists only an artist's or a collective's", async () => {
    const artistId = (await sendForm('/api/admin/artists', 'artist', { name: 'Brumes' })).json().artist.id
    const collectiveId = (await sendForm('/api/admin/collectives', 'collective', { name: 'Les Ondes', members: [{ id: artistId }] })).json().collective.id
    const artists = await createApplication({ artistId }, ['2026-12-12'])
    await createApplication({ artistId }, ['2026-12-13'])
    const collectives = await createApplication({ collectiveId }, ['2026-12-12'])

    expect(await listed(`from=2026-12-12&to=2026-12-12&artist=${artistId}`)).toEqual([artists])
    expect(await listed(`from=2026-12-12&to=2026-12-12&collective=${collectiveId}`)).toEqual([collectives])
  })
})
