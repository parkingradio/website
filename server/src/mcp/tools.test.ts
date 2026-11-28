import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { z } from 'zod'
import { registerRoutes } from '../app.js'
import type { Dependencies } from '../app.js'
import { AREAS, loadRules, rules } from './documentation.js'
import { HIDDEN, buildTools, collectToolRoutes, hiddenFields } from './tools.js'

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
        ...['list_ra_events', 'get_playlist_on_air', 'get_radio_playlist', 'preview_playlist', 'choose_playlist', 'get_soundcloud_app'],
        ...['get_on_air', 'get_rotation', 'update_rotation_sets', 'list_rotation_candidates', 'get_rotation_candidate'],
        'get_youtube_credentials',
        ...['list_artists', 'get_artist', 'create_artist', 'update_artist', 'delete_artist_photo', 'delete_artist'],
        ...['list_collectives', 'get_collective', 'create_collective', 'update_collective', 'delete_collective_photo', 'delete_collective'],
        ...['list_applications', 'get_application', 'create_application', 'update_application', 'update_application_decision'],
        ...['delete_application', 'get_application_recipients'],
        ...['list_sessions', 'get_session', 'create_session', 'update_session', 'update_session_status', 'update_session_announced'],
        ...['delete_session_flyer', 'delete_session'],
        ...['create_set', 'update_set', 'update_set_status', 'update_set_position', 'update_set_session', 'delete_set'],
        ...['list_events', 'get_public_artist', 'get_public_collective'],
        ...['get_calendar', 'list_calendar_feeds', 'refresh_calendar_feeds'],
      ].sort(),
    )
  })

  it('only read when their endpoint does, and are destructive otherwise', async () => {
    const { tools } = await apiTools()
    const reading = tools.filter(({ readOnly }) => readOnly).map(({ name }) => name)
    expect(reading.filter((name) => !/^(list|get)_/.test(name))).toEqual(['preview_playlist', 'refresh_calendar_feeds'])
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
    const areas = Object.fromEntries(tools.map(({ name, description }) => [name, /area `([\w-]+)`/.exec(description)![1]]))
    expect(areas).toMatchObject({
      ...{ get_on_air: 'radio', get_playlist_on_air: 'radio', update_rotation_sets: 'radio', get_rotation_candidate: 'radio', get_youtube_credentials: 'video', get_application_recipients: 'applications', update_set: 'sessions', list_ra_events: 'ra-events' },
      ...{ list_events: 'events', get_public_artist: 'artists', get_public_collective: 'collectives', list_calendar_feeds: 'calendar', refresh_calendar_feeds: 'calendar' },
      get_calendar: 'calendar',
    })
    const update = tools.find(({ name }) => name === 'update_artist')!
    expect(Object.keys(update.inputSchema.properties as object)).toEqual(
      expect.arrayContaining(['id', 'name', 'country', 'genres', 'email', 'phone']),
    )
    expect(update.inputSchema.properties).not.toHaveProperty('removePhoto')
    expect(update.description).toContain("What it isn't given stays as it is")
    expect(update.description).toContain('Given as null or "", the email or phone is removed.')
    expect(tools.find(({ name }) => name === 'create_artist')!.description).toContain("Tools can't send a photo.")
    const updateSession = tools.find(({ name }) => name === 'update_session')!
    expect(Object.keys(updateSession.inputSchema.properties as object)).toEqual(expect.arrayContaining(['id', 'name', 'description']))
    expect(updateSession.inputSchema.properties).not.toHaveProperty('removeFlyer')
    expect(tools.find(({ name }) => name === 'create_session')!.description).toContain("Tools can't send a flyer.")
    expect(updateSession.description).not.toMatch(/email/)
    // Removing a photo gives the artist, without their email and phone, but deleting the artist gives nothing of them.
    const description = (name: string) => tools.find((tool) => tool.name === name)!.description
    expect(description('delete_artist_photo')).toContain('Emails and phone numbers are never shown.')
    expect(description('delete_collective_photo')).toContain('Emails and phone numbers are never shown.')
    expect(description('delete_artist')).not.toContain('Emails and phone numbers')
    for (const name of ['delete_artist_photo', 'delete_collective_photo', 'delete_session_flyer']) {
      expect(tools.find((tool) => tool.name === name)!.inputSchema.required, name).toEqual(['id'])
    }
    // The tools that summarize what they give say which tool gives all of it.
    expect(description('list_sessions')).toContain('Gives a summary of each one: `get_session` gives all of it.')
    expect(description('get_calendar')).toContain(
      'Gives a summary of each session, without its sets: `get_session` gives all of a session, and `list_sessions`, whose `from` and `to` are instants, not days,',
    )
    expect(description('list_events')).toContain(
      "Gives a summary of each event, with its lineup rather than its sets: an event has its session's id, and `get_session` gives all of that session.",
    )
    expect(tools.find(({ name }) => name === 'get_calendar')!.inputSchema.required).toEqual(['from', 'to'])
    // Only what admins decide: sets and sessions make applications planned or done.
    const decide = tools.find(({ name }) => name === 'update_application_decision')!
    expect(decide.inputSchema.properties).toMatchObject({ decision: { enum: ['new', 'accepted', 'rejected'] } })
    // Applications are listed by some of their statuses, as a list, and by a range of days, which are days, `to` included.
    const listApplications = tools.find(({ name }) => name === 'list_applications')!
    expect(listApplications.inputSchema.properties).toMatchObject({
      status: { type: 'array', items: { enum: ['new', 'accepted', 'planned', 'done', 'rejected'] } },
      from: { type: 'string', format: 'date' },
      to: { type: 'string', format: 'date', description: expect.stringContaining('included') },
    })
    expect(listApplications.inputSchema.required).toEqual([])
  })

  it('only name tools that exist in their descriptions', async () => {
    const { tools } = await apiTools()
    const names = new Set([...tools.map(({ name }) => name), 'read_documentation'])
    for (const { name, description } of tools) {
      for (const [, named] of description.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) expect(names, `${name} names ${named}`).toContain(named)
    }
  })

  it("can't be led to another endpoint by an id that's another route's segment", async () => {
    const { tools } = await apiTools()
    for (const [name, args] of [['get_application', { id: 'recipients' }]] as const) {
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

  it("take the fields of a POST's body that can be null as optional, and every field of a PATCH's", async () => {
    const { tools } = await apiTools()
    const required = (name: string) => (tools.find((tool) => tool.name === name)!.inputSchema.required as string[]).sort()
    expect(required('create_set')).toEqual(['genres', 'id', 'otherPerformanceType', 'performanceTypes', 'performers'])
    expect(required('create_session')).toEqual(['description', 'durationMinutes', 'name', 'type'])
    // Its sets take theirs as optional too.
    const sets = tools.find((tool) => tool.name === 'create_session')!.inputSchema.properties as { sets: { items: { required: string[] } } }
    expect(sets.sets.items.required.sort()).toEqual(required('create_set').filter((name) => name !== 'id'))
    for (const name of ['update_artist', 'update_collective', 'update_application', 'update_session', 'update_set']) expect(required(name), name).toEqual(['id'])
  })

  it('change artists, collectives, applications, sessions and sets with PATCH', async () => {
    const { routes } = await apiTools()
    const updates = routes.filter((route) => /^update_[a-z]+$/.test(route.schema.operationId!))
    expect(updates.map(({ method, url }) => `${method} ${url}`).sort()).toEqual(
      ['artists', 'collectives', 'applications', 'sessions', 'sets'].map((items) => `PATCH /api/admin/${items}/:id`).sort(),
    )
  })

  // So that a new endpoint can't give emails, phone numbers or calendar feeds, with their links, without the tools leaving
  // them out.
  it('leave out of what they give every email, phone number and calendar feed link that their endpoint could give', async () => {
    const { routes } = await apiTools()
    for (const route of routes) {
      for (const [status, response] of Object.entries((route.schema.response ?? {}) as Record<string, z.ZodType>)) {
        const json = z.toJSONSchema(response, { io: 'output', unrepresentable: 'any' }) as { $defs?: Record<string, unknown> }
        const names = propertyNames(json)
        const where = `${route.method} ${route.url} (${status})`
        for (const { fields, of } of HIDDEN) {
          // Fields of a schema of their own are only checked where it is, since others can have the same names.
          const given = of ? fields.filter(() => json.$defs !== undefined && of in json.$defs) : fields.filter((field) => names.has(field))
          for (const field of given) expect(hiddenFields(route), `${where}: ${field}`).toContain(field)
        }
      }
    }
    expect(hiddenFields({ url: '/api/admin/calendar/feeds' })).toEqual(['link'])
    expect(hiddenFields({ url: '/api/admin/calendar' })).toEqual(['link'])
    expect(hiddenFields({ url: '/api/admin/artists/:id' })).toEqual(['email', 'phone'])
    expect(hiddenFields({ url: '/api/admin/sessions' })).toEqual([])
  })

  it("say that calendar feeds' links are never shown, and that the calendar has available time and the sessions outside protected time", async () => {
    const { tools } = await apiTools()
    expect(tools.find(({ name }) => name === 'list_calendar_feeds')!.description).toBe(
      "Once per conversation, before using it, read the rules with `read_documentation`, area `calendar`. Every calendar feed that the studio's occupations and holds are read from, with its kind, in the order they were added. Calendar feeds' links are never shown.",
    )
    const calendar = tools.find(({ name }) => name === 'get_calendar')!.description
    expect(calendar).toMatch(/ Calendar feeds' links are never shown\.$/)
    expect(calendar).toContain('its available time')
    expect(calendar).toContain('the sessions outside protected time of the next 365 days')
    expect(tools.find(({ name }) => name === 'refresh_calendar_feeds')!.description).toBe(
      "Once per conversation, before using it, read the rules with `read_documentation`, area `calendar`. Reads every calendar feed now, and gives every feed once each read is done or failed. Calendar feeds' links are never shown.",
    )
  })
})

describe('rules', () => {
  it("only keep the text of the links the model can't follow, and point those to other areas to read_documentation", () => {
    const document = 'See [Takeovers](#takeovers), [Profiles](artists.md#profiles), [Applications](applications.md) and [admins](admins.md#sessions).\n\n## `GET /x`\n'
    expect(rules(document)).toBe(
      'See Takeovers, Profiles (read_documentation, area `artists`), Applications (read_documentation, area `applications`) and admins.',
    )
  })

  it("give the calendar's conflicts, protected time and available time, and tell apps to look at the calendar before placing a session", async () => {
    const { sessions, calendar } = await loadRules()
    expect(sessions).toContain('see Calendar (read_documentation, area `calendar`)')
    expect(sessions).toMatch(/or be outside protected time, while\s+there's a `holds` feed/)
    expect(calendar).toContain('## Conflicts')
    expect(calendar).toContain('## Protected time')
    expect(calendar).toContain('## Availability')
    expect(calendar).toContain('Sessions are meant to be within protected time (see Rules, in Sessions (read_documentation, area `sessions`)): the calendar gives')
    expect(calendar).toMatch(/apps\s+ask\s+for\s+the\s+calendar\s+of\s+the\s+days\s+it\s+would\s+take/)
    expect(calendar).not.toContain('## `')
  })

  it("give the rotation of sets: which sets, why they're skipped, what's on air, and reading their tracks", async () => {
    const { radio, sessions } = await loadRules()
    for (const heading of ['## The rotation of sets', '### Which sets', '### On air', '### Reading the tracks', '## The playlist']) expect(radio).toContain(heading)
    expect(radio).toContain('`not-announced`')
    expect(radio).toContain("What's public, in Events (read_documentation, area `events`)")
    expect(radio).not.toContain('## `')
    expect(sessions).toContain('A set can be in the radio\'s rotation (see The rotation of sets, in Radio (read_documentation, area `radio`))')
  })

  it('leave no link in what the areas give', async () => {
    for (const [area, text] of Object.entries(await loadRules())) expect(text, area).not.toMatch(/\]\(/)
  })
})
