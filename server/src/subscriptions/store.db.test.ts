import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { eq, sql } from 'drizzle-orm'
import ICAL from 'ical.js'
import type { FastifyInstance } from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import { multipartBody } from '../api/test-multipart.js'
import { adminsStore } from '../admins/store.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import type { TEST_ADMIN } from '../admins/test-sessions.js'
import { memoryPhotos } from '../artists/test-photos.js'
import type { CalendarFeedsStore } from '../calendar/feeds.js'
import type { CalendarReads } from '../calendar/reads.js'
import { users } from '../db/schema.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { sessionsRoutes } from '../sessions/routes.js'
import { sessionsStore } from '../sessions/store.js'
import { subscriptionsRoutes } from './routes.js'
import { subscriptionsStore } from './store.js'
import type { SubscriptionsStore } from './store.js'

// Admins' own calendar feeds, against a real database: their tokens, and the sessions of the feed of sessions (see
// docs/design/server/subscriptions.md). The occupations, which are only in memory, are tested without one (see
// routes.test.ts).

let database: TestDatabase
let app: FastifyInstance
let store: SubscriptionsStore

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret'
  database = await testDatabase()
  app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  // Every admin's session is valid: whether the admin still exists is up to the routes.
  acceptSessions(app)
  const photos = memoryPhotos((count) => count.toString(16).padStart(64, '0'))
  await app.register(sessionsRoutes, { store: sessionsStore(database.db), photos, resolveTrack: async (link: string) => `track:${link}` })
  store = subscriptionsStore(database.db)
  const feeds = { list: async () => [] } as unknown as CalendarFeedsStore
  const reads = { of: () => undefined } as unknown as CalendarReads
  await app.register(subscriptionsRoutes, { store, feeds, reads, siteOrigin: 'https://parking.radio', environment: 'production' })
})

afterAll(async () => {
  await app?.close()
  await database?.drop()
})

beforeEach(async () => {
  await database.db.execute(sql`truncate sessions, users cascade`)
})

type Admin = typeof TEST_ADMIN

// An admin who accepted their invite.
async function createAdmin(email = 'ana@example.com'): Promise<Admin> {
  const [row] = await database.db.insert(users).values({ email, passwordHash: 'hash' }).returning()
  return { id: row.id, email, sessionVersion: row.sessionVersion }
}

async function tokenRequest(method: 'GET' | 'POST', admin: Admin) {
  return app.inject({ method, url: '/api/admin/subscription-token', cookies: await sessionCookies(admin) })
}

// The admin's token, which has to be given.
async function tokenOf(admin: Admin, method: 'GET' | 'POST' = 'GET'): Promise<string> {
  const response = await tokenRequest(method, admin)
  expect(response.statusCode, response.body).toBe(200)
  return response.json().token
}

const sessionsFeed = (token: string) => app.inject({ method: 'GET', url: `/sessions.ics?token=${token}` })

describe('the token', () => {
  it("is the admin's own, the same each time it's asked for, until it's replaced, which makes the previous one stop working", async () => {
    const [ana, brume] = [await createAdmin(), await createAdmin('brume@example.com')]
    const token = await tokenOf(ana)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(await tokenOf(ana)).toBe(token)
    expect(await tokenOf(brume)).not.toBe(token)
    expect((await sessionsFeed(token)).statusCode).toBe(200)

    const replaced = await tokenOf(ana, 'POST')
    expect(replaced).toMatch(/^[0-9a-f]{64}$/)
    expect(replaced).not.toBe(token)
    expect(await tokenOf(ana)).toBe(replaced)
    expect((await sessionsFeed(token)).statusCode).toBe(403)
    expect((await sessionsFeed(replaced)).statusCode).toBe(200)
  })

  it('is the same for requests that ask for it at once, before the admin has one', async () => {
    const ana = await createAdmin()
    const tokens = await Promise.all(Array.from({ length: 5 }, () => tokenOf(ana)))
    expect(new Set(tokens).size).toBe(1)
  })

  it("keeps working when the admin chooses a new password, but not once they're revoked", async () => {
    const ana = await createAdmin()
    const token = await tokenOf(ana)
    await database.db.update(users).set({ passwordHash: 'another', sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, ana.id))
    // Every session is valid here (see acceptSessions).
    expect(await tokenOf(ana)).toBe(token)
    expect((await sessionsFeed(token)).statusCode).toBe(200)

    await adminsStore(database.db).delete(ana.id)
    expect((await sessionsFeed(token)).statusCode).toBe(403)
    // A request whose session was checked before the admin was revoked.
    for (const method of ['GET', 'POST'] as const) {
      const response = await tokenRequest(method, ana)
      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({ ok: false, error: 'Unauthorized' })
    }
  })
})

