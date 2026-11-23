import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { useZodSchemas } from '../api/schemas.js'
import type { CalendarFeedsStore, NewFeed, StoredFeed } from './feeds.js'
import { LinkTaken } from './feeds.js'
import { FeedReadError, ReadAborted } from './fetch.js'
import type { CalendarReads, FeedRead, SuccessfulRead } from './reads.js'
import { calendarFeedsRoutes } from './routes.js'

// The endpoints of calendar feeds (see docs/design/server/calendar.md), with a fake store and fake reads.

const URL = '/api/admin/calendar/feeds'
const LINK = 'https://calendar.google.com/calendar/ical/team%40group.calendar.google.com/private-0123456789abcdef/basic.ics'
const SECRET = 'private-0123456789abcdef'
const NOW = new Date('2026-11-22T17:00:00Z')

const FEED_A = '6f1c3c8e-1b7a-4c1e-9d3f-2a1b0c9d8e7f'
const FEED_B = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d'

let feeds: StoredFeed[]
const store = {
  list: vi.fn(async () => feeds),
  withLink: vi.fn(async (link: string) => feeds.find((feed) => feed.link === link) ?? null),
  add: vi.fn(async (feed: NewFeed): Promise<StoredFeed> => {
    const added = { ...feed, id: FEED_B, createdAt: NOW }
    feeds.push(added)
    return added
  }),
  remove: vi.fn(async (id: string) => feeds.find((feed) => feed.id === id.toLowerCase())?.id ?? null),
} satisfies CalendarFeedsStore

let kept: Map<string, FeedRead>
const read = vi.fn<CalendarReads['read']>()
const reads: CalendarReads = {
  of: (id) => kept.get(id),
  read,
  added: vi.fn((id: string, done: SuccessfulRead) => kept.set(id, { ...done, error: null })),
  removed: vi.fn((id: string) => kept.delete(id)),
  start: vi.fn(),
  stop: vi.fn(),
  stopped: async () => {},
}

const EVENTS = [{ start: new Date('2026-11-23T15:00:00Z'), end: new Date('2026-11-23T16:00:00Z'), title: 'Réparation' }]

async function buildApp(logs?: string[]) {
  const app = Fastify({ logger: logs ? { level: 'info', stream: { write: (line: string) => logs.push(line) } } : false })
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(calendarFeedsRoutes, { feeds: store, reads })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

async function add(app: App, body: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url: URL, payload: body as object, headers, cookies: await sessionCookies() })
}

