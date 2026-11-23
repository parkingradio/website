import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import { addDays } from '../api/formats.js'
import { useZodSchemas } from '../api/schemas.js'
import type { Status } from '../sessions/fields.js'
import type { SessionsStore, StoredSession } from '../sessions/store.js'
import { adminCalendarRoutes } from './calendar-routes.js'
import type { CalendarFeedsStore, StoredFeed } from './feeds.js'
import type { CalendarReads, FeedRead } from './reads.js'

// The studio's calendar (see "The calendar" in docs/design/server/calendar.md), with fake stores and reads.

const URL = '/api/admin/calendar'
// Monday, November 23, 2026, at noon in Québec.
const NOW = new Date('2026-11-23T17:00:00Z')

const TEAM = '6f1c3c8e-1b7a-4c1e-9d3f-2a1b0c9d8e7f'
const STAYS = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d'
const UNREAD = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e'

const FEEDS: StoredFeed[] = [
  { id: TEAM, name: "Calendrier de l'équipe", kind: 'occupation', link: 'https://example.com/team.ics', createdBy: 'someone@example.com', createdAt: new Date('2026-11-01T12:00:00Z') },
  { id: STAYS, name: 'Séjours', kind: 'quiet-time', link: 'https://example.com/stays.ics', createdBy: 'someone@example.com', createdAt: new Date('2026-11-02T12:00:00Z') },
  { id: UNREAD, name: 'Autre', kind: 'occupation', link: 'https://example.com/other.ics', createdBy: 'someone@example.com', createdAt: new Date('2026-11-03T12:00:00Z') },
]
const feeds = { list: vi.fn(async () => FEEDS), withLink: vi.fn(), add: vi.fn(), remove: vi.fn() } satisfies CalendarFeedsStore

const event = (start: string, end: string, title: string | null, wholeDay = false) => ({ start: new Date(start), end: new Date(end), wholeDay, title })

let kept: Map<string, FeedRead>
const reads: CalendarReads = {
  of: vi.fn((id: string) => kept.get(id)),
  read: vi.fn(),
  added: vi.fn(),
  removed: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  stopped: async () => {},
}

// A session, as the store keeps it.
function session(id: string, startAt: string | null, durationMinutes: number, status: Status = 'planned', createdAt = '2026-10-01T12:00:00Z'): StoredSession {
  return {
    id,
    createdAt: new Date(createdAt),
    createdBy: 'admin@example.com',
    startAt: startAt === null ? null : new Date(startAt),
    durationMinutes,
    type: 'guest-mixes',
    name: '',
    takeoverId: null,
    applicationId: null,
    raEventId: null,
    description: '',
    flyerKey: null,
    flyerType: null,
    updatedBy: null,
    updatedAt: null,
    status,
    statusUpdatedBy: null,
    statusUpdatedAt: null,
    announced: false,
    announcedUpdatedBy: null,
    announcedUpdatedAt: null,
    takeover: null,
    application: null,
    sets: [],
  }
}

let rows: StoredSession[]
const overlaps = (row: StoredSession, { from, to }: { from: Date; to: Date }) =>
  row.startAt !== null && row.startAt < to && row.startAt.getTime() + row.durationMinutes * 60_000 > from.getTime()
// As the store has it, in any order, since the route orders them.
const forCalendar = vi.fn<SessionsStore['forCalendar']>(async (range, window) =>
  rows.filter((row) => overlaps(row, range) || (row.status !== 'cancelled' && (row.startAt === null || overlaps(row, window)))),
)
const sessions = { forCalendar } as unknown as SessionsStore

