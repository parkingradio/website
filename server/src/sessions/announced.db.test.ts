import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import { multipartBody } from '../api/test-multipart.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { NO_PHOTOS } from '../artists/test-photos.js'
import { testDatabase } from '../db/test-database.js'
import type { TestDatabase } from '../db/test-database.js'
import { sessionsRoutes } from './routes.js'
import { sessionsStore } from './store.js'

// Announcing sessions, against a real database: only a session with a start can be announced, and an announced session
// keeps its start, whatever its status (see "Announced" in docs/design/server/sessions.md). The property-based tests of
// rules.db.test.ts announce sessions too.

const START = '2026-11-14T21:00-05:00'

let database: TestDatabase
let app: FastifyInstance

async function request(method: 'PUT' | 'PATCH', url: string, payload: object) {
  return app.inject({ method, url, payload, cookies: await sessionCookies() })
}

function sessionFields(fields: object) {
  return { start: START, durationMinutes: 120, type: 'guest-mixes', takeover: null, application: null, name: '', raEvent: null, description: '', ...fields }
}

async function createSession(fields: object = {}): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/admin/sessions', ...multipartBody({ session: JSON.stringify(sessionFields(fields)) }), cookies: await sessionCookies() })
  expect(response.statusCode).toBe(200)
  expect(response.json().session).toMatchObject({ announced: false, announcedUpdatedBy: null, announcedUpdatedAt: null })
  return response.json().session.id
}

async function announce(id: string, announced: boolean) {
  return request('PUT', `/api/admin/sessions/${id}/announced`, { announced })
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret'
  database = await testDatabase()
  app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(sessionsRoutes, { store: sessionsStore(database.db), photos: NO_PHOTOS, resolveTrack: async () => null })
})

afterAll(async () => {
  await app?.close()
  await database?.drop()
})

beforeEach(async () => {
  await database.db.execute(sql`truncate sessions cascade`)
})

describe('PUT /api/admin/sessions/:id/announced', () => {
  it('announces a session with a start, and un-announces it, saying who did it each time, but not as a change', async () => {
    const id = await createSession()
    const announced = await announce(id, true)
    expect(announced.statusCode).toBe(200)
    const { announcedUpdatedAt } = announced.json().session
    expect(announced.json().session).toMatchObject({ announced: true, announcedUpdatedBy: 'admin@example.com', updatedBy: null, updatedAt: null })

    // Again, which says it again.
    const again = await announce(id, true)
    expect(again.json().session).toMatchObject({ announced: true, announcedUpdatedBy: 'admin@example.com' })
    expect(again.json().session.announcedUpdatedAt >= announcedUpdatedAt).toBe(true)

    expect((await announce(id, false)).json().session).toMatchObject({ announced: false, updatedBy: null })
  })

  it('refuses to announce a session without a start', async () => {
    const id = await createSession({ start: null })
    const response = await announce(id, true)
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ ok: false, error: 'An announced session has a start' })
    expect((await announce(id, false)).statusCode).toBe(200)
  })

  it('keeps a session announced whatever its status, and un-announces it whatever its status', async () => {
    const id = await createSession()
    await announce(id, true)
    for (const status of ['cancelled', 'done', 'planned']) {
      const response = await request('PUT', `/api/admin/sessions/${id}/status`, { status })
      expect(response.json().session).toMatchObject({ status, announced: true })
    }
    await request('PUT', `/api/admin/sessions/${id}/status`, { status: 'cancelled' })
    expect((await announce(id, false)).json().session).toMatchObject({ status: 'cancelled', announced: false })
    expect((await announce(id, true)).json().session).toMatchObject({ status: 'cancelled', announced: true })
  })

  it('responds 404 when there is no such session', async () => {
    expect((await announce('00000000-0000-4000-8000-000000000000', true)).statusCode).toBe(404)
    expect((await announce('nope', false)).statusCode).toBe(404)
  })
})

describe('PATCH /api/admin/sessions/:id', () => {
  it("refuses to remove an announced session's start, even with every other field, but moves it", async () => {
    const id = await createSession()
    await announce(id, true)
    // Every field, as the admin pages' form sends them.
    const change = async (fields: object) => request('PATCH', `/api/admin/sessions/${id}`, sessionFields(fields))
    const response = await change({ start: null })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ ok: false, error: 'An announced session has a start' })

    const moved = await change({ start: '2026-11-15T21:00-05:00' })
    expect(moved.json().session).toMatchObject({ start: '2026-11-15T21:00:00-05:00', announced: true })
    await announce(id, false)
    expect((await change({ start: null })).json().session).toMatchObject({ start: null, announced: false })
  })
})

describe('announcing a session while its start is removed', () => {
  it('does one or the other, never both, whatever the order', async () => {
    for (let i = 0; i < 10; i++) {
      const id = await createSession({ start: `2026-11-${10 + i}T21:00-05:00` })
      const [announced, undated] = await Promise.all([announce(id, true), request('PATCH', `/api/admin/sessions/${id}`, { start: null })])
      expect([announced.statusCode, undated.statusCode].sort()).toEqual([200, 400])
    }
  })
})
