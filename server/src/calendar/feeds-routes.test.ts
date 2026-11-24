import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { useZodSchemas } from '../api/schemas.js'
import type { CalendarFeedsStore, FeedChanges, NewFeed, StoredFeed } from './feeds.js'
import { LinkTaken } from './feeds.js'
import { FeedReadError, ReadAborted } from './fetch.js'
import type { CalendarReads, FeedRead, SuccessfulRead } from './reads.js'
import { calendarFeedsRoutes } from './feeds-routes.js'

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
  get: vi.fn(async (id: string) => feeds.find((feed) => feed.id === id.toLowerCase()) ?? null),
  add: vi.fn(async (feed: NewFeed): Promise<StoredFeed> => {
    const added = { ...feed, id: FEED_B, createdAt: NOW, updatedBy: null, updatedAt: null }
    feeds.push(added)
    return added
  }),
  update: vi.fn(async (id: string, changes: FeedChanges, by: string): Promise<StoredFeed | null> => {
    const index = feeds.findIndex((feed) => feed.id === id)
    if (index < 0) return null
    feeds[index] = { ...feeds[index], ...changes, updatedBy: by, updatedAt: NOW }
    return feeds[index]
  }),
  remove: vi.fn(async (id: string) => feeds.find((feed) => feed.id === id.toLowerCase())?.id ?? null),
} satisfies CalendarFeedsStore

let kept: Map<string, FeedRead>
const read = vi.fn<CalendarReads['read']>()
const reads: CalendarReads = {
  of: (id) => kept.get(id),
  read,
  added: vi.fn((id: string, done: SuccessfulRead) => kept.set(id, { ...done, error: null })),
  changed: vi.fn((id: string, _link: string, done?: SuccessfulRead) => {
    if (done) kept.set(id, { ...done, error: null })
  }),
  removed: vi.fn((id: string) => kept.delete(id)),
  start: vi.fn(),
  stop: vi.fn(),
  stopped: async () => {},
}

const EVENTS = [{ start: new Date('2026-11-23T15:00:00Z'), end: new Date('2026-11-23T16:00:00Z'), wholeDay: false, title: 'Réparation' }]

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

async function change(app: App, id: string, body: unknown) {
  return app.inject({ method: 'PATCH', url: `${URL}/${id}`, payload: body as object, cookies: await sessionCookies() })
}

