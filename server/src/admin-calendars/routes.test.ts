import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { useZodSchemas } from '../api/schemas.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import type { CalendarFeedsStore, StoredFeed } from '../calendar/feeds.js'
import type { CalendarReads, FeedRead } from '../calendar/reads.js'
import { adminCalendarsRoutes } from './routes.js'
import type { AdminCalendarsStore } from './store.js'

// Admins' calendars' routes, without a database: what's refused before anything is read, and when the calendar of
// occupations is given (see docs/design/server/admin-calendars.md). The tokens and the sessions are tested against a real
// database (see store.db.test.ts), and the calendars themselves in calendars.test.ts.

const TOKEN = 'a'.repeat(64)

const store = {
  token: vi.fn<AdminCalendarsStore['token']>(async () => TOKEN),
  replace: vi.fn<AdminCalendarsStore['replace']>(async () => TOKEN),
  isToken: vi.fn<AdminCalendarsStore['isToken']>(async (token) => token === TOKEN),
  sessions: vi.fn<AdminCalendarsStore['sessions']>(async () => []),
}

const FEEDS: StoredFeed[] = ['Séjours', 'Airbnb'].map((name, index) => ({
  id: `feed-${index}`,
  name,
  link: `https://calendar.example/${name}.ics`,
  createdBy: 'admin@example.com',
  createdAt: new Date('2026-10-01T12:00:00Z'),
  updatedBy: null,
  updatedAt: null,
}))
const feeds = { list: vi.fn(async () => FEEDS) }

// What was read from each feed, by id.
const read = new Map<string, FeedRead>()
const reads = { of: vi.fn(({ id }: Pick<StoredFeed, 'id'>) => read.get(id)) }

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret'
})

afterEach(() => {
  vi.clearAllMocks()
  read.clear()
  delete process.env.JWT_SECRET
})

async function buildApp() {
  const app = Fastify({ logger: false })
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(adminCalendarsRoutes, {
    store: store as AdminCalendarsStore,
    feeds: feeds as unknown as CalendarFeedsStore,
    reads: reads as unknown as CalendarReads,
    siteOrigin: 'https://parking.radio',
    environment: 'production',
  })
  return app
}

const PATHS = ['/sessions.ics', '/occupations.ics']

describe('the calendars', () => {
  it("refuse requests whose token isn't an admin's, before anything else is read, without quoting the token", async () => {
    const app = await buildApp()
    const other = 'b'.repeat(64)
    for (const path of PATHS) {
      for (const query of ['', '?token=', `?token=${other}`, `?token=${TOKEN}&token=${TOKEN}`, `?other=${TOKEN}`]) {
        const response = await app.inject({ method: 'GET', url: `${path}${query}` })
        expect(response.statusCode, `${path}${query}`).toBe(403)
        expect(response.json()).toEqual({ ok: false, error: "The link's token isn't an admin's" })
        expect(response.headers['cache-control']).toBe('no-store')
        expect(response.body).not.toContain(other)
      }
    }
    expect(store.sessions).not.toHaveBeenCalled()
    expect(feeds.list).not.toHaveBeenCalled()
  })

  it('give a calendar that is never kept, ignoring other query parameters, also to HEAD requests', async () => {
    const app = await buildApp()
    read.set('feed-0', { events: [], readAt: new Date(), error: null })
    read.set('feed-1', { events: [], readAt: new Date(), error: null })
    for (const path of PATHS) {
      for (const method of ['GET', 'HEAD'] as const) {
        const response = await app.inject({ method, url: `${path}?token=${TOKEN}&other=1` })
        expect(response.statusCode, `${method} ${path}`).toBe(200)
        expect(response.headers['content-type']).toBe('text/calendar; charset=utf-8')
        expect(response.headers['cache-control']).toBe('no-store')
        if (method === 'GET') expect(response.body).toMatch(/^BEGIN:VCALENDAR\r\n[^]*END:VCALENDAR\r\n$/)
      }
    }
  })
})

describe('GET /sessions.ics', () => {
  it('is never kept, even when it fails unexpectedly', async () => {
    const app = await buildApp()
    store.sessions.mockRejectedValueOnce(new Error('The database is gone'))
    const response = await app.inject({ method: 'GET', url: `/sessions.ics?token=${TOKEN}` })
    expect(response.statusCode).toBe(500)
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('has the sessions of the calendar at the time of the request', async () => {
    const app = await buildApp()
    const before = Date.now()
    await app.inject({ method: 'GET', url: `/sessions.ics?token=${TOKEN}` })
    const [[now]] = store.sessions.mock.calls
    expect(now.getTime()).toBeGreaterThanOrEqual(before)
    expect(now.getTime()).toBeLessThanOrEqual(Date.now())
  })
})

describe('GET /occupations.ics', () => {
  const get = async () => (await buildApp()).inject({ method: 'GET', url: `/occupations.ics?token=${TOKEN}` })
  const occupation = { start: new Date('2026-11-20T14:00:00Z'), end: new Date('2026-11-20T16:00:00Z'), wholeDay: false, title: 'Réparation' }

  it('fails with 503 until a read of every feed, with the link it has, has ended since the server started', async () => {
    read.set('feed-0', { events: [occupation], readAt: new Date(), error: null })
    const response = await get()
    expect(response.statusCode).toBe(503)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ ok: false, error: "The calendar feeds haven't all been read yet, with their links, since the server started" })
  })

  it('gives the occupations once every feed has been read, even when a read failed, with an event about that feed', async () => {
    read.set('feed-0', { events: [occupation], readAt: new Date(), error: null })
    read.set('feed-1', { events: [], readAt: null, error: "The link's server can't be reached" })
    const response = await get()
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('SUMMARY:Réparation (Séjours)\r\n')
    expect(response.body).toContain('SUMMARY:[REFRESH ERROR] Airbnb\r\n')
    expect(response.body).not.toContain('calendar.example')
  })

  it('gives an empty calendar without any feed', async () => {
    feeds.list.mockResolvedValueOnce([])
    const response = await get()
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('BEGIN:VEVENT')
  })
})

describe('the token', () => {
  it("is the logged-in admin's, and replacing it gives the new one", async () => {
    const app = await buildApp()
    const cookies = await sessionCookies()
    expect((await app.inject({ method: 'GET', url: '/api/admin/ics-subscription-token', cookies })).json()).toEqual({ ok: true, token: TOKEN })
    expect(store.token).toHaveBeenCalledWith('admin-id')
    store.replace.mockResolvedValueOnce('c'.repeat(64))
    expect((await app.inject({ method: 'POST', url: '/api/admin/ics-subscription-token', cookies })).json()).toEqual({ ok: true, token: 'c'.repeat(64) })
    expect(store.replace).toHaveBeenCalledWith('admin-id')
  })

  it('requires a session', async () => {
    const app = await buildApp()
    for (const method of ['GET', 'POST'] as const) {
      const response = await app.inject({ method, url: '/api/admin/ics-subscription-token' })
      expect(response.statusCode).toBe(401)
    }
    expect(store.token).not.toHaveBeenCalled()
    expect(store.replace).not.toHaveBeenCalled()
  })
})
