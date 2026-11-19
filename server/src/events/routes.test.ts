import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import type { Photos } from '../artists/store.js'
import { calendarRoutes } from './calendar.js'
import { eventsRoutes } from './routes.js'
import type { EventsStore } from './store.js'

// The public events' routes, without a database: only what's refused before the store is asked, and what the calendar
// feed asks it. What they give is tested against a real database (see public.db.test.ts, and calendar.test.ts for the
// feed itself).

const store: EventsStore = {
  list: vi.fn<EventsStore['list']>(async () => ({ upcoming: [], past: [] })),
  feed: vi.fn<EventsStore['feed']>(async () => []),
  getFlyer: async () => null,
}

async function buildApp() {
  const app = Fastify({ logger: false })
  useZodSchemas(app)
  await app.register(eventsRoutes, { store, photos: {} as Photos })
  await app.register(calendarRoutes, { store, siteOrigin: 'https://parking.radio' })
  return app
}

describe('GET /api/events', () => {
  it('takes a time range like the other lists, which it refuses before asking the store', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/api/events?from=2026-11-14T21:00-05:00&to=2026-11-14T21:00-05:00' })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ ok: false, error: '`from` must be before `to`' })
    expect(store.list).not.toHaveBeenCalled()

    const ranged = await app.inject({ method: 'GET', url: '/api/events?from=2026-11-14T21:00-05:00' })
    expect(ranged.json()).toEqual({ ok: true, upcoming: [], past: [] })
    expect(store.list).toHaveBeenCalledWith({ from: new Date('2026-11-15T02:00:00Z'), now: expect.any(Date) })
  })
})

describe('GET /calendar.ics', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is an iCalendar feed, which can be kept for 5 minutes, of the events since a year before the request', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-19T15:30:00Z') })
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/calendar.ics' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/calendar; charset=utf-8')
    expect(response.headers['cache-control']).toBe('public, max-age=300')
    expect(response.body).toMatch(/^BEGIN:VCALENDAR\r\n[^]*END:VCALENDAR\r\n$/)
    expect(store.feed).toHaveBeenCalledWith({ since: new Date('2025-11-19T15:30:00Z'), now: new Date('2026-11-19T15:30:00Z') })
  })

  it('answers HEAD, without a body', async () => {
    const app = await buildApp()
    const response = await app.inject({ method: 'HEAD', url: '/calendar.ics' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/calendar; charset=utf-8')
    expect(response.body).toBe('')
  })
})