// Adds a session, which starts at `start`, unless it's null, and lasts `durationMinutes`.
async function createSession(start: string | null, durationMinutes = 120, fields: object = {}): Promise<string> {
  const session = JSON.stringify({ start, durationMinutes, type: 'guest-mixes', takeover: null, application: null, name: '', raEvent: null, description: '', ...fields, sets: [] })
  const response = await app.inject({ method: 'POST', url: '/api/admin/sessions', ...multipartBody({ session }), cookies: await sessionCookies() })
  expect(response.statusCode, response.body).toBe(200)
  return response.json().session.id
}

async function change(url: string, payload: object) {
  const response = await app.inject({ method: 'PUT', url, payload, cookies: await sessionCookies() })
  expect(response.statusCode, response.body).toBe(200)
}

describe('SubscriptionsStore.sessions', () => {
  const now = new Date('2026-11-14T21:00-05:00')
  const idsOf = async (at = now) => (await store.sessions(at)).map(({ id }) => id).toSorted()

  it('has the sessions that start at most a year before `now`, whatever their status, announced or not, but not those without a start', async () => {
    await createSession('2025-11-14T20:59-05:00', 1)
    await createSession(null)
    const ids = [await createSession('2026-11-14T22:00-05:00'), await createSession('2025-11-14T21:00-05:00'), await createSession('2026-06-01T21:00-04:00')]
    await change(`/api/admin/sessions/${ids[0]}/announced`, { announced: true })
    await change(`/api/admin/sessions/${ids[1]}/status`, { status: 'cancelled' })
    await change(`/api/admin/sessions/${ids[2]}/status`, { status: 'done' })
    expect(await idsOf()).toEqual(ids.toSorted())
  })

  it('has a session that started more than a year before `now` while it has not ended', async () => {
    // Two years long, until January 1st, 2027, at 21:00.
    const id = await createSession('2025-01-01T21:00-05:00', 2 * 365 * 24 * 60)
    expect(await idsOf()).toEqual([id])
    expect(await idsOf(new Date('2027-02-01T00:00-05:00'))).toEqual([])
  })
})

describe('GET /sessions.ics', () => {
  it('marks the sessions that are cancelled, or not announced, and links to their admin pages', async () => {
    const token = await tokenOf(await createAdmin())
    const announced = await createSession('2990-01-01T21:00-05:00', 120, { name: 'ANNONCÉE' })
    const cancelled = await createSession('2990-01-02T21:00-05:00', 120, { name: 'ANNULÉE' })
    await change(`/api/admin/sessions/${announced}/announced`, { announced: true })
    await change(`/api/admin/sessions/${cancelled}/status`, { status: 'cancelled' })

    const response = await sessionsFeed(token)
    expect(response.headers['cache-control']).toBe('no-store')
    const vevents = new ICAL.Component(ICAL.parse(response.body)).getAllSubcomponents('vevent')
    const of = (id: string) => {
      const vevent = vevents.find((vevent) => vevent.getFirstPropertyValue('uid') === `session-${id}@parking.radio`)!
      return Object.fromEntries(['summary', 'status', 'url'].map((name) => [name, vevent.getFirstPropertyValue(name)]))
    }
    expect(vevents).toHaveLength(2)
    expect(of(announced)).toEqual({ summary: 'ANNONCÉE', status: null, url: `https://parking.radio/admin/sessions/${announced}` })
    expect(of(cancelled)).toEqual({ summary: '[CANCELLED] [UNANNOUNCED] ANNULÉE', status: 'CANCELLED', url: `https://parking.radio/admin/sessions/${cancelled}` })
  })
})