async function buildApp() {
  const app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(adminCalendarRoutes, { feeds, reads, sessions })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

async function calendar(app: App, query: string) {
  return app.inject({ method: 'GET', url: `${URL}?${query}`, cookies: await sessionCookies() })
}

describe('GET /api/admin/calendar', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    process.env.JWT_SECRET = 'test-secret'
    vi.clearAllMocks()
    rows = []
    kept = new Map()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.JWT_SECRET
  })

  it("gives what takes the studio over the days, the feeds, and what needs settling", async () => {
    rows = [
      // Started the day before, and still going on at 00:00 on the first day, which takes the day of 25 hours.
      session('overnight', '2026-11-01T03:00:00Z', 180),
      session('cancelled', '2026-11-14T02:00:00Z', 120, 'cancelled'),
      session('done', '2026-11-10T00:00:00Z', 120, 'done'),
      // Ends when the first day starts.
      session('before', '2026-10-31T23:00:00Z', 300),
      // Starts when the day after the last one does.
      session('after', '2026-12-01T05:00:00Z', 60),
      session('undated-old', null, 60, 'planned', '2026-09-01T12:00:00Z'),
      session('undated-new', null, 60, 'planned', '2026-10-01T12:00:00Z'),
      session('undated-cancelled', null, 60, 'cancelled'),
      // In the next 365 days, overlapping a whole-day occupation.
      session('upcoming', '2026-12-10T00:00:00Z', 120),
    ]
    kept.set(TEAM, {
      events: [
        event('2026-10-31T20:00:00Z', '2026-11-01T04:00:00Z', 'Avant'),
        event('2026-11-10T01:00:00Z', '2026-11-10T03:00:00Z', 'Réparation'),
        event('2026-12-09T05:00:00Z', '2026-12-10T05:00:00Z', 'Anniversaire', true),
      ],
      readAt: new Date('2026-11-23T16:50:00Z'),
      error: null,
    })
    // Its last read failed: it gives what it read before.
    kept.set(STAYS, { events: [event('2026-11-20T21:00:00Z', '2026-11-22T16:00:00Z', null)], readAt: new Date('2026-11-23T16:35:00Z'), error: "The link can't be read: its server fails (503)" })
    const app = await buildApp()
    const response = await calendar(app, 'from=2026-11-01&to=2026-11-30')
    expect(response.statusCode).toBe(200)

    // From 00:00 on November 1, in summer time, to 00:00 on December 1, in winter time, and the 365 days from today.
    expect(forCalendar).toHaveBeenCalledExactlyOnceWith(
      { from: new Date('2026-11-01T04:00:00Z'), to: new Date('2026-12-01T05:00:00Z') },
      { from: new Date('2026-11-23T05:00:00Z'), to: new Date('2027-11-23T05:00:00Z') },
    )
    const body = response.json()
    expect(body.ok).toBe(true)
    expect(body.today).toBe('2026-11-23')
    expect(body.feeds).toEqual([
      { id: TEAM, name: "Calendrier de l'équipe", kind: 'occupation', createdBy: 'someone@example.com', createdAt: '2026-11-01T07:00:00-05:00', readAt: '2026-11-23T11:50:00-05:00', error: null },
      { id: STAYS, name: 'Séjours', kind: 'quiet-time', createdBy: 'someone@example.com', createdAt: '2026-11-02T07:00:00-05:00', readAt: '2026-11-23T11:35:00-05:00', error: "The link can't be read: its server fails (503)" },
      { id: UNREAD, name: 'Autre', kind: 'occupation', createdBy: 'someone@example.com', createdAt: '2026-11-03T07:00:00-05:00', readAt: null, error: null },
    ])
    expect(body.sessions.map(({ id }: { id: string }) => id)).toEqual(['overnight', 'done', 'cancelled'])
    expect(body.sessions[0]).toMatchObject({ id: 'overnight', start: '2026-10-31T23:00:00-04:00', end: '2026-11-01T01:00:00-05:00', title: 'GUEST MIXES', sets: [] })
    // Not the one that ends when the first day starts.
    expect(body.occupations).toEqual([{ feed: TEAM, start: '2026-11-09T20:00:00-05:00', end: '2026-11-09T22:00:00-05:00', wholeDay: false, title: 'Réparation' }])
    expect(body.quietTimes).toEqual([{ feed: STAYS, start: '2026-11-20T16:00:00-05:00', end: '2026-11-22T11:00:00-05:00', wholeDay: false }])
    // Only those of the next 365 days: not the done session's, which is before today.
    expect(body.conflicts).toEqual([
      {
        start: '2026-12-09T19:00:00-05:00',
        end: '2026-12-09T21:00:00-05:00',
        things: [
          { kind: 'occupation', feed: TEAM, start: '2026-12-09T00:00:00-05:00', end: '2026-12-10T00:00:00-05:00', wholeDay: true, title: 'Anniversaire' },
          { kind: 'session', id: 'upcoming', title: 'GUEST MIXES', start: '2026-12-09T19:00:00-05:00', end: '2026-12-09T21:00:00-05:00', status: 'planned' },
        ],
      },
    ])
    expect(body.undatedSessions.map(({ id }: { id: string }) => id)).toEqual(['undated-new', 'undated-old'])

    // Whatever the days asked for, the conflicts and the sessions without a date are the same.
    const other = (await calendar(app, 'from=2030-01-01&to=2030-01-01')).json()
    expect(other).toMatchObject({ today: '2026-11-23', sessions: [], occupations: [], quietTimes: [], conflicts: body.conflicts, undatedSessions: body.undatedSessions })
    expect(reads.of).toHaveBeenCalledTimes(2 * FEEDS.length)
  })

  it('gives the sessions by start, then by when they were added, then by id, and quiet time without a title', async () => {
    rows = [
      session('b', '2026-11-23T20:00:00Z', 60, 'cancelled', '2026-10-02T12:00:00Z'),
      session('c', '2026-11-23T20:00:00Z', 60, 'cancelled', '2026-10-01T12:00:00Z'),
      session('a', '2026-11-23T20:00:00Z', 60, 'planned', '2026-10-02T12:00:00Z'),
      session('z', '2026-11-23T18:00:00Z', 60),
    ]
    kept.set(STAYS, { events: [event('2026-11-23T05:00:00Z', '2026-11-24T05:00:00Z', null, true)], readAt: NOW, error: null })
    const body = (await calendar(await buildApp(), 'from=2026-11-23&to=2026-11-23')).json()
    expect(body.sessions.map(({ id }: { id: string }) => id)).toEqual(['z', 'c', 'a', 'b'])
    expect(body.quietTimes).toEqual([{ feed: STAYS, start: '2026-11-23T00:00:00-05:00', end: '2026-11-24T00:00:00-05:00', wholeDay: true }])
    expect(body.conflicts.map(({ things }: { things: { kind: string; id?: string }[] }) => things.map(({ kind, id }) => id ?? kind))).toEqual([['quiet-time', 'z'], ['quiet-time', 'a']])
    expect(body.conflicts[0].things[0]).toEqual({ kind: 'quiet-time', feed: STAYS, start: '2026-11-23T00:00:00-05:00', end: '2026-11-24T00:00:00-05:00', wholeDay: true })
  })

  it('counts the conflicts from today in Québec, from 00:00', async () => {
    // 23:30 on November 23 in Québec, which is already the 24th in UTC.
    vi.setSystemTime(new Date('2026-11-24T04:30:00Z'))
    rows = [session('this-morning', '2026-11-23T14:00:00Z', 60), session('yesterday', '2026-11-22T14:00:00Z', 60)]
    kept.set(TEAM, { events: [event('2026-11-22T05:00:00Z', '2026-11-24T05:00:00Z', 'Fermé', true)], readAt: NOW, error: null })
    const body = (await calendar(await buildApp(), 'from=2026-11-23&to=2026-11-23')).json()
    expect(body.today).toBe('2026-11-23')
    expect(forCalendar.mock.calls[0][1]).toEqual({ from: new Date('2026-11-23T05:00:00Z'), to: new Date('2027-11-23T05:00:00Z') })
    expect(body.conflicts.map(({ things }: { things: { id?: string }[] }) => things[1].id)).toEqual(['this-morning'])
  })

  it('refuses days that are missing, given twice, or not days from 2000 to 2999, and more than 400 days', async () => {
    const app = await buildApp()
    const day = (name: string) => `\`${name}\` must be a single day, YYYY-MM-DD, without a time, from 2000-01-01 to 2999-12-31`
    const refused = [
      ['to=2026-11-30', day('from')],
      ['from=2026-11-01', day('to')],
      ['from=2026-11-01&from=2026-11-02&to=2026-11-30', day('from')],
      ['from=2026-11-01&to=2026-11-30&to=2026-12-01', day('to')],
      ['from=2026-11&to=2026-11-30', day('from')],
      ['from=2026-11-01T00:00-04:00&to=2026-11-30', day('from')],
      ['from=2026-02-30&to=2026-03-01', day('from')],
      ['from=1999-12-31&to=2000-01-01', day('from')],
      ['from=2999-12-31&to=3000-01-01', day('to')],
      ['from=2026-11-30&to=2026-11-29', "`to` can't be before `from`"],
      [`from=2026-01-01&to=${addDays('2026-01-01', 400)}`, 'The calendar has at most 400 days, `from` and `to` included'],
    ] as const
    for (const [query, error] of refused) {
      const response = await calendar(app, query)
      expect(response.statusCode, query).toBe(400)
      expect(response.json(), query).toEqual({ ok: false, error })
    }
    expect(forCalendar).not.toHaveBeenCalled()
    for (const query of [`from=2026-01-01&to=${addDays('2026-01-01', 399)}`, 'from=2000-01-01&to=2000-01-01', 'from=2999-12-31&to=2999-12-31']) {
      expect((await calendar(app, query)).statusCode, query).toBe(200)
    }
  })

  it('requires a session', async () => {
    const app = await buildApp()
    expect((await app.inject({ method: 'GET', url: `${URL}?from=2026-11-01&to=2026-11-30` })).statusCode).toBe(401)
  })
})
