import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { useZodSchemas } from '../api/schemas.js'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import type { CalendarFeedsStore, StoredFeed } from '../calendar/feeds.js'
import type { CalendarReads, FeedRead } from '../calendar/reads.js'
import type { SessionsStore, StoredSession } from '../sessions/store.js'
import { storedSession } from '../sessions/test-rows.js'
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
  kind: 'occupations',
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

// The sessions the store has, which it gives as it would: those that take some of the time it's asked for (see
// calendar.db.test.ts).
let rows: StoredSession[] = []
const overlaps = (row: StoredSession, { from, to }: { from: Date; to: Date }) =>
  row.startAt !== null && row.startAt < to && row.startAt.getTime() + row.durationMinutes * 60_000 > from.getTime()
const sessions = {
  forCalendar: vi.fn<SessionsStore['forCalendar']>(async (range, window) => ({
    given: rows.filter((row) => overlaps(row, range) || (row.status !== 'cancelled' && row.startAt === null)),
    others: rows.filter((row) => row.status !== 'cancelled' && overlaps(row, window) && !overlaps(row, range)),
  })),
}

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret'
})

afterEach(() => {
  vi.clearAllMocks()
  feeds.list.mockImplementation(async () => FEEDS)
  read.clear()
  rows = []
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
    sessions,
    siteOrigin: 'https://parking.radio',
    environment: 'production',
  })
  return app
}

const PATHS = ['/sessions.ics', '/occupations.ics', '/availability.ics']

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
    expect(sessions.forCalendar).not.toHaveBeenCalled()
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

  it('fails with 503 until a read of every `occupations` feed, with the link it has, has ended since the server started', async () => {
    read.set('feed-0', { events: [occupation], readAt: new Date(), error: null })
    const response = await get()
    expect(response.statusCode).toBe(503)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ ok: false, error: "The calendar feeds of occupations haven't all been read yet, with their links, since the server started" })
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

  it("leaves out the `holds` feeds, whose holds aren't occupations, and which it doesn't wait for, even when they fail", async () => {
    const loft: StoredFeed = { ...FEEDS[0], id: 'feed-loft', name: 'Loft', kind: 'holds', link: 'https://calendar.example/loft.ics' }
    feeds.list.mockResolvedValue([...FEEDS, loft])
    read.set('feed-0', { events: [occupation], readAt: new Date(), error: null })
    read.set('feed-1', { events: [], readAt: new Date(), error: null })
    // Not read yet: no 503.
    let response = await get()
    expect(response.statusCode).toBe(200)
    read.set('feed-loft', { events: [{ ...occupation, title: 'Gardé' }], readAt: null, error: "The link's server can't be reached" })
    response = await get()
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('SUMMARY:Réparation (Séjours)\r\n')
    expect(response.body).not.toContain('Gardé')
    expect(response.body).not.toContain('Loft')
  })

  it('counts a feed whose kind changed to `occupations` with what was read from it, and waits for it when it was not read', async () => {
    const changed = (kind: StoredFeed['kind']) => FEEDS.map((feed, index) => (index === 1 ? { ...feed, kind } : feed))
    read.set('feed-0', { events: [occupation], readAt: new Date(), error: null })
    // A `holds` feed that hasn't been read doesn't count, until it's an `occupations` feed.
    feeds.list.mockResolvedValue(changed('holds'))
    expect((await get()).statusCode).toBe(200)
    feeds.list.mockResolvedValue(changed('occupations'))
    expect((await get()).statusCode).toBe(503)
    // Read as a `holds` feed, what was read counts as occupations.
    read.set('feed-1', { events: [{ ...occupation, title: 'Gardé' }], readAt: new Date(), error: null })
    const response = await get()
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('SUMMARY:Gardé (Airbnb)\r\n')
  })

  it('gives an empty calendar without any feed', async () => {
    feeds.list.mockResolvedValueOnce([])
    const response = await get()
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('BEGIN:VEVENT')
  })
})

