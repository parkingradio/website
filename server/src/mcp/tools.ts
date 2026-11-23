import type { FastifyInstance, FastifySchema } from 'fastify'
import { z } from 'zod'
import { Ok } from '../api/schemas.js'
import type { ToolConfig } from '../api/schemas.js'
import { signSessionToken } from '../admins/auth.js'
import { config } from '../core/config.js'
import { areaOf } from './documentation.js'
import type { Area } from './documentation.js'

// The tools of the MCP server, which are the routes that say they're tools (see `config.tool` in api/schemas.ts, and
// docs/design/server/mcp.md). A tool sends its route the request its arguments make, as the connection's user, and gives
// back the route's response, so that the route stays the only thing that checks what's sent and decides what happens.

// A route that's a tool, as it was registered.
export type ToolRoute = { method: string; url: string; schema: FastifySchema; tool: ToolConfig }

// The user a tool acts as.
export type ToolUser = { id: string; email: string; sessionVersion: number }

type JsonObject = { [key: string]: unknown }

export type ToolResult = { content: [{ type: 'text'; text: string }]; isError?: true }

// What calling a tool gives back, and, when it fails, why, which the MCP server logs (see Logs in
// docs/design/server/README.md): its status, when it has one, and its error's message. Not the error's other fields, e.g.
// the session and the set in the way of a 409, which are only given back.
export type ToolCall = { result: ToolResult; failed?: { status?: number; error?: string } }

export type Tool = {
  name: string
  title: string
  description: string
  // The JSON Schema of its arguments, an object.
  inputSchema: JsonObject
  readOnly: boolean
  call(args: JsonObject, as: ToolUser): Promise<ToolCall>
}

// Collects the routes of `app` that are tools, as they're registered, which has to start before they are.
export function collectToolRoutes(app: FastifyInstance): ToolRoute[] {
  const routes: ToolRoute[] = []
  app.addHook('onRoute', (route) => {
    if (route.config?.tool) {
      // Not the HEAD routes that Fastify adds for GET routes.
      for (const method of [route.method].flat().filter((method) => method !== 'HEAD')) {
        routes.push({ method, url: route.url, schema: route.schema ?? {}, tool: route.config.tool })
      }
    }
  })
  return routes
}

// How long the session of a request a tool sends lasts: only for that request.
const TOOL_SESSION_SECONDS = 60

// The parts of a request that a tool's arguments go to: for a multipart request, its part that's JSON, e.g. an artist's
// profile.
type Part = 'path' | 'query' | 'body' | 'json'

// The JSON Schema of `schema`, as it's received, with the schemas it refers to written in it, since an argument's schema
// can't refer to another tool's.
function jsonSchema(schema: z.ZodType): JsonObject {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonObject & { $defs?: Record<string, unknown> }
  const $defs = json.$defs ?? {}
  delete json.$defs
  delete json.$schema
  const inline = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(inline)
    if (node === null || typeof node !== 'object') return node
    const { $ref, ...rest } = node as JsonObject
    const referred = typeof $ref === 'string' && $ref.startsWith('#/$defs/') ? inline($defs[$ref.slice('#/$defs/'.length)]) : {}
    return { ...(referred as JsonObject), ...Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, inline(value)])) }
  }
  return inline(json) as JsonObject
}

// What a multipart request sends: its part that's JSON, e.g. an artist's profile, and its file, e.g. "photo", which tools
// can't send. Only the tools that add an artist, a collective or a session send one: those that change them send JSON.
function multipartParts(multipart: z.ZodObject): { json: [string, z.ZodObject]; file: string } {
  const parts = Object.entries(multipart.shape)
  const json = parts.filter(([, part]) => part instanceof z.ZodObject)
  const files = parts.filter(([, part]) => (part instanceof z.ZodOptional ? part.unwrap() : part) instanceof z.ZodFile)
  if (json.length !== 1 || files.length !== 1 || parts.length !== 2) {
    throw new Error('A multipart tool takes one part that is JSON, one file, and nothing else')
  }
  return { json: json[0] as [string, z.ZodObject], file: files[0][0] }
}

