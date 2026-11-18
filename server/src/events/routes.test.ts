import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { useZodSchemas } from '../api/schemas.js'
import type { Photos } from '../artists/store.js'
import { eventsRoutes } from './routes.js'
import type { EventsStore } from './store.js'

// The public events' routes, without a database: only what's refused before the store is asked. What they give is
// tested against a real database (see public.db.test.ts).

const store: EventsStore = {
  list: vi.fn<EventsStore['list']>(async () => ({ upcoming: [], past: [] })),
  getFlyer: async () => null,
}

async function buildApp() {
  const app = Fastify({ logger: false })
  useZodSchemas(app)
  await app.register(eventsRoutes, { store, photos: {} as Photos })
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
