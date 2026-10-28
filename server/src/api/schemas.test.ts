import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance, RouteOptions } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { z } from 'zod'
import { requireAuth } from '../admins/auth.js'
import { acceptSessions } from '../admins/test-sessions.js'
import { ApiError, Day, Ok, Timestamp, useZodSchemas, zodRoutes } from './schemas.js'

const handler = async () => ({ ok: true as const })

// An app set up like the server's, whose routes `routes` adds in a plugin of its own, with the routes as they end up, by
// URL.
async function buildApp(routes: (app: FastifyInstance) => void) {
  const app = Fastify()
  useZodSchemas(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  const added = new Map<string, RouteOptions>()
  app.addHook('onRoute', (route) => {
    if (route.method !== 'HEAD') added.set(route.url, route)
  })
  await app.register(async (plugin) => routes(plugin))
  await app.ready()
  return { app, statuses: (url: string) => Object.keys(added.get(url)!.schema!.response as object) }
}

describe('zodRoutes', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
  })

  afterEach(() => {
    delete process.env.JWT_SECRET
  })

  it("adds the errors that routes can fail with because of what they are to the routes' responses", async () => {
    const { statuses } = await buildApp((app) => {
      const api = zodRoutes(app)
      api.get('/public', { schema: { response: { 200: Ok } } }, handler)
      api.get('/public/:id', { schema: { params: z.object({ id: z.string() }), response: { 200: Ok } } }, handler)
      api.get('/api/admin/thing', { config: { admin: true }, schema: { response: { 200: Ok } } }, handler)
      api.put(
        '/api/admin/thing/:id',
        { config: { admin: true }, schema: { body: z.object({ on: z.boolean() }), response: { 200: Ok, 404: ApiError } } },
        handler,
      )
    })

    expect(statuses('/public')).toEqual(['200', '500'])
    expect(statuses('/public/:id')).toEqual(['200', '400', '500'])
    // Admin GETs can't fail with 403 (see requireAuth).
    expect(statuses('/api/admin/thing')).toEqual(['200', '401', '500'])
    expect(statuses('/api/admin/thing/:id')).toEqual(['200', '400', '401', '403', '404', '500'])
  })

  it('checks the session of admin routes before anything else, for HEAD too', async () => {
    const { app } = await buildApp((app) => {
      const api = zodRoutes(app)
      api.get('/api/admin/thing', { config: { admin: true }, schema: { response: { 200: Ok } } }, handler)
      api.put('/api/admin/thing', { config: { admin: true }, schema: { body: z.object({ on: z.boolean() }), response: { 200: Ok } } }, handler)
    })
    for (const request of [{ method: 'GET' }, { method: 'HEAD' }, { method: 'PUT', payload: { on: 'yes' } }] as const) {
      expect((await app.inject({ url: '/api/admin/thing', ...request })).statusCode).toBe(401)
    }
  })

  it('refuses routes that would leave their errors out of their responses', async () => {
    const refused: [string, (app: FastifyInstance) => void][] = [
      ['rather than using requireAuth', (app) => zodRoutes(app).get('/', { preHandler: requireAuth, schema: {} }, handler)],
      ['need a schema', (app) => zodRoutes(app).get('/', handler)],
      [
        'one route per method',
        (app) => zodRoutes(app).route({ method: ['GET', 'PUT'], url: '/api/admin/thing', config: { admin: true }, schema: {}, handler }),
      ],
      // Without zodRoutes, nothing would check the session.
      ['only works for the routes of zodRoutes', (app) => app.get('/', { config: { admin: true } }, handler)],
      // The client takes a 401 from a route under /api/admin/ to mean that the session ended.
      ['admin routes are those under /api/admin/', (app) => app.get('/api/admin/thing', handler)],
      ['admin routes are those under /api/admin/', (app) => zodRoutes(app).get('/api/admin/thing', { schema: {} }, handler)],
      [
        'admin routes are those under /api/admin/',
        (app) => zodRoutes(app).get('/api/thing', { config: { admin: true }, schema: {} }, handler),
      ],
    ]
    for (const [error, routes] of refused) {
      await expect(buildApp(routes)).rejects.toThrow(error)
    }
  })

  it('only sends timestamps that are ISO 8601 dates and times', async () => {
    let at = ''
    const { app } = await buildApp((app) => {
      zodRoutes(app).get('/at', { schema: { response: { 200: z.object({ at: Timestamp }) } } }, async () => ({ at }))
    })
    const statuses: Record<string, number> = {}
    for (at of ['2026-10-09T16:30:00.000Z', '2026-10-09T12:30:00-04:00', 'yesterday', '2026-10-09']) {
      statuses[at] = (await app.inject({ method: 'GET', url: '/at' })).statusCode
    }
    expect(statuses).toEqual({ '2026-10-09T16:30:00.000Z': 200, '2026-10-09T12:30:00-04:00': 200, yesterday: 500, '2026-10-09': 500 })
  })

  it('only sends days that exist', async () => {
    let day = ''
    const { app } = await buildApp((app) => {
      zodRoutes(app).get('/day', { schema: { response: { 200: z.object({ day: Day }) } } }, async () => ({ day }))
    })
    const statuses: Record<string, number> = {}
    for (day of ['2026-10-09', '2028-02-29', '2026-02-29', '2026-13-45', '2026-10-09T16:30:00.000Z']) {
      statuses[day] = (await app.inject({ method: 'GET', url: '/day' })).statusCode
    }
    expect(statuses).toEqual({ '2026-10-09': 200, '2028-02-29': 200, '2026-02-29': 500, '2026-13-45': 500, '2026-10-09T16:30:00.000Z': 500 })
  })
})