// The tools' arguments and where each one goes, from the route's schemas. Two arguments with the same name, e.g. a path
// parameter and a field of the body, can't be told apart, so the server refuses to start.
function argumentsOf(route: ToolRoute): {
  schema: JsonObject
  parts: Map<string, Part>
  json?: string
  nullable: string[]
  nullableInLists: Map<string, string[]>
} {
  const properties: JsonObject = {}
  const required: string[] = []
  const parts = new Map<string, Part>()
  // The fields of a POST's body that can be null, which can be left out, and are then sent as null, e.g. a new set's
  // SoundCloud track, and likewise those of the objects in its lists, by the list, e.g. those of a new session's sets. A
  // PATCH takes any of its fields anyway.
  const nullable: string[] = []
  const nullableInLists = new Map<string, string[]>()
  const add = (schema: z.ZodType | undefined, part: Part) => {
    if (!schema) return
    const json = jsonSchema(schema) as { properties?: JsonObject; required?: string[] }
    // E.g. a union, whose arguments the tool couldn't name.
    if (!json.properties) throw new Error(`${route.method} ${route.url}: its tool's arguments have to be an object's properties`)
    const posted = route.method === 'POST' && (part === 'body' || part === 'json')
    for (const [name, property] of Object.entries(json.properties)) {
      if (parts.has(name)) throw new Error(`${route.method} ${route.url}: two of its tool's arguments are named \`${name}\``)
      parts.set(name, part)
      properties[name] = property
      const items = posted ? listItems(property) : undefined
      if (items?.properties) {
        const fields = (items.required ?? []).filter((field) => allowsNull(items.properties![field]))
        if (fields.length > 0) {
          nullableInLists.set(name, fields)
          items.required = items.required!.filter((field) => !fields.includes(field))
        }
      }
    }
    for (const name of json.required ?? []) {
      if (posted && allowsNull(json.properties[name])) nullable.push(name)
      else required.push(name)
    }
  }
  add(route.schema.params as z.ZodType | undefined, 'path')
  // A path parameter is said to be the id of what's before it in the path, e.g. a session's for `create_set`, unless its
  // schema says otherwise.
  for (const [, before, param] of route.url.matchAll(/([a-z]+)s\/:(\w+)/g)) {
    const property = properties[param] as JsonObject | undefined
    if (property && !property.description) property.description = `The ${before}'s ${param}`
  }
  add(route.schema.querystring as z.ZodType | undefined, 'query')
  add(route.schema.body as z.ZodType | undefined, 'body')
  let json: string | undefined
  if (route.schema.multipart) {
    const { json: [name, schema] } = multipartParts(route.schema.multipart)
    json = name
    add(schema, 'json')
  }
  return { schema: { type: 'object', properties, required, additionalProperties: false }, parts, json, nullable, nullableInLists }
}

// The JSON Schema of the objects in a list, when `schema` is one.
function listItems(schema: unknown): { properties?: JsonObject; required?: string[] } | undefined {
  const list = alternatives(schema).find(({ type }) => type === 'array')
  const items = list?.items
  return items !== null && typeof items === 'object' && !Array.isArray(items) ? (items as { properties?: JsonObject; required?: string[] }) : undefined
}

// The schemas a value that follows a JSON Schema can follow: the schema, and its alternatives, e.g. a string, or null.
function alternatives(schema: unknown): JsonObject[] {
  if (schema === null || typeof schema !== 'object') return []
  const { anyOf, oneOf, allOf } = schema as { anyOf?: unknown[]; oneOf?: unknown[]; allOf?: unknown[] }
  return [schema as JsonObject, ...[...(anyOf ?? []), ...(oneOf ?? []), ...(allOf ?? [])].flatMap(alternatives)]
}

// Whether a JSON Schema takes null.
function allowsNull(schema: unknown): boolean {
  return alternatives(schema).some(({ type }) => type === 'null' || (Array.isArray(type) && type.includes('null')))
}