describe('GET /availability.ics', () => {
  // Thursday, November 19th, 2026, at 10:30 in Québec.
  const NOW = new Date('2026-11-19T15:30:00Z')
  const TODAY = new Date('2026-11-19T05:00:00Z')
  const LOFT: StoredFeed = { ...FEEDS[0], id: 'feed-loft', name: 'Loft', kind: 'holds', link: 'https://calendar.example/loft.ics' }
  const span = (start: string, end: string) => ({ start: new Date(start), end: new Date(end), wholeDay: false, title: '' })
  const get = async () => (await buildApp()).inject({ method: 'GET', url: `/availability.ics?token=${TOKEN}` })
  // The stretches of the calendar, as their DTSTART and DTEND.
  const stretches = (body: string) =>
    [...body.matchAll(/\r\nDTSTART:(\w+)\r\nDTEND:(\w+)\r\nSUMMARY:disponible\r\n/g)].map(([, start, end]) => `${start}–${end}`)
  // Every feed read, the Loft holding `holds`, and Séjours with `occupations`.
  function readAll({ holds = [], occupations = [] }: { holds?: FeedRead['events']; occupations?: FeedRead['events'] } = {}) {
    feeds.list.mockResolvedValue([...FEEDS, LOFT])
    read.set('feed-0', { events: occupations, readAt: NOW, error: null })
    read.set('feed-1', { events: [], readAt: NOW, error: null })
    read.set('feed-loft', { events: holds, readAt: NOW, error: null })
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('gives an empty calendar right away without any `holds` feed, even before the feeds of occupations are read', async () => {
    const response = await get()
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/calendar; charset=utf-8')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toContain('X-WR-CALNAME:Parking Radio · disponibilités\r\n')
    expect(response.body).not.toContain('BEGIN:VEVENT')
    // Not even about a feed whose last read failed.
    read.set('feed-0', { events: [], readAt: null, error: "The link's server can't be reached" })
    expect((await get()).body).not.toContain('BEGIN:VEVENT')
  })

  it('fails with 503 until a read of every feed, of either kind, with the link it has, has ended since the server started', async () => {
    readAll()
    read.delete('feed-loft')
    let response = await get()
    expect(response.statusCode).toBe(503)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ ok: false, error: "The calendar feeds haven't all been read yet, with their links, since the server started" })
    readAll()
    read.delete('feed-1')
    expect((await get()).statusCode).toBe(503)
    readAll()
    response = await get()
    expect(response.statusCode).toBe(200)
  })

  it('gives the available time of the year ahead, from 00:00 today, as the calendar has it for those days, with stretches across midnight whole', async () => {
    readAll({
      holds: [
        span('2026-11-18T23:00:00Z', '2026-11-19T20:00:00Z'),
        span('2026-11-21T02:00:00Z', '2026-11-22T20:00:00Z'),
        span('2027-11-18T05:00:00Z', '2027-11-20T05:00:00Z'),
      ],
    })
    const body = (await get()).body
    // The first from 00:00 today, the part that's over too, the second across midnight in one, the last until the year ahead's end.
    expect(stretches(body)).toEqual(['20261119T050000Z–20261119T200000Z', '20261121T020000Z–20261122T200000Z', '20271118T050000Z–20271119T050000Z'])
    // The calendar of the year ahead's days.
    const yearAhead = { from: TODAY, to: new Date('2027-11-19T05:00:00Z') }
    expect(sessions.forCalendar).toHaveBeenCalledExactlyOnceWith(yearAhead, yearAhead)
    expect(body).toContain('DTSTAMP:20261119T153000Z')
  })

  it("is taken by occupations, and by sessions that aren't cancelled, done ones and one going on now too", async () => {
    readAll({
      holds: [span('2026-11-19T05:00:00Z', '2026-11-21T05:00:00Z')],
      occupations: [{ ...span('2026-11-20T14:00:00Z', '2026-11-20T16:00:00Z'), title: 'Réparation' }],
    })
    rows = [
      // Going on now, from 9:00 to 11:00 in Québec.
      storedSession({ id: 'now', startAt: new Date('2026-11-19T14:00:00Z'), durationMinutes: 120, status: 'planned' }),
      storedSession({ id: 'done', startAt: new Date('2026-11-19T20:00:00Z'), durationMinutes: 60, status: 'done' }),
      storedSession({ id: 'cancelled', startAt: new Date('2026-11-20T20:00:00Z'), durationMinutes: 60, status: 'cancelled' }),
      storedSession({ id: 'undated', startAt: null, status: 'planned' }),
    ]
    const body = (await get()).body
    expect(stretches(body)).toEqual([
      '20261119T050000Z–20261119T140000Z',
      '20261119T160000Z–20261119T200000Z',
      '20261119T210000Z–20261120T140000Z',
      '20261120T160000Z–20261121T050000Z',
    ])
    expect(body).not.toContain('Réparation')
  })

  it('has an event about each feed whose last read failed, of either kind, in the order of the feeds', async () => {
    readAll({ holds: [span('2026-11-20T14:00:00Z', '2026-11-20T16:00:00Z')] })
    read.set('feed-0', { events: [], readAt: null, error: "The link's server can't be reached" })
    read.set('feed-loft', { events: [span('2026-11-20T14:00:00Z', '2026-11-20T16:00:00Z')], readAt: NOW, error: 'The link answered with an error (404)' })
    const body = (await get()).body
    // What the Loft gave before its last read failed still protects time.
    expect(stretches(body)).toEqual(['20261120T140000Z–20261120T160000Z'])
    expect([...body.matchAll(/\r\nUID:(availability-feed-[^\r]+)\r\n/g)].map(([, uid]) => uid)).toEqual([
      'availability-feed-feed-0@parking.radio',
      'availability-feed-feed-loft@parking.radio',
    ])
    expect(body).toContain('SUMMARY:[REFRESH ERROR] Séjours\r\n')
    expect(body).toContain('SUMMARY:[REFRESH ERROR] Loft\r\n')
    expect(body).not.toContain('calendar.example')
  })

  it('counts a feed whose kind changed with what was read from it as its new kind', async () => {
    const hold = span('2026-11-20T14:00:00Z', '2026-11-20T16:00:00Z')
    read.set('feed-0', { events: [{ ...hold, title: 'Gardé' }], readAt: NOW, error: null })
    read.set('feed-1', { events: [], readAt: NOW, error: null })
    // Séjours, read as a feed of occupations, is now a `holds` feed: what was read from it are holds.
    feeds.list.mockResolvedValue(FEEDS.map((feed, index) => (index === 0 ? { ...feed, kind: 'holds' } : feed)))
    const body = (await get()).body
    expect(stretches(body)).toEqual(['20261120T140000Z–20261120T160000Z'])
    expect(body).not.toContain('Gardé')
    // Airbnb, not read yet, is now a `holds` feed too: it's waited for.
    read.delete('feed-1')
    feeds.list.mockResolvedValue(FEEDS.map((feed) => ({ ...feed, kind: 'holds' })))
    expect((await get()).statusCode).toBe(503)
  })

  it('is never kept, even when it fails unexpectedly', async () => {
    sessions.forCalendar.mockRejectedValueOnce(new Error('The database is gone'))
    const response = await get()
    expect(response.statusCode).toBe(500)
    expect(response.headers['cache-control']).toBe('no-store')
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