describe('calendar feeds routes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    process.env.JWT_SECRET = 'test-secret'
    vi.clearAllMocks()
    feeds = [
      {
        id: FEED_A,
        name: "Calendrier de l'équipe",
        link: LINK,
        createdBy: 'someone@example.com',
        createdAt: new Date('2026-11-01T12:00:00Z'),
        updatedBy: null,
        updatedAt: null,
      },
    ]
    kept = new Map()
    read.mockImplementation(async ({ link }) => ({ events: EVENTS, readAt: NOW, link }))
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.JWT_SECRET
  })

  describe('GET /api/admin/calendar/feeds', () => {
    it('gives every feed, with its link, when it was last read, and why that failed', async () => {
      const app = await buildApp()
      const list = async () => (await app.inject({ method: 'GET', url: URL, cookies: await sessionCookies() })).json()
      const feed = {
        ...{ id: FEED_A, name: "Calendrier de l'équipe", link: LINK },
        ...{ createdBy: 'someone@example.com', createdAt: '2026-11-01T07:00:00-05:00', updatedBy: null, updatedAt: null },
      }

      expect(await list()).toEqual({ ok: true, total: 1, feeds: [{ ...feed, readAt: null, error: null }] })
      kept.set(FEED_A, { events: EVENTS, readAt: NOW, error: "The link can't be read: its server fails (503)", link: LINK })
      expect(await list()).toEqual({ ok: true, total: 1, feeds: [{ ...feed, readAt: '2026-11-22T12:00:00-05:00', error: "The link can't be read: its server fails (503)" }] })
      // What was read from another link isn't the feed's, e.g. on a server that hasn't taken in a change of link yet.
      kept.set(FEED_A, { events: EVENTS, readAt: NOW, error: "The link can't be read: its server fails (503)", link: 'https://example.com/former.ics' })
      expect(await list()).toEqual({ ok: true, total: 1, feeds: [{ ...feed, readAt: null, error: null }] })
    })

    it('requires a session', async () => {
      const app = await buildApp()
      expect((await app.inject({ method: 'GET', url: URL })).statusCode).toBe(401)
    })
  })

  describe('POST /api/admin/calendar/feeds', () => {
    it('reads the link, then adds the feed with that read as its first', async () => {
      const app = await buildApp()
      const response = await add(app, { name: '  Séjours ', link: 'webcal://example.com/stays.ics#x' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        ok: true,
        feed: {
          ...{ id: FEED_B, name: 'Séjours', link: 'https://example.com/stays.ics' },
          ...{ createdBy: 'admin@example.com', createdAt: '2026-11-22T12:00:00-05:00', updatedBy: null, updatedAt: null },
          ...{ readAt: '2026-11-22T12:00:00-05:00', error: null },
        },
      })
      const link = 'https://example.com/stays.ics'
      expect(read).toHaveBeenCalledExactlyOnceWith({ name: 'Séjours', link })
      expect(store.add).toHaveBeenCalledExactlyOnceWith({ name: 'Séjours', link, createdBy: 'admin@example.com' })
      expect(reads.added).toHaveBeenCalledExactlyOnceWith(FEED_B, { events: EVENTS, readAt: NOW, link })
    })

    it("refuses a link that's already a feed's, naming that feed, without reading it", async () => {
      const app = await buildApp()
      for (const link of [LINK, LINK.replace('https:', 'webcal:'), `${LINK}#again`]) {
        const response = await add(app, { name: 'Again', link })
        expect(response.statusCode).toBe(409)
        expect(response.json()).toEqual({ ok: false, error: `The feed "Calendrier de l'équipe" already has this link` })
      }
      expect(read).not.toHaveBeenCalled()
      expect(store.add).not.toHaveBeenCalled()
    })

    it('refuses a link that was added while it was being read', async () => {
      store.add.mockRejectedValueOnce(new LinkTaken({ name: 'Other' }))
      const app = await buildApp()
      const response = await add(app, { name: 'New', link: 'https://example.com/new.ics' })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: 'The feed "Other" already has this link' })
      expect(reads.added).not.toHaveBeenCalled()
    })

    it("refuses fields that don't follow their rules, and those it doesn't take", async () => {
      const app = await buildApp()
      const valid = { name: 'New', link: 'https://example.com/new.ics' }
      const refused = [
        [{ ...valid, name: ' ' }, '`name`: The name must not be blank'],
        [{ ...valid, privateTitles: true }, 'Unknown field: `privateTitles`'],
        [{ ...valid, kind: 'occupation' }, 'Unknown field: `kind`'],
        [{ ...valid, link: `http://example.com/${SECRET}` }, '`link`: The link must be an https or webcal link'],
        [{ ...valid, link: `https://user:${SECRET}@example.com/` }, "`link`: The link can't have a user name or a password"],
        [{ ...valid, url: 'x' }, 'Unknown field: `url`'],
        [{ name: 'New' }, '`link`'],
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
        const response = await add(app, { name: 'New', link: 'https://example.com/new.ics' })
        expect(response.statusCode).toBe(status)
        expect(response.json()).toEqual({ ok: false, error: message })
      }
      read.mockRejectedValueOnce(new ReadAborted())
      const response = await add(app, { name: 'New', link: 'https://example.com/new.ics' })
      expect(response.statusCode).toBe(502)
      expect(store.add).not.toHaveBeenCalled()
    })

    it('refuses requests from other sites', async () => {
      const app = await buildApp()
      const response = await add(app, { name: 'New', link: 'https://example.com/new.ics' }, { 'sec-fetch-site': 'cross-site' })
      expect(response.statusCode).toBe(403)
      expect(read).not.toHaveBeenCalled()
    })

    it('never logs the link', async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      const link = `https://example.com/${SECRET}.ics`
      await add(app, { name: 'New', link })
      await add(app, { name: 'Again', link })
      read.mockRejectedValueOnce(new FeedReadError(400, "The link can't be read: its server refuses it (404)"))
      await add(app, { name: 'Other', link: `${link}?other` })
      await add(app, { name: 'Bad', link: `http://example.com/${SECRET}` })
      expect(logs.length).toBeGreaterThan(4)
      for (const line of logs) expect(line).not.toContain(SECRET)
    })
  })

  describe('PATCH /api/admin/calendar/feeds/:id', () => {
    const NEW_LINK = 'https://example.com/new.ics'

    it('changes the name without reading the feed, and says who changed it', async () => {
      const app = await buildApp()
      const response = await change(app, FEED_A.toUpperCase(), { name: ' Équipe ' })
      expect(response.statusCode).toBe(200)
      expect(response.json().feed).toEqual({
        ...{ id: FEED_A, name: 'Équipe', link: LINK },
        ...{ createdBy: 'someone@example.com', createdAt: '2026-11-01T07:00:00-05:00', updatedBy: 'admin@example.com', updatedAt: '2026-11-22T12:00:00-05:00' },
        ...{ readAt: null, error: null },
      })
      expect(read).not.toHaveBeenCalled()
      expect(store.update).toHaveBeenCalledExactlyOnceWith(FEED_A, { name: 'Équipe' }, 'admin@example.com')
      expect(reads.changed).toHaveBeenCalledExactlyOnceWith(FEED_A, LINK, undefined)
    })

    it("doesn't read the feed's own link, e.g. as a webcal link, which no other feed has", async () => {
      const app = await buildApp()
      const response = await change(app, FEED_A, { link: `${LINK.replace('https:', 'webcal:')}#x` })
      expect(response.statusCode).toBe(200)
      expect(response.json().feed).toMatchObject({ link: LINK })
      expect(read).not.toHaveBeenCalled()
      expect(reads.changed).toHaveBeenCalledExactlyOnceWith(FEED_A, LINK, undefined)
    })

    it('reads a new link, then changes the feed with that read in place of the former one', async () => {
      const app = await buildApp()
      const response = await change(app, FEED_A, { link: 'webcal://example.com/new.ics' })
      expect(response.statusCode).toBe(200)
      expect(response.json().feed).toMatchObject({ link: NEW_LINK, readAt: '2026-11-22T12:00:00-05:00', error: null })
      expect(read).toHaveBeenCalledExactlyOnceWith({ id: FEED_A, name: "Calendrier de l'équipe", link: NEW_LINK })
      expect(reads.changed).toHaveBeenCalledExactlyOnceWith(FEED_A, NEW_LINK, { events: EVENTS, readAt: NOW, link: NEW_LINK })
    })

    it("fails like the read when the new link doesn't give a calendar, or can't be read for now, without changing the feed", async () => {
      const app = await buildApp()
      for (const [status, message] of [
        [400, "The link can't be read: its answer isn't valid iCalendar"],
        [502, "The link can't be read: its server can't be found"],
      ] as const) {
        read.mockRejectedValueOnce(new FeedReadError(status, message))
        const response = await change(app, FEED_A, { name: 'Renamed', link: NEW_LINK })
        expect(response.statusCode).toBe(status)
        expect(response.json()).toEqual({ ok: false, error: message })
      }
      read.mockRejectedValueOnce(new ReadAborted())
      expect((await change(app, FEED_A, { link: NEW_LINK })).statusCode).toBe(502)
      expect(store.update).not.toHaveBeenCalled()
      expect(reads.changed).not.toHaveBeenCalled()
    })

    it("refuses another feed's link, naming that feed, without reading it, even when it took it meanwhile", async () => {
      feeds.push({ ...feeds[0], id: FEED_B, name: 'Séjours', link: NEW_LINK })
      const app = await buildApp()
      const response = await change(app, FEED_A, { link: NEW_LINK })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ ok: false, error: 'The feed "Séjours" already has this link' })
      expect(read).not.toHaveBeenCalled()

      store.update.mockRejectedValueOnce(new LinkTaken({ name: 'Other' }))
      const meanwhile = await change(app, FEED_A, { link: 'https://example.com/other.ics' })
      expect(meanwhile.statusCode).toBe(409)
      expect(meanwhile.json()).toEqual({ ok: false, error: 'The feed "Other" already has this link' })
      expect(reads.changed).not.toHaveBeenCalled()
    })

    it("fails with 404 when there's no such feed, or it's removed while its new link is read", async () => {
      const app = await buildApp()
      for (const id of [FEED_B, 'not-a-uuid']) {
        const response = await change(app, id, { name: 'Renamed' })
        expect(response.statusCode).toBe(404)
        expect(response.json()).toEqual({ ok: false, error: 'No such feed' })
      }
      read.mockImplementationOnce(async ({ link }) => {
        feeds = []
        return { events: EVENTS, readAt: NOW, link }
      })
      const response = await change(app, FEED_A, { link: NEW_LINK })
      expect(response.statusCode).toBe(404)
      expect(reads.changed).not.toHaveBeenCalled()
    })

    it("refuses fields that don't follow their rules, those it doesn't take, and no field at all", async () => {
      const app = await buildApp()
      const refused = [
        [{}, 'There must be at least one field to change'],
        [{ name: ' ' }, '`name`: The name must not be blank'],
        [{ privateTitles: true }, 'Unknown field: `privateTitles`'],
        [{ link: `http://example.com/${SECRET}` }, '`link`: The link must be an https or webcal link'],
        [{ name: 'x', kind: 'occupation' }, 'Unknown field: `kind`'],
      ] as const
      for (const [body, error] of refused) {
        const response = await change(app, FEED_A, body)
        expect(response.statusCode, error).toBe(400)
        expect(response.json().error).toContain(error)
        expect(response.body).not.toContain(SECRET)
      }
      expect(store.update).not.toHaveBeenCalled()
    })

    it('never logs the link', async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      await change(app, FEED_A, { link: `https://example.com/${SECRET}.ics` })
      read.mockRejectedValueOnce(new FeedReadError(400, "The link can't be read: its server refuses it (404)"))
      await change(app, FEED_A, { link: `https://example.com/${SECRET}-2.ics` })
      await change(app, FEED_A, { link: `http://example.com/${SECRET}` })
      expect(logs.some((line) => line.includes('Changed a calendar feed'))).toBe(true)
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