// What a tool's description starts with: to read its area's rules, once, rather than before each call.
export function readFirst(area: Area | undefined): string {
  return `Once per conversation, before using it, read the rules with \`read_documentation\`${area ? `, area \`${area}\`` : ''}.`
}

// What a tool's description says: first, to read its area's rules, since some apps only give the model the tools'
// descriptions, rather than the instructions too (see docs/design/server/mcp.md), then the route's summary, and more.
function descriptionOf(route: ToolRoute, name: string): string {
  const summary = route.schema.summary ?? ''
  const sentences = [readFirst(areaOf(route.url)), /[.!?]$/.test(summary) ? summary : `${summary}.`]
  if (name in SUMMARIES) sentences.push(SUMMARIES[name].says ?? `Gives a summary of each one: \`get_${name.slice('list_'.length, -1)}\` gives all of it.`)
  // The tools that change some of an item's fields (see "Changes" in docs/design/server/README.md).
  if (route.method === 'PATCH') sentences.push("What it isn't given stays as it is, and a list or an object it's given replaces the whole one.")
  if (route.schema.multipart) sentences.push(`Tools can't send a ${multipartParts(route.schema.multipart).file}.`)
  const hidden = hiddenBy(route)
  // Not for the tools that only answer `{"ok": true}`, e.g. `delete_artist`.
  if ((route.schema.response as Record<number, unknown> | undefined)?.[200] !== Ok) sentences.push(...hidden.map(({ said }) => said))
  if (hidden.includes(CONTACT_DETAILS) && route.method === 'PATCH') sentences.push('Given as null or "", the email or phone is removed.')
  return sentences.join(' ')
}

// What tools never give, whether they succeed or fail, wherever it is in what the routes under `path` answer, since what a
// tool gives is sent to the model's provider (see "Results" in docs/design/server/mcp.md), and what their descriptions say
// about it.
// `of` is the id of the schema whose fields they are, e.g. CalendarFeed, when their names alone don't tell, which a test
// relies on to check that every route that gives them is under `path`.
type Hidden = { path: RegExp; fields: string[]; of?: string; said: string }
// The emails and phone numbers of artists and collectives.
const CONTACT_DETAILS: Hidden = { path: /^\/api\/admin\/(artists|collectives)(\/|$)/, fields: ['email', 'phone'], said: 'Emails and phone numbers are never shown.' }
// The links of calendar feeds, which are secrets. Any other `link` in the calendar's responses would be left out too.
const FEED_LINKS: Hidden = { path: /^\/api\/admin\/calendar(\/|$)/, fields: ['link'], of: 'CalendarFeed', said: "Calendar feeds' links are never shown." }
export const HIDDEN = [CONTACT_DETAILS, FEED_LINKS]

const hiddenBy = (route: Pick<ToolRoute, 'url'>) => HIDDEN.filter(({ path }) => path.test(route.url))

// The fields that the tool of `route` never gives.
export function hiddenFields(route: Pick<ToolRoute, 'url'>): string[] {
  return hiddenBy(route).flatMap(({ fields }) => fields)
}

// `value`, without its `fields`, wherever they are.
export function withoutFields(value: unknown, fields: string[]): unknown {
  if (fields.length === 0) return value
  if (Array.isArray(value)) return value.map((item) => withoutFields(item, fields))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !fields.includes(key))
      .map(([key, field]) => [key, withoutFields(field, fields)]),
  )
}

type Answer = { status: number; body: unknown }
type Payload = { body: string | Buffer; contentType: string }
// Sends a request as the user a tool acts as.
type Send = (method: string, url: string, payload?: Payload) => Promise<Answer>

// The fields of a session's summary, but its sets.
const SESSION_SUMMARY = ['id', 'start', 'end', 'durationMinutes', 'type', 'title', 'takeover', 'application', 'status', 'announced']

