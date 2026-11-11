import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance, RouteOptions } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { z } from 'zod'
import { requireAuth } from '../admins/auth.js'
import { acceptSessions } from '../admins/test-sessions.js'
import { inQuebecTime, instantIn } from './formats.js'
import { ApiError, Day, Ok, Timestamp, changesTo, firstIssue, useZodSchemas, zodRoutes } from './schemas.js'

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
      api.get('/api/admin/thing', { config: { admin: true, tool: null }, schema: { response: { 200: Ok } } }, handler)
      api.put(
        '/api/admin/thing/:id',
        { config: { admin: true, tool: null }, schema: { body: z.object({ on: z.boolean() }), response: { 200: Ok, 404: ApiError } } },
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
      api.get('/api/admin/thing', { config: { admin: true, tool: null }, schema: { response: { 200: Ok } } }, handler)
      api.put('/api/admin/thing', { config: { admin: true, tool: null }, schema: { body: z.object({ on: z.boolean() }), response: { 200: Ok } } }, handler)
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
        (app) => zodRoutes(app).route({ method: ['GET', 'PUT'], url: '/api/admin/thing', config: { admin: true, tool: null }, schema: {}, handler }),
      ],
      // Without zodRoutes, nothing would check the session.
      ['only works for the routes of zodRoutes', (app) => app.get('/', { config: { admin: true, tool: null } }, handler)],
      // The client takes a 401 from a route under /api/admin/ to mean that the session ended.
      ['admin routes are those under /api/admin/', (app) => app.get('/api/admin/thing', handler)],
      ['admin routes are those under /api/admin/', (app) => zodRoutes(app).get('/api/admin/thing', { schema: {} }, handler)],
      [
        'admin routes are those under /api/admin/',
        (app) => zodRoutes(app).get('/api/thing', { config: { admin: true, tool: null }, schema: {} }, handler),
      ],
      // So that no admin route becomes a tool of the MCP server, or misses being one, without saying so.
      ["admin routes say whether they're tools", (app) => zodRoutes(app).get('/api/admin/thing', { config: { admin: true }, schema: {} }, handler)],
      [
        "a tool's `operationId` is its name",
        (app) => zodRoutes(app).get('/api/admin/thing', { config: { admin: true, tool: { title: 'Voir' } }, schema: {} }, handler),
      ],
      [
        "a tool's `operationId` is its name",
        (app) =>
          zodRoutes(app).get('/api/admin/thing', { config: { admin: true, tool: { title: 'Voir' } }, schema: { operationId: 'getThing' } }, handler),
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

  it('sends every timestamp of a response in Québec time, errors included', async () => {
    const Times = z.object({ at: Timestamp, maybe: Timestamp.nullable(), list: z.array(z.object({ at: Timestamp })) })
    const { app } = await buildApp((app) => {
      zodRoutes(app).get<{ Querystring: { failing?: string } }>(
        '/times',
        { schema: { response: { 200: Times, 409: ApiError.extend({ times: Times }) } } },
        async (request, reply) => {
          const times = { at: '2026-11-15T02:00:00.000Z', maybe: null, list: [{ at: '2026-07-01T12:00:00-04:00' }, { at: '2026-11-01T06:30:00.999Z' }] }
          if (request.query.failing) return reply.status(409).send({ ok: false, error: 'In the way', times })
          return times
        },
      )
    })
    const times = { at: '2026-11-14T21:00:00-05:00', maybe: null, list: [{ at: '2026-07-01T12:00:00-04:00' }, { at: '2026-11-01T01:30:00-05:00' }] }
    expect((await app.inject({ method: 'GET', url: '/times' })).json()).toEqual(times)
    expect((await app.inject({ method: 'GET', url: '/times?failing=1' })).json()).toEqual({ ok: false, error: 'In the way', times })
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

describe('the NUL character', () => {
  // A route that echoes what it was sent, once it's validated.
  async function echo(formatter?: typeof firstIssue) {
    const { app } = await buildApp((app) => {
      if (formatter) app.setSchemaErrorFormatter(formatter)
      zodRoutes(app).post(
        '/echo/:id',
        {
          schema: {
            params: z.object({ id: z.string() }),
            querystring: z.object({ q: z.string().optional() }),
            body: z.object({ count: z.number().optional(), tags: z.array(z.string()).optional(), links: z.record(z.string(), z.string()).optional() }),
            response: { 200: z.object({ ok: z.literal(true), body: z.unknown() }) },
          },
        },
        async (request) => ({ ok: true as const, body: request.body }),
      )
    })
    return async (url: string, payload: object) => {
      const response = await app.inject({ method: 'POST', url, payload })
      return { status: response.statusCode, body: response.json() }
    }
  }

  it('is refused wherever the request sends it, without quoting the key that has it', async () => {
    const send = await echo()
    const refused = (where: string) => ({ status: 400, body: { ok: false, error: `${where}: Text can't contain the NUL character` } })
    expect(await send('/echo/1', { tags: ['a', 'b\0'] })).toEqual(refused('`tags.1`'))
    expect(await send('/echo/1', { links: { 'a\0': 'b' } })).toEqual(refused('`links`'))
    expect(await send('/echo/a%00b', {})).toEqual(refused('`id`'))
    expect(await send('/echo/1?q=%00', {})).toEqual(refused('`q`'))
  })

  it("is only refused in what the schema keeps, and not when it's only written as an escape", async () => {
    const send = await echo()
    expect(await send('/echo/1?other=%00', { other: '\0', tags: ['\\u0000'] })).toEqual({ status: 200, body: { ok: true, body: { tags: ['\\u0000'] } } })
  })

  it("comes after the schema's own errors, in the format of the route's errors", async () => {
    const send = await echo()
    expect((await send('/echo/1', { count: 'x', tags: ['\0'] })).body.error).toMatch(/^`count`: /)
    const sendFirstIssue = await echo(firstIssue)
    expect((await sendFirstIssue('/echo/1', { tags: ['\0'] })).body.error).toBe("Text can't contain the NUL character")
  })
})

describe('inQuebecTime', () => {
  it('gives the same instant in Québec time, to the second, with its offset, on either side of a change of time', () => {
    expect(inQuebecTime('2026-11-15T02:00:00.000Z')).toBe('2026-11-14T21:00:00-05:00')
    expect(inQuebecTime(new Date('2026-07-01T16:00:00.999Z'))).toBe('2026-07-01T12:00:00-04:00')
    expect(inQuebecTime('2026-07-01T09:00:59+02:00')).toBe('2026-07-01T03:00:59-04:00')
    // The night the clocks go back, 1:30 happens twice.
    expect(inQuebecTime('2026-11-01T05:30:00.000Z')).toBe('2026-11-01T01:30:00-04:00')
    expect(inQuebecTime('2026-11-01T06:30:00.000Z')).toBe('2026-11-01T01:30:00-05:00')
    // The night they spring forward, 2:00 doesn't happen.
    expect(inQuebecTime('2026-03-08T06:59:59.999Z')).toBe('2026-03-08T01:59:59-05:00')
    expect(inQuebecTime('2026-03-08T07:00:00.000Z')).toBe('2026-03-08T03:00:00-04:00')
  })

  it('writes the years from 2000 to 2999, in UTC, with 4 digits', () => {
    expect(inQuebecTime('2000-01-01T00:00:00.000Z')).toBe('1999-12-31T19:00:00-05:00')
    expect(inQuebecTime('2999-12-31T23:59:59.999Z')).toBe('2999-12-31T18:59:59-05:00')
  })
})

describe('instantIn', () => {
  const at = (zone: string, local: string) => instantIn(zone, local).toISOString()

  it('gives the instant it is a local date and time in a time zone', () => {
    expect(at('America/Toronto', '2026-11-14T21:00')).toBe('2026-11-15T02:00:00.000Z')
    expect(at('America/Toronto', '2026-07-01T12:00')).toBe('2026-07-01T16:00:00.000Z')
    expect(at('Europe/Paris', '2026-09-25T18:00')).toBe('2026-09-25T16:00:00.000Z')
    expect(at('Asia/Kolkata', '2026-09-25T18:00')).toBe('2026-09-25T12:30:00.000Z')
    expect(at('UTC', '2026-09-25T18:00')).toBe('2026-09-25T18:00:00.000Z')
  })

  it('takes the first of the two instants of a time the clocks show twice', () => {
    expect(at('America/Toronto', '2026-11-01T01:30')).toBe('2026-11-01T05:30:00.000Z')
    expect(at('Europe/Paris', '2026-10-25T02:30')).toBe('2026-10-25T00:30:00.000Z')
    // Lord Howe Island's clocks go back half an hour.
    expect(at('Australia/Lord_Howe', '2027-04-04T01:45')).toBe('2027-04-03T14:45:00.000Z')
    expect(at('Australia/Lord_Howe', '2027-04-04T02:15')).toBe('2027-04-03T15:45:00.000Z')
  })

  it('moves a time the clocks skip forward by as much as they skip', () => {
    expect(at('America/Toronto', '2027-03-14T02:30')).toBe('2027-03-14T07:30:00.000Z')
    expect(at('Europe/Paris', '2027-03-28T02:30')).toBe('2027-03-28T01:30:00.000Z')
    expect(at('Australia/Lord_Howe', '2026-10-04T02:15')).toBe('2026-10-03T15:45:00.000Z')
  })

  it("reads the time in Québec's time zone when Intl doesn't know the one it's given", () => {
    expect(at('Mars/Olympus_Mons', '2026-09-25T18:00')).toBe('2026-09-25T22:00:00.000Z')
    expect(at('', '2026-09-25T18:00')).toBe('2026-09-25T22:00:00.000Z')
  })
})

describe('changesTo', () => {
  const Changes = changesTo({ name: z.string().min(1, 'A name'), size: z.number().nullable(), tags: z.array(z.string()) })
  const error = (sent: unknown) => Changes.safeParse(sent).error?.issues[0].message

  it('takes any of the fields, each with its rules, and leaves out those it is not sent', () => {
    expect(Changes.parse({ size: null })).toEqual({ size: null })
    expect(Changes.parse({ name: 'x', tags: [] })).toEqual({ name: 'x', tags: [] })
    expect(error({ name: '' })).toBe('A name')
  })

  it('refuses no field, fields it does not take, which it names, and what is not an object', () => {
    expect(error({})).toBe('There must be at least one field to change')
    expect(error({ name: 'x', nmae: 'y' })).toBe('Unknown field: `nmae`')
    expect(error({ a: 1, b: 2 })).toBe('Unknown fields: `a`, `b`')
    for (const sent of [null, [], 'name', undefined]) expect(error(sent)).toBe('The changes must be an object with the fields to change')
  })
})
