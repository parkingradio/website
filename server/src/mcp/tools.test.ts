import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { z } from 'zod'
import { registerRoutes } from '../app.js'
import type { Dependencies } from '../app.js'
import { AREAS, loadRules, rules } from './documentation.js'
import { buildTools, collectToolRoutes, hasContactDetails } from './tools.js'

// The tools of the API's routes, against docs/design/server/mcp.md. Registering the routes only needs their
// dependencies to handle requests, which these tests don't send.

async function apiTools() {
  const app = Fastify()
  const routes = collectToolRoutes(app)
  await registerRoutes(app, {} as Dependencies)
  return { routes, tools: buildTools(routes, app) }
}

// What a JSON Schema names, as properties, anywhere in it.
function propertyNames(schema: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) schema.forEach((item) => propertyNames(item, found))
  else if (schema !== null && typeof schema === 'object') {
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'properties') Object.keys(value as object).forEach((name) => found.add(name))
      propertyNames(value, found)
    }
  }
  return found
}

describe('the tools of the API', () => {
  it('are the endpoints the design lists', async () => {
    const { tools } = await apiTools()
    expect(tools.map(({ name }) => name).sort()).toEqual(
      [
        ...['list_events', 'get_on_air', 'get_radio_playlist', 'preview_playlist', 'choose_playlist', 'get_soundcloud_app'],
        'get_youtube_credentials',
        ...['list_artists', 'get_artist', 'create_artist', 'update_artist', 'delete_artist'],
        ...['list_collectives', 'get_collective', 'create_collective', 'update_collective', 'delete_collective'],
        ...['list_applications', 'get_application', 'create_application', 'update_application', 'update_application_status'],
        ...['delete_application', 'get_application_recipients'],
        ...['list_sessions', 'get_session', 'get_session_ra_event', 'create_session', 'update_session', 'update_session_status', 'delete_session'],
        ...['create_set', 'update_set', 'update_set_status', 'delete_set'],
      ].sort(),
    )
  })

  it('only read when their endpoint does, and are destructive otherwise', async () => {
    const { tools } = await apiTools()
    const reading = tools.filter(({ readOnly }) => readOnly).map(({ name }) => name)
    expect(reading.filter((name) => !/^(list|get)_/.test(name))).toEqual(['preview_playlist'])
    expect(tools.filter(({ readOnly }) => !readOnly).every(({ name }) => !/^(list|get)_/.test(name))).toBe(true)
  })

  it('have their arguments written out, without referring to other schemas', async () => {
    const { tools } = await apiTools()
    for (const tool of tools) {
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toContain('$ref')
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(tool.description, tool.name).toMatch(/\.$/)
      // Every one of them is in an area.
      expect(tool.description, tool.name).toMatch(new RegExp(`^Once per conversation, before using it, read the rules with \`read_documentation\`, area \`(${AREAS.join('|')})\`\\. `))
    }
    const areas = Object.fromEntries(tools.map(({ name, description }) => [name, /area `(\w+)`/.exec(description)![1]]))
    expect(areas).toMatchObject({ get_on_air: 'radio', get_youtube_credentials: 'video', get_application_recipients: 'applications', update_set: 'sessions', list_events: 'events' })
    const update = tools.find(({ name }) => name === 'update_artist')!
    expect(Object.keys(update.inputSchema.properties as object)).toEqual(
      expect.arrayContaining(['id', 'name', 'country', 'genres', 'email', 'phone', 'removePhoto']),
    )
    expect(update.description).toContain("Tools can't send a photo.")
    const updateSession = tools.find(({ name }) => name === 'update_session')!
    expect(Object.keys(updateSession.inputSchema.properties as object)).toEqual(expect.arrayContaining(['id', 'name', 'description', 'removeFlyer']))
    expect(updateSession.description).toContain("Tools can't send a flyer.")
    expect(updateSession.description).not.toMatch(/email|photo/)
  })

  it("can't be led to another endpoint by an id that's another route's segment", async () => {
    const { tools } = await apiTools()
    for (const [name, args] of [
      ['get_application', { id: 'recipients' }],
      ['update_application', { id: 'recipients', recipients: [] }],
    ] as const) {
      const { result, failed } = await tools.find((tool) => tool.name === name)!.call(args, { id: 'admin-id', email: 'admin@example.com', sessionVersion: 0 })
      expect(result.isError, name).toBe(true)
      expect(failed, name).toEqual({ status: 400, error: 'The `id` given leads to another endpoint' })
      expect(JSON.parse(result.content[0].text)).toEqual({ status: 400, error: 'The `id` given leads to another endpoint' })
    }
  })

  it('refuse to start with arguments that are not an object', () => {
    const route = { method: 'GET', url: '/api/admin/things/:id', schema: { operationId: 'get_thing', params: z.union([z.object({ id: z.string() }), z.object({ name: z.string() })]) }, tool: { title: 'Voir' } }
    expect(() => buildTools([route], Fastify())).toThrow("its tool's arguments have to be an object's properties")
  })

  it("take the fields of a POST's body that can be null as optional, but every field of a PUT's", async () => {
    const { tools } = await apiTools()
    const required = (name: string) => (tools.find((tool) => tool.name === name)!.inputSchema.required as string[]).sort()
    expect(required('create_set')).toEqual(['genres', 'id', 'otherPerformanceType', 'performanceTypes', 'performers'])
    expect(required('create_session')).toEqual(['description', 'durationMinutes', 'name', 'type'])
    expect(required('update_set')).toEqual(
      ['durationMinutes', 'genres', 'id', 'offsetMinutes', 'otherPerformanceType', 'performanceTypes', 'performers', 'soundcloudTrack', 'youtubeVideo'],
    )
  })

  // So that a new endpoint can't give them without the tools leaving them out.
  it("never give emails or phone numbers, except those of artists and collectives, which they leave out", async () => {
    const { routes } = await apiTools()
    for (const route of routes.filter((route) => !hasContactDetails(route))) {
      for (const response of Object.values((route.schema.response ?? {}) as Record<string, z.ZodType>)) {
        const names = propertyNames(z.toJSONSchema(response, { io: 'output', unrepresentable: 'any' }))
        expect(names.has('email') || names.has('phone'), `${route.method} ${route.url}`).toBe(false)
      }
    }
  })
})

describe('rules', () => {
  it("only keep the text of the links the model can't follow, and point those to other areas to read_documentation", () => {
    const document = 'See [Takeovers](#takeovers), [Profiles](artists.md#profiles), [Applications](applications.md) and [admins](admins.md#sessions).\n\n## `GET /x`\n'
    expect(rules(document)).toBe(
      'See Takeovers, Profiles (read_documentation, area `artists`), Applications (read_documentation, area `applications`) and admins.',
    )
  })

  it('leave no link in what the areas give', async () => {
    for (const [area, text] of Object.entries(await loadRules())) expect(text, area).not.toMatch(/\]\(/)
  })
})