// What the tools that list artists, collectives, applications and sessions give of each one, and `get_calendar` of each
// of its sessions, so that their lists fit in what apps take as they grow: these fields of the full item, as they are.
// Their descriptions say so, and which tool gives all of one: for `list_<items>`, `get_<item>`, unless it `says` otherwise.
type Summary = { says?: string; summarize: (body: JsonObject, send: Send) => Promise<JsonObject> }
const SUMMARIES: Record<string, Summary> = {
  list_artists: {
    summarize: async ({ artists, ...rest }) => ({ ...rest, artists: pick(artists, ['id', 'name', 'country', 'city', 'genres', 'collectives']) }),
  },
  list_collectives: {
    summarize: async ({ collectives, ...rest }) => ({ ...rest, collectives: pick(collectives, ['id', 'name', 'country', 'city', 'members']) }),
  },
  list_applications: {
    summarize: async ({ applications, ...rest }, send) => {
      // With the name of their artist or collective, which the route doesn't give.
      const names = new Map<string, string>()
      const owners = await Promise.all([send('GET', '/api/admin/artists'), send('GET', '/api/admin/collectives')])
      for (const [field, { body }] of [['artists', owners[0]], ['collectives', owners[1]]] as const) {
        for (const { id, name } of ((body as JsonObject)[field] ?? []) as { id: string; name: string }[]) names.set(id, name)
      }
      const summaries = pick(applications, ['id', 'artistId', 'collectiveId', 'receivedAt', 'status', 'dates', 'sets', 'sessions']).map((summary) => ({
        ...summary,
        name: names.get((summary.artistId ?? summary.collectiveId) as string) ?? null,
      }))
      return { ...rest, applications: summaries }
    },
  },
  list_sessions: {
    summarize: async ({ sessions, ...rest }) => ({
      ...rest,
      sessions: (sessions as JsonObject[]).map((session) => ({
        ...pickOne(session, SESSION_SUMMARY),
        sets: pick(session.sets, ['id', 'durationMinutes', 'status', 'performers', 'application']),
      })),
    }),
  },
  get_calendar: {
    says:
      'Gives a summary of each session, without its sets: `get_session` gives all of a session, and `list_sessions`, with `from` and `to`, the sets of a period.',
    summarize: async ({ sessions, undatedSessions, ...rest }) => ({
      ...rest,
      sessions: pick(sessions, SESSION_SUMMARY),
      undatedSessions: pick(undatedSessions, SESSION_SUMMARY),
    }),
  },
}

function pickOne(item: JsonObject, fields: string[]): JsonObject {
  return Object.fromEntries(fields.filter((field) => field in item).map((field) => [field, item[field]]))
}

function pick(items: unknown, fields: string[]): JsonObject[] {
  return ((items ?? []) as JsonObject[]).map((item) => pickOne(item, fields))
}

// A path parameter, as it goes in the path: only one segment, so that it can't lead to another route, e.g. with "..".
// Null when it can't be one.
function segment(value: unknown): string | null {
  if (typeof value !== 'string' || value === '' || value === '.' || value === '..') return null
  try {
    return encodeURIComponent(value)
  } catch {
    return null // e.g. a lone surrogate
  }
}

// The text of a result: JSON without spaces, with the line and paragraph separators escaped, which some apps can't take
// raw.
function text(value: unknown): string {
  return JSON.stringify(value).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
}

// A tool that fails gives the status and the error, with all the fields it's given: a route's error, without those that
// tools never give (see `withoutFields`).
export function failure(status: number, body: unknown): ToolCall {
  const error = typeof body === 'object' && body !== null ? body : { error: body }
  const message = 'error' in error && typeof error.error === 'string' ? error.error : undefined
  return { result: { content: [{ type: 'text', text: text({ status, ...error }) }], isError: true }, failed: { status, error: message } }
}