describe('calendar feeds routes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    process.env.JWT_SECRET = 'test-secret'
    vi.clearAllMocks()
    feeds = [{ id: FEED_A, name: "Calendrier de l'équipe", kind: 'occupation', link: LINK, createdBy: 'someone@example.com', createdAt: new Date('2026-11-01T12:00:00Z') }]
    kept = new Map()
    read.mockImplementation(async () => ({ events: EVENTS, readAt: NOW }))
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.JWT_SECRET
  })

  describe('GET /api/admin/calendar/feeds', () => {
    it('gives every feed, when it was last read, and why that failed, without its link', async () => {
      const app = await buildApp()
      const list = async () => (await app.inject({ method: 'GET', url: URL, cookies: await sessionCookies() })).json()
      const feed = { id: FEED_A, name: "Calendrier de l'équipe", kind: 'occupation', createdBy: 'someone@example.com', createdAt: '2026-11-01T07:00:00-05:00' }

      expect(await list()).toEqual({ ok: true, total: 1, feeds: [{ ...feed, readAt: null, error: null }] })
      kept.set(FEED_A, { events: EVENTS, readAt: NOW, error: "The link can't be read: its server fails (503)" })
      const listed = await list()
      expect(listed).toEqual({ ok: true, total: 1, feeds: [{ ...feed, readAt: '2026-11-22T12:00:00-05:00', error: "The link can't be read: its server fails (503)" }] })
      expect(JSON.stringify(listed)).not.toContain(SECRET)
    })

    it('requires a session', async () => {
      const app = await buildApp()
      expect((await app.inject({ method: 'GET', url: URL })).statusCode).toBe(401)
    })
  })

  describe('POST /api/admin/calendar/feeds', () => {
    it('reads the link, then adds the feed with that read as its first', async () => {
      const app = await buildApp()
      const response = await add(app, { name: '  Séjours ', kind: 'quiet-time', link: 'webcal://example.com/stays.ics#x' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        ok: true,
        feed: { id: FEED_B, name: 'Séjours', kind: 'quiet-time', createdBy: 'admin@example.com', createdAt: '2026-11-22T12:00:00-05:00', readAt: '2026-11-22T12:00:00-05:00', error: null },
      })
      expect(read).toHaveBeenCalledExactlyOnceWith({ name: 'Séjours', kind: 'quiet-time', link: 'https://example.com/stays.ics' })
      expect(store.add).toHaveBeenCalledExactlyOnceWith({ name: 'Séjours', kind: 'quiet-time', link: 'https://example.com/stays.ics', createdBy: 'admin@example.com' })
      expect(reads.added).toHaveBeenCalledExactlyOnceWith(FEED_B, { events: EVENTS, readAt: NOW })
    })

    it("refuses a link that's already a feed's, naming that feed, without reading it", async () => {
      const app = await buildApp()
      for (const link of [LINK, LINK.replace('https:', 'webcal:'), `${LINK}#again`]) {
        const response = await add(app, { name: 'Again', kind: 'occupation', link })
        expect(response.statusCode).toBe(409)
        expect(response.json()).toEqual({ ok: false, error: `The feed "Calendrier de l'équipe" already has this link` })
      }
      expect(read).not.toHaveBeenCalled()
      expect(store.add).not.toHaveBeenCalled()
    })

    it('refuses a link that was added while it was being read', async () => {
      store.add.mockRejectedValueOnce(new LinkTaken({ name: 'Other' }))
      const app = await buildApp()
      const response = await add(app, { name: 'New', kind: 'occupation', link: 'https://example.com/new.ics' })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: 'The feed "Other" already has this link' })
      expect(reads.added).not.toHaveBeenCalled()
    })

    it("refuses fields that don't follow their rules, and those it doesn't take", async () => {
      const app = await buildApp()
      const valid = { name: 'New', kind: 'occupation', link: 'https://example.com/new.ics' }
      const refused = [
        [{ ...valid, name: ' ' }, '`name`: The name must not be blank'],
        [{ ...valid, kind: 'session' }, '`kind`'],
        [{ ...valid, link: `http://example.com/${SECRET}` }, '`link`: The link must be an https or webcal link'],
        [{ ...valid, link: `https://user:${SECRET}@example.com/` }, "`link`: The link can't have a user name or a password"],
        [{ ...valid, url: 'x' }, 'Unknown field: `url`'],
        [{ name: 'New', kind: 'occupation' }, '`link`'],
      ] as const
      for (const [body, error] of refused) {
        const response = await add(app, body)
        expect(response.statusCode, error).toBe(400)
        expect(response.json().error).toContain(error)
        expect(response.body).not.toContain(SECRET)
      }
      expect(read).not.toHaveBeenCalled()
    })

    it("fails like the read when the link doesn't give a calendar, or can't be read for now, without adding it", async () => {
      const app = await buildApp()
      for (const [status, message] of [
        [400, "The link can't be read: its answer isn't valid iCalendar"],
        [502, "The link can't be read: its server can't be found"],
      ] as const) {
        read.mockRejectedValueOnce(new FeedReadError(status, message))
        const response = await add(app, { name: 'New', kind: 'occupation', link: 'https://example.com/new.ics' })
        expect(response.statusCode).toBe(status)
        expect(response.json()).toEqual({ ok: false, error: message })
      }
      read.mockRejectedValueOnce(new ReadAborted())
      const response = await add(app, { name: 'New', kind: 'occupation', link: 'https://example.com/new.ics' })
      expect(response.statusCode).toBe(502)
      expect(store.add).not.toHaveBeenCalled()
    })

    it('refuses requests from other sites', async () => {
      const app = await buildApp()
      const response = await add(app, { name: 'New', kind: 'occupation', link: 'https://example.com/new.ics' }, { 'sec-fetch-site': 'cross-site' })
      expect(response.statusCode).toBe(403)
      expect(read).not.toHaveBeenCalled()
    })

    it('never logs the link', async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      const link = `https://example.com/${SECRET}.ics`
      await add(app, { name: 'New', kind: 'occupation', link })
      await add(app, { name: 'Again', kind: 'occupation', link })
      read.mockRejectedValueOnce(new FeedReadError(400, "The link can't be read: its server refuses it (404)"))
      await add(app, { name: 'Other', kind: 'occupation', link: `${link}?other` })
      await add(app, { name: 'Bad', kind: 'occupation', link: `http://example.com/${SECRET}` })
      expect(logs.length).toBeGreaterThan(4)
      for (const line of logs) expect(line).not.toContain(SECRET)
    })
  })

  describe('DELETE /api/admin/calendar/feeds/:id', () => {
    it('removes a feed, and forgets what was read from it', async () => {
      const app = await buildApp()
      const response = await app.inject({ method: 'DELETE', url: `${URL}/${FEED_A.toUpperCase()}`, cookies: await sessionCookies() })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ok: true })
      expect(reads.removed).toHaveBeenCalledExactlyOnceWith(FEED_A)
    })

    it("fails with 404 when there's no such feed", async () => {
      const app = await buildApp()
      for (const id of [FEED_B, 'not-a-uuid']) {
        const response = await app.inject({ method: 'DELETE', url: `${URL}/${id}`, cookies: await sessionCookies() })
        expect(response.statusCode).toBe(404)
        expect(response.json()).toEqual({ ok: false, error: 'No such feed' })
      }
      expect(reads.removed).not.toHaveBeenCalled()
    })
  })
})
