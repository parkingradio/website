import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { ApiError, ById, Timestamp, zodRoutes, useZodSchemas } from '../api/schemas.js'
import { readProfileForm } from '../artists/photo-form.js'
import { createLogger } from '../core/logger.js'
import { TEST_ADMIN, acceptSessions, sessionCookies } from '../admins/test-sessions.js'
import type { AccessGrant, OAuthStore } from '../oauth/store.js'
import { DOCUMENTS, INSTRUCTIONS, instructions, rules } from './documentation.js'
import { mcpRoutes } from './routes.js'
import { collectToolRoutes, readFirst } from './tools.js'

// The MCP server, with routes of its own as tools, which say how they were called. Those of the API are checked against
// the design by tools.test.ts, and end to end by integration-tests/023-mcp.sh.

const ISSUER = 'https://parking.radio'
const USER = TEST_ADMIN
let grant: AccessGrant | null
const store = { findAccessToken: vi.fn<OAuthStore['findAccessToken']>(async () => grant) }

// The profile of the tests' multipart route, like an artist's.
const Profile = z.object({ name: z.string(), email: z.string().nullable(), phone: z.string() })
let saved: z.infer<typeof Profile>

async function buildApp(logs?: string[], environment = 'test') {
  // With the server's logger, which leaves the values of query strings out, e.g. tools' arguments. As a FastifyBaseLogger,
  // like the server's (see index.ts).
  const loggerInstance: FastifyBaseLogger | undefined = logs && createLogger({ write: (line: string) => logs.push(line) })
  const app = Fastify({ loggerInstance })
  useZodSchemas(app)
  const routes = collectToolRoutes(app)
  await app.register(fastifyCookie)
  acceptSessions(app)
  await app.register(async (app: FastifyInstance) => {
    const api = zodRoutes(app)
    await app.register(multipart)
    api.get(
      '/api/admin/things/:id',
      {
        config: { admin: true, tool: { title: 'Voir une chose' } },
        schema: { operationId: 'get_thing', summary: 'A thing', params: ById, querystring: z.object({ also: z.string().optional() }) },
      },
      async (request, reply) => {
        if (request.params.id === 'missing') return reply.status(404).send({ ok: false, error: 'No such thing' })
        return { ok: true, id: request.params.id, also: request.query.also ?? null, by: request.user!.email, text: 'a b' }
      },
    )
    // Routes the router prefers to the tools' when a parameter is their segment.
    for (const method of ['GET', 'PUT'] as const) {
      api.route({ method, url: '/api/admin/things/special', config: { admin: true, tool: null }, schema: {}, handler: async () => ({ ok: true, special: true }) })
    }
    api.put(
      '/api/admin/things/:id',
      {
        config: { admin: true, tool: { title: 'Modifier une chose' } },
        schema: { operationId: 'update_thing', summary: 'Changes a thing', params: ById, body: z.object({ size: z.number() }), response: { 200: z.object({ ok: z.literal(true), size: z.number() }), 409: ApiError.extend({ other: z.string() }) } },
      },
      async (request, reply) => {
        if (request.body.size > 10) return reply.status(409).send({ ok: false, error: 'Too big', other: 'it' })
        return { ok: true as const, size: request.body.size }
      },
    )
    // Like an artist, whose emails and phone numbers tools don't give.
    for (const method of ['GET', 'PUT'] as const) {
      api.route({
        method,
        url: '/api/admin/artists/:id',
        config: { admin: true, tool: { title: method === 'GET' ? 'Voir un artiste' : 'Modifier un artiste' } },
        schema: {
          operationId: method === 'GET' ? 'get_artist' : 'update_artist',
          summary: method === 'GET' ? 'An artist' : "Changes an artist's profile",
          params: ById,
          ...(method === 'PUT' && { multipart: z.object({ artist: Profile, removePhoto: z.string().optional() }) }),
        },
        handler: async (request, reply) => {
          if (method === 'PUT') {
            const sent = await readProfileForm(request, 'artist', Profile)
            if ('status' in sent) return reply.status(sent.status).send({ ok: false, error: sent.error })
            saved = sent.profile
            return { ok: true, artist: { id: 'a', ...saved, removedPhoto: sent.removePhoto } }
          }
          return { ok: true, artist: { id: 'a', ...saved } }
        },
      })
    }
    // Its dates and times, which tools give as the route does, in Québec time, and a body with a field that can be null.
    const Times = z.object({ at: Timestamp, maybe: Timestamp.nullable(), list: z.array(z.object({ at: Timestamp, note: z.string() })) })
    api.post(
      '/api/admin/times',
      {
        config: { admin: true, tool: { title: 'Ajouter des heures' } },
        schema: {
          operationId: 'create_times',
          summary: 'Times',
          body: z.object({ name: z.string(), note: z.string().nullable() }),
          response: { 200: Times, 409: ApiError.extend({ times: Times }) },
        },
      },
      async (request, reply) => {
        const times = {
          at: '2026-11-01T05:30:00.000Z',
          maybe: request.body.note === null ? null : '2026-11-01T06:30:00.000Z',
          list: [{ at: '2026-07-01T16:00:00.000Z', note: '2026-07-01T16:00:00.000Z' }],
        }
        if (request.body.name === 'conflict') return reply.status(409).send({ ok: false, error: 'In the way', times })
        return times
      },
    )
    api.get(
      '/api/admin/artists',
      { config: { admin: true, tool: { title: 'Lister les artistes' } }, schema: { operationId: 'list_artists', summary: 'Every artist' } },
      async () => ({ ok: true, total: 1, artists: [{ id: 'a', name: 'Aurore', bio: 'Long', email: 'a@example.com', phone: '555', genres: [], collectives: [] }] }),
    )
  })
  await app.register(mcpRoutes, { store: store as unknown as OAuthStore, issuer: ISSUER, routes, environment })
  return app
}