// The tools of `routes`, which send their requests to `app`.
export function buildTools(routes: ToolRoute[], app: FastifyInstance): Tool[] {
  // What sends requests as `as`, with a session of their own, which no header of the MCP request goes in.
  const sender = async (as: ToolUser): Promise<Send> => {
    const session = await signSessionToken(as, TOOL_SESSION_SECONDS)
    return async (method, url, payload) => {
      const response = await app.inject({
        method: method as 'GET',
        url,
        cookies: { [config.sessionCookie]: session },
        ...(payload && { payload: payload.body, headers: { 'content-type': payload.contentType } }),
      })
      let body: unknown = response.body
      try {
        body = response.json()
      } catch {
        // Not JSON, which no tool's route answers with, but which is still said.
      }
      return { status: response.statusCode, body }
    }
  }

  const names = new Set<string>()
  return routes.map((route) => {
    const name = route.schema.operationId!
    if (names.has(name)) throw new Error(`Two tools are named \`${name}\``)
    names.add(name)
    const { schema, parts, json, nullable, nullableInLists } = argumentsOf(route)
    const hidden = hiddenFields(route)
    const call = async (args: JsonObject, as: ToolUser): Promise<ToolCall> => {
      const invalid = [...route.url.matchAll(/:(\w+)/g)].find(([, param]) => segment(args[param]) === null)
      if (invalid) return failure(400, { error: `\`${invalid[1]}\` isn't valid` })
      const path = route.url.replace(/:(\w+)/g, (_, param: string) => segment(args[param])!)
      // The path has to lead to the tool's route, with the parameters it was given. Encoded, a parameter is one segment
      // of it, but a segment can still be that of another route, which the router prefers to a parameter, e.g.
      // `get_application({ id: "recipients" })` would lead to GET /api/admin/applications/recipients. The router
      // then finds other parameters, or none, so asking it is what keeps every tool to its route, whatever the routes.
      const found = new URL(path, 'http://localhost').pathname === path ? app.findRoute({ method: route.method, url: path }) : null
      const params = [...route.url.matchAll(/:(\w+)/g)].map(([, param]) => param)
      if (!found || params.some((param) => (found.params as Record<string, string>)[param] !== args[param])) {
        const given = params.map((param) => `\`${param}\``).join(' and ')
        return failure(400, { error: `The ${given} given ${params.length === 1 ? 'leads' : 'lead'} to another endpoint` })
      }
      const unknown = Object.keys(args).find((arg) => !parts.has(arg))
      if (unknown) return failure(400, { error: `\`${unknown}\` isn't an argument of this tool` })
      const send = await sender(as)
      const query = new URLSearchParams()
      const body: JsonObject = {}
      for (const [arg, value] of Object.entries(args)) {
        const part = parts.get(arg)
        if (part === 'query' && value !== undefined) query.set(arg, String(value))
        if (part === 'body' || part === 'json') body[arg] = value
      }
      for (const field of nullable) if (!(field in body)) body[field] = null
      for (const [list, fields] of nullableInLists) {
        const items = body[list]
        if (!Array.isArray(items)) continue
        body[list] = items.map((item) =>
          item !== null && typeof item === 'object' && !Array.isArray(item) ? { ...Object.fromEntries(fields.map((field) => [field, null])), ...item } : item,
        )
      }
      const url = query.size > 0 ? `${path}?${query}` : path

      let payload: Payload | undefined
      if (json) {
        const form = new FormData()
        form.append(json, JSON.stringify(body))
        const encoded = new Response(form)
        payload = { body: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type')! }
      } else if (route.schema.body) {
        payload = { body: JSON.stringify(body), contentType: 'application/json' }
      }

      const response = await send(route.method, url, payload)
      if (response.status >= 400) return failure(response.status, withoutFields(response.body, hidden))
      let result = response.body
      if (SUMMARIES[name]) result = await SUMMARIES[name].summarize(result as JsonObject, send)
      return { result: { content: [{ type: 'text', text: text(withoutFields(result, hidden)) }] } }
    }

    return {
      name,
      title: route.tool.title,
      description: descriptionOf(route, name),
      inputSchema: schema,
      readOnly: route.method === 'GET' || route.tool.readOnly === true,
      call,
    }
  })
}