type App = Awaited<ReturnType<typeof buildApp>>

// The line logged once the last request to /mcp was answered, with its status, rather than those of the requests its tools
// sent their routes.
function completed(logs: string[]) {
  const lines = logs.map((line) => JSON.parse(line))
  const { reqId } = lines.findLast((line) => line.msg === 'incoming request' && line.req.url === '/mcp')
  return lines.find((line) => line.reqId === reqId && line.msg === 'request completed')
}

const HEADERS = { authorization: 'Bearer the-token', accept: 'application/json, text/event-stream', 'content-type': 'application/json' }

function post(app: App, body: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url: '/mcp', headers: { ...HEADERS, 'mcp-protocol-version': '2025-11-25', ...headers }, payload: JSON.stringify(body) })
}

async function call(app: App, name: string, args: object = {}) {
  const response = await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  expect(response.statusCode).toBe(200)
  const { result } = response.json()
  return { ...result, body: JSON.parse(result.content[0].text) }
}

describe('the MCP server', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    grant = { connectionId: 'connection-id', clientId: 'https://claude.ai/oauth/claude-code-client-metadata', scopes: ['admin'], user: USER }
    saved = { name: 'Aurore', email: 'aurore@example.com', phone: '555 0100' }
  })

  afterEach(() => {
    delete process.env.JWT_SECRET
    vi.clearAllMocks()
  })

  describe('authorization', () => {
    it("needs an access token, and says where to get one, as JSON-RPC's errors", async () => {
      const app = await buildApp()
      const response = await app.inject({ method: 'POST', url: '/mcp', headers: { ...HEADERS, authorization: '' }, payload: '{}' })
      expect(response.statusCode).toBe(401)
      expect(response.headers['www-authenticate']).toBe(`Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp", scope="admin"`)
      expect(response.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'An access token is required' } })
    })

    it('says when the token is invalid or has expired', async () => {
      grant = null
      const app = await buildApp()
      const response = await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
      expect(response.statusCode).toBe(401)
      expect(response.headers['www-authenticate']).toContain(', error="invalid_token"')
      expect(store.findAccessToken).toHaveBeenCalledWith('the-token')
    })

    it("refuses requests from another site's pages", async () => {
      const app = await buildApp()
      expect((await post(app, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://example.com' })).statusCode).toBe(403)
      expect((await post(app, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: ISSUER })).statusCode).toBe(200)
    })

    it("asks the app to have the user allow a scope the connection doesn't have", async () => {
      grant = { ...grant!, scopes: [] }
      const app = await buildApp()
      const response = await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_thing', arguments: { id: 'x' } } })
      expect(response.statusCode).toBe(403)
      expect(response.headers['www-authenticate']).toMatch(/^Bearer error="insufficient_scope", .*scope="admin"/)
      expect(response.headers['www-authenticate']).toContain(`resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"`)
    })
  })

  describe('the transport', () => {
    it('answers with JSON in the latest 2025 version, even to an app that asks for an older one', async () => {
      const app = await buildApp()
      for (const asked of ['2025-06-18', '2024-11-05']) {
        const response = await post(
          app,
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: asked, capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
          { 'mcp-protocol-version': '' },
        )
        expect(response.statusCode).toBe(200)
        expect(response.headers['content-type']).toMatch(/^application\/json/)
        expect(response.headers).not.toHaveProperty('mcp-session-id')
        const { result } = response.json()
        expect(result.protocolVersion).toBe(asked === '2025-06-18' ? '2025-06-18' : '2025-11-25')
        expect(result.serverInfo.name).toBe('Parking Radio (test)')
        expect(result.instructions).toBe(
          `This is Parking Radio's test environment, not the production site: its data is for testing. ${INSTRUCTIONS}`,
        )
      }
    })

    it("refuses the versions it doesn't answer in", async () => {
      const app = await buildApp()
      for (const version of ['2024-11-05', '2026-07-28']) {
        expect((await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-protocol-version': version })).statusCode).toBe(400)
      }
    })

    it('answers a notification with 202', async () => {
      const app = await buildApp()
      const response = await post(app, { jsonrpc: '2.0', method: 'notifications/initialized' })
      expect(response.statusCode).toBe(202)
      expect(response.body).toBe('')
    })

    it("refuses batches, bodies that aren't JSON, and other methods than POST", async () => {
      const app = await buildApp()
      const batch = await post(app, [{ jsonrpc: '2.0', id: 1, method: 'ping' }])
      expect(batch.statusCode).toBe(400)
      expect(batch.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batches are not supported' } })
      const notJson = await app.inject({ method: 'POST', url: '/mcp', headers: HEADERS, payload: '{' })
      expect(notJson.statusCode).toBe(400)
      expect(notJson.json().error.code).toBe(-32700)
      const text = await app.inject({ method: 'POST', url: '/mcp', headers: { ...HEADERS, 'content-type': 'text/plain' }, payload: 'ping' })
      expect(text.statusCode).toBe(415)
      expect(text.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32600 } })
      for (const method of ['GET', 'DELETE'] as const) {
        const response = await app.inject({ method, url: '/mcp', headers: HEADERS })
        expect(response.statusCode).toBe(405)
        expect(response.headers.allow).toBe('POST')
      }
    })

    it('leaves it to the app to accept JSON, as MCP has it', async () => {
      const app = await buildApp()
      const response = await post(app, { jsonrpc: '2.0', id: 1, method: 'ping' }, { accept: 'application/json' })
      expect(response.statusCode).toBe(406)
    })
  })

  describe('logs', () => {
    it('say what a request calls, and for which connection and user, but not its arguments', async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      await call(app, 'get_thing', { id: 'x', also: 'an-argument' })
      expect(completed(logs)).toMatchObject({
        res: { statusCode: 200 },
        mcp: { method: 'tools/call', tool: 'get_thing' },
        connection: 'connection-id',
        user: USER.id,
      })
      expect(completed(logs)).not.toHaveProperty('error')
      // Even one that its route refuses.
      await call(app, 'update_thing', { id: 'x', size: 'another-argument' })
      expect(completed(logs)).toMatchObject({ toolStatus: 400, error: expect.stringContaining('`size`') })
      expect(logs.join('\n')).not.toMatch(/an-argument|another-argument/)
      await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
      expect(completed(logs).mcp).toEqual({ method: 'tools/list' })
    })

    it('only keep enough of the names an app sends, and of the errors that repeat them', async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      const long = 'x'.repeat(1000)
      await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: long, arguments: {} } })
      expect(completed(logs).mcp.tool).toBe('x'.repeat(200))
      expect(completed(logs).error).toHaveLength(200)
      await post(app, { jsonrpc: '2.0', id: 1, method: long })
      expect(completed(logs).mcp.method).toBe('x'.repeat(200))
    })

    it("say why a tool failed: its status, and its error's message, without its other fields", async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      await call(app, 'get_thing', { id: 'missing' })
      expect(completed(logs)).toMatchObject({ mcp: { tool: 'get_thing' }, toolStatus: 404, error: 'No such thing' })
      await call(app, 'update_thing', { id: 'x', size: 11 })
      expect(completed(logs)).toMatchObject({ toolStatus: 409, error: 'Too big' })
      expect(logs.join('\n')).not.toContain('"other"')
      // Refused before the route.
      await call(app, 'get_thing', { id: 'x', nope: true })
      expect(completed(logs)).toMatchObject({ toolStatus: 400, error: "`nope` isn't an argument of this tool" })
      await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_documentation', arguments: { area: 'nowhere' } } })
      expect(completed(logs)).toMatchObject({ mcp: { tool: 'read_documentation' }, error: expect.stringMatching(/^`area` has to be one of /) })
      expect(completed(logs)).not.toHaveProperty('toolStatus')
    })

    it('log what a tool throws as an unexpected error, which the tool only says happened', async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      // Which signing the session of the tool's request needs.
      delete process.env.JWT_SECRET
      const { body, isError } = await call(app, 'get_thing', { id: 'x' })
      expect(isError).toBe(true)
      expect(body).toEqual({ status: 500, error: 'Internal server error' })
      const failed = logs.map((line) => JSON.parse(line)).find((line) => line.msg === 'Failed to call the tool get_thing')
      expect(failed).toMatchObject({ level: 50, err: { message: 'Missing required environment variable: JWT_SECRET' } })
      expect(completed(logs)).toMatchObject({ toolStatus: 500 })
      expect(completed(logs)).not.toHaveProperty('error')
    })

    it('say why a request failed when the answer is an error, whatever its status', async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-protocol-version': '2026-07-28' })
      expect(completed(logs)).toMatchObject({
        res: { statusCode: 400 },
        mcp: { method: 'tools/list' },
        connection: 'connection-id',
        error: 'Bad Request: Unsupported protocol version: 2026-07-28 (supported versions: 2025-11-25, 2025-06-18, 2025-03-26)',
      })
      await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope', arguments: {} } })
      expect(completed(logs)).toMatchObject({ res: { statusCode: 200 }, mcp: { tool: 'nope' }, error: expect.stringContaining('Tool nope not found') })
      await post(app, { jsonrpc: '2.0', id: 1, method: 'nowhere' })
      expect(completed(logs)).toMatchObject({ res: { statusCode: 200 }, mcp: { method: 'nowhere' }, error: expect.stringContaining('Method not found') })
      await app.inject({ method: 'POST', url: '/mcp', headers: HEADERS, payload: '{' })
      expect(completed(logs)).toMatchObject({ res: { statusCode: 400 }, connection: 'connection-id', error: 'The body is not valid JSON' })
      expect(completed(logs)).not.toHaveProperty('mcp')
      await app.inject({ method: 'POST', url: '/mcp', headers: { ...HEADERS, authorization: '' }, payload: '{}' })
      expect(completed(logs)).toMatchObject({ res: { statusCode: 401 }, error: 'An access token is required' })
      expect(completed(logs)).not.toHaveProperty('connection')
    })

    it("don't say why a request failed unexpectedly, which the error's own line says", async () => {
      const logs: string[] = []
      const app = await buildApp(logs)
      store.findAccessToken.mockRejectedValueOnce(new Error('The database is down'))
      const response = await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
      expect(response.json().error.code).toBe(-32603)
      expect(completed(logs)).toMatchObject({ res: { statusCode: 500 } })
      expect(completed(logs)).not.toHaveProperty('error')
    })
  })

  describe('tools', () => {
    it('are listed with their French titles and hints, and read_documentation', async () => {
      const app = await buildApp()
      const response = await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
      const tools = response.json().result.tools as { name: string; title: string; description: string; annotations: object; inputSchema: object }[]
      expect(tools.map(({ name }) => name)).toEqual(['get_thing', 'update_thing', 'get_artist', 'update_artist', 'create_times', 'list_artists', 'read_documentation'])
      const get = tools.find(({ name }) => name === 'get_thing')!
      // A route that isn't in an area's document points to read_documentation all the same. No real tool is like that:
      // tools.test.ts checks that each one is in an area.
      expect(get).toMatchObject({ title: 'Voir une chose', description: `${readFirst(undefined)} A thing.`, annotations: { title: 'Voir une chose', readOnlyHint: true, openWorldHint: false } })
      expect(get.inputSchema).toEqual({
        type: 'object',
        properties: { id: { type: 'string', description: "The thing's id" }, also: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      })
      const update = tools.find(({ name }) => name === 'update_thing')!
      expect(update.annotations).toEqual({ title: 'Modifier une chose', destructiveHint: true, openWorldHint: false })
      expect(update.description).toBe(
        `${readFirst(undefined)} Changes a thing. It replaces it: what's left out is erased, except what it says it keeps, so read it first.`,
      )
      expect(tools.find(({ name }) => name === 'get_artist')!.description.startsWith(`${readFirst('artists')} An artist.`)).toBe(true)
    })

    it("send their routes the request their arguments make, as the connection's user, and give back the answer", async () => {
      const app = await buildApp()
      // A query argument arrives as it was given, e.g. with the `+` of an offset, which a query string has to encode.
      const { body, isError } = await call(app, 'get_thing', { id: 'x', also: 'T21:00+01:00 & more' })
      expect(isError).toBeUndefined()
      expect(body).toEqual({ ok: true, id: 'x', also: 'T21:00+01:00 & more', by: USER.email, text: 'a b' })
    })

    it('give JSON without spaces, and escape the line and paragraph separators', async () => {
      const app = await buildApp()
      const response = await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_thing', arguments: { id: 'x' } } })
      const { text } = response.json().result.content[0]
      expect(text).toBe(`{"ok":true,"id":"x","also":null,"by":"${USER.email}","text":"a\\u2028b"}`)
    })

    it("say when their route fails, with all of its error, which the route checks rather than the tool", async () => {
      const app = await buildApp()
      expect(await call(app, 'get_thing', { id: 'missing' })).toMatchObject({ isError: true, body: { status: 404, ok: false, error: 'No such thing' } })
      expect(await call(app, 'update_thing', { id: 'x', size: 11 })).toMatchObject({ isError: true, body: { status: 409, error: 'Too big', other: 'it' } })
      expect(await call(app, 'update_thing', { id: 'x', size: 'big' })).toMatchObject({ isError: true, body: { status: 400 } })
      expect(await call(app, 'update_thing', { id: 'x', size: 2 })).toMatchObject({ body: { ok: true, size: 2 } })
    })

    it("can't lead to another route through a path parameter", async () => {
      const app = await buildApp()
      for (const id of ['', '.', '..', 42, '\ud800']) {
        expect(await call(app, 'get_thing', { id }), String(id)).toMatchObject({ isError: true, body: { status: 400, error: "`id` isn't valid" } })
      }
      // Encoded, they stay one segment, which the route gets as it was sent.
      for (const id of ['../admins/x', '%2e%2e', 'a/b', 'a?b#c']) {
        expect(await call(app, 'get_thing', { id }), id).toMatchObject({ body: { ok: true, id } })
      }
      // Nor through one that's another route's segment.
      for (const [name, args] of [
        ['get_thing', { id: 'special' }],
        ['update_thing', { id: 'special', size: 1 }],
      ] as const) {
        expect(await call(app, name, args), name).toMatchObject({ isError: true, body: { status: 400, error: 'The `id` given leads to another endpoint' } })
      }
    })

    it("refuse the arguments they don't take, so that a misspelled field doesn't erase the real one", async () => {
      const app = await buildApp()
      expect(await call(app, 'update_thing', { id: 'x', sise: 2 })).toMatchObject({ isError: true, body: { status: 400, error: "`sise` isn't an argument of this tool" } })
    })

    it("act as the connected admin, whatever else the request to the MCP server sends", async () => {
      const app = await buildApp()
      const other = await sessionCookies({ id: 'other-id', email: 'other@example.com', sessionVersion: 0 })
      const cookie = Object.entries(other).map(([name, value]) => `${name}=${value}`).join('; ')
      const response = await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_thing', arguments: { id: 'x' } } }, { cookie })
      expect(JSON.parse(response.json().result.content[0].text).by).toBe(USER.email)
    })

    it('never give the emails and phone numbers of artists, and keep those a profile that replaces theirs leaves out', async () => {
      const app = await buildApp()
      expect((await call(app, 'get_artist', { id: 'a' })).body).toEqual({ ok: true, artist: { id: 'a', name: 'Aurore' } })
      expect((await call(app, 'update_artist', { id: 'a', name: 'Aurore B.' })).body).toEqual({ ok: true, artist: { id: 'a', name: 'Aurore B.', removedPhoto: false } })
      expect(saved).toEqual({ name: 'Aurore B.', email: 'aurore@example.com', phone: '555 0100' })
      await call(app, 'update_artist', { id: 'a', name: 'Aurore', email: null, phone: '', removePhoto: true })
      expect(saved).toEqual({ name: 'Aurore', email: null, phone: '' })
    })

    it('give the dates and times of their responses as their routes do, in Québec time, errors included', async () => {
      const app = await buildApp()
      const times = {
        at: '2026-11-01T01:30:00-04:00',
        maybe: '2026-11-01T01:30:00-05:00',
        list: [{ at: '2026-07-01T12:00:00-04:00', note: '2026-07-01T16:00:00.000Z' }],
      }
      expect((await call(app, 'create_times', { name: 'x', note: 'y' })).body).toEqual(times)
      expect(await call(app, 'create_times', { name: 'conflict', note: 'y' })).toMatchObject({ isError: true, body: { status: 409, times } })
    })

    it('send the fields of a POST that can be null as null when they are left out', async () => {
      const app = await buildApp()
      expect((await call(app, 'create_times', { name: 'x' })).body.maybe).toBeNull()
      const response = await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
      const create = response.json().result.tools.find(({ name }: { name: string }) => name === 'create_times')
      expect(create.inputSchema.required).toEqual(['name'])
    })

    it('list a summary of each one, with the rest of the response as it is', async () => {
      const app = await buildApp()
      expect((await call(app, 'list_artists')).body).toEqual({ ok: true, total: 1, artists: [{ id: 'a', name: 'Aurore', genres: [], collectives: [] }] })
    })

    it("read the rules of an area, from the server's design documents", async () => {
      const app = await buildApp()
      const response = await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_documentation', arguments: { area: 'sessions' } } })
      const { text } = response.json().result.content[0]
      expect(text).toBe(`${instructions('test')}\n\n${rules(await readFile(path.join(DOCUMENTS, 'sessions.md'), 'utf8'))}`)
      expect(text).toMatch(/^This is Parking Radio's test environment, .*\n\n# Sessions\n/)
      expect(text).not.toContain('## `')
      const wrong = await post(app, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_documentation', arguments: { area: 'admins' } } })
      expect(wrong.json().result.isError).toBe(true)
    })
  })

  it('gives the instructions the design has, after saying which environment it is', async () => {
    const design = await readFile(path.join(DOCUMENTS, 'mcp.md'), 'utf8')
    const quoted = /\n((?:> .*\n)+)/.exec(design)![1]
    expect(INSTRUCTIONS).toBe(quoted.replace(/^> /gm, '').trim().replace(/\n/g, ' '))
    const flat = design.replace(/\s+/g, ' ')
    for (const environment of ['production', 'test']) {
      const sentence = instructions(environment).slice(0, -INSTRUCTIONS.length - 1)
      expect(flat, environment).toContain(`"${sentence}"`)
    }
    // And the sentence that starts the tools' descriptions.
    expect(flat).toContain(`"${readFirst('sessions')}"`)
  })

  it('says so in production, without naming its environment', async () => {
    const app = await buildApp(undefined, 'production')
    const response = await post(
      app,
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { 'mcp-protocol-version': '' },
    )
    const { result } = response.json()
    expect(result.serverInfo.name).toBe('Parking Radio')
    expect(result.instructions).toMatch(/^This is Parking Radio's production site: changes are real/)
  })
})
